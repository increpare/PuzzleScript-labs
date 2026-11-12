type t
(** Persistent snapshots of vanilla PuzzleScript's seeded RC4 stream. *)

val create : string -> t
val draw : t -> float * t
val choose : int -> t -> int * t
val indices : t -> int * int
val permutation : t -> int list

val preview : int -> t -> int list
(** Inspect bytes without consuming the snapshot. Negative counts raise
    [Invalid_argument]. *)

val equal : t -> t -> bool
