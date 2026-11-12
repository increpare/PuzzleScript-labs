val schedule :
  report:(int -> string -> unit) -> Rule_ir.lowered list -> late:bool -> Domain.schedule
(** Form surviving source groups before attaching loop boundaries. *)

val check_gaps :
  report:(int -> string -> unit) ->
  warn:(int -> string -> unit) ->
  Domain.schedule ->
  unit

val check_rigid_limit : report:(int -> string -> unit) -> Domain.schedule -> unit

val loop_pairs :
  report:(int -> string -> unit) -> Syntax.rule_entry list -> (int * int) list

val attach_loops :
  report:(int -> string -> unit) -> (int * int) list -> Domain.schedule -> Domain.schedule
