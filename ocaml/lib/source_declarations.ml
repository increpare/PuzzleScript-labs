open Domain
open Syntax

type t = {
  definitions : object_definition Frozen_array.t;
  namespace : name Names.t;
  actuals : object_reference Names.t;
  properties : object_reference list Names.t;
  property_layers : int option Names.t;
  compiled_names : Compiled_names.t;
  memberships : object_reference list Names.t;
  win_names : name Names.t;
  player : name;
  glyphs : int list Names.t;
  collision : Int_set.t Frozen_array.t;
  glyph_diagnostics : diagnostic list;
  name_diagnostics : diagnostic list;
  unlayered : diagnostic list;
}

exception Invalid of diagnostic
exception Invalid_names of diagnostic list

let compile (document : document) =
  try
    let primaries =
      List.fold_left
        (fun names declaration -> Names.add declaration.object_name declaration names)
        Names.empty document.objects
    in
    let aliases = List.concat_map object_legend_aliases document.objects in
    let ordered_legend =
      List.stable_sort
        (fun left right -> compare left.legend_line right.legend_line)
        (aliases @ document.legend)
    in
    let source_registry =
      Source_legend.of_declarations document.objects document.legend
    in
    let layer_names = List.map (fun layer -> layer.occupants) document.collision_layers in
    if layer_names = [] then
      raise
        (Invalid
           {
             location = None;
             severity = Error_severity;
             message =
               "No collision layers defined.  All objects need to be in collision layers.";
           });
    let assignments, ordered =
      List.fold_left
        (fun (assignments, ordered) (layer, names) ->
          List.fold_left
            (fun (assignments, ordered) name ->
              (Names.add name layer assignments, name :: ordered))
            (assignments, ordered) names)
        (Names.empty, [])
        (List.mapi (fun index names -> (index, names)) layer_names)
    in
    let definitions =
      List.rev ordered
      |> List.mapi (fun id name ->
          let declaration = Names.find name primaries in
          {
            id;
            name;
            layer = Names.find name assignments;
            colors = declaration.colors;
            sprite = declaration.sprite;
          })
      |> Frozen_array.of_list
    in
    let ids =
      Frozen_array.fold_left
        (fun names definition -> Names.add definition.name definition.id names)
        Names.empty definitions
    in
    let reference name =
      {
        object_id =
          (if Names.mem name primaries && Frozen_array.length definitions > 0 then
             Some (Option.value ~default:0 (Names.find_opt name ids))
           else None);
        source_name = name;
        source_layer = Names.find_opt name assignments;
      }
    in
    (* Matching membership is registered once in source order. Final property
     alternatives may resolve a forward alias that was unavailable here. *)
    let memberships =
      Names.fold
        (fun name _ known -> Names.add name [ reference name ] known)
        primaries Names.empty
    in
    let entries =
      aliases
      @ List.filter
          (fun declaration ->
            match declaration.expression with Constituents _ -> false | _ -> true)
          document.legend
      |> List.stable_sort (fun left right -> compare left.legend_line right.legend_line)
    in
    let memberships =
      List.fold_left
        (fun known declaration ->
          let copy target =
            match Names.find_opt target known with
            | None -> known
            | Some refs -> Names.add declaration.legend_name refs known
          in
          match declaration.expression with
          | Alias target | Alternatives [ target ] -> copy target
          | Alternatives members ->
              let refs =
                List.concat_map
                  (fun member -> Option.value ~default:[] (Names.find_opt member known))
                  members
                |> List.sort_uniq (fun left right ->
                    compare left.object_id right.object_id)
              in
              Names.add declaration.legend_name refs known
          | Constituents _ -> known)
        memberships entries
    in
    let initial_glyphs =
      Names.fold
        (fun name _ known ->
          Names.add name
            (match Names.find_opt name ids with None -> [] | Some id -> [ id ])
            known)
        primaries Names.empty
    in
    let glyph_diagnostics = ref [] in
    let glyph_error line message =
      glyph_diagnostics :=
        { location = Some { line; column = 1 }; severity = Error_severity; message }
        :: !glyph_diagnostics
    in
    let glyph_aliases =
      List.filter_map
        (fun declaration ->
          match declaration.expression with
          | Alias target -> Some (declaration.legend_name, target)
          | _ -> None)
        ordered_legend
    in
    let aggregates =
      List.filter_map
        (fun declaration ->
          match declaration.expression with
          | Constituents names -> Some (declaration, names)
          | _ -> None)
        document.legend
    in
    let rec glyphs known =
      let before = Names.cardinal known in
      let known =
        List.fold_left
          (fun known (name, target) ->
            if Names.mem name known then known
            else
              match Names.find_opt target known with
              | None -> known
              | Some ids -> Names.add name ids known)
          known glyph_aliases
      in
      let expanded =
        List.fold_left
          (fun known (declaration, names) ->
            if
              Names.mem declaration.legend_name known
              || not (List.for_all (fun name -> Names.mem name known) names)
            then known
            else
              let rec source_members seen name =
                if List.mem name seen then []
                else
                  match Source_legend.lookup source_registry name with
                  | Source_legend.Object_name name | Undeclared_name name -> [ name ]
                  | Property_name (name, values) | Aggregate_name (name, values) ->
                      List.concat_map (source_members (name :: seen)) values
              in
              let sources = List.concat_map (source_members []) names in
              let occupants =
                List.fold_left
                  (fun by_layer name ->
                    match Names.find_opt name assignments with
                    | None ->
                        glyph_error declaration.legend_line
                          ("Object \"" ^ Utf8.uppercase name
                         ^ "\" has been defined, but not assigned to a layer.");
                        by_layer
                    | Some layer -> (
                        match Int_map.find_opt layer by_layer with
                        | None -> Int_map.add layer name by_layer
                        | Some previous ->
                            glyph_error declaration.legend_line
                              ("Trying to create an aggregate object (something defined \
                                in the LEGEND section using AND) with both \""
                             ^ Utf8.uppercase name ^ "\" and \"" ^ Utf8.uppercase previous
                             ^ "\", which are on the same layer and therefore can't \
                                coexist.");
                            by_layer))
                  Int_map.empty sources
              in
              Names.add declaration.legend_name
                (Int_map.bindings occupants
                |> List.map (fun (_, name) -> Names.find name ids))
                known)
          known aggregates
      in
      if Names.cardinal expanded = before then expanded else glyphs expanded
    in
    let glyphs = glyphs initial_glyphs in
    let compiled_names, name_diagnostics =
      match Compiled_names.compile ordered_legend with
      | Ok result -> result
      | Error issues -> raise (Invalid_names issues)
    in
    let actuals =
      Names.map (fun declaration -> reference declaration.object_name) primaries
    in
    let properties =
      List.fold_left
        (fun names name ->
          match Compiled_names.property compiled_names name with
          | None -> names
          | Some members -> Names.add name (List.map reference members) names)
        Names.empty
        (Compiled_names.names compiled_names)
    in
    let property_layers =
      Names.fold
        (fun name refs known ->
          match refs with
          | first :: _
            when List.for_all
                   (fun reference ->
                     reference.object_id <> None
                     && reference.source_layer = first.source_layer)
                   refs ->
              Names.add name first.source_layer known
          | _ -> known)
        properties Names.empty
    in
    let namespace = Names.map (fun reference -> Object reference) actuals in
    let namespace =
      List.fold_left
        (fun known name ->
          let selection =
            match
              ( Compiled_names.aggregate compiled_names name,
                Compiled_names.alias compiled_names name,
                Names.find_opt name properties )
            with
            | Some members, _, _ -> Aggregate (List.map reference members)
            | None, Some target, _ -> Object (reference target)
            | None, None, Some members -> Property members
            | None, None, None -> Object (reference name)
          in
          Names.add name selection known)
        namespace
        (Compiled_names.names compiled_names)
    in
    let union refs =
      List.filter (fun reference -> reference.object_id <> None) refs
      |> List.sort_uniq (fun left right -> compare left.object_id right.object_id)
    in
    let win_names = Names.map (fun refs -> Property refs) memberships in
    let win_names =
      List.fold_left
        (fun known name ->
          if Names.mem name known then known
          else
            match Compiled_names.aggregate compiled_names name with
            | None -> known
            | Some names ->
                Names.add name
                  (Aggregate
                     (List.concat_map
                        (fun name ->
                          Option.value ~default:[] (Names.find_opt name memberships))
                        names
                     |> union))
                  known)
        win_names
        (Compiled_names.names compiled_names)
    in
    let player_members =
      Option.to_list (Names.find_opt "player" actuals)
      @ List.concat_map
          (fun name -> Option.to_list (Names.find_opt name actuals))
          (Option.value ~default:[] (Compiled_names.aggregate compiled_names "player")
          @ Option.value ~default:[] (Compiled_names.property compiled_names "player")
          @ Option.to_list (Compiled_names.alias compiled_names "player"))
      |> union
    in
    let player =
      if Compiled_names.aggregate compiled_names "player" <> None then
        Aggregate player_members
      else Property player_members
    in
    let unlayered =
      List.filter_map
        (fun declaration ->
          let name = declaration.object_name in
          if Names.mem name assignments then None
          else
            Some
              {
                location = Some { line = declaration.object_line; column = 1 };
                severity = Error_severity;
                message =
                  "Object \"" ^ Utf8.uppercase name
                  ^ "\" has been defined, but not assigned to a layer.";
              })
        (Source_assets.dictionary_order document.objects)
    in
    Ok
      {
        definitions;
        namespace;
        actuals;
        properties;
        property_layers;
        compiled_names;
        memberships;
        win_names;
        player;
        glyphs;
        collision =
          Frozen_array.of_list
            (List.mapi
               (fun layer names ->
                 List.map (fun name -> Names.find name ids) names
                 |> List.filter (fun id ->
                     (Frozen_array.get definitions id).layer = layer)
                 |> Int_set.of_list)
               layer_names);
        glyph_diagnostics = Diagnostics.normalize (List.rev !glyph_diagnostics);
        name_diagnostics;
        unlayered;
      }
  with
  | Invalid diagnostic -> Error [ diagnostic ]
  | Invalid_names issues -> Error (Diagnostics.normalize issues)
