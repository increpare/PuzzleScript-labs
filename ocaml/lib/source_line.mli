type t = { number : int; raw : string; comment_depth : int }
(** A physical source line and its initial nested-comment depth. *)

type 'a reading = {
  value : 'a;
  comment_depth : int;
  diagnostics : Syntax.diagnostic list;
}

val left_trim : string -> string
val drop : int -> string -> string
val before_comment : string -> string * string

val comment : int -> string -> int * string
(** Consume a comment from the given initial depth, including an opening parenthesis when
    depth is zero. Return its final depth and unconsumed text. *)

val close_warning : string

val original_suffix : normalized_offset:int -> string -> string
(** Recover original spelling at a byte boundary in the lowercased physical line. Unicode
    case expansions before that boundary do not shift the result. *)
