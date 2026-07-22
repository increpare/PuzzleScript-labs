# Lean abstract view: representation notes (types, not proofs)

Status: **superseded** by [2026-07-21-lean-abstract-view-types-design.md](2026-07-21-lean-abstract-view-types-design.md)
(approved brainstorming + implementation plan). Kept as discussion record / input to that design.
Parent: [2026-07-21-lean-post-parity-abstract-inert-design.md](2026-07-21-lean-post-parity-abstract-inert-design.md) §4.1.
Date: 2026-07-21.

These are representation choices for the abstract view (occupancy / pending movement) that sits
on top of the existing bitvector `Board` (`lean/PuzzleScript/Board.lean`, `lean/PuzzleScript/BitVec.lean`).
Nothing here is implemented; capturing the discussion before it's lost.

## 1. Base shape: views over `Board`, not a replacement for it

Don't introduce a second `Board`-like structure. Define `occ` / `movAt` as functions computed
*from* the existing `Board`, so `toMask`/`fromMask` round-tripping is close to `rfl` and the
"abstractStep ≡ maskStep" bridge reduces to "these projections commute with the array ops" rather
than a real theorem about two independently-evolving models.

- **Occupancy:** `Board.occ (b : Board) (tile : TileIdx) : Finset ObjectId`, read off
  `maskGetBit (b.cellObjWords tile.val) objId.val` — `Finset` because `boardEffectId` needs to
  state "this rule doesn't change the set," and `Finset.ext`/membership lemmas make that nearly
  free versus reasoning about raw `UInt32` equality.
- **Pending movement:** `Board.movAt (b : Board) (tile : TileIdx) (layer : LayerIdx) : Option Dir4`,
  mirroring `getLayerMovementBits`/`setLayerMovementBits` (Runtime.lean:113-150) exactly — one slot
  per `(tile, layer)`, not `Finset (ObjectId × Dir)`. That narrowness isn't a modeling choice, it's
  what the storage already guarantees (PuzzleScript collision layers hold at most one direction per
  tile), so keeping the type that narrow closes off "abstract view can represent states masks
  can't" drift.
- Skip the rigid "applied" sentinel bit (`31`) for v1 — rigid rules are out of scope of the
  clean-corpus gate anyway.

## 2. Wrap index spaces in distinct types

Even unbounded, wrapping primitive `Nat`s by index space is worth it here — it's the same hygiene
as `newtype LayerIdx = LayerIdx Integer` in Haskell, and it directly prevents passing a layer index
where a tile or object index was expected, which is an easy mistake when `Board`/`Runtime` today
pass raw `Nat` for all three.

Wrap three spaces: `TileIdx`, `LayerIdx`, `ObjectId`.

- **`LayerIdx := Fin game.layerCount`.** `layerCount` is a `Game`-level constant — fixed for the
  whole proof, identical across every level of a given game — so the dependent bound is cheap and
  buys real lemmas ("every layer has ≤1 object" becomes a clean universal statement over a finite
  index type).
- **`TileIdx`: plain newtype (`structure TileIdx where val : Nat`), not `Fin b.nTiles`.** Board
  dimensions (`width`/`height`) change across level transitions within one session, and
  `boardWinEquiv` explicitly needs to reason across those transitions. Tying `TileIdx` to one
  board's `nTiles` would fight that. Carry `tile.val < b.nTiles` as an explicit hypothesis where
  needed instead of baking it into the type.
- **`ObjectId`: plain newtype**, same reasoning as `TileIdx` — it's a `Game`-level id space in
  principle (could be `Fin game.objectCount`), but keeping it a flat newtype avoids friction if
  object count ever needs to vary or be reasoned about independently of a specific `Game` value.
- Cost versus Haskell: no `GeneralizedNewtypeDeriving` in Lean, so each wrapper needs
  `DecidableEq`/`Hashable`/`Repr` written by hand (needed for `Finset`/map-key use and `#eval`
  debugging). One-time cost per type, not a design problem. Unwrapping (`.val`) should live *only*
  at the `toMask`/`fromMask` boundary — that becomes the one place in the whole proof where "raw
  bit position" and "semantic index" touch.

## 3. `Command` as a closed inductive, not `String`

The PuzzleScript rule-command vocabulary is fixed and small — confirmed from
`src/js/languageConstants.js:5`: `sfx0..sfx10, cancel, checkpoint, restart, win, message, again`,
nothing else parses. Today (`lean/PuzzleScript/IR.lean`, `Rule.commands : Array String`) inertness
is a runtime string-membership check, mirroring JS's `INERT_COMMANDS` set
(`src/tests/ps_static_analysis.js:10`).

Proposed: `inductive Command | sfx (n : Fin 11) | cancel | checkpoint | restart | win | message | again`.
`syntacticInertCommandOnly` becomes a pattern match (`| .sfx _ | .message => true | _ => false`)
instead of a `.contains` check. Pattern-match exhaustiveness means a future new command word forces
an explicit decision at every match site rather than silently falling through a set lookup — a
direct reinforcement of the design doc's "fail closed on semantic commands" principle.

## 4. One canonical `Dir4` encode/decode, not three

The up/down/left/right ↔ bit correspondence (`1/2/4/8`) is currently hand-rolled independently in
three places in `lean/PuzzleScript/Runtime.lean`:

- `dirDelta` (:40-43)
- `dirInputToLayerBits` (:30)
- `dirBitsFromIndex` (:291)

These have to agree by convention, not by construction — three call sites that could silently
drift apart. Proposed: `inductive Dir4 | up | down | left | right` with a single
`Dir4.toBits` / `Dir4.ofBits? : UInt32 → Option Dir4` pair. The abstract view then has one
authoritative bridge lemma instead of three independently-argued correspondences.

## 5. Centralize tile adjacency behind one `neighbor` function

Keep `TileIdx` as a flat wrapped index (matching the actual column-major storage,
`Board.runtimeTile b x y := x * b.height + y`, Runtime.lean:11-18) rather than switching to an
`(x, y)` pair — the flat layout is exploited directly for movement (`tile + dy + dx * height`,
Runtime.lean:827) and that's a real perf property of the executable layer worth preserving, not
something to redesign for the proof layer.

The problem is that the `±1` / `±height` arithmetic is currently re-derived ad hoc in several
places (row-scan bounds around Runtime.lean:445-503, plus the neighbor step at :827), each of which
has to get the column-major convention right independently. Proposed: exactly one
`TileIdx.neighbor (b : Board) (t : TileIdx) (d : Dir4) : Option TileIdx`, bounds-checked, built on
the existing `tileCol`/`tileRow` helpers. Every abstract-view adjacency lemma goes through it.
`Runtime.lean` itself doesn't need to change — this is purely for the proof layer.

## 6. Bigger option: per-layer `Option` occupancy instead of `Finset`

Instead of `occ : TileIdx → Finset ObjectId`, model occupancy per-layer:

```
occ : LayerIdx → TileIdx → Option ObjectId
```

mirroring `movAt`'s shape exactly (`LayerIdx → TileIdx → Option Dir4`). This makes PuzzleScript's
collision-layer exclusivity (≤1 object per layer per tile) unrepresentable-by-construction instead
of a side hypothesis that has to be re-proved or re-threaded everywhere.

Tradeoff: the mask model doesn't guarantee this structurally. `objects : Array UInt32` is just a
bitset — layer exclusivity is an *operational* invariant the rules engine maintains, not something
the storage type enforces (`Board.lean` has no such check). Choosing the `Option`-per-layer
representation buys a nicer occupancy type at the cost of a real one-time proof obligation at the
`toMask`/`fromMask` boundary: "the invariant holds inductively across `step`."

Cheaper alternative: keep `Finset ObjectId` and add a `Board.WellFormed` predicate (≤1 object per
layer per tile, indices in range) threaded as an explicit hypothesis through the equivalence proof.
Less elegant, no upfront proof debt.

**Recommendation:** start with `Finset` + `WellFormed` hypothesis for the inert milestone (cheaper,
and inert rules don't need the layer-exclusivity invariant to state `boardEffectId`). Revisit the
`Option`-per-layer version if a later tag analysis (cosmetic, merge) turns out to lean on
layer-exclusivity directly — then the one-time proof cost amortizes across more theorems.

## 7. Open item carried over from the design-doc review

Not a representation question, but relevant to whatever `boardEffectId` ends up proving: the
current `turn.modified` computation in `Runtime.lean` (`tryApplyRule`, `applyRandomRuleGroup`) sets
`modified := turn.modified || any || !rule.commands.isEmpty` — true whenever a rule with
non-empty commands matches, regardless of whether it changed the board. JS's oracle instead derives
`modified` purely from a board-object-array diff (`src/js/engine.js:3706-3729`). Until this is
fixed to match JS, an inert-command-only rule firing can flip `again`-eligibility in Lean in a way
it wouldn't in JS, which is exactly the kind of divergence `boardEffectId`/`boardWinEquiv` needs to
rule out. Whichever representation is chosen above, `Command`/`Dir4`/index wrapping doesn't fix this
on its own — it's a runtime logic fix, tracked here so it isn't lost.
