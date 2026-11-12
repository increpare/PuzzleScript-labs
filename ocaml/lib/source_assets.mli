val check : Syntax.object_declaration list -> Syntax.diagnostic list
(** Compiler-stage diagnostics for declared sprite and color data. *)

val dictionary_order : Syntax.object_declaration list -> Syntax.object_declaration list
(** The reference enumerates canonical unsigned integer names before other names,
    retaining registration order for the latter. This order is separate from physical
    source order and collision-layer identity allocation. *)
