# Lean Certified `skipCellWrites` Implementation Plan

> **For agentic workers:** Prefer composer-2.5 / grok models only (API budget). Use subagent-driven or inline execution. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Prove inert rules are board no-ops on the **full** apply path via a certified `skipCellWrites` peephole (not only the early-out).

**Architecture:** Flag `Rule.skipCellWrites`; `applyCellReplacement` no-ops when set; `tryApplyRuleSpec` is full apply; prove under `syntacticInertCommandOnly` that full apply = board-id and equals apply of `skipCellWrites r`. Retarget `boardEffectId` leaf.

**Tech Stack:** Lean 4, Lake, no Mathlib.

**Spec:** [docs/superpowers/specs/2026-07-22-lean-inert-skip-cell-writes-soundness-design.md](../specs/2026-07-22-lean-inert-skip-cell-writes-soundness-design.md)

**Isolation:** `.worktrees/lean-skip-cell-writes` branch `lean-skip-cell-writes`.

---

## File map

| File | Role |
|------|------|
| `lean/PuzzleScript/Rules.lean` | `Rule.skipCellWrites`; `Rule.skipCellWritesTransform` |
| `lean/PuzzleScript/IR.lean` | parse default `skipCellWrites := false` |
| `lean/PuzzleScript/Runtime.lean` | skip in `applyCellReplacement`; `tryApplyRuleSpec`; keep early-out |
| `lean/PuzzleScript/Inert.lean` / proofs | board-id on Spec path; ApplyObsEq; retarget leaf |
| `lean/README.md` | bullet when done |

---

### Task 1: Flag + skip in `applyCellReplacement` + `tryApplyRuleSpec`

**Files:** Rules.lean, IR.lean, Runtime.lean

- [ ] Add `skipCellWrites : Bool` to `Rule` (after `isRandom` or at end before deriving).
- [ ] `parseRule`: `skipCellWrites := false` in the structure literal.
- [ ] `def Rule.skipCellWritesTransform (r : Rule) : Rule := { r with skipCellWrites := true }` (name from design `skipCellWrites`).
- [ ] In `applyCellReplacement`, first check:
  ```lean
  if rule.skipCellWrites || !pat.hasReplacement then (false, b, rng) else ...
  ```
  Or nested: `if rule.skipCellWrites then ... else if !pat.hasReplacement ...` — keep proofs simple; prefer:
  ```lean
  if rule.skipCellWrites then (false, b, rng)
  else if !pat.hasReplacement then (false, b, rng)
  else ...
  ```
- [ ] Extract shared full-apply body; define:
  ```lean
  def tryApplyRuleSpec (game) (b) (rule) (st) :=
    let rowMatchLists := ...
    if rowMatchLists.any (·.isEmpty) then (false, b, st)
    else
      let (any, board, rng') := applyMatchedTuples ...
      (any, board, { st with commandQueue := ..., modified := ..., rng := rng' })
  ```
- [ ] `tryApplyRule` = match-fail same; else if `syntacticInertCommandOnly` then early-out; else `tryApplyRuleSpec` body (or call Spec and ignore that Spec already queues — keep behavior identical).
- [ ] Update `applyCellReplacement_noReplacement` / WF proofs for the new if-arm (`rule.skipCellWrites`).
- [ ] Build: `lake build PuzzleScript` + `make lean_parity_smoke` (behavior must match).
- [ ] Commit: `Add Rule.skipCellWrites flag, cell-write skip, and tryApplyRuleSpec.`

### Task 2: Mask identity lemmas

- [ ] Prove `maskApplyReplacement` id criteria under clear/set conditions matching match implications.
- [ ] Commit when green.

### Task 3: Strengthen `P` for shared-layer clears (if needed for proofs)

- [ ] Extend identity / `syntacticInert` predicates with layer metadata per design §7.2.
- [ ] Keep `lean_inert_static_smoke` green.

### Task 4: Cell / row / tuple board-id under `P`

- [ ] `replacementIsIdentity` + match → cell id (reuse stride-slice other-tile lemmas).
- [ ] Lift to `applyRowAt` / `applyRuleTuple` / `applyMatchedTuples`.

### Task 5: Spec apply board-id + skipCellWrites ApplyObsEq

- [ ] `syntacticInert_fullApply_boardId` on `tryApplyRuleSpec`.
- [ ] `syntacticInert_skipCellWrites_apply_eq`.
- [ ] `optimizeRule` corollary.

### Task 6: Retarget Inert leaf + docs + smoke

- [ ] `syntacticInert_boardEffectId` via Spec path (or eq early-out ↔ Spec under `P`).
- [ ] README + design Status Done.
- [ ] `lake build` + `lean_parity_smoke` + `lean_inert_static_smoke`.

---

## Spec coverage

| Spec §11 | Task |
|----------|------|
| Flag + Spec path | 1 |
| Mask lemmas | 2 |
| Strengthen P shared-layer | 3 |
| Lift row/tuple | 4 |
| fullApply boardId + eq | 5 |
| Retarget dropInert leaf + smoke | 6 |
