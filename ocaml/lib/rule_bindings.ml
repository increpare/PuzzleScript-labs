open Syntax
open Domain

type sides = { left : pattern_cell list list; right : pattern_cell list list }
type expansion = { variants : sides list; unresolved : string option }
type address = int * int

let map_cells f rows =
  List.mapi
    (fun row cells -> List.mapi (fun cell -> map_contents (f (row, cell))) cells)
    rows

let cell rows (row, cell) = List.nth (List.nth rows row) cell |> cell_contents

let cells rows =
  List.mapi
    (fun row cells ->
      List.mapi (fun cell contents -> ((row, cell), cell_contents contents)) cells)
    rows
  |> List.concat

(* Completed choices retain their order while new branches join the back of a
   persistent work queue. Expanding several cells can reach the same variant by
   different paths; later source-identity deduplication keeps the last path. *)
type 'a search_step = Finished | Expand of 'a list | Dead_end

let expand step initial =
  let rec visit completed front back =
    match front with
    | [] when back = [] -> List.rev completed
    | [] -> visit completed (List.rev back) []
    | current :: rest -> (
        match step current with
        | Finished -> visit (current :: completed) rest back
        | Dead_end -> visit completed rest back
        | Expand choices -> visit completed rest (List.rev_append choices back))
  in
  visit [] [ initial ] []

let movement_choices direction = function
  | Some
      ((Qualifier.Axis _ | Moving | Orthogonal | Parallel | Perpendicular) as qualifier)
    ->
      Option.value ~default:[] (Qualifier.movements direction qualifier)
      |> List.map (fun movement -> Qualifier.Movement movement)
  | _ -> []

let movement_label direction = function
  | Qualifier.Parallel -> (
      match direction with
      | Direction.Up | Down -> "vertical_par"
      | Left | Right -> "horizontal_par")
  | Perpendicular -> (
      match direction with
      | Direction.Up | Down -> "horizontal_perp"
      | Left | Right -> "vertical_perp")
  | qualifier -> Qualifier.to_string qualifier

module Attached = Map.Make (struct
  type t = string * Qualifier.t

  let compare = compare
end)

module Qualifiers = Map.Make (struct
  type t = Qualifier.t

  let compare = compare
end)

type attached = { chosen : Qualifier.t; origin : address; occurrences : int }
type loose = { chosen : Qualifier.t; occurrences : int }

type moving = {
  sides : sides;
  attached : attached Attached.t;
  loose : loose Qualifiers.t;
}

let movements ~direction sides =
  let replace name qualifier chosen address sides =
    let replace at terms =
      if at <> address then terms
      else
        List.map
          (fun term ->
            if term.term_name = name && term.qualifier = Some qualifier then
              { term with qualifier = Some chosen }
            else term)
          terms
    in
    { left = map_cells replace sides.left; right = map_cells replace sides.right }
  in
  let branches current =
    cells current.sides.left
    |> List.concat_map (fun (address, terms) ->
        match
          List.find_opt
            (fun term -> movement_choices direction term.qualifier <> [])
            terms
        with
        | None -> []
        | Some term ->
            let qualifier = Option.get term.qualifier in
            movement_choices direction term.qualifier
            |> List.map (fun chosen ->
                let attached =
                  Attached.update (term.term_name, qualifier)
                    (function
                      | None -> Some { chosen; origin = address; occurrences = 1 }
                      | Some previous ->
                          Some
                            {
                              previous with
                              occurrences =
                                (previous.occurrences
                                + if address = previous.origin then 0 else 1);
                            })
                    current.attached
                in
                let loose =
                  Qualifiers.update qualifier
                    (function
                      | None -> Some { chosen; occurrences = 1 }
                      | Some previous ->
                          Some { previous with occurrences = previous.occurrences + 1 })
                    current.loose
                in
                {
                  sides = replace term.term_name qualifier chosen address current.sides;
                  attached;
                  loose;
                }))
  in
  let variants =
    expand
      (fun current ->
        match branches current with [] -> Finished | choices -> Expand choices)
      { sides; attached = Attached.empty; loose = Qualifiers.empty }
    |> List.map (fun current ->
        let right =
          map_cells
            (fun _ terms ->
              List.map
                (fun term ->
                  match term.qualifier with
                  | None -> term
                  | Some qualifier -> (
                      let attached =
                        Attached.find_opt (term.term_name, qualifier) current.attached
                      in
                      let chosen =
                        match attached with
                        | Some { chosen; occurrences = 1; _ } -> Some chosen
                        | _ -> (
                            match Qualifiers.find_opt qualifier current.loose with
                            | Some { chosen; occurrences = 1 } -> Some chosen
                            | _ -> None)
                      in
                      match chosen with
                      | None -> term
                      | Some chosen -> { term with qualifier = Some chosen }))
                terms)
            current.sides.right
        in
        { current.sides with right })
  in
  let unresolved =
    List.find_map
      (fun sides ->
        cells sides.right
        |> List.find_map (fun (_, terms) ->
            List.find_map
              (fun term ->
                if movement_choices direction term.qualifier = [] then None
                else Some (movement_label direction (Option.get term.qualifier)))
              terms))
      variants
  in
  { variants; unresolved }

type property_evidence = { concrete : string; occurrences : int }
type property = { sides : sides; evidence : property_evidence Names.t }

let properties (declarations : Source_declarations.t) sides =
  let property term =
    term.qualifier <> Some Qualifier.Random
    && Names.mem term.term_name declarations.properties
  in
  let expand_negative =
    map_cells (fun _ terms ->
        List.concat_map
          (fun term ->
            match
              (term.qualifier, Names.find_opt term.term_name declarations.properties)
            with
            | Some Qualifier.No, Some references ->
                List.map
                  (fun reference -> { term with term_name = reference.source_name })
                  references
            | _ -> [ term ])
          terms)
  in
  let sides =
    { left = expand_negative sides.left; right = expand_negative sides.right }
  in
  let ambiguous =
    cells sides.right
    |> List.fold_left
         (fun ambiguous (address, terms) ->
           let local =
             List.filter property (cell sides.left address)
             |> List.map (fun term -> term.term_name)
           in
           List.fold_left
             (fun ambiguous term ->
               if property term && not (List.mem term.term_name local) then
                 Names.add term.term_name () ambiguous
               else ambiguous)
             ambiguous terms)
         Names.empty
  in
  let replace property concrete terms =
    List.map
      (fun term ->
        if term.term_name = property && term.qualifier <> Some Qualifier.Random then
          { term with term_name = concrete }
        else term)
      terms
  in
  let branches current =
    let candidate =
      cells current.sides.left
      |> List.find_map (fun (address, terms) ->
          List.find_map
            (fun term ->
              if
                property term
                && (Names.mem term.term_name ambiguous
                   || not (Names.mem term.term_name declarations.property_layers))
              then Some (address, term.term_name)
              else None)
            terms)
    in
    match candidate with
    | None -> Finished
    | Some (address, name) -> (
        match Names.find name declarations.properties with
        | [] -> Dead_end
        | references ->
            Expand
              (List.map
                 (fun reference ->
                   let concrete = reference.source_name in
                   let local at terms =
                     if at = address then replace name concrete terms else terms
                   in
                   let sides =
                     {
                       left = map_cells local current.sides.left;
                       right = map_cells local current.sides.right;
                     }
                   in
                   let evidence =
                     Names.update name
                       (function
                         | None -> Some { concrete; occurrences = 1 }
                         | Some previous ->
                             Some { previous with occurrences = previous.occurrences + 1 })
                       current.evidence
                   in
                   { sides; evidence })
                 references))
  in
  let variants =
    expand branches { sides; evidence = Names.empty }
    |> List.map (fun current ->
        let right =
          map_cells
            (fun _ terms ->
              Names.fold
                (fun name evidence terms ->
                  if evidence.occurrences = 1 then replace name evidence.concrete terms
                  else terms)
                current.evidence terms)
            current.sides.right
        in
        { current.sides with right })
  in
  let unresolved =
    List.fold_left
      (fun last sides ->
        cells sides.right
        |> List.fold_left
             (fun last (_, terms) ->
               List.fold_left
                 (fun last term ->
                   if property term && Names.mem term.term_name ambiguous then
                     Some term.term_name
                   else last)
                 last terms)
             last)
      None variants
  in
  { variants = (if unresolved = None then variants else []); unresolved }

let stationary_spawns (declarations : Source_declarations.t) sides =
  let right =
    map_cells
      (fun address terms ->
        let possible =
          cell sides.left address
          |> List.concat_map (fun term ->
              if Names.mem term.term_name declarations.actuals then [ term.term_name ]
              else
                Option.value ~default:[]
                  (Names.find_opt term.term_name declarations.properties)
                |> List.map (fun reference -> reference.source_name))
        in
        let layers =
          List.filter_map
            (fun name ->
              Option.map
                (fun reference -> reference.source_layer)
                (Names.find_opt name declarations.actuals))
            possible
        in
        List.map
          (fun term ->
            if
              term.qualifier <> None
              || Names.mem term.term_name declarations.properties
              || List.mem term.term_name possible
            then term
            else
              match Names.find_opt term.term_name declarations.actuals with
              | Some reference when not (List.mem reference.source_layer layers) ->
                  { term with qualifier = Some Qualifier.Stationary }
              | _ -> term)
          terms)
      sides.right
  in
  { sides with right }
