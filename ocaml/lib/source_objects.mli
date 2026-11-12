val read :
  ?diagnostics_before:int ->
  reserved_names:string list ->
  errors_before:int ->
  (int * string) list ->
  (Syntax.object_declaration list * Syntax.diagnostic list, Syntax.diagnostic list) result
(** Read object lines using explicit name/color/sprite phases. Physical blank lines reset
    the phase, while callers omit comment-only physical lines. Failed tokens are diagnosed
    without inventing declarations. *)

val is_color : string -> bool
(** Validate a whole named/hex color, unlike the object's prefix tokenizer. *)

type t
(** Persistent source-order reader. Section entry resets only the lexical phase;
    declarations and aliases already registered remain available. *)

val initial : t
val reset_section : t -> t
val add_aliases : string list -> t -> t
val declarations : t -> Syntax.object_declaration list
val diagnostics : t -> Syntax.diagnostic list

val feed_raw :
  ?diagnostics_before:int ->
  reserved_names:string list ->
  errors_before:int ->
  comment_depth:int ->
  t ->
  int * string ->
  t
(** Consume raw physical text, preserving comment boundaries and lexical visits. The
    caller supplies the initial cross-section comment depth. *)

val comment_depth : t -> int
