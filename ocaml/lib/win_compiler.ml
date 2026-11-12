open Domain
open Syntax

let compile ~report (declarations : Source_declarations.t) entries =
  List.filter_map
    (function
      | Win_condition authored -> (
          let line = authored.win_line in
          let lookup name =
            match Names.find_opt name declarations.win_names with
            | Some selection -> Some selection
            | None ->
                report line
                  ("Unwelcome term \"" ^ name
                 ^ "\" found in win condition. I don't know what I'm supposed to do with \
                    this.");
                None
          in
          let subject = lookup authored.win_subject in
          let on =
            match authored.win_target with
            | None -> Some None
            | Some target -> Option.map Option.some (lookup target)
          in
          match (subject, on) with
          | Some subject, Some on ->
              Some { quantifier = authored.win_quantifier; subject; on }
          | _ -> None)
      | Incomplete_win line ->
          report line
            "Win conditions is badly formatted - needs to look something like \"No \
             Fruit\", \"All Target On Crate\", \"Some Fruit\", \"Some Gold on Chest\", \
             \"No Gold on Chest\", or the like.";
          None)
    entries
