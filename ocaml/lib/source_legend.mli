type t

type resolution =
  | Object_name of string
  | Property_name of string * string list
  | Aggregate_name of string * string list
  | Undeclared_name of string

val of_declarations :
  Syntax.object_declaration list -> Syntax.legend_declaration list -> t
(** Source-time lookup uses the first registration of each kind, follows aliases, and
    gives actual objects priority. This differs from the final compiler dictionaries. *)

val lookup : t -> string -> resolution

val read_line :
  ?diagnostics_before:int ->
  ?previous:Syntax.legend_declaration list ->
  reserved_names:string list ->
  errors_before:int ->
  Syntax.object_declaration list ->
  Source_line.t ->
  (Syntax.legend_declaration list Source_line.reading, Syntax.diagnostic list) result
(** Read raw physical visits, preserving comment nesting and end-of-line finalization.
    Only registered entries are returned; malformed tokens and forward references remain
    diagnosed. *)
