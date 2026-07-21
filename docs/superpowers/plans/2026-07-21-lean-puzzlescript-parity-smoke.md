# Lean PuzzleScript IR Parity Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Lean 4 Lake package that loads existing `build/js-parity-data` fixtures and passes a small whitelist of JS simulation cases (starting with the two Sokoban tests) via an executable subset runtime.

**Architecture:** Reuse the C++ parity export pipeline (`make js-parity-data` → `fixtures.json` + `ir/` + `traces/`). Lean never calls Node at runtime. Decode the IR subset needed for simple deterministic rules, step inputs with a pure `Game`/`Session` model, compare `serialized_level` to fixture expectations. JS is the everyday reference; if a real JS bug is found, report it and do not encode the bug in Lean.

**Tech Stack:** Lean 4 (`leanprover/lean4:v4.31.0`), Lake, `Lean.Data.Json` (stdlib only — no Mathlib), existing Node fixture exporter, Makefile.

**Parent spec:** `docs/superpowers/specs/2026-07-21-lean-puzzlescript-design.md`

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `lean/lean-toolchain` | Pin Lean 4.31.0 |
| `lean/lakefile.toml` | Lake package: lib `PuzzleScript`, exe `parity_smoke` |
| `lean/lean-toolchain` | Toolchain pin |
| `lean/README.md` | Install `elan`, run smoke target |
| `lean/parity_whitelist.txt` | Fixture names (one per line) |
| `lean/PuzzleScript.lean` | Root library import |
| `lean/PuzzleScript/BitVec.lean` | Word arrays for object/movement masks |
| `lean/PuzzleScript/Board.lean` | Level grid: objects + movements per cell |
| `lean/PuzzleScript/Serialize.lean` | `convertLevelToString`-compatible serializer |
| `lean/PuzzleScript/IR.lean` | JSON decode of IR subset → `Game` + initial `Session` |
| `lean/PuzzleScript/Runtime.lean` | `startMovement`, rule apply (subset), `resolveMovements`, turn/`again`/win |
| `lean/PuzzleScript/Fixtures.lean` | Load `fixtures.json`, whitelist, resolve paths |
| `lean/ParitySmoke.lean` | CLI executable entry |
| `Makefile` | Add `lean_parity_smoke` (depends on `js-parity-data`) |
| `.gitignore` | Ignore `lean/.lake/` and Lake build junk |

No JS / `js_oracle` changes in this plan.

---

## Runtime subset (v1)

Implement only what the initial whitelist needs. **Reject** (hard error with reason) any whitelist case that requires unsupported features.

**Supported**
- Object/movement masks with `STRIDE_OBJ` / `STRIDE_MOV` from IR (`game.strides`)
- Player input dirs `0=up, 1=left, 2=down, 3=right, 4=action` (same as JS `processInput`)
- Rules with: no ellipsis, no `is_random`, no `rigid`, empty `property_bindings` / `aggregate_bindings`, no `any_objects_present` / `any_movements_present` / layer-coupled movement terms, empty `commands`
- Single-row patterns (`patterns.length = 1`) of adjacent `cell_pattern` cells
- Rule groups + `loopPoint` style “keep applying group until quiescence” for non-looping games (Sokoban has trivial loop points)
- Movement resolution for non-rigid games (collision: destination blocked if same layer occupied)
- Late rules (Sokoban has none — keep the hook)
- Win conditions of the form used by Sokoban (`quantifier` + two filters)
- `again` command only if needed later; Sokoban whitelist should not require it

**Unsupported in v1 (fail closed)**
- Ellipsis, rigid, random / randomdir, property/aggregate bindings, beginloop/endloop complexity beyond what’s needed, undo/restart inputs as special cases beyond whatever the fixture inputs encode, sounds, title/message screens

**Algorithm references (read while implementing, do not invent semantics)**
- Input → movement bits: `src/js/engine.js` `processInput` (~3460–3478) and `startMovement`
- Turn structure: `processInput` rule/resolve loop (~3523–3534), then late rules, win check, `again`
- Level string: `src/js/debug.js` `convertLevelToString`
- Mask packing: `src/js/bitvec.js` header comment (5 movement bits per layer)
- C++ peer (optional clarity): `native/src/runtime/core.cpp` load IR + step

**Direction bit packing:** for layer `L`, movement word bits at shift `5*L`:
- up=1, down=2, left=4, right=8, action=16 (same as JS `parseInt('00001'..)` etc.)

**Fidelity:** match fixture expectations for correct games; if JS is wrong, report and waive/fix — do not copy the bug into Lean.

---

## Task 1: Lake scaffold + README + gitignore

**Files:**
- Create: `lean/lean-toolchain`
- Create: `lean/lakefile.toml`
- Create: `lean/PuzzleScript.lean`
- Create: `lean/PuzzleScript/Basic.lean`
- Create: `lean/ParitySmoke.lean`
- Create: `lean/README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Pin toolchain**

Create `lean/lean-toolchain`:

```
leanprover/lean4:v4.31.0
```

- [ ] **Step 2: Create lakefile.toml**

```toml
name = "puzzlescript"
version = "0.1.0"
defaultTargets = ["parity_smoke"]

[[lean_lib]]
name = "PuzzleScript"

[[lean_exe]]
name = "parity_smoke"
root = "ParitySmoke"
supportInterpreter = true
```

- [ ] **Step 3: Minimal library + exe**

`lean/PuzzleScript/Basic.lean`:

```lean
namespace PuzzleScript

def hello : String := "puzzlescript lean"

end PuzzleScript
```

`lean/PuzzleScript.lean`:

```lean
import PuzzleScript.Basic
```

`lean/ParitySmoke.lean`:

```lean
import PuzzleScript

def main (args : List String) : IO UInt32 := do
  IO.println s!"{PuzzleScript.hello} args={args}"
  pure 0
```

- [ ] **Step 4: README**

`lean/README.md`:

```markdown
# Lean PuzzleScript

Executable Lean 4 runtime that replays JS-exported parity fixtures.

## Setup

Install [elan](https://github.com/leanprover/elan), then from repo root:

```bash
make lean_parity_smoke
```

Or manually:

```bash
make js-parity-data
cd lean && lake build parity_smoke
lake exe parity_smoke --fixtures ../build/js-parity-data --whitelist parity_whitelist.txt
```

Requires Lean 4 as pinned in `lean-toolchain`.
```

- [ ] **Step 5: gitignore Lake artifacts**

Append to `.gitignore`:

```
# Lean / Lake
lean/.lake/
lean/lake-manifest.json
*.ilean
*.olean
*.trace
```

- [ ] **Step 6: Build smoke**

Run:

```bash
cd lean && lake build parity_smoke
```

Expected: downloads toolchain if needed; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add lean/lean-toolchain lean/lakefile.toml lean/PuzzleScript.lean lean/PuzzleScript/Basic.lean lean/ParitySmoke.lean lean/README.md .gitignore
git commit -m "Scaffold Lean 4 Lake package for PuzzleScript parity smoke."
```

---

## Task 2: Whitelist + Makefile target

**Files:**
- Create: `lean/parity_whitelist.txt`
- Modify: `Makefile` (`.PHONY`, help text, `lean_parity_smoke` rule)

- [ ] **Step 1: Whitelist**

`lean/parity_whitelist.txt`:

```
sokoban no win condition
sokoban with win condition
```

- [ ] **Step 2: Makefile target**

Near other test targets (after `js-parity-data` is fine), add:

```make
.PHONY: lean_parity_smoke

lean_parity_smoke: js-parity-data
	@command -v lake >/dev/null 2>&1 || { \
	  echo "lean_parity_smoke: 'lake' not found. Install elan (https://github.com/leanprover/elan) and retry."; \
	  exit 1; \
	}
	cd lean && lake build parity_smoke
	cd lean && lake exe parity_smoke --fixtures "$(CURDIR)/$(JS_PARITY_DATA_DIR)" --whitelist parity_whitelist.txt
```

Also add `lean_parity_smoke` to the `.PHONY` line at the top of the Makefile and a help `@echo` near the other test help lines:

```make
	@echo "  make lean_parity_smoke             Run Lean IR parity smoke (whitelist vs js-parity-data)"
```

Do **not** add Lean to the default `tests` aggregate.

- [ ] **Step 3: Run target (expect stub success)**

```bash
make lean_parity_smoke
```

Expected: fixtures export (if needed), Lean builds, stub exe prints hello and exits 0.

- [ ] **Step 4: Commit**

```bash
git add lean/parity_whitelist.txt Makefile
git commit -m "Add make lean_parity_smoke and Sokoban whitelist."
```

---

## Task 3: Fixture manifest loader (failing parity gate)

**Files:**
- Create: `lean/PuzzleScript/Fixtures.lean`
- Modify: `lean/PuzzleScript.lean`
- Modify: `lean/ParitySmoke.lean`

- [ ] **Step 1: Define fixture types + JSON load**

`lean/PuzzleScript/Fixtures.lean`:

```lean
import Lean.Data.Json
open Lean

namespace PuzzleScript.Fixtures

structure SimFixture where
  id : String
  name : String
  irFile : String
  traceFile : String
  inputs : Array Int
  expectedSerializedLevel : String
  deriving Repr

structure Manifest where
  simulationFixtures : Array SimFixture
  deriving Repr

def parseSimFixture (j : Json) : Except String SimFixture := do
  let id ← j.getObjValAs? String "id" |>.mapError toString
  let name ← j.getObjValAs? String "name" |>.mapError toString
  let irFile ← j.getObjValAs? String "ir_file" |>.mapError toString
  let traceFile ← j.getObjValAs? String "trace_file" |>.mapError toString
  let expected ← j.getObjValAs? String "expected_serialized_level" |>.mapError toString
  let inputsJson ← j.getObjVal? "inputs" |>.mapError toString
  let inputsArr ← inputsJson.getArr? |>.mapError toString
  let inputs ← inputsArr.mapM fun x => x.getInt? |>.mapError toString
  pure {
    id, name, irFile, traceFile, inputs
    expectedSerializedLevel := expected
  }

def parseManifest (j : Json) : Except String Manifest := do
  let arr ← j.getObjVal? "simulation_fixtures" |>.mapError toString >>= (·.getArr?.mapError toString)
  let simulationFixtures ← arr.mapM parseSimFixture
  pure { simulationFixtures }

def loadManifest (path : System.FilePath) : IO Manifest := do
  let contents ← IO.FS.readFile path
  match Json.parse contents with
  | .error e => throw <| IO.userError s!"fixtures.json parse error: {e}"
  | .ok j =>
    match parseManifest j with
    | .error e => throw <| IO.userError s!"fixtures.json schema error: {e}"
    | .ok m => pure m

def loadWhitelist (path : System.FilePath) : IO (Array String) := do
  let text ← IO.FS.readFile path
  let lines := text.splitOn "\n" |>.map String.trim |>.filter fun s =>
    !s.isEmpty && !(s.startsWith "#")
  pure lines.toArray

def selectFixtures (manifest : Manifest) (names : Array String) : Except String (Array SimFixture) := do
  let mut out : Array SimFixture := #[]
  for name in names do
    match manifest.simulationFixtures.find? (·.name == name) with
    | none => throw s!"whitelist name not in fixtures.json: {name}"
    | some fx => out := out.push fx
  pure out

end PuzzleScript.Fixtures
```

Update `lean/PuzzleScript.lean`:

```lean
import PuzzleScript.Basic
import PuzzleScript.Fixtures
```

- [ ] **Step 2: Wire CLI that fails until runtime exists**

Replace `ParitySmoke.lean` with:

```lean
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
```

- [ ] **Step 3: Verify fail-closed**

```bash
make lean_parity_smoke
```

Expected: exit code 1; prints both Sokoban names as TODO.

- [ ] **Step 4: Commit**

```bash
git add lean/PuzzleScript/Fixtures.lean lean/PuzzleScript.lean lean/ParitySmoke.lean
git commit -m "Load js-parity fixtures and fail closed before Lean runtime exists."
```

---

## Task 4: Board + BitVec + Serialize (initial level round-trip)

**Files:**
- Create: `lean/PuzzleScript/BitVec.lean`
- Create: `lean/PuzzleScript/Board.lean`
- Create: `lean/PuzzleScript/Serialize.lean`
- Modify: `lean/PuzzleScript.lean`
- Modify: `lean/PuzzleScript/IR.lean` (create minimal session loader used by a small `#guard` or IO check)

- [ ] **Step 1: BitVec words**

`lean/PuzzleScript/BitVec.lean`:

```lean
namespace PuzzleScript

/-- Packed mask words (JS Int32Array / bitvec data), stored as UInt32. -/
abbrev MaskWords := Array UInt32

def maskWord (ws : MaskWords) (i : Nat) : UInt32 :=
  ws.getD i 0

def maskGetBit (ws : MaskWords) (bit : Nat) : Bool :=
  let w := bit / 32
  let b := bit % 32
  ((maskWord ws w) >>> UInt32.ofNat b) &&& 1 == 1

def maskSetBit (ws : MaskWords) (bit : Nat) (val : Bool) : MaskWords :=
  let w := bit / 32
  let b := bit % 32
  let cur := maskWord ws w
  let bitv : UInt32 := (1 : UInt32) <<< UInt32.ofNat b
  let next := if val then cur ||| bitv else cur &&& (~~~bitv)
  Id.run do
    let mut out := ws
    while out.size ≤ w do
      out := out.push 0
    pure (out.set! w next)

def maskOr (a b : MaskWords) : MaskWords :=
  let n := max a.size b.size
  Id.run do
    let mut out : MaskWords := .mkEmpty n
    for i in [:n] do
      out := out.push (maskWord a i ||| maskWord b i)
    pure out

def maskAnd (a b : MaskWords) : MaskWords :=
  let n := max a.size b.size
  Id.run do
    let mut out : MaskWords := .mkEmpty n
    for i in [:n] do
      out := out.push (maskWord a i &&& maskWord b i)
    pure out

def maskAnyBits (ws : MaskWords) : Bool :=
  ws.any (· != 0)

def maskBitsSetIn (required actual : MaskWords) : Bool :=
  -- every 1-bit in required is also 1 in actual
  let n := max required.size actual.size
  Id.run do
    let mut ok := true
    for i in [:n] do
      let r := maskWord required i
      let a := maskWord actual i
      if (r &&& a) != r then
        ok := false
    pure ok

def maskNoBitsInCommon (a b : MaskWords) : Bool :=
  let n := max a.size b.size
  Id.run do
    let mut ok := true
    for i in [:n] do
      if (maskWord a i &&& maskWord b i) != 0 then
        ok := false
    pure ok

end PuzzleScript
```

- [ ] **Step 2: Board**

`lean/PuzzleScript/Board.lean`:

```lean
import PuzzleScript.BitVec

namespace PuzzleScript

structure Board where
  width : Nat
  height : Nat
  layerCount : Nat
  strideObj : Nat
  strideMov : Nat
  /-- length = width * height * strideObj -/
  objects : Array UInt32
  /-- length = width * height * strideMov -/
  movements : Array UInt32
  deriving Repr

def Board.nTiles (b : Board) : Nat := b.width * b.height

def Board.cellObjWords (b : Board) (tile : Nat) : MaskWords :=
  b.objects.extract (tile * b.strideObj) b.strideObj

def Board.cellMovWords (b : Board) (tile : Nat) : MaskWords :=
  b.movements.extract (tile * b.strideMov) b.strideMov

def Board.setCellObjWords (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  Id.run do
    let mut objs := b.objects
    for i in [:b.strideObj] do
      objs := objs.set! (tile * b.strideObj + i) (ws.getD i 0)
    pure { b with objects := objs }

def Board.setCellMovWords (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  Id.run do
    let mut mov := b.movements
    for i in [:b.strideMov] do
      mov := mov.set! (tile * b.strideMov + i) (ws.getD i 0)
    pure { b with movements := mov }

def Board.clearMovements (b : Board) : Board :=
  { b with movements := Array.replicate (b.nTiles * b.strideMov) 0 }

end PuzzleScript
```

- [ ] **Step 3: Serializer matching JS**

`lean/PuzzleScript/Serialize.lean`:

```lean
import PuzzleScript.Board

namespace PuzzleScript

/-- Mirror of `convertLevelToString` in `src/js/debug.js`. -/
def serializeLevel (idDict : Array String) (b : Board) : String :=
  Id.run do
    let mut out : String := ""
    let mut seen : Array String := #[]
    for y in [:b.height] do
      for x in [:b.width] do
        let tile := x + y * b.width
        let cell := b.cellObjWords tile
        let mut objs : Array String := #[]
        let maxBit := 32 * b.strideObj
        for bit in [:maxBit] do
          if maskGetBit cell bit then
            let name := idDict.getD bit s!"obj{bit}"
            objs := objs.push name
        let sorted := objs.qsort (· < ·)
        let key := String.intercalate " " sorted.toList
        let idx :=
          match seen.findIdx? (· == key) with
          | some i => i
          | none =>
            let i := seen.size
            seen := seen.push key
            out := out ++ key ++ ":"
            i
        out := out ++ toString idx ++ ","
      out := out.push '\n'
    pure out

end PuzzleScript
```

- [ ] **Step 4: Minimal IR load for prepared session board + id_dict**

Create `lean/PuzzleScript/IR.lean` with enough JSON parsing to read:

- `game.id_dict` : `Array String`
- `game.strides.object` / `.movement` / `.layers`
- `prepared_session.level.{width,height,layer_count,objects}`
- movements default to zeros if absent from prepared session (JS level has separate movements array — if missing in prepared_session, allocate zeros of length `width*height*strideMov`)

Also expose:

```lean
structure Game where
  idDict : Array String
  objectCount : Nat
  strideObj : Nat
  strideMov : Nat
  layerCount : Nat
  playerMask : MaskWords
  -- rules filled in Task 5
  deriving Repr

structure Session where
  board : Board
  winning : Bool
  deriving Repr

def loadIrFile (path : System.FilePath) : IO (Game × Session) := ...
```

Implement `loadIrFile` using `Lean.Data.Json` (`getObjValAs?`, arrays of numbers → `UInt32`). Numbers in JSON may be parsed via `getInt?` then `.toNat` / `UInt32.ofInt`.

After load, `#eval`/temporary check in ParitySmoke for one fixture:

```lean
let (game, session) ← loadIrFile (fixturesDir / fx.irFile)
let got := serializeLevel game.idDict session.board
-- Also load prepared_session.serialized_level from the same IR JSON and compare.
```

Add helper `loadPreparedSerializedLevel : Json → Except String String` reading `prepared_session.serialized_level`.

- [ ] **Step 5: Gate — initial serialize matches IR**

Extend `ParitySmoke` so each whitelist case at least checks:

```lean
if got != preparedSerialized then
  IO.eprintln s!"{fx.name}: initial serialize mismatch"
  failures := failures + 1
else
  IO.println s!"{fx.name}: initial serialize OK"
  -- still count as failure overall until replay works (keep TODO replay)
```

Keep overall exit 1 until replay lands (Task 7+).

- [ ] **Step 6: Run**

```bash
make lean_parity_smoke
```

Expected: both cases print `initial serialize OK`, still exit 1 (replay TODO).

- [ ] **Step 7: Commit**

```bash
git add lean/PuzzleScript/BitVec.lean lean/PuzzleScript/Board.lean lean/PuzzleScript/Serialize.lean lean/PuzzleScript/IR.lean lean/PuzzleScript.lean lean/ParitySmoke.lean
git commit -m "Add Lean board masks and JS-compatible level serialization."
```

---

## Task 5: Decode rules (subset) into Lean

**Files:**
- Modify: `lean/PuzzleScript/IR.lean`
- Create: `lean/PuzzleScript/Rules.lean` (optional split; may live in IR.lean if small)
- Modify: `lean/PuzzleScript.lean`

- [ ] **Step 1: Rule AST for the supported subset**

```lean
structure CellPattern where
  objectsPresent : MaskWords
  objectsMissing : MaskWords
  movementsPresent : MaskWords
  movementsMissing : MaskWords
  objectsClear : MaskWords
  objectsSet : MaskWords
  movementsClear : MaskWords
  movementsSet : MaskWords
  deriving Repr

structure Rule where
  direction : Nat
  lineNumber : Nat
  groupNumber : Nat
  /-- Single row of adjacent cells (v1). -/
  cells : Array CellPattern
  deriving Repr

structure WinCondition where
  quantifier : Nat
  filter1 : MaskWords
  filter2 : MaskWords
  deriving Repr

-- extend Game:
-- rules : Array (Array Rule)   -- rule groups
-- lateRules : Array (Array Rule)
-- winConditions : Array WinCondition
-- loopPoint : Array (Nat × Nat)  -- decode as needed; Sokoban may be empty/identity
```

Decode `game.rules` / `game.late_rules` arrays. For each rule:

1. If `ellipsis_count` any ≠ 0, or `is_random`, or `rigid`, or nonempty bindings / any_* / commands → mark game `unsupportedReason` OR fail at load with the fixture name (prefer fail at load for whitelist cases).
2. Require `patterns` length 1 and every cell `kind == "cell_pattern"`.
3. Map bitvec arrays (`[16]` etc.) into `MaskWords`.

Decode `winconditions` into `WinCondition`.

- [ ] **Step 2: Load both Sokoban IRs without error**

```bash
make lean_parity_smoke
```

Expected: still exit 1 on replay TODO, but no IR decode errors for whitelist.

- [ ] **Step 3: Commit**

```bash
git add lean/PuzzleScript/IR.lean lean/PuzzleScript/Rules.lean lean/PuzzleScript.lean
git commit -m "Decode PuzzleScript IR rule subset for Lean runtime."
```

---

## Task 6: startMovement + resolveMovements + simple rule apply

**Files:**
- Create: `lean/PuzzleScript/Runtime.lean`
- Modify: `lean/PuzzleScript.lean`

- [ ] **Step 1: Movement helpers**

```lean
def dirInputToLayerBits (dir : Int) : Option UInt32 :=
  match dir with
  | 0 => some 1   -- up
  | 1 => some 4   -- left
  | 2 => some 2   -- down
  | 3 => some 8   -- right
  | 4 => some 16  -- action
  | _ => none

def dirDelta (dirBits : UInt32) : Option (Int × Int) :=
  if dirBits == 1 then some (0, -1)
  else if dirBits == 2 then some (0, 1)
  else if dirBits == 4 then some (-1, 0)
  else if dirBits == 8 then some (1, 0)
  else none -- action has no delta
```

`startMovement`: for each tile, if cell objects share bits with `playerMask`, OR the player layer’s movement bits with `dirBits << (5 * playerLayer)`.

Find player layer from object metadata or from the bit index of the player object (Sokoban: player object id 2, layer 2). Prefer decoding `game.objects` with `{id, layer}` during IR load into `Array (Nat × Nat)` id→layer.

- [ ] **Step 2: Cell pattern match + apply**

For rule direction `rule.direction` (absolute dir mask used for scanning — in Sokoban rules dirs are 2/8 etc.):

Scan the board in the rule’s direction (follow JS/C++ scan order for that direction; for v1, nest `y`/`x` loops and compute neighbor offsets along the rule direction for multi-cell rows).

Match cell `i` of the pattern at tile `t_i` if:

- `maskBitsSetIn objectsPresent cellObj`
- `maskNoBitsInCommon objectsMissing cellObj` (missing bits must be absent)
- same for movements present/missing

On match, apply replacements to each cell (clear/set object and movement masks). Rule application may move object bits between adjacent cells (Sokoban push rules rewrite two cells).

Repeat each rule group until a full pass makes no change (or hit a safety iteration cap, e.g. 1000, then error).

- [ ] **Step 3: resolveMovements (non-rigid)**

For each layer and each tile with movement bits:

- Map bits → delta
- If moving into out-of-bounds or into a cell that already has an object on that layer → cancel that movement (clear bits; do not move)
- Else move object bits for that layer from src to dest; clear movement bits after successful resolution pass

Follow JS ordering closely; when unsure, differential-debug one input against exported `traces/<id>.json` snapshots.

- [ ] **Step 4: Unit-style IO check — one input**

In ParitySmoke (temporary debug ok), after load, apply input `0` once to `sokoban with win condition` and print serialize; compare to first snapshot in the trace file if easy. Remove debug noise before commit if it clutters.

- [ ] **Step 5: Commit**

```bash
git add lean/PuzzleScript/Runtime.lean lean/PuzzleScript.lean lean/PuzzleScript/IR.lean
git commit -m "Implement Lean subset rule application and movement resolution."
```

---

## Task 7: Full turn + replay whitelist to green

**Files:**
- Modify: `lean/PuzzleScript/Runtime.lean`
- Modify: `lean/ParitySmoke.lean`

- [ ] **Step 1: `stepInput` / `replay`**

```lean
def executeTurn (game : Game) (session : Session) (dir : Int) : Except String Session := do
  -- clear movements, startMovement if dir ≥ 0
  -- applyRules game.rules
  -- resolveMovements
  -- applyRules game.lateRules
  -- resolveMovements again if late produced movement (match JS)
  -- evaluate winconditions → session.winning
  -- handle `again` only if command queue requires it (unsupported → error)
  pure session

def replay (game : Game) (session : Session) (inputs : Array Int) : Except String Session := do
  let mut s := session
  for dir in inputs do
    s ← executeTurn game s dir
  pure s
```

Win condition evaluation for Sokoban-style: for each tile, if cell overlaps `filter1`, require overlap with `filter2` when quantifier means “all” (check JS `winconditions` quantifier encoding — in fixture quantifier `1` is ON/ALL style used by `All Crate on Target`). Port the exact predicate from JS/C++ rather than guessing.

- [ ] **Step 2: ParitySmoke compares final serialize**

```lean
match replay game session fx.inputs with
| .error e =>
    IO.eprintln s!"{fx.name}: {e}"
    failures := failures + 1
| .ok s =>
    let got := serializeLevel game.idDict s.board
    if got == fx.expectedSerializedLevel then
      IO.println s!"OK {fx.name}"
    else
      IO.eprintln s!"FAIL {fx.name}\nexpected:\n{fx.expectedSerializedLevel}\ngot:\n{got}"
      failures := failures + 1
```

Remove the “TODO runtime” failure path.

- [ ] **Step 3: Run to green**

```bash
make lean_parity_smoke
```

Expected:

```
OK sokoban no win condition
OK sokoban with win condition
lean parity smoke: OK
```

exit 0.

If a mismatch is a genuine JS bug: file a short note under `docs/superpowers/notes/`, waive the case in the whitelist with a comment, and do **not** change Lean to match the bug. Otherwise fix Lean.

- [ ] **Step 4: Commit**

```bash
git add lean/PuzzleScript/Runtime.lean lean/ParitySmoke.lean lean/parity_whitelist.txt docs/superpowers/notes/*  # only if note added
git commit -m "Pass Sokoban JS parity fixtures in Lean runtime smoke."
```

---

## Task 8: Polish docs + help; optional third case

**Files:**
- Modify: `lean/README.md`
- Modify: `Makefile` help (if not already)
- Optionally modify: `lean/parity_whitelist.txt`

- [ ] **Step 1: README accuracy**

Document:

- Depends on `make js-parity-data` (no JS source changes)
- Whitelist path
- Fidelity policy (report JS bugs; don’t encode them)
- Supported runtime subset bullet list (copy from this plan)

- [ ] **Step 2 (optional): Add one more simple case**

Try `rule grouping test` (3 inputs). If it fits the subset, add to whitelist and keep `make lean_parity_smoke` green. If not, leave a README “next candidates” note — do not expand the interpreter “just because.”

- [ ] **Step 3: Final verification**

```bash
make lean_parity_smoke
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lean/README.md lean/parity_whitelist.txt Makefile
git commit -m "Document Lean parity smoke usage and subset limits."
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Lake project under `lean/` | 1 |
| Reuse `js-parity-data` / no JS changes | 2–3 |
| Whitelist handful of JS sim cases | 2, 7 |
| IR load + session step | 4–7 |
| `make lean_parity_smoke` | 2 |
| `lean/README.md` + toolchain | 1, 8 |
| Not in default `make tests` | 2 |
| Fail closed on unsupported | 5–7 |
| Report JS bugs, don’t encode | 7 note + README |
| Proofs deferred | (no task — intentional) |

## Placeholder / consistency review

- Types `Game`, `Session`, `Board`, `MaskWords`, `CellPattern`, `Rule` introduced in Tasks 4–5 and used in 6–7.
- CLI flags `--fixtures` / `--whitelist` consistent across Makefile and `ParitySmoke`.
- Whitelist names match `fixtures.json` exactly (`sokoban no win condition`, `sokoban with win condition`).
- No Mathlib dependency; stdlib JSON only.
