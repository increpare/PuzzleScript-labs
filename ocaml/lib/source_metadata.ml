open Domain
open Syntax

let with_value =
  [
    "title";
    "author";
    "homepage";
    "background_color";
    "text_color";
    "key_repeat_interval";
    "realtime_interval";
    "again_interval";
    "flickscreen";
    "zoomscreen";
    "color_palette";
    "youtube";
  ]

let flags =
  [
    "run_rules_on_level_start";
    "norepeat_action";
    "require_player_movement";
    "debug";
    "verbose_logging";
    "throttle_movement";
    "noundo";
    "noaction";
    "nohack";
    "norestart";
    "scanline";
  ]

type t = {
  values : (int * string * string) list;
  seen : int Names.t;
  issues : diagnostic list;
  depth : int;
}

let initial = { values = []; seen = Names.empty; issues = []; depth = 0 }
let entries state = List.rev state.values
let diagnostics state = state.issues
let comment_depth state = state.depth

exception Limit

(* A flag's discarded suffix returns to key scanning. A value consumes its
   first fragment silently, then warns for each further comment-separated
   fragment. These are lexical visits, independent of the captured value. *)
type phase = Key | Flag_suffix | Value_suffix | After_value | Extra_value

let next_fragment = function
  | Flag_suffix -> Key
  | Value_suffix -> After_value
  | After_value | Extra_value -> Extra_value
  | Key -> Key

let feed ?(diagnostics_before = 0) ~errors_before ~comment_depth state (line, raw) =
  let state = ref state and depth = ref comment_depth in
  let active = ref (Array.of_list (Code_unit.of_utf8 (Utf8.lowercase raw))) in
  let original = Array.of_list (Code_unit.of_utf8 raw) in
  let phase = ref Key and at_start = ref true in
  let emit severity message =
    state :=
      {
        !state with
        issues =
          Diagnostics.normalize
            (!state.issues
            @ [ { location = Some { line; column = 1 }; severity; message } ]);
      };
    if diagnostics_before + List.length !state.issues > 100 then raise Limit
  in
  let check () =
    if
      errors_before + Diagnostics.error_count !state.issues > 5
      || diagnostics_before + List.length !state.issues > 100
    then raise Limit
  in
  let length () = Array.length !active in
  let code index = Code_unit.value !active.(index) in
  let spaces index =
    let rec visit index =
      if index < length () && Code_unit.whitespace !active.(index) then visit (index + 1)
      else index
    in
    visit index
  in
  let text first last =
    if first >= last then ""
    else Array.to_list (Array.sub !active first (last - first)) |> Code_unit.text
  in
  let prefix index =
    let rec ending index =
      if index < length () && code index <> 40 then ending (index + 1) else index
    in
    let last = ending index in
    ( (if last = index then None
       else
         Some
           (Array.to_list (Array.sub !active index (last - index))
           |> Code_unit.trim |> Code_unit.text)),
      last )
  in
  let identifier index =
    let rec ending index =
      if index >= length () then index
      else
        let first = code index in
        let cp, width =
          if
            first >= 0xd800 && first <= 0xdbff
            && index + 1 < length ()
            && code (index + 1) >= 0xdc00
            && code (index + 1) <= 0xdfff
          then (0x10000 + ((first - 0xd800) lsl 10) + code (index + 1) - 0xdc00, 2)
          else (first, 1)
        in
        if (cp >= 0xd800 && cp <= 0xdfff) || not (Utf8.identifier_character cp) then index
        else ending (index + width)
    in
    ending index
  in
  let rec visit index =
    let index = if !depth = 0 then spaces index else index in
    if index < length () then (
      if !depth > 0 then
        let rec comment index =
          if index >= length () then index
          else (
            if code index = 40 then incr depth else if code index = 41 then decr depth;
            if !depth = 0 then index + 1 else comment (index + 1))
        in
        visit (comment index)
      else if code index = 40 then (
        incr depth;
        visit (index + 1))
      else if code index = 41 then (
        emit Warning_severity
          "You're trying to close a comment here, but I can't find any opening bracket \
           to match it? [This is highly suspicious; you probably want to fix it.]";
        at_start := false;
        check ();
        visit (index + 1))
      else if !phase = Key then
        let ending = identifier index in
        if ending = index then (
          emit Error_severity
            ("Unrecognised stuff \"" ^ text 0 (length ()) ^ "\" in the prelude.");
          at_start := false;
          check ();
          visit (index + 1))
        else
          let key = text index ending in
          let next = spaces ending in
          if not !at_start then visit next
          else (
            at_start := false;
            if List.mem key with_value then (
              if List.mem key [ "title"; "author"; "homepage" ] then active := original;
              if key = "youtube" then
                emit Warning_severity
                  "Unfortunately, YouTube support hasn't been working properly for a \
                   long time - it was always a hack and it hasn't gotten less hacky over \
                   time, so I can no longer pretend to support it.";
              let value, _ = prefix (min next (length ())) in
              (match value with
              | None -> emit Error_severity ("MetaData \"" ^ key ^ "\" needs a value.")
              | Some value ->
                  (match Names.find_opt key !state.seen with
                  | None -> ()
                  | Some earlier ->
                      emit Warning_severity
                        ("You've already defined a " ^ String.uppercase_ascii key
                       ^ " in the prelude on line " ^ string_of_int earlier ^ "."));
                  state :=
                    {
                      !state with
                      values = (line, key, value) :: !state.values;
                      seen = Names.add key line !state.seen;
                    });
              phase := Value_suffix)
            else if List.mem key flags then (
              let value, _ = prefix next in
              (match value with
              | None -> ()
              | Some extra ->
                  emit Warning_severity
                    ("MetaData " ^ String.uppercase_ascii key
                   ^ " doesn't take any parameters, but you went and gave it \"" ^ extra
                   ^ "\"."));
              state := { !state with values = (line, key, "true") :: !state.values };
              phase := Flag_suffix)
            else emit Error_severity "Unrecognised stuff in the prelude.";
            check ();
            visit next)
      else
        let _, next = prefix index in
        phase := next_fragment !phase;
        if !phase = Extra_value then
          emit Warning_severity
            "Error: you can't embed comments in metadata values. Anything after the \
             comment will be ignored.";
        check ();
        visit next)
  in
  (try visit 0 with Limit -> ());
  { !state with depth = !depth }

let read lines =
  let rec visit state = function
    | [] -> state
    | _ when Diagnostics.error_count state.issues > 5 || List.length state.issues > 100 ->
        state
    | line :: rest ->
        visit (feed ~errors_before:0 ~comment_depth:state.depth state line) rest
  in
  let state = visit initial lines in
  (entries state, diagnostics state)

(* Metadata is a source compatibility boundary. The historical frontend uses
   Number, parseFloat and parseInt at different steps; accepting an integer
   spelling is therefore different from calling OCaml's int_of_string. *)
let matches expression text = Str.string_match (Str.regexp expression) text 0
let decimal = "[+-]?\\([0-9]+\\(\\.[0-9]*\\)?\\|\\.[0-9]+\\)\\([eE][+-]?[0-9]+\\)?"
let finite value = Float.is_finite value

let radix_number text =
  if text.[1] = 'x' then float_of_string_opt text
  else
    (* Convert binary/octal digits to a hexadecimal float spelling before numeric
     conversion. The float parser rounds the complete value once, without an
     intermediate machine-integer bound or repeated floating-point rounding. *)
    let bits_per_digit = if text.[1] = 'b' then 1 else 3 in
    let bit_count = (String.length text - 2) * bits_per_digit in
    let padding = (4 - (bit_count mod 4)) mod 4 in
    let digits = Buffer.create (((bit_count + padding) / 4) + 2) in
    Buffer.add_string digits "0x";
    let nibble = ref 0 and used = ref padding in
    for index = 2 to String.length text - 1 do
      let digit = Char.code text.[index] - Char.code '0' in
      for bit = bits_per_digit - 1 downto 0 do
        nibble := (!nibble lsl 1) lor ((digit lsr bit) land 1);
        incr used;
        if !used = 4 then (
          Buffer.add_char digits "0123456789abcdef".[!nibble];
          nibble := 0;
          used := 0)
      done
    done;
    float_of_string_opt (Buffer.contents digits)

let number text =
  let text = Utf8.trim text in
  if text = "" then Some 0.
  else if matches (decimal ^ "$") text then float_of_string_opt text
  else if matches "0\\(x[0-9a-f]+\\|b[01]+\\|o[0-7]+\\)$" text then radix_number text
  else None

let float_prefix text =
  let text = Utf8.trim text in
  if matches decimal text then float_of_string_opt (Str.matched_string text) else None

let integer_prefix text =
  let text = Utf8.trim text in
  if matches "[+-]?0x[0-9a-f]+" text || matches "[+-]?[0-9]+" text then
    int_of_string_opt (Str.matched_string text)
  else None

let dimensions line value =
  let value = Utf8.lowercase value in
  let diagnostics = ref [] in
  let warn message =
    diagnostics :=
      { location = Some { line; column = 1 }; severity = Warning_severity; message }
      :: !diagnostics
  in
  let dimension text =
    let whole =
      match (number text, float_prefix text) with
      | Some numeric, Some prefix ->
          finite numeric && finite prefix && Float.is_integer prefix
          && prefix >= -2147483648. && prefix <= 2147483647.
      | _ -> false
    in
    if not whole then (
      warn ("Wasn't able to make sense of \"" ^ text ^ "\" as a (whole number) dimension.");
      None)
    else
      match integer_prefix text with
      | None ->
          warn ("Wasn't able to make sense of \"" ^ text ^ "\" as a dimension.");
          None
      | Some value ->
          if value <= 0 then
            warn
              ("The dimension given to me (you gave \"" ^ text
             ^ "\") is baad - it should be greater than 0.");
          Some value
  in
  let result =
    match String.split_on_char 'x' (Utf8.lowercase value) with
    | [ width; height ] -> (
        let width_value = dimension width in
        let height_value = dimension height in
        match (width_value, height_value) with
        | Some width, Some height when width > 0 && height > 0 -> Some (width, height)
        | Some _, Some _ ->
            warn
              ("The dimensions given to me (you gave \"" ^ value
             ^ "\") are baad - they should be > 0.");
            None
        | _ ->
            warn
              ("Couldn't understand the dimensions given to me (you gave \"" ^ value
             ^ "\") - should be of the form AxB.");
            None)
    | _ ->
        warn "Dimensions must be of the form AxB.";
        None
  in
  (result, Diagnostics.normalize (List.rev !diagnostics))

let compile entries =
  let entries =
    List.fold_left
      (fun values (line, key, value) -> Names.add key (line, value) values)
      Names.empty entries
  in
  let enabled key = Names.mem key entries in
  let screen key =
    match Names.find_opt key entries with
    | None -> (None, [])
    | Some (line, value) -> dimensions line value
  in
  let interval key fallback =
    match Names.find_opt key entries with
    | None -> fallback
    | Some (_, value) -> Option.value ~default:Float.nan (number value) *. 1000.
  in
  let flickscreen, flick_diagnostics = screen "flickscreen" in
  let zoomscreen, zoom_diagnostics = screen "zoomscreen" in
  ( {
      run_rules_on_level_start = enabled "run_rules_on_level_start";
      require_player_movement = enabled "require_player_movement";
      no_action = enabled "noaction";
      no_undo = enabled "noundo";
      no_restart = enabled "norestart";
      flickscreen;
      zoomscreen;
      again_interval_ms = interval "again_interval" 150.;
      realtime_interval_ms = interval "realtime_interval" 0.;
      no_repeat_action = enabled "norepeat_action";
      throttle_movement = enabled "throttle_movement";
      key_repeat_interval_ms = interval "key_repeat_interval" 150.;
    },
    flick_diagnostics @ zoom_diagnostics )

let palettes =
  [
    "mastersystem";
    "gameboycolour";
    "amiga";
    "arnecolors";
    "famicom";
    "atari";
    "pastel";
    "ega";
    "amstrad";
    "proteus_mellow";
    "proteus_rich";
    "proteus_night";
    "c64";
    "whitingjp";
  ]

let check_palettes entries =
  List.filter_map
    (fun (_, key, value) ->
      let numeric_alias =
        List.exists
          (fun index -> value = string_of_int index)
          (List.init 14 (fun index -> index + 1))
      in
      if key <> "color_palette" || numeric_alias || List.mem value palettes then None
      else
        Some
          {
            location = Some { line = 0; column = 1 };
            severity = Error_severity;
            message = "Palette \"" ^ value ^ "\" not found, defaulting to arnecolors.";
          })
    entries
  |> Diagnostics.normalize

let check_presentation entries =
  let entries =
    List.fold_left
      (fun values (line, key, value) -> Names.add key (line, value) values)
      Names.empty entries
  in
  [ ("text_color", "white"); ("background_color", "black") ]
  |> List.filter_map (fun (key, fallback) ->
      match Names.find_opt key entries with
      | None -> None
      | Some (line, value) when not (Source_objects.is_color value) ->
          Some
            {
              location = Some { line; column = 1 };
              severity = Error_severity;
              message =
                key ^ " in incorrect format - found " ^ Utf8.trim value
                ^ ", but I expect a color name (like 'pink') or hex-formatted color \
                   (like '#1412FA').  Defaulting to " ^ fallback ^ ".";
            }
      | Some _ -> None)
