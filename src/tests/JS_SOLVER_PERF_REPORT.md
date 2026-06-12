# JS Solver — performance forensics (post engine-pass)

Forensic profiling pass over `src/tests/run_solver_tests_js.js` on the full
`src/tests/solver_tests` corpus. Companion to `JS_SOLVER_NEXT.md` (whose
heuristic-shape conclusions stand — nothing here contradicts them; this report
is about *where the wall-clock actually goes* now that the engine has been
through a performance pass).

## Method

```
node src/tests/run_solver_tests_js.js src/tests/solver_tests \
    --timeout-ms 250 --quiet --json --no-solutions          # timing fields
PUZZLESCRIPT_SOLVER_DETAIL_TIMING=0 node --cpu-prof ... (same args)  # hot functions
```

1341 levels, default heuristic (`auto`), default strategy (`weighted-astar`).
Absolute numbers are from a cloud container that is slower than the machine
behind the historical numbers in `JS_SOLVER_NEXT.md` (36.5µs/step here vs
21.4µs/step there; 522 solved here vs ~615 there). Ratios, not absolutes, are
the signal.

## Headline: the engine pass is already a solver win

Same corpus, same timeout, identical solver code — only the engine/compiler
commits on this branch differ:

| | `ba313b5` (pre engine pass) | branch HEAD | delta |
|---|---|---|---|
| solved (250ms) | 484 | **522** | **+38** |
| step cost | 51.5µs/step | 36.5µs/step | −29% |
| states generated in budget | 3.86M | 4.91M | +27% |

Dose-response for sizing the items below: **~1 extra solve per ~0.8% of
search-time reduction** at the 250ms budget.

## Where the time goes (CPU profile, ~240s total)

Search-loop buckets (per-level JSON): `step_ms` 179s (79%), `heuristic_ms`
30.3s (13.4%), `clone_ms` 8.2s, `hash_ms` 3.5s, `snapshot_ms` 2.5s,
`queue_ms` 1.1s. Inside those, by self-time:

| function | s | bucket |
|---|---|---|
| generated matchers (`cellRowMatches` 30.4 + `matchCellRow` 25.1 + `ruleFindMatches` 16.4 + `cellPatternMatch` 5.6) | 77.5 | step: rule matching |
| `matchingDistanceField` | 15.7 | heuristic |
| `processCommandQueue` | 12.1 | step: turn epilogue |
| `calculateRowColMasks` | 10.5 | step: per-turn rebuild |
| `cellPatternReplace` + `ruleApplyAt` | 14.1 | step: rule application |
| `processInput` self | 8.6 | step |
| `resolveMovements` | 7.2 | step |
| **`backupLevel`** | **6.7** | step: undo bookkeeping |
| **`startMovement`** (mostly `getPlayerPositions` scan) | **6.7** | step |
| `winconditionDistanceHeuristic` self | 5.3 | heuristic |
| GC | 5.0 | — |
| `checkWin` | 4.5 | step |
| anonymous `timeBlock` wrappers | 3.8 | harness overhead |
| restore/capture/hash/visited (`restore` 3.1, `find` 2.4, zobrist 4.5, `capture` 2.0) | 12.0 | solver state ops |

Step mix (4.91M steps): **41.6% no-ops** (changed=false), 32.3% duplicates,
26.1% useful — consistent with the earlier profiling pass (38.3% no-ops).

## Ranked avenues

### 1. Make no-op steps cheap (E1, reframed) — ~31% of wall is no-op steps

The no-op slice is still the biggest number on the board (41.6% × 36.5µs ≈
75s/run). `JS_SOLVER_NEXT.md` correctly concluded that *skipping* steps via a
predicate is unsafe from the solver layer. The engine-side reframe: a no-op
step still pays a stack of full-grid O(n_tiles) passes — shave those, and the
no-op slice shrinks without any skip predicate. Concretely (all are engine
changes, gated on the full sim suite):

- **1a. Short-circuit the modified-compare.** `processCommandQueue` compares
  `level.objects` to the turn backup word-by-word; it breaks at the first
  diff, so it does a **full scan precisely on no-op turns** (~3.5s here, hot
  lines engine.js:3360-3361). Maintain a turn-level dirty flag (any rule
  applied ‖ any movement resolved ‖ command queue nonempty — all already
  known) and skip the compare when clean. Flag-false ⇒ provably identical, so
  semantics are exact; flag-true keeps the existing compare (A→B→A turns
  still report unmodified).
- **1b. Stop re-copying the level for undo.** `backupLevel()` (6.7s + GC)
  copies `level.objects` at every `processInput`, but in the solver the
  level was *just* `set()` from `snapshot.objects` — the backup duplicates
  bytes the solver already holds, and the engine undo stack is discarded by
  the next `restore()`. The backup is still semantically needed (cancel /
  `require_player_movement` paths call `DoUndo(bak)` mid-turn), so don't skip
  it — share it: let the solver hand `processInput` the snapshot's
  `Int32Array` (it is never mutated; `consolidateDiff` only reads `dat`), or
  add an engine-level "borrowed backup" hook.
- **1c. Direct word scans in `getPlayerPositions` and `checkWin`** (~8-10s
  combined). Both do per-tile `getCellInto` copies into a scratch BitVec and
  (in `checkWin`) call per-tile closures (`c => filter1.bitsSetInArray(c)`).
  The solver's own `matchesMask` shows the fast shape: read
  `level.objects[offset+word]` directly. `getPlayerPositions` runs ≥once per
  step; `checkWin` once per step. Mechanical, semantics-free.

Estimated stack: 12-18s (5-7%) of search time + GC relief, helping *all*
steps but no-ops proportionally most. A true skip-predicate (E1 classic)
remains possible afterwards but is high-risk/low-residual once no-ops are
cheap.

### 2. Cache static target distance fields (backlog A2) — biggest solver-side item

`winconditionDistanceHeuristic` rebuilds `matchingDistanceField(filter2, …)`
— two chamfer passes plus a full matchesMask pass — **per condition, per
node** (15.7s self), and its player-distance section rebuilds *filter1*
fields for every condition per node on top. But `filter2` of an ON condition
is almost always a static target object: no rule moves, creates, or destroys
it. The repo already has the machinery to prove this
(`createStaticHashObjectWords` classifies object words as static for the
hash; `inferStaticBlockerMask` does rule-effect scans): if every word of
`filter2Mask` is static, the distance field is a **level constant** —
compute it once in `createSolverLevelSpecialization` next to
`staticDeadCellsCache`.

Fallback when staticness can't be proven: collect the filter2 tile set (one
pass), compare against the cached set, and only re-run the two chamfer passes
when it changed. Estimated 10-15s (4-6%), and it makes every future
heuristic cheaper. This was backlog item A2; the profile says it is now the
single most valuable unimplemented item on that list.

### 3. `calculateRowColMasks` per step — 10.5s (4.4%)

Rebuilt from scratch at every `processInput` because the solver's `restore()`
invalidates the row/col/map occupancy masks. Options, in increasing effort:

- Fuse the rebuild into `restore()`: it already touches every `objects` word
  via `.set(snapshot.objects)`; a stride-specialized fused loop could OR the
  row/col/map masks while copying — one pass over the array instead of two.
  Realistic saving ~half (≈5s).
- Snapshot the masks in `capture()`: exact, but ~(w+h+1)×stride×4B per node
  (≈200B on a 20×20 level) across ~1.3M nodes ⇒ hundreds of MB. Only viable
  with copy-on-write sharing between parent/child nodes; probably not worth
  the complexity.

### 4. `timeBlock` wrapper overhead — 3.8s (1.6%) + GC

With `PUZZLESCRIPT_SOLVER_DETAIL_TIMING=0` the search loop still allocates
arrow closures (`() => stepSolverAction(action, modeResult)` etc.) for every
op of every action of every node — ~5M closures per run, visible as the
anonymous `run_solver_tests_js.js:2815` frame. When timing is disabled, call
the ops directly (two loop variants or hoisted wrappers). Mechanical; also
shrinks `clone_ms`/`queue_ms` attribution noise in future measurements.

### 5. Action-button pruning — bounded by 20%, second-order after #1

1/5 of generated steps are ACTION presses; in games where no rule can consume
them they are guaranteed no-ops. `JS_SOLVER_NEXT.md` rightly rejected the
naive "no rule mentions action" check (`moving` aggregates match the action
bit; engine runs all rules every turn). A sound version needs a rule scan
proving no LHS can match an action-annotated or `moving`-annotated
player-layer cell (and no command-only rules that fire regardless). Gate any
attempt on `--solver-opt-parity`. Note that once #1 lands, inert ACTION
steps are already cheap, so measure #1 first — this item may stop paying.

### 6. Incremental win/heuristic bookkeeping via the cell-write hook

`level.solverZobristUpdateCell` already intercepts **every** cell write in
the generated replace code. The same hook could maintain per-condition
satisfied/unsatisfied counters (or dirty bits per condition) incrementally,
making `checkWin` and `collectUnsatisfiedAllOnTiles`-style scans O(changed
cells) instead of O(n_tiles). Bigger refactor with correctness surface
(counter drift ⇒ wrong solves); only attempt with a verify mode mirroring
`PUZZLESCRIPT_VERIFY_ZOBRIST`. Sized ~5-10s.

## What *not* to do (hard-won negatives, do not relearn)

- Heuristic-shape work and portfolios: exhausted/regressive per
  `JS_SOLVER_NEXT.md` (C1, C1b, D1, D4, D7 all negative).
- Constant-specializing generated engine code: measured −10-12% twice on this
  branch (mask folding; CellPattern flat fields). Generic, source-shared
  codegen wins.
- `Map`-based visited / non-bucketed structures: the bucketed visited set and
  incremental Zobrist are healthy (~4% combined); leave them.

## Expected payoff

Items 1-4 stack to a plausible **12-17% search-time reduction** with no
search-behaviour change. At the observed dose-response (engine pass: −29%
step cost → +38 solves) that's roughly **+15-25 solves at 250ms**, and it
compounds with every future timeout/corpus increase. Item 2 additionally
lowers the marginal cost of any future heuristic work.

## Reproduce

```
# timing + counters
node src/tests/run_solver_tests_js.js src/tests/solver_tests --timeout-ms 250 --quiet --json --no-solutions > out.json

# hot functions (detail timing off so performance.now() doesn't distort)
PUZZLESCRIPT_SOLVER_DETAIL_TIMING=0 node --cpu-prof --cpu-prof-dir=prof \
  src/tests/run_solver_tests_js.js src/tests/solver_tests --timeout-ms 250 --quiet --json --no-solutions
```
