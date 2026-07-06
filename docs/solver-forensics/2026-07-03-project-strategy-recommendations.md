# Project Strategy Recommendations

Written 2026-07-03, after a wide review pass: JS engine/solver, C++
interpreter, static analyzer, search heuristics, forensics tooling — plus the
first execution round of the JS plan (X1-X6). This is the top-level document:
strategic recommendations for the project as a whole, an index of the plan
set, and the cross-plan dependency graph. If the plan files are append-only
history, this file is the one to keep current.

## 0. Status snapshot (what changed today)

The JS plan's experiments were executed
(`2026-07-03-anonymous-game-500ms-experiment-results.md`). Outcomes that
reshape strategy:

- **X1** static opts: parity-clean, removed 108 inert rules / 15 objects /
  6 layers — and moved *nothing* on the hard game (step_ms unchanged,
  solves unchanged). Mask pruning already made dead rules cheap.
- **X2** hotspots are diffuse — no dominant rule. Uniform-cost explanations
  (stride width, codegen, representation) remain live; spot fixes don't.
- **X3** `again` multiplier ≈ 0 (2 passes / 12k steps). P6 is dead.
- **X4** JS guidance is on par with native (level 3: 4490 expansions vs
  native's 4857). The JS gap on this game is **pure throughput**.
- **X5** movement-aware prune **rejected**: Karamell fixture failure + 47
  corpus regressions. The runtime read/write masks genuinely lack the
  precision for this class of optimization.
- **X6** adaptive strategy: 706 → 703 at 500ms — *inside the documented
  noise band*. Kept as opt-in probe only.

Net: the tactical quick-win tier of the JS plan is exhausted or falsified.
What remains live: native runtime work (N-series, untested), certified-fact
work (S-series), and structurally different search (T-series).

## 1. Recommendation: fix the measurement foundation first

**The binding constraint on every plan in this directory is measurement
trust, not any specific optimization.**

Evidence: bench noise is ±7-20 solves between identical-code runs
(JS_SOLVER_NEXT); X6 was rejected on a −3 delta inside that band; regression
claims keep colliding with stale "historical" baselines; `build/` holds 86
artifact trees / 4.7GB of one-off runs; there are 130 harness scripts in
`src/tests/`.

Build one thing before the next optimization:

- **A canonical bench store**: every solver/analysis run appends (git rev,
  config hash, machine, per-level results) to one queryable location —
  JSON-lines or SQLite, not another ad-hoc directory tree.
- **A paired-run tool with variance built in** (the log's own F1 wish):
  N-rep paired comparisons, reports mean ± spread and per-level flips, and
  refuses to render a verdict inside the noise band.
- **Named benchmark slices** (2-3), stable across months: e.g. `smoke-50`,
  `sokoban-skew-200`, `hard-tail-300`. Mechanic clustering (S18) can define
  them properly later; a frozen random sample works today.
- **Artifact retention policy** for `build/` (age out one-off trees; keep
  only runs referenced from the bench store).

Payoff: every subsequent experiment in every plan gets cheaper and its
verdict becomes trustworthy. Without this, the project ships noise and
rejects real wins in roughly equal measure.

Implementation status (2026-07-03): the first measurement layer is now in
place for JS and target-level solver benchmarks:

- `src/tests/solver_bench_store*.js` provides append-only JSONL records,
  paired comparison, summaries, latest-run queries, and freshness checks.
- `src/tests/generate_solver_benchmark_slice_manifest.js` materializes named
  deterministic slices from the checked-in slice definitions.
- `src/tests/solver_benchmark_slice_health.js` materializes every named slice
  and runs a cheap solver pass that fails on missing targets, message-level
  targets, or compile/level errors.
- `src/tests/run_js_solver_bench_pair.js` runs baseline/candidate JS solver
  pairs with shared pair IDs and stores both artifacts and bench-store records.
  Pair IDs are batch-qualified and artifacts are written under batch-specific
  directories so repeated runs remain append-only instead of overwriting older
  evidence.
- Make targets cover slice manifests, smoke paired runs, store summaries,
  freshness checks, paired comparisons with a noise-band verdict, and explicit
  dry-run/apply retention entry points.

Seeded store status (2026-07-04, git `424304b1719b`, 3 paired JS runs per
slice, baseline `weighted-astar` vs candidate `--adaptive-step-cost`, 500ms
per target):

| Slice | Targets | Baseline solved | Candidate solved | Mean delta | Verdict | Flips |
| --- | ---: | --- | --- | ---: | --- | --- |
| `smoke-50` | 50 | 31, 31, 31 | 31, 31, 31 | 0.00 | `inconclusive_noise_band` | 0 |
| `sokoban-skew-200` | 184 | 102, 102, 102 | 99, 100, 100 | -2.33 | `candidate_worse` | 7 solved→timeout |
| `hard-tail-300` | 184 | 102, 102, 103 | 100, 100, 101 | -2.00 | `candidate_worse` | 6 solved→timeout |

All seeded records were fresh at capture time with `skipped_message=0` and
`errors=0`. Retention dry-run kept the 18 referenced artifacts and removed
nothing.

## 2. Recommendation: adopt the certificate architecture as policy

One consistent empirical law across the whole review and today's results:

> Optimizations based on informal reasoning fail. Optimizations backed by
> analyzer-certified, contract-fuzzed facts stick.

Failed the informal way: A.2 group skip (disabled), cosmetic/undo scope bug,
occupancy no-op predicate (38.4% false positives), X5 movement-aware prune
(47 regressions). Landed the certified way: A3 dead-cells, input
specialization, static-opt passes behind parity gates.

Make it explicit policy:

- Engines and solvers consume **only** analyzer-certified facts (the S1/S2
  certified wake-mask and group-schedule artifacts are the archetypes).
- Every fact family ships with runtime contracts
  (`run_static_analysis_runtime_contracts_node.js`) and fuzzing
  (`fuzz_static_contracts.js`) before any consumer lands.
- JS analyzer is the reference implementation; native follows via
  `run_native_static_analysis_parity_node.js`.

Consequence of X5 specifically: **S1 is no longer one option among several —
it is the only viable route to the pruning class of wins** (P2/N3/T2 all
depend on it now).

Implementation status (2026-07-04): S1 has started in the JS analyzer. The
new `certified_wake_masks` fact family serializes per-rule read/write
certificates with object-read polarity, movement-present vs stationary
movement-absence reads, object set/clear writes, movement set/clear writes,
and engine-shaped Int32 word masks using the runtime movement bit layout.
Fixture coverage lives in `src/tests/static_analysis_testdata/certified_wake_masks/`.
Runtime consumers are still intentionally gated until replay/fuzz contracts
assert the certificate along traces.

## 3. Recommendation: aim the solver metrics at the generator

The repo's trajectory (generator, remixer, block scheduler, difficulty
estimation, an anonymized batch corpus) indicates the real product is
**automated generation/evaluation of PuzzleScript games**, with solving as
the evaluation inner loop. If so, the strategic metric is not "levels solved
at 500ms" but **evaluated games per CPU-hour at acceptable discrimination
quality**. That reframing changes priorities:

- **Unsolvability certificates are as valuable as solutions** (S9/S5-based
  rejection): fast, proved rejection is half of curation.
- **Difficulty-estimate quality matters as much as solve count** — a solver
  that finds one solution fast but says nothing about depth/width of the
  search space under-serves the consumer.
- **Budget per game family, not per level.** Generators emit many variants
  of one game; analysis, compilation, move-ordering priors, and macros all
  amortize across a family. The 79% intra-game-transfer statistic (search
  plan §3) is the same insight arriving from the solving side.

Action: write the one-page statement of what the pipeline optimizes for,
and re-derive solver targets from it. Every plan in this directory
implicitly assumed "solve count at fixed per-level timeout"; that assumption
should be checked against the actual consumer.

## 4. Recommendation: shrink the runtime tier zoo

Current maintenance surface: JS solver, native interpreter, three
specialized codegen backends (rulegroups / full-turn / compact-turn), HDA
variants — across two languages, all pairwise parity-checked. Decision
already voiced: the interpreter is the practical production path. Follow
through:

- **JS** = reference semantics + prototyping bench. Gets experiments first.
- **Native interpreter** = production. Gets the N-series investment
  (N2 static anchor masks and N1 moving-cell indexes are now implemented;
  one-run attribution removes movement-anchor full-grid scans as the first
  runtime bottleneck, and NX2 mimalloc preload did not show an immediate
  win).
- **Compiled tiers** = frozen calibration ceiling. No further investment
  unless the game-family story (rec. 3) creates a compile-cache use case.

Every demoted tier is permanently reclaimed parity/maintenance budget.

## 5. Recommendation: buy new solves where they're actually for sale

X1-X6 close the case on the forensics game: throughput-bound, diffuse cost,
guidance already fine. No tactical fix reaches it at 500ms. Where the
remaining wins live, in order of confidence:

1. **Native runtime (N-series)** — untested, targets the production path,
   and X4 proved throughput is the whole JS-vs-native gap on hard games.
2. **Structurally different search (T-series)** — push-space for certified
   pushers (T1), rule-derived no-op oracle (T2, now S1-dependent), novelty
   tie-breaking (T3, half-day probe), intra-game transfer (T4, aimed at the
   238-level addressable pool), heterogeneous parallel lanes (T7).
3. **Certified pruning (T6/S9/S11)** — after the certificate plumbing.

Also: **human-audit a ~30-level sample of the 300-level hard tail** to
estimate how much is actually solvable. Some fraction is likely broken or
degenerate; the true ceiling matters for honest targets, and unsolvability
certificates would later formalize the audit.

## 6. Recommendation: process — one plan in flight, results merged back

Today produced four plan documents; the one that executed disproved three of
its own items within hours. That is the system *working* — but only if
results flow back to where future readers look. Keep the pattern that
already works (`JS_SOLVER_NEXT.md`: negative results recorded inline, in the
place the next contributor reads first) and add the missing piece:

- **This file is the roadmap.** Per-item status lives in §8; update it when
  an experiment lands or a plan item dies. Plan files themselves are
  append-only history — don't rewrite them, link their results docs.
- **One plan executing at a time.** Each execution ends by updating §8 and,
  where a negative result kills siblings (X5 → P2/N3 rerouted through S1),
  annotating the dependency graph.
- Worktree discipline for concurrent sessions (this repo has a recorded
  history of sessions clobbering the main checkout).

## 7. Recommendation: two external outlets worth exercising

- **Author-facing features.** The analyzer already computes what
  PuzzleScript authors ask for: "this rule can never fire" lint (S8),
  difficulty estimates, solvability auto-playtest in the editor. The labs
  work becomes product value for puzzlescript.net, and authors become
  volunteer QA for the analyzer's soundness.
- **A public solving benchmark.** Grid rewriting games are a genuinely
  interesting search domain — deterministic, fully observable, mechanically
  diverse, with a built-in difficulty dial. Releasing a corpus slice +
  harness + baseline table would draw planning/search researchers into
  doing T-series-style work for free. It's cheap once rec. 1 exists,
  because the benchmark *is* the measurement layer, published.

## 8. Roadmap index and dependency graph

Documents (all in `docs/solver-forensics/`):

| Doc | Series | Status |
| --- | --- | --- |
| `2026-07-02-…-js-first-500ms-report.md` | forensics | complete (input evidence) |
| `2026-07-03-anonymous-game-500ms-optimization-plan.md` | P/X | executed; see results doc |
| `2026-07-03-anonymous-game-500ms-experiment-results.md` | X results | complete |
| `2026-07-03-native-interpreter-optimization-plan.md` | N/NX | live, unexecuted |
| `2026-07-03-static-analyzer-extension-proposals.md` | S | live, unexecuted |
| `2026-07-03-solver-search-strategy-plan.md` | T/TX | live, unexecuted |
| this file | strategy | keep current |

Item status after the X-round:

| Item | Status | Note |
| --- | --- | --- |
| P1 static opts on hard game | done, no effect there | still valuable corpus-wide/for strides — remeasure on corpus |
| P2 / N3 movement-aware prune | **rejected as implemented** | reroute through S1 certified masks |
| P3 adaptive strategy | rejected for current implementation | named slices: smoke 0, sokoban −2.33, hard-tail −2.00 solved; keep only as future redesign idea |
| P4 JS codegen | design-doc only | superseded in priority by native path (rec. 4) |
| P5 / N8 stride compaction | live | X1 suggests cosmetic-pass alone shrinks too little (6/82 layers) — S4 per-level universe is the stronger route |
| P6 again reduction | **dead** | X3: multiplier ≈ 0 |
| N1/N2 moving-tiles bitboard + static anchor masks | done in native interpreter; repeat-run raw validation done | N2 mask hoist keeps runtime mask builds at zero; N1 drops one-run movement-anchor scanned cells from 669.1M→4.9M on smoke-50 and 2.78B→11.6M on the named portfolio, while raw 3-run throughput moves +6.4% on smoke-50 and +100.4% on the named portfolio with solved splits unchanged |
| N4-N7, N9 | next runtime tier by residual per-step cost; N4a done, N4b/N5a rejected | N4a's add-only movement dirty guard is a small validated win (+2.0% smoke-50 and +1.7% named portfolio raw step-throughput vs N1, solved splits unchanged); N4b rebuild-on-read reduced the tiny `push_goal` dirty counter canary but regressed focus-50 median wall +20.3% in the stale-board version and +51.5% with exact board reads, so do not revive broad phase-boundary rebuild deferral; direct pattern-mask spans regressed (-4.0% smoke step-throughput vs N4a after trimming counter overhead). Next material runtime work should be N4c refcounted/decremental masks only with counter proof, or S1-backed N3 pruning once certified contracts are consumed |
| S1/S2 certified masks + schedules | S1 artifact started; S2 live | `certified_wake_masks` fact family landed for JS; runtime consumption still gated on contracts |
| S4 per-level object universe | live | promoted by X1's weak cosmetic result |
| S9/S10 invariants + schemas | live | unblock T1/T6 |
| T1-T4, T7 | live | TX1 (novelty) and TX3 (sibling priors) are the cheapest probes |
| Measurement layer (rec. 1) | live foundation | JSONL bench store, deterministic slice materializer, all-slice health gate, JS paired-run executor, level-benchmark append hooks, freshness/compare checks, retention plan/apply entry points, and Makefile wiring are in `src/tests/solver_bench*`, `src/tests/generate_solver_benchmark_slice_manifest.js`, `src/tests/solver_benchmark_slice_health.js`, and `src/tests/run_js_solver_bench_pair.js` |

Dependency spine:

```
measurement layer (rec.1)
  └─> everything

S1 certified wake masks ──> P2/N3 pruning ──> T2 no-op oracle
S2 group schedules      ──> N9 single-pass groups
S4 per-level universe   ──> P5/N8 stride compaction (v2)
S10 mechanic schemas    ──> T1 push-space, T6 deadlock pruning
NX1/NX2 probes          ──> N1/N2 done ──> N4/N5/N3 by counter evidence
solved-corpus solutions ──> T4 intra-game transfer (no dependencies!)
```

## 9. If everything above is compressed to three moves

1. **Build the measurement layer** (bench store + paired-run tool + named
   slices). Everything else is unverifiable without it.
2. **Adopt the certificate rule** and start with S1 — it now gates the
   entire pruning class across both engines and the solver.
3. **Re-aim solver metrics at the generator pipeline** (games/CPU-hour,
   unsolvability certificates, per-family amortization) and let that
   re-rank the remaining backlog.
