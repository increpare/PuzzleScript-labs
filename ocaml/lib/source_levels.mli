type source_line = { number : int; raw : string; comment_depth : int }

val read :
  ?diagnostics_before:int ->
  known_glyphs:string list ->
  errors_before:int ->
  source_line list ->
  (Syntax.raw_level list * Syntax.diagnostic list, Syntax.diagnostic list) result
(** Capture source rows/messages, then validate live glyph units separately. Comments can
    end a captured prefix without ending validation of the line. *)
