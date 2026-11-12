type sides = {
  left : Syntax.pattern_cell list list;
  right : Syntax.pattern_cell list list;
}

type expansion = { variants : sides list; unresolved : string option }

val movements : direction:Direction.t -> sides -> expansion
(** Expand movements before property alternatives change source names. Evidence
    distinguishes an attached name/qualifier pair from a unique qualifier, and records the
    source cell rather than an inferred board identity. *)

val properties : Source_declarations.t -> sides -> expansion
(** Keep local single-layer properties as predicates. Transported properties need local
    evidence or a unique occurrence; an unresolved replacement drops this source variant,
    while retaining its diagnostic. *)

val stationary_spawns : Source_declarations.t -> sides -> sides
(** Mark new concrete occupants stationary after inference. Even an exclusion contributes
    source layer information here; runtime predicates still retain the exclusion's
    ordinary meaning. *)
