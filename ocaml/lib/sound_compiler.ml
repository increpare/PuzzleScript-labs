open Domain
open Syntax

let compile ~report ~warn (declarations : Source_declarations.t) entries =
  let sound_warning = warn in
  let rec sound_targets seen name =
    if List.mem name seen then []
    else
      match
        ( Compiled_names.alias declarations.compiled_names name,
          Compiled_names.property declarations.compiled_names name )
      with
      | Some target, _ -> sound_targets (name :: seen) target
      | None, Some members -> List.concat_map (sound_targets (name :: seen)) members
      | None, None -> Option.to_list (Names.find_opt name declarations.actuals)
  in
  List.fold_left
    (fun compiled -> function
      | Incomplete_sound { sound_line; _ } ->
          sound_warning sound_line "incorrect sound declaration.";
          compiled
      | Event_sound { sound_line; sound_event; event_seed } ->
          let event = sound_event in
          if List.exists (fun definition -> definition.trigger = Simple event) compiled
          then
            sound_warning sound_line
              (Utf8.uppercase (Source_sounds.event_name event) ^ " already declared.");
          List.filter (fun definition -> definition.trigger <> Simple event) compiled
          @ [
              {
                selection = None;
                trigger = Simple event;
                directions = Movements.empty;
                seed = event_seed;
              };
            ]
      | Object_sound
          { sound_line; sound_target; sound_verb; sound_directions; object_seed } ->
          let seed =
            match object_seed with
            | Numeric_seed seed -> seed
            | Recovered_seed seed ->
                report sound_line ("Expecting sfx data, instead found \"" ^ seed ^ "\".");
                seed
          in
          if Compiled_names.aggregate declarations.compiled_names sound_target <> None
          then (
            report sound_line
              ("cannot assign sound events to aggregate objects (declared with \"and\"), \
                only to regular objects, or properties, things defined in terms of \
                \"or\" (\"" ^ sound_target ^ "\").");
            compiled)
          else (
            if not (Names.mem sound_target declarations.memberships) then
              report sound_line ("Object \"" ^ sound_target ^ "\" not found.");
            let trigger =
              match sound_verb with
              | Move_sound | Action_sound -> On_move
              | Failure_sound -> On_failure
              | Create_sound -> On_create
              | Destroy_sound -> On_destroy
            in
            let selection =
              match trigger with
              | On_move | On_failure -> Property (sound_targets [] sound_target)
              | On_create | On_destroy ->
                  Property
                    (Option.value ~default:[]
                       (Names.find_opt sound_target declarations.memberships))
              | Simple _ -> assert false
            in
            compiled
            @ [
                {
                  selection = Some selection;
                  trigger;
                  directions = sound_directions;
                  seed;
                };
              ]))
    [] entries
