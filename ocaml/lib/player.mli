(** Persistent interactive control. The host supplies button presses and elapsed frame
    time; no wall clock, rendering, keyboard repeat loop or storage I/O is hidden inside
    the interpreter. [Session.step] remains available for direct headless replay. *)
type button = Direction of Direction.t | Action | Undo | Restart | Menu

type choice = New_game | Continue

type transition = Player_control.transition =
  | Idle
  | Leaving_title
  | Closing_message
  | Leaving_both

type t = private {
  session : Session.t;
  choice : choice;
  control : Player_control.t;
  timer_ms : float;
  autotick_ms : float;
  input_throttle_ms : float;
  last_direction : Direction.t option;
  continue_target : Session.snapshot option;
  saved_level : int option;
  saved_checkpoint : Session.snapshot option;
}

val transition : t -> transition
val message_selected : t -> bool
val ignore_held_action : t -> bool
val can_continue : t -> bool

val create :
  ?progress:Session.progress ->
  Domain.game ->
  seed:string ->
  (t * Session.session_effect list, Session.load_error) result

val start :
  Domain.game ->
  Session.environment ->
  seed:string ->
  level:int ->
  (t * Session.session_effect list, Session.load_error) result

val resume :
  Domain.game ->
  Session.environment ->
  seed:string ->
  Session.progress ->
  (t * Session.session_effect list, Session.load_error) result

val observe_progress :
  Domain.game -> Session.progress option -> t -> (t, Session.load_error) result
(** Report actual persisted progress after host I/O, a failed write, or an external
    replacement. This does not reload the board, reset timers, change title selection or
    emit effects. The next title entry reads the observed values. Invalid progress returns
    [Error] without changing the old state. *)

val press :
  ?repeated:bool ->
  Domain.game ->
  Session.environment ->
  button ->
  t ->
  t * Session.session_effect list
(** Repeated action presses obey action-repeat metadata and the release barrier after a
    screen transition. Direction repeat scheduling belongs to the host. *)

val elapse :
  Domain.game ->
  Session.environment ->
  milliseconds:float ->
  t ->
  t * Session.session_effect list
(** Advance one frame, preserving the reference's strict 150/300/500 ms message, title and
    victory boundaries. Negative/nonfinite time raises [Invalid_argument]. Each frame runs
    at most one AGAIN and one realtime turn, matching the source event loop rather than
    subdividing large elapsed intervals. *)
