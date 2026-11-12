open Syntax

(* Diagnostics are values, collected by the source/compiler operation that
   owns them. The legacy presentation deduplicates by line, severity and text;
   columns still retain the first occurrence's more precise source position. *)
module Keys = Set.Make (struct
  type t = int option * severity * string

  let compare = compare
end)

let normalize diagnostics =
  let _, reversed =
    List.fold_left
      (fun (seen, kept) diagnostic ->
        let key =
          ( Option.map (fun location -> location.line) diagnostic.location,
            diagnostic.severity,
            diagnostic.message )
        in
        if Keys.mem key seen then (seen, kept) else (Keys.add key seen, diagnostic :: kept))
      (Keys.empty, []) diagnostics
  in
  List.rev reversed

let error_count diagnostics =
  List.fold_left
    (fun count diagnostic ->
      (* Vanilla's unlocated warnings increment its error counter. This quirk is
     explicit at the compatibility boundary, separate from logical severity. *)
      count
      +
      if diagnostic.severity = Error_severity || diagnostic.location = None then 1 else 0)
    0 diagnostics
