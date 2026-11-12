type prepared

val prepare :
  diagnostics:Compile_diagnostics.t ->
  Source_declarations.t ->
  Syntax.document ->
  prepared
(** Source recovery, orientation, binding, lowering and group assembly run in diagnostic
    order. The prepared result retains provenance for loop checks. *)

val finish :
  diagnostics:Compile_diagnostics.t -> prepared -> Domain.schedule * Domain.schedule
(** Loop diagnostics follow win, metadata and sound compilation in the reference. This
    explicit boundary preserves that order without mixing those concerns. *)
