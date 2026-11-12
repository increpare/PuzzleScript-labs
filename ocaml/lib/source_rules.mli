val read_line :
  ?diagnostics_before:int ->
  known_names:string list ->
  errors_before:int ->
  Source_line.t ->
  (Syntax.rule_entry list Source_line.reading, Syntax.diagnostic list) result
(** Validate live rule tokens and capture their source prefix. The later structural
    compiler has its own recovery and diagnostic order. Raw visits own comment depth,
    literal message mode and consumed heading suffixes. *)

type compilation = {
  entries : Syntax.rule_entry list;
  diagnostics : Syntax.diagnostic list;
  invalid_shapes : bool;
}

val compile :
  known_names:string list ->
  is_property:(string -> bool) ->
  sounds:Syntax.sound_entry list ->
  Syntax.rule_entry list ->
  compilation
(** Recover rule headers, cells, commands and source group identities without resolving
    properties into masks or importing the reference's pair arrays. *)
