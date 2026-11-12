type section = Metadata | Objects | Legend | Sounds | Layers | Rules | Wins | Levels
type t
type event = Header of section | Content of Source_line.t | Blank | Separator | Ignored

val heading_prefix : string -> (section * int) option
(** Match a heading prefix and its trailing spaces at a lexical boundary. *)

val initial : t
val section : t -> section
val comment_depth : t -> int
val with_comment_depth : int -> t -> t

val line :
  errors_before:int ->
  diagnostics_before:int ->
  t ->
  number:int ->
  string ->
  t * event * Syntax.diagnostic list
(** Route one physical line and retain header order. Reader-owned section bodies receive
    raw text and its initial comment depth, then return their final depth through
    [with_comment_depth]. Header suffixes obey the line-ending gate, without treating
    ignored suffix text as new comments. *)
