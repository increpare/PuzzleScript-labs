open Syntax

type phase = Quantifier | Subject | On | Target | Excess

exception Limit

let read_line ?(diagnostics_before = 0) ~known_names ~errors_before
    (input : Source_line.t) =
  let line = input.number in
  let diagnostics = ref [] in
  let report severity message =
    diagnostics :=
      Diagnostics.normalize
        (!diagnostics @ [ { location = Some { line; column = 1 }; severity; message } ]);
    if diagnostics_before + List.length !diagnostics > 100 then raise Limit
  in
  let check_limit () =
    if
      errors_before + Diagnostics.error_count !diagnostics > 5
      || diagnostics_before + List.length !diagnostics > 100
    then raise Limit
  in
  (* Compilation consumes the captured words, even when token highlighting
     rejects a later punctuation mark or a separator. Keep that view explicit. *)
  let capture text =
    match Utf8.words (fst (Source_line.before_comment text)) with
    | quantifier :: subject :: rest ->
        let win_quantifier =
          match quantifier with "all" -> Domain.For_all | "no" -> No | _ -> Exists
        in
        let win_target =
          match rest with [ _separator; target ] -> Some target | _ -> None
        in
        Win_condition
          { win_line = line; win_quantifier; win_subject = subject; win_target }
    | _ -> Incomplete_win line
  in
  let advance = function
    | Quantifier -> Subject
    | Subject -> On
    | On -> Target
    | Target | Excess -> Excess
  in
  let rec validate captured beginning phase depth text =
    let text = Source_line.left_trim text in
    if text = "" then (captured, depth)
    else if depth > 0 || text.[0] = '(' then
      let depth, rest = Source_line.comment depth text in
      if captured <> None && depth = 0 then (captured, 0)
      else validate captured beginning phase depth rest
    else if text.[0] = ')' then (
      report Warning_severity Source_line.close_warning;
      check_limit ();
      validate captured false phase 0 (Source_line.drop 1 text))
    else
      let text =
        match Source_sections.heading_prefix text with
        | None -> text
        | Some (_, ending) -> Source_line.drop ending text
      in
      if text = "" then (captured, 0)
      else
        let captured, phase =
          if beginning then (Some (capture text), Quantifier) else (captured, phase)
        in
        let word, rest = Utf8.identifier_prefix text in
        let rest =
          if word = "" then (
            report Error_severity "incorrect format of win condition.";
            snd (Source_line.before_comment text))
          else (
            (match phase with
            | Quantifier when not (List.mem word [ "all"; "any"; "no"; "some" ]) ->
                report Error_severity
                  ("Expecting the start of a win condition (\"ALL\",\"SOME\",\"NO\") but \
                    got \"" ^ Utf8.uppercase word ^ "'.")
            | On when word <> "on" ->
                report Error_severity
                  ("Expecting the word \"ON\" but got \"" ^ Utf8.uppercase word ^ "\".")
            | (Subject | Target) when not (List.mem word known_names) ->
                report Error_severity
                  ("Error in win condition: \"" ^ Utf8.uppercase word
                 ^ "\" is not a valid object name.")
            | Excess ->
                report Error_severity
                  ("Error in win condition: I don't know what to do with "
                 ^ Utf8.uppercase word ^ ".")
            | _ -> ());
            rest)
        in
        check_limit ();
        validate captured false (advance phase) 0 rest
  in
  try
    let captured, comment_depth =
      validate None true Subject input.comment_depth (Utf8.lowercase input.raw)
    in
    Ok
      Source_line.
        { value = Option.to_list captured; comment_depth; diagnostics = !diagnostics }
  with Limit -> Error !diagnostics
