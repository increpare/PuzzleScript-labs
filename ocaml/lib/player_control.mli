type t
(** Orthogonal title departure, message selection/closure and action-repeat protocols.
    They deliberately share the controller's external clock. *)

type transition = Idle | Leaving_title | Closing_message | Leaving_both
type action_result = Blocked | Accepted of t

val initial : t
val transition : t -> transition
val title_pending : t -> bool
val message_pending : t -> bool
val message_selected : t -> bool
val ignore_held_action : t -> bool
val press_action : repeated:bool -> repeat_disabled:bool -> t -> action_result
val require_fresh : t -> t
val reset_message_selection : t -> t
val open_message : t -> t
val select_title : t -> t
val select_message : t -> t
val finish_title : t -> t
val finish_message : t -> t
