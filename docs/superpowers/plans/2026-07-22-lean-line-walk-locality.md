# Lean Line-Walk Row/Column Locality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared fixed line walk for non-ellipsis match/apply, and prove cardinal horizontal/vertical rules stay on one row/column (match + off-walk tiles unchanged on apply).

**Architecture:** Reuse existing `Board.runtimeTile` / `tileCol` / `tileRow`. Add `fixedWalkIdx` / walk helpers in Runtime (or thin `Geometry` helpers next to Board). Refactor `rowCellsMatchFixed` and the `.fixed` path of `applyRowAt` onto the same walk. Prove geom → walk locality → match/apply corollaries in `PuzzleScript/LineWalk.lean`.

**Tech Stack:** Lean 4 (repo `lean-toolchain`), Lake package under `lean/`, no Mathlib.

**Spec:** [docs/superpowers/specs/2026-07-22-lean-line-walk-locality-design.md](../specs/2026-07-22-lean-line-walk-locality-design.md)

---

## File map

| File | Role |
|------|------|
| `lean/PuzzleScript/Board.lean` | Existing `runtimeTile` / `tileCol` / `tileRow`; add round-trip lemmas if missing |
| `lean/PuzzleScript/Runtime.lean` | `fixedWalkIdx`, public `rowCellsMatchFixed`, refactor match + `applyRowAt` fixed path |
| `lean/PuzzleScript/LineWalk.lean` | Cardinal delta + locality + off-walk apply theorems |
| `lean/PuzzleScript.lean` | Import `LineWalk` |
| `lean/README.md` | One bullet under proven cone / Next |

---

### Task 1: Coordinate round-trips on `Board`

**Files:**
- Modify: `lean/PuzzleScript/Board.lean` (after `tileRow`, ~lines 22–29)

- [ ] **Step 1: Add round-trip lemmas** (extend existing helpers; do not rename)

```lean
theorem Board.tileRow_runtimeTile (b : Board) (x y : Nat) (hy : y < b.height) :
    b.tileRow (b.runtimeTile x y) = y := by
  simp [Board.tileRow, Board.runtimeTile]
  -- Nat: (x * h + y) % h = y when y < h
  exact Nat.mod_eq_of_lt hy

theorem Board.tileCol_runtimeTile (b : Board) (x y : Nat) (hy : y < b.height)
    (hh : 0 < b.height) :
    b.tileCol (b.runtimeTile x y) = x := by
  simp [Board.tileCol, Board.runtimeTile]
  -- (x * h + y) / h = x when y < h
  rw [Nat.add_mul_div_left _ _ hh, Nat.div_eq_of_lt hy, Nat.add_zero]

theorem Board.runtimeTile_tileCol_tileRow (b : Board) (tile : Nat)
    (hh : 0 < b.height) :
    b.runtimeTile (b.tileCol tile) (b.tileRow tile) = tile := by
  simp [Board.runtimeTile, Board.tileCol, Board.tileRow]
  exact Nat.div_add_mod tile b.height
```

If a lemma needs a different proof style for this Lean version, keep the statement; adjust the proof until `lake build PuzzleScript.Board` (or full) succeeds.

- [ ] **Step 2: Build**

```bash
cd lean && lake build PuzzleScript.Board
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add lean/PuzzleScript/Board.lean
git commit -m "$(cat <<'EOF'
Prove Board tileCol/tileRow round-trips for column-major layout.

EOF
)"
```

---

### Task 2: `fixedWalkIdx` + make match proof-accessible

**Files:**
- Modify: `lean/PuzzleScript/Runtime.lean` (near `ruleDirectionDelta` / before `rowCellsMatchFixed`)

- [ ] **Step 1: Add walk helpers** (after `ruleDirectionDelta`)

```lean
/-- Int cursor for the `k`-th cell on a fixed (non-ellipsis) line walk. -/
def fixedWalkIdx (start : Nat) (delta : Int) (k : Nat) : Int :=
  Int.ofNat start + delta * Int.ofNat k

/-- `some t` when the cursor is non-negative (matches match/apply OOB gating). -/
def fixedWalkTile? (start : Nat) (delta : Int) (k : Nat) : Option Nat :=
  let idx := fixedWalkIdx start delta k
  if idx < 0 then none else some idx.toNat

/-- Cardinal single-bit rule directions (UP/DOWN/LEFT/RIGHT). -/
def RuleDir.isCardinal (d : RuleDir) : Bool :=
  let n := d.toNat
  n == 1 || n == 2 || n == 4 || n == 8
```

- [ ] **Step 2: Replace private `rowCellsMatchFixed` with a public pure definition** that uses the walk (behavior-equivalent)

Remove `private` and rewrite as:

```lean
def rowCellsMatchFixed (b : Board) (startTile : Nat) (delta : Int) (row : Array PatternCell) : Bool :=
  (List.range row.size).all fun k =>
    match row[k]?.getD (.ellipsis) with
    | .ellipsis => false
    | .cell pat =>
      match fixedWalkTile? startTile delta k with
      | none => false
      | some t =>
        t < b.nTiles && cellPatternMatches b t pat
```

Notes:
- Prefer `row[k]!` only with a proof `k < row.size` from `List.range`; `getD` / `get?` is fine if clearer.
- Empty row: `List.range 0 = []`, `.all` is true — matches current empty `for` loop success.
- Do **not** change ellipsis matchers in this task.

- [ ] **Step 3: Build Runtime**

```bash
cd lean && lake build PuzzleScript.Runtime
```

Expected: success.

- [ ] **Step 4: Quick parity smoke** (catch match regressions early)

```bash
cd .. && make lean_parity_smoke
```

Expected: `lean parity smoke: OK`

- [ ] **Step 5: Commit**

```bash
git add lean/PuzzleScript/Runtime.lean
git commit -m "$(cat <<'EOF'
Extract fixedWalkIdx and pure rowCellsMatchFixed on the shared walk.

EOF
)"
```

---

### Task 3: Geom lemmas — cardinal `delta` and one-step locality

**Files:**
- Create: `lean/PuzzleScript/LineWalk.lean`
- Modify: `lean/PuzzleScript.lean` (add `import PuzzleScript.LineWalk`)

- [ ] **Step 1: Create module skeleton**

```lean
/-
Fixed line-walk row/column locality (non-ellipsis, cardinal RuleDir).
-/
import PuzzleScript.Board
import PuzzleScript.Runtime
import PuzzleScript.Rules

namespace PuzzleScript

set_option maxHeartbeats 4000000

-- theorems land in later steps

end PuzzleScript
```

Wire import in `lean/PuzzleScript.lean` after `Runtime` (before or after `View` is fine).

- [ ] **Step 2: Prove `ruleDirectionDelta` for cardinal dirs**

```lean
theorem ruleDirectionDelta_up (h : Nat) :
    ruleDirectionDelta (RuleDir.ofNat 1) h = -1 := by
  simp [ruleDirectionDelta, RuleDir.ofNat, RuleDir.bits]

theorem ruleDirectionDelta_down (h : Nat) :
    ruleDirectionDelta (RuleDir.ofNat 2) h = 1 := by
  simp [ruleDirectionDelta, RuleDir.ofNat]

theorem ruleDirectionDelta_left (h : Nat) :
    ruleDirectionDelta (RuleDir.ofNat 4) h = -Int.ofNat h := by
  simp [ruleDirectionDelta, RuleDir.ofNat]

theorem ruleDirectionDelta_right (h : Nat) :
    ruleDirectionDelta (RuleDir.ofNat 8) h = Int.ofNat h := by
  simp [ruleDirectionDelta, RuleDir.ofNat]
```

Adjust `RuleDir` field access if `ofNat` / `bits` simp needs `Native` unfolds — match how `Runtime` already uses `RuleDir`.

- [ ] **Step 3: One-step row/col preservation**

```lean
/-- Horizontal step (±height) preserves row (`tileRow`). -/
theorem tileRow_add_height (b : Board) (tile : Nat) (hh : 0 < b.height) :
    b.tileRow (tile + b.height) = b.tileRow tile := by
  simp [Board.tileRow, Nat.add_mod]

theorem tileRow_sub_height (b : Board) (tile : Nat) (hge : b.height ≤ tile)
    (hh : 0 < b.height) :
    b.tileRow (tile - b.height) = b.tileRow tile := by
  -- use Nat.sub_mod / rewrite tile = q*h + r
  sorry -- replace in this task; no sorry in final commit

/-- Vertical step (+1) preserves col when not at bottom of column. -/
theorem tileCol_succ_of_row_lt (b : Board) (tile : Nat)
    (hh : 0 < b.height) (hrow : b.tileRow tile + 1 < b.height) :
    b.tileCol (tile + 1) = b.tileCol tile := by
  -- tile = x*h + y, y+1 < h ⇒ (tile+1)/h = x
  sorry

theorem tileCol_pred_of_row_pos (b : Board) (tile : Nat)
    (hh : 0 < b.height) (hrow : 0 < b.tileRow tile) :
    b.tileCol (tile - 1) = b.tileCol tile := by
  sorry
```

Finish all four without `sorry` before committing this task. Prefer rewriting via `tile = runtimeTile (tileCol tile) (tileRow tile)`.

- [ ] **Step 4: Build**

```bash
cd lean && lake build PuzzleScript.LineWalk
```

Expected: success, no `sorry` in the file (`rg '\bsorry\b' PuzzleScript/LineWalk.lean` empty).

- [ ] **Step 5: Commit**

```bash
git add lean/PuzzleScript/LineWalk.lean lean/PuzzleScript.lean lean/PuzzleScript/Board.lean
git commit -m "$(cat <<'EOF'
Add LineWalk module with cardinal delta and one-step locality lemmas.

EOF
)"
```

---

### Task 4: Fixed-walk locality theorems

**Files:**
- Modify: `lean/PuzzleScript/LineWalk.lean`

- [ ] **Step 1: State and prove walk tiles share row for horizontal deltas**

For `delta = Int.ofNat b.height` (RIGHT) and start tile `s`:

```lean
theorem fixedWalkIdx_right_tileRow (b : Board) (s k : Nat) (hh : 0 < b.height) :
    let idx := fixedWalkIdx s (Int.ofNat b.height) k
    idx ≥ 0 →
      b.tileRow idx.toNat = b.tileRow s := by
  -- idx = s + k*h ≥ 0 automatic for Nat; induct on k using tileRow_add_height
  ...
```

LEFT (`delta = -Int.ofNat b.height`): require `k * b.height ≤ s` (or `idx ≥ 0`) so subtraction stays non-negative; then same `tileRow`.

- [ ] **Step 2: Vertical walk shares col under in-column hypotheses**

DOWN: for all `j ≤ k`, `tileRow s + j < b.height` (or equivalent on each prefix), conclude `tileCol (s+k) = tileCol s`.

UP: `k ≤ tileRow s`, conclude `tileCol (s-k) = tileCol s`.

- [ ] **Step 3: Package cardinal walk locality**

```lean
theorem fixedWalk_horizontal_same_row
    (b : Board) (d : RuleDir) (s k : Nat)
    (hC : d.isCardinal = true)
    (hH : d.toNat == 4 || d.toNat == 8)
    (hh : 0 < b.height)
    (hNonneg : fixedWalkIdx s (ruleDirectionDelta d b.height) k ≥ 0) :
    b.tileRow (fixedWalkIdx s (ruleDirectionDelta d b.height) k).toNat = b.tileRow s := ...

theorem fixedWalk_vertical_same_col
    (b : Board) (d : RuleDir) (s k : Nat)
    (hC : d.isCardinal = true)
    (hV : d.toNat == 1 || d.toNat == 2)
    (hh : 0 < b.height)
    -- plus in-column hypotheses matching scan-bounds / pattern length
    ... :
    b.tileCol (fixedWalkIdx s (ruleDirectionDelta d b.height) k).toNat = b.tileCol s := ...
```

Keep hypotheses honest (spec §4.4 / §8): do not claim vertical locality for arbitrary `s,k`.

- [ ] **Step 4: Build + no sorry**

```bash
cd lean && lake build PuzzleScript.LineWalk && rg '\bsorry\b' PuzzleScript/LineWalk.lean || true
```

Expected: build OK; no `sorry`.

- [ ] **Step 5: Commit**

```bash
git add lean/PuzzleScript/LineWalk.lean
git commit -m "$(cat <<'EOF'
Prove fixed walk tiles stay on one row or column for cardinal deltas.

EOF
)"
```

---

### Task 5: Match corollary + refactor `applyRowAt` onto the walk

**Files:**
- Modify: `lean/PuzzleScript/Runtime.lean` (`applyRowAt`)
- Modify: `lean/PuzzleScript/LineWalk.lean`

- [ ] **Step 1: Match inspects only walk tiles** (documentation theorem)

```lean
/-- If `rowCellsMatchFixed` succeeds at cell index `k`, that cell is `.cell`
and `fixedWalkTile?` is `some t` with `t < nTiles` (the only tiles consulted). -/
theorem rowCellsMatchFixed_implies_walk_tile
    (b : Board) (start : Nat) (delta : Int) (row : Array PatternCell) (k : Nat)
    (hk : k < row.size)
    (h : rowCellsMatchFixed b start delta row = true) :
    ∃ pat t, row[k] = .cell pat ∧ fixedWalkTile? start delta k = some t ∧ t < b.nTiles := by
  ...
```

Prove from unfolding `.all` / `List.all_eq_true`.

- [ ] **Step 2: Refactor `applyRowAt` so the `.fixed` path uses `fixedWalkIdx`**

Keep ellipsis branches as today. For the cell branch, the cursor is already `idx`; after refactor, make the fixed-only specialization definitionally use walk indices when `rm = .fixed s` and the row has no ellipsis — simplest approach that preserves ellipsis:

**Option A (preferred for proofs):** keep the single foldl, but add a lemma that when `rm = .fixed _` and `row` has no `.ellipsis`, the fold’s `idx` at step `k` equals `fixedWalkIdx s delta k`.

**Option B:** split:

```lean
def applyRowAtFixed ... :=
  (List.range row.size).foldl (fun (changed, board, rng') k =>
    match row[k]?.getD (.ellipsis) with
    | .ellipsis => (changed, board, rng') -- or treat as no-op; matches shouldn't contain these
    | .cell pat =>
      match fixedWalkTile? start delta k with
      | none => (changed, board, rng')
      | some t =>
        if t >= board.nTiles then (changed, board, rng')
        else
          let (c, b', r) := applyCellReplacement game rule board t pat caps rng'
          (changed || c, b', r)) (false, b, rng)

def applyRowAt ... :=
  match rm with
  | .fixed s =>
      if row.any (·.matches .ellipsis) then /* old fold for safety */ ...
      else applyRowAtFixed game rule b delta row s caps rng
  | .ellipsis1 .. | .ellipsis2 .. => /* existing fold with gaps */
```

Prefer **Option A** if a short `idx` invariant lemma is easy; use **Option B** if the fold invariant fights `Id`/gaps. Parity smoke is the oracle either way.

- [ ] **Step 3: Off-walk preservation**

Need: `applyCellReplacement` only mutates the given tile (objects/movements words for that tile). If not already proved, add a thin lemma in `WellFormed.lean` or `LineWalk.lean`:

```lean
theorem applyCellReplacement_preserves_other_tiles
    (game : Game) (rule : Rule) (b : Board) (tile other : Nat) (pat : CellPattern)
    (caps : RuleCaptures) (rng : RngState)
    (hne : other ≠ tile) :
    let r := applyCellReplacement game rule b tile pat caps rng
    r.2.1.cellObjWords other = b.cellObjWords other
    ∧ r.2.1.cellMovWords other = b.cellMovWords other := ...
```

Then:

```lean
theorem applyRowAt_fixed_preserves_off_walk
    (game : Game) (rule : Rule) (b : Board) (delta : Int) (row : Array PatternCell)
    (start other : Nat) (caps : RuleCaptures) (rng : RngState)
    (hOff : ∀ k < row.size, fixedWalkTile? start delta k ≠ some other)
    -- optional: row has no ellipsis
    :
    let r := applyRowAt game rule b delta row (.fixed start) caps rng
    r.2.1.cellObjWords other = b.cellObjWords other
    ∧ r.2.1.cellMovWords other = b.cellMovWords other := ...
```

- [ ] **Step 4: Build + smoke**

```bash
cd lean && lake build PuzzleScript
cd .. && make lean_parity_smoke
```

Expected: build OK; `lean parity smoke: OK`; no `sorry` in `LineWalk.lean` / touched Runtime proofs.

- [ ] **Step 5: Commit**

```bash
git add lean/PuzzleScript/Runtime.lean lean/PuzzleScript/LineWalk.lean
git commit -m "$(cat <<'EOF'
Refactor fixed apply onto the line walk and prove off-walk tiles unchanged.

EOF
)"
```

---

### Task 6: README + spec status

**Files:**
- Modify: `lean/README.md` (proven cone / Next)
- Modify: `docs/superpowers/specs/2026-07-22-lean-line-walk-locality-design.md` (Status → Done when complete)

- [ ] **Step 1: README bullet**

Under the Lean proven-cone list, add:

```markdown
- Line-walk locality (`LineWalk.lean`): cardinal fixed (non-ellipsis) horizontal/vertical
  rules share one walk for match/apply; walk stays on one row/column; off-walk tiles
  unchanged by fixed `applyRowAt`
```

- [ ] **Step 2: Spec status line** → `Status: Done (v1 fixed + cardinal; no sorry).`

- [ ] **Step 3: Final verification**

```bash
cd lean && rg '\bsorry\b' PuzzleScript/LineWalk.lean PuzzleScript/Board.lean || true
lake build PuzzleScript
cd .. && make lean_parity_smoke
```

Expected: no sorry; build OK; smoke OK.

- [ ] **Step 4: Commit**

```bash
git add lean/README.md docs/superpowers/specs/2026-07-22-lean-line-walk-locality-design.md
git commit -m "$(cat <<'EOF'
Document line-walk locality in README and mark the design done.

EOF
)"
```

---

## Spec coverage (plan self-review)

| Spec item | Task |
|-----------|------|
| Coord helpers / round-trips | Task 1 (`tileCol`/`tileRow` already exist) |
| `fixedWalkTiles` / walk API | Task 2 (`fixedWalkIdx` / `fixedWalkTile?`) |
| Cardinal delta + step locality | Task 3 |
| Walk locality | Task 4 |
| Match on walk + corollary | Tasks 2, 5 |
| Apply on walk + off-walk unchanged | Task 5 |
| Module wire + README + smoke | Tasks 2–6 |
| Non-goals (ellipsis/omni/tryApply) | Not tasked |

**Placeholder scan:** Task 3 initially shows `sorry` as TDD scaffolding — must be cleared before that task’s commit. No TBD left in done bar.

**Type consistency:** `fixedWalkIdx` / `fixedWalkTile?` / `RuleDir.isCardinal` named consistently across Tasks 2–5; Board uses existing `tileCol`/`tileRow`/`runtimeTile`.
