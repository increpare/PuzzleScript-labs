val source : Source_declarations.t -> line:int -> string -> Domain.name
(** Source registration, final selection and matching membership are distinct views after
    diagnosed declaration recovery. *)

val selection : Source_declarations.t -> string -> Domain.name
val layers : Source_declarations.t -> Domain.name -> Domain.Int_set.t
val membership : Source_declarations.t -> string -> Domain.object_reference list
val matching : Source_declarations.t -> string -> Domain.name
