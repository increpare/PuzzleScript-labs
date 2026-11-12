open Domain
open Syntax
open Rule_ir
module Bound = Rule_ir.Bound

let error = Compile_diagnostics.fatal
let set = Int_set.of_list

let selection declarations (term : Bound.term) =
  Rule_names.selection declarations term.name

let membership declarations (term : Bound.term) =
  Rule_names.membership declarations term.name

let layers declarations term =
  Rule_names.layers declarations (selection declarations term)

let recover ~report declarations line terms =
  List.filter
    (fun (term : Bound.term) ->
      match term.qualifier with
      | Random_object ->
          if Names.mem term.name declarations.Source_declarations.memberships then true
          else (
            report line
              ("You want to spawn a random \"" ^ Utf8.uppercase term.name
             ^ "\", but I don't know how to do that");
            false)
      | _ -> (
          match selection declarations term with
          | Object { object_id = None; source_name; _ }
            when not (Names.mem source_name declarations.actuals) ->
              report line
                ("Oops! " ^ Utf8.uppercase source_name ^ " not assigned to a layer.");
              false
          | Property _
            when not
                   (match Names.find_opt term.name declarations.property_layers with
                   | Some (Some _) -> true
                   | _ -> false) ->
              report line
                ("Oops! " ^ Utf8.uppercase term.name ^ " not assigned to a layer.");
              false
          | _ -> true))
    terms

let predicate declarations ~line (term : Bound.term) =
  match term.qualifier with
  | Excluded -> [ Absent (Property (membership declarations term)) ]
  | Random_object | Random_direction ->
      error line "Random choices cannot appear on the left"
  | Unspecified | Stationary | Movement _ ->
      let test =
        match term.qualifier with
        | Stationary -> Domain.Stationary
        | Movement movement -> Moving movement
        | _ -> Domain.Unspecified
      in
      let present =
        Present (Rule_names.matching declarations term.name, Domain.Unspecified)
      in
      let movements =
        if test = Domain.Unspecified then []
        else
          Int_set.elements (layers declarations term)
          |> List.map (fun layer -> Layer_movement (layer, test))
      in
      present :: movements

let positive terms =
  List.filter
    (fun (term : Bound.term) ->
      term.qualifier <> Excluded && term.qualifier <> Random_object)
    terms

let occupied_layers declarations terms =
  List.fold_left
    (fun found term -> Int_set.union found (layers declarations term))
    Int_set.empty (positive terms)

let concrete_ids ~matching declarations terms =
  positive terms
  |> List.concat_map (fun term ->
      match selection declarations term with
      | Object reference ->
          if matching then
            List.filter_map
              (fun reference -> reference.object_id)
              (membership declarations term)
          else Option.to_list reference.object_id
      | Property _ | Aggregate _ -> [])
  |> set

let concrete_layers declarations terms =
  positive terms
  |> List.filter_map (fun term ->
      match selection declarations term with
      | Object reference -> Some (reference_layer reference)
      | Property _ | Aggregate _ -> None)
  |> set

let movements declarations terms =
  List.concat_map
    (fun (term : Bound.term) ->
      match term.qualifier with
      | Movement movement ->
          Int_set.elements (layers declarations term)
          |> List.map (fun layer -> (layer, movement))
      | _ -> [])
    terms

let placement_motion = function
  | Bound.Excluded -> None
  | Unspecified -> Some Preserve
  | Stationary | Random_object -> Some Clear
  | Movement movement -> Some (Set movement)
  | Random_direction -> Some Domain.Random_direction

let placement declarations (term : Bound.term) =
  Option.map
    (fun motion ->
      let random = term.qualifier = Random_object in
      let selected = selection declarations term in
      let occupants =
        if random then
          List.filter_map
            (fun reference -> reference.object_id)
            (membership declarations term)
        else
          match selected with
          | Object reference -> Option.to_list reference.object_id
          | Property _ | Aggregate _ ->
              members (Rule_names.matching declarations term.name)
      in
      let concrete =
        match selected with Object _ | Aggregate _ -> true | Property _ -> false
      in
      { occupants; movement_layers = layers declarations term; motion; random; concrete })
    (placement_motion term.qualifier)

let edit declarations left right =
  let lhs_layers = occupied_layers declarations left in
  let rhs_layers = occupied_layers declarations right in
  let right_ids = concrete_ids ~matching:false declarations right in
  let lhs_concrete = concrete_ids ~matching:true declarations left in
  let excluded =
    right
    |> List.filter (fun (term : Bound.term) -> term.qualifier = Excluded)
    |> List.concat_map (fun term ->
        List.filter_map
          (fun reference -> reference.object_id)
          (membership declarations term))
    |> set
  in
  let remove =
    if Int_set.subset lhs_concrete right_ids then excluded
    else Int_set.union excluded lhs_concrete
  in
  let lhs_movements = movements declarations left
  and rhs_movements = movements declarations right in
  let remove_movements =
    if List.for_all (fun movement -> List.mem movement rhs_movements) lhs_movements then
      []
    else lhs_movements
  in
  let clear_layers =
    Int_set.union
      (Int_set.diff lhs_layers rhs_layers)
      (concrete_layers declarations right)
  in
  let reset_movements =
    List.fold_left
      (fun reset (term : Bound.term) ->
        match term.qualifier with
        | Unspecified | Excluded | Random_object -> reset
        | Stationary | Movement _ | Random_direction ->
            Int_set.union reset (layers declarations term))
      (Int_set.diff lhs_layers rhs_layers)
      right
  in
  let concrete_removed =
    Int_set.diff (concrete_layers declarations left) (concrete_layers declarations right)
  in
  {
    remove;
    clear_layers;
    placements = List.filter_map (placement declarations) right;
    remove_movements;
    reset_movements = Int_set.union reset_movements concrete_removed;
  }

let lower_cell ~report declarations line left right =
  let left = recover ~report declarations line left in
  let right = Option.map (recover ~report declarations line) right in
  ( { predicates = List.concat_map (predicate declarations ~line) left },
    Option.map (edit declarations left) right )

let overlap declarations terms =
  let visit ((conflict, occupied) as previous) (term : Bound.term) =
    if term.qualifier = Excluded then previous
    else
      let required =
        match selection declarations term with
        | Property _ -> (
            match
              Names.find_opt term.name declarations.Source_declarations.property_layers
            with
            | Some (Some layer) -> Int_set.singleton layer
            | _ -> Int_set.empty)
        | selected -> Rule_names.layers declarations selected
      in
      Int_set.fold
        (fun layer (conflict, occupied) ->
          let conflict =
            match Int_map.find_opt layer occupied with
            | None -> conflict
            | Some previous -> Some (Utf8.uppercase term.name, Utf8.uppercase previous)
          in
          (conflict, Int_map.add layer term.name occupied))
        required (conflict, occupied)
  in
  fst (List.fold_left visit (None, Int_map.empty) terms)

let qualifier_name = function
  | Bound.Random_object -> "random"
  | Random_direction -> "randomdir"
  | Unspecified -> ""
  | Excluded -> "no"
  | Stationary -> "stationary"
  | Movement Action -> "action"
  | Movement (Move direction) -> Direction.to_string direction

exception Discard_rule

type detection = Gap_match of bool | Cell_match of Bound.term list
type progress = { edge_gap : bool; conflict : (string * string) option }

let reject ~report line message =
  report line message;
  raise Discard_rule

let detection ~report declarations ~line ~index ~width (cell : Bound.cell) =
  let reject = reject ~report line in
  let rec visit reversed = function
    | [] -> Cell_match (List.rev reversed)
    | Bound.Ellipsis _ :: _ ->
        if List.length cell.detection <> 1 then
          reject "You can't have anything in with an ellipsis. Sorry.";
        let edge = index = 0 || index = width - 1 in
        if edge then
          report line
            "There's no point in putting an ellipsis at the very start or the end of a \
             rule";
        (match cell.replacement with
        | None | Some [ Bound.Ellipsis _ ] -> ()
        | _ ->
            report line
              "An ellipsis on the left must be matched by one in the corresponding place \
               on the right.");
        Gap_match edge
    | Bound.Named term :: rest ->
        (match term.qualifier with
        | Random_object | Random_direction ->
            reject
              (Utf8.uppercase (qualifier_name term.qualifier)
              ^ " cannot be matched on the left-hand side; it can only appear on the \
                 right")
        | Unspecified | Excluded | Stationary | Movement _ -> ());
        ignore (lower_cell ~report declarations line [ term ] None);
        visit (term :: reversed) rest
  in
  visit [] cell.detection

let check_contradiction ~warn declarations ~line pattern =
  match Rule_checks.cell_contradiction pattern with
  | None -> ()
  | Some ids ->
      let conflicts =
        Int_set.elements ids
        |> List.map (fun id ->
            let name =
              Utf8.uppercase
                (Frozen_array.get declarations.Source_declarations.definitions id).name
            in
            name ^ " NO " ^ name)
      in
      warn line
        ("This rule has something amounting to \"" ^ String.concat ", " conflicts
       ^ "\" on the left-hand-side,which can never match, so the rule is getting removed \
          during compilation.");
      raise Discard_rule

let replacement ~report ~warn declarations ~line ~discard contents =
  (match contents with
  | Bound.Ellipsis _ :: _ ->
      report line
        "An ellipsis on the right must be matched by one in the corresponding place on \
         the left."
  | _ -> ());
  if
    List.length contents <> 1
    && List.exists (function Bound.Ellipsis _ -> true | _ -> false) contents
  then report line "You can't have anything in with an ellipsis. Sorry.";
  let rec prefix = function
    | [] | Bound.Ellipsis _ :: _ -> []
    | Bound.Named term :: rest -> term :: prefix rest
  in
  let terms = prefix contents in
  let emit (diagnostic : diagnostic) =
    match diagnostic.severity with
    | Error_severity -> report line diagnostic.message
    | Warning_severity -> warn line diagnostic.message
  in
  List.iter emit (Rule_checks.replacement ~discard ~line declarations terms);
  terms

let lower_match ~report ~warn declarations ~line ~index ~width state cell =
  match detection ~report declarations ~line ~index ~width cell with
  | Gap_match edge -> (Gap, { state with edge_gap = state.edge_gap || edge })
  | Cell_match left ->
      let pattern, _ = lower_cell ~report declarations line left None in
      check_contradiction ~warn declarations ~line pattern;
      let conflict =
        match overlap declarations left with None -> state.conflict | found -> found
      in
      let right =
        Option.map
          (replacement ~report ~warn declarations ~line ~discard:(conflict <> None))
          cell.replacement
      in
      let pattern, edit = lower_cell ~report declarations line left right in
      (Cell (pattern, edit), { state with conflict })

let lower_row ~report ~warn declarations ~line state row =
  let width = List.length row in
  let visit (reversed, state) (index, cell) =
    let segment, state =
      lower_match ~report ~warn declarations ~line ~index ~width state cell
    in
    (segment :: reversed, state)
  in
  let reversed, state =
    List.fold_left visit ([], state) (List.mapi (fun index cell -> (index, cell)) row)
  in
  (List.rev reversed, state)

let compile ~report ~warn declarations (source : Bound.t) =
  let authored = source.authored in
  let line = authored.rule_line in
  let visit (reversed, state) row =
    let row, state = lower_row ~report ~warn declarations ~line state row in
    (row :: reversed, state)
  in
  try
    let reversed, state =
      List.fold_left visit ([], { edge_gap = false; conflict = None }) source.rows
    in
    if state.edge_gap then None
    else
      let rule =
        {
          line;
          direction = source.direction;
          rows = List.rev reversed;
          commands = authored.commands;
          rigid = authored.headers.rigid;
        }
      in
      Some
        {
          identity = source.identity;
          source_group = authored.group_line;
          late = authored.headers.late;
          overlap = state.conflict;
          rule;
        }
  with Discard_rule -> None
