open Puzzlescript

let hash text = Digest.BLAKE512.(to_hex (string text))

let () =
  let buffer = Buffer.create 6_000_000 in
  let checked = ref 0 in
  for cp = 0 to 0x10ffff do
    if cp < 0xd800 || cp > 0xdfff then (
      incr checked;
      Buffer.add_utf_8_uchar buffer (Uchar.of_int cp);
      Buffer.add_char buffer '\000')
  done;
  let source = Buffer.contents buffer in
  let selected predicate =
    let buffer = Buffer.create 4096 in
    Utf8.iter_scalars
      (fun offset cp width ->
        if predicate cp then Buffer.add_substring buffer source offset width)
      source;
    hash (Buffer.contents buffer)
  in
  let units = Buffer.create 6_000_000 in
  List.iter
    (fun unit ->
      Buffer.add_char units (Char.chr (unit lsr 8));
      Buffer.add_char units (Char.chr (unit land 255)))
    (Utf8.utf16 source);
  let contexts = [ "Α'Σ"; "ΟΣ'Α"; "ΟΣ.Α"; "ΟΣ'"; "İ Σ́" ] in
  let open Json in
  print_endline
    (to_string
       (Object
          [
            ("unicodeVersion", String Uucp.unicode_version);
            ("checkedScalars", Int !checked);
            ( "stream",
              Object
                [
                  ("source", String (hash source));
                  ("lower", String (hash (Utf8.lowercase source)));
                  ("upper", String (hash (Utf8.uppercase source)));
                  ("whitespace", String (selected Utf8.whitespace));
                  ("identifiers", String (selected Utf8.identifier_character));
                  ("utf16", String (hash (Buffer.contents units)));
                ] );
            ( "contexts",
              Array
                (List.map
                   (fun source ->
                     Object
                       [
                         ("source", String source);
                         ("lower", String (Utf8.lowercase source));
                         ("upper", String (Utf8.uppercase source));
                       ])
                   contexts) );
          ]))
