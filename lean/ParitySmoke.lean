import PuzzleScript

open PuzzleScript.Fixtures

def usage : String :=
  "Usage: lake exe parity_smoke --fixtures DIR --whitelist FILE"

partial def parseArgs (args : List String) (fixtures : Option System.FilePath)
    (whitelist : Option System.FilePath) :
    Except String (System.FilePath × System.FilePath) :=
  match args with
  | [] =>
    match fixtures, whitelist with
    | some f, some w => pure (f, w)
    | _, _ => throw usage
  | "--fixtures" :: dir :: rest => parseArgs rest (some dir) whitelist
  | "--whitelist" :: file :: rest => parseArgs rest fixtures (some file)
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
  let selected ←
    match selectFixtures manifest names with
    | .error e =>
      IO.eprintln e
      return 2
    | .ok x => pure x
  let mut failures : Nat := 0
  for fx in selected do
    IO.println s!"TODO runtime: {fx.name} ({fx.id}) inputs={fx.inputs.size}"
    failures := failures + 1
  if failures = 0 then
    IO.println "lean parity smoke: OK"
    pure 0
  else
    IO.eprintln s!"lean parity smoke: {failures} case(s) not implemented"
    pure 1
