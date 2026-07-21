# Proposal: next Lean type-hardening milestones

Status: **approved decisions locked** (see §10); ready for T1 implementation plan.  
Date: 2026-07-21 (revised same day after review).  
Depends on: [abstract view types design](2026-07-21-lean-abstract-view-types-design.md) (landed on master), [post-parity inert design](2026-07-21-lean-post-parity-abstract-inert-design.md).

## 1. Why harden further

We already closed the first hygiene gap: `Command`, `Dir4`, index newtypes, `occ`/`movAt`/`neighbor`, and JS-aligned `againEligible`. That makes *some* index/command confusion unrepresentable and gives inert proofs a vocabulary.

Most of the executable model is still “stringly typed” in the broad sense: almost every board/rule/session field is `Nat`, `Int`, or raw `MaskWords`, with invariants only in comments and smoke tests. That blocks:

- stating `boardEffectId` / `dropInert` without forever quantifying over “well-formed masks”;
- preventing tile/layer/object index mixups at *public* Board/View/Rule edges;
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
| `Abstract` bridge | `BoardViewEq` + again lemmas; **no real mask-apply ⇒ view seam** | Easy to over-read existing names (see §2.1) |

**Non-goal of this proposal:** making the abstract stepper the smoke execution path. Masks stay authoritative for fixtures.

### 2.1 Vacuous / misleading Abstract lemmas (pre-T5 cleanup)

`Abstract.lean` previously shipped `boardViewEq_of_mask_unchanged` with signature
`(h : BoardViewEq b b') : BoardViewEq b b'` — identity, not “mask apply that doesn’t write ⇒ view eq.”
That name sounded load-bearing for T5. **Deleted** in the same revision as this doc update.

Also renamed the similarly soft `inert_command_apply_preserves_view` (which assumed `BoardViewEq` rather than deriving it from apply) to an honest `againEligible_congr_of_boardViewEq`.

**T5 line item (mandatory):** introduce the *real* lemma under a clear name, e.g.
`boardViewEq_of_commandOnly_mask_apply` / `…_of_group_turn_path`, with hypothesis
“mask apply (at the committed boundary in §5 T5) left objects/movements/geometry unchanged”
or, better, prove that command-only inert rules *force* that unchanged outcome — not identity on `BoardViewEq`.

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

**Recommendation: B**. Use `Fin` locally where the bound is truly `Game`-constant *inside view/proof modules*, without forcing every Runtime helper to take `Fin`. Mathlib/`Finset` only under the checkable T6 trigger (§5 T6, §10).

## 5. Proposed milestones

### Milestone T1 — Runtime API edges use `Ids` / `Dir4` (no behavior change)

**Goal:** Stop *public* call sites from mixing tile/layer/object as bare `Nat`.

**Scope (locked):** **boundary-only** — Board / View / Rule public edges, typed `InputToken`, `RuleDir` wrapper. **Do not** aggressively rewrite private Runtime scan/movement/ellipsis loops (raw-`Nat` throughout); those sites are private, so wrapping them does not reduce external index-confusion risk and is the big-bang rewrite §1 avoids.

**Changes:**

- Public / semi-public Board helpers take `TileIdx` / `LayerIdx` where cheap (wrappers over existing `Nat` internals OK).
- `InputToken`:  
  `inductive InputToken | move (d : Dir4) | action | undo | restart | tick`  
  (map JS `4` → `.action`, `0..3` → `Dir4.ofInputIndex?`).
- `Rule.direction`: wrap as `structure RuleDir where bits : UInt32` (confirmed against real corpus — multi-dir bitfields; **not** explode to `List Dir4`). Expose `toDelta` / `scanBounds` only via that type.

**Done when:** smoke green; public Board/View APIs that take cell indices use wrappers; InputToken no longer carries free `Int` for movement.

**Feeds inert:** cleaner turn plumbing statements; fewer spurious `Nat` equalities at proof edges.

---

### Milestone T2 — Game-relative identifiers

**Goal:** Make “object id / layer for *this* game” hard to mis-state in IR and views.

**Changes:**

- Prefer flat `ObjectId` + `Game.ValidObject` / `ValidLayer` Props first (less churn than indexing every structure by `objectCount`).
- `Game.objectLayers : Array LayerIdx` with IR check `size = objectCount` and each `val < layerCount`.
- `PropertyAlias` uses `ObjectId` + `LayerIdx`.
- Strengthen `Board.wellFormed` for `objectLayers` coherence; check exported IR boards after load.

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
- `def Rule.syntacticInertCommandOnly` — command-only ∧ all commands inert.
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
- Level advance / restart / undo preserve `Session.WellFormed` (prove on smoke paths, or assert via debug `Except`).

**Done when:** WF preserved lemmas for `executeTurn` on the inert+win kernel (or Bool checks in a parity_smoke debug flag).

**Feeds inert:** `boardWinEquiv` needs honest session equality / level-advance behavior.  
**Why not earlier:** cross-level / undo / restart matters for full `boardWinEquiv`, not the single-board kernel T5 needs; pulling T4 forward contradicts principle 6.

---

### Milestone T5 — Real abstract / mask agreement for the inert kernel (close the C gap)

**Goal:** Prove that dropping an inert command-only rule is invisible to the **same machinery `dropInert` will edit** — not merely that an isolated leaf call is a no-op.

#### Proof boundary (locked — this is what “Done when” means)

`dropInert` removes a rule from a **rule group** that runs inside shared turn plumbing (`applyRuleGroup` / rigid-retry / bannedGroup / 200-iteration group loop / late rules / `executeTurn` command queue + again gate). A leaf lemma about `tryApplyRule` alone is **useful scaffolding** but **not** the T5 done bar.

**T5 committed boundary:**

1. **Scaffold (allowed mid-milestone):** `tryApplyRule` (or equivalent leaf) for `syntacticInertCommandOnly` rules leaves objects/movements/geometry unchanged and only extends the command queue with inert commands.
2. **Done bar:** lifting that fact through **`applyRuleGroup` → rules/lateRules loop as used by `executeTurn`** (including rigid-retry / bannedGroup / group iteration cap as they exist today) so that  
   `executeTurn g s input` and `executeTurn (dropInert g) s input` agree on board objects/movements, win/level-advance bits used by `boardWinEquiv`, and `againEligible` — for games whose only difference is dropped inert command-only rules, on the single-board kernel (Session WF / multi-level is T4).

Random / non-command-only / ellipsis-heavy rules stay out of the kernel; state restrictions explicitly in `Abstract.lean`.

#### Mandatory cleanup / real seam

- [ ] Ensure no vacuous `BoardViewEq → BoardViewEq` stub remains under a mask-apply name (§2.1).
- [ ] Ship a non-vacuous lemma whose name matches its content, e.g. mask/group/turn apply of inert command-only rule ⇒ `BoardViewEq` + again-eligibility congruence vs turn backup.
- [ ] Document in `Abstract.lean` which Runtime functions are in the proven cone.

**Changes (technical):**

- `abstractApplyCommandOnly` (optional computational view) and/or direct relational theorems over mask apply.
- Theorems as above at leaf then group/turn boundary.
- Keep random/rigid *effects* out of the kernel; rigid-*retry loop structure* may still appear in the turn path and must be accounted for in the lift (even if rigid rules themselves are excluded from the games under consideration).

**Done when:** no `sorry`; smoke green; **turn-path** congruence lemma usable by `dropInert` / `boardWinEquiv` without re-proving the group loop.

**Feeds inert:** direct hand-off to post-parity design §4.3–4.4.

---

### Milestone T6 — Optional Mathlib / `Finset` upgrade

**Goal:** Replace `ObjectSet := List ObjectId` if set lemmas get sticky.

**Changes:** add a deliberate Lake dependency (Batteries or Mathlib subset), redefine `occ` as `Finset ObjectId`, port `BoardViewEq.occ_eq`.

**Trigger (checkable, not vibe):** open T6 if **any single** List-nodup / List-as-set lemma in T3–T5 either:

- takes **more than 30 minutes** of focused proof effort to state *and* complete, or  
- **stalls** (no progress after 30 minutes on that one lemma) and the blockage is List-set trivia rather than PuzzleScript semantics.

Record the triggering lemma name in the T6 plan. Until then: **Mathlib/Batteries banned**.

## 6. Explicitly defer

| Item | Why defer |
|------|-----------|
| `Board` indexed by `width`/`height` in the type | Level transitions fight dependent types; WF Prop is enough for now |
| Full Runtime private-loop `Fin`/`TileIdx` migration | T1 is boundary-only; private Nat loops stay |
| Cosmetic / temporary tag vocabulary | Needs separate views (projection, undo scope) |
| Abstract stepper as smoke engine | Violates authority split; huge parity risk |
| Rigid applied bit in `movAt` | Out of inert kernel; revisit with rigid theorems |

## 7. Suggested implementation order (locked)

```text
T1 Runtime public edges (Ids/Dir4/InputToken/RuleDir)
        │
        ▼
T3 Pattern/rule syntactic classifiers
        │
T2 Game-relative Valid* / objectLayers
        │
        ▼
T5 Leaf scaffold → turn-path congruence (inert kernel)
        │
        ▼
T4 Session.WellFormed preservation
        │
        ▼
Inert soundness (existing post-parity design)
        │
        ▼
T6 Finset only if checkable trigger fires
```

T3 before T5 is required: without `isCommandOnly`, abstract/turn congruence has nothing crisp to assume.

## 8. Verification bar (every milestone)

1. `cd lean && lake build`
2. `make lean_parity_smoke`
3. For proof milestones: no `sorry` in shipped lemmas for the declared kernel.
4. Short `lean/README.md` note of what became typed / what remains raw.

## 9. Success for the overall “more robust types” program

Not “every Nat is gone.” Success is:

- **Index confusion** is hard at **public** API boundaries (T1–T2).
- **Inert is syntactic in Lean** the same way it is in JS (T3).
- **Abstract/mask agreement** is a real theorem on the **turn path** `dropInert` cares about (T5), not mask-equality sugar or leaf-only facts.
- **Session/board coherence** is an explicit invariant when cross-level equiv needs it (T4).
- Inert prune soundness can be stated without inventing new vocabulary mid-proof.

## 10. Decisions (locked)

| # | Question | Decision |
|---|----------|----------|
| 1 | Order | **T1 → T3 → T2 → T5 → T4** (do not pull T4 forward) |
| 2 | Mathlib | **Banned** until T6 checkable trigger (§5 T6: 30 min / stall on one List-nodup lemma) |
| 3 | `Rule.direction` | **`RuleDir` bitfield wrapper** (not `List Dir4`) |
| 4 | T1 scope | **Boundary-only** (Board/View/Rule public edges); no aggressive private Runtime loop migration |

---

*Next artifact: `docs/superpowers/plans/YYYY-MM-DD-lean-type-hardening-T1.md`.*
