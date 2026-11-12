type input = Movement of Domain.movement | Tick | Undo | Restart_input | Advance
type mode = Replay | Interactive
type win_request = Check_board | Requested_win
type message_continuation = Resume of win_request | Restart_after_message
type rule_message = { text : string; continuation : message_continuation }
type screen = Playing | Level_message of string | Rule_message of rule_message | Title
type pending_work = Ready | Again_pending | Victory_pending
type viewport = { left : int; top : int; right : int; bottom : int }
type snapshot = { board : Board.t; viewport : viewport option }

type persistence =
  | Set_progress of int
  | Set_checkpoint of snapshot
  | Clear_progress
  | Clear_checkpoint
      (** [Clear_recording level] starts a new input/sound recording for that level at its
          position in the effect stream. It does not clear undo history, audible requests
          or RNG. *)

type session_effect =
  | Sound_effect of { seed : string; simple : bool }
  | Victory of { level : int; suppressed : bool }
  | Persistence of persistence
  | Diagnostic of string
  | Rule_message_opened of string
  | Clear_recording of int

type environment = { next_level_seed : int -> string }

type t = private {
  execution : Execution.t;
  mode : mode;
  pending : pending_work;
  level : int;
  history : snapshot list;
  restart_target : snapshot;
  viewport : viewport option;
  checkpoint : bool;
  screen : screen;
  loaded_seed : string;
}

val again : t -> bool
val winning : t -> bool

type dismissal = Advance_level | Resume_rule of message_continuation

val dismissal : t -> dismissal

val create :
  ?mode:mode ->
  Domain.game ->
  environment ->
  seed:string ->
  level:int ->
  t * session_effect list
(** Start an explicit replay level. A compiler result with diagnosed recovery can contain
    no levels. Raises [Invalid_argument] for an empty seed or an index outside the game's
    level array. *)

val step : Domain.game -> environment -> input -> t -> t * session_effect list

type progress = { level_index : int; checkpoint_board : snapshot option }
(** Saved progress contains a level and an optional persistent checkpoint board.
    Checkpoints restore board/viewport, preserve the supplied seed and skip level-start
    rules. A checkpoint paired with a message level preserves the currently loaded board
    while showing that message. The valid [Board.empty] snapshot can therefore round-trip
    through progress after a title message. Checkpoints do not serialize or rewind the
    random stream. *)

type load_error =
  | Invalid_level of int
  | Unknown_checkpoint_object of int
  | Invalid_checkpoint_viewport

val validate_progress : Domain.game -> progress -> (unit, load_error) result

val create_title :
  ?progress:progress ->
  Domain.game ->
  seed:string ->
  (t * session_effect list, load_error) result

val load_progress :
  Domain.game ->
  environment ->
  seed:string ->
  progress ->
  t ->
  (t * session_effect list, load_error) result

val open_title :
  Domain.game ->
  environment ->
  seed:string ->
  progress ->
  t ->
  (t * session_effect list, load_error) result
(** Open a title selection and emit its persistence effects. Continuing with a checkpoint
    saves the resulting current board as the new restart target, including when the
    selected level is a message. *)

val title : ?level:int -> Domain.game -> t -> t * session_effect list
val acknowledge : Domain.game -> environment -> t -> t * session_effect list

val simple : Domain.game -> Domain.sound_event -> session_effect list
(** Simple event sounds are ordered session effects. *)
