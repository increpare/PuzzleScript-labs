val compile :
  report:(int -> string -> unit) ->
  Source_declarations.t ->
  Syntax.win_entry list ->
  Domain.win_condition list
(** Resolve captured win conditions using source membership, independently of the final
    rule-binding and sound-selection namespaces. *)
