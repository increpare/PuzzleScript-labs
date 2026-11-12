type t = int

let of_utf8 = Utf8.utf16
let value unit = unit
let surrogate unit = unit >= 0xd800 && unit <= 0xdfff
let whitespace unit = (not (surrogate unit)) && Utf8.whitespace unit

let trim units =
  let rec drop = function
    | unit :: rest when whitespace unit -> drop rest
    | rest -> rest
  in
  drop units |> List.rev |> drop |> List.rev

let text units =
  let out = Buffer.create (List.length units) in
  let rec add = function
    | [] -> Buffer.contents out
    | high :: low :: rest
      when high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ->
        Buffer.add_utf_8_uchar out
          (Uchar.of_int (0x10000 + ((high - 0xd800) lsl 10) + low - 0xdc00));
        add rest
    | unit :: rest ->
        if surrogate unit then (
          Buffer.add_char out (Char.chr (0xe0 lor (unit lsr 12)));
          Buffer.add_char out (Char.chr (0x80 lor ((unit lsr 6) land 63)));
          Buffer.add_char out (Char.chr (0x80 lor (unit land 63))))
        else Buffer.add_utf_8_uchar out (Uchar.of_int unit);
        add rest
  in
  add units

let single_text unit = text [ unit ]

let uppercase_text unit =
  if surrogate unit then single_text unit else Utf8.uppercase (single_text unit)
