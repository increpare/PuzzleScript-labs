# Lean abstract view: typed representation + step bridge

Status: design approved (brainstorming 2026-07-21). Implements
[representation notes](2026-07-21-lean-abstract-view-representation-notes.md) and
parent [post-parity abstract/inert design](2026-07-21-lean-post-parity-abstract-inert-design.md)
§4.0–§4.1 under the “shared vocabulary” migration (option B) and full step-equivalence bar (option C).

Date: 2026-07-21.

## 1. Goals

1. Harden index / direction / command types used by boards and rules.
2. Expose abstract views (`occ` / `movAt` / `neighbor`) over the existing mask `Board` (not a second board model).
3. Fix Lean `turn.modified` / again-eligibility to match JS object-delta semantics (§4.0).
4. Define abstract match/apply for the inert-relevant kernel and prove `abstractStep ≡ maskStep` on that kernel (§4.1).
5. Keep `make lean_parity_smoke` green; masks remain the executable path for fixtures.

## 2. Non-goals

- Inert prune soundness theorems (`dropInert` / `boardWinEquiv`) — next milestone after this bridge.
- Making the abstract stepper the smoke execution path.
- Option-per-layer occupancy (deferred; use `Finset` + `WellFormed`).
- Rigid applied-sentinel bit (v1 out).
- Full gallery IR→Lean codegen.

## 3. Approach

**Views over `Board`:** projections commute with mask ops; no parallel `AbstractBoard` store.

**Shared vocabulary (B):** introduce typed modules and migrate `IR` / `Rules` / `Runtime` to `Command` and `Dir4` (and index newtypes at API edges). Hot mask loops may still use `.val` / raw bits at the bit boundary only.

**Occupancy:** `Board.occ : TileIdx → Finset ObjectId` plus `Board.WellFormed` (indices in range; ≤1 object per layer per tile). Revisit Option-per-layer later if cosmetic/merge needs it.

## 4. Module layout

| File | Responsibility |
|------|----------------|
| `lean/PuzzleScript/Ids.lean` | `TileIdx`, `ObjectId` newtypes (`val : Nat`); `LayerIdx` newtype; `DecidableEq` / `Hashable` / `Repr` |
| `lean/PuzzleScript/Dir4.lean` | `inductive Dir4`; sole `toBits` / `ofBits?`; deltas for column-major neighbor |
| `lean/PuzzleScript/Command.lean` | closed `inductive Command`; string parse/print for IR; `isInert` / `syntacticInertCommandOnly` helpers |
| `lean/PuzzleScript/View.lean` | `occ`, `movAt`, `neighbor`, `WellFormed`, object↔layer helpers via `Game` |
| `lean/PuzzleScript/Abstract.lean` | abstract rule apply kernel + `abstractStep` + bridge theorems |
| Existing `Rules.lean` / `IR.lean` / `Runtime.lean` | consume `Command` / `Dir4`; §4.0 modified fix |

`PuzzleScript.lean` imports the new modules in dependency order.

## 5. Type details

### 5.1 Indices

- **`TileIdx`**: `structure TileIdx where val : Nat` — not `Fin b.nTiles` (level size changes in-session).
- **`ObjectId`**: same plain newtype.
- **`LayerIdx`**: plain newtype over `Nat` for Runtime sharing; well-formedness / view lemmas carry `layer.val < b.layerCount` (or `Fin` coercions at Game-bound call sites). Prefer not threading `Fin game.layerCount` through every Runtime helper in this milestone.

Unwrapping (`.val`) is allowed at mask get/set boundaries and IR numeric fields; new public view APIs take wrapped types.

### 5.2 `Dir4`

```lean
inductive Dir4 | up | down | left | right
def Dir4.toBits : Dir4 → UInt32  -- 1/2/4/8
def Dir4.ofBits? : UInt32 → Option Dir4
```

Replace independent encodings in `Runtime.dirDelta`, `dirInputToLayerBits`, `dirBitsFromIndex`.

### 5.3 `Command`

```lean
inductive Command
  | sfx (n : Fin 11)
  | cancel | checkpoint | restart | win | message | again
```

- IR parse: unknown command string → schema error (fail closed).
- `Rule.commands : Array Command`; `TurnState.commandQueue : Array Command`.
- Inert (solver-facing): `sfx _` and `message` only.

### 5.4 Views

- `Board.occ (b) (t : TileIdx) : Finset ObjectId` from object mask bits.
- `Board.movAt (b) (t : TileIdx) (ℓ : LayerIdx) : Option Dir4` from layer movement bits (no rigid bit 31).
- `TileIdx.neighbor (b) (t) (d : Dir4) : Option TileIdx` — single bounds-checked adjacency on column-major layout.
- `Board.WellFormed (game : Game) (b : Board) : Prop` — dimensions/strides coherent; every set object id in range; ≤1 object per (tile, layer); movement layers in range.

### 5.5 Abstract kernel (§4.1 / C)

Minimum kernel for bridge theorems (expand only as proofs require):

1. Single-cell / multi-cell patterns already representable by current `Rule` without random/rigid/ellipsis edge cases *or* prove equivalence under the same restrictions the inert tag assumes (command-only: LHS≡RHS objects/movements).
2. `abstractApplyRule` / `abstractStep` described as reading/writing `occ`/`movAt` (and command queue for inert vs semantic classification).
3. Theorems (stated for WellFormed boards on the supported kernel):
   - `occ`/`movAt` round-trip with mask cells (projection correctness).
   - `abstractStep game b input = toView (maskStep game b input)` (or equal boards after `fromView`), for the kernel fragment needed by inert: at least command-only rules + movement-free object identity, plus enough of turn plumbing that again-eligibility is the same predicate.

Masks stay authoritative in `parity_smoke`. Abstract step is for proofs / `#check`, not the default replay path.

## 6. Blocking runtime fix (§4.0)

Today `tryApplyRule` / `applyRandomRuleGroup` set  
`modified := … || !rule.commands.isEmpty`.

**Required:** again-relevant modification is **object mask delta vs turn backup**, matching JS (`boardsDiffer` on objects only for again gate — already partially used in `processCommandQueue`). Do **not** treat command presence as board modification.

Concrete changes:

- Stop OR-ing `!rule.commands.isEmpty` into `turn.modified`.
- Define `objectsChanged (before after : Board) : Bool` (objects arrays; movements optional/separate).
- `againEligible := again ∈ queue ∧ objectsChanged backup current` (plus existing again-probe behavior).
- Expose the same predicate name in View/Abstract vocabulary for theorems.

Parity smoke must remain green after this fix (behavior should move *toward* JS).

## 7. Testing & verification

- `lake build` in `lean/`.
- `make lean_parity_smoke` — full clean whitelist green.
- Lean theorems: compile (no `sorry` in shipped bridge lemmas for the declared kernel; temporary `sorry` only behind clearly named stubs is not acceptable for the C bar — prefer narrowing kernel over shipping sorry).
- Small `#eval` / executable checks for `Command` parse and `Dir4` round-trip if useful.

## 8. Success criteria

- [ ] Newtypes + `Dir4` + `Command` land; IR/Rules/Runtime compile against them.
- [ ] `occ` / `movAt` / `neighbor` / `WellFormed` defined.
- [ ] §4.0 modified/again aligned with JS object-delta.
- [ ] Abstract kernel + bridge theorems for that kernel.
- [ ] `make lean_parity_smoke` green.
- [ ] Notes doc marked superseded by this design (or linked as input).

## 9. Risks

- Full Runtime migration to `TileIdx` everywhere is large — keep raw `Nat` inside private helpers if needed; wrap at public view and rule edges.
- Step-equivalence for the entire Runtime is too large; **narrow the kernel** explicitly in `Abstract.lean` rather than claiming whole-engine equivalence.
- Command parse fail-closed may reject fixtures if IR emits unexpected strings — verify against exported fixture command vocabulary before tightening.
