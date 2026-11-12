open Syntax

exception Limit

type pending = {
  earlier : collision_layer list;
  current : collision_layer option;
  mentioned : unit Domain.Names.t;
  background : bool;
}

let read_line ?(diagnostics_before = 0) ~registry ~previous ~errors_before
    (input : Source_line.t) =
  let line = input.number in
  let earlier, current =
    match List.rev previous with
    | [] -> ([], None)
    | current :: rest -> (List.rev rest, Some current)
  in
  let initial =
    { earlier; current; mentioned = Domain.Names.empty; background = false }
  in
  let diagnostics = ref [] in
  let emit severity message =
    diagnostics :=
      Diagnostics.normalize
        (!diagnostics @ [ { location = Some { line; column = 1 }; severity; message } ]);
    if diagnostics_before + List.length !diagnostics > 100 then raise Limit
  in
  let check () =
    if
      errors_before + Diagnostics.error_count !diagnostics > 5
      || diagnostics_before + List.length !diagnostics > 100
    then raise Limit
  in
  let issue = emit Error_severity and warn = emit Warning_severity in
  let select name =
    let rec visit seen target =
      match Source_legend.lookup registry target with
      | Object_name target -> [ target ]
      | Aggregate_name (target, _) ->
          issue
            ("\"" ^ target
           ^ "\" is an aggregate (defined using \"and\"), and cannot be added to a \
              single layer because its constituent objects must be able to coexist.");
          []
      | Property_name (target, members) ->
          if List.mem target seen then []
          else
            List.filter (fun member -> member <> target) members
            |> List.concat_map (visit (target :: seen))
      | Undeclared_name _ ->
          issue
            ("Cannot add \"" ^ Utf8.uppercase name
           ^ "\" to a collision layer; it has not been declared.");
          []
    in
    visit [] name
  in
  let add_name state name =
    let occupants =
      Option.fold ~none:[] ~some:(fun layer -> layer.occupants) state.current
    in
    if
      (name = "background" && occupants <> [])
      || (name <> "background" && state.background)
    then issue "Background must be in a layer by itself.";
    let state = { state with background = state.background || name = "background" } in
    let selected = select name in
    match state.current with
    | None ->
        issue "no layers found.";
        state
    | Some layer ->
        let other_layers =
          List.concat_map
            (fun target ->
              List.mapi (fun index layer -> (index, layer)) state.earlier
              |> List.filter_map (fun (index, layer) ->
                  if List.mem target layer.occupants then Some (index + 1) else None))
            selected
        in
        if other_layers <> [] then
          warn
            ("Object \"" ^ Utf8.uppercase name
           ^ "\" included in multiple collision layers ( layers "
            ^ String.concat ", "
                (List.map
                   (fun index -> "#" ^ string_of_int index)
                   (other_layers @ [ List.length state.earlier + 1 ]))
            ^ " ). You should fix this! (The compiler will just pick one layer to assign \
               it to).");
        if Domain.Names.mem name state.mentioned then
          warn
            ("Object \"" ^ Utf8.uppercase name
           ^ "\" included explicitly multiple times in the same layer. Don't do that \
              innit.");
        {
          state with
          mentioned = Domain.Names.add name () state.mentioned;
          current =
            Some
              {
                layer with
                source_names = layer.source_names @ [ name ];
                occupants = occupants @ selected;
              };
        }
  in
  let rec read state beginning depth text =
    let text = Source_line.left_trim text in
    if text = "" then (state, depth)
    else if depth > 0 || text.[0] = '(' then
      let depth, rest = Source_line.comment depth text in
      read state beginning depth rest
    else if text.[0] = ')' then (
      warn Source_line.close_warning;
      check ();
      read state false 0 (Source_line.drop 1 text))
    else
      let text =
        match Source_sections.heading_prefix text with
        | None -> text
        | Some (_, ending) -> Source_line.drop ending text
      in
      if text = "" then (state, 0)
      else
        let state =
          if beginning then
            {
              earlier = previous;
              current = Some { layer_line = line; source_names = []; occupants = [] };
              mentioned = Domain.Names.empty;
              background = false;
            }
          else state
        in
        let name, rest = Utf8.identifier_prefix text in
        if name = "" then (
          let separators, rest = Utf8.span (fun cp -> cp = 32 || cp = 44) text in
          if separators <> "" then read state false 0 rest
          else
            match Utf8.scalars text with
            | [] -> (state, 0)
            | (_, ch) :: _ ->
                (* Unexpected characters are separate legacy UTF-16 visits, even
               when a valid UTF-8 scalar encodes a surrogate pair. *)
                List.iter
                  (fun unit ->
                    issue
                      ("error detected - unexpected character "
                     ^ Code_unit.single_text unit);
                    check ())
                  (Code_unit.of_utf8 ch);
                read state false 0 (Source_line.drop (String.length ch) text))
        else
          let state = add_name state name in
          check ();
          read state false 0 rest
  in
  try
    let state, comment_depth =
      read initial true input.comment_depth (Utf8.lowercase input.raw)
    in
    let layers = state.earlier @ Option.to_list state.current in
    Ok Source_line.{ value = layers; comment_depth; diagnostics = !diagnostics }
  with Limit -> Error !diagnostics
