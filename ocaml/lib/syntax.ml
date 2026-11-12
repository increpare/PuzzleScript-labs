type location = { line : int; column : int }
type severity = Error_severity | Warning_severity
type diagnostic = { location : location option; message : string; severity : severity }
type object_alias = { alias_line : int; alias_name : string }

type object_declaration = {
  object_line : int;
  object_name : string;
  object_aliases : object_alias list;
  colors : string list;
  sprite : string list;
}

let object_names declaration =
  declaration.object_name
  :: List.map (fun alias -> alias.alias_name) declaration.object_aliases

type legend_expression =
  | Alias of string
  | Alternatives of string list
  | Constituents of string list

type legend_declaration = {
  legend_line : int;
  legend_name : string;
  expression : legend_expression;
}

let object_legend_aliases declaration =
  List.map
    (fun alias ->
      {
        legend_line = alias.alias_line;
        legend_name = alias.alias_name;
        expression = Alias declaration.object_name;
      })
    declaration.object_aliases

type term = { term_name : string; qualifier : Qualifier.t option }
type pattern_item = Named of term | Ellipsis of string
type pattern_cell = pattern_item list

(* A malformed pending qualifier can consume the first half of an ellipsis,
   leaving its second half to qualify a later name. Keep that recovered name
   on the ellipsis, while ordinary ellipses carry the spelling "...". *)
let item_contents = function
  | Named term -> term
  | Ellipsis term_name -> { term_name; qualifier = Some Qualifier.Ellipsis }

let item_of_contents term =
  if term.qualifier = Some Qualifier.Ellipsis then Ellipsis term.term_name else Named term

let cell_contents cell = List.map item_contents cell
let map_contents f cell = List.map item_of_contents (f (cell_contents cell))

let has_ellipsis_name = function
  | [] -> false
  | first :: _ -> (item_contents first).term_name = "..."

type authored_rule = {
  rule_line : int;
  group_line : int;
  headers : Rule_header.t;
  lhs : pattern_cell list list;
  arrow_present : bool;
  rhs : pattern_cell list list option;
  commands : Domain.command list;
}

type discarded_rule = {
  discarded_line : int;
  raw : string;
  diagnostics : diagnostic list;
}

type captured_rule = {
  captured_line : int;
  captured_text : string;
  original_text : string;
}

type rule_entry =
  | Captured_rule of captured_rule
  | Rule of authored_rule
  | Start_loop of int
  | End_loop of int
  | Discarded_rule of discarded_rule

type level_row = { level_line : int; glyphs : Code_unit.t list }
type level_message = { message_line : int; message_units : Code_unit.t list }
type raw_level = Grid of level_row list | Level_text of level_message

type collision_layer = {
  layer_line : int;
  source_names : string list;
  occupants : string list;
}

type authored_win = {
  win_line : int;
  win_quantifier : Domain.win_quantifier;
  win_subject : string;
  win_target : string option;
}

type win_entry = Incomplete_win of int | Win_condition of authored_win

type sound_event = Domain.sound_event =
  | Slot_event of int
  | Title_event
  | Start_game_event
  | End_game_event
  | Start_level_event
  | End_level_event
  | Undo_event
  | Restart_event
  | Cancel_event
  | Show_message_event
  | Close_message_event

type sound_verb =
  | Move_sound
  | Action_sound
  | Failure_sound
  | Create_sound
  | Destroy_sound

type sound_seed = Numeric_seed of string | Recovered_seed of string

type sound_entry =
  | Incomplete_sound of { sound_line : int; declared_event : sound_event option }
  | Event_sound of { sound_line : int; sound_event : sound_event; event_seed : string }
  | Object_sound of {
      sound_line : int;
      sound_target : string;
      sound_verb : sound_verb;
      sound_directions : Domain.Movements.t;
      object_seed : sound_seed;
    }

type document = {
  objects : object_declaration list;
  legend : legend_declaration list;
  collision_layers : collision_layer list;
  rule_names : string list;
  rules : rule_entry list;
  wins : win_entry list;
  sounds : sound_entry list;
  levels : raw_level list;
  metadata : (int * string * string) list;
  diagnostics : diagnostic list;
}
