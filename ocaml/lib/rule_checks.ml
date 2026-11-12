open Domain
open Syntax

let negative term = term.qualifier = Some Qualifier.No

let identities references =
  List.filter_map (fun reference -> reference.object_id) references |> Int_set.of_list

let recover (declarations : Source_declarations.t) entries =
  let diagnostics = ref [] in
  let emit line severity message =
    diagnostics :=
      { location = Some { line; column = 1 }; severity; message } :: !diagnostics
  in
  let mask name = Option.map identities (Names.find_opt name declarations.memberships) in
  let actual name = Names.find_opt name declarations.actuals in
  let actual_ids names = List.filter_map actual names |> identities in
  let map_cells f rows =
    List.mapi
      (fun row cells -> List.mapi (fun cell -> map_contents (f row cell)) cells)
      rows
  in
  let check authored =
    let error = emit authored.rule_line Error_severity
    and warn = emit authored.rule_line Warning_severity in
    let rhs =
      Option.map
        (map_cells (fun _ _ terms ->
             let present =
               List.filter_map
                 (fun term ->
                   if negative term || not (Names.mem term.term_name declarations.actuals)
                   then None
                   else Some term.term_name)
                 terms
             in
             let present_ids = actual_ids present in
             List.iter
               (fun term ->
                 if negative term then
                   match mask term.term_name with
                   | Some excluded when not (Int_set.disjoint excluded present_ids) ->
                       error
                         ("You have specified that there should be NO "
                        ^ Utf8.uppercase term.term_name
                        ^ " but there is also a requirement that "
                         ^ Utf8.uppercase (String.concat ", " present)
                         ^ " be here.  This is a mistake right?")
                   | _ -> ())
               terms;
             terms))
        authored.rhs
    in
    let rhs =
      Option.map
        (map_cells (fun row cell terms ->
             let left =
               match
                 Option.bind (List.nth_opt authored.lhs row) (fun cells ->
                     List.nth_opt cells cell)
               with
               | Some cell -> cell_contents cell
               | None -> []
             in
             let rec remove = function
               | [] -> []
               | term :: rest
                 when negative term
                      && List.exists
                           (fun other ->
                             negative other && other.term_name = term.term_name)
                           left -> (
                   (* Removing a shared exclusion advances past its successor in the
               reference. Retain that observable recovery without mutating cells. *)
                   match rest with
                   | [] -> []
                   | next :: rest -> next :: remove rest)
               | term :: rest -> term :: remove rest
             in
             remove terms))
        rhs
    in
    let lhs =
      map_cells
        (fun _ _ terms ->
          let required_layers, required_ids, occupiers =
            List.fold_left
              (fun ((layers, ids, occupiers) as required) term ->
                if negative term then required
                else
                  let name = term.term_name in
                  let add_layer layer occupants =
                    let layers = Int_set.add (Option.value ~default:0 layer) layers in
                    let occupiers =
                      match layer with
                      | None -> occupiers
                      | Some layer -> Int_map.add layer name occupiers
                    in
                    (layers, Int_set.union ids occupants, occupiers)
                  in
                  match Names.find_opt name declarations.property_layers with
                  | Some layer ->
                      add_layer layer
                        (identities (Names.find name declarations.properties))
                  | None -> (
                      match actual name with
                      | Some reference ->
                          add_layer reference.source_layer (identities [ reference ])
                      | None -> (
                          match
                            Compiled_names.aggregate declarations.compiled_names name
                          with
                          | None -> required
                          | Some names ->
                              List.fold_left
                                (fun (layers, ids, occupiers) name ->
                                  match actual name with
                                  | None -> (layers, ids, occupiers)
                                  | Some reference ->
                                      ( Int_set.add
                                          (Option.value ~default:0 reference.source_layer)
                                          layers,
                                        Int_set.union ids (identities [ reference ]),
                                        match reference.source_layer with
                                        | None -> occupiers
                                        | Some layer ->
                                            Int_map.add layer term.term_name occupiers ))
                                required names)))
              (Int_set.empty, Int_set.empty, Int_map.empty)
              terms
          in
          List.filter
            (fun term ->
              if not (negative term) then true
              else
                match mask term.term_name with
                | None -> true
                | Some excluded ->
                    let excluded_layers =
                      Frozen_array.to_list
                        (Frozen_array.mapi
                           (fun index occupants ->
                             if Int_set.disjoint excluded occupants then None
                             else Some index)
                           declarations.collision)
                      |> List.filter_map Fun.id |> Int_set.of_list
                    in
                    if
                      Int_set.disjoint excluded required_ids
                      && Int_set.subset excluded_layers required_layers
                    then (
                      let present = Int_map.bindings occupiers in
                      warn
                        ("You have specified that there should be NO "
                       ^ Utf8.uppercase term.term_name
                       ^ " but there is also a requirement that "
                        ^ Utf8.uppercase (String.concat ", " (List.map snd present))
                        ^ " be there, which collectively occupies the same layers \
                           (Layers "
                        ^ String.concat ", "
                            (List.map
                               (fun (layer, _) -> string_of_int (layer + 1))
                               present)
                        ^ "), so you can leave this out.");
                      false)
                    else true)
            terms)
        authored.lhs
    in
    { authored with lhs; rhs }
  in
  let entries =
    List.map (function Rule authored -> Rule (check authored) | entry -> entry) entries
  in
  (entries, Diagnostics.normalize (List.rev !diagnostics))

let cell_contradiction pattern =
  let present, absent =
    List.fold_left
      (fun (present, absent) -> function
        | Present (((Object _ | Aggregate _) as selection), _) ->
            (Int_set.union present (Int_set.of_list (members selection)), absent)
        | Absent selection ->
            (present, Int_set.union absent (Int_set.of_list (members selection)))
        | Present (Property _, _) | Layer_movement _ -> (present, absent))
      (Int_set.empty, Int_set.empty)
      pattern.predicates
  in
  let intersection = Int_set.inter present absent in
  if Int_set.is_empty intersection then None else Some intersection

let replacement ~discard ~line (declarations : Source_declarations.t) terms =
  let diagnostics = ref [] in
  let emit severity message =
    diagnostics :=
      { location = Some { line; column = 1 }; severity; message } :: !diagnostics
  in
  let warn = emit Warning_severity and error = emit Error_severity in
  let actual name = Names.find_opt name declarations.actuals in
  let _, _ =
    List.fold_left
      (fun (occupied, random) term ->
        let name = term.Rule_ir.Bound.name in
        if term.qualifier = Rule_ir.Bound.Excluded then (occupied, random)
        else if term.qualifier = Rule_ir.Bound.Random_object then (
          if not (Names.mem name declarations.memberships) then (occupied, random)
          else
            let values =
              Option.value ~default:[ name ]
                (Compiled_names.property declarations.compiled_names name)
            in
            if List.length values = 1 then
              warn
                ("In this rule you're asking me to spawn a random " ^ Utf8.uppercase name
               ^ " for you, but that's already a concrete single object. You wanna be \
                  using random with properties (things defined in terms of OR in the \
                  legend) so there's some things to select between.");
            let random =
              List.fold_left
                (fun random value ->
                  match actual value with
                  | Some { source_layer = Some layer; _ } ->
                      (match Int_map.find_opt layer occupied with
                      | Some previous when Utf8.uppercase value <> Utf8.uppercase previous
                        ->
                          warn
                            ("This rule may try to spawn a " ^ Utf8.uppercase value
                           ^ " with random, but also requires a "
                           ^ Utf8.uppercase previous
                           ^ " be here, which is on the same layer - they shouldn't be \
                              able to coexist!")
                      | _ -> ());
                      Int_map.add layer value random
                  | _ -> random)
                random values
            in
            (occupied, random))
        else
          let layer =
            match actual name with
            | Some reference -> Some (reference_layer reference)
            | None -> Option.join (Names.find_opt name declarations.property_layers)
          in
          match layer with
          | None -> (occupied, random)
          | Some layer ->
              let previous =
                match Int_map.find_opt layer occupied with
                | Some _ as value -> value
                | None -> Int_map.find_opt layer random
              in
              (match previous with
              | Some previous when not discard ->
                  error
                    ("Rule matches object types that can't overlap: \""
                   ^ Utf8.uppercase name ^ "\" and \"" ^ Utf8.uppercase previous ^ "\".")
              | _ -> ());
              (Int_map.add layer name occupied, random))
      (Int_map.empty, Int_map.empty)
      terms
  in
  Diagnostics.normalize (List.rev !diagnostics)
