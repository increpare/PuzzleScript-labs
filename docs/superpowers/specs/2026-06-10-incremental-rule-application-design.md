# Incremental rule application

Status: design approved, pending implementation plan.
Date: 2026-06-10.
Branch context: `master`, pre-implementation. Assumes the in-flight Phase 5c-3
property-binding-with-direction-modifiers diff (`src/js/compiler.js`,
`src/js/engine.js`) lands before A.1 starts; the static `writeMask` derivation
in §3.1 depends on the `inferredPropertyBindings.dirMode/dirMask` fields it
adds.

## 1. Background

The hot path for both the editor and the solver is `processInput` →
`applyRules` → `applyRuleGroup` → `Rule.findMatches` → `matchCellRow`.

Two recent profiles agree on the shape:

- **Sim test suite** (469 games, `--breakdown`): wall 10.4s, of which
  `processInput` is 7.8s (22302 calls) and `compile` is 3.7s. The inner rule
  loop dominates run-time cost.
- **Solver corpus** (250ms portfolio+auto, full corpus,
  `src/tests/JS_SOLVER_NEXT.md` profiling pass): `step_ms` is **86.2%** of
  total solver time. 38.3% of `stepSolverAction` calls are engine-level
  no-ops (`changed=false`), accounting for ~33% of solver wall-time. The
  solver doc flagged this as the highest-EV remaining work but explicitly
  deferred it as an engine-internals problem rather than a solver-script
  one (`JS_SOLVER_NEXT.md` §E1).

`applyRuleGroup`'s fixpoint loop currently re-scans the whole board for every
rule on every iteration. Each rule already has a board-wide `ruleMask` that
gates `findMatches` via `mapCellContents` (line 2466), but there is **no
per-iteration mask** of what just changed — so a rule that cannot possibly fire
because its inputs haven't moved still pays for the bitvec test, the
cell-row prefilter, and (in many cases) a full row/column sweep.

The structural answer is to track what changed during each iteration and skip
rules whose read masks don't intersect the change. This is the classical RETE
/ TREAT discrimination-network idea, applied at the granularity PuzzleScript
already uses (per-rule bitvecs over object/movement layers, no per-cell
indexing).

The author's earlier rejection of a board-wide `ruleMask_movements` (engine.js
line 1481 comment) is on the record. That rejection is about *board-wide* OR'd
movement masks being saturated. **Per-iteration** changed-movement masks are
sparse — they contain only what the previous iteration's rule writes
produced, not every movement bit anywhere on the board.

## 2. Goals and non-goals

### Primary goal

Reduce `processInput` wall time by skipping rules in `applyRuleGroup`'s
fixpoint loop and rule groups in `applyRules`'s outer loop when static
read/write-mask analysis proves they cannot fire given what changed in the
previous iteration.

### Hard invariants

- Bit-identical post-`processInput` state vs the legacy path on every
  invocation. Enforced by a parity flag during rollout.
- No change to rule firing order, RNG consumption, or `again` / `restart` /
  `win` / `cancel` / `checkpoint` semantics.
- No change to the public `processInput(dir, dontDoWin, dontModify,
  skipAgainProbe)` signature or to anything the editor / `play.html` /
  `run_solver_tests_js.js` import.

### Success metrics

| Metric | Baseline | A.1 target | A.1+A.2 target |
| --- | ---: | ---: | ---: |
| Sim test suite `processInput` ms (`--breakdown`, 5-cold-run median) | 7790ms | ≤6500ms (−17%) | ≤5800ms (−25%) |
| Solver corpus solved @ 250ms timeout (1341 levels, default heuristic) | 618 | ≥630 (+12) | ≥640 (+22) |
| Solver corpus solved @ 5000ms timeout (default heuristic) | 897 | ≥907 (+10) | ≥915 (+18) |
| `--breakdown` `compile` ms (5-run median) | 3689ms | ≤3760ms (≤+2%) | ≤3780ms (≤+2.5%) |

Solver targets are deliberately less aggressive than "100% of the 33% no-op
slice" because A.1+A.2 do not skip `resolveMovements` on no-op inputs — they
only skip the rule loop. The full no-op early-out is deferred as A.3.

### Non-goals

- A.3 (engine-side `processInput` no-op early-out). Tracked as future work in
  §8. Decided post-A.2 based on measured residual no-op cost.
- Per-cell dirty tracking. Mask granularity is per object/movement layer,
  board-wide. Per-cell tracking is a separate, larger redesign and is not
  needed to capture the targeted wins.
- Compiler-pass perf work (the 35%-of-test-time `compile` slice). Out of
  scope; tracked separately if pursued.
- Changing the BitVec representation. The new masks reuse the existing
  `BitVec(STRIDE_OBJ)` / `BitVec(STRIDE_MOV)` types.

## 3. Architecture

### 3.1 Per-rule static masks (compiler.js)

Added to each compiled rule (alongside `ruleMask`, `cellRowMasks`, etc.):

- `readObjects: BitVec(STRIDE_OBJ)` — objects the LHS could match. Logically
  identical to today's `ruleMask`; renamed at the call site for symmetry. The
  field stored on the rule tuple stays `ruleMask` to avoid churning the
  compile output schema; `Rule.prototype.readObjects` is an alias.
- `readMovements: BitVec(STRIDE_MOV)` — movement-bit layers the LHS gates on.
  Derived per cell-row by OR'ing in:
  - The movement bits set by explicit direction modifiers on LHS terms
    (`> Player`, `moving Crate`, `stationary X`, `horizontal Block`, etc.).
  - For aggregate-direction LHS bindings, the full aggregate mask (per
    `aggregateMask` in `aggregateBindingsArr`).
  - For property-binding LHS sources whose layer carries movement, the
    layer's movement bits (looked up via `LAYER_COUPLED_MOVEMENT_DIRS`).
- `writeObjects: BitVec(STRIDE_OBJ)` — objects the RHS may add or remove.
  Derived per RHS cell by OR'ing in:
  - The layer bits of every `objects` / `replaceObjects` term on the RHS.
  - For property sinks (`propertySinks` map), the union of possible alias
    layers (already enumerated for coalescing analysis).
  - For aggregate sinks (`aggregateBindingsArr` RHS entries), the
    destination layer bits.
  - For `inferredPropertyBindings`, the captured alias's layer (looked up at
    compile time via the same machinery 5c-3 uses).
- `writeMovements: BitVec(STRIDE_MOV)` — movement-bit layers the RHS may
  overwrite. Derived from:
  - RHS direction modifiers (`> Crate`, `stationary X`, `randomdir Block`).
  - `inferredPropertyBindings.dirMode/dirMask` (5c-3).
  - Aggregate sinks' direction bits.
  - `random` and `randomdir` directions: union of all five direction bits
    on the affected layer.
- `forceAlwaysRun: bool` — true if the rule can't be soundly pruned. Set
  when any of:
  - `rule.isRandom` (random rule group; runtime selects which rule to fire).
  - Rule has a global-condition LHS (e.g. `[ no Player ]`-only rules where
    the absence relation is the *only* gate and we can't enumerate which
    layer's mutations break the absence — implementation lists the
    pattern shapes that trigger).
  - Rule has a command tail that mutates state outside the level grid
    (`again`, `restart`, `cancel`, `win`, `checkpoint`, `message`, sfx
    commands that affect again-state). Commands that only emit sounds /
    log text do not set this flag.
  - Static analysis encounters a shape it doesn't recognise. The
    classification function returns "unclassified → forceAlwaysRun=true" as
    the safe default. A debug counter (§5.3) tracks how often this branch
    fires.

The masks are computed in a new function `computeRuleReadWriteMasks(state,
rule)` invoked once per rule during `rulesToMask` (compiler.js around line
2901, alongside the existing mask construction). Output is folded into the
rule tuple as new slots; the engine reads them in the `Rule` constructor.

Static analysis testdata (`src/tests/static_analysis_testdata/`) gains a new
claim `rule_read_write_masks` recording the four mask bitvecs and the
`forceAlwaysRun` flag per rule, so the analysis is locked down against
future drift.

### 3.2 Per-iteration runtime masks (engine.js)

Two pairs of pre-allocated `BitVec`s held in `globalVariables.js`:

```
let _changedObjects_a = new BitVec(STRIDE_OBJ);
let _changedObjects_b = new BitVec(STRIDE_OBJ);
let _changedMovements_a = new BitVec(STRIDE_MOV);
let _changedMovements_b = new BitVec(STRIDE_MOV);
```

Pairs alternate by swap each fixpoint iteration: one buffer is "prior"
(read for prune decisions), the other is "next" (written by rules that
fire). They're cleared at the top of each iteration of `applyRuleGroup`'s
`while` loop, and reused — no per-iteration allocation.

### 3.3 BitVec.intersects

New method on the existing `BitVec` prototype:

```js
BitVec.prototype.intersects = function(other) {
    const data = this.data, otherData = other.data, n = data.length;
    for (let i = 0; i < n; i++) {
        if ((data[i] & otherData[i]) !== 0) return true;
    }
    return false;
};
```

Word-by-word with early exit. Cost equivalent to `bitsSetInArray` in the
common (intersects-fast) case.

### 3.4 Pruned `applyRuleGroup` (engine.js, ~line 2855)

```js
function applyRuleGroup(ruleGroup) {
    if (ruleGroup[0].isRandom) {
        return applyRandomRuleGroup(level, ruleGroup);  // unchanged
    }
    const MAX_LOOP_COUNT = 200;
    const GROUP_LENGTH = ruleGroup.length;
    let hasChanges = false;
    let madeChangeThisLoop = true;
    let loopcount = 0;

    // Two-buffer alternation: prior holds what changed last iteration,
    // next is being written this iteration. Iteration 0 uses the
    // immutable all-ones prior so no rule gets pruned on the first pass.
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
                // Pruned: rule cannot fire this iteration. Counts as a
                // failure so the all-rules-failed early-out still works.
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

        if (madeChangeThisLoop) hasChanges = true;

        // End-of-iteration rotation. The all-ones prior of iteration 0
        // gets dropped on the floor; from iteration 1 onward we alternate
        // between _changedObjects_a and _changedObjects_b. Same for movs.
        if (priorObjects === _allOnesObjects) {
            priorObjects = nextObjects;
            priorMovements = nextMovements;
            nextObjects = spareObjects;
            nextMovements = spareMovements;
            // spareObjects/spareMovements are now logically "the iter-0
            // prior's slot" — never read again, so we leave the names as-is.
            spareObjects = null;  // (defensive — not strictly necessary)
            spareMovements = null;
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

`_allOnesObjects`/`_allOnesMovements` are immutable all-ones bitvecs
allocated once and never written. The identity check
`priorObjects === _allOnesObjects` distinguishes "first iteration just
finished — discard the all-ones prior, only one real buffer is in flight
yet" from "standard two-buffer swap". The branch is taken at most once
per `applyRuleGroup` call so its cost is negligible.

### 3.5 Pruned `applyRules` (engine.js, ~line 2901)

Add `cumulativeChangedObjects`/`cumulativeChangedMovements` reset at the top
of `applyRules`. After each `applyRuleGroup` returns, OR the group's
final write mask (collected via a small `groupWriteObjects`/`groupWriteMovements`
out-parameter from `applyRuleGroup`) into the cumulative mask. On
loop-point returns (second-and-later passes through groups), gate each
group's invocation on `groupReadMask.intersects(cumulativeChanged)` —
groups that can't possibly fire get skipped. The cumulative mask resets
each time `applyRules` is entered fresh (so LATE-rule `applyRules` calls
and standard `applyRules` calls don't share state).

Per-group `groupReadObjects`/`groupReadMovements`/`groupWriteObjects`/
`groupWriteMovements` are the union of constituent rules' read/write
masks; computed once at compile time, attached to the rule group, no
runtime cost. Reads gate group invocation; writes seed the cumulative
mask carried across the loop-point cycle. If any constituent rule has
`forceAlwaysRun=true`, so does the group.

## 4. Phasing

### Phase A.1 — inner-loop only (this spec's first deliverable)

1. **Static masks in compiler.js.** Add `computeRuleReadWriteMasks`. Surface
   `readMovements`, `writeObjects`, `writeMovements`, `forceAlwaysRun` on
   the rule tuple. Add `rule_read_write_masks` static-analysis testdata
   claim.
2. **Runtime plumbing.** Pre-allocate the swap buffers and all-ones masks in
   `globalVariables.js`. Add `BitVec.prototype.intersects` and
   `BitVec.prototype.setZero` (the latter only if not already present).
3. **`applyRuleGroup` integration.** Replace the unconditional `tryApply`
   call with the gated form in §3.4. Behind the parity flag (§5.1) the
   legacy path runs in parallel and the post-state is compared.
4. **Bench + parity bake.** Sim test suite + solver smoke + solver corpus
   pass (250ms and 5s timeouts). Recorded under a new dated section in
   `src/tests/COALESCING_PERF.md`.
5. **Parity flag removal.** Once green, delete the legacy path inline in
   `applyRuleGroup`.

### Phase A.2 — outer loop (separate spec & plan once A.1 lands)

1. Add `groupReadObjects`/`groupReadMovements` at compile time. Add
   `groupWrites` out-parameter to `applyRuleGroup`.
2. Add `cumulativeChangedObjects/Movements` and inter-group prune in
   `applyRules`.
3. Verify LATE-rule `applyRules` invocations don't share cumulative state
   with the standard pass (they don't today, by construction; confirm
   rather than assume).
4. Bench + parity bake on top of merged A.1.

Phases ship independently. A.1 is the minimum coherent landing; A.2 is a
strict superset add-on.

## 5. Validation

### 5.1 Parity flag

`PUZZLESCRIPT_INCREMENTAL_PARITY=1` (Node) and a corresponding global flag
checked in `processInput` (browser editor convenience). When set:

- `processInput` clones `level.objects` and `level.movements` before
  calling `applyRules`.
- After `applyRules` returns, the incremental path's post-state is compared
  byte-for-byte against the legacy path's post-state.
- Mismatch: throw with the rule group index, rule index, and a serialised
  diff of the two `level.objects`/`level.movements` regions; do not
  continue. The intent is to fail loudly, not degrade gracefully.

The parity check covers `applyRules`'s output but **not** mid-iteration
state — partial-iteration parity would require running both paths
iteration-locked, which is more invasive than the bake is worth. Mid-state
divergence that converges by end-of-`applyRules` is observationally
indistinguishable from no-divergence anyway (rule firing order within an
iteration is fixed; convergence to identical state by iteration end
implies same firing sequence).

Parity is run in CI for one cycle:

- Sim test suite (`run_tests_node.js`) with parity on.
- Solver smoke (`run_solver_smoke_assert.js`) with parity on.
- A full-corpus solver run at 250ms with parity on (single overnight run).

If all three pass, the flag and the legacy code path are removed in the
next commit.

### 5.2 Static-analysis testdata

`src/tests/static_analysis_testdata/` gains a `rule_read_write_masks` claim
per game. The claim records (per rule):
`{ readObjects: <hex>, readMovements: <hex>, writeObjects: <hex>,
   writeMovements: <hex>, forceAlwaysRun: bool, reason?: string }`.

The `reason` field is populated only when `forceAlwaysRun` is true (e.g.
`"isRandom"`, `"global-no-pattern"`, `"command:again"`, `"unclassified"`).
This makes the next iteration of the static-analysis tooling — and any
future engineer touching this code — able to see at a glance why a rule
got the safe-default classification.

### 5.3 Runtime instrumentation (debug-build only)

A counter struct, gated by `PUZZLESCRIPT_INCREMENTAL_DEBUG=1`:

```
{
    rule_invocations_total,
    rule_invocations_pruned_by_obj,
    rule_invocations_pruned_by_mov,
    rule_invocations_pruned_by_both,
    rule_invocations_pruned_by_either,
    rule_invocations_force_always_run,
    rule_invocations_not_pruned,
    rule_invocations_fired,
}
```

Logged once per game on test exit. Two purposes:
- Validates the author's old movement-mask saturation concern is or isn't
  a problem here (compare `pruned_by_obj`-only vs `pruned_by_mov`-only).
- Surfaces over-broad `forceAlwaysRun` classification (high
  `force_always_run` relative to `total` indicates the static analysis
  needs tightening).

Counter struct removed (or compile-gated to zero overhead) once both
metrics are confirmed healthy on the corpus.

## 6. Performance hypothesis & measurement

### 6.1 Hypothesis (why this works)

PuzzleScript fixpoint loops run for 1–dozens of iterations. The first
iteration is unavoidable (any rule could fire). Subsequent iterations
re-scan the whole rule list. Across the sim test corpus, most rules in
most groups don't fire most iterations — empirically the
`consecutiveFailures === GROUP_LENGTH` early-out (engine.js:2879) shows
this is already a cost the engine is paying to prove.

With per-iteration prior masks, each subsequent-iteration rule check
becomes:
- `forceAlwaysRun` early-out: branch.
- Two `BitVec.intersects` calls: a handful of word-ANDs each, early exit
  on first nonzero.

Cost vs the existing `findMatches`:
- `findMatches` already has the
  `this.ruleMask.bitsSetInArray(level.mapCellContents.data)` board-wide
  prefilter — but that operates on the *whole map*, not on the
  per-iteration change set, so it admits any rule whose objects exist
  anywhere on the board even if nothing relevant changed.
- The new mask check is strictly cheaper (smaller iterator domain, same
  word-AND op) and gates earlier.

### 6.2 Measurement plan

Two paired runs (baseline = `master` at A.1 start, after = A.1 landed).
All numbers go into a new dated section in `src/tests/COALESCING_PERF.md`.

| Suite | Command | Sample |
| --- | --- | --- |
| Sim tests | `node src/tests/run_tests_node.js --profile --sim-only` (5 cold runs) | median wall, median `processInput` ms |
| Sim breakdown | `node src/tests/run_tests_node.js --breakdown --sim-only` | per-bucket ms, call counts |
| Solver smoke | `node src/tests/run_solver_smoke_assert.js` | pass/fail, wall |
| Solver focus 500ms | `run_solver_tests_js.js src/tests/solver_tests --solver-focus-manifest solver_focus_group.json --timeout-ms 500 --strategy portfolio --quiet --json --no-solutions` | solved, elapsed, step_ms, expanded, generated |
| Solver focus 2000ms | same with `solver_focus_long_group.json` and `--timeout-ms 2000` | same |
| Solver full 250ms | `run_solver_tests_js.js src/tests/solver_tests --timeout-ms 250 --quiet --json --no-solutions` | solved out of 1341 |
| Solver full 5000ms | same with `--timeout-ms 5000` | solved out of 1341 |

The two solver-full runs are the headline numbers for the §2 success
metrics table.

### 6.3 Compile-time budget

The new `computeRuleReadWriteMasks` and the per-rule mask BitVecs add
work to compile. Budget: ≤+2% on `compile` ms in the `--breakdown` output
on the sim test corpus. If the actual measurement exceeds this, the
analysis is too eager (likely a quadratic scan that needs hoisting) and
must be tightened before merge.

## 7. Risks and mitigations

### 7.1 Over-broad `forceAlwaysRun` classification

If too many rules get the safe-default flag, the pruning win evaporates
without a clear signal. Mitigation:
- §5.3's `force_always_run` counter, logged once per game.
- Coverage assertion in CI: if the corpus-median fraction of
  `force_always_run` rules exceeds 30% of total rules, the build fails.
  This catches accidental broadening (e.g. someone adding a command tail
  that doesn't actually mutate cross-iteration state).

### 7.2 NO-pattern soundness

Rules like `[ no Player ] -> [ Crab ]` gate on absence. Reasoning:
`readObjects` for such a rule includes the layer Player lives on (because
the pattern references Player at all). If nothing on that layer changed
this iteration, the absence relation didn't change either — sound.
Mitigation: add a targeted test fixture in
`src/tests/static_analysis_testdata/` with several NO-pattern shapes
(`[no X]`, `[no X] [Y] -> ...`, `[X | no Y] -> ...`) verifying their
read masks are computed correctly and that the parity flag is green on
them.

### 7.3 Random rules and global patterns

Both classified `forceAlwaysRun`. Mitigation: the
`run_solver_tests_js.js` corpus contains games with random rules
(probabilistic gen levels, dollyban-family randomized levels); parity
runs catch any incorrect classification at the solver-state level.

### 7.4 Movement-mask saturation

The author's prior negative result on board-wide movement masks
(engine.js:1481) is on record. §5.3's `pruned_by_obj`/`pruned_by_mov`
counters validate the per-iteration version doesn't degenerate. If
`pruned_by_mov` alone is consistently below 1% of total invocations
across the corpus, the `readMovements` field doesn't pay for itself —
back out of the movement-tracking half of the design and ship with
objects-only pruning. (Anticipated to pay, but pre-committed to backing
out cleanly if not.)

### 7.5 Coalescing interaction

Recent coalescing work (the `db04af10` chain) folds multiple source rules
into single coalesced rules. The coalesced rule's `writeObjects` /
`writeMovements` must be the union over constituents; the coalescing
infrastructure already tracks the union for other purposes (e.g.
`propertySinks`). Mitigation: cross-test by toggling coalescing off
(if a flag exists) and confirming parity on both modes.

### 7.6 5c-3 in-flight diff

The uncommitted compiler/engine diff in the working tree adds
`inferredPropertyBindings.dirMode` / `dirMask` which `writeMovements`
must consult. Mitigation: A.1 implementation does not start until 5c-3
lands and is committed to `master`. The spec assumes that order.

### 7.7 Order-sensitivity inside rule groups

A subtle hazard: pruning a rule whose read mask is disjoint from changes
is sound iff `tryApply` is a pure function of `level.objects` /
`level.movements`. Today it is — `tryApply` reads only level state and
the rule's own static data. Mitigation: any new state read added to
`tryApply` (e.g. a per-rule scratch field that mutates across iterations)
must be reflected in the read masks. Documented at the call site so the
next person extending `Rule.prototype.tryApply` sees the constraint.

## 8. Future work (out of scope)

- **A.3 — engine-side `processInput` no-op early-out.** On top of A.1+A.2,
  classify "input cannot affect any rule" before calling `applyRules` /
  `resolveMovements` at all. Captures the residual portion of the
  solver-doc E1 slice (33% of solver wall-time) that A.1+A.2 don't
  recover (chiefly the `resolveMovements` post-pass on no-op inputs).
  Trigger: measure A.1+A.2 vs the no-op slice; if residual is >10% of
  solver wall-time, scope A.3.
- **Per-cell dirty tracking.** A redesign where the per-iteration
  change set is per-cell, not per-layer. Larger memory cost and a
  different `matchCellRow` integration. Considered only if the per-layer
  design hits a clear ceiling.
- **Compile-time perf pass.** `compile` is 35% of sim-test wall time;
  separate spec if pursued.
- **Solver-mechanics tweaks.** IDA*, copy-on-write level clone, bit-packed
  visited set. Tracked in `src/tests/JS_SOLVER_NEXT.md`; expected gain
  bounded by solver-doc profile (≤4% clone+hash+queue combined).

## 9. Rollout

1. Land Phase 5c-3 from the working tree (separate commit; pre-requisite).
2. Spec → plan A.1 → implement A.1 behind parity flag → bake one CI
   cycle → remove parity flag and legacy path.
3. Measure A.1 alone against §2 success metrics; record in
   `src/tests/COALESCING_PERF.md`.
4. Spec → plan A.2 → implement on top → bake → remove parity flag.
5. Measure A.1+A.2 vs §2 success metrics and vs the solver E1 slice;
   decide A.3 scoping based on the residual.
