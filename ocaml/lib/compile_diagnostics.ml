open Syntax

exception Stop
exception Invalid of diagnostic

type t = { mutable issues : diagnostic list }

let create () = { issues = [] }
let all sink = sink.issues

let limited issues =
  Diagnostics.normalize issues |> List.filteri (fun index _ -> index <= 100)

let add sink issues =
  let combined = Diagnostics.normalize (sink.issues @ issues) in
  sink.issues <- limited combined;
  if List.length combined > 100 then raise Stop

let report sink ?line severity message =
  add sink
    [
      { location = Option.map (fun line -> { line; column = 1 }) line; severity; message };
    ]

let fatal line message =
  raise
    (Invalid { location = Some { line; column = 1 }; severity = Error_severity; message })

let rejected sink issues = limited (sink.issues @ issues)
