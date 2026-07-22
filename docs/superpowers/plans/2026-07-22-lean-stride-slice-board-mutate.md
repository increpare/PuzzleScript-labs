# Lean Stride-Slice Board Mutate Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse four Board stride-fold mutators onto one `Array.setStrideSlice`, unify twin preservation lemmas, and share `applyRowAtFixed` induction for WF + WH — without changing runtime behavior.

**Architecture:** Add `Array.setStrideSlice` in `Board.lean`; rewrite `setCellObj/Mov/Rigid*` as one-field updates; prove size / `getD` / extract lemmas once and keep existing `Board.*` theorem names as thin wrappers; unify rigid cell-word preservation; factor Fixed apply-row preservation for WellFormed + WH.

**Tech Stack:** Lean 4 (repo `lean-toolchain`), Lake under `lean/`, no Mathlib.

**Spec:** [docs/superpowers/specs/2026-07-22-lean-stride-slice-board-mutate-design.md](../specs/2026-07-22-lean-stride-slice-board-mutate-design.md)

**Isolation:** Implement in a git worktree (e.g. `.worktrees/lean-stride-slice`) branched from current `master`.

---

## File map

| File | Role |
|------|------|
| `lean/PuzzleScript/Board.lean` | `setStrideSlice`; rewrite four setters; move/share `tile_ranges_disjoint` + core stride lemmas if they fit cleanly |
| `lean/PuzzleScript/WellFormed.lean` | Re-point size/`getD`/`cell*Words_*_ne` as wrappers; unify rigid cell-word theorem; keep bit/mask theory |
| `lean/PuzzleScript/WellFormedTurn.lean` | Use shared Fixed apply preservation for WH |
| `lean/PuzzleScript/Runtime.lean` | No behavior change (setters used as today) |
| `lean/PuzzleScript/LineWalk.lean` | Should keep building via existing public lemmas |
| `lean/README.md` | One hygiene bullet |
| Spec status line | → Done when finished |

---

### Task 1: `Array.setStrideSlice` + rewrite Board setters

**Files:**
- Modify: `lean/PuzzleScript/Board.lean` (before `cellObjWords` / replace the four `setCell*` defs)

- [ ] **Step 1: Add `setStrideSlice` and rewrite setters**

After the tile coordinate lemmas (before `cellObjWords`), add:

```lean
/-- Write `ws` into the tile-sized slice `[tile * stride, tile * stride + stride)`. -/
def Array.setStrideSlice (xs : Array UInt32) (tile stride : Nat) (ws : MaskWords) :
    Array UInt32 :=
  let start := tile * stride
  (List.range stride).foldl
    (fun arr i => arr.set! (start + i) (ws.getD i 0))
    xs

theorem Array.size_setStrideSlice (xs : Array UInt32) (tile stride : Nat) (ws : MaskWords) :
    (Array.setStrideSlice xs tile stride ws).size = xs.size := by
  -- unfold setStrideSlice; reuse Array.size_foldl_set! if available here,
  -- or induct on List.range / copy the small size_foldl_set! proof from WellFormed
  sorry -- clear before commit
```

Replace the four setters with:

```lean
def Board.setCellObjWords (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  { b with objects := Array.setStrideSlice b.objects tile b.strideObj ws }

def Board.setCellMovWords (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  { b with movements := Array.setStrideSlice b.movements tile b.strideMov ws }

def Board.setCellRigidMovementAppliedMask (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  { b with rigidMovementAppliedMask :=
      Array.setStrideSlice b.rigidMovementAppliedMask tile b.strideMov ws }

def Board.setCellRigidGroupIndexMask (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  { b with rigidGroupIndexMask :=
      Array.setStrideSlice b.rigidGroupIndexMask tile b.strideMov ws }
```

Leave accessors (`cellObjWords` / `cellMovWords` / rigid gets) unchanged.

Clear the `sorry` in `size_setStrideSlice` in this task (copy `Array.size_foldl_set!` into `Board.lean` if WellFormed’s copy is not visible yet — Board must not import WellFormed).

- [ ] **Step 2: Build Board**

```bash
cd lean && lake build PuzzleScript.Board
```

Expected: success; no `sorry` in `Board.lean`.

- [ ] **Step 3: Commit**

```bash
git add lean/PuzzleScript/Board.lean
git commit -m "$(cat <<'EOF'
Extract Array.setStrideSlice and rewrite Board cell setters onto it.

EOF
)"
```

---

### Task 2: Generic `getD` stride lemmas + Board size wrappers

**Files:**
- Modify: `lean/PuzzleScript/Board.lean` (after `size_setStrideSlice`)
- Modify: `lean/PuzzleScript/WellFormed.lean` (`setCellObjWords_size` / `setCellMovWords_size` / rigid size theorems)

- [ ] **Step 1: Move or duplicate minimal Array fold helpers into Board**

`WellFormed` currently owns `Array.size_foldl_set!`, `Array.getD_set!_ne`, `Array.getD_foldl_set!_ne`, `tile_ranges_disjoint`. For Board-local stride proofs, either:

- **Preferred:** move those four helpers (+ `tile_stride_indices_eq_implies_tile_eq`) to `Board.lean` and delete the WellFormed copies (WellFormed already imports Board), **or**
- Keep helpers in WellFormed and only put `size_setStrideSlice` on Board (Task 1), proving `getD_setStrideSlice_*` in WellFormed.

Plan default = **move helpers to Board.lean** so stride facts live with the def.

- [ ] **Step 2: Prove**

```lean
theorem Array.getD_setStrideSlice_ne
    (xs : Array UInt32) (tile stride : Nat) (ws : MaskWords) (j : Nat)
    (hne : ∀ i < stride, tile * stride + i ≠ j) :
    (Array.setStrideSlice xs tile stride ws).getD j 0 = xs.getD j 0 := by
  -- unfold setStrideSlice; apply getD_foldl_set!_ne
  ...
```

- [ ] **Step 3: Re-point Board size theorems in WellFormed**

```lean
theorem Board.setCellObjWords_size (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellObjWords tile ws).objects.size = b.objects.size := by
  simp [Board.setCellObjWords, Array.size_setStrideSlice]

theorem Board.setCellMovWords_size (b : Board) (tile : Nat) (ws : MaskWords) :
    (b.setCellMovWords tile ws).movements.size = b.movements.size := by
  simp [Board.setCellMovWords, Array.size_setStrideSlice]
```

Same for rigid size theorems.

Keep statements of `Board.objects_getD_setCellObjWords_ne` / mov twin; proofs become:

```lean
theorem Board.objects_getD_setCellObjWords_ne ... := by
  simpa [Board.setCellObjWords] using
    Array.getD_setStrideSlice_ne b.objects tile b.strideObj ws j hne
```

- [ ] **Step 4: Build**

```bash
cd lean && lake build PuzzleScript.WellFormed
```

Expected: success (may need small `simp` argument tweaks where `setCellObjWords` no longer unfolds to an inline foldl).

- [ ] **Step 5: Commit**

```bash
git add lean/PuzzleScript/Board.lean lean/PuzzleScript/WellFormed.lean
git commit -m "$(cat <<'EOF'
Prove setStrideSlice getD lemmas and thin Board size/getD wrappers.

EOF
)"
```

---

### Task 3: `extract_setStrideSlice_ne` + cell-word aliases

**Files:**
- Modify: `lean/PuzzleScript/Board.lean` and/or `WellFormed.lean` (where `cellObjWords_setCellObjWords_ne` lives today)

- [ ] **Step 1: Prove generic extract inequality**

```lean
theorem Array.extract_setStrideSlice_ne
    (xs : Array UInt32) (tile t stride : Nat) (ws : MaskWords)
    (hne : tile ≠ t) :
    (Array.setStrideSlice xs tile stride ws).extract (t * stride) (t * stride + stride) =
      xs.extract (t * stride) (t * stride + stride) := by
  -- Array.ext; getElem_extract; getD_setStrideSlice_ne + tile_ranges_disjoint
  -- Reuse the proof shape already used by Board.cellObjWords_setCellObjWords_ne
  ...
```

- [ ] **Step 2: Thin Board aliases**

```lean
theorem Board.cellObjWords_setCellObjWords_ne
    (b : Board) (tile t : Nat) (ws : MaskWords) (hne : tile ≠ t) :
    (b.setCellObjWords tile ws).cellObjWords t = b.cellObjWords t := by
  simp only [Board.cellObjWords, Board.setCellObjWords]
  -- strideObj field unchanged
  exact Array.extract_setStrideSlice_ne b.objects tile t b.strideObj ws hne

theorem Board.cellMovWords_setCellMovWords_ne ... := by
  simp only [Board.cellMovWords, Board.setCellMovWords]
  exact Array.extract_setStrideSlice_ne b.movements tile t b.strideMov ws hne
```

Keep `cellMovWords_setCellObjWords` / `cellObjWords_setCellMovWords` as `simp` one-liners.

Delete the old duplicated long proofs once aliases build.

- [ ] **Step 3: Build LineWalk + full package**

```bash
cd lean && lake build PuzzleScript.LineWalk && lake build PuzzleScript
```

Expected: success; LineWalk off-walk still uses public `applyCellReplacement_preserves_other_tiles`.

- [ ] **Step 4: Commit**

```bash
git add lean/PuzzleScript/Board.lean lean/PuzzleScript/WellFormed.lean
git commit -m "$(cat <<'EOF'
Prove extract_setStrideSlice_ne and alias Board cell-word preservation.

EOF
)"
```

---

### Task 4: Unify rigid cell-word preservation

**Files:**
- Modify: `lean/PuzzleScript/WellFormed.lean` (`applyRigidCellMasks_cellObjWords` / `_cellMovWords` / callers in `commitCellReplacement_*`)

- [ ] **Step 1: Replace twins with one theorem**

```lean
theorem Board.applyRigidCellMasks_cellWords
    (game : Game) (rule : Rule) (b : Board) (tile t : Nat) (pat : CellPattern) :
    (applyRigidCellMasks game rule b tile pat).1.cellObjWords t = b.cellObjWords t ∧
      (applyRigidCellMasks game rule b tile pat).1.cellMovWords t = b.cellMovWords t := by
  unfold applyRigidCellMasks
  cases rule.rigid with
  | false => simp
  | true =>
    simp only [Bool.not_true]
    cases (maskNoBitsInCommon
        (buildRigidGroupMask game rule.groupNumber pat.movementsLayerMask b.strideMov)
        (b.cellRigidGroupIndexMask tile) &&
      maskNoBitsInCommon pat.movementsLayerMask (b.cellRigidMovementAppliedMask tile)) with
    | false => simp
    | true =>
      simp [Board.setCellRigidMovementAppliedMask, Board.setCellRigidGroupIndexMask,
        Board.cellObjWords, Board.cellMovWords, Array.setStrideSlice]
```

- [ ] **Step 2: Optional aliases for call-site churn control**

```lean
theorem Board.applyRigidCellMasks_cellObjWords ... :=
  (Board.applyRigidCellMasks_cellWords ...).1

theorem Board.applyRigidCellMasks_cellMovWords ... :=
  (Board.applyRigidCellMasks_cellWords ...).2
```

Or update callers (`commitCellReplacement_preserves_other_tiles`, `commitCellReplacement_wellFormed`) to use `.1` / `.2` of the unified theorem — either is fine.

- [ ] **Step 3: Build**

```bash
cd lean && lake build PuzzleScript.WellFormed
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add lean/PuzzleScript/WellFormed.lean
git commit -m "$(cat <<'EOF'
Unify applyRigidCellMasks object and movement word preservation.

EOF
)"
```

---

### Task 5: Shared `applyRowAtFixed` preservation (WF + WH)

**Files:**
- Modify: `lean/PuzzleScript/WellFormed.lean` (`applyRowAtFixed_wellFormed`)
- Modify: `lean/PuzzleScript/WellFormedTurn.lean` (`applyRowAtFixed_WH`)

- [ ] **Step 1: Add a shared induction lemma** (prefer in `WellFormed.lean` next to Fixed WF; Turn imports WellFormed)

```lean
theorem applyRowAtFixed_preserves
    (game : Game) (rule : Rule) (b : Board) (delta : Int)
    (row : Array PatternCell) (start : Nat)
    (caps : RuleCaptures) (rng : RngState)
    (P : Board → Prop)
    (hP0 : P b)
    (hStep : ∀ (board : Board) (t : Nat) (pat : CellPattern) (rng : RngState),
      P board → t < board.nTiles →
        P (applyCellReplacement game rule board t pat caps rng).2.1) :
    P (applyRowAtFixed game rule b delta row start caps rng).2.1 := by
  -- same cases as current applyRowAtFixed_wellFormed induction
  ...
```

- [ ] **Step 2: Specialize**

```lean
theorem applyRowAtFixed_wellFormed ... :=
  applyRowAtFixed_preserves ... (Board.WellFormed game) hB
    (fun board t pat rng hB' hTile =>
      -- still need layerRespecting from row[k]; keep that extraction inside preserves
      -- OR keep layerRespecting threading inside preserves via an extra hypothesis
      ...)
```

If threading `layerRespecting` through a fully abstract `P` is awkward, use a slightly more concrete shared lemma:

```lean
theorem applyRowAtFixed_foldl_invariant
    ... (Inv : Bool → Board → RngState → Prop)
    (h0 : Inv false b rng)
    (hSkip / hApply : ...) :
    Inv (result).1 (result).2.1 (result).2.2
```

Then WF sets `Inv _ board _ := Board.WellFormed game board` and WH sets `Inv _ board _ := board.width = b.width ∧ board.height = b.height` (using `applyCellReplacement_wellFormed` / `_WH` in the apply arm).

Do **not** force Fold through the same abstraction unless Fixed is clean and Fold is still duplicated; Fold may stay as today’s separate WF + WH proofs.

Public names `applyRowAtFixed_wellFormed`, `applyRowAtFixed_WH`, `applyRowAt_wellFormed`, `applyRowAt_WH` must remain.

- [ ] **Step 3: Build full package**

```bash
cd lean && lake build PuzzleScript
```

Expected: success; no new `sorry`.

- [ ] **Step 4: Commit**

```bash
git add lean/PuzzleScript/WellFormed.lean lean/PuzzleScript/WellFormedTurn.lean
git commit -m "$(cat <<'EOF'
Share applyRowAtFixed induction between WellFormed and WH proofs.

EOF
)"
```

---

### Task 6: Docs + final verify

**Files:**
- Modify: `lean/README.md` (proven cone)
- Modify: `docs/superpowers/specs/2026-07-22-lean-stride-slice-board-mutate-design.md` (Status → Done)

- [ ] **Step 1: README bullet**

Under the Lean proven-cone list, add:

```markdown
- Stride-slice Board mutators (`Board.setStrideSlice`): shared tile×stride writes for
  obj/mov/rigid setters; unified other-tile extract preservation (prep for skipCellWrites)
```

- [ ] **Step 2: Spec status** → `Status: Done (no sorry).`

- [ ] **Step 3: Final verification**

```bash
cd lean && rg '\bsorry\b' PuzzleScript/Board.lean PuzzleScript/WellFormed.lean \
  PuzzleScript/WellFormedTurn.lean PuzzleScript/LineWalk.lean || true
lake build PuzzleScript
cd .. && make lean_parity_smoke
```

Expected: no sorry; build OK; `lean parity smoke: OK`.

- [ ] **Step 4: Commit**

```bash
git add lean/README.md docs/superpowers/specs/2026-07-22-lean-stride-slice-board-mutate-design.md
git commit -m "$(cat <<'EOF'
Document stride-slice Board mutate cleanup and mark the design done.

EOF
)"
```

---

## Spec coverage (plan self-review)

| Spec item | Task |
|-----------|------|
| `Array.setStrideSlice` + four setters | Task 1 |
| size / getD / extract lemmas + Board aliases | Tasks 2–3 |
| Unify rigid cell words | Task 4 |
| Shared Fixed apply preservation (WF+WH) | Task 5 |
| Fold abstraction only if cheap | Task 5 (optional; not forced) |
| README + Done + smoke | Task 6 |
| Non-goals (behavior / Mathlib / skipCellWrites feature) | Not tasked |

**Placeholder scan:** Task 1’s `sorry` is TDD scaffolding — must be cleared before that task’s commit. No TBD left in done bar.

**Type consistency:** `Array.setStrideSlice`, `getD_setStrideSlice_ne`, `extract_setStrideSlice_ne`, `applyRigidCellMasks_cellWords`, `applyRowAtFixed_preserves` (or `_foldl_invariant`) named consistently across tasks; public Board theorem names preserved.
