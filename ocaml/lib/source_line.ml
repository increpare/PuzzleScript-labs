type t = { number : int; raw : string; comment_depth : int }

type 'a reading = {
  value : 'a;
  comment_depth : int;
  diagnostics : Syntax.diagnostic list;
}

let left_trim text = snd (Utf8.span Utf8.whitespace text)
let drop count text = String.sub text count (String.length text - count)

let before_comment text =
  match String.index_opt text '(' with
  | None -> (text, "")
  | Some index -> (String.sub text 0 index, drop index text)

let comment depth text =
  let rec scan depth index =
    if index = String.length text then (depth, "")
    else
      let depth =
        match text.[index] with '(' -> depth + 1 | ')' -> depth - 1 | _ -> depth
      in
      if depth = 0 then (0, drop (index + 1) text) else scan depth (index + 1)
  in
  scan depth 0

let close_warning =
  "You're trying to close a comment here, but I can't find any opening bracket to match \
   it? [This is highly suspicious; you probably want to fix it.]"

let original_suffix ~normalized_offset raw =
  let rec visit remaining original_offset = function
    | _ when remaining <= 0 -> drop original_offset raw
    | [] -> ""
    | (_, bytes) :: rest ->
        visit
          (remaining - String.length (Utf8.lowercase bytes))
          (original_offset + String.length bytes)
          rest
  in
  visit normalized_offset 0 (Utf8.scalars raw)
