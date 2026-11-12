open Syntax

let dictionary_order objects =
  let index declaration =
    let name = declaration.object_name in
    match Int64.of_string_opt name with
    | Some n when n >= 0L && n < 4294967295L && Int64.to_string n = name -> Some n
    | _ -> None
  in
  List.stable_sort
    (fun left right ->
      match (index left, index right) with
      | Some a, Some b -> Int64.compare a b
      | Some _, None -> -1
      | None, Some _ -> 1
      | None, None -> 0)
    objects

let check objects =
  let diagnostics = ref [] in
  let report line severity message =
    diagnostics :=
      { location = Some { line; column = 1 }; severity; message } :: !diagnostics
  in
  List.iter
    (fun declaration ->
      let name = declaration.object_name in
      if List.length declaration.colors > 10 then
        report (declaration.object_line + 1) Error_severity
          "a sprite cannot have more than 10 colors.  Why you would want more than 10 is \
           beyond me.";
      if declaration.colors = [] then
        report declaration.object_line Error_severity
          ("color not specified for object \"" ^ name ^ "\".");
      if declaration.sprite = [] then (
        if List.length declaration.colors > 1 then
          report declaration.object_line Warning_severity
            ("Object \"" ^ Utf8.uppercase name
           ^ "\" lists several colours but doesn't have a sprite matrix; it will just be \
              a solid square of the first colour."))
      else if
        List.length declaration.sprite <> 5
        || List.exists (fun row -> String.length row <> 5) declaration.sprite
      then
        report declaration.object_line Warning_severity
          "Sprite graphics must be 5 wide and 5 high exactly.")
    (dictionary_order objects);
  List.rev !diagnostics
