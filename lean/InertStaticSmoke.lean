import PuzzleScript
import Lean.Data.Json

open Lean
open PuzzleScript

/-!
Smoke: scan JS static / canonicalizer fixtures (via prepared manifest), assert Lean
`syntacticInertCommandOnly` matches JS `inert_command_only`, and that `dropInert`
preserves solver obs. Unsupported tags are ignored; fixtures with none of the
supported tags are omitted from the manifest.
-/

structure InertCase where
  name : String
  irFile : String
  inputs : Array String
  expectInert : Nat
  deriving Repr

structure InertManifest where
  cases : Array InertCase
  scanned : Nat
  skippedNoSupportedTags : Nat
  deriving Repr

def usage : String :=
  "Usage: lake exe inert_static_smoke --fixtures DIR\n\
(DIR contains manifest.json + *.ir.json from scripts/lean_inert_static_prepare.js)"

def parseInputToken (j : Json) : Except String String :=
  match j with
  | .str s => pure s
  | _ => do
    let n ← (Json.getNum? j).mapError toString
    if n.exponent != 0 then
      throw "non-integer input code"
    else
      pure (toString n.mantissa)

def parseInertCase (j : Json) : Except String InertCase := do
  let name ← (j.getObjValAs? String "name").mapError toString
  let irFile ← (j.getObjValAs? String "ir_file").mapError toString
  let expectInert ← (j.getObjValAs? Nat "expect_inert").mapError toString
  let inputsJson ← (j.getObjVal? "inputs").mapError toString
  let inputsArr ← (Json.getArr? inputsJson).mapError toString
  let inputs ← inputsArr.mapM parseInputToken
  pure { name, irFile, inputs, expectInert }

def parseInertManifest (j : Json) : Except String InertManifest := do
  let schema ← (j.getObjValAs? String "schema").mapError toString
  unless schema == "lean-inert-static-manifest-v1" do
    throw s!"unsupported schema: {schema}"
  let casesJson ← (j.getObjVal? "cases").mapError toString
  let casesArr ← (Json.getArr? casesJson).mapError toString
  let cases ← casesArr.mapM parseInertCase
  let scanned ← (j.getObjValAs? Nat "scanned").mapError toString
  let skippedNoSupportedTags ← (j.getObjValAs? Nat "skipped_no_supported_tags").mapError toString
  pure { cases, scanned, skippedNoSupportedTags }

def loadInertManifest (path : System.FilePath) : IO InertManifest := do
  let contents ← IO.FS.readFile path
  match Json.parse contents with
  | .error e => throw <| IO.userError s!"{path}: parse error: {e}"
  | .ok j =>
    match parseInertManifest j with
    | .error e => throw <| IO.userError s!"{path}: schema error: {e}"
    | .ok m => pure m

def countInertRules (g : Game) : Nat :=
  Id.run do
    let mut n := 0
    for group in g.rules do
      for r in group do
        if r.syntacticInertCommandOnly then n := n + 1
    for group in g.lateRules do
      for r in group do
        if r.syntacticInertCommandOnly then n := n + 1
    pure n

def solverObsEq (a b : Session) : Bool :=
  a.board.objects == b.board.objects
    && a.board.movements == b.board.movements
    && a.winning == b.winning
    && a.currentLevel == b.currentLevel

def runCase (fixturesDir : System.FilePath) (c : InertCase) : IO Bool := do
  let (game, session) ← loadIrFile (fixturesDir / c.irFile)
  unless game.noRandomRuleGroups do
    IO.eprintln s!"FAIL {c.name}: expected noRandomRuleGroups"
    return false
  let inertN := countInertRules game
  unless inertN == c.expectInert do
    IO.eprintln s!"FAIL {c.name}: expected {c.expectInert} syntacticInertCommandOnly rule(s), got {inertN}"
    return false
  let g' := Game.dropInert game
  let inertAfter := countInertRules g'
  unless inertAfter == 0 do
    IO.eprintln s!"FAIL {c.name}: dropInert left {inertAfter} inert rule(s)"
    return false
  match replay game session c.inputs none, replay g' session c.inputs none with
  | .error e, _ =>
    IO.eprintln s!"FAIL {c.name}: replay original: {e}"
    return false
  | _, .error e =>
    IO.eprintln s!"FAIL {c.name}: replay dropInert: {e}"
    return false
  | .ok s0, .ok s1 =>
    unless solverObsEq s0 s1 do
      IO.eprintln s!"FAIL {c.name}: dropInert replay diverged on solver obs"
      return false
    IO.println s!"OK {c.name} (inertRules={inertN})"
    return true

def main (args : List String) : IO UInt32 := do
  let fixturesDir ←
    match args with
    | ["--fixtures", dir] => pure (dir : System.FilePath)
    | _ =>
      IO.eprintln usage
      return 2
  let manifest ← loadInertManifest (fixturesDir / "manifest.json")
  if manifest.cases.isEmpty then
    IO.eprintln s!"FAIL: manifest has zero cases (scanned={manifest.scanned})"
    return 1
  IO.println s!"inert static manifest: {manifest.cases.size} case(s) \
(scanned={manifest.scanned}, skipped_no_supported_tags={manifest.skippedNoSupportedTags})"
  let mut failures : Nat := 0
  for c in manifest.cases do
    let ok ← runCase fixturesDir c
    unless ok do failures := failures + 1
  if failures = 0 then
    IO.println "lean inert static smoke: OK"
    pure 0
  else
    IO.eprintln s!"lean inert static smoke: {failures} failure(s)"
    pure 1
