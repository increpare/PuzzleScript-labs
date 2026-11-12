(* Byte offsets stay at the source boundary. Stdlib's immediate UTF decode
   value lets scanners walk scalars without allocating a tuple/string per byte. *)
let decode text offset =
  let decoded = String.get_utf_8_uchar text offset in
  if not (Uchar.utf_decode_is_valid decoded) then invalid_arg "invalid UTF-8 scalar";
  decoded

let iter_scalars visit text =
  let rec loop offset =
    if offset < String.length text then (
      let decoded = decode text offset in
      let width = Uchar.utf_decode_length decoded in
      visit offset (Uchar.to_int (Uchar.utf_decode_uchar decoded)) width;
      loop (offset + width))
  in
  loop 0

let slice text first last =
  if first = 0 && last = String.length text then text
  else String.sub text first (last - first)

let scalars text =
  let reversed = ref [] in
  iter_scalars
    (fun offset cp width -> reversed := (cp, String.sub text offset width) :: !reversed)
    text;
  List.rev !reversed

let characters text =
  let reversed = ref [] in
  iter_scalars
    (fun offset _ width -> reversed := String.sub text offset width :: !reversed)
    text;
  List.rev !reversed

let utf16 text =
  let reversed = ref [] in
  iter_scalars
    (fun _ cp _ ->
      if cp <= 0xffff then reversed := cp :: !reversed
      else
        let n = cp - 0x10000 in
        reversed := (0xdc00 + (n land 0x3ff)) :: (0xd800 + (n lsr 10)) :: !reversed)
    text;
  List.rev !reversed

let compare_utf16 left right = compare (utf16 left) (utf16 right)

(* ASCII property tables are closure-owned and cannot be mutated by callers. *)
let property predicate =
  let ascii = Array.init 128 (fun cp -> predicate (Uchar.of_int cp)) in
  fun cp -> if cp < 128 then ascii.(cp) else predicate (Uchar.of_int cp)

let cased = property Uucp.Case.is_cased
let case_ignorable = property Uucp.Case.is_case_ignorable

(* Full default casing retains contextual final sigma, original normalization
   and UTF-16 compatibility; it is not locale-sensitive case folding. *)
let lowercase text =
  let output = Buffer.create (String.length text) in
  let rec next_is_cased offset =
    if offset = String.length text then false
    else
      let decoded = decode text offset in
      let cp = Uchar.to_int (Uchar.utf_decode_uchar decoded) in
      if case_ignorable cp then next_is_cased (offset + Uchar.utf_decode_length decoded)
      else cased cp
  in
  let preceded_by_cased = ref false in
  iter_scalars
    (fun offset cp width ->
      (if cp < 128 then
         Buffer.add_char output (Char.chr (if cp >= 65 && cp <= 90 then cp + 32 else cp))
       else if cp = 0x03a3 && !preceded_by_cased && not (next_is_cased (offset + width))
       then Buffer.add_utf_8_uchar output (Uchar.of_int 0x03c2)
       else
         let uchar = Uchar.of_int cp in
         match Uucp.Case.Map.to_lower uchar with
         | `Self -> Buffer.add_utf_8_uchar output uchar
         | `Uchars mapped -> List.iter (Buffer.add_utf_8_uchar output) mapped);
      if not (case_ignorable cp) then preceded_by_cased := cased cp)
    text;
  Buffer.contents output

let whitespace cp =
  if cp < 128 then cp = 32 || (cp >= 9 && cp <= 13)
  else cp = 0xfeff || (cp <> 0x85 && Uucp.White.is_white_space (Uchar.of_int cp))

let trim text =
  let first = ref None and last = ref 0 in
  iter_scalars
    (fun offset cp width ->
      if not (whitespace cp) then (
        if !first = None then first := Some offset;
        last := offset + width))
    text;
  match !first with None -> "" | Some first -> slice text first !last

let normalize_spaces text =
  let output = Buffer.create (String.length text) in
  iter_scalars
    (fun offset cp width ->
      if whitespace cp then
        for _ = 1 to width do
          Buffer.add_char output ' '
        done
      else Buffer.add_substring output text offset width)
    text;
  Buffer.contents output

let words text = Str.split (Str.regexp " +") (normalize_spaces text)

let identifier_character cp =
  if cp < 128 then
    cp = 95 || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57)
  else
    match Uucp.Gc.general_category (Uchar.of_int cp) with
    | `Ll | `Lm | `Lo | `Lt | `Lu | `Nd | `Nl | `No -> true
    | _ -> false

let span accepts text =
  (* Validate the complete argument even when the prefix ends early. Invalid
     bytes in a suffix must retain the strict source-boundary behavior. *)
  if not (String.is_valid_utf_8 text) then invalid_arg "invalid UTF-8 scalar";
  let rec ending offset =
    if offset = String.length text then offset
    else
      let decoded = decode text offset in
      if accepts (Uchar.to_int (Uchar.utf_decode_uchar decoded)) then
        ending (offset + Uchar.utf_decode_length decoded)
      else offset
  in
  let boundary = ending 0 in
  (slice text 0 boundary, slice text boundary (String.length text))

let identifier_prefix text = span identifier_character text

let uppercase text =
  let output = Buffer.create (String.length text) in
  iter_scalars
    (fun _ cp _ ->
      if cp < 128 then
        Buffer.add_char output (Char.chr (if cp >= 97 && cp <= 122 then cp - 32 else cp))
      else
        let uchar = Uchar.of_int cp in
        match Uucp.Case.Map.to_upper uchar with
        | `Self -> Buffer.add_utf_8_uchar output uchar
        | `Uchars mapped -> List.iter (Buffer.add_utf_8_uchar output) mapped)
    text;
  Buffer.contents output
