open Domain

let source (declarations : Source_declarations.t) ~line name =
  match Names.find_opt name declarations.namespace with
  | Some selection -> selection
  | None -> Compile_diagnostics.fatal line ("Unknown object or property: " ^ name)

let selection (declarations : Source_declarations.t) name =
  match
    (Names.find_opt name declarations.actuals, Names.find_opt name declarations.properties)
  with
  | Some reference, _ -> Object reference
  | None, Some references -> Property references
  | None, None -> Object { object_id = None; source_name = name; source_layer = None }

let layers (declarations : Source_declarations.t) selection =
  references selection
  |> List.filter_map (fun reference ->
      if
        reference.object_id <> None
        || Names.mem reference.source_name declarations.actuals
      then Some (reference_layer reference)
      else None)
  |> Int_set.of_list

let membership (declarations : Source_declarations.t) name =
  Option.value ~default:[] (Names.find_opt name declarations.memberships)

let matching declarations name =
  let selected = selection declarations name in
  let layer =
    match references selected with [] -> None | reference :: _ -> reference.source_layer
  in
  let members =
    membership declarations name
    |> List.filter_map (fun reference ->
        Option.map (fun _ -> { reference with source_layer = layer }) reference.object_id)
  in
  match (selected, members) with
  | Object _, [ reference ] -> Object reference
  | Object _, _ -> Aggregate members
  | Property _, _ -> Property members
  | Aggregate _, _ -> Aggregate members
