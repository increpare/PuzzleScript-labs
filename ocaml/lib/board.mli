type t

val empty : t
val create : width:int -> height:int -> t
val of_rows : Domain.cell list list -> t
val rows : t -> Domain.cell list list
val width : t -> int
val height : t -> int
val contains : t -> Domain.position -> bool
val get : t -> Domain.position -> Domain.cell
val set : t -> Domain.position -> Domain.cell -> t
val has_object : int -> t -> bool
val object_count : int -> t -> int

val positions_of_any : ?vertical:bool -> int list -> t -> Domain.position list
(** Coordinates occupied by any selected object, without duplicates, in the same scan
    order as [positions]. Queries and updates preserve old boards. *)

val hash : t -> int
val positions : ?vertical:bool -> t -> Domain.position list
val map : (Domain.position -> Domain.cell -> Domain.cell) -> t -> t
val equal : t -> t -> bool
val equal_objects : t -> t -> bool
val clear_movements : t -> t
val names : Domain.game -> t -> string list list list
val serialize : Domain.game -> t -> string
