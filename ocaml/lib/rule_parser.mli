val command : string -> Domain.command option
(** Structural rule parsing follows source capture. Modes carry their row/cell builders;
    malformed bracket depth remains an independent recovery count. *)

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
