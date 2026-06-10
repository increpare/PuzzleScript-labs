# Incremental Rule Application — Phase A.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-iteration changed-objects/movements pruning inside `applyRuleGroup`'s fixpoint loop, so rules that cannot possibly fire because their inputs haven't changed since the last iteration are skipped. Phase A.1 of the spec at `docs/superpowers/specs/2026-06-10-incremental-rule-application-design.md`.

**Architecture:** Static `readMovements`, `writeObjects`, `writeMovements`, `forceAlwaysRun` are computed per rule during compilation (`src/js/compiler.js` `rulesToMask`). At runtime, `applyRuleGroup` maintains a per-iteration changed-objects bitvec and changed-movements bitvec via two-buffer alternation; rules whose read masks don't intersect the prior iteration's writes are skipped. A `PUZZLESCRIPT_INCREMENTAL_PARITY=1` flag runs both the legacy and the pruned paths in parallel and asserts byte-identical post-`applyRules` state for one CI cycle before the legacy path is deleted.

**Tech Stack:** Pure JS, QUnit-style test harness via `src/tests/run_tests_node.js`, existing `BitVec` type from `src/js/bitvec.js`, existing static-analysis fixture format under `src/tests/static_analysis_testdata/`.

---

## Pre-requisites

- The in-flight Phase 5c-3 diff (`src/js/compiler.js`, `src/js/engine.js` modifications already in the working tree at plan-write time) must be **committed before this plan starts**. Reason: §3.1 of the spec — `writeMovements` derivation must read `inferredPropertyBindings.dirMode/dirMask` introduced by 5c-3.

- Verify: `git status` should be clean before Task 1. `git log -1 --oneline` should reference the 5c-3 landing (or 5c-3 should already be merged to `master` by a separate workflow).

## Deviations from the spec

- **§5.2 (static-analysis testdata claim).** The spec calls for the masks to be locked down via a `rule_read_write_masks` claim in `src/tests/static_analysis_testdata/`. This plan instead uses a standalone Node test driver (`src/tests/run_rule_read_write_masks_node.js`, Tasks 3-6) for the same intent — lock down the mask outputs for a curated fixture corpus. Reason: wiring a new claim into `src/tests/ps_static_analysis.js` + `static_analysis_claim_descriptions.json` + the runner is significant scope on top of A.1's core change. The driver is functionally equivalent for guarding the masks; folding it into the formal claim system is tracked as follow-up.
- **§5.3 (runtime debug instrumentation).** Deferred. The parity bake (Tasks 8-9) is the primary safety net; the counter struct adds value only once parity is removed and we want to confirm pruning ratios in production. Tracked as follow-up; add when needed.

## File Structure

Files touched in this phase:

- `src/js/bitvec.js` — add `BitVec.prototype.intersects`, `setZero`.
- `src/js/compiler.js` — add `computeRuleReadWriteMasks(state, rule, ruleTuple)` and four new slots on each rule tuple (indices `[14..17]` after the existing `[0..13]`).
- `src/js/globalVariables.js` — declare three module-level BitVec slots (`_changedObjects_a/b`, `_changedMovements_a/b`, `_allOnesObjects`, `_allOnesMovements`). Initialization happens in `setGameState` once `STRIDE_OBJ`/`STRIDE_MOV` are known.
- `src/js/engine.js`
  - `Rule` constructor (line ~1440): read the new slots off the tuple.
  - `applyRuleGroup` (line ~2855): replace unconditional `tryApply` with the gated form.
  - New `applyRuleGroupLegacy` retained behind parity flag; deleted in the final task.
  - Parity-flag plumbing inside `applyRules` to clone level state and compare post-state.
- `src/tests/run_rule_read_write_masks_node.js` — new node test driver, asserts the four masks per rule against a small fixture corpus. Modeled after `src/tests/run_inferred_rhs_property_bindings_node.js`.
- `src/tests/COALESCING_PERF.md` — new dated section with before/after numbers.

Not touched (deliberately deferred to Phase A.2):
- `applyRules` outer-loop pruning (`cumulativeChangedObjects`).
- Per-rule-group `groupReadObjects` / `groupReadMovements` slots.

---

## Task 1: Add `BitVec.prototype.intersects` and `setZero`

**Files:**
- Modify: `src/js/bitvec.js` (after the existing `iclear` method around line 47)
- Test: `src/tests/run_bitvec_intersects_node.js` (new)

- [ ] **Step 1: Write the failing test**

Create `src/tests/run_bitvec_intersects_node.js`:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

// Loads src/js/*.js as globals (BitVec, compile, processInput, etc.).
loadPuzzleScript();

function test(name, fn) {
    try { fn(); console.log(`  PASS ${name}`); }
    catch (err) { console.error(`  FAIL ${name}\n    ${err.message}`); process.exitCode = 1; }
}

test('intersects: empty vs empty is false', () => {
    const a = new BitVec(2);
    const b = new BitVec(2);
    assert.strictEqual(a.intersects(b), false);
});

test('intersects: nonempty disjoint is false', () => {
    const a = new BitVec(2);
    const b = new BitVec(2);
    a.ibitset(0);
    b.ibitset(1);
    assert.strictEqual(a.intersects(b), false);
});

test('intersects: shared bit returns true', () => {
    const a = new BitVec(2);
    const b = new BitVec(2);
    a.ibitset(5);
    b.ibitset(5);
    assert.strictEqual(a.intersects(b), true);
});

test('intersects: bit in second word', () => {
    const a = new BitVec(2);
    const b = new BitVec(2);
    a.ibitset(40);
    b.ibitset(40);
    assert.strictEqual(a.intersects(b), true);
});

test('intersects: early-exit on first word', () => {
    const a = new BitVec(4);
    const b = new BitVec(4);
    a.ibitset(0);
    b.ibitset(0);
    // No bits set in words 1..3 on either side; result must still be true.
    assert.strictEqual(a.intersects(b), true);
});

test('setZero: clears all words', () => {
    const a = new BitVec(3);
    a.ibitset(0); a.ibitset(40); a.ibitset(80);
    a.setZero();
    for (let i = 0; i < a.data.length; i++) {
        assert.strictEqual(a.data[i], 0, `word ${i} not cleared`);
    }
});

console.log('All BitVec.intersects/setZero tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/tests/run_bitvec_intersects_node.js`
Expected: FAIL with `a.intersects is not a function` on the first test.

- [ ] **Step 3: Implement `intersects` and `setZero`**

In `src/js/bitvec.js`, insert after the `iclear` method (around line 47, before `ibitset`):

```js
BitVec.prototype.intersects = function (other) {
    const data = this.data;
    const otherData = other.data;
    const n = data.length;
    for (let i = 0; i < n; ++i) {
        if ((data[i] & otherData[i]) !== 0) return true;
    }
    return false;
};

BitVec.prototype.setZero = function () {
    const data = this.data;
    const n = data.length;
    for (let i = 0; i < n; ++i) {
        data[i] = 0;
    }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node src/tests/run_bitvec_intersects_node.js`
Expected: All 6 PASS lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/js/bitvec.js src/tests/run_bitvec_intersects_node.js
git commit -m "Add BitVec.intersects and BitVec.setZero

Cheap any-bit-anded-nonzero check with early exit, plus an in-place
zero. Used by the upcoming incremental rule-application pruning in
applyRuleGroup."
```

---

## Task 2: Pre-allocate per-iteration swap buffers and all-ones masks

**Files:**
- Modify: `src/js/globalVariables.js` (append after line 67)
- Modify: `src/js/engine.js` `setGameState` (around line 711) — initialize buffers once STRIDE values are known.

- [ ] **Step 1: Add module-level slots in `globalVariables.js`**

After line 67 (`function get_title_animation_frame() { ... }`), append:

```js
// Incremental rule application: per-iteration swap buffers used by
// applyRuleGroup. Allocated in setGameState once STRIDE_OBJ/STRIDE_MOV
// are known. Two pairs alternate per fixpoint iteration; the all-ones
// pair is used as the iteration-0 prior so the first scan is unpruned.
let _changedObjects_a = null;
let _changedObjects_b = null;
let _changedMovements_a = null;
let _changedMovements_b = null;
let _allOnesObjects = null;
let _allOnesMovements = null;
```

- [ ] **Step 2: Initialize in `setGameState`**

In `src/js/engine.js`, find the block in `setGameState` where other BitVec scratch buffers are allocated (around lines 728-906 — `sfxCreateMask`, `_o1`, etc.). After the existing `_o*` allocations, append:

```js
    _changedObjects_a = new BitVec(STRIDE_OBJ);
    _changedObjects_b = new BitVec(STRIDE_OBJ);
    _changedMovements_a = new BitVec(STRIDE_MOV);
    _changedMovements_b = new BitVec(STRIDE_MOV);
    _allOnesObjects = new BitVec(STRIDE_OBJ);
    _allOnesMovements = new BitVec(STRIDE_MOV);
    for (let i = 0; i < _allOnesObjects.data.length; i++) _allOnesObjects.data[i] = -1;
    for (let i = 0; i < _allOnesMovements.data.length; i++) _allOnesMovements.data[i] = -1;
```

(Locate the exact insertion point by searching for `_o10 = new BitVec(STRIDE_OBJ);` and inserting after the trailing `_o*` allocations.)

- [ ] **Step 3: Smoke test**

Run: `node src/tests/run_tests_node.js --sim-only "Hello World"` (a single test game name — substitute one that exists; use `--verbose` if needed to confirm one runs)
Expected: PASS. Buffers are allocated but not yet consumed.

If no `Hello World` fixture exists, run the smallest filter that resolves to one game:
```
node src/tests/run_tests_node.js --sim-only "intro" 
```

- [ ] **Step 4: Commit**

```bash
git add src/js/globalVariables.js src/js/engine.js
git commit -m "Pre-allocate per-iteration swap buffers for rule pruning

Adds _changedObjects_a/b, _changedMovements_a/b and immutable
_allOnesObjects/_allOnesMovements, allocated once per setGameState.
Buffers are not consumed yet; downstream tasks add the prune logic
in applyRuleGroup."
```

---

## Task 3: Derive `readMovements` per rule in compiler

**Files:**
- Modify: `src/js/compiler.js` — add helper `computeReadMovements(rule)` near `rulesToMask` (around line 2646), call it during `collapseRules` (around line 3163).

- [ ] **Step 1: Write the failing fixture**

Create `src/tests/run_rule_read_write_masks_node.js`:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

loadPuzzleScript();
const { compileSource } = require('./lib/node_test_harness');

const FIXTURES = [
    {
        name: 'simple-directional-rule',
        source: `
title test
========
OBJECTS
========
Background
white
Player
red
Wall
grey
=======
LEGEND
=======
. = Background
P = Player
# = Wall
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Wall
Player
======
RULES
======
[ > Player | Wall ] -> [ Player | Wall ]
==============
WINCONDITIONS
==============
=======
LEVELS
=======
.P#
`,
        expect: {
            readMovementsNonEmpty: true,   // [ > Player | Wall ] gates on Player's movement bits
            forceAlwaysRun: false,
        },
    },
    {
        name: 'stationary-on-rhs',
        source: `
title test
========
OBJECTS
========
Background
white
Player
red
=======
LEGEND
=======
. = Background
P = Player
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Player
======
RULES
======
[ Player ] -> [ stationary Player ]
==============
WINCONDITIONS
==============
=======
LEVELS
=======
.P.
`,
        expect: {
            readMovementsNonEmpty: false,   // LHS [ Player ] has no direction modifier
            writeMovementsNonEmpty: true,   // RHS [ stationary Player ] touches the Player layer's movement bits
            forceAlwaysRun: false,
        },
    },
    {
        name: 'random-rule-is-force-always',
        source: `
title test
========
OBJECTS
========
Background
white
Player
red
Crab
blue
=======
LEGEND
=======
. = Background
P = Player
C = Crab
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Player, Crab
======
RULES
======
random [ Player ] -> [ Crab ]
==============
WINCONDITIONS
==============
=======
LEVELS
=======
.P.
`,
        expect: {
            forceAlwaysRun: true,
            forceAlwaysRunReason: 'isRandom',
        },
    },
];

let failures = 0;
for (const fixture of FIXTURES) {
    try {
        const state = compileSource(fixture.source);
        // Fixtures are crafted so state.rules contains exactly one group with exactly one rule.
        const allRules = state.rules.flat().concat((state.lateRules || []).flat());
        assert.strictEqual(allRules.length, 1,
            `${fixture.name}: expected exactly 1 compiled rule, got ${allRules.length}`);
        const rule = allRules[0];
        const exp = fixture.expect;
        if (exp.forceAlwaysRun !== undefined) {
            assert.strictEqual(rule.forceAlwaysRun, exp.forceAlwaysRun,
                `${fixture.name}: forceAlwaysRun`);
        }
        if (exp.forceAlwaysRunReason !== undefined) {
            assert.strictEqual(rule.forceAlwaysRunReason, exp.forceAlwaysRunReason,
                `${fixture.name}: forceAlwaysRunReason`);
        }
        if (exp.readMovementsNonEmpty !== undefined) {
            const isZero = rule.readMovements.data.every(w => w === 0);
            assert.strictEqual(!isZero, exp.readMovementsNonEmpty,
                `${fixture.name}: readMovements non-empty`);
        }
        if (exp.writeObjectsNonEmpty !== undefined) {
            const isZero = rule.writeObjects.data.every(w => w === 0);
            assert.strictEqual(!isZero, exp.writeObjectsNonEmpty,
                `${fixture.name}: writeObjects non-empty`);
        }
        if (exp.writeMovementsNonEmpty !== undefined) {
            const isZero = rule.writeMovements.data.every(w => w === 0);
            assert.strictEqual(!isZero, exp.writeMovementsNonEmpty,
                `${fixture.name}: writeMovements non-empty`);
        }
        console.log(`  PASS ${fixture.name}`);
    } catch (err) {
        console.error(`  FAIL ${fixture.name}\n    ${err.message}`);
        failures++;
    }
}
process.exit(failures > 0 ? 1 : 0);
```

(`compileSource(source, randomseed?)` is defined in `src/tests/lib/node_test_harness.js`. It returns the compiled `state` plus a `rules` array. The accessor for `rule.lineNumber` etc. follows the structures already defined in `src/js/engine.js`'s `Rule` constructor. The compiled `rules` array is a flat list of rule-group arrays; flattening once gets you the individual `Rule` instances with their tuple slots already unpacked.)

- [ ] **Step 2: Verify the test fails because the masks don't exist**

Run: `node src/tests/run_rule_read_write_masks_node.js`
Expected: FAIL — `rule.readMovements is undefined` or `rule.forceAlwaysRun is undefined`.

- [ ] **Step 3: Add `computeReadMovements` helper in `compiler.js`**

Insert after the `rulesToMask` function definition (search for `function rulesToMask(state) {` ending around line 2940; place the new helper after the closing brace of `rulesToMask`):

```js
// Phase A.1: per-rule readMovements derivation. Walks every LHS cell
// row, ORs into a BitVec(STRIDE_MOV) the movement-bit layers that the
// LHS could gate on: explicit direction modifiers on objects, aggregate
// LHS bindings, and layer-coupled property bindings.
function computeReadMovements(state, ruleTuple) {
    const result = new BitVec(STRIDE_MOV);
    const patterns = ruleTuple[1]; // cell rows
    for (let rowIndex = 0; rowIndex < patterns.length; rowIndex++) {
        const cellrow = patterns[rowIndex];
        for (let colIndex = 0; colIndex < cellrow.length; colIndex++) {
            const cell = cellrow[colIndex];
            for (let i = 0; i + 1 < cell.length; i += 2) {
                const object_dir = cell[i];
                const object_name = cell[i + 1];
                if (object_dir === '' || object_dir === 'no' || object_dir === '...') continue;
                // Movement direction modifier (up/down/left/right/action/moving/stationary/horizontal/vertical/orthogonal/parallel/perpendicular/randomdir).
                const layerIndex = state.objects[object_name] ? state.objects[object_name].layer : null;
                if (layerIndex === null || layerIndex === undefined) continue;
                if (dirMasks.hasOwnProperty(object_dir)) {
                    const shift = 5 * layerIndex;
                    const wordIdx = shift >>> 5;
                    const wordShift = shift & 31;
                    result.data[wordIdx] |= (dirMasks[object_dir] << wordShift) | 0;
                    if (wordShift > 27) {
                        result.data[wordIdx + 1] |= (dirMasks[object_dir] >>> (32 - wordShift)) | 0;
                    }
                } else if (LAYER_COUPLED_MOVEMENT_DIRS[object_dir]) {
                    // moving / horizontal / vertical / orthogonal / parallel / perpendicular — set all five direction bits on the layer.
                    const shift = 5 * layerIndex;
                    const wordIdx = shift >>> 5;
                    const wordShift = shift & 31;
                    result.data[wordIdx] |= (0x1f << wordShift) | 0;
                    if (wordShift > 27) {
                        result.data[wordIdx + 1] |= (0x1f >>> (32 - wordShift)) | 0;
                    }
                }
            }
        }
    }
    // Aggregate LHS bindings: every binding implies the source layer is
    // gated on its aggregate mask.
    const aggregates = ruleTuple[12]; // aggregateBindingsArr
    if (aggregates) {
        for (let i = 0; i < aggregates.length; i++) {
            const b = aggregates[i];
            const shift = 5 * b.sourceLayer;
            const wordIdx = shift >>> 5;
            const wordShift = shift & 31;
            result.data[wordIdx] |= ((b.aggregateMask & 0x1f) << wordShift) | 0;
            if (wordShift > 27) {
                result.data[wordIdx + 1] |= ((b.aggregateMask & 0x1f) >>> (32 - wordShift)) | 0;
            }
        }
    }
    return result;
}
```

(The exact mechanism for resolving `object_name` to `layerIndex` may differ from `state.objects[object_name].layer` depending on where this is called from inside `rulesToMask` vs `collapseRules`. Cross-check with `rulesToMask`'s existing layer-lookup pattern — it uses `state.objects[object_name].layer` consistently around line 2750-2900.)

- [ ] **Step 4: Re-run test, watch for partial progress**

Run: `node src/tests/run_rule_read_write_masks_node.js`
Expected: First fixture's `readMovementsNonEmpty: true` should now pass. Other expectations still fail (we haven't computed writeObjects, writeMovements, forceAlwaysRun yet).

- [ ] **Step 5: Commit**

```bash
git add src/js/compiler.js
git commit -m "Compute readMovements per rule

Walks LHS cell rows + aggregate bindings to derive the movement-bit
layers a rule's LHS gates on. Used by the upcoming incremental
applyRuleGroup pruning. Not yet wired through to the Rule tuple slot."
```

---

## Task 4: Derive `writeObjects` per rule

**Files:**
- Modify: `src/js/compiler.js` — add helper `computeWriteObjects(state, ruleTuple)` next to `computeReadMovements`.

- [ ] **Step 1: Update test to expect `writeObjects` populated**

In `src/tests/run_rule_read_write_masks_node.js`, the `simple-directional-rule` fixture's `writeObjects: []` is already in place. Add a new fixture before `random-rule-is-force-always`:

```js
{
    name: 'rhs-writes-new-object',
    source: `
title test
========
OBJECTS
========
Background
white
Player
red
Crab
blue
=======
LEGEND
=======
. = Background
P = Player
C = Crab
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Player, Crab
======
RULES
======
[ Player ] -> [ Crab ]
==============
WINCONDITIONS
==============
=======
LEVELS
=======
.P.
`,
    expect: {
        // Crab is on the Player/Crab layer; writeObjects must include its layer mask.
        writeObjectsNonEmpty: true,
        forceAlwaysRun: false,
    },
},
```

The fixture is consumed by the same loop as Task 3; the `writeObjectsNonEmpty` check is already in the driver. No driver changes needed for this task.

- [ ] **Step 2: Verify the test fails**

Run: `node src/tests/run_rule_read_write_masks_node.js`
Expected: FAIL — `rule.writeObjects is undefined`.

- [ ] **Step 3: Implement `computeWriteObjects`**

In `src/js/compiler.js`, next to `computeReadMovements`, add:

```js
// Phase A.1: per-rule writeObjects derivation. Walks every RHS cell
// row, ORs into a BitVec(STRIDE_OBJ) the object-bit indices that the
// RHS could add or remove. Includes:
//   - explicit objects on RHS cells (object_name);
//   - inferred property-binding sinks (propertyBindingsArr RHS entries);
//   - aggregate sinks (aggregateBindingsArr RHS entries).
function computeWriteObjects(state, ruleTuple) {
    const result = new BitVec(STRIDE_OBJ);
    const patterns = ruleTuple[1];
    // For an unreplaced rule (hasReplacements=false) there's no RHS to scan.
    if (!ruleTuple[2]) return result;
    // The RHS is reconstructed below from the rule's `rhs` field — but at
    // this point in the pipeline (post-collapseRules), the RHS is no longer
    // a top-level field. Instead we read from the original `state.rules`
    // entry passed alongside the tuple. The caller threads `rhsCells`
    // through; see invocation in collapseRules.
    const rhsCells = ruleTuple.__rhsCellsForMaskComputation;
    if (!rhsCells) return result;
    for (let rowIndex = 0; rowIndex < rhsCells.length; rowIndex++) {
        const cellrow = rhsCells[rowIndex];
        for (let colIndex = 0; colIndex < cellrow.length; colIndex++) {
            const cell = cellrow[colIndex];
            for (let i = 0; i + 1 < cell.length; i += 2) {
                const object_name = cell[i + 1];
                if (object_name === '...' || object_name === 'random' || object_name === 'randomdir') continue;
                const objectInfo = state.objects[object_name];
                if (!objectInfo) continue;
                result.ibitset(objectInfo.id);
            }
        }
    }
    // Property sinks: each sink lists possible alias objects on the RHS.
    if (ruleTuple.__propertySinksForMaskComputation) {
        const sinks = ruleTuple.__propertySinksForMaskComputation;
        for (const [propName, sinkList] of sinks.entries()) {
            // propName resolves to a property whose members are the possible objects.
            const property = state.propertiesDict ? state.propertiesDict[propName] : null;
            if (!property) continue;
            for (const memberName of property) {
                const objectInfo = state.objects[memberName];
                if (objectInfo) result.ibitset(objectInfo.id);
            }
        }
    }
    // Aggregate sinks: each binding's destLayer carries the writable layer.
    const aggregates = ruleTuple[12];
    if (aggregates) {
        for (let i = 0; i < aggregates.length; i++) {
            const b = aggregates[i];
            // Aggregate bindings on the RHS imply the destination layer's
            // movement bits get written; the underlying object may also be
            // newly present. Conservatively flag every member of the
            // destination layer.
            const layer = state.collisionLayers[b.destLayer];
            if (layer) {
                for (const objName of layer) {
                    const info = state.objects[objName];
                    if (info) result.ibitset(info.id);
                }
            }
        }
    }
    return result;
}
```

(The `__rhsCellsForMaskComputation` and `__propertySinksForMaskComputation` are private back-channels: the caller in `collapseRules` (Task 6) stashes them on the rule tuple just before calling `computeWriteObjects`, then deletes them. This keeps the helper testable without restructuring the rule pipeline. If the codebase already has a cleaner accessor for the RHS at this stage, prefer that.)

- [ ] **Step 4: Stash + invoke from `collapseRules`**

In `src/js/compiler.js` `collapseRules`, after the rule tuple is fully constructed (currently ends with `newrule.push(oldrule.propertyBindingsArr || null);` around line 3200, before `rules[i] = new Rule(newrule);`), add:

```js
            // Phase A.1: stash inputs for mask computation, compute, then clean up.
            newrule.__rhsCellsForMaskComputation = oldrule.rhs;
            newrule.__propertySinksForMaskComputation = oldrule.propertySinks;
            newrule.push(computeReadMovements(state, newrule));   // slot [14]
            newrule.push(computeWriteObjects(state, newrule));     // slot [15]
            delete newrule.__rhsCellsForMaskComputation;
            delete newrule.__propertySinksForMaskComputation;
```

- [ ] **Step 5: Wire through to Rule constructor**

In `src/js/engine.js` `Rule` constructor (line ~1440), after the existing slot reads:

```js
    this.propertyBindingsArr = rule[13] || null;
    this.propertyCaptures = this.propertyBindingsArr ? {} : null;
```

Insert:

```js
    this.readMovements = rule[14] || new BitVec(STRIDE_MOV);
    this.writeObjects = rule[15] || new BitVec(STRIDE_OBJ);
```

Also add a read-only alias for symmetry with the spec terminology:

```js
    this.readObjects = this.ruleMask;  // existing field, aliased for clarity
```

(Place this after the existing `this.ruleMask` initialization a few lines below.)

- [ ] **Step 6: Run the test**

Run: `node src/tests/run_rule_read_write_masks_node.js`
Expected: `rhs-writes-new-object` PASSES. `random-rule-is-force-always` and the `simple-directional-rule`'s `writeObjects: []` expectation still depend on later tasks.

- [ ] **Step 7: Commit**

```bash
git add src/js/compiler.js src/js/engine.js src/tests/run_rule_read_write_masks_node.js
git commit -m "Compute writeObjects per rule

Walks RHS cells, property sinks, and aggregate destinations to derive
the object IDs a rule's RHS could touch. Wired into the Rule constructor
via a new tuple slot [15]."
```

---

## Task 5: Derive `writeMovements` per rule

**Files:**
- Modify: `src/js/compiler.js` — add `computeWriteMovements(state, ruleTuple)`.
- Modify: `src/js/engine.js` — Rule constructor reads slot [16].

- [ ] **Step 1: Update test**

In `src/tests/run_rule_read_write_masks_node.js`, the `stationary-on-rhs` fixture's `writeMovementsNonEmpty: true` is already in place. Re-run as the failing case.

- [ ] **Step 2: Verify the test fails**

Run: `node src/tests/run_rule_read_write_masks_node.js`
Expected: `stationary-on-rhs` FAILs because `rule.writeMovements` is undefined.

- [ ] **Step 3: Implement `computeWriteMovements`**

Next to the other `compute*` helpers:

```js
// Phase A.1: per-rule writeMovements derivation. Walks every RHS cell
// row, ORs into a BitVec(STRIDE_MOV) the movement-bit layers that the
// RHS may overwrite. Includes:
//   - explicit direction modifiers on RHS objects;
//   - random / randomdir: every direction bit on the affected layer;
//   - inferredPropertyBindings.dirMode (5c-3): layer bits on captured
//     property bindings when dirMode != 0.
//   - aggregate sinks: destination layer's aggregate-mask bits.
function computeWriteMovements(state, ruleTuple) {
    const result = new BitVec(STRIDE_MOV);
    if (!ruleTuple[2]) return result;
    const rhsCells = ruleTuple.__rhsCellsForMaskComputation;
    if (!rhsCells) return result;
    for (let rowIndex = 0; rowIndex < rhsCells.length; rowIndex++) {
        const cellrow = rhsCells[rowIndex];
        for (let colIndex = 0; colIndex < cellrow.length; colIndex++) {
            const cell = cellrow[colIndex];
            for (let i = 0; i + 1 < cell.length; i += 2) {
                const object_dir = cell[i];
                const object_name = cell[i + 1];
                const objectInfo = state.objects[object_name];
                if (!objectInfo) continue;
                const layerIndex = objectInfo.layer;
                const shift = 5 * layerIndex;
                const wordIdx = shift >>> 5;
                const wordShift = shift & 31;
                let mask = 0;
                if (object_dir === '' || object_dir === 'no') {
                    // Plain RHS object: layer's movement bits may be cleared.
                    mask = 0x1f;
                } else if (object_dir === 'random' || object_dir === 'randomdir') {
                    mask = 0x1f;
                } else if (dirMasks.hasOwnProperty(object_dir)) {
                    mask = dirMasks[object_dir] | 0x1f; // touches the layer's slot
                }
                if (mask !== 0) {
                    result.data[wordIdx] |= (mask << wordShift) | 0;
                    if (wordShift > 27) {
                        result.data[wordIdx + 1] |= (mask >>> (32 - wordShift)) | 0;
                    }
                }
            }
        }
    }
    // Aggregate sinks
    const aggregates = ruleTuple[12];
    if (aggregates) {
        for (let i = 0; i < aggregates.length; i++) {
            const b = aggregates[i];
            const shift = 5 * b.destLayer;
            const wordIdx = shift >>> 5;
            const wordShift = shift & 31;
            result.data[wordIdx] |= ((b.aggregateMask & 0x1f) << wordShift) | 0;
            if (wordShift > 27) {
                result.data[wordIdx + 1] |= ((b.aggregateMask & 0x1f) >>> (32 - wordShift)) | 0;
            }
        }
    }
    // 5c-3 inferred property bindings: dirMode 1 = stationary (clear),
    // dirMode 2 = concrete direction (clear + set). Both touch layer bits.
    const propertyBindings = ruleTuple[13];
    if (propertyBindings) {
        for (let i = 0; i < propertyBindings.length; i++) {
            const b = propertyBindings[i];
            if (b.dirMode === 0) continue;
            // Layer index for the captured property's members:
            const propMembers = state.propertiesDict ? state.propertiesDict[b.propertyName] : null;
            if (!propMembers || propMembers.length === 0) continue;
            // All property members live on the same layer (property is single-layer at this point).
            const firstObj = state.objects[propMembers[0]];
            if (!firstObj) continue;
            const layerIndex = firstObj.layer;
            const shift = 5 * layerIndex;
            const wordIdx = shift >>> 5;
            const wordShift = shift & 31;
            result.data[wordIdx] |= (0x1f << wordShift) | 0;
            if (wordShift > 27) {
                result.data[wordIdx + 1] |= (0x1f >>> (32 - wordShift)) | 0;
            }
        }
    }
    return result;
}
```

- [ ] **Step 4: Push slot [16] from `collapseRules`**

In `collapseRules`, after the `writeObjects` push:

```js
            newrule.push(computeWriteMovements(state, newrule));  // slot [16]
```

- [ ] **Step 5: Read slot [16] in Rule constructor**

In `src/js/engine.js` `Rule` constructor, after `this.writeObjects = rule[15] || …`:

```js
    this.writeMovements = rule[16] || new BitVec(STRIDE_MOV);
```

- [ ] **Step 6: Run the test**

Run: `node src/tests/run_rule_read_write_masks_node.js`
Expected: `stationary-on-rhs` PASSES.

- [ ] **Step 7: Commit**

```bash
git add src/js/compiler.js src/js/engine.js
git commit -m "Compute writeMovements per rule

Walks RHS cells, aggregate destinations, and 5c-3 inferred property
bindings to derive the movement-bit layers a rule's RHS may overwrite.
Wired into the Rule constructor via tuple slot [16]."
```

---

## Task 6: Classify `forceAlwaysRun`

**Files:**
- Modify: `src/js/compiler.js` — add `classifyForceAlwaysRun(state, ruleTuple, oldrule)`.
- Modify: `src/js/engine.js` — Rule constructor reads slot [17].

- [ ] **Step 1: Update test — random fixture should pass**

The `random-rule-is-force-always` fixture in `run_rule_read_write_masks_node.js` already expects `forceAlwaysRun: true` and reason `isRandom`. Add one more fixture for the command-tail case:

```js
{
    name: 'again-command-is-force-always',
    source: `
title test
========
OBJECTS
========
Background
white
Player
red
=======
LEGEND
=======
. = Background
P = Player
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Player
======
RULES
======
[ Player ] -> [ Player ] again
==============
WINCONDITIONS
==============
=======
LEVELS
=======
.P.
`,
    expect: {
        forceAlwaysRun: true,
        forceAlwaysRunReason: 'command:again',
    },
},
```

- [ ] **Step 2: Verify the test fails**

Run: `node src/tests/run_rule_read_write_masks_node.js`
Expected: `random-rule-is-force-always` and `again-command-is-force-always` FAIL — `forceAlwaysRun` undefined.

- [ ] **Step 3: Implement `classifyForceAlwaysRun`**

In `src/js/compiler.js`:

```js
// Phase A.1: rules we can't soundly prune. Returns { force: bool, reason: string|null }.
// Conservative — when in doubt, return force=true so the rule is always evaluated.
const PHASE_A1_REPLAY_COMMANDS = new Set([
    'again', 'restart', 'cancel', 'win', 'checkpoint',
]);
function classifyForceAlwaysRun(state, ruleTuple, oldrule) {
    if (ruleTuple[8]) return { force: true, reason: 'isRandom' };       // slot [8] = isRandom
    const commands = ruleTuple[7] || [];                                 // slot [7] = commands
    for (let i = 0; i < commands.length; i++) {
        const name = commands[i][0];
        if (PHASE_A1_REPLAY_COMMANDS.has(name)) {
            return { force: true, reason: 'command:' + name };
        }
    }
    if (ruleTuple[6]) return { force: true, reason: 'rigid' };          // slot [6] = rigid; pruning rigid rules interacts with bannedGroup logic in resolveMovements
    // No global-pattern / late-rule special-casing in A.1. (LATE rules
    // already run in a separate applyRules call so don't need extra handling here.)
    return { force: false, reason: null };
}
```

- [ ] **Step 4: Push slot [17] + reason from `collapseRules`**

```js
            const classification = classifyForceAlwaysRun(state, newrule, oldrule);
            newrule.push(classification.force);   // slot [17]
            newrule.push(classification.reason);  // slot [18]
```

- [ ] **Step 5: Read slots in Rule constructor**

```js
    this.forceAlwaysRun = rule[17] === true;
    this.forceAlwaysRunReason = rule[18] || null;
```

- [ ] **Step 6: Run the test**

Run: `node src/tests/run_rule_read_write_masks_node.js`
Expected: All fixtures PASS.

- [ ] **Step 7: Commit**

```bash
git add src/js/compiler.js src/js/engine.js src/tests/run_rule_read_write_masks_node.js
git commit -m "Classify forceAlwaysRun per rule

Random rules, rules with replay-causing commands (again/restart/
cancel/win/checkpoint), and rigid rules are flagged so the upcoming
applyRuleGroup pruning leaves them alone. Reason string preserved
on Rule.forceAlwaysRunReason for debug introspection."
```

---

## Task 7: Implement parity-checked `applyRuleGroup`

**Files:**
- Modify: `src/js/engine.js` — split current `applyRuleGroup` into `applyRuleGroupLegacy` (renamed) and a new `applyRuleGroupPruned`; route through a top-level `applyRuleGroup` that dispatches based on `PUZZLESCRIPT_INCREMENTAL_PARITY`.

- [ ] **Step 1: Rename current `applyRuleGroup` to `applyRuleGroupLegacy`**

In `src/js/engine.js`, line ~2855, change `function applyRuleGroup(ruleGroup) {` to `function applyRuleGroupLegacy(ruleGroup) {`.

- [ ] **Step 2: Add `applyRuleGroupPruned` immediately after**

Paste this block right after the closing `}` of `applyRuleGroupLegacy`:

```js
function applyRuleGroupPruned(ruleGroup) {
    if (ruleGroup[0].isRandom) {
        return applyRandomRuleGroup(level, ruleGroup);
    }
    const MAX_LOOP_COUNT = 200;
    const GROUP_LENGTH = ruleGroup.length;
    let hasChanges = false;
    let madeChangeThisLoop = true;
    let loopcount = 0;

    let priorObjects = _allOnesObjects;
    let priorMovements = _allOnesMovements;
    let nextObjects = _changedObjects_a;
    let nextMovements = _changedMovements_a;
    let spareObjects = _changedObjects_b;
    let spareMovements = _changedMovements_b;

    while (madeChangeThisLoop && loopcount++ < MAX_LOOP_COUNT) {
        madeChangeThisLoop = false;
        nextObjects.setZero();
        nextMovements.setZero();
        let consecutiveFailures = 0;

        for (let ruleIndex = 0; ruleIndex < GROUP_LENGTH; ruleIndex++) {
            const rule = ruleGroup[ruleIndex];
            if (!rule.forceAlwaysRun
                && !rule.readObjects.intersects(priorObjects)
                && !rule.readMovements.intersects(priorMovements)) {
                consecutiveFailures++;
                if (consecutiveFailures === GROUP_LENGTH) break;
                continue;
            }
            if (rule.tryApply(level)) {
                madeChangeThisLoop = true;
                consecutiveFailures = 0;
                nextObjects.ior(rule.writeObjects);
                nextMovements.ior(rule.writeMovements);
            } else {
                consecutiveFailures++;
                if (consecutiveFailures === GROUP_LENGTH) break;
            }
        }

        if (madeChangeThisLoop) {
            hasChanges = true;
            if (verbose_logging) {
                debugger_turnIndex++;
                addToDebugTimeline(level, -2);
            }
        }

        if (priorObjects === _allOnesObjects) {
            priorObjects = nextObjects;
            priorMovements = nextMovements;
            nextObjects = spareObjects;
            nextMovements = spareMovements;
        } else {
            const tmpO = priorObjects; priorObjects = nextObjects; nextObjects = tmpO;
            const tmpM = priorMovements; priorMovements = nextMovements; nextMovements = tmpM;
        }
    }

    if (loopcount >= MAX_LOOP_COUNT) {
        logErrorCacheable("Got caught looping lots in a rule group :O",
                          ruleGroup[0].lineNumber, true);
    }
    return hasChanges;
}
```

- [ ] **Step 3: Add the dispatching `applyRuleGroup`**

After `applyRuleGroupPruned`:

```js
// Phase A.1 parity wrapper. When the parity flag is set, both legacy
// and pruned paths run; their post-state is compared. Mismatch is fatal.
// Flag and wrapper are removed once one CI cycle confirms parity.
const INCREMENTAL_PARITY = (typeof process !== 'undefined' && process.env
    && process.env.PUZZLESCRIPT_INCREMENTAL_PARITY === '1');

function applyRuleGroup(ruleGroup) {
    if (!INCREMENTAL_PARITY) {
        return applyRuleGroupPruned(ruleGroup);
    }
    // Parity mode: clone level state, run legacy path, then run pruned
    // path on the original; compare post-states.
    const savedObjects = new Int32Array(level.objects);
    const savedMovements = new Int32Array(level.movements);
    const legacyResult = applyRuleGroupLegacy(ruleGroup);
    const legacyObjects = new Int32Array(level.objects);
    const legacyMovements = new Int32Array(level.movements);
    level.objects.set(savedObjects);
    level.movements.set(savedMovements);
    const prunedResult = applyRuleGroupPruned(ruleGroup);
    if (legacyResult !== prunedResult) {
        throw new Error(`A.1 parity: hasChanges mismatch on rule group at line `
            + `${ruleGroup[0].lineNumber}: legacy=${legacyResult} pruned=${prunedResult}`);
    }
    for (let i = 0; i < legacyObjects.length; i++) {
        if (legacyObjects[i] !== level.objects[i]) {
            throw new Error(`A.1 parity: level.objects mismatch at word ${i} on rule group `
                + `at line ${ruleGroup[0].lineNumber}: legacy=${legacyObjects[i]} pruned=${level.objects[i]}`);
        }
    }
    for (let i = 0; i < legacyMovements.length; i++) {
        if (legacyMovements[i] !== level.movements[i]) {
            throw new Error(`A.1 parity: level.movements mismatch at word ${i} on rule group `
                + `at line ${ruleGroup[0].lineNumber}: legacy=${legacyMovements[i]} pruned=${level.movements[i]}`);
        }
    }
    return prunedResult;
}
```

- [ ] **Step 4: Sanity check — sim suite passes with pruned path (parity off)**

Run: `node src/tests/run_tests_node.js --sim-only`
Expected: all sim tests pass (or, if a regression is introduced, the specific failing test name is logged). If a regression appears, debug before continuing — do not proceed to parity-on runs until the no-parity path is green.

- [ ] **Step 5: Commit**

```bash
git add src/js/engine.js
git commit -m "applyRuleGroup: pruned path behind parity flag

Renames the current implementation to applyRuleGroupLegacy and adds
applyRuleGroupPruned with per-iteration changedObjects/Movements
masks. A top-level applyRuleGroup wrapper runs both paths and asserts
post-state parity when PUZZLESCRIPT_INCREMENTAL_PARITY=1."
```

---

## Task 8: Bake parity on sim test suite

**Files:**
- Read-only: `src/tests/run_tests_node.js`, `src/js/engine.js` (for diagnostic edits if mismatches surface).

- [ ] **Step 1: Run sim suite with parity on**

Run: `PUZZLESCRIPT_INCREMENTAL_PARITY=1 node src/tests/run_tests_node.js --sim-only`
Expected: 468/469 PASS (the existing `Voitex Rasteriser 2` failure is pre-existing per the baseline run earlier in the session; confirm it's the only failure). No parity throws.

- [ ] **Step 2: If parity errors fire**

For each `A.1 parity: …` throw:
1. Note the rule group line number from the message.
2. Open the offending game's source.
3. Inspect the rules at that line.
4. Map the divergence to one of the spec's risk categories (§7.1-§7.7).
5. Most likely root causes (in order):
   - A `forceAlwaysRun` shape we missed — add to `classifyForceAlwaysRun`.
   - A write mask that under-reports (e.g. a missed property-binding source) — extend `computeWriteObjects` or `computeWriteMovements`.
   - A read mask that over-prunes (e.g. a NO pattern whose `readObjects` should also include the layer's possible members — which it should, by virtue of the LHS naming the object — re-verify).

After each fix, re-run the parity bake. Do not move to Task 9 until parity is green.

- [ ] **Step 3: Commit any fixes**

```bash
git add src/js/compiler.js src/js/engine.js src/tests/run_rule_read_write_masks_node.js
git commit -m "A.1 parity bake: <one-line description of the fix>"
```

(One commit per category of fix; iterate as needed.)

---

## Task 9: Bake parity on solver smoke + corpus

**Files:**
- Read-only: `src/tests/run_solver_smoke_assert.js`, `src/tests/run_solver_tests_js.js`.

- [ ] **Step 1: Solver smoke with parity on**

Run: `PUZZLESCRIPT_INCREMENTAL_PARITY=1 node src/tests/run_solver_smoke_assert.js`
Expected: PASS. No parity throws.

- [ ] **Step 2: Solver focus group with parity on (fast variant)**

Run:
```bash
PUZZLESCRIPT_INCREMENTAL_PARITY=1 node src/tests/run_solver_tests_js.js src/tests/solver_tests \
    --solver-focus-manifest src/tests/solver_focus_group.json \
    --timeout-ms 500 --strategy portfolio --quiet --json --no-solutions \
    > /tmp/a1-parity-focus.json
```
Expected: solver completes; check `/tmp/a1-parity-focus.json` for `errors: 0` (no parity throws bubbled up as solver errors). Solved-count may be lower than baseline because parity-mode does double work — that's expected and not a regression.

- [ ] **Step 3: Fix any errors surfaced and iterate**

Same diagnostic flow as Task 8 Step 2. Iterate until both runs are clean.

- [ ] **Step 4: Commit any final fixes**

```bash
git add src/js/compiler.js src/js/engine.js
git commit -m "A.1 parity bake: <fix description>"
```

---

## Task 10: Benchmark vs baseline (parity off) and record

**Files:**
- Modify: `src/tests/COALESCING_PERF.md` (append a new dated section).

- [ ] **Step 1: Capture baseline numbers from `master` pre-A.1**

The baseline `master` is the commit before Task 1. Stash any uncommitted work, check out that commit, run benches, then return:

```bash
git stash push -u -m "a1-bench-pause"
git checkout master  # only safe if A.1 work has been merged or this is on a feature branch
```

(If the A.1 work has been committed directly on `master`, instead check out the commit just before Task 1's first commit by SHA — `git log` to find it.)

Run baseline:
```bash
node src/tests/run_tests_node.js --profile --sim-only > /tmp/baseline-sim-profile.txt
node src/tests/run_tests_node.js --breakdown --sim-only > /tmp/baseline-sim-breakdown.txt
node src/tests/run_solver_tests_js.js src/tests/solver_tests --timeout-ms 250 --quiet --json --no-solutions > /tmp/baseline-solver-250.json
node src/tests/run_solver_tests_js.js src/tests/solver_tests --timeout-ms 5000 --quiet --json --no-solutions > /tmp/baseline-solver-5000.json
```

Return to A.1 head:
```bash
git checkout <a1-head-branch-or-sha>
git stash pop
```

- [ ] **Step 2: Capture A.1 numbers (parity OFF — measuring pure pruned path)**

```bash
node src/tests/run_tests_node.js --profile --sim-only > /tmp/a1-sim-profile.txt
node src/tests/run_tests_node.js --breakdown --sim-only > /tmp/a1-sim-breakdown.txt
node src/tests/run_solver_tests_js.js src/tests/solver_tests --timeout-ms 250 --quiet --json --no-solutions > /tmp/a1-solver-250.json
node src/tests/run_solver_tests_js.js src/tests/solver_tests --timeout-ms 5000 --quiet --json --no-solutions > /tmp/a1-solver-5000.json
```

- [ ] **Step 3: Diff and summarise**

Extract solved counts:
```bash
grep -E '"solved":' /tmp/baseline-solver-250.json | head -1
grep -E '"solved":' /tmp/a1-solver-250.json | head -1
```

Extract breakdown numbers from the two `*-breakdown.txt` files (look for the `Breakdown:` line in each).

- [ ] **Step 4: Append a new section to `src/tests/COALESCING_PERF.md`**

Add (preserving the doc's existing style):

```markdown
## 2026-06-10 incremental rule application (Phase A.1)

Baseline: `<sha-of-master-pre-A.1>`.
After: `<sha-of-A.1-head>`.

### Sim test suite (`--profile --sim-only`, 5 cold runs)

| Metric | Baseline median | A.1 median | Δ |
| --- | ---: | ---: | ---: |
| Wall ms | <N> | <N> | <Δ> |
| `processInput` ms | <N> | <N> | <Δ> |
| `compile` ms | <N> | <N> | <Δ> |

### Solver corpus

| Config | Baseline solved | A.1 solved | Δ |
| --- | ---: | ---: | ---: |
| `--timeout-ms 250` (default heuristic) | <N> | <N> | <Δ> |
| `--timeout-ms 5000` (default heuristic) | <N> | <N> | <Δ> |

### Notes

- Parity flag was on for one CI cycle; results above are with parity off.
- §2 success metric thresholds: <hit / missed; one-line discussion>.
```

Fill in the actual numbers from your captures.

- [ ] **Step 5: Commit**

```bash
git add src/tests/COALESCING_PERF.md
git commit -m "Record A.1 bench: <one-line summary like '−18% processInput, +14 solves @ 250ms'>"
```

---

## Task 11: Remove parity flag and legacy path

**Files:**
- Modify: `src/js/engine.js` — delete `applyRuleGroupLegacy`, `INCREMENTAL_PARITY`, and the wrapper logic. Promote `applyRuleGroupPruned` body into `applyRuleGroup`.

- [ ] **Step 1: Verify Task 10 numbers meet the spec's success thresholds**

Open the new section in `COALESCING_PERF.md`. If sim `processInput` Δ < −5% or solver Δ < +5 solves at 250ms, **stop**: the win didn't materialise. Investigate before deleting the legacy path. Don't blindly remove safety nets.

- [ ] **Step 2: Inline the pruned implementation as `applyRuleGroup`**

In `src/js/engine.js`:
1. Delete the wrapper `function applyRuleGroup(ruleGroup) { … }` defined in Task 7 Step 3.
2. Delete `function applyRuleGroupLegacy(ruleGroup) { … }`.
3. Delete the `const INCREMENTAL_PARITY = …;` declaration.
4. Rename `function applyRuleGroupPruned(ruleGroup) {` to `function applyRuleGroup(ruleGroup) {`.

- [ ] **Step 3: Final smoke**

Run:
```bash
node src/tests/run_tests_node.js --sim-only
node src/tests/run_solver_smoke_assert.js
```
Expected: both pass (same green baseline as Task 8 / Task 9).

- [ ] **Step 4: Commit**

```bash
git add src/js/engine.js
git commit -m "Remove A.1 parity flag and legacy applyRuleGroup

One CI cycle of parity-on runs confirmed the pruned path matches the
legacy path byte-for-byte across the sim suite and the solver corpus.
Promote applyRuleGroupPruned to applyRuleGroup; delete the wrapper
and the legacy fallback."
```

---

## Post-implementation checklist

After Task 11 lands:

- Confirm `node src/tests/run_tests_node.js --sim-only` reports the same pre-existing failure count as the baseline (one failure: `Voitex Rasteriser 2`), no new failures.
- Confirm `src/tests/COALESCING_PERF.md` has the A.1 entry.
- Confirm `src/tests/run_rule_read_write_masks_node.js` is wired into whatever scaffolding the repo uses for node test suites (check `Makefile` for `static_optimizer_page`-style targets — add a corresponding target if appropriate).
- Update `src/tests/JS_SOLVER_NEXT.md` E1 entry: A.1 has been implemented and partially cashes in the no-op slice; capture residual no-op fraction post-A.1 in the JS_SOLVER_NEXT.md status log.

The Phase A.2 plan is a separate document. Schedule its design pass once A.1 has been observed in CI for a cycle.
