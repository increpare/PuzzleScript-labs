val compile :
  report:(int -> string -> unit) ->
  Source_declarations.t ->
  Syntax.rule_entry list ->
  Rule_ir.Bound.t list
(** Orient source rules, normalize names, infer movements and properties, then deduplicate
    with source provenance. Only fully bound rules leave this pass. *)
