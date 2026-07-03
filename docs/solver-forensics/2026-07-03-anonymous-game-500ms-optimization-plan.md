# Solver 500ms Optimization Plan — handoff

Review of `docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md`.
Written 2026-07-03 as a handoff plan: diagnosis, prioritized hypotheses, and a
first-week experiment sequence. All claims cite the artifact, report section, or
code path that supports them. Facts and inferences are labeled.

Objective: maximize solve count under a 500ms timeout, JS-first (easiest to
prototype), with C++ interpreted/compiled solvers as calibration and eventual
production paths.

## Context for a cold start

- Report: `docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md`
- Artifacts: `build/solver-forensics/anonymous-js-first-500ms/` (summary.json,
  level-triage.csv, per-run JSONs, `historical/`, and the game source under
  `input-corpus/`)
- JS solver harness: `src/tests/run_solver_tests_js.js` (defaults:
  `weighted-astar`, heuristic `auto`, input specialization ON —
  `PUZZLESCRIPT_INPUT_SPECIALIZATION=0` disables, see line ~9)
- Engine hot path: `src/js/engine.js`
- Static solver optimizations (built, off by default): `src/tests/solver_static_opt.js`,
  enabled via `--solver-opt inert,cosmetic,cosmetic-rules,merge,action|all` and
  verified via `--solver-opt-parity`
- Prior solver work log (read TL;DR first): `src/tests/JS_SOLVER_NEXT.md`
- Sim regression suite: `node src/tests/run_tests_node.js` (469 fixtures; run from repo root)

## Diagnosis

The game (see `input-corpus/ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt`)
is a snakebird-style puzzle: 251 objects, **82 collision layers**, 551 rule lines
(48 gated on a one-shot `start` object, 91 `late`, 11 `again`, 3 `random`),
`run_rules_on_level_start`, `noaction`, large levels (median ~506 cells, max 2385),
win = `all Player on Goal` + `no Blood`. Known solutions are 10–106 moves
(historical HDA-compiled JSON: level 3 = 106 moves / 4857 expanded; level 19 =
43 / 163k; level 31 = 27 / 70k; level 63 = 20 / 14k; level 81 = 10 / 53).

**Fact — per-step cost is the outlier, ~90x.** `us_per_generated` (summary.json):
JS 2115µs on this game vs 22.8µs corpus JS average; native interpreted 717µs;
native compiled 62–77µs. At 500ms JS expands only 60–126 nodes/level
(level-triage.csv) — far too few for 20–106-move solutions regardless of
heuristic. Level 81 (10 moves, 10 expansions) is the only JS solve.

**Fact — the cost is in the rule loop, mostly matching** (js-step-profile.json):
early rules 21.4s vs late 4.3s vs movement 0.23s; rule_match 16.1s vs
rule_apply 6.5s. Heuristic + clone + hash + queue together are <4% of budget.

**Inference — three compounding mechanisms in `src/js/engine.js`:**

1. **Wide bitvec strides.** `STRIDE_OBJ = ceil(251/32) = 8` words,
   `STRIDE_MOV = ceil(82/5) = 17` words (`src/js/compiler.js:81-82`). Every cell
   test / mask intersection / row-col-mask check pays ~10x over a typical
   1–2-word game.
2. **Fixpoint rescans over big grids.** `applyRuleGroup` loops each group to
   fixpoint (`engine.js:3082-3130`); the game is full of chain-propagation rules
   (`[ Moveable no break | blockedD ] -> [ Moveable blockedD | blockedD ]`,
   vertebra-follow). Each fixpoint iteration re-runs `findMatches` →
   `matchCellRow` full row/col scans (`engine.js:2397-2431`). Propagating along a
   snake of length L costs O(L × grid-scan).
3. **The existing incremental prune is inert exactly where needed.** The
   inner-loop skip requires `rule.readMovements.iszero()`
   (`engine.js:3092-3095`). During the movement phase nearly every rule reads
   movements, so almost nothing is pruned. Note `priorMovements` is computed and
   swapped but never consulted in the guard.

Also unmeasured: `settleAgain` (`run_solver_tests_js.js:2901-2908`) reruns the
full pipeline per `again` pass; the dart rules (`[ DartU ] -> [ up DartU ] again`)
may multiply per-step cost.

**Fact — the game is also search-hard; runtime alone caps out low here.**
Native compiled (~30x faster than JS) solves 2/54 at 500ms and 5/54 at 30s with
8 threads (summary.json). Perfect JS-to-native-compiled parity would gain
roughly +0 to +1 level at 500ms on this game.

**Inference — the corpus is where the same work pays.** Corpus at 500ms
(historical): JS 710 → C++ interp 842 → C++ compiled 917 → HDA compiled 1003
(of 1346 playable). JS→interp (~130 solves) is raw throughput at identical
semantics; interp→compiled (~75 more) is rule compilation. That is ~200 levels
of corpus headroom from runtime work vs ~1 on this game. **Treat this game as a
worst-case canary for step-cost mechanisms, not the optimization target.**

**Triage caveat:** `js_missed_native_solved` only counts native solves ≤500ms
(`src/tests/build_solver_forensics_report.js:208-212`), so levels 19/31/63
(native-solved at 0.6–5s) are lumped into `high_step_cost_timeout`. True
"native proves solvable" count is 5, not 1. Consider fixing the triage label.

## Prioritized hypotheses

**P1. Run existing solver-scoped static opts on this game (measure, then default-on).**
The cosmetic pass deletes objects *and collision layers* (telemetry field
`removed_collision_layers`), shrinking both strides. Decoration overlays
(GroundCorner/GroundEdge "W" variants, `bluedot`) look strippable; `WaterCorner*`
is load-bearing (current-redirection rules read it). Difficulty: zero — already
built with a parity mode. Risk: low with `--solver-opt-parity`. Watch the
random-rule gating (3 `random` rules; `solver_static_opt.js:653,760` gates
per-rule, but the analyzer may scope more broadly). JS first; feed the same pass
output to the native interpreter.

**P2. Movement-aware inner-loop prune (`engine.js:3092`).**
Extend the guard: skip a rule when its `readMovements` don't intersect
`priorMovements` AND `readObjects` don't intersect `priorObjects`. Write-mask
plumbing already exists. Expected: biggest single win on this game (kills
redundant fixpoint rescans); corpus neutral-to-positive. **Soundness risk is the
real work:** clears must count as writes (a rule matching `stationary X` or
`no Y` is enabled by removal), so `writeMovements`/`writeObjects` must cover
cleared bits and stationary-requirements must appear in `readMovements`.
Prototype in JS behind an env flag; port to native interp if it holds. Validate
with all 469 sim fixtures + paired solver compare.

**P3. Per-game adaptive strategy selection in the harness.**
If measured step cost is high (e.g. >200µs after a few probe steps), breadth is
unaffordable — switch weighted-astar (w=2) to greedy/high-weight for depth.
Trivial change in `run_solver_tests_js.js` mode selection (~3350-3500). Safe for
the solve-count metric if benchmarked. Small but real expected gain.

**P4. JS "compiled rules" mode (close the interp→compiled 10x).**
Native compiled gets 717→62µs on this game. JS codegens matchers already
(`generateMatchCellRow`, lazy match functions) but with generic stride loops and
generic group machinery. Per-game codegen: dead-word elimination in masks, fused
match+apply for single-cell rules, unrolled group loops. Biggest corpus lever
(~75-level scale) but high effort; design-doc first, don't start this week.

**P5. Stride/object compaction independent of cosmetic analysis.**
Renumber objects so rule-referenced ones occupy dense low words; drop
never-instantiated objects; pack movement layers actually used by movers.
Needs only reachability, not cosmetic proofs. Potentially 8+17 words → a few on
this game. Medium difficulty (`compiler.js` layer/mask assignment), parity-checkable.

**P6. Again-settling reduction — measurement-gated.** If X3 shows calls/step
≥ ~1.5x, consider an engine fast path rerunning only `again`-relevant groups.
High semantic risk; do not build before measuring.

**Not priorities:** heuristic tuning for this game (2% of time; X4 tests whether
JS search order is even deficient — JS_SOLVER_NEXT documents the heuristic space
as largely exhausted), hash/visited/clone/queue work (<2% combined).

## Experiments (run in this order)

**X1 — static-opt probe on this game** (~30 min):
```
node src/tests/run_solver_tests_js.js <dir-with-this-game> \
  --timeout-ms 500 --solver-opt all --solver-opt-parity --json
```
Success: `us_per_generated` ≥2x lower, `removed_cosmetic_objects` /
`removed_collision_layers` > 0, parity clean. If telemetry shows the pass gated
by random rules, the finding becomes "extend cosmetic scoping to per-object
random sinks" — itself a candidate patch.

**X2 — per-rule hot-spot counters** (~2h to instrument, seconds to run):
Env-gated counters in `applyRuleGroup`/`tryApply`: tryApply calls per rule,
fixpoint iterations per group per turn, matches surviving mask prunes. Run
`--game … --level 13`. Success: a top-10 rule list explaining ≥60% of match
time. Decides P2 vs dirty-region matching vs "uniform cost" (favoring P4/P5).

**X3 — again multiplier** (~15 min): count `processInput` calls per
`stepSolverAction` across 3 levels. ≥2 → P6 interesting; ~1.1 → drop P6.

**X4 — guidance-parity check, levels 3/63/31/19** (~10 min runtime):
JS with `--timeout-ms 120000 --level 3`; record `expanded` at solve. If JS
expanded ≤ ~2x native-compiled expanded (4857 for level 3), the JS gap is pure
throughput → P2/P4/P5 correctly targeted. If 10x, JS search order is also
deficient → heuristic work re-enters scope.

**X5 — P2 prototype bench** (~0.5 day): env-flagged guard extension; validate
`node src/tests/run_tests_node.js` (all fixtures), then paired run on
`src/tests/solver_tests` at 250ms (follow the
`input_specialization_solver_compare_node.js` pattern). Success: solves
flat-or-up, `step_ms` down, zero trace divergence. Any divergence = missed
read/write-mask case; fix or abandon.

**X6 — stride-usage audit** (~0.5 day, zero risk): static script over the
corpus reporting mask words actually touchable per game. Sizes the P5 prize
before implementation.

**X7 — refresh corpus JS baseline at 500ms**: the report's corpus rows are
historical; refresh before claiming any corpus win.

## First-week plan

1. **Day 1:** X1 + X3 + X4 — three cheap probes that decide everything downstream.
2. **Day 1–2:** X2 instrumentation; top rules/groups burning match time on level 13.
3. **Day 2–4:** P2 prototype behind env flag; X5 validation + 250ms corpus paired bench.
4. **Day 4–5:** P3 adaptive strategy + X7 corpus 500ms refresh; land whichever of
   P2/P3 benched positive.
5. **Parallel, low-effort:** X6 stride audit to size P5; write a design note for
   P4 (codegen) but do not start it.

## Do not do yet

- **Occupancy-based no-op skip predicates** — directly falsified: the probe's
  blocked predicate fired on 100% of steps (probe_blocked = probe_dir_steps =
  11993) while 84% of those actually changed state (probe_blocked_changed =
  10123; js-noop-probe.json). Corpus no-op share is 37%, so a *sound*
  engine-level early-out remains attractive — but via rule-set reachability,
  not geometric occupancy.
- **Heuristic tuning for this game** — 0.5s of 26s; wait for X4.
- **Macro-moves / partial-order reduction** — snake-body state changes every
  move; no soundness story, no detector.
- **Pattern databases / abstraction heuristics** — build cost can't amortize
  inside 500ms.
- **WASM / typed-array bitvec rewrites** — premature before X6 shows compaction
  (which shrinks the same loops) is insufficient.
- **Hand-editing this game's rules** (e.g. the 48 `start`-gated decoration
  rules) — already O(1)-pruned per step by the `ruleMask` check
  (`engine.js:2589`) once `start` is gone; near-zero win.
- **Regression claims against historical compiled/corpus artifacts** — the
  report flags them stale; refresh first (X7).
- **Treating this game's 500ms number as the success metric** — even the best
  native configuration reaches 2/54; corpus solve count is the honest target,
  with this game as the step-cost canary.

## Native C++ interpreter review (added 2026-07-03)

The interpreter (`native/src/runtime/core.cpp`, ~7.6k lines) is the practical
production path: game-agnostic, no per-game codegen/compile latency. It is
already sophisticated — 64-bit mask words (object stride 4 / movement stride 9
for this game vs 8/17 in JS), a mask arena, per-object cell bitboards with
incremental maintenance (`objectCellBits` via `setObjectCellIndexBit`,
core.cpp:2291), rarest-anchor scans, dirty-row/col mask rebuilds, runtime
counters (`ps_runtime_counters_*`), input specialization (`activeInputsMask`),
and specialized codegen backends as an optional fast tier. On this game it runs
717µs/step vs compiled 62–77µs — a 10x gap that the items below attack without
giving up game-agnosticism. Facts below are from code inspection; impact
estimates are inferences pending the counter experiments (NX1).

### Observed hot-path issues (facts, with code refs)

- **F1 — `rebuildMasks` after every successful rule application.**
  `applyRuleGroup` calls `rebuildMasks(session)` at group entry and after each
  apply (core.cpp:5087, 5158). Rebuild is dirty-line-tracked (5300-5520), but
  any *cleared* bit dirties the cell's whole row + column + board
  (`setCellObjectsFromWords`, 2333-2362), and rebuilding a dirty line re-ORs
  width×strideObject (and movement equivalents). On propagation-chain games
  (this one: `blocked`/vertebra chains) this runs at fixpoint frequency —
  O(chain × line-rescan). Counters exist to quantify: `maskRebuildCalls`,
  `maskRebuildDirtyCalls`, `maskRebuildRows/Columns`.
- **F2 — movement-anchor selection does full-grid scans and heap allocation
  per call.** `chooseMovementRowAnchor` (3755-3802) allocates a `MaskVector`
  per pattern per call and ORs together masks that are **state-independent**
  (pattern movementsPresent + any + layer-coupled), then `movementOverlapCount`
  (3721-3741) scans all tiles × strideMovement just to *count* selectivity.
  The movement-anchored iteration itself also walks every tile
  (3837-3846) rather than only moving tiles.
- **F3 — incremental prune is movement-blind, same as JS.** The guard
  (5108-5128) skips a rule only when `readMovementsZero &&
  !readObjectsOverlapPrior`. `incrementalPriorMovements` is accumulated and
  swapped (5152-5179) but never consulted. Identical shape to
  `src/js/engine.js:3092` — the plan's P2 applies to both engines and should
  land in both, cross-checked by the existing JS/native parity harness.
- **F4 — per-cell match loops over all stride words.** `matchesPatternAt`
  (always_inline) loops `objectWordCount` (4 here) and `movementWordCount`
  (9 here) words per present/missing/any check, though a given pattern mask is
  typically nonzero in one word.
- **F5 — multi-row rules allocate per tryApply.** The single-row path uses
  `session.scratch.singleRowMatchScratch` (4526), but the multi-row path
  builds `std::vector<std::vector<RowMatch>>` + per-row vectors returned by
  value (4620-4649). This game's 48 `[ start ] [ … ]` rules and the
  `[ HeadX edgeX ] [ > Player ]` family hit the allocating path. Consistent
  with the HDA profiling memory: **malloc ≈23% of time, cross-thread frees
  limit HDA to ~45% scaling at 8 threads** (buffer-pool PR recovered only
  ~2-4%). The fresh single-game data agrees: HDA x8 interpreter reports
  1020µs/generated vs portfolio's 717µs (summary.json).
- **F6 — board layout is cell-major, column-major** (`tileIndex = x*height+y`);
  horizontal line scans stride by `height × words`. Rows of a 61-wide level
  touch 61 scattered 104-byte cell records.
- Good news already in place: `ruleCanPossiblyMatch` checks both board object
  and movement masks (4439-4454); object anchors use O(1)
  `objectCellCounts`; solver deadline checks are partially batched
  (solver/main.cpp:3170 comment), compact node storage
  (`PersistentLevelState`) and Zobrist hashing exist.

### Native proposals, prioritized

- **N1 — moving-tiles bitboard (low-level, likely largest single win).**
  Maintain a tile bitboard "any movement bits set" updated in
  `setCellMovements`, exactly analogous to `objectCellBits`. Then:
  movement-anchor selectivity = popcount (kills `movementOverlapCount` grid
  scans), and movement-anchored iteration walks set bits via ctz instead of
  all tiles (3837). Most turns have few movers and movement rules are the
  hottest class. Localized, low risk; validate with parity + sim suites.
- **N2 — hoist static movement-anchor masks to lowering time (trivial).**
  The per-pattern movement union in `chooseMovementRowAnchor` is
  state-independent; precompute into `maskArena` at lowering, deleting the
  per-call alloc + OR-building. Zero semantic risk.
- **N3 — movement-aware incremental prune (= plan P2, both engines).**
  Consult `incrementalPriorMovements` in the guard. Soundness caveats shared
  with JS: clears must be covered by write masks; stationary/`no X`
  requirements must be covered by read masks. Land JS+native together and
  lean on the parity harness.
- **N4 — cheapen or defer `rebuildMasks`.** Options, in rising ambition:
  (a) rebuild once per fixpoint iteration instead of per application (audit
  which same-iteration reads need freshness); (b) rebuild-on-read — only
  rebuild a dirty line when a match actually consults it; (c) per-line
  per-object-bit reference counts enabling O(changed-bits) decremental
  updates (memory ≈ (height+width) × objectCount × 2B — tens of KB, fine).
  Gate on F1 counter numbers first.
- **N5 — sparse word iteration in `matchesPatternAt`.** Precompute per-mask
  nonzero-word spans (first/last word or tiny word-id list); loop only those.
  Near-free for stride-1 games, ~4-9x fewer word ops here. Also order pattern
  checks by measured selectivity (missing checks are usually cheaper to fail).
- **N6 — allocator work for the solver/HDA (metal).** Link mimalloc (or
  jemalloc) and measure — cross-thread-free contention is its home turf; then
  per-thread arenas/freelists for node `FullState`/`PersistentLevelState` if
  needed. Scratch-ify the multi-row match vectors (F5) like
  `singleRowMatchScratch`. Directly targets the measured 23% malloc + HDA
  scaling ceiling.
- **N7 — word-plane (SoA) board layout experiment (representation).** Store
  objects as per-word planes (all tiles' word w contiguous). Pattern checks
  touch only planes with nonzero masks → wide-stride games degrade to
  ~stride-1 cost; `rebuildMasks` becomes long vectorizable runs. Bigger
  refactor; prototype behind a compile-time flag like
  `PS_INTERPRETER_OBJECT_CELL_INDEX` and let counters decide. Partially
  overlaps N5 — do N5 first, it's 10x cheaper to build.
- **N8 — feed solver-scoped static opts into the native compile (high-level).**
  The JS passes (`src/tests/solver_static_opt.js`: inert/cosmetic/merge)
  shrink object count, **collision layers** (→ both strides), and rule count.
  Native compiles from source, so a source-to-source emit (or shared IR)
  serves interpreter and codegen tiers alike. Check `native/src/simplify`
  and `src/search/simplify.*` for existing scaffolding before building new.
- **N9 — group dependency static analysis (high-level).** (a) Groups whose
  writes cannot feed their own reads need no confirm pass: currently even a
  single-fire group re-matches every rule once more to detect quiescence —
  provable single-pass groups halve their match work. (b) The JS "A.2
  outer-loop group skip" (wired, disabled; `engine.js:3154-3156`) has the same
  native analog via cumulative changed masks — making it sound once benefits
  both engines.
- **N10 — solver-level hygiene.** Compact node storage default-on where
  parity-clean; finish deadline-check batching (clock was 14% in the HDA
  profile); keep detail timing off in production runs.

### Native experiments

- **NX1 — counter attribution run** (~1h): enable `ps_runtime_counters`, run
  this game + a ~50-game corpus slice, dump `maskRebuildCalls/Rows`,
  `candidateCellsTested`, `patternTests`, `rulesVisited/SkippedByMask`,
  `specializedRulegroup*`. Success: a ranked cost attribution that picks
  between N1/N4/N5/N7. This is the native analog of X2 and should precede any
  build-out.
- **NX2 — mimalloc link test** (~1h): relink solver with mimalloc, rerun HDA
  x8 on this game + corpus slice. Success: HDA step_ms drops materially
  (target: close part of the 45%→linear scaling gap). Failure: contention is
  not allocator-internal → invest in arenas (N6b) instead.
- **NX3 — N2 + N1 prototype** (~1 day): static anchor masks + moving-tiles
  bitboard behind a flag; parity suite + `us_per_generated` on this game and
  corpus slice. Expect this game to improve most (movement-heavy, big grids);
  corpus-neutral is acceptable, corpus-negative is not.
- **NX4 — N3 (P2) paired JS/native landing** (~1-2 days): same experiment
  design as X5, plus native parity run.

Sequencing note: NX1/NX2 slot into the existing week plan as Day-1/2 probes
alongside X1-X4; N1/N2/N3 are the first-build tier; N4-N9 wait for counter
evidence.

## Key numbers (for quick reference)

| Measure | Value | Source |
| --- | --- | --- |
| JS us/generated, this game | 2115µs | summary.json |
| Corpus JS us/generated | 22.8µs | summary.json (corpus historical) |
| Native interp / compiled us/generated | 717µs / 62–77µs | summary.json |
| JS expansions per level @500ms | 60–126 | level-triage.csv |
| Step profile | match 16.1s, apply 6.5s, movement 0.23s | js-step-profile.json |
| Early vs late rules | 21.4s vs 4.3s | js-step-profile.json |
| Corpus @500ms: JS / interp / compiled / HDA-compiled | 710 / 842 / 917 / 1003 of 1346 | summary.json (historical) |
| This game @500ms best (HDA x8 compiled, 30s budget run) | 2/54 (5 total @30s) | summary.json (historical) |
| Native-proved solvable levels + solution lengths | 3:106, 19:43, 31:27, 63:20, 81:10 | historical/single-game-cpp-hda-8-compiled-30000ms.json |
