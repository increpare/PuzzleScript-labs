val recover :
  Source_declarations.t ->
  Syntax.rule_entry list ->
  Syntax.rule_entry list * Syntax.diagnostic list
(** Check exclusions while authored names and their source membership are still available.
    Removes redundant negative terms, preserving diagnostic order. *)

val cell_contradiction : Domain.cell_pattern -> Domain.Int_set.t option
(** The first concrete cell that both requires and excludes an identity makes this
    expanded rule impossible. Single-layer property predicates remain alternatives and do
    not themselves require every member. *)

val replacement :
  discard:bool ->
  line:int ->
  Source_declarations.t ->
  Rule_ir.Bound.term list ->
  Syntax.diagnostic list
(** Validate the ordered concrete and random placements in one replacement. A left-side
    overlap suppresses the later concrete overlap error. *)
