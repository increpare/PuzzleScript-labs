# Lean WellFormed preservation (Board / Session)

Status: Done (Phases A–C landed; no `sorry`).
Date: 2026-07-22.

Related:
- Deferred from: [2026-07-22-lean-inert-skip-cell-writes-soundness-design.md](2026-07-22-lean-inert-skip-cell-writes-soundness-design.md) (§7.2 / §13: WF threading out of scope for inert leaf)
- Predicates live in [`lean/PuzzleScript/View.lean`](../../lean/PuzzleScript/View.lean) (`Board`/`Session`) and [`lean/PuzzleScript/IR.lean`](../../lean/PuzzleScript/IR.lean) (`Game` / `layerRespecting`)
- Proofs: [`lean/PuzzleScript/WellFormed.lean`](../../lean/PuzzleScript/WellFormed.lean), [`lean/PuzzleScript/WellFormedTurn.lean`](../../lean/PuzzleScript/WellFormedTurn.lean)

## 1. Problem

`Board.wellFormed` / `Session.wellFormed` encode the gameplay invariant “≤1 object per collision layer per tile” plus stride/geometry coherence. They are checked in `parity_smoke --check-session-wf`, but nothing yet proves the mask runtime **preserves** them.

Without preservation theorems, any proof that assumes WF on the leaf must re-hypothesize it across movement, rigid retry, commands, undo/restart — which is why the inert `skipCellWrites` cone strengthens the IR predicate `P` instead of taking WF.

## 2. Goals (done bar)

Prove, with no `sorry`:

| Phase | Claim |
|-------|--------|
| **A** | Under `Game.WellFormed` (+ layer-respecting rules): board mutators preserve `Board.WellFormed` |
| **B** | `Session.WellFormed g s` ⇒ successful `executeTurn.go … = .ok (s', _)` ⇒ `Session.WellFormed g s'` |
| **C** | Same for public `executeTurn`, `processInput` (+ again drain), and `replaySolverGo` |

Initial `Session.WellFormed` remains a **hypothesis** discharged by smoke / `--check-session-wf`, not proved from fixture IR bytes.

## 3. Non-goals

- Prove IR level payloads ⇒ `Session.WellFormed`
- Retarget inert `skipCellWrites` / `dropInert_*` to take WF hypotheses
- Dependent `Board` subtypes; abstract-view as primary proof surface
- Changing JS or Lean gameplay semantics

## 4. Predicate stack

All decidable `Bool` + `Prop` aliases:

1. **`Board.wellFormed`** — strides/sizes; valid layers for present objects; ≤1 object per layer per tile
2. **`Game.wellFormed`** — `objectLayers` size/valid; `layerMasks` bit-equivalent to `Game.buildLayerMasks`; counts/strides coherent
3. **`CellPattern.layerRespecting`** — if `hasReplacement`: ≤1 set-bit per collision layer among `objectsSet`; for each set object id, that layer’s mask ⊆ `objectsClear`
4. **Rule / group / game lifts** — every replacement cell in `rules` and `lateRules` is layer-respecting
5. **`Session.wellFormed`** — active playable geometry; board/restart/undo frames well-formed

**Fail-closed IR load:** `parseGame` rejects games where `Game.wellFormed` or rule `layerRespecting` fails. Same Bools as in theorems (no “JS wouldn’t emit that”).

Random entity / inferred mutators OR layer clears at apply time in the runtime; static `layerRespecting` polices the compiled `objectsSet`/`objectsClear` surface. Preservation proofs for random/inferred paths use the runtime’s layer-clear steps.

## 5. Proof architecture

Mask-runtime Prop ladder (same engineering style as `Inert.lean`: fuelled `go`, `Except` cases, congruence lifts).

```text
IR load (fail closed)
    → Game.WF + rules layerRespecting
    → applyCellReplacement → row/tuple/rules
    → startMovement / reposition / resolveMovements
    → Phase A: Board.WF
    → undo / restart / checkpoint / cmd queue
    → Phase B: executeTurn.go Session.WF
    → Phase C: processInput / again drain / replaySolverGo
```

Minimal Runtime extracts for proof accessibility; no gameplay change.

## 6. Relationship to inert

Parallel track. Inert leaf stays on stronger `P` (shared-layer identity in IR). A later cleanup *may* offer WF-based alternate proofs; out of scope here.

## 7. Success criteria

- No `sorry`
- A/B/C theorems as in §2
- Whitelist still loads under fail-closed checks; `make lean_parity_smoke` green
- `--check-session-wf` remains initial-session discharge
- `lean/README.md` updated

## 8. Risks

- **`Id.run` / private helpers** — may need pure extracts
- **Undo + level cursor** — restore frame’s `LevelIdx` for `activePlayableLevel?`
- **`runRulesOnLevelStart` after restart** — nested fuelled `executeTurn`
- **Proof size** — movement + rigid restore are the heavy A pieces; session undo/restart the heavy B pieces
