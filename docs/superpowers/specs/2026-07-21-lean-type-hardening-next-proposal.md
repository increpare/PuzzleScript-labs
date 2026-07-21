# Proposal: next Lean type-hardening milestones

Status: **proposal** (not yet approved for implementation).  
Date: 2026-07-21.  
Depends on: [abstract view types design](2026-07-21-lean-abstract-view-types-design.md) (landed on master), [post-parity inert design](2026-07-21-lean-post-parity-abstract-inert-design.md).

## 1. Why harden further

We already closed the first hygiene gap: `Command`, `Dir4`, index newtypes, `occ`/`movAt`/`neighbor`, and JS-aligned `againEligible`. That makes *some* index/command confusion unrepresentable and gives inert proofs a vocabulary.

Most of the executable model is still “stringly typed” in the broad sense: almost every board/rule/session field is `Nat`, `Int`, or raw `MaskWords`, with invariants only in comments and smoke tests. That blocks:

- stating `boardEffectId` / `dropInert` without forever quantifying over “well-formed masks”;
- preventing tile/layer/object index mixups inside `Runtime.lean` (still the bulk of the engine);
- upgrading `ObjectSet` (List stand-in) to real set reasoning;
- dependent “this board belongs to this game” facts that inert and later tags need.

This proposal sequences the next hardening so each slice keeps `make lean_parity_smoke` green and feeds the inert soundness track—not a big-bang rewrite of `Runtime.lean`.

## 2. Current surface (honest inventory)

| Area | Today | Risk if left raw |
|------|--------|------------------|
| `Command` / `Dir4` / `Ids` | Done | — |
| `Board` cell APIs | `tile : Nat`, `layer : Nat` | Pass object id as tile |
| `Rule.direction` | `Nat` bitfield | Silent wrong-axis scans |
| `InputToken.movement` | `Int` | Action vs dir confusion |
| `CellPattern` | Opaque `MaskWords` everywhere | No “command-only / no movement write” at type level |
| `PropertyAlias.objectId` / `layerIndex` | `Nat` | Cross-game id bugs in proofs |
| `WinCondition.quantifier` | `Int` (`1`/`-1`/`0`) | Magic numbers in theorems |
| `RowMatch` starts/gaps | `Nat` | Off-board matches as “just a Nat” |
| `Game.objectLayers` | `Array Nat` | Length vs `objectCount` unchecked |
| `Session` | Free `Board` + level index | Board from wrong game/level |
| `ObjectSet` | `List ObjectId` | Weak extensionality vs `Finset` |
| `Board.WellFormed` | Bool Prop alias | Not preserved by `step` in the type |
| `Abstract` bridge | `BoardViewEq` = mask equality | Not yet a real abstract stepper |

**Non-goal of this proposal:** making the abstract stepper the smoke execution path. Masks stay authoritative for fixtures.

## 3. Design principles (carry forward)

1. **Views over masks** — keep projecting; don’t grow a second board store.
2. **Unwrap only at bit boundaries** — `.val` / `toBits` live next to `maskGetBit` / `setLayerMovementBits`.
3. **Narrow kernels for proofs** — prefer “command-only fragment” theorems over claiming whole-`Runtime` equivalence.
4. **Fail closed in IR** — unknown commands already error; extend that habit to directions, win quantifiers, input tokens.
5. **Smoke is the regression oracle** — every hardening PR must leave `make lean_parity_smoke` green.
6. **Feed inert next** — type work that doesn’t help `syntacticInertCommandOnly → boardEffectId → dropInert` is lower priority.

## 4. Recommended approach

Three competing strategies:

| Approach | Idea | Trade-off |
|----------|------|-----------|
| **A. Dependent everything** | `Board game`, `TileIdx b`, `LayerIdx game` as `Fin` | Strongest types; fights level transitions / session reloads |
| **B. Phased newtypes + WF predicates (recommended)** | Keep flat newtypes; strengthen `Game`/`Board`/`Rule` fields; prove `WellFormed` preservation on the inert kernel | Matches what already shipped; proof debt explicit |
| **C. Mathlib-first** | Add Mathlib/`Finset` before more wrappers | Heavy Lake dep; delays inert |

**Recommendation: B**, with a **late optional Mathlib** spike only if `ObjectSet` lemmas become painful. Use `Fin` locally where the bound is truly `Game`-constant (`layerCount`, `objectCount`) *inside view/proof modules*, without forcing every Runtime helper to take `Fin` tomorrow.

## 5. Proposed milestones

### Milestone T1 — Runtime API edges use `Ids` / `Dir4` (no behavior change)

**Goal:** Stop new call sites from mixing tile/layer/object as bare `Nat`.

**Changes:**

- Public / semi-public Board helpers take `TileIdx` / `LayerIdx` where cheap (`cellObjWords`, `getMovementBitsForLayerAt` wrappers).
- Private Runtime loops may keep `Nat` iterators but convert at boundaries: `⟨tile⟩`, `⟨layer⟩`.
- `InputToken`:  
  `inductive InputToken | move (d : Dir4) | action | undo | restart | tick`  
  (map JS `4` → `.action`, `0..3` → `Dir4.ofInputIndex?`).
- `Rule.direction`: keep the bitfield for multi-dir rules, but wrap as  
  `structure RuleDir where bits : UInt32` with `toDelta` / `scanBounds` only via that type (don’t pretend it’s a single `Dir4`—rules can be omni).

**Done when:** smoke green; `grep` shows no new public `tile : Nat` helpers added; InputToken no longer carries free `Int` for movement.

**Feeds inert:** cleaner `againEligible` / turn plumbing statements; fewer spurious `Nat` equalities in proofs.

---

### Milestone T2 — Game-relative identifiers

**Goal:** Make “object id / layer for *this* game” hard to mis-state in IR and views.

**Changes:**

- `structure ObjectId (n : Nat) where val : Fin n` **or** keep flat `ObjectId` +  
  `def Game.ValidObject (g : Game) (o : ObjectId) : Prop := o.val < g.objectCount`.
- Prefer the Prop/`Valid*` approach first (less churn than indexing every structure by `objectCount`).
- `Game.objectLayers : Array LayerIdx` with IR check `size = objectCount` and each `val < layerCount`.
- `PropertyAlias` uses `ObjectId` + `LayerIdx`.
- Strengthen `Board.wellFormed` to require `objectLayers` coherence and prove (or `#eval` check on fixtures) that exported IR boards satisfy it after load.

**Done when:** IR parse fails closed on out-of-range layers; `wellFormed` true on a sampled whitelist (or all, if cheap).

**Feeds inert:** `boardEffectId` can quantify “∀ valid objects…” without apologizing for garbage ids.

---

### Milestone T3 — Pattern / rule semantic wrappers (inert-facing)

**Goal:** Make “this rule cannot change the board” *almost* syntactic on Lean `Rule`, not only a JS tag story.

**Changes:**

- Classify cell patterns:  
  `structure PatternEffect where clearsObjects … setsObjects … writesMovement : Bool`  
  derived from `CellPattern` masks (executable `Bool` analyzer mirroring JS `command_only` / no movement write).
- `def Rule.isCommandOnly (r : Rule) : Bool` — no object/movement writes on any cell; commands nonempty.
- `def Rule.syntacticInertCommandOnly` — command-only ∧ all commands inert (already partly there).
- Optionally split `CellPattern` into match-half / replace-half structures so “no replacement” is a constructor, not `hasReplacement : Bool`.

**Done when:** Lean `#eval` / small tests agree with JS inert tagging on a handful of fixture rules (or a dedicated mini IR); smoke unchanged.

**Feeds inert:** this *is* the syntactic half of `syntacticInertCommandOnly → boardEffectId`.

---

### Milestone T4 — Session / level typing

**Goal:** Stop “board from level 2, `currentLevel := 0`” as a silently allowed state.

**Changes:**

- `structure LevelIdx where val : Nat` + `Session.currentLevel : LevelIdx`.
- `def Session.WellFormed (g : Game) (s : Session) : Prop` —  
  board dims match current playable level; `restartBoard` same geometry; undo frames coherent; `wellFormed g board`.
- Level advance / restart / undo preserve `Session.WellFormed` (prove on the paths used by smoke, or assert in debug builds via `Except`).

**Done when:** WF preserved lemmas for `executeTurn` on the inert+win kernel (or Bool checks in parity_smoke debug flag).

**Feeds inert:** `boardWinEquiv` needs honest session equality / level-advance behavior.

---

### Milestone T5 — Real abstract step for the inert kernel (close the C gap)

**Goal:** Upgrade from “`BoardViewEq` means masks equal” to an abstract apply that *computes* on `occ`/`movAt` for command-only rules and proves agreement with mask `tryApplyRule`.

**Changes:**

- `abstractApplyCommandOnly : Game → Board → Rule → TurnState → …` that queues commands and leaves `occ`/`movAt` definitionally alone when `isCommandOnly`.
- Theorem: if `r.syntacticInertCommandOnly` and `WellFormed`, then  
  `BoardViewEq b (maskApply b r).board` and again-eligibility unchanged vs backup.
- Keep random/rigid/ellipsis out of this kernel.

**Done when:** no `sorry`; smoke green; lemma usable by `dropInert` milestone.

**Feeds inert:** direct hand-off to post-parity design §4.3–4.4.

---

### Milestone T6 — Optional Mathlib / `Finset` upgrade

**Goal:** Replace `ObjectSet := List ObjectId` if set lemmas get sticky.

**Changes:** add a deliberate Lake dependency (Batteries or Mathlib subset), redefine `occ` as `Finset ObjectId`, port `BoardViewEq.occ_eq`.

**Trigger:** only if T3–T5 proofs spend more time on List-nodup trivia than on PuzzleScript content.

## 6. Explicitly defer

| Item | Why defer |
|------|-----------|
| `Board` indexed by `width`/`height` in the type | Level transitions fight dependent types; WF Prop is enough for now |
| Full Runtime on `Fin` everywhere | Perf/noise; do edges first (T1) |
| Cosmetic / temporary tag vocabulary | Needs separate views (projection, undo scope) |
| Abstract stepper as smoke engine | Violates authority split; huge parity risk |
| Rigid applied bit in `movAt` | Out of inert kernel; revisit with rigid theorems |

## 7. Suggested implementation order

```text
T1 Runtime edges (Ids/Dir4/InputToken)
        │
        ▼
T3 Pattern/rule syntactic classifiers     ← parallelizable with T2 after T1
        │
T2 Game-relative Valid* / objectLayers
        │
        ▼
T5 Abstract apply ≡ mask apply (inert kernel)
        │
        ▼
T4 Session.WellFormed preservation
        │
        ▼
Inert soundness (existing post-parity design)
        │
        ▼
T6 Finset only if needed
```

T3 before or with T5 is important: without `isCommandOnly`, abstract apply has nothing crisp to assume.

## 8. Verification bar (every milestone)

1. `cd lean && lake build`
2. `make lean_parity_smoke`
3. For proof milestones: no `sorry` in shipped lemmas for the declared kernel.
4. Short `lean/README.md` note of what became typed / what remains raw.

## 9. Success for the overall “more robust types” program

Not “every Nat is gone.” Success is:

- **Index confusion** is hard at API boundaries (T1–T2).
- **Inert is syntactic in Lean** the same way it is in JS (T3).
- **Abstract/mask agreement** is a real theorem on that kernel (T5), not only mask equality sugar.
- **Session/board coherence** is an explicit invariant (T4).
- Inert prune soundness can be stated without inventing new vocabulary mid-proof.

## 10. Open decisions for approval

Before writing an implementation plan, please decide:

1. **Order:** agree with T1 → T3 → T2 → T5 → T4, or prefer Session WF (T4) earlier?
2. **Mathlib:** ban until T6 trigger, or allow Batteries early for `Finset`?
3. **`Rule.direction`:** bitfield wrapper (`RuleDir`) vs explode into `List Dir4` (lossy vs IR)?
4. **Scope of T1:** wrappers only at Board/View, or also migrate internal Runtime loops aggressively?

---

*Once approved, next artifact: `docs/superpowers/plans/YYYY-MM-DD-lean-type-hardening-T1.md` (or a combined plan if you want T1+T3 as one PR series).*
