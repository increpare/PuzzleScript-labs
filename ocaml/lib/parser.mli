val parse : string -> (Syntax.document, Syntax.diagnostic list) result
(** Parse strict UTF-8 source in physical order, retaining both syntax and diagnosed
    recovery. The sixth counted source error stops reading. *)
