open Syntax
module Names = Set.Make (String)

let command = function
  | "again" -> Some Domain.Again
  | "cancel" -> Some Cancel
  | "restart" -> Some Restart
  | "checkpoint" -> Some Checkpoint
  | "win" -> Some Win
  | "message" -> Some (Message "")
  | word when String.starts_with ~prefix:"sfx" word -> (
      match int_of_string_opt (String.sub word 3 (String.length word - 3)) with
      | Some n when n >= 0 && n <= 10 && word = "sfx" ^ string_of_int n -> Some (Sound n)
      | _ -> None)
  | _ -> None

type lexeme =
  | Open_row
  | Close_row
  | Bar
  | Arrow
  | Join
  | Dots
  | Late
  | Rigid
  | Qualifier of Qualifier.t
  | Command of Domain.command
  | Identifier

type token = { word : string; kind : lexeme }

let classify = function
  | "[" -> Open_row
  | "]" -> Close_row
  | "|" -> Bar
  | "->" -> Arrow
  | "+" -> Join
  | "..." -> Dots
  | "late" -> Late
  | "rigid" -> Rigid
  | word -> (
      match Qualifier.of_string word with
      | Some qualifier -> Qualifier qualifier
      | None -> (
          match command word with Some command -> Command command | None -> Identifier))

(* Only an initial attached '+' is split. The captured text and live lexical
   visits have deliberately different recovery rules. *)
let tokens text =
  let text = Utf8.normalize_spaces (Utf8.lowercase text) in
  let length = String.length text in
  let arrow offset =
    offset + 1 < length && text.[offset] = '-' && text.[offset + 1] = '>'
  in
  let delimiter = function ' ' | '[' | ']' | '|' -> true | _ -> false in
  let rec ending offset =
    if offset = length || delimiter text.[offset] || arrow offset then offset
    else ending (offset + 1)
  in
  let rec scan offset first reversed =
    if offset = length then List.rev reversed
    else if text.[offset] = ' ' then scan (offset + 1) first reversed
    else
      let stop =
        if List.mem text.[offset] [ '['; ']'; '|' ] || (first && text.[offset] = '+') then
          offset + 1
        else if arrow offset then offset + 2
        else ending (offset + 1)
      in
      let word = String.sub text offset (stop - offset) in
      scan stop false ({ word; kind = classify word } :: reversed)
  in
  scan 0 true []

let message_after original tokens target =
  let lowered = Utf8.lowercase original in
  let rec find offset = function
    | [] -> offset
    | token :: rest ->
        let position =
          try Str.search_forward (Str.regexp_string token.word) lowered offset
          with Not_found -> -String.length token.word
        in
        find (position + String.length token.word) rest
  in
  let count =
    min (String.length lowered)
      (max 0 (find 0 (List.filteri (fun index _ -> index <= target) tokens)))
  in
  let normalized_units = Utf8.utf16 (String.sub lowered 0 count) |> List.length in
  let rec drop units = function
    | [] -> ""
    | (cp, _) :: rest when units > 0 -> drop (units - if cp > 0xffff then 2 else 1) rest
    | rest -> String.concat "" (List.map snd rest)
  in
  let message = drop normalized_units (Utf8.scalars original) |> Utf8.trim in
  if message = "" then " " else message

type cell_builder = { reversed_items : pattern_item list; pending : Qualifier.t option }

let empty_cell = { reversed_items = []; pending = None }
let cell_nonempty cell = cell.reversed_items <> [] || cell.pending <> None
let cell_value cell = List.rev cell.reversed_items

let add_name name cell =
  {
    reversed_items =
      item_of_contents { term_name = name; qualifier = cell.pending }
      :: cell.reversed_items;
    pending = None;
  }

type row_builder = { cell : cell_builder; completed_rev : pattern_cell list }
type row_position = Outside_row of cell_builder | Inside_row of row_builder
type side = Detection | Replacement
type pattern_state = { side : side; position : row_position }
type phase = Prelude | Patterns of pattern_state | Literal_message
type join = Independent | Linked of authored_rule

type modifiers = {
  directions_rev : Rule_header.direction list;
  late : bool;
  rigid : bool;
  random : bool;
}

type builder = {
  phase : phase;
  join : join;
  modifiers : modifiers;
  bracket_depth : int;
  left_rev : pattern_cell list list;
  right_rev : pattern_cell list list;
  commands_rev : Domain.command list;
}

type compilation = {
  entries : rule_entry list;
  diagnostics : diagnostic list;
  invalid_shapes : bool;
}

type context = {
  captured : captured_rule;
  previous : authored_rule option;
  known_names : Names.t;
  is_property : string -> bool;
  sounds : sound_entry list;
  input : token list;
  emit : ?line:int -> severity -> string -> unit;
}

exception Discard

let line context = context.captured.captured_line
let error context message = context.emit ~line:(line context) Error_severity message
let warn context message = context.emit ~line:(line context) Warning_severity message

let group_line context = function
  | Independent -> line context
  | Linked parent -> parent.group_line

let current_cell = function Outside_row cell -> cell | Inside_row row -> row.cell
let is_inside = function Inside_row _ -> true | Outside_row _ -> false

let with_position state body position =
  { state with phase = Patterns { body with position } }

let with_cell state body cell =
  let position =
    match body.position with
    | Outside_row _ -> Outside_row cell
    | Inside_row row -> Inside_row { row with cell }
  in
  with_position state body position

let initial =
  {
    phase = Prelude;
    join = Independent;
    modifiers = { directions_rev = []; late = false; rigid = false; random = false };
    bracket_depth = 0;
    left_rev = [];
    right_rev = [];
    commands_rev = [];
  }

let join_rule context index state =
  if group_line context state.join <> line context then (
    error context
      "Two \"+\"s (the \"append to previous rule group\" symbol) applied to the same \
       rule.";
    state)
  else
    let join =
      match context.previous with
      | None ->
          error context
            "The \"+\" symbol, for joining a rule with the group of the previous rule, \
             needs a previous rule to be applied to.";
          Independent
      | Some parent -> Linked parent
    in
    if index <> 0 then
      error context
        "The \"+\" symbol, for joining a rule with the group of the previous rule, must \
         be the first symbol on the line";
    { state with join }

let open_row context state body =
  let bracket_depth = state.bracket_depth + 1 in
  if bracket_depth > 1 then
    warn context
      "Multiple opening brackets without closing brackets.  Something fishy here.  Every \
       '[' has to be closed by a ']', and you can't nest them.";
  if cell_nonempty (current_cell body.position) then
    error context
      "Error, malformed cell rule - encountered a \"[\"\" before previous bracket was \
       closed";
  let completed_rev =
    match body.position with Outside_row _ -> [] | Inside_row row -> row.completed_rev
  in
  {
    (with_position state body (Inside_row { cell = empty_cell; completed_rev })) with
    bracket_depth;
  }

let movement_without_object context =
  error context "In a rule, if you specify a movement, it has to act on an object."

let close_row context state body =
  let bracket_depth = state.bracket_depth - 1 in
  if bracket_depth < 0 then (
    warn context
      "Multiple closing brackets without corresponding opening brackets.  Something \
       fishy here.  Every '[' has to be closed by a ']', and you can't nest them.";
    raise Discard);
  let cell = current_cell body.position in
  let completed_rev =
    match body.position with Outside_row _ -> [] | Inside_row row -> row.completed_rev
  in
  let cell, completed_rev =
    match cell.pending with
    | Some pending ->
        let ellipsis =
          match List.rev cell.reversed_items with
          | Ellipsis _ :: _ -> true
          | Named _ :: _ -> false
          | [] -> pending = Qualifier.Ellipsis
        in
        if ellipsis then error context "Cannot end a rule with ellipses."
        else movement_without_object context;
        (cell, completed_rev)
    | None -> (empty_cell, cell_value cell :: completed_rev)
  in
  let row = List.rev completed_rev in
  let state = { state with bracket_depth } in
  let state =
    match body.side with
    | Detection -> { state with left_rev = row :: state.left_rev }
    | Replacement -> { state with right_rev = row :: state.right_rev }
  in
  with_position state body (Outside_row cell)

let bar context state body =
  match body.position with
  | Outside_row _ ->
      warn context
        "Janky syntax.  \"|\" should only be used inside cell rows (the square brackety \
         bits).";
      state
  | Inside_row row ->
      if row.cell.pending <> None then (
        movement_without_object context;
        state)
      else
        with_position state body
          (Inside_row
             {
               cell = empty_cell;
               completed_rev = cell_value row.cell :: row.completed_rev;
             })

let arrow context state body =
  (match state.join with
  | Linked parent
    when group_line context state.join <> line context
         && parent.headers.late <> state.modifiers.late ->
      warn context
        "Oh gosh you can mix late and non-late rules in a rule-group if you really want \
         to, but gosh why would you want to do that?  What do you expect to accomplish?"
  | Independent | Linked _ -> ());
  match (body.position, body.side) with
  | Inside_row _, _ ->
      warn context
        "Encountered an unexpected \"->\" inside square brackets.  It's used to separate \
         states, it has no place inside them >:| .";
      state
  | Outside_row _, Replacement ->
      error context
        "Error, you can only use \"->\" once in a rule; it's used to separate before and \
         after states.";
      raise Discard
  | Outside_row _, Detection ->
      { state with phase = Patterns { body with side = Replacement } }

let qualify context state body qualifier =
  let cell = current_cell body.position in
  if cell.pending <> None then (
    error context
      "Error, an item can only have one direction/action at a time, but you're looking \
       for several at once!";
    state)
  else if not (is_inside body.position) then (
    warn context "Invalid syntax. Directions should be placed at the start of a rule.";
    state)
  else if
    state.modifiers.late && qualifier <> Qualifier.No && qualifier <> Qualifier.Random
  then (
    error context "Movements cannot appear in late rules.";
    state)
  else with_cell state body { cell with pending = Some qualifier }

let name context state body name =
  match body.position with
  | Outside_row _ ->
      warn context
        ("Invalid token " ^ Utf8.uppercase name
       ^ ". Object names should only be used within cells (square brackets).");
      state
  | Inside_row row ->
      List.iter
        (fun item ->
          let existing = item_contents item in
          if existing.term_name = name then
            if
              existing.qualifier = Some Qualifier.No
              && row.cell.pending = Some Qualifier.No
            then
              warn context
                ("I notice that you have NO " ^ Utf8.uppercase name
               ^ " more than once in a single cell. That's redundant innit.")
            else (
              error context
                ("You cannot specify the same object more than once in a single cell (in \
                  this case " ^ Utf8.uppercase name ^ " occurs multiple times).");
              if context.is_property name then
                context.emit Warning_severity
                  "( However, noticing that you're committing this crime with \
                   properties, and not being able to help but acknowledge that you may \
                   be trying to do something esoteric and clever with the property \
                   inference system,  I might be brought to suggest that you consider \
                   this: you can have multiple equivalent properties with different \
                   names. )"))
        (List.rev row.cell.reversed_items);
      with_cell state body (add_name name row.cell)

let ellipsis context state body =
  match body.position with
  | Outside_row _ ->
      warn context
        "Invalid syntax, ellipses should only be used within cells (square brackets).";
      state
  | Inside_row row ->
      let cell =
        match row.cell.pending with
        | None ->
            { reversed_items = Ellipsis "..." :: row.cell.reversed_items; pending = None }
        | Some _ -> { (add_name "..." row.cell) with pending = Some Qualifier.Ellipsis }
      in
      with_cell state body cell

let queue_command context index rest state body command =
  if body.side = Detection then
    error context
      "Commands should only appear at the end of rules, not in or before the \
       pattern-detection/-replacement sections."
  else if
    is_inside body.position || List.exists (fun token -> token.kind = Close_row) rest
  then
    warn context
      "Commands should only appear at the end of rules, not in or before the \
       pattern-detection/-replacement sections.";
  let phase, command =
    match command with
    | Domain.Message _ ->
        ( Literal_message,
          Domain.Message
            (message_after context.captured.original_text context.input index) )
    | Sound n ->
        if not (Source_sounds.declares_event (Slot_event n) context.sounds) then
          warn context ("Sound effect \"sfx" ^ string_of_int n ^ "\" not defined.");
        (state.phase, command)
    | command -> (state.phase, command)
  in
  { state with phase; commands_rev = command :: state.commands_rev }

let pattern_token context index rest state body token =
  match token.kind with
  | Open_row -> open_row context state body
  | Close_row -> close_row context state body
  | Bar -> bar context state body
  | Arrow -> arrow context state body
  | Qualifier qualifier -> qualify context state body qualifier
  | _ when Names.mem token.word context.known_names -> name context state body token.word
  | Dots -> ellipsis context state body
  | Command command -> queue_command context index rest state body command
  | Join | Late | Rigid | Identifier ->
      error context
        ("Error, malformed cell rule - was looking for cell contents, but found \""
       ^ token.word ^ "\".  What am I supposed to do with this, eh, please tell me that."
        );
      state

let prelude_token context index state token =
  let modifiers = state.modifiers in
  let add_direction direction =
    {
      state with
      modifiers =
        { modifiers with directions_rev = direction :: modifiers.directions_rev };
    }
  in
  match token.kind with
  | Join -> join_rule context index state
  | Qualifier (Relative _ | Parallel | Perpendicular) ->
      error context
        "You cannot use relative directions (\"^v<>\") to indicate in which direction(s) \
         a rule applies.  Use absolute directions indicators (Up, Down, Left, Right, \
         Horizontal, or Vertical, for instance), or, if you want the rule to apply in \
         all four directions, do not specify directions";
      state
  | Qualifier (Movement (Move direction)) ->
      add_direction (Rule_header.Cardinal direction)
  | Qualifier (Axis Horizontal) -> add_direction Rule_header.Horizontal
  | Qualifier (Axis Vertical) -> add_direction Rule_header.Vertical
  | Qualifier Orthogonal -> add_direction Rule_header.Orthogonal
  | Late -> { state with modifiers = { modifiers with late = true } }
  | Rigid -> { state with modifiers = { modifiers with rigid = true } }
  | Qualifier Random ->
      (match state.join with
      | Independent -> ()
      | Linked _ ->
          error context
            "A rule-group can only be marked random by the opening rule in the group \
             (aka, a '+' and 'random' can't appear as rule modifiers on the same line).  \
             Why? Well, you see \"random\" isn't a property of individual rules, but of \
             whole rule groups.  It indicates that a single possible application of some \
             rule from the whole group should be applied at random.");
      { state with modifiers = { modifiers with random = true } }
  | Open_row ->
      open_row context state { side = Detection; position = Outside_row empty_cell }
  | _ ->
      error context
        ("The start of a rule must consist of some number of directions (possibly 0), \
          before the first bracket, specifying in what directions to look (with no \
          direction specified, it applies in all four directions).  It seems you've just \
          entered \"" ^ Utf8.uppercase token.word ^ "\".");
      state

let finish context arrow_present state =
  if state.modifiers.late && state.modifiers.rigid then
    error context
      "Late rules cannot be marked as rigid (rigid rules are all about dealing with the \
       consequences of unresolvable movements, and late rules can't even have \
       movements).";
  let lhs = List.rev state.left_rev
  and rhs = List.rev state.right_rev
  and commands = List.rev state.commands_rev in
  let invalid_shapes =
    if List.length lhs <> List.length rhs then (
      if commands = [] || rhs <> [] then (
        warn context
          "Error, when specifying a rule, the number of matches (square bracketed bits) \
           on the left hand side of the arrow must equal the number on the right";
        raise Discard);
      false)
    else
      List.fold_left2
        (fun invalid left right ->
          let mismatch = List.length left <> List.length right in
          if mismatch then
            error context
              "In a rule, each pattern to match on the left must have a corresponding \
               pattern on the right of equal length (number of cells).";
          if left = [] then
            context.emit Error_severity
              "You have an totally empty pattern on the left-hand side.  This will match \
               *everything*.  You certainly don't want this.";
          invalid || mismatch)
        false lhs rhs
  in
  if lhs = [] then error context "This rule refers to nothing.  What the heck? :O";
  let headers =
    Rule_header.
      {
        directions = List.rev state.modifiers.directions_rev;
        late = state.modifiers.late;
        rigid = state.modifiers.rigid;
        random = state.modifiers.random;
        joined = group_line context state.join <> line context;
      }
  in
  ( {
      rule_line = line context;
      group_line = group_line context state.join;
      headers;
      lhs;
      rhs = (if rhs = [] then None else Some rhs);
      commands;
      arrow_present;
    },
    invalid_shapes )

let parse context =
  match context.input with
  | [ { word = "startloop"; _ } ] -> (Some (Start_loop (line context)), false)
  | [ { word = "endloop"; _ } ] -> (Some (End_loop (line context)), false)
  | input -> (
      try
        let arrow_present = List.exists (fun token -> token.kind = Arrow) input in
        if String.contains context.captured.original_text '(' && not arrow_present then (
          error context
            "You can't have comments inside rules, sorry. In PuzzleScript, '(' starts a \
             comment, so everything after the first '(' on this line was ignored before \
             your rule was parsed.";
          raise Discard);
        if not arrow_present then
          error context
            "A rule has to have an arrow in it.  There's no arrow here! Consider reading \
             up about rules - you're clearly doing something weird";
        let rec visit index state = function
          | [] -> state
          | _ when state.phase = Literal_message -> state
          | token :: rest ->
              let state =
                match state.phase with
                | Prelude -> prelude_token context index state token
                | Patterns body -> pattern_token context index rest state body token
                | Literal_message -> state
              in
              visit (index + 1) state rest
        in
        let authored, invalid = finish context arrow_present (visit 0 initial input) in
        (Some (Rule authored), invalid)
      with Discard -> (None, false))

let compile ~known_names ~is_property ~sounds entries =
  let known_names = Names.of_list known_names in
  let diagnostics = ref [] in
  let emit ?line severity message =
    diagnostics :=
      Diagnostics.normalize
        (!diagnostics
        @ [
            {
              location = Option.map (fun line -> { line; column = 1 }) line;
              severity;
              message;
            };
          ])
  in
  let visit (previous, invalid_shapes, reversed) = function
    | Captured_rule captured -> (
        let context =
          {
            captured;
            previous;
            known_names;
            is_property;
            sounds;
            input = tokens captured.captured_text;
            emit;
          }
        in
        let entry, invalid = parse context in
        let previous =
          match entry with Some (Rule authored) -> Some authored | _ -> previous
        in
        ( previous,
          invalid_shapes || invalid,
          match entry with None -> reversed | Some entry -> entry :: reversed ))
    | Rule authored as entry -> (Some authored, invalid_shapes, entry :: reversed)
    | entry -> (previous, invalid_shapes, entry :: reversed)
  in
  let _, invalid_shapes, reversed = List.fold_left visit (None, false, []) entries in
  { entries = List.rev reversed; diagnostics = !diagnostics; invalid_shapes }
