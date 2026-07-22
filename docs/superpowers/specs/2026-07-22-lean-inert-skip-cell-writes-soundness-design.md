# Lean inert: certified `skipCellWrites` (real-apply soundness)

Status: design draft — awaiting review.
Date: 2026-07-22.

Related:
- Parent: [2026-07-21-lean-post-parity-abstract-inert-design.md](2026-07-21-lean-post-parity-abstract-inert-design.md)
- Predicate: `Rule.syntacticInertCommandOnly` in [`lean/PuzzleScript/Rules.lean`](../../lean/PuzzleScript/Rules.lean) (Lean-computed from IR; not a JS IR tag)
- Existing prune theorems: [`lean/PuzzleScript/Inert.lean`](../../lean/PuzzleScript/Inert.lean) (`dropInert_boardWinEquiv`, …)
- Fixture oracle: `make lean_inert_static_smoke` (JS `inert_command_only` count vs Lean recomputation)

Naming: earlier draft used `skipEffects`; the transform is **`skipCellWrites`** (match + command queue unchanged; board cell writes skipped).

## 1. Problem

We already have (no `sorry`):

- Under `noRandomRuleGroups`, filtering / `dropInert` preserves solver observables (`boardWinEquiv`).
- Leaf “inert apply does not change the board” is currently **definitional** from an early-out in `tryApplyRule`: if `syntacticInertCommandOnly`, skip `applyMatchedTuples` and only queue commands.

That leaf does **not** prove the interesting claim: a rule that Lean marks inert would leave the board unchanged **if we ran the normal cell-replacement path**. The early-out is an optimization; it is only honest once that claim is proved.

Random rule groups stay out of scope (separate apply path / RNG); that exclusion is intentional and unchanged.

## 2. Two separate optimizations / theorems

| Transform | What it does | Observer | Theorem shape |
|-----------|----------------|----------|----------------|
| **`skipCellWrites`** | Keep the rule; still match + queue sfx/message; skip cell board writes | Play-ish apply (`ApplyObsEq`: board, changed, RNG, cmd queue) | `P(r) → ⟦r⟧ = ⟦skipCellWrites r⟧` |
| **`dropInert`** | Remove inert rules entirely | Solver (`boardWinEquiv`: board, win, level) | `noRandom → boardWinEquiv g (dropInert g)` |

`skipCellWrites` is the honest leaf (“inert writes are no-ops”).  
`dropInert` is the stronger solver prune (sounds/messages out of scope); it can rest on the leaf plus “inert command queues don’t affect solver obs.”

## 3. Goal (rock-solid `skipCellWrites` cone)

Prove a **certified peephole**:

1. Decidable guard `P(r)` = `r.syntacticInertCommandOnly` (already computed in Lean from IR).
2. Executable transform `skipCellWrites : Rule → Rule` that makes the cell-write phase a no-op (match + command queue unchanged).
3. Semantic theorem:  
   `P(r) → ⟦r⟧ = ⟦skipCellWrites r⟧`  
   where `⟦·⟧` is the **full** apply path (no early-out), compared on board + `changed` + RNG (command queue may still gain sfx/message).
4. Optimizer: `optimizeRule r := if P(r) then skipCellWrites r else r`, with corollary `⟦optimizeRule r⟧ = ⟦r⟧`.
5. Optionally keep a fast `tryApplyRule` that early-outs when `P(r)`; justify it by `⟦r⟧ = ⟦skipCellWrites r⟧` (or by proving fast ≡ full under `P`).

Done-bar for this doc: (3) at rule-apply granularity, plus (4). Re-stating `dropInert_boardWinEquiv` against the full path (or via the bridge) is in-scope cleanup once (3) exists; it should not remain justified only by the early-out.

## 4. Design principle: spec path vs optimization

| Piece | Role |
|-------|------|
| **Spec apply** | Always runs match + `applyMatchedTuples` / `applyCellReplacement` (today’s non-inert branch). This is what “inert means board id” must mean. |
| **`skipCellWrites r`** | Same rule for matching/commands; cell writes skipped (flag or cleared replacement surface). |
| **Fast `tryApplyRule`** | Optional engine sugar: if `P(r)`, behave like apply of `skipCellWrites r` without walking tuples. |
| **Proofs** | Erased. Runtime never asks “is this proved?”; it asks decidable `P`. Proofs say `P` is a sound trigger. |

Do **not** prove board-id only by unfolding `if P then earlyOut`. That assumes the optimization.

## 5. Shape of `skipCellWrites`

Prefer a **flag** on `Rule` (or on each `CellPattern`) over deleting IR masks:

```text
Rule.skipCellWrites : Bool
```

- `skipCellWrites r` sets the flag (and leaves patterns/commands intact).
- `applyCellReplacement`: if skip flag (or `!hasReplacement`), return `(false, board, rng)` without mask writes / rigid bookkeeping.
- Matching, property/aggregate capture setup, and `queueCommandsForRule` still run as today for the non-skip path; under `P`, captures are already empty (`commandOnlyMeta` forbids bindings / rigid / random).

Alternative (also fine): clear `hasReplacement` on every cell. Flag is clearer in proofs (“same IR, skip writes”).

## 6. Semantic equality

Define observational equality of one apply (names indicative):

```text
ApplyObsEq (changed, board, turn) (changed', board', turn') :=
  changed = changed'
  ∧ board.objects = board'.objects
  ∧ board.movements = board'.movements
  ∧ turn.rng = turn'.rng
  ∧ cmdEffectEq turn.commandQueue turn'.commandQueue   -- already in Runtime
```

(Adjust if rigid masks must be included; under `P`, `r.rigid = false`.)

Then:

```text
theorem syntacticInert_skipCellWrites_apply_eq
  (game) (r) (h : P r) (b) (st) :
  ApplyObsEq (tryApplyRuleSpec game b r st)
             (tryApplyRuleSpec game b (skipCellWrites r) st)
```

where `tryApplyRuleSpec` is the full path (no inert early-out).

Stronger leaf used inside that proof:

```text
theorem syntacticInert_fullApply_boardId
  (game) (r) (h : P r) (b) (st)
  (hMatch : rule matches on b) :  -- or: state the match-fail case separately
  (tryApplyRuleSpec …).changed = false
  ∧ (tryApplyRuleSpec …).board = b
  ∧ (tryApplyRuleSpec …).rng = st.rng
```

Match-fail is already board-id for both paths. The content is the match-success case.

## 7. Proof plan (bottom-up)

### 7.1 Mask algebra

For `maskApplyReplacement old clear set = (old &&& ~~~clear) ||| set`:

- If `set ⊆ old` and `(old ∩ clear) ⊆ set`, then result = `old`.
- Specialize under cell match: `objectsPresent ⊆ old`, `old ∩ objectsMissing = ∅` (whatever `cellPatternMatches` actually implies — prove from that definition, don’t invent).

### 7.2 Identity replacement ⇒ cell write is id

Under `CellPattern.replacementIsIdentity` (current Lean predicate: object + movement identity halves, no random/inferred/layer-coupled mutators) **and** `cellPatternMatches b t pat`:

- Object rewrite leaves `cellObj` unchanged.
- Movement rewrite (`movementsClear` / `movementsLayerMask` / `movementsSet`) leaves `cellMov` unchanged.
- No rigid updates (`r.rigid = false` from `commandOnlyMeta`).

**Shared-layer clears:** IR may clear a full collision-layer mask and restore `objectsPresent` (e.g. Player|Goal clear, Player set). Pure mask reasoning without layer exclusivity can fail on ill-formed boards (two same-layer objects on one tile). Options (pick in implementation; prefer A if cheap):

- **A (preferred):** hypothesis `Board.WellFormed game b` (≤1 object per layer per tile), already aligned with session WF work.
- **B:** strengthen `objectReplacementIsIdentity` so clear bits outside `set` are only same-layer mates of `set` (needs `game.objectLayers` / `layerMasks` in the predicate).

Document the chosen hypothesis on every theorem that needs it.

### 7.3 No replacement / ellipsis

- `!hasReplacement` → `applyCellReplacement` already returns unchanged (definitional).
- Ellipsis cells do not write.

### 7.4 Lift: row → tuple → matched tuples → spec apply

- `applyRowAt` over identity/no-op cells → board id.
- `applyRuleTuple` under `P` → board id (captures empty; no inferred mutators).
- `applyMatchedTuples` over any tuple list → board id, `changed = false`, RNG unchanged.
- `tryApplyRuleSpec`: match fail → id; match success → id + queue inert commands only.

### 7.5 Bridge to `skipCellWrites` / fast path

- `tryApplyRuleSpec game b (skipCellWrites r) st` queues the same commands and never writes cells → equal to the board-id full apply under `P`.
- Fast early-out in `tryApplyRule` (if kept) proved equal to `tryApplyRuleSpec` under `P` by the above (both sides board-id + same queue behavior).

### 7.6 Existing `dropInert` cone

Once `syntacticInert_fullApply_boardId` exists:

- Rephrase `Rule.boardEffectId` / `syntacticInert_boardEffectId` to mean **spec** apply, not early-out unfold.
- Keep `dropInert_*` proofs; change only the leaf justification so the cone is honest.
- Early-out may remain in the executable `tryApplyRule` as an optimization with an equality theorem.

## 8. What Lean already has (reuse)

- `syntacticInertCommandOnly` / identity RHS predicates (`Rules.lean`) — Lean-side `P`, not loaded from JS.
- `commandOnlyMeta`: nonempty commands, `¬random`, `¬rigid`, empty property/aggregate bindings.
- Inert commands: sfx / message only (`Command.isInert`).
- Static smoke: JS tag counts vs Lean `P` on real suite fixtures (`lean_inert_static_smoke`).
- Filter / turn / replay congruence under `noRandomRuleGroups` (keep; don’t rebuild).

## 9. Out of scope

- Proving Lean `P` ↔ JS AST `tags.inert_command_only` (smoke continues to police drift).
- Random rule groups / `applyRandomRuleGroup`.
- Semantic commands (`win`, `again`, …) as inert.
- Cosmetic / merge / other tags.
- Changing JS optimizer behavior.
- Full abstract-view rewrite of this proof (masks + match definitions are enough for this rock; abstract view remains useful vocabulary elsewhere).

## 10. Approaches considered

1. **Remove early-out only; prove board-id on the remaining path** — Honest, but mixes “optimization” with “spec”. Fine as an intermediate refactor; still want `skipCellWrites` as the named transform.
2. **Certified peephole `P → ⟦r⟧ = ⟦skipCellWrites r⟧` (chosen)** — Matches the intended optimizer story; early-out is optional sugar.
3. **Prove only `dropInert` via commuting diagrams without cell-id** — Leaves the cheat at the leaf; rejected for this milestone.

## 11. Milestone checklist

1. Introduce `skipCellWrites` (flag) + `tryApplyRuleSpec` (full path); keep or reattach early-out behind a proved eq.
2. Mask lemmas: `maskApplyReplacement` identity criteria.
3. `replacementIsIdentity` + `cellPatternMatches` → cell board-id (with WF hypothesis if needed).
4. Lift through row / tuple / `applyMatchedTuples`.
5. `syntacticInert_fullApply_boardId` + `syntacticInert_skipCellWrites_apply_eq`.
6. `optimizeRule` + corollary.
7. Retarget `syntacticInert_boardEffectId` / docs in `Inert.lean` so the leaf is the full-path theorem.
8. `lake build` + `make lean_inert_static_smoke` still green; note in `lean/README.md`.

## 12. Success criteria

- No `sorry`.
- Board-id for inert rules is proved about **spec apply** (real replacements), not solely by early-out.
- `P(r) → ⟦r⟧ = ⟦skipCellWrites r⟧` (ApplyObsEq).
- Existing `dropInert_boardWinEquiv` remains true; its leaf dependency is the new theorem (or an equality that routes through it).
- Static inert corpus smoke still passes (predicate drift caught vs JS).

## 13. Risks

- **Ill-formed boards / shared layers:** identity clears need WF or a stronger predicate (§7.2).
- **`cellPatternMatches` / any-masks / layer-coupled reads:** match definition may be richer than `present`/`missing`; proof must follow the real matcher.
- **Movement layer masks:** `[ right X ] -> [ right X ]` clears a layer movement mask then restores; algebra must cover `movementsLayerMask`, not only `movementsClear == movementsSet`.
- **Proof engineering size:** `applyCellReplacement` is an `Id.run` block; may need small refactors (pure helpers) to make induction/simp feasible without changing behavior.
- **Accidental behavior change:** any refactor of `tryApplyRule` must keep parity / inert smoke green.

## 14. Spec self-review

- No TBD placeholders for the done-bar; WF-vs-stronger-predicate is an explicit implementation choice (§7.2).
- Does not contradict parent inert design: strengthens the `syntacticInert → boardEffectId` step that parent assumed.
- Scope limited to non-random full apply + certified skip; prune cone reuse called out; `dropInert` kept as a separate theorem.
