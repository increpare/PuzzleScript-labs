val read_line :
  ?diagnostics_before:int ->
  known_names:string list ->
  errors_before:int ->
  Source_line.t ->
  (Syntax.win_entry list Source_line.reading, Syntax.diagnostic list) result
(** Read raw physical visits and capture win prefixes independently of validation. A
    leading stray closer prevents capture, without suppressing token errors. Diagnosed
    separators and excess tokens do not erase the reference's recovered meaning. Stops
    after the sixth counted source error. *)
