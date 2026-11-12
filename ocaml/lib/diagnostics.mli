val normalize : Syntax.diagnostic list -> Syntax.diagnostic list
(** Retain the first occurrence of each line/severity/message combination. *)

val error_count : Syntax.diagnostic list -> int
(** Count errors as the reference compiler does, including its historical
    unlocated-warning quirk. Logical severity remains available separately. *)
