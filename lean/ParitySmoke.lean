import PuzzleScript
import Lean.Data.Json

open Lean
open PuzzleScript
open PuzzleScript.Fixtures

def usage : String :=
  "Usage: lake exe parity_smoke --fixtures DIR --whitelist FILE [--max-inputs N] [--check-session-wf]"

def missingFlagValue (flag : String) : String :=
  s!"missing value for {flag}\n{usage}"

def looksLikeFlag (s : String) : Bool :=
  s.startsWith "--"

partial def parseArgs (args : List String) (fixtures : Option System.FilePath)
    (whitelist : Option System.FilePath) (maxInputs : Option Nat) (printSerialize : Bool)
    (checkSessionWf : Bool) :
    Except String (System.FilePath × System.FilePath × Option Nat × Bool × Bool) :=
  match args with
  | [] =>
    match fixtures, whitelist with
    | some f, some w => pure (f, w, maxInputs, printSerialize, checkSessionWf)
    | _, _ => throw usage
  | "--fixtures" :: [] => throw (missingFlagValue "--fixtures")
  | "--fixtures" :: val :: rest =>
    if looksLikeFlag val then throw (missingFlagValue "--fixtures")
    else parseArgs rest (some val) whitelist maxInputs printSerialize checkSessionWf
  | "--whitelist" :: [] => throw (missingFlagValue "--whitelist")
  | "--whitelist" :: val :: rest =>
    if looksLikeFlag val then throw (missingFlagValue "--whitelist")
    else parseArgs rest fixtures (some val) maxInputs printSerialize checkSessionWf
  | "--max-inputs" :: [] => throw (missingFlagValue "--max-inputs")
  | "--max-inputs" :: val :: rest =>
    match val.toNat? with
    | none => throw s!"invalid --max-inputs: {val}"
    | some n => parseArgs rest fixtures whitelist (some n) printSerialize checkSessionWf
  | "--print-serialize" :: rest =>
    parseArgs rest fixtures whitelist maxInputs true checkSessionWf
  | "--check-session-wf" :: rest =>
    parseArgs rest fixtures whitelist maxInputs printSerialize true
  | other :: _ => throw s!"unknown arg: {other}\n{usage}"

def main (args : List String) : IO UInt32 := do
  let (fixturesDir, whitelistPath, maxInputs, printSerialize, checkSessionWf) ←
    match parseArgs args none none none false false with
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
    if checkSessionWf && !(Session.wellFormed game session) then
      IO.eprintln s!"FAIL {fx.name}: initial session not Session.wellFormed"
      failures := failures + 1
      continue
    if checkSessionWf && !(Game.levelsBoardsOk game) then
      IO.eprintln s!"FAIL {fx.name}: game levels not Game.levelsBoardsOk"
      failures := failures + 1
      continue
    match replay game session fx.inputs maxInputs with
    | .error e =>
      IO.eprintln s!"FAIL {fx.name}: {e}"
      failures := failures + 1
    | .ok s =>
      if checkSessionWf && !(Session.wellFormed game s) then
        IO.eprintln s!"FAIL {fx.name}: final session not Session.wellFormed"
        failures := failures + 1
        continue
      let got := serializeLevel game.idDict s.board
      if printSerialize then
        IO.println got
        return 0
      if got == fx.expectedSerializedLevel then
        IO.println s!"OK {fx.name}"
      else
        IO.eprintln s!"FAIL {fx.name}\nexpected:\n{fx.expectedSerializedLevel}\ngot:\n{got}"
        failures := failures + 1
  if failures = 0 then
    IO.println "lean parity smoke: OK"
    pure 0
  else
    IO.eprintln s!"lean parity smoke: {failures} case(s) not implemented"
    pure 1
