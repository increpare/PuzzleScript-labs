type t = private int

val of_utf8 : string -> t list
(** Decode valid UTF-8 source into the UTF-16 units used at legacy text boundaries. This
    does not make the source reader accept invalid UTF-8. *)

val value : t -> int
val whitespace : t -> bool
val trim : t list -> t list

val text : t list -> string
(** Lossless compatibility text. Paired surrogates become ordinary UTF-8; isolated units
    use WTF-8 and are escaped explicitly by the JSON boundary. *)

val single_text : t -> string
val uppercase_text : t -> string
