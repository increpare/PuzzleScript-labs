val read : (int * string) list -> (int * string * string) list * Syntax.diagnostic list
(** Read prelude declarations, preserving recognized values and diagnosed recovery. Stops
    after the reference frontend's sixth counted error. *)

type t
(** Persistent prelude state. Raw physical lines retain captured values and the lexical
    visits after comments, including original-case UTF-16 offsets. *)

val initial : t
val entries : t -> (int * string * string) list
val diagnostics : t -> Syntax.diagnostic list
val comment_depth : t -> int

val feed :
  ?diagnostics_before:int ->
  errors_before:int ->
  comment_depth:int ->
  t ->
  int * string ->
  t

val compile : (int * string * string) list -> Domain.metadata * Syntax.diagnostic list
(** Resolve session metadata. Invalid screen dimensions warn and remove that setting;
    earlier duplicate settings have already been superseded. *)

val check_palettes : (int * string * string) list -> Syntax.diagnostic list
(** Palette declarations are checked in source order before sprite validation;
    presentation colors use their final values at the end of compilation. *)

val check_presentation : (int * string * string) list -> Syntax.diagnostic list
