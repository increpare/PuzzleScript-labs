import Lean.Data.Json
open Lean

namespace PuzzleScript.Fixtures

structure SimFixture where
  id : String
  name : String
  irFile : String
  traceFile : String
  /-- JS-export replay tokens: direction codes as decimal strings (`"0"`–`"4"`), plus `"undo"` / `"restart"` when present. -/
  inputs : Array String
  expectedSerializedLevel : String
  deriving Repr

structure Manifest where
  simulationFixtures : Array SimFixture
  deriving Repr

def parseInputToken (j : Json) : Except String String :=
  match j with
  | .str s => pure s
  | _ => do
    let n ← (Json.getNum? j).mapError toString
    if n.exponent != 0 then
      throw "non-integer input code"
    else
      pure (toString n.mantissa)

def parseSimFixture (j : Json) : Except String SimFixture := do
  let id ← (j.getObjValAs? String "id").mapError toString
  let name ← (j.getObjValAs? String "name").mapError toString
  let irFile ← (j.getObjValAs? String "ir_file").mapError toString
  let traceFile ← (j.getObjValAs? String "trace_file").mapError toString
  let expected ← (j.getObjValAs? String "expected_serialized_level").mapError toString
  let inputsJson ← (j.getObjVal? "inputs").mapError toString
  let inputsArr ← (Json.getArr? inputsJson).mapError toString
  let inputs ← inputsArr.mapM parseInputToken
  pure {
    id, name, irFile, traceFile, inputs
    expectedSerializedLevel := expected
  }

def parseManifest (j : Json) : Except String Manifest := do
  let simFixturesJson ← (j.getObjVal? "simulation_fixtures").mapError toString
  let arr ← (Json.getArr? simFixturesJson).mapError toString
  let simulationFixtures ← arr.mapM parseSimFixture
  pure { simulationFixtures }

private def readFileAt (path : System.FilePath) : IO (Except String String) :=
  (IO.FS.readFile path).map Except.ok |>.catchExceptions fun e =>
    pure (Except.error (toString e))

def loadManifest (path : System.FilePath) : IO Manifest := do
  let contents ←
    match ← readFileAt path with
    | .error e => throw <| IO.userError s!"could not read {path}: {e}"
    | .ok s => pure s
  match Json.parse contents with
  | .error e => throw <| IO.userError s!"{path}: parse error: {e}"
  | .ok j =>
    match parseManifest j with
    | .error e => throw <| IO.userError s!"{path}: schema error: {e}"
    | .ok m => pure m

/-- Comment lines are empty, `##…`, or `#` / `# …` (hash then end/space).
Fixture names may begin with `#` followed by a digit (e.g. `#1067 …`). -/
def isWhitelistCommentLine (s : String) : Bool :=
  s.isEmpty || s.startsWith "##" || s == "#" || s.startsWith "# "

def loadWhitelist (path : System.FilePath) : IO (Array String) := do
  let text ←
    match ← readFileAt path with
    | .error e => throw <| IO.userError s!"could not read {path}: {e}"
    | .ok s => pure s
  let lines := text.splitOn "\n" |>.map (·.trimAscii.toString) |>.filter fun s =>
    !(isWhitelistCommentLine s)
  pure lines.toArray

def selectFixtures (manifest : Manifest) (names : Array String) : Except String (Array SimFixture) := do
  let mut out : Array SimFixture := #[]
  for name in names do
    match manifest.simulationFixtures.find? (·.name == name) with
    | none => throw s!"whitelist name not in fixtures.json: {name}"
    | some fx => out := out.push fx
  pure out

end PuzzleScript.Fixtures
