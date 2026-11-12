val read_line :
  ?diagnostics_before:int ->
  registry:Source_legend.t ->
  previous:Syntax.collision_layer list ->
  errors_before:int ->
  Source_line.t ->
  (Syntax.collision_layer list Source_line.reading, Syntax.diagnostic list) result
(** Read raw collision-layer visits using only declarations registered so far. Leading
    closers continue the preceding layer. Unexpected astral scalars produce separate
    UTF-16 diagnostics; the source itself remains strict UTF-8. The compiler allocates
    identities from the retained concrete names. *)
