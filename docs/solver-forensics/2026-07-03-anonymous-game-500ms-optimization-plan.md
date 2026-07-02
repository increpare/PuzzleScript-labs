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
