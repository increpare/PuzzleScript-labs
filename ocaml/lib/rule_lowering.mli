val compile :
  report:(int -> string -> unit) ->
  warn:(int -> string -> unit) ->
  Source_declarations.t ->
  Rule_ir.Bound.t ->
  Rule_ir.lowered option
(** Lower fully bound cells to domain predicates and transactions. Source-order
    recovery/diagnostics run before discarded variants leave this pass. *)
