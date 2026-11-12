open Syntax
module Glyphs = Set.Make (String)

type source_line = { number : int; raw : string; comment_depth : int }

type grid_builder =
  | Between_levels
  | Building_grid of { width : int; latest : level_row; earlier_rev : level_row list }

type state = { levels_rev : raw_level list; grid : grid_builder; depth : int }
type line_phase = At_start | Checking_row | Ignoring_tail

exception Limit

let flush state =
  match state.grid with
  | Between_levels -> state
  | Building_grid { latest; earlier_rev; _ } ->
      {
        state with
        grid = Between_levels;
        levels_rev = Grid (List.rev (latest :: earlier_rev)) :: state.levels_rev;
      }

let add_row ~emit number glyphs state =
  let row = { level_line = number; glyphs } in
  let length = List.length glyphs in
  let grid =
    match state.grid with
    | Between_levels -> Building_grid { width = length; latest = row; earlier_rev = [] }
    | Building_grid { width; latest; earlier_rev } ->
        if width <> length then
          emit number Warning_severity
            "Maps must be rectangular, yo (In a level, the length of each row must be \
             the same).";
        Building_grid { width; latest = row; earlier_rev = latest :: earlier_rev }
  in
  { state with grid }

let read ?(diagnostics_before = 0) ~known_glyphs ~errors_before lines =
  let known_glyphs = Glyphs.of_list known_glyphs in
  let diagnostics = ref [] in
  let emit line severity message =
    diagnostics :=
      Diagnostics.normalize
        (!diagnostics @ [ { location = Some { line; column = 1 }; severity; message } ]);
    if
      errors_before + Diagnostics.error_count !diagnostics > 5
      || diagnostics_before + List.length !diagnostics > 100
    then raise Limit
  in
  let close_warning number = emit number Warning_severity Source_line.close_warning in
  let capture state { number; raw; comment_depth = _ } =
    if state.depth = 0 && Utf8.trim raw = "" then flush state
    else
      let units = Array.of_list (Code_unit.of_utf8 (Utf8.lowercase raw)) in
      let original = Array.of_list (Code_unit.of_utf8 raw) in
      let length = Array.length units in
      let code index = Code_unit.value units.(index) in
      let rec spaces index =
        if index < length && Code_unit.whitespace units.(index) then spaces (index + 1)
        else index
      in
      let prefix index =
        let rec ending current =
          if current < length && code current <> 40 then ending (current + 1) else current
        in
        Array.to_list (Array.sub units index (ending index - index)) |> Code_unit.trim
      in
      let word index word =
        index + String.length word <= length
        &&
        let rec equal offset =
          offset = String.length word
          || (code (index + offset) = Char.code word.[offset] && equal (offset + 1))
        in
        equal 0
      in
      let rec only_equals index =
        index = length
        || (code index = 61 || Code_unit.whitespace units.(index))
           && only_equals (index + 1)
      in
      let rec comment depth index =
        if index >= length then (depth, index)
        else
          let depth =
            match code index with 40 -> depth + 1 | 41 -> depth - 1 | _ -> depth
          in
          if depth = 0 then (depth, index + 1) else comment depth (index + 1)
      in
      let message index state =
        let payload = spaces (index + 7) in
        if
          index + 7 < length
          &&
          let cp = code (index + 7) in
          (cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57) || cp = 95
        then
          emit number Warning_severity
            "You probably meant to put a space after 'message' innit.  That's ok, I'll \
             still interpret it as a message, but you probably want to put a space \
             there.";
        if payload < length && code payload = 41 then close_warning number;
        let payload = min payload (Array.length original) in
        let message_units =
          Array.to_list (Array.sub original payload (Array.length original - payload))
          |> Code_unit.trim
        in
        let state = flush state in
        {
          state with
          levels_rev =
            Level_text { message_line = number; message_units } :: state.levels_rev;
          depth = 0;
        }
      in
      let rec visit phase depth index state =
        let index = if depth = 0 then spaces index else index in
        if index >= length then { state with depth }
        else if depth > 0 then
          let depth, next = comment depth index in
          visit phase depth next state
        else
          match code index with
          | 40 -> visit phase 1 (index + 1) state
          | 41 ->
              close_warning number;
              let phase = match phase with At_start -> Ignoring_tail | phase -> phase in
              visit phase 0 (index + 1) state
          | _ -> (
              match phase with
              | At_start when code index = 61 && only_equals index ->
                  { state with depth = 0 }
              | At_start when word index "message" -> message index state
              | At_start ->
                  let state = add_row ~emit number (prefix index) state in
                  visit Checking_row 0 index state
              | Checking_row ->
                  if not (Glyphs.mem (Code_unit.single_text units.(index)) known_glyphs)
                  then
                    emit number Error_severity
                      ("Key \""
                      ^ Code_unit.uppercase_text units.(index)
                      ^ "\" not found. Do you need to add it to the legend, or define a \
                         new object?");
                  visit Checking_row 0 (index + 1) state
              | Ignoring_tail -> visit Ignoring_tail 0 (index + 1) state)
      in
      visit At_start state.depth 0 state
  in
  let depth = match lines with [] -> 0 | first :: _ -> first.comment_depth in
  let initial = { levels_rev = []; grid = Between_levels; depth } in
  try
    let state = List.fold_left capture initial lines |> flush in
    Ok (List.rev state.levels_rev, !diagnostics)
  with Limit -> Error !diagnostics
