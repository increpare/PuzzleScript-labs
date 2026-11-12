type message_latch

type t = private {
  board : Board.t;
  random : Random_stream.t;
  commands : Domain.command list;
  message : message_latch;
  marks : int Domain.Int_map.t Domain.Positions.t;
  banned : Domain.Int_set.t;
  created : Domain.Int_set.t;
  destroyed : Domain.Int_set.t;
  succeeded_sounds : string list;
  failed_sounds : string list;
  diagnostics : string list;
}

val create : Board.t -> string -> t
val turn : Domain.game -> Domain.movement option -> t -> t
val apply_schedule : Domain.game -> Domain.schedule -> t -> t
val has_won : Domain.game -> Board.t -> bool

val restore : Board.t -> t -> t
(** Session transitions preserve RNG and event bookkeeping when restoring only board
    snapshots. These are explicit operations, not mutable record access. *)

val clear_commands : t -> t
val keep_commands : (Domain.command -> bool) -> t -> t
val message_text : t -> string
val has_message : t -> bool
val set_message : string -> t -> t
val restore_commands : t -> t -> t
val load : Board.t -> string -> t -> t
val reseed : string -> t -> t
