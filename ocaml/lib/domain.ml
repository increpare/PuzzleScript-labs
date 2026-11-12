module Int_set = Set.Make (Int)
module Int_map = Map.Make (Int)
module Names = Map.Make (String)

type movement = Move of Direction.t | Action

module Movements = Set.Make (struct
  type t = movement

  let compare = compare
end)

type position = int * int

module Positions = Map.Make (struct
  type t = position

  let compare = compare
end)

type cell = { objects : Int_set.t; movements : Movements.t Int_map.t }

let empty_cell = { objects = Int_set.empty; movements = Int_map.empty }

let movements layer cell =
  Option.value ~default:Movements.empty (Int_map.find_opt layer cell.movements)

let set_movements layer values cell =
  {
    cell with
    movements =
      (if Movements.is_empty values then Int_map.remove layer cell.movements
       else Int_map.add layer values cell.movements);
  }

(* A source reference and a board identity need not coincide after diagnosed
   declaration recovery. Preserve both explicitly instead of relying on packed
   undefined-index coercions. Missing layer information remains inspectable. *)
type object_reference = {
  object_id : int option;
  source_name : string;
  source_layer : int option;
}

type name =
  | Object of object_reference
  | Property of object_reference list
  | Aggregate of object_reference list

let references = function
  | Object reference -> [ reference ]
  | Property refs | Aggregate refs -> refs

let members name =
  List.filter_map (fun reference -> reference.object_id) (references name)

let reference_layer reference = Option.value ~default:0 reference.source_layer

let has_reference objects reference =
  Option.fold ~none:false ~some:(fun id -> Int_set.mem id objects) reference.object_id

let matches_name objects = function
  | Object reference -> has_reference objects reference
  | Property refs -> List.exists (has_reference objects) refs
  | Aggregate refs ->
      List.for_all (fun id -> Int_set.mem id objects) (members (Aggregate refs))

type object_definition = {
  id : int;
  name : string;
  layer : int;
  colors : string list;
  sprite : string list;
}

type command =
  | Again
  | Cancel
  | Restart
  | Checkpoint
  | Win
  | Message of string
  | Sound of int

type win_quantifier = No | Exists | For_all
type win_condition = { quantifier : win_quantifier; subject : name; on : name option }

(* These describe domain predicates and transactions, rather than compiled
   masks or snippets of generated matching code. *)
type movement_test = Unspecified | Stationary | Moving of movement

type predicate =
  | Present of name * movement_test
  | Absent of name
  | Layer_movement of int * movement_test

type placement_movement = Preserve | Set of movement | Clear | Random_direction

type placement = {
  occupants : int list;
  movement_layers : Int_set.t;
  motion : placement_movement;
  random : bool;
  concrete : bool;
}

type cell_pattern = { predicates : predicate list }

type cell_edit = {
  remove : Int_set.t;
  clear_layers : Int_set.t;
  placements : placement list;
  remove_movements : (int * movement) list;
  reset_movements : Int_set.t;
}

type segment = Gap | Cell of cell_pattern * cell_edit option

type rule = {
  line : int;
  direction : Direction.t;
  rows : segment list list;
  commands : command list;
  rigid : bool;
}

type group = { random : bool; rules : rule list }
type schedule = { groups : group Frozen_array.t; loops : int Int_map.t }
type level = Board of cell list list | Text of string

type sound_event =
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

type sound_trigger =
  | On_move
  | On_failure
  | On_create
  | On_destroy
  | Simple of sound_event

type sound_definition = {
  selection : name option;
  trigger : sound_trigger;
  directions : Movements.t;
  seed : string;
}

type metadata = {
  run_rules_on_level_start : bool;
  require_player_movement : bool;
  no_action : bool;
  no_undo : bool;
  no_restart : bool;
  flickscreen : (int * int) option;
  zoomscreen : (int * int) option;
  again_interval_ms : float;
  realtime_interval_ms : float;
  no_repeat_action : bool;
  throttle_movement : bool;
  key_repeat_interval_ms : float;
}

let default_metadata =
  {
    run_rules_on_level_start = false;
    require_player_movement = false;
    no_action = false;
    no_undo = false;
    no_restart = false;
    flickscreen = None;
    zoomscreen = None;
    again_interval_ms = 150.;
    realtime_interval_ms = 0.;
    no_repeat_action = false;
    throttle_movement = false;
    key_repeat_interval_ms = 150.;
  }

type game = {
  objects : object_definition Frozen_array.t;
  names : name Names.t;
  glyphs : int list Names.t;
  layers : Int_set.t Frozen_array.t;
  background : object_reference option;
  player : name;
  early : schedule;
  late : schedule;
  wins : win_condition list;
  levels : level Frozen_array.t;
  sounds : sound_definition list;
  metadata : metadata;
}
