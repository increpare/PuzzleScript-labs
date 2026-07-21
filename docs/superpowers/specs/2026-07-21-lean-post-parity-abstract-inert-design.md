# Lean post-parity: abstract view + inert command-only soundness

Status: design approved; implementation gated on clean-corpus Lean parity.
Date: 2026-07-21.

Related: [2026-07-21-lean-puzzlescript-design.md](2026-07-21-lean-puzzlescript-design.md) (v1 executable parity smoke).
JS counterparts: [`src/tests/ps_static_analysis.js`](../../src/tests/ps_static_analysis.js) (`rule.tags.inert_command_only`), [`src/tests/solver_static_opt.js`](../../src/tests/solver_static_opt.js) (inert prune), [`src/tests/STATIC_ANALYSIS_SOUNDNESS.md`](../../src/tests/STATIC_ANALYSIS_SOUNDNESS.md).

## 1. Goals, scope, and non-goals

### Primary goal

After the Lean bitmask runtime covers the **clean simulation corpus** (admission policy in the v1 Lean design), begin theorem work that **underwrites a real JS/C++ optimizer**:

1. Front-load an **abstract view** of boards and rules (objects at tiles, pending movements) with a proven bridge to the mask runtime.
2. Define what **`inert_command_only`** means relative to that view.
3. Prove that dropping such rules preserves **board + win** behavior (solver-facing equivalence).

### Secondary goals

- Establish a reusable pattern: for each later tag analysis (cosmetic, temporary, …), define vocabulary that makes claims easy to state, prove on the view, transport to masks.
- Leave a clear hand-off to **per-game discharge (C)** and **certified search (B)** without doing them in this milestone.

### Gate

Do **not** start this work until Lean parity on the clean corpus is boring under the existing whitelist / `parity_clean_candidates.txt` policy. Theorem work on a partial runtime is fragile.

### In scope

- Abstract board/rule vocabulary + `toMask` / `fromMask` + step equivalence for the kernel subset needed by inert theorems.
- Accept **inert commands** (`sfx*`, `message`) in Lean IR/runtime as board no-ops; fail closed on semantic commands (`win`, `again`, `undo`, …) until modeled separately.
- Definitions: `syntacticInertCommandOnly`, `boardEffectId`, `dropInert`, `boardWinEquiv`.
- Soundness: syntactic inert ⇒ board-effect identity ⇒ prune preserves `boardWinEquiv`; transport to mask `Game` / `Session`.
- One tiny **hand-written** Lean `Game` discharging the theorem (not gallery codegen).

### Out of scope

- Full tag suite (cosmetic, temporary, merge, action-noop, layer-inert as first-class proofs).
- IR → Lean codegen for real corpus/gallery games (track C).
- Lean solver / completability search (track B).
- Making the abstract view the execution path for `lean_parity_smoke` (masks stay authoritative for fixtures).
- Replacing JS runtime-contract fuzzing or changing JS optimizer behavior.

## 2. Design principle: vocabulary before grind

Masks are an efficient encoding, not the language in which humans (or Lean) should state gameplay facts.

For each analysis, ask:

- What concepts make the claim easy to *state*?
- Do we need a new **view** on the underlying mask model?
- Can theorems be proved on that view and transported via equivalence?

Analogy: in geometry, define `is_normal_to` / `is_on_same_side` before grinding cross products. Same habit here: define “object present at tile”, “pending move”, “rule never changes occupancy” before grinding bit clears/sets.

**Authority split**

- **Masks + existing `step`:** executable parity oracle (fixtures, whitelist).
- **Abstract view:** reasoning surface. Not a second drifting engine: define the view so it matches mask `step`, then reason in the view.

Grow vocabulary incrementally per tag analysis; do not build a one-shot mega-model of all PuzzleScript.

## 3. Why `inert_command_only` first

JS already tags rules as `inert_command_only` when:

- Commands are non-empty and every command is inert (`sfx*` / `message` in the solver opt; same family as analyzer `INERT_COMMANDS`).
- The rule is `command_only`: no object mutation and no movement writes (LHS/RHS signatures match; no absent/random object RHS effects).

The optimizer drops those compiled rules for solver search.

That is the smallest real prune with a crisp semantic story: **boards and win flags unchanged**; sound/message side effects are outside the equivalence.

Cosmetic is deferred: projection + undo-scoped soundness (documented in `STATIC_ANALYSIS_SOUNDNESS.md`) is a harder first theorem.

## 4. Architecture

```text
clean corpus parity (gate)
        │
        ▼
Abstract view: tiles → objects / pending movements
   + toMask / fromMask
   + theorem: abstractStep ≡ maskStep  (kernel subset)
        │
        ▼
Inert commands accepted as board-irrelevant effects
        │
        ▼
syntacticInertCommandOnly / boardEffectId / dropInert / boardWinEquiv
   (stated on abstract view)
theorem: Inert… → boardWinEquiv g (dropInert g)
   + transport to mask Game/Session
        │
        ▼
tiny hand-written Game discharge
        │
        ▼
later: C (IR→Lean per game) · B (certified search)
```

### 4.1 Abstract view (first deliverable after the gate)

Minimum vocabulary for inert:

- Tile coordinates / tile index consistent with Lean runtime (column-major: `x * height + y`).
- Occupancy: which object ids are present at a tile (set-like; layer constraints as needed for movement resolution theorems later).
- Pending movements: which object ids have which movement intents at a tile.
- Rule match/apply described as reading/writing those sets, not mask words.
- Bridge: `toMask` / `fromMask` (or round-trip with `Board`) and proofs that abstract and mask steps agree on the supported kernel.

Do not require the abstract stepper to be used by `parity_smoke`; equivalence is enough.

### 4.2 Equivalence for soundness

**`boardWinEquiv g g'`:** for every finite input sequence, running `g` and `g'` from the same initial session yields the same sequence of boards (object + movement masks, or their abstract images) and the same win flags / level-advance behavior used by the Lean session model.

Explicitly **not** required: equal sound events, message text side effects, or undo-stack depth (inert prune is already solver-oriented in JS).

### 4.3 Predicate chain

Prefer a two-step implication so per-game work stays mechanical:

1. `syntacticInertCommandOnly(r) → boardEffectId(r)`  
   Syntax mirrors JS tagging (command set + no object/movement mutation).  
   `boardEffectId` in abstract words: applying `r` never adds/removes objects or changes pending moves (commands may fire but are board-irrelevant).

2. If every dropped rule satisfies `boardEffectId`, then `boardWinEquiv g (dropInert g)`.

Track C later only needs to establish `syntacticInertCommandOnly` on concrete games (decide / codegen / `#eval`), then inherit soundness.

### 4.4 Runtime gap

Today Lean **rejects non-empty `commands`** (`lean/README.md`, `PuzzleScript/IR.lean`). This milestone extends parse/runtime so:

- Inert commands are accepted and do not change `Board` / win state.
- Semantic commands remain fail-closed until a later milestone models them.

## 5. Approaches considered

1. **Bitmask-first inert prune** — Thin first theorem; every later tag fights masks. Rejected.
2. **Abstract-view-first, then inert (chosen)** — Vocabulary + equivalence, then prove prune in that language and transport.
3. **Cosmetic-first** — Higher solver payoff; wrong first proof (projection, undo scope).

## 6. Milestone checklist (when corpus is done)

1. Confirm clean-corpus Lean parity gate.
2. Abstract view + mask bridge + step equivalence (kernel for inert).
3. Inert command stubs in IR/runtime.
4. Definitions on the abstract view (`boardEffectId`, `syntacticInertCommandOnly`, `dropInert`, `boardWinEquiv`).
5. Main soundness lemma + transport to mask runtime.
6. Hand-written mini-game theorem.
7. Short note in `lean/README.md` (or adjacent doc) linking this work to the JS inert optimizer; point at C/B follow-ons.

## 7. Follow-ons (not this milestone)

| Track | What | Depends on |
|-------|------|------------|
| **C** | IR→Lean `Game` terms; discharge tags per game | A implication lemmas |
| **B** | Certified search / solution checking | Stable `step` + optionally prune-preserving `boardWinEquiv` |
| Later A tags | Cosmetic, temporary, … | Same vocabulary-before-grind habit; new views as needed |

## 8. Testing and success criteria

- Mask parity suite still green (abstract work must not break the oracle path).
- Lean proves (or has a clear lemma statement with completed proof) inert prune soundness under `boardWinEquiv` for the supported kernel.
- Mini-game: a concrete `Game` with an inert command-only rule; `dropInert` yields a `boardWinEquiv`-related theorem.
- No requirement that Lean reproduce JS sound/message traces for these rules.

## 9. Risks

- **Abstract/mask drift:** mitigate by proving equivalence early and keeping parity execution on masks.
- **Command surface creep:** only inert commands in this milestone; semantic commands stay fail-closed.
- **Over-building the view:** limit v1 abstract API to what inert proofs need; add concepts when the next tag analysis asks for them.
