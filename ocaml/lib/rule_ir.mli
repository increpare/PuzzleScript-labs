type identity = {
  source_line : int;
  source_direction : Direction.t option;
  source_lhs : Syntax.pattern_cell list list;
  source_rhs : Syntax.pattern_cell list list option;
  source_commands : Domain.command list;
  source_rigid : bool;
  source_random : bool;
}
(** Compiler provenance retained until source-identity deduplication. *)

module Identities : Set.S with type elt = identity

module Oriented : sig
  type t = {
    authored : Syntax.authored_rule;
    direction : Direction.t;
    left : Syntax.pattern_cell list list;
    right : Syntax.pattern_cell list list option;
  }
end

module Bound : sig
  type qualifier =
    | Unspecified
    | Excluded
    | Stationary
    | Movement of Domain.movement
    | Random_object
    | Random_direction

  type term = { name : string; qualifier : qualifier }
  type item = Named of term | Ellipsis of string
  type cell = { detection : item list; replacement : item list option }
  type error = Unresolved_movement of Qualifier.t | Mismatched_patterns

  type t = private {
    authored : Syntax.authored_rule;
    direction : Direction.t;
    rows : cell list list;
    identity : identity;
  }

  val of_oriented : identity:identity -> Oriented.t -> (t, error) result
  (** Construction rejects unresolved movements and mismatched pattern shapes. Each
      detection cell is paired with its replacement before lowering. *)
end

type lowered = {
  identity : identity;
  rule : Domain.rule;
  overlap : (string * string) option;
  source_group : int;
  late : bool;
}
