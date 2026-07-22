# Lean abstract view types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Lean board/rule representation (`Ids`, `Dir4`, `Command`, views), fix §4.0 `modified`/again, and prove a narrow `abstractStep ≡ maskStep` bridge while keeping `lean_parity_smoke` green.

**Architecture:** Views over existing mask `Board` (no second store). Shared typed vocabulary migrated into IR/Rules/Runtime where cheap. Abstract kernel narrowed to inert-relevant fragment; masks remain smoke authority.

**Tech Stack:** Lean 4 (`leanprover/lean4:v4.31.0`), Lake, existing `lean/` package + `make lean_parity_smoke`.

**Spec:** [docs/superpowers/specs/2026-07-21-lean-abstract-view-types-design.md](../specs/2026-07-21-lean-abstract-view-types-design.md)

---

## File structure

| Path | Role |
|------|------|
| `lean/PuzzleScript/Ids.lean` | `TileIdx`, `LayerIdx`, `ObjectId` |
| `lean/PuzzleScript/Dir4.lean` | Direction inductive + bit bridge |
| `lean/PuzzleScript/Command.lean` | Command inductive + parse/inert |
| `lean/PuzzleScript/View.lean` | `occ` / `movAt` / `neighbor` / `WellFormed` |
| `lean/PuzzleScript/Abstract.lean` | Abstract kernel + bridge theorems |
| `lean/PuzzleScript/Rules.lean` | `commands : Array Command` |
| `lean/PuzzleScript/IR.lean` | Parse commands into `Command` |
| `lean/PuzzleScript/Runtime.lean` | `Dir4` unify; §4.0 modified fix; typed queues |
| `lean/PuzzleScript.lean` | Import graph |
| `lean/README.md` | Short note on typed IR / views |

---

### Task 1: Ids + Dir4 modules

**Files:**
- Create: `lean/PuzzleScript/Ids.lean`
- Create: `lean/PuzzleScript/Dir4.lean`
- Modify: `lean/PuzzleScript.lean`

- [ ] **Step 1: Add `Ids.lean`**

```lean
structure TileIdx where val : Nat deriving DecidableEq, Repr
structure LayerIdx where val : Nat deriving DecidableEq, Repr
structure ObjectId where val : Nat deriving DecidableEq, Repr
```

Add `Hashable` instances if needed for `Finset` (Lean 4.31: derive or manual).

- [ ] **Step 2: Add `Dir4.lean`**

`inductive Dir4 | up | down | left | right` with `toBits` (1/2/4/8), `ofBits?`, and `delta : Dir4 → Int × Int` matching current Runtime column-major convention.

- [ ] **Step 3: Import in `PuzzleScript.lean`; `lake build`**

Run: `cd lean && lake build`
Expected: success

- [ ] **Step 4: Commit**

```bash
git add lean/PuzzleScript/Ids.lean lean/PuzzleScript/Dir4.lean lean/PuzzleScript.lean
git commit -m "Add TileIdx/LayerIdx/ObjectId and Dir4 for Lean views."
```

---

### Task 2: Command inductive + IR/Rules migration

**Files:**
- Create: `lean/PuzzleScript/Command.lean`
- Modify: `lean/PuzzleScript/Rules.lean`
- Modify: `lean/PuzzleScript/IR.lean`
- Modify: `lean/PuzzleScript/Runtime.lean` (command string ops → Command)

- [ ] **Step 1: Define `Command` + `parseCommand` / `parseCommands`**

Fail closed on unknown strings. Map `sfx0`..`sfx10`, `cancel`, `checkpoint`, `restart`, `win`, `message`, `again`.

- [ ] **Step 2: Change `Rule.commands` to `Array Command`; update IR parse**

- [ ] **Step 3: Update Runtime queue / contains / sfx checks to `Command`**

Keep behavior identical for known commands.

- [ ] **Step 4: `lake build` + quick smoke on a few whitelist games**

Run: `cd lean && lake build && lake exe parity_smoke --fixtures ../build/js-parity-data --whitelist parity_whitelist.txt`  
(or `make lean_parity_smoke` if fixtures present)

Expected: OK

- [ ] **Step 5: Commit**

```bash
git commit -m "Parse rule commands as a closed Command inductive."
```

---

### Task 3: Unify Runtime direction encoding on Dir4

**Files:**
- Modify: `lean/PuzzleScript/Runtime.lean`

- [ ] **Step 1: Replace `dirDelta` / `dirInputToLayerBits` / `dirBitsFromIndex` with `Dir4` helpers**

- [ ] **Step 2: Build + smoke**

- [ ] **Step 3: Commit**

```bash
git commit -m "Route Runtime direction bits through Dir4."
```

---

### Task 4: View projections + WellFormed

**Files:**
- Create: `lean/PuzzleScript/View.lean`
- Modify: `lean/PuzzleScript.lean`

- [ ] **Step 1: Implement `Board.occ`, `Board.movAt`, `TileIdx.neighbor`**

Use existing `maskGetBit` / `getLayerMovementBits` / `tileCol`/`tileRow`.

- [ ] **Step 2: Define `Board.WellFormed` (Prop) — start with dimensions + object bits ⇒ id < objectCount + layer exclusivity if `Game` layer map available; otherwise document partial WF and strengthen in Task 6**

- [ ] **Step 3: Prove or `#check` trivial projection lemmas (e.g. `ofBits? (toBits d) = some d`)**

- [ ] **Step 4: Commit**

```bash
git commit -m "Add Board.occ/movAt/neighbor abstract view projections."
```

---

### Task 5: §4.0 modified / again-eligibility fix

**Files:**
- Modify: `lean/PuzzleScript/Runtime.lean`
- Modify: `lean/README.md` (note the JS-aligned predicate)

- [ ] **Step 1: Remove `!rule.commands.isEmpty` from `modified` updates in `tryApplyRule` and `applyRandomRuleGroup`**

- [ ] **Step 2: Ensure again gate uses objects-only delta (`boardsDiffer` or dedicated `objectsChanged`)**

Align naming with design (`objectsChanged` / `againEligible`).

- [ ] **Step 3: Full `make lean_parity_smoke`**

Expected: OK (behavior closer to JS)

- [ ] **Step 4: Commit**

```bash
git commit -m "Align Lean turn.modified/again with JS object-delta."
```

---

### Task 6: Abstract kernel + bridge theorems

**Files:**
- Create: `lean/PuzzleScript/Abstract.lean`
- Modify: `lean/PuzzleScript.lean`

- [ ] **Step 1: Narrow kernel docstring — command-only / movement-identity rules first**

- [ ] **Step 2: Define abstract apply that no-ops board for inert command-only rules; queues commands**

- [ ] **Step 3: Prove bridge: for WellFormed boards, mask apply of such a rule leaves `occ`/`movAt` unchanged and again-eligibility unchanged when §4.0 holds**

Prefer real proofs; if stuck, narrow kernel further — no silent `sorry` in final tree.

- [ ] **Step 4: `lake build` + full smoke**

- [ ] **Step 5: Commit**

```bash
git commit -m "Add abstract view kernel and mask step bridge lemmas."
```

---

### Task 7: Docs polish

**Files:**
- Modify: `lean/README.md`
- Modify: `docs/superpowers/specs/2026-07-21-lean-abstract-view-representation-notes.md` (status → superseded by types design)

- [ ] **Step 1: Document modules + §4.0 + that smoke still uses masks**

- [ ] **Step 2: Commit**

```bash
git commit -m "Document Lean abstract view types and supersede notes."
```

---

## Verification (final)

```bash
cd lean && lake build
make lean_parity_smoke
```

Both must succeed before declaring the milestone done.
