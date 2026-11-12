open Syntax

type section = Metadata | Objects | Legend | Sounds | Layers | Rules | Wins | Levels
type t = { section : section; depth : int; visited : section list }
type event = Header of section | Content of Source_line.t | Blank | Separator | Ignored

let initial = { section = Metadata; depth = 0; visited = [] }
let section state = state.section
let comment_depth state = state.depth
let with_comment_depth depth state = { state with depth }

let headings =
  [
    (Objects, "objects");
    (Legend, "legend");
    (Sounds, "sounds");
    (Layers, "collisionlayers");
    (Rules, "rules");
    (Wins, "winconditions");
    (Levels, "levels");
  ]

let spelling section = List.assoc section headings |> String.uppercase_ascii

let heading_prefix text =
  let suffix = String.lowercase_ascii text in
  List.find_map
    (fun (section, name) ->
      if not (String.starts_with ~prefix:name suffix) then None
      else
        let ending = String.length name in
        let boundary =
          ending = String.length text
          ||
          match Utf8.scalars (String.sub text ending (String.length text - ending)) with
          | (cp, _) :: _ -> not (Utf8.identifier_character cp)
          | [] -> true
        in
        if not boundary then None
        else
          let spaces, _ =
            Utf8.span Utf8.whitespace
              (String.sub text ending (String.length text - ending))
          in
          Some (section, ending + String.length spaces))
    headings

exception Cutoff

let line ~errors_before ~diagnostics_before state ~number raw =
  let depth = ref state.depth and diagnostics = ref [] in
  let issue ?(column = 1) severity message =
    diagnostics :=
      Diagnostics.normalize
        (!diagnostics
        @ [ { location = Some { line = number; column }; severity; message } ]);
    if diagnostics_before + List.length !diagnostics > 100 then raise Cutoff
  in
  let close_warning column =
    issue ~column Warning_severity
      "You're trying to close a comment here, but I can't find any opening bracket to \
       match it? [This is highly suspicious; you probably want to fix it.]"
  in
  let length = String.length raw in
  let spaces index =
    let leading, _ = Utf8.span Utf8.whitespace (String.sub raw index (length - index)) in
    index + String.length leading
  in
  let rec comment index =
    if index >= length then index
    else (
      if raw.[index] = '(' then incr depth else if raw.[index] = ')' then decr depth;
      if !depth = 0 then index + 1 else comment (index + 1))
  in
  let rec leading starts_line index =
    let index = if !depth = 0 then spaces index else index in
    if index = length then (starts_line, index)
    else if !depth > 0 then leading starts_line (comment index)
    else
      match raw.[index] with
      | '(' ->
          incr depth;
          leading starts_line (comment (index + 1))
      | ')' -> leading false (index + 1)
      | _ -> (starts_line, index)
  in
  try
    let starts_line, start = leading true 0 in
    let header =
      if state.section = Levels || start = length then None
      else
        Option.map
          (fun (section, ending) -> (section, start + ending))
          (heading_prefix (String.sub raw start (length - start)))
    in
    let rec ending reason index =
      let index = if !depth = 0 then spaces index else index in
      if
        errors_before + Diagnostics.error_count (Diagnostics.normalize !diagnostics) <= 5
        && diagnostics_before + List.length (Diagnostics.normalize !diagnostics) <= 100
        && index < length
      then
        if !depth > 0 then ending reason (comment index)
        else
          match raw.[index] with
          | '(' ->
              incr depth;
              ending reason (comment (index + 1))
          | ')' ->
              close_warning (index + 1);
              ending reason (index + 1)
          | _ ->
              issue Error_severity
                ("Only comments should go after " ^ reason ^ " on a line.")
    in
    let state, event =
      match header with
      | Some (section, after) when starts_line ->
          if List.mem section state.visited then
            issue Error_severity
              ("cannot duplicate sections (you tried to duplicate \"" ^ spelling section
             ^ "\").");
          let previous =
            let rec find previous = function
              | [] -> None
              | (candidate, _) :: _ when candidate = section -> previous
              | (candidate, _) :: rest -> find (Some candidate) rest
            in
            find None headings
          in
          (match (section, previous) with
          | Objects, _ when state.visited <> [] ->
              issue Error_severity "section \"OBJECTS\" must be the first section"
          | _, Some previous when not (List.mem previous state.visited) ->
              issue Error_severity
                ("section \"" ^ spelling section ^ "\" is out of order, must follow  \""
               ^ spelling previous ^ "\" (or it could be that the section \""
               ^ spelling previous
               ^ "\"is just missing totally.  You have to include all section headings, \
                  even if the section itself is empty).")
          | _ -> ());
          if errors_before + Diagnostics.error_count !diagnostics <= 5 then
            ending ("a section name (\"" ^ spelling section ^ "\")") after;
          ({ state with section; visited = state.visited @ [ section ] }, Header section)
      | None when start = length ->
          (state, if state.depth = 0 && Utf8.trim raw = "" then Blank else Ignored)
      | None when starts_line && raw.[start] = '=' && state.section <> Levels ->
          let rec equals index =
            if index < length && raw.[index] = '=' then equals (index + 1) else index
          in
          ending "a bunch of equals signs ('===')" (equals start);
          (state, Separator)
      | Some _ | None ->
          (state, Content Source_line.{ number; raw; comment_depth = state.depth })
    in
    ({ state with depth = !depth }, event, Diagnostics.normalize !diagnostics)
  with Cutoff ->
    ({ state with depth = !depth }, Ignored, Diagnostics.normalize !diagnostics)
