# Level Generator Test Suite Plan

Written 2026-07-03. Design for a test suite for the level generator
(`native/src/generator/`, CLI `puzzlescript_generator`, spec format `.gen`,
remix/templatize modes). The core difficulty: generation is stochastic and
slow to judge end-to-end — the chance of stumbling on a good solvable level
is low, so "run it and look at the output" is neither fast nor falsifiable.
The answer is layering: test the *deterministic machinery* exactly, test the
*control policy* against scripted oracles, test *search capability* on
constructed needles where good levels are dense, and test *quality* only as
banded statistics on fixed seeds — never as pass/fail on individual outputs.

Related: `docs/solver-forensics/2026-07-03-project-strategy-recommendations.md`
(rec. 1, measurement layer — the L3/L4 layers below should write to the same
bench store) and `native/src/generator/PLAN.md` (which already specifies a
benchmark metric list this plan builds on).

## 0. What already exists (build on, don't duplicate)

- Unit tests: `native/tests/generator_spec_parser.cpp`,
  `generator_generation_rules.cpp`, `generator_block_keepers.cpp`,
  `generator_block_exhaustion.cpp`, `generator_templatize.cpp`,
  `generator_duration_parse.cpp`, `generator_microban_stamp_repro.cpp`.
- Fixed-seed presets: `src/tests/generator_presets/*.gen` (tiny/scatter/
  transform-pairs) + `make generator_smoke_tests` / `make generator_benchmark`
  (`GENERATOR_BENCH_*` Makefile vars, JSON output with `solver_totals`).
- Determinism groundwork: per-sample `sampleSeed` in `Keeper`, deterministic
  dedupe eviction, `--seed`, `--events-jsonl`, `--json-out`.
- The pipeline shape: samples (choose/prob rules over an init level) →
  validity → global dedupe (hash) → solve (portfolio, `--solver-timeout-ms`)
  → difficulty proxy (`expandedPortfolio`) → top-K keepers per block.

## 1. The key architectural move: a solver seam

Almost everything hard to test in the generator is downstream of one fact:
the solver is welded into the sampling loop. Introduce a narrow interface
(virtual class or function pointer): `SolveOracle: (game, level, budget) →
{status, expanded, solution}`. Production wires the real solver; tests wire:

- **ScriptedOracle** — returns verdicts from a lookup keyed by level hash
  (or simply by call order). Makes the *entire control loop* deterministic
  and instant: top-K maintenance, dedupe interaction, block scheduling,
  budget/inactivity/exhaust-pass handling, tie-breaking, JSON accounting.
- **CountingOracle** — wraps either oracle, records call counts/budgets,
  for funnel assertions.

This is the same policy/oracle separation compilers use for register
allocators and planners use for simulators. Without it, every control-loop
test costs solver time and inherits solver noise; with it, L1 below runs in
milliseconds and can exercise pathological schedules (all-unsolvable,
all-duplicate, adversarial difficulty ties) that nature would take hours to
produce.

## 2. The test pyramid

### L0 — deterministic kernels (exists; extend) — budget <1s

- Spec parsing goldens (exists). Add: every documented spec construct has a
  parse fixture; malformed specs produce stable diagnostics.
- **Transformation-step goldens**: each generation-rule kind (`choose N`,
  ranges `1-2`, multi-cell patterns, `or` alternatives, prob rules) applied
  to a fixed level with a fixed RNG state → golden output level. Catches
  unintended sampling-behavior changes exactly.
- **Well-formedness properties** (property-based, ~100 random seeds per
  run): every emitted sample parses and compiles as a PuzzleScript level;
  dimensions match the block spec; glyph legend is valid; `choose N`
  changed exactly N (or range-consistent) cells; patterns' negative
  conditions hold at the chosen sites post-application.
- **RNG discipline tests**: same `--seed` → byte-identical `--json-out`
  and `--out` across runs *and across `--jobs` values*. Per-sample streams
  must derive from (master seed, sample index), not from a shared sequential
  stream — otherwise `--jobs N` and any code reordering silently reshuffle
  all downstream results and L3's exact goldens are impossible. If this
  isn't true today, making it true is a prerequisite for the rest of the
  suite.

### L1 — control loop vs scripted oracles — budget <5s

Using the solver seam:

- Top-K keeper semantics: scripted difficulty sequences with ties,
  duplicates, and late-arriving high scores → exact expected keeper sets
  (deterministic eviction already exists; pin it).
- Global dedupe: scripted hash collisions, `--dedupe-max` eviction order.
- Block scheduler: multi-block specs with unequal `take`/dimensions;
  exhaustion (`--exhaust-passes`) and inactivity (`--inactivity-start`)
  termination paths; correct attribution of keepers to blocks.
- Budget accounting: `--time-ms`/`--samples` stop conditions, JSON
  totals equal CountingOracle observations.
- **Pathological schedules**: 100% unsolvable verdicts (generator must
  terminate cleanly with empty keepers, not spin); 100% duplicates;
  oracle that always times out at full budget (throughput accounting still
  sane).

### L2 — needle tests: search capability on constructed instances — budget <30s

The insight: end-to-end assertions are fine when *good outcomes are dense
by construction*. Handcraft (game, spec, seed) triples where the probability
of finding an acceptable level within N samples is ≈1 under correct behavior
and ≈0 under plausible breakage:

- **Dense-solvable needle**: a 5x5 sokoban room where ~every legal
  placement of 1 crate + 1 target is solvable. Assert: ≥K keepers within
  200 samples, all keeper solutions replay-verified.
- **Rare-but-reachable needle**: a spec where exactly one placement family
  is solvable (e.g., crate must not start in a corner) — assert the
  keeper set contains only that family. Tests that solver rejection
  actually gates keeping.
- **Difficulty-ordering needle**: two blocks whose solvable outputs have
  provably different search effort (a 2-push room vs an 8-push room);
  assert keeper difficulty ordering matches. Calibrates the
  `expandedPortfolio` proxy on ground truth.
- **Templatize/remix round-trip**: `--templatize` a tiny game with known
  levels, then generate from the template; assert the original levels are
  *reachable* outputs (probability-1 within N samples given the seed) and
  that generated output re-compiles under the original game. The existing
  `generator_microban_stamp_repro.cpp` is the seed of this family.

Each needle is a permanent, fast, end-to-end regression test with a real
solver in the loop — the trick is that density makes them deterministic in
practice at fixed seed.

### L3 — funnel + throughput regression on fixed presets — budget <2min, CI

The generator is a funnel; test the funnel's *shape*, not its outputs:

```
samples attempted → valid → unique (dedupe) → solved → keeper-worthy
```

For each preset (the three existing `.gen` presets + one remix preset per
2-3 corpus games), at fixed seed set (e.g., 8 seeds) and fixed sample count
(not wall-clock — sample-count budgets make results machine-independent):

- **Exact tier**: when a change doesn't intend to touch RNG streams, all
  funnel counters and keeper hashes are golden-exact per seed. Any diff =
  investigate.
- **Banded tier**: when RNG streams legitimately change, assert per-stage
  conversion rates within documented bands across the seed set (median ±
  tolerance), e.g. valid-rate 100%, dedupe-survival 40-90%, solve-rate
  band per preset. Bands live next to the test with a comment citing the
  runs that set them.
- **Throughput floors** (the "measure throughput" idea, made precise):
  samples/sec with ScriptedOracle (pure generation+dedupe cost — no solver
  noise) and solver-calls/sec with the real solver at fixed
  `--solver-timeout-ms`, asserted as generous floors (e.g., >50% of
  recorded baseline) to catch order-of-magnitude regressions without
  flaking on machine variance. Fine-grained tracking belongs in the bench
  store, not in pass/fail CI.

### L4 — quality benchmark (nightly, not CI-blocking) — budget 30-60min

The only layer that judges *goodness*, and it reports trends rather than
pass/fail:

- Corpus-sampled remix runs (fixed game sample, fixed seeds, fixed sample
  budget). Record per run into the shared bench store (strategy doc rec. 1):
  - **yield**: keepers per 1000 samples and per CPU-minute
  - **diversity**: unique canonical forms among keepers (reuse
    `canonicalizer_node.js`) / keeper count; mean edit distance from the
    base level (are we generating variants or near-copies?)
  - **difficulty calibration**: independently re-solve keepers at a higher
    budget; Spearman correlation of `expandedPortfolio` proxy vs re-solve
    effort; flag proxy drift
  - **difficulty distribution** vs block targets (once targeting exists)
  - **stability**: seed-to-seed variance of yield — a high-variance
    generator is itself a defect worth trending
- Sanitizer sweep (ASan/UBSan) over the L2+L3 suites.
- **Fuzz lane**: corpus games + mutated specs through parse→generate for
  crash/hang/invalid-output detection (mirror the existing
  `fuzz_corpus_batch` pattern).

## 3. Provenance and replay (turns bugs into tests)

Every keeper already carries `sampleSeed` + block identity. Complete the
loop:

- `--replay-sample SEED[:BLOCK]` regenerates exactly one sample end-to-end
  and prints its full derivation (init level, rule applications, final
  level, solve verdict).
- Suite invariant: for every keeper in any L2/L3 run, replaying its
  provenance reproduces the identical level and verdict.
- Workflow: any interesting or wrong output found in the wild becomes a
  one-line permanent regression test (its provenance tuple + expected
  hash). This is how the suite grows to cover reality without anyone
  designing cases for it.

## 4. Testing the tests: seeded breakage

Stochastic pipelines fail silently — a biased RNG or a dead filter often
*improves* throughput. Once L2/L3 exist, spend half a day verifying they
have teeth by intentionally breaking the generator and confirming red:

- disable dedupe (L3 unique-rate band must catch)
- make the oracle accept everything (L2 rare-needle must catch)
- bias `choose` site selection toward index 0 (L0 property or L3 keeper
  hashes must catch)
- drop the second pattern group in multi-cell rules (L0 goldens must catch)

Document which layer caught each. Any breakage that survives green reveals
a hole to fill. Re-run this drill when the suite changes materially.

## 5. Build order

1. **RNG discipline + determinism tests** (L0) — prerequisite for exact
   goldens; verify or fix hierarchical per-sample seeding, including under
   `--jobs`.
2. **Solver seam + ScriptedOracle** — unlocks L1; pure refactor with
   existing behavior as the golden.
3. **L1 control-loop suite** — cheap, deterministic, covers the logic that
   currently only gets exercised by expensive end-to-end runs.
4. **Three needle tests** (dense, rare, ordering) + keeper replay
   invariant — first trustworthy end-to-end signal.
5. **L3 funnel regression** on the existing presets (extend the existing
   `generator_benchmark` JSON with per-stage counters if any are missing).
6. **Seeded-breakage drill** (§4).
7. **L4 nightly quality bench** — last, and only once the strategy doc's
   bench store exists to receive it; interim results can land as JSON in a
   fixed directory with the paired-run comparison discipline.

## 6. What not to do

- **No pass/fail assertions on individual generated levels' quality** —
  that's L4 trend territory; anything else flakes or ossifies taste.
- **No wall-clock-budgeted CI tests** — sample-count budgets only;
  wall-clock belongs in throughput floors with generous margins and in the
  nightly bench.
- **No corpus-wide transform-and-solve sweeps as tests** — the exact
  radically-too-expensive design this plan replaces; the corpus appears
  only in the nightly sampled remix bench and the fuzz lane.
- **No solver-quality assertions inside generator tests** — the solver has
  its own suite; here it's an oracle, and ScriptedOracle should carry as
  much of the load as possible.
