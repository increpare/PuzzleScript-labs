open Syntax

let qualifiers = Qualifier.keywords

let headers =
  [
    "up"; "down"; "left"; "right"; "horizontal"; "vertical"; "orthogonal"; "late"; "rigid";
  ]

let command = Rule_parser.command

exception Limit

type live_phase = Prelude | Pattern | Literal_message
type pending = { captured : captured_rule option; phase : live_phase }

let read_line ?(diagnostics_before = 0) ~known_names ~errors_before
    (input : Source_line.t) =
  let number = input.number and normalized = Utf8.lowercase input.raw in
  let diagnostics = ref [] in
  let report severity message =
    diagnostics :=
      Diagnostics.normalize
        (!diagnostics
        @ [ { location = Some { line = number; column = 1 }; severity; message } ]);
    if diagnostics_before + List.length !diagnostics > 100 then raise Limit
  in
  let check () =
    if
      errors_before + Diagnostics.error_count !diagnostics > 5
      || diagnostics_before + List.length !diagnostics > 100
    then raise Limit
  in
  let capture text =
    let captured_text = fst (Source_line.before_comment text) in
    let original_text =
      Source_line.original_suffix
        ~normalized_offset:(String.length normalized - String.length text)
        input.raw
    in
    { captured_line = number; captured_text; original_text }
  in
  let rec read state beginning depth text =
    let text = Source_line.left_trim text in
    if text = "" then (state, depth)
    else if depth > 0 || (text.[0] = '(' && state.phase <> Literal_message) then
      let depth, rest = Source_line.comment depth text in
      if state.captured <> None && depth = 0 then (state, 0)
      else read state beginning depth rest
    else if text.[0] = ')' then (
      report Warning_severity Source_line.close_warning;
      check ();
      read state false 0 (Source_line.drop 1 text))
    else
      (* Heading recognition happens during this visit, after its first
         character was observed. Punctuation exposed by that consumption is
         therefore a word until the next visit; arrows use the current text. *)
      let first_character = text.[0] in
      let text =
        match Source_sections.heading_prefix text with
        | None -> text
        | Some (_, ending) -> Source_line.drop ending text
      in
      if text = "" then (state, 0)
      else
        let state =
          if beginning then { captured = Some (capture text); phase = Prelude } else state
        in
        if state.phase = Literal_message then (state, 0)
        else if String.starts_with ~prefix:"->" text then
          read state false 0 (Source_line.drop 2 text)
        else if List.mem first_character [ '['; ']'; '|'; '+' ] then
          let state =
            if first_character = '+' then state else { state with phase = Pattern }
          in
          read state false 0 (Source_line.drop 1 text)
        else
          let word, rest =
            Utf8.span
              (fun cp -> (not (Utf8.whitespace cp)) && not (List.mem cp [ 91; 93; 124 ]))
              text
          in
          let known = List.mem word known_names in
          if
            (state.phase = Prelude && List.mem word (headers @ [ "startloop"; "endloop" ]))
            || (state.phase = Pattern && List.mem word qualifiers)
          then ()
          else if known then (
            if beginning then
              report Error_severity
                "Objects cannot appear outside of square brackets in rules, only \
                 directions can.")
          else if
            word = "..." || word = "rigid" || word = "random" || command word <> None
          then ()
          else
            report Error_severity
              ("Name \"" ^ word ^ "\", referred to in a rule, does not exist.");
          check ();
          let state =
            if (not known) && command word = Some (Domain.Message "") then
              { state with phase = Literal_message }
            else state
          in
          read state false 0 rest
  in
  try
    let state, comment_depth =
      read { captured = None; phase = Prelude } true input.comment_depth normalized
    in
    Ok
      Source_line.
        {
          value =
            List.map
              (fun captured -> Captured_rule captured)
              (Option.to_list state.captured);
          comment_depth;
          diagnostics = !diagnostics;
        }
  with Limit -> Error !diagnostics

type compilation = Rule_parser.compilation = {
  entries : rule_entry list;
  diagnostics : diagnostic list;
  invalid_shapes : bool;
}

let compile = Rule_parser.compile
