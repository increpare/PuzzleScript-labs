type 'a t
(** Indexed collections with owned, immutable array storage. Elements are not copied;
    callers should use immutable element types when sharing snapshots. *)

val of_list : 'a list -> 'a t
val of_array : 'a array -> 'a t
val to_list : 'a t -> 'a list
val to_array : 'a t -> 'a array
val length : 'a t -> int
val get : 'a t -> int -> 'a
val iter : ('a -> unit) -> 'a t -> unit
val mapi : (int -> 'a -> 'b) -> 'a t -> 'b t
val fold_left : ('a -> 'b -> 'a) -> 'a -> 'b t -> 'a
val fold_lefti : ('a -> int -> 'b -> 'a) -> 'a -> 'b t -> 'a
val find_opt : ('a -> bool) -> 'a t -> 'a option
