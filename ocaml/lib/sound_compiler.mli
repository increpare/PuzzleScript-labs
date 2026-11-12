val compile :
  report:(int -> string -> unit) ->
  warn:(int -> string -> unit) ->
  Source_declarations.t ->
  Syntax.sound_entry list ->
  Domain.sound_definition list
(** Resolve object sounds and last-definition simple events in source order. *)
