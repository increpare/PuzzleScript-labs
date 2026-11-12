open Syntax
open Domain

type cursor = { name : string; matrix : string list }

(* Await_name retains a prior owner only for source-recovery visits. Active
   phases carry their own owner and sprite progress, so they cannot disagree. *)
type phase =
  | Await_name of cursor option
  | Aliases of cursor
  | Colors of cursor
  | Pixels of cursor

type t = {
  phase : phase;
  objects : object_declaration Names.t;
  order : string list;
  aliases : unit Names.t;
  diagnostics : diagnostic list;
  errors : int;
  depth : int;
  diagnostic_prefix : int;
}

let initial =
  {
    phase = Await_name None;
    objects = Names.empty;
    order = [];
    aliases = Names.empty;
    diagnostics = [];
    errors = 0;
    depth = 0;
    diagnostic_prefix = 0;
  }

exception Limit of t

let report line severity message state =
  let diagnostic = { location = Some { line; column = 1 }; severity; message } in
  if List.mem diagnostic state.diagnostics then state
  else
    let state =
      {
        state with
        diagnostics = diagnostic :: state.diagnostics;
        errors = (state.errors + if severity = Error_severity then 1 else 0);
      }
    in
    if state.diagnostic_prefix + List.length state.diagnostics > 100 then
      raise (Limit state);
    state

let update name f state =
  {
    state with
    objects = Names.add name (f (Names.find name state.objects)) state.objects;
  }

let named_colors =
  [
    "black";
    "white";
    "gray";
    "darkgray";
    "lightgray";
    "grey";
    "darkgrey";
    "lightgrey";
    "red";
    "darkred";
    "lightred";
    "brown";
    "darkbrown";
    "lightbrown";
    "orange";
    "yellow";
    "green";
    "darkgreen";
    "lightgreen";
    "blue";
    "lightblue";
    "darkblue";
    "purple";
    "pink";
    "transparent";
  ]

let color_prefix text =
  match
    List.find_opt (fun color -> String.starts_with ~prefix:color text) named_colors
  with
  | Some color ->
      Some
        ( color,
          String.sub text (String.length color) (String.length text - String.length color)
        )
  | None ->
      let hex ch =
        (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
      in
      if not (String.starts_with ~prefix:"#" text) then None
      else
        let ending = ref 1 in
        while !ending < String.length text && !ending < 7 && hex text.[!ending] do
          incr ending
        done;
        let length = if !ending >= 7 then 7 else if !ending >= 4 then 4 else 0 in
        if length = 0 then None
        else
          Some
            ( String.sub text 0 length,
              String.sub text length (String.length text - length) )

let is_color text =
  match color_prefix (Utf8.trim text) with Some (_, "") -> true | _ -> false

let until_comment text =
  match String.index_opt text '(' with
  | None -> (text, "")
  | Some index ->
      (String.sub text 0 index, String.sub text index (String.length text - index))

let unknown_junk =
  "Unknown junk in object section (possibly: sprites have to be 5 pixels wide and 5 \
   pixels high exactly. Or maybe: the main names for objects have to be words containing \
   only the letters a-z0.9 - if you want to call them something like \",\", do it in the \
   legend section)."

let close_warning =
  "You're trying to close a comment here, but I can't find any opening bracket to match \
   it? [This is highly suspicious; you probably want to fix it.]"

let at_limit ~errors_before ~diagnostics_before state =
  errors_before + state.errors > 5
  || diagnostics_before + List.length state.diagnostics > 100

let active state =
  match state.phase with
  | Await_name cursor -> cursor
  | Aliases cursor | Colors cursor | Pixels cursor -> Some cursor

let clear_matrix state =
  let clear cursor = { cursor with matrix = [] } in
  let phase =
    match state.phase with
    | Await_name cursor -> Await_name (Option.map clear cursor)
    | Aliases cursor -> Aliases (clear cursor)
    | Colors cursor -> Colors (clear cursor)
    | Pixels cursor -> Pixels (clear cursor)
  in
  { state with phase }

let advance state =
  {
    state with
    phase =
      (match state.phase with
      | Aliases name -> Colors name
      | Colors name -> Pixels name
      | phase -> phase);
  }

let name ~reserved_names ~sol line text state =
  let value, rest =
    if sol then Utf8.identifier_prefix text
    else Utf8.span (fun cp -> (not (Utf8.whitespace cp)) && cp <> 40 && cp <> 41) text
  in
  if value = "" then
    let _, rest = until_comment text in
    (report line Warning_severity unknown_junk state, rest)
  else if Names.mem value state.objects then
    ( report line Error_severity
        ("Object \"" ^ Utf8.uppercase value ^ "\" defined multiple times.")
        state,
      rest )
  else
    let state =
      if Names.mem value state.aliases then
        report line Error_severity
          ("Name \"" ^ Utf8.uppercase value ^ "\" already in use.")
          state
      else state
    in
    let state =
      if List.mem value reserved_names && (sol || List.length (Utf8.utf16 value) > 1) then
        report line Warning_severity
          ("You named an object \"" ^ Utf8.uppercase value
         ^ "\", but this is a keyword. Don't do that!")
          state
      else state
    in
    if sol then
      let declaration =
        {
          object_line = line;
          object_name = value;
          object_aliases = [];
          colors = [];
          sprite = [];
        }
      in
      ( {
          state with
          phase = Aliases { name = value; matrix = [] };
          objects = Names.add value declaration state.objects;
          order = value :: state.order;
        },
        rest )
    else
      match active state with
      | None -> (state, rest)
      | Some cursor ->
          let selected = cursor.name in
          let state =
            update selected
              (fun declaration ->
                {
                  declaration with
                  object_aliases =
                    declaration.object_aliases
                    @ [ { alias_line = line; alias_name = value } ];
                })
              state
          in
          ( {
              state with
              phase = Aliases cursor;
              aliases = Names.add value () state.aliases;
            },
            rest )

let token ~reserved_names ~sol line text state =
  match state.phase with
  | Await_name _ | Aliases _ -> name ~reserved_names ~sol line text (clear_matrix state)
  | Colors cursor -> (
      let selected = cursor.name in
      match color_prefix text with
      | Some (color, rest) ->
          ( update selected
              (fun declaration ->
                { declaration with colors = declaration.colors @ [ color ] })
              state,
            rest )
      | None ->
          let word, rest = Utf8.identifier_prefix text in
          let found, rest =
            if word = "" then until_comment text
            else
              let whitespace, rest = Utf8.span Utf8.whitespace rest in
              (word ^ whitespace, rest)
          in
          ( report line Error_severity
              ("Was looking for color for object " ^ Utf8.uppercase selected ^ ", got \""
             ^ found ^ "\" instead.")
              state,
            rest ))
  | Pixels cursor ->
      let selected = cursor.name in
      let ch = text.[0] in
      if ch <> '.' && (ch < '0' || ch > '9') then
        if cursor.matrix = [] then name ~reserved_names ~sol line text state
        else
          let _, rest = until_comment text in
          ( report line Error_severity
              ("Unknown junk in spritematrix for object " ^ Utf8.uppercase selected ^ ".")
              state,
            rest )
      else if cursor.matrix = [] && not sol then
        (* No physical row was opened. The legacy array's non-index entry never
           becomes sprite data, and its first character already exceeds width. *)
        let _, rest = until_comment text in
        (report line Warning_severity "Sprites must be 5 wide and 5 high." state, rest)
      else
        let matrix = if sol then cursor.matrix @ [ "" ] else cursor.matrix in
        let matrix =
          match List.rev matrix with
          | [] -> assert false
          | row :: rest -> List.rev ((row ^ String.make 1 ch) :: rest)
        in
        let row = List.hd (List.rev matrix) in
        let state =
          update selected
            (fun declaration -> { declaration with sprite = matrix })
            { state with phase = Pixels { cursor with matrix } }
        in
        if String.length row > 5 then
          let _, rest = until_comment text in
          (report line Warning_severity "Sprites must be 5 wide and 5 high." state, rest)
        else
          let state =
            if List.length matrix = 5 && String.length row = 5 then
              { state with phase = Await_name (Some { cursor with matrix }) }
            else state
          in
          let state =
            if
              ch <> '.'
              && Char.code ch - Char.code '0'
                 >= List.length (Names.find selected state.objects).colors
            then
              report line Error_severity
                ("Trying to access color number " ^ String.make 1 ch
               ^ " from the color palette of sprite " ^ Utf8.uppercase selected
               ^ ", but there are only "
                ^ string_of_int (List.length (Names.find selected state.objects).colors)
                ^ " defined in it.")
                state
            else state
          in
          (state, String.sub text 1 (String.length text - 1))

let feed_raw ?(diagnostics_before = 0) ~reserved_names ~errors_before ~comment_depth state
    (line, raw) =
  let text = Utf8.lowercase raw in
  let rec comment depth index =
    if index = String.length text then (depth, index)
    else
      let depth =
        if text.[index] = '(' then depth + 1
        else if text.[index] = ')' then depth - 1
        else depth
      in
      if depth = 0 then (depth, index + 1) else comment depth (index + 1)
  in
  let rec visit sol depth index state =
    if at_limit ~errors_before ~diagnostics_before state || index >= String.length text
    then { state with depth }
    else if depth > 0 then
      let depth, next = comment depth index in
      visit sol depth next state
    else
      let remaining = String.sub text index (String.length text - index) in
      let spaces, remaining = Utf8.span Utf8.whitespace remaining in
      let index = index + String.length spaces in
      if remaining = "" then { state with depth }
      else
        match remaining.[0] with
        | '(' ->
            let depth, next = comment 1 (index + 1) in
            visit sol depth next state
        | ')' ->
            visit false 0 (index + 1) (report line Warning_severity close_warning state)
        | _ ->
            (* Section recognition consumes a heading word even on a noninitial
             visit. It does not change sections there; any suffix goes straight
             to the object lexer in the same visit. *)
            let remaining =
              match if sol then None else Source_sections.heading_prefix remaining with
              | None -> remaining
              | Some (_, ending) ->
                  String.sub remaining ending (String.length remaining - ending)
            in
            if remaining = "" then { state with depth }
            else
              let state = if sol then advance state else state in
              let state, rest = token ~reserved_names ~sol line remaining state in
              visit false 0 (String.length text - String.length rest) state
  in
  let state = { state with diagnostic_prefix = diagnostics_before } in
  try
    if comment_depth = 0 && Utf8.trim raw = "" then
      { state with phase = Await_name (active state); depth = 0 }
    else visit true comment_depth 0 state
  with Limit state -> state

let reset_section state = { state with phase = Await_name (active state) }
let diagnostics state = List.rev state.diagnostics

let declarations state =
  List.rev_map (fun name -> Names.find name state.objects) state.order

let comment_depth state = state.depth

let add_aliases names state =
  {
    state with
    aliases =
      List.fold_left (fun aliases name -> Names.add name () aliases) state.aliases names;
  }

let read ?(diagnostics_before = 0) ~reserved_names ~errors_before lines =
  let state =
    List.fold_left
      (fun state line ->
        if at_limit ~errors_before ~diagnostics_before state then state
        else
          feed_raw ~diagnostics_before ~reserved_names ~errors_before
            ~comment_depth:state.depth state line)
      initial lines
  in
  let diagnostics = diagnostics state in
  if at_limit ~errors_before ~diagnostics_before state then Error diagnostics
  else Ok (declarations state, diagnostics)
