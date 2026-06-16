# Native/JS Static Tag Parity Mismatch Report

Date: 2026-06-16

This note records the follow-up investigation into static tag mismatches between
the JavaScript static analyser and the native C++ static analyser on:

```text
/Users/stephenlavelle/Documents/google_gist_scraper/dumpprocessed_compiles
```

The previous parity run found 12 mismatch tasks covering 15 files. Every tag
mismatch was native-only: C++ emitted `static=true` for one or more objects where
the JS analyser did not.

## Resolution (implemented 2026-06-16, commit a45d1b95)

Both follow-ups below are now implemented. After the change, native and JS agree
on every one of the 15 mismatch files and on ~350 additional games sampled
across the corpus (no divergence in either direction). Runtime contracts (469
cases) and the native parity suites (`solver_tests`, `static_analysis_testdata`)
stay green.

- **Follow-up 1 — native 8ece overwrite miss (the one real soundness bug).**
  In `native/src/compiler/static_analysis.cpp` a property-binding sink overwrite
  was discarded whenever the landing object arrived via movement (the gated
  `ruleLayerOverwriteObjects` was only merged when the rule had a direct object
  write). It is now always merged, gated by a new `computeObjectsOriginatingMovement`
  set so only members that can actually move trigger the overwrite. `i2`,
  `switch`, `triforce` are now correctly non-static (confirmed erasable at
  runtime).

- **Follow-up 2 — JS precision, brought up to native.** Investigation corrected
  the mental model: native does **not** excise dead rules wholesale. Its
  contradiction precision comes from using the **raw** `objectsPresent` mask
  (not minus the cell's `no` set) for both the preserve check and the layer
  occupancy ("could this sibling have been here?") gate. JS diverged purely
  because it subtracted the `no` set in those two places, so a present-and-absent
  member (e.g. `Spawner` under `no Obstacle`, or the expanded `Platform` branch
  of `Standable no Platform`) dropped out of the preserve check and was counted
  as a fresh write/overwrite. JS now uses the raw present set in both places,
  matching native. Separately, a JS movement-origination filter (mirroring the
  native set) makes a property delivered into a sink purely by cardinal movement
  count only members that can originate that movement, so `HIT_*`/`crossing`
  stay static (wall never moves) while the 8ece `switch` is non-static (enemy
  moves).

Regression coverage: three `object_tags` fixtures
(`static-moved-property-overwrites-shared-layer`,
`static-immobile-property-member-preserved`,
`static-contradictory-member-preserved`), an updated `static` claim spec, and
removal of the throwaway C++ test (now covered by the fixtures + native parity).

## Verification Used

- Read the JS static-analysis facts for each mismatched object and inspected the
  concrete rule evidence behind `object_written_by_solver_active_rule` and
  `collision_layer_object_may_be_created`.
- Read the source rules and local legend/collision-layer definitions for each
  mismatch.
- Searched for a native C++ static-label fuzzer. I found JS/runtime fuzzers only
  (`src/tests/fuzz_static_contracts.js` and corpus wrappers), not a C++ static
  tag fuzzer.
- Injected the native-only object set into the JS/runtime static-contract harness
  and ran randomized occupancy checks over the 15 mismatch files:

```text
runs=432
skipped=0
failures=0
```

The randomized run did not find runtime occupancy violations in the full corpus
games. That is useful but not complete proof, because several relevant rules are
hard to hit through random play.

For the one suspicious rule shape, I also made a tiny temporary fixture matching
the full-game pattern and ran both analysers plus the runtime. In that fixture,
native still emitted the same static labels and the runtime erased one of those
objects after a tick, confirming a native over-tagging bug for that shape.

## Summary Verdict

Most mismatches appear to be JS over-conservatism caused by expanded property
variants that are impossible at runtime, for example a cell requiring `X` and
`no X` at the same time.

The exception is:

- `ANONYMOUS_BATCH_OLD_8ecef194d71965c38541.txt`: `i2`, `switch`, `triforce`

That case appears to be a real native static-analysis miss: C++ tags same-layer
objects static even though a reachable property movement rewrite can overwrite
them.

## Detailed Cases

### ANONYMOUS_BATCH_OLD_0950fb30cd8d7f4958d9.txt

Native-only static object:

- `platform`

JS evidence:

```text
line 287: horizontal [ > PlayerNormal no Platform | stationary Standable no Platform ] -> [ | Standable ]
```

The relevant expanded JS variants require `Platform` and `no Platform` in the
same cell:

- `early_group_2_rule_1`
- `early_group_2_rule_13`

Verdict: C++ is likely correct; JS is too conservative for this expanded
contradictory branch.

### ANONYMOUS_BATCH_OLD_160ed61e0823472b7b60.txt

Native-only static objects:

- `purcy`
- `tommy`
- `wall`

JS evidence:

```text
line 229: [ACTION Player no Arrows no Bird] -> [Player ArrowUp]
```

The object-erasing branch is the `Player = BirdStart` expansion, but the same
cell also has `no Bird`, and `Bird` includes `BirdStart`.

Verdict: C++ is likely correct; JS is too conservative for this impossible
property expansion.

### ANONYMOUS_BATCH_OLD_6784eee480cc79ebbadd.txt

Native-only static object:

- `spawner`

JS evidence:

```text
line 377: [ Spawner no Obstacle ] -> [ Spawner random Robot ]
```

The legend defines:

```text
Obstacle = Wall or Enemy or Robot or Spawner
```

So the branch that simultaneously requires `Spawner` and `no Obstacle` is
contradictory.

Verdict: C++ is likely correct; JS is too conservative.

### ANONYMOUS_BATCH_OLD_7d1b5ea9165ff8387e27.txt

Native-only static objects:

- `purcy`
- `tommy`
- `wall`

Same shape as `ANONYMOUS_BATCH_OLD_160ed61e0823472b7b60.txt`.

JS evidence:

```text
line 229: [ACTION Player no Arrows no Bird] -> [Player ArrowUp]
```

The offending branch uses `BirdStart` for `Player` while also requiring
`no Bird`.

Verdict: C++ is likely correct; JS is too conservative.

### ANONYMOUS_BATCH_OLD_832c4fae77feeb699a47850d1e93d919.txt

Native-only static object:

- `invertedfirewall`

JS evidence:

```text
line 460: left  [ action AntiVirus | ConnectsR no OneWayR ] -> [ action AntiVirus | ConnectsR AntiVirusMoving ]
line 461: right [ action AntiVirus | ConnectsL no OneWayL ] -> [ action AntiVirus | ConnectsL AntiVirusMoving ]
line 462: up    [ action AntiVirus | ConnectsD no OneWayD ] -> [ action AntiVirus | ConnectsD AntiVirusMoving ]
line 463: down  [ action AntiVirus | ConnectsU no OneWayU ] -> [ action AntiVirus | ConnectsU AntiVirusMoving ]
```

The relevant definitions include:

```text
ConnectsL = LineL or OneWayL
ConnectsR = LineR or OneWayR
ConnectsU = LineU or OneWayU
ConnectsD = LineD or OneWayD
OneWay = OneWayL or OneWayR or OneWayU or OneWayD
```

The JS evidence branches that would erase `InvertedFirewall` require the
corresponding `OneWay*` while also requiring `no OneWay*`.

Verdict: C++ is likely correct; JS is too conservative.

### ANONYMOUS_BATCH_OLD_8ecef194d71965c38541.txt

Native-only static objects:

- `i2`
- `switch`
- `triforce`

JS evidence:

```text
line 318: [> move|menu|no object] -> [ |menu|move]
```

Definitions:

```text
object = bush or rock or menu
move = enemy or player
```

Collision layer:

```text
triforce, switch, enemy, i1, i2, i3
```

Here `no object` only excludes `bush`, `rock`, and `menu`. It does not exclude
`i2`, `switch`, or `triforce` from the target cell. Therefore a moving `enemy`
can be written into a cell that already contains one of those same-layer objects,
which erases the previous same-layer occupant.

Tiny fixture check:

- JS rejected `switch` and `triforce` as static.
- Native emitted `switch` and `triforce` as static.
- Runtime erased `switch` after one tick.

Verdict: JS is correct; C++ is over-tagging these objects as static.

### ANONYMOUS_BATCH_OLD_c7c9cd7c99b9fbb1b81b0a02653ef638.txt

Native-only static objects:

- `sourcedown`
- `sourceleft`
- `sourceright`
- `sourceup`

JS evidence:

```text
line 327: late right [SourceRight no Block no Mirror | LightV] -> [SourceRight | LightB]
line 330: late left  [SourceLeft  no Block no Mirror | LightV] -> [SourceLeft  | LightB]
line 333: late down  [SourceDown  no Block no Mirror | LightH] -> [SourceDown  | LightB]
line 336: late up    [SourceUp    no Block no Mirror | LightH] -> [SourceUp    | LightB]
```

Definitions:

```text
Source = SourceRight or SourceLeft or SourceUp or SourceDown
Block = Wall or Source or Spinner
```

Each offending branch requires a `Source*` and `no Block`, but `Block` includes
all `Source*` objects.

Verdict: C++ is likely correct; JS is too conservative.

### EnzoMiali_718b99362ea8a85af3a6e67815ed0ae5.txt

Native-only static object:

- `plate`

JS evidence:

```text
line 106: late [ depressor no Plate ] [ Wall3 ] -> [ depressor no Plate ] [ Wall1 ]
line 109: late [ depressor no Plate ] [ Background2 ] -> [ depressor no Plate ] [ Background ]
```

Definition:

```text
Depressor = Player or Plate
```

The branch that would write/erase `Plate` is the `Depressor = Plate` expansion,
but the same cell also requires `no Plate`.

Verdict: C++ is likely correct; JS is too conservative.

### EnzoMiali_dd91e9f0b24e5b27f5216375346ce6ab.txt

Native-only static object:

- `plate`

JS evidence:

```text
line 84: late [ depressor no Plate ] [ Wall3 ] -> [ depressor no Plate ] [ Wall2 ]
```

Same `Depressor = Player or Plate` plus `no Plate` contradiction as above.

Verdict: C++ is likely correct; JS is too conservative.

### EnzoMiali_fb5b3f086e286c824e164774e99baabb.txt

Native-only static object:

- `plate`

JS evidence:

```text
line 101: late [ depressor no Plate ] [ Wall3 ] -> [ depressor no Plate ] [ Wall1 ]
line 104: late [ depressor no Plate ] [ Background2 ] -> [ depressor no Plate ] [ Background ]
```

Same `Depressor = Player or Plate` plus `no Plate` contradiction.

Verdict: C++ is likely correct; JS is too conservative.

### LucasGiffuni_26994c34a6c8414f01adce52c795f41c.txt

Native-only static objects:

- `hit_h`
- `hit_i`
- `hit_s`
- `hit_t`

JS evidence:

```text
line 848: [ > wallAndPlayer | no Solid ] -> [ | wallAndPlayer ]
line 849: [ > wallAndPlayer | no Solid ] -> [ | wallAndPlayer ]
```

Definitions:

```text
wallAndPlayer = wall or Enemy
Solid = ArrowTrapAny
```

The JS erasure comes from treating `wallAndPlayer` as possibly writing `Wall`.
In this version, `Wall` shares a collision layer with `HIT_H`, `HIT_I`,
`HIT_S`, and `HIT_T`, so writing `Wall` would erase those objects.

However, the rule requires `> wallAndPlayer`; active movement is generated for
the enemy branch, not for `Wall`. I did not find an active rule that gives
`Wall` movement.

Verdict: C++ is likely correct for actual runtime behavior; JS is too
conservative because it does not prove the `Wall` branch of the moving property
cannot fire.

### LucasGiffuni_5668e5a9c4eb6651012c93c5c29ff973.txt

Native-only static object:

- `crossing`

JS evidence:

```text
line 857: [ > wallAndPlayer | no Solid ] -> [ | wallAndPlayer ]
```

Definitions:

```text
wallAndPlayer = wall or Enemy
Solid = ArrowTrapAny or wall
```

Here `Wall` shares the path layer with `Crossing`, so a write of `Wall` would
erase `Crossing`. As above, that requires the `Wall` member of `wallAndPlayer`
to be moving, and I did not find a rule that can give `Wall` movement. The
reachable moving branch is `Enemy`, which is on a different layer.

Verdict: C++ is likely correct; JS is too conservative.

### LucasGiffuni_91719baa4978e212a2de42b7b79b246f.txt

Native-only static objects:

- `hit_h`
- `hit_i`
- `hit_s`
- `hit_t`

Same rule shape as `LucasGiffuni_26994c34a6c8414f01adce52c795f41c.txt`:

```text
line 848: [ > wallAndPlayer | no Solid ] -> [ | wallAndPlayer ]
line 849: [ > wallAndPlayer | no Solid ] -> [ | wallAndPlayer ]
```

Verdict: C++ is likely correct; JS is too conservative.

### pickten_b37135b9010e823b3a2a09fbca3de52c.txt

Native-only static objects:

- `tether`
- `wall`

JS evidence:

```text
line 285: late left  [TieL | Part no Crate] -> [TieL | Part no Crate FTieR]
line 286: late right [TieR | Part no Crate] -> [TieR | Part no Crate FTieL]
line 287: late up    [TieU | Part no Crate] -> [TieU | Part no Crate FTieD]
line 288: late down  [TieD | Part no Crate] -> [TieD | Part no Crate FTieU]
```

Definitions:

```text
Part = Tie or Crate
```

The erasing branch is the `Part = Crate` expansion, but the same cell also
requires `no Crate`.

Verdict: C++ is likely correct; JS is too conservative.

### pickten_f0c2b490c9e4702001d88a9eae6b6b16.txt

Native-only static objects:

- `tether`
- `wall`

JS evidence:

```text
line 393: late left  [TieL | Part no Crate] -> [TieL | Part no Crate FTieR]
line 394: late right [TieR | Part no Crate] -> [TieR | Part no Crate FTieL]
line 395: late up    [TieU | Part no Crate] -> [TieU | Part no Crate FTieD]
line 396: late down  [TieD | Part no Crate] -> [TieD | Part no Crate FTieU]
```

Same `Part = Tie or Crate` plus `no Crate` contradiction as above.

Verdict: C++ is likely correct; JS is too conservative.

## Follow-Up

All three items are implemented — see "Resolution" above (commit a45d1b95).

1. DONE — Fix native C++ for the 8ece shape: when a RHS property/object-set write
   can write an object into a layer, same-layer occupants not excluded by the LHS
   target cell must be treated as potentially erased. (Now gated by a
   movement-origination set so only objects that can actually move count.)
2. DONE — Improve JS precision for impossible/unreachable expanded branches:
   - same-cell `present X` plus `absent X`
   - same-cell `present member of property P` plus `absent P`
   - moving property writes where only some property members can ever receive
     movement
   Realised via raw-`objectsPresent` preserve/occupancy checks (matching native)
   plus a JS movement-origination filter — not via whole-rule excision, since
   native does not excise dead rules.
3. DONE — Fixtures for both directions, as `object_tags` testdata:
   `static-moved-property-overwrites-shared-layer` (mover overwrites a same-layer
   object), `static-immobile-property-member-preserved` (immobile member never
   lands), `static-contradictory-member-preserved` (dead branch preserves the
   member and does not overwrite its sibling). Native parity runs over the same
   `.txt` files, so both directions are covered.

