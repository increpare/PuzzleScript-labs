# Lean stride-slice Board mutate cleanup

Status: Done (no sorry).
Date: 2026-07-22.

Related:
- Board storage: [`lean/PuzzleScript/Board.lean`](../../lean/PuzzleScript/Board.lean)
- Preservation / WF: [`lean/PuzzleScript/WellFormed.lean`](../../lean/PuzzleScript/WellFormed.lean), [`WellFormedTurn.lean`](../../lean/PuzzleScript/WellFormedTurn.lean)
- Apply folds: [`lean/PuzzleScript/Runtime.lean`](../../lean/PuzzleScript/Runtime.lean) (`applyRowAtFixed`, `applyRowAtFold`)
- Consumers: [`LineWalk.lean`](../../lean/PuzzleScript/LineWalk.lean) (off-walk), upcoming [inert skipCellWrites](2026-07-22-lean-inert-skip-cell-writes-soundness-design.md)
- Prior locality work (done): [line-walk locality](2026-07-22-lean-line-walk-locality-design.md)

## 1. Problem

Four Board mutators share the same shape (tile × stride foldl-`set!` into a `UInt32` array):

- `setCellObjWords` / `setCellMovWords`
- `setCellRigidMovementAppliedMask` / `setCellRigidGroupIndexMask`

WellFormed then duplicates proofs for obj vs mov (`getD_*_ne`, `cell*Words_set*_ne`, rigid “words unchanged”). `applyRowAtFixed` WF and WH re-induct the same fold. That tax will hit again for `skipCellWrites` (“other tiles unchanged” / cell-write no-ops).

Goal: one stride-slice story + thinner Board wrappers + shared apply-fold preservation, without changing runtime behavior.

## 2. Goals (done bar)

| Layer | Claim |
|-------|--------|
| **API** | One `Array.setStrideSlice` (or equivalent name) used by all four Board setters |
| **Lemmas** | Generic `getD` / extract / size facts for stride-slice; Board public lemmas remain (aliases OK) |
| **Rigid** | One “applyRigid preserves obj+mov cell words” fact (not two copy-paste unfolds) |
| **Apply** | Shared induction for `applyRowAtFixed` (and Fold where cheap) feeding both WF and WH |
| **Verify** | `lake build PuzzleScript`; `make lean_parity_smoke`; no new `sorry` |

Hygiene + skipCellWrites prep; larger diff OK if the result is clearer.

## 3. Non-goals

- Changing match/apply **behavior** or IR
- Mathlib
- Rewriting all mask/bit WellFormed theory
- Ellipsis/omni line-walk extensions
- Full generic `Preserves (P : Board → Prop)` over every Runtime loop (only Fixed/Fold apply rows in scope)
- Implementing `skipCellWrites` itself (separate track; this prep only)

## 4. Design

### 4.1 Stride-slice core

Add (prefer in `Board.lean`, or a thin `StrideSlice.lean` imported by Board if file size warrants):

```lean
/-- Write `ws` into the tile-sized slice `[tile * stride, tile * stride + stride)`. -/
def Array.setStrideSlice (xs : Array UInt32) (tile stride : Nat) (ws : MaskWords) :
    Array UInt32 :=
  let start := tile * stride
  (List.range stride).foldl
    (fun arr i => arr.set! (start + i) (ws.getD i 0))
    xs
```

Board setters become structure updates of one field:

```lean
def Board.setCellObjWords (b : Board) (tile : Nat) (ws : MaskWords) : Board :=
  { b with objects := Array.setStrideSlice b.objects tile b.strideObj ws }
-- likewise movements / rigid* with strideMov
```

Accessors (`cellObjWords` = `extract`) stay as today.

### 4.2 Generic lemmas → Board aliases

Prove once (on `setStrideSlice` / extract):

- `size_setStrideSlice`
- `getD_setStrideSlice_ne` (disjoint indices via existing `tile_ranges_disjoint`)
- `extract_setStrideSlice_ne` (other tile’s extract unchanged) — the lemma LineWalk / skipCellWrites want

Keep / restate:

- `Board.objects_getD_setCellObjWords_ne`, `Board.cellObjWords_setCellObjWords_ne`, mov twins  
  as thin wrappers (same statements callers already use).

Cross-field: `cellMovWords_setCellObjWords` / `cellObjWords_setCellMovWords` stay one-liners (`simp` on structure update).

### 4.3 Rigid apply

Collapse `applyRigidCellMasks_cellObjWords` and `_cellMovWords` into one theorem returning both equalities (or a single “structure fields objects/movements/strides/dims unchanged” lemma). Existing call sites adapt with `.1` / `.2` or projection.

### 4.4 Apply-row fold preservation

For `applyRowAtFixed`, factor one induction:

- Hypothesis: a property `P : Board → Prop` (or pair width/height) preserved by `applyCellReplacement` (and trivial on skip arms).
- Specialize to `Board.WellFormed game` and to `fun b' => b'.width = b.width ∧ b'.height = b.height`.

Same idea for `applyRowAtFold` if the shared body is still duplicated after Fixed; do not force a heroic abstraction if Fold stays one copy used by both WF and WH via existing Fold theorems.

Public names `applyRowAtFixed_wellFormed`, `applyRowAtFixed_WH`, `applyRowAt_wellFormed`, `applyRowAt_WH` remain.

### 4.5 Module layout

- Default: put `setStrideSlice` + core lemmas in `Board.lean` (keeps imports simple).
- If `Board.lean` becomes awkward: `PuzzleScript/StrideSlice.lean` imported by Board; wire in `PuzzleScript.lean` only if needed for lake roots.
- Move generic `Array.getD_foldl_set!_*` / `getD_extract` next to stride-slice if they only serve this story (optional cleanup inside the same PR).

## 5. Risks / tactics

- **Definitional equality:** wrappers must stay `rfl`-close to old folds so existing `simp [setCellObjWords]` proofs do not explode; prefer `simp [setCellObjWords, setStrideSlice]` where needed.
- **Heartbeat:** avoid re-proving extract equality via heavy `simp`; reuse the getElem_extract + getD pattern already landed for `cellObjWords_setCellObjWords_ne`.
- **Alias breakage:** do not rename public Board theorems without leaving deprecated aliases in the same commit.

## 6. Verification

```bash
cd lean && lake build PuzzleScript
cd .. && make lean_parity_smoke
rg '\bsorry\b' lean/PuzzleScript/Board.lean lean/PuzzleScript/WellFormed.lean \
  lean/PuzzleScript/WellFormedTurn.lean lean/PuzzleScript/LineWalk.lean || true
```

Expected: build OK; smoke OK; no new sorry.

## 7. Implementation sketch (for the plan)

1. Add `setStrideSlice` + size/getD/extract lemmas; rewrite four Board setters.
2. Re-point Board `*_ne` / size theorems as wrappers; rebuild WellFormed.
3. Unify rigid cell-word preservation.
4. Factor Fixed (then Fold if needed) apply preservation for WF + WH.
5. Smoke + README note under Lean proven cone / Next (one line: stride-slice cleanup).

## 8. Spec self-review

- No TBD / placeholder API beyond optional file split.
- Non-goals explicit (`skipCellWrites` not in this PR).
- Public theorem names preserved as aliases.
- Consistency with line-walk off-walk (uses `applyCellReplacement_preserves_other_tiles` → stride-slice under the hood).
