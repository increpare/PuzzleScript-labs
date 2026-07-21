import PuzzleScript
import Lean.Data.Json

open Lean
open PuzzleScript
open PuzzleScript.Fixtures

def usage : String :=
  "Usage: lake exe parity_smoke --fixtures DIR --whitelist FILE"

def missingFlagValue (flag : String) : String :=
  s!"missing value for {flag}\n{usage}"

def looksLikeFlag (s : String) : Bool :=
  s.startsWith "--"

partial def parseArgs (args : List String) (fixtures : Option System.FilePath)
    (whitelist : Option System.FilePath) :
    Except String (System.FilePath × System.FilePath) :=
  match args with
  | [] =>
    match fixtures, whitelist with
    | some f, some w => pure (f, w)
    | _, _ => throw usage
  | "--fixtures" :: [] => throw (missingFlagValue "--fixtures")
  | "--fixtures" :: val :: rest =>
    if looksLikeFlag val then throw (missingFlagValue "--fixtures")
    else parseArgs rest (some val) whitelist
  | "--whitelist" :: [] => throw (missingFlagValue "--whitelist")
  | "--whitelist" :: val :: rest =>
    if looksLikeFlag val then throw (missingFlagValue "--whitelist")
    else parseArgs rest fixtures (some val)
  | other :: _ => throw s!"unknown arg: {other}\n{usage}"

def main (args : List String) : IO UInt32 := do
  let (fixturesDir, whitelistPath) ←
    match parseArgs args none none with
    | .error e =>
      IO.eprintln e
      return 2
    | .ok x => pure x
  let manifest ← loadManifest (fixturesDir / "fixtures.json")
  let names ← loadWhitelist whitelistPath
  if names.isEmpty then
    IO.eprintln s!"whitelist is empty (no case names after comments/blanks): {whitelistPath}"
    return 2
  let selected ←
    match selectFixtures manifest names with
    | .error e =>
      IO.eprintln e
      return 2
    | .ok x => pure x
  let mut failures : Nat := 0
  for fx in selected do
    let irPath := fixturesDir / fx.irFile
    let (game, session) ← loadIrFile irPath
    let got := serializeLevel game.idDict session.board
    let preparedSerialized ← do
      let contents ← IO.FS.readFile irPath
      match Json.parse contents with
      | .error e => throw <| IO.userError s!"{irPath}: parse error: {e}"
      | .ok j =>
        match loadPreparedSerializedLevel j with
        | .error e => throw <| IO.userError s!"{irPath}: {e}"
        | .ok s => pure s
    if got != preparedSerialized then
      IO.eprintln s!"{fx.name}: initial serialize mismatch"
      failures := failures + 1
    else
      IO.println s!"{fx.name}: initial serialize OK"
      IO.println s!"TODO runtime: {fx.name} ({fx.id}) inputs={fx.inputs.size}"
      failures := failures + 1
  if failures = 0 then
    IO.println "lean parity smoke: OK"
    pure 0
  else
    IO.eprintln s!"lean parity smoke: {failures} case(s) not implemented"
    pure 1
