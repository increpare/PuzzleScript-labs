val event_name : Syntax.sound_event -> string
val declares_event : Syntax.sound_event -> Syntax.sound_entry list -> bool

val read_line :
  ?diagnostics_before:int ->
  known_names:string list ->
  errors_before:int ->
  Source_line.t ->
  (Syntax.sound_entry list Source_line.reading, Syntax.diagnostic list) result
(** Read complete/incomplete sound declarations through raw physical visits, returning
    their final nested-comment depth. Midline headings are consumed within the current
    visit and do not change sections. A failed line is consumed without registering its
    valid-looking suffix. Numeric seeds retain their spelling; missing final seeds remain
    explicit recovered tokens for compiler-stage diagnostics and sound construction. *)
