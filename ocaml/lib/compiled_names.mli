type t

val compile :
  Syntax.legend_declaration list ->
  (t * Syntax.diagnostic list, Syntax.diagnostic list) result
(** Normalize the compiler's distinct name kinds in their observable order. Compound
    aliases share explicit immutable storage slots. Source-time registration and matching
    membership remain separate operations. *)

val alias : t -> string -> string option
val property : t -> string -> string list option
val aggregate : t -> string -> string list option
val names : t -> string list
