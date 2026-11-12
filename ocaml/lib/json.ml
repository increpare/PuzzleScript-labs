(* Output-only JSON: the executable takes PuzzleScript source directly. *)
type t =
  | Null
  | Bool of bool
  | Int of int
  | Float of float
  | String of string
  | Array of t list
  | Object of (string * t) list

let escape text =
  let out = Buffer.create (String.length text + 2) in
  Buffer.add_char out '"';
  let rec visit index =
    if index < String.length text then
      let ch = text.[index] in
      if
        Char.code ch = 0xed
        && index + 2 < String.length text
        && Char.code text.[index + 1] >= 0xa0
        && Char.code text.[index + 1] <= 0xbf
        && Char.code text.[index + 2] land 0xc0 = 0x80
      then (
        (* A legacy diagnostic may contain one isolated UTF-16 unit. Keep it
         lossless without emitting invalid UTF-8 into the JSON document. *)
        let unit =
          ((Char.code ch land 15) lsl 12)
          lor ((Char.code text.[index + 1] land 63) lsl 6)
          lor (Char.code text.[index + 2] land 63)
        in
        Buffer.add_string out (Printf.sprintf "\\u%04x" unit);
        visit (index + 3))
      else (
        (match ch with
        | '"' -> Buffer.add_string out "\\\""
        | '\\' -> Buffer.add_string out "\\\\"
        | '\n' -> Buffer.add_string out "\\n"
        | '\r' -> Buffer.add_string out "\\r"
        | '\t' -> Buffer.add_string out "\\t"
        | ch when Char.code ch < 32 ->
            Buffer.add_string out (Printf.sprintf "\\u%04x" (Char.code ch))
        | ch -> Buffer.add_char out ch);
        visit (index + 1))
  in
  visit 0;
  Buffer.add_char out '"';
  Buffer.contents out

let rec to_string = function
  | Null -> "null"
  | Bool value -> string_of_bool value
  | Int value -> string_of_int value
  | Float value -> if Float.is_finite value then Printf.sprintf "%.17g" value else "null"
  | String text -> escape text
  | Array values -> "[" ^ String.concat "," (List.map to_string values) ^ "]"
  | Object fields ->
      "{"
      ^ String.concat ","
          (List.map (fun (key, value) -> escape key ^ ":" ^ to_string value) fields)
      ^ "}"
