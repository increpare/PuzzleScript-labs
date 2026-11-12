type t
(** One compiler-owned diagnostic sink preserves cross-pass order and the immediate
    101st-diagnostic stop. Source-token error stopping belongs to readers. *)

exception Stop
exception Invalid of Syntax.diagnostic

val create : unit -> t
val all : t -> Syntax.diagnostic list
val add : t -> Syntax.diagnostic list -> unit
val report : t -> ?line:int -> Syntax.severity -> string -> unit
val fatal : int -> string -> 'a
val rejected : t -> Syntax.diagnostic list -> Syntax.diagnostic list
