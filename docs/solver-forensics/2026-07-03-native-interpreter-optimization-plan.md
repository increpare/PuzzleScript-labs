# Native C++ Interpreter Optimization Plan — handoff

Written 2026-07-03. Standalone handoff plan for optimizing the C++ *interpreted*
runtime (`native/src/runtime/`) and its solver. The interpreter is the practical
production path: game-agnostic, no per-game codegen/compile latency. The
compiled tier (specialized backends) is the throughput calibration ceiling, not
the target.

This is the native companion to
`docs/solver-forensics/2026-07-03-anonymous-game-500ms-optimization-plan.md`
(JS-first diagnosis of the same investigation; also contains this content as a
section). Facts below are from code inspection and the forensics artifacts;
impact estimates are inferences pending the counter experiments (NX1).

## Context for a cold start

- Runtime core: `native/src/runtime/core.cpp` (~7.6k lines), `core.hpp`
- Solver: `native/src/solver/main.cpp`; heuristics backlog:
  `native/src/solver/HEURISTICS_IMPLEMENTATION.md`
- Build: CMake in `native/` (Release: `-O3`, LTO on, `-march=native` on)
- Runtime counters already plumbed: `ps_runtime_counters_set_enabled/reset/snapshot`
  (`native/src/runtime/c_api.cpp:716-724`), counter fields like
  `maskRebuildCalls`, `candidateCellsTested`, `patternTests`, `rulesVisited`,
  `rulesSkippedByMask`, `specializedRulegroup*`
- JS/native parity + coverage harnesses: `src/tests/run_solver_parity_smoke.js`,
  `src/tests/run_solver_compact_parity.js`, `src/tests/native_solver_js_coverage_node.js`
- Env knobs honored by native runtime/solver: `PUZZLESCRIPT_INPUT_SPECIALIZATION`,
  `PUZZLESCRIPT_INCREMENTAL_PRUNE` (see `applyRuleGroup`)
- Sync/design notes: `native/PLAN.md`, `native/SYNC_WITH_JS_PLAN.md`
- Prior profiling (memory note, HDA solver profiling 2026-06-16): step = 82-90%
  of time; **malloc ≈23%** + clock ≈14% overhead; HDA scales only ~45% at 8
  threads (allocator cross-thread-free contention, not duplicate explosion);
  deadline batching + buffer pool landed in PR #3 recovering only ~2-4%.

Benchmark game (worst-case step-cost canary): the snakebird-style game in
`build/solver-forensics/anonymous-js-first-500ms/input-corpus/` — 251 objects,
82 collision layers, 551 rule lines, large levels (median ~506 cells, max
2385). Native interpreter: 717µs/generated; native compiled: 62–77µs; JS:
2115µs (summary.json in the same dir). Corpus @500ms (historical): JS 710 →
C++ interp 842 → C++ compiled 917 → HDA compiled 1003 (of 1346 playable).

## What the interpreter already does well

Do not redo these; they're in place and working:

- 64-bit mask words (this game: 4 object + 9 movement words vs 8+17 in JS
  32-bit words); all per-game masks in a contiguous `Game::maskArena`
  accessed by offset (`core.hpp:34-112`)
- Per-object cell bitboards with incremental maintenance (`objectCellBits`,
  `objectCellCounts` via `setObjectCellIndexBit`, `core.cpp:2291-2324`) —
  object-anchored scans walk set bits with ctz and get O(1) selectivity counts
- Rarest-anchor selection for object-anchored rows (`chooseRowAnchor`)
- Dirty-row/col/board mask rebuilds (`rebuildMasks`, `core.cpp:5300-5520`)
- `ruleCanPossiblyMatch` checks both board object AND movement masks
  (`core.cpp:4439-4454`)
- Input specialization per rule (`Rule::activeInputsMask`), incremental prune
  inner-loop guard, single-row match scratch buffer
  (`singleRowMatchScratch`, `core.cpp:4526`)
- Solver: compact node storage (`PersistentLevelState`), Zobrist hashing
  (`PUZZLESCRIPT_VERIFY_ZOBRIST` assert mode), partially batched deadline
  checks (`solver/main.cpp:3170` comment: removes ~5 of ~6 per-expansion
  `Clock::now()` reads)

## Observed hot-path issues (facts, with code refs)

- **F1 — `rebuildMasks` after every successful rule application.**
  `applyRuleGroup` calls `rebuildMasks(session)` at group entry and after each
  apply (`core.cpp:5087, 5158`). Rebuild is dirty-line-tracked, but any
  *cleared* bit dirties the cell's whole row + column + board
  (`setCellObjectsFromWords`, `core.cpp:2333-2362`; set-only updates are
  OR'd in place), and rebuilding a dirty line re-ORs width×strideObject (and
  movement equivalents). On propagation-chain games (blocked/vertebra chains
  in the benchmark game) this runs at fixpoint frequency — O(chain ×
  line-rescan). Counters exist to quantify: `maskRebuildCalls`,
  `maskRebuildDirtyCalls`, `maskRebuildRows/Columns`.
- **F2 — movement-anchor selection does full-grid scans and heap allocation
  per call.** `chooseMovementRowAnchor` (`core.cpp:3755-3802`) allocates a
  `MaskVector` per pattern per call and ORs together masks that are
  **state-independent** (pattern movementsPresent + anyMovements +
  layer-coupled), then `movementOverlapCount` (`core.cpp:3721-3741`) scans
  all tiles × strideMovement just to *count* selectivity. The
  movement-anchored iteration itself also walks every tile
  (`core.cpp:3837-3846`) rather than only moving tiles.
- **F3 — incremental prune is movement-blind, same as JS.** The guard
  (`core.cpp:5108-5128`) skips a rule only when `readMovementsZero &&
  !readObjectsOverlapPrior`. `incrementalPriorMovements` is accumulated and
  swapped (`core.cpp:5152-5179`) but never consulted. Identical shape to
  `src/js/engine.js:3092` — fix both engines together, cross-checked by the
  parity harness.
- **F4 — per-cell match loops over all stride words.** `matchesPatternAt`
  (always_inline) loops `objectWordCount` (4 here) and `movementWordCount`
  (9 here) words per present/missing/any check, though a given pattern mask
  is typically nonzero in one word.
- **F5 — multi-row rules allocate per tryApply.** The single-row path uses
  `singleRowMatchScratch` (`core.cpp:4526`), but the multi-row path builds
  `std::vector<std::vector<RowMatch>>` + per-row vectors returned by value
  (`core.cpp:4620-4649`). The benchmark game's 48 `[ start ] [ … ]` rules and
  the `[ HeadX edgeX ] [ > Player ]` family hit the allocating path.
  Consistent with the HDA profiling: malloc ≈23% of time, cross-thread frees
  capping HDA at ~45% scaling; the fresh single-game data agrees — HDA x8
  interpreter reports 1020µs/generated vs single-threaded portfolio's 717µs
  (summary.json).
- **F6 — board layout is cell-major, column-major** (`tileIndex = x*height+y`);
  horizontal line scans stride by `height × words`. A row of a 61-wide level
  touches 61 scattered ~104-byte cell records.

## Proposals, prioritized

- **N1 — moving-tiles bitboard (low-level; likely largest single win).**
  Maintain a tile bitboard "any movement bits set", updated in
  `setCellMovements`, exactly analogous to `objectCellBits`. Then
  movement-anchor selectivity = popcount (kills `movementOverlapCount` grid
  scans) and movement-anchored iteration walks set bits via ctz instead of
  all tiles (`core.cpp:3837`). Most turns have few movers and movement rules
  are the hottest class. Localized, low risk; validate with parity + sim
  suites.

  Status update (2026-07-06): implemented in the native interpreter as
  per-movement-bit cell bitsets plus counts in `Scratch`. Bulk movement resets
  now invalidate the index; the hot cell-movement setters update it
  incrementally; movement-anchor selectivity uses the counts; and anchored
  collection iterates set moving-cell bits instead of every tile. Focused
  coverage in `make native_runtime_counters_tests` now asserts
  `movement_anchor_overlap_cells_scanned == 0`, with parity, determinism,
  simulation, and build checks passing. One-run N2→N1 artifacts
  `build/native/n2-smoke-50-runtime-counters.json` →
  `build/native/n1-smoke-50-runtime-counters.json`: solved split unchanged
  at 33/16/1, median wall 56.199ms → 39.217ms, generated states
  534437 → 696620, summed `step_ms` 8224.644 → 7854.286, and movement-anchor
  scanned cells 669138639 → 4920241 (overlap scans 340133191 → 0). Named
  benchmark portfolio artifacts
  `build/native/n2-anonymous-game-portfolio-runtime-counters.json` →
  `build/native/n1-anonymous-game-portfolio-runtime-counters.json`: solved
  split unchanged at 1/53, median wall 584.370ms → 566.028ms, generated
  states 27171 → 69318, summed `step_ms` 24098.749 → 23992.879, and
  movement-anchor scanned cells 2784656146 → 11592320 (overlap scans
  1966073188 → 0). Treat this as a real scan-cost win, but still a one-run
  timing sample; repeat-run bench store data is required before claiming a
  stable solved-count or wall-time result.

  Follow-up raw timing (2026-07-06, counters disabled, three runs per target,
  artifacts `build/native/measure-raw-n2-smoke-50-runs3.json` →
  `build/native/measure-raw-n1-smoke-50-runs3.json` and
  `build/native/measure-raw-n2-anonymous-game-portfolio-runs3.json` →
  `build/native/measure-raw-n1-anonymous-game-portfolio-runs3.json`) confirms
  the win is mostly throughput, not immediate solved-count movement. `smoke-50`
  kept the same 33/16/1 solved/timeout/exhausted split; summed target-median
  throughput moved 86.570 → 92.141 generated states/ms (+6.4%), with median
  wall 39.728ms → 38.822ms. The named movement-heavy portfolio kept the same
  1/53 solved/timeout split; summed target-median throughput moved
  1.463 → 2.932 generated states/ms (+100.4%), with median generated states
  683 → 1192 inside the same 500ms cap. N4/N5 should now optimize the
  remaining per-step cost rather than movement-anchor full-grid scans.
- **N2 — hoist static movement-anchor masks to lowering time (trivial).**
  The per-pattern movement union in `chooseMovementRowAnchor` is
  state-independent; precompute into `maskArena` at lowering, deleting the
  per-call alloc + OR-building. Zero semantic risk.

  Status update (2026-07-06): implemented as a prerequisite slice. Patterns
  now carry `movementAnchorMask`/`hasMovementAnchorMask`; lowering and JSON IR
  loading both precompute the union in `maskArena`, and runtime counters expose
  `movement_anchor_runtime_mask_builds` so `make native_runtime_counters_tests`
  asserts zero hot-path mask builds. One-run follow-up artifacts
  `build/native/n2-smoke-50-runtime-counters.json` and
  `build/native/n2-anonymous-game-portfolio-runtime-counters.json` were
  behavior-neutral: same solved counts as NX1 (33/50 smoke, 1/54 named game),
  named-game median wall 583.273ms → 584.370ms, and smoke-50 summed `step_ms`
  8352.841 → 8224.644. N2 should stay, but the cost center remains the
  full-grid scans; N1 is still the actual expected win.
- **N3 — movement-aware incremental prune (both engines).**
  Consult `incrementalPriorMovements` in the guard (`core.cpp:5108-5128`).
  Soundness caveats: clears must be covered by write masks;
  stationary/`no X` requirements must be covered by read masks. Land JS
  (`engine.js:3092`) + native together; lean on the parity harness.
  2026-07-06 JS S1-consumer note: `--solver-certified-wake-prune` attaches
  certified semantic movement wake masks and passes the Karamell canary, but
  smoke-50 remeasurements regressed (`step_ms` default 8355.9/8343.7 ->
  certified 9224.6/9203.7; incremental-only 9151.5/9150.9 -> certified
  9184.8/9192.5). Treat N3 as explicit experimental plumbing, not a default
  runtime tier, until a narrower counter-backed site is identified.
  2026-07-07 JS counter note: `--solver-wake-prune-counters` shows broad
  smoke-50 certified pruning skips only 124,794 / 7,867,745 rule checks
  (1.59%) while 98.41% still reach `tryApply`; the S1 path pays movement
  overlap cost nearly everywhere for too few avoided calls.
- **N4 — cheapen or defer `rebuildMasks`.** In rising ambition:
  (a) rebuild once per fixpoint iteration instead of per application (audit
  which same-iteration reads need freshness); (b) rebuild-on-read — only
  rebuild a dirty line when a match actually consults it; (c) per-line
  per-object-bit reference counts enabling O(changed-bits) decremental
  updates (memory ≈ (height+width) × objectCount × 2B — tens of KB, fine).
  Gate on F1 counter numbers first.

  Status update (2026-07-06): landed N4a's conservative add-only movement
  dirty guard in the generic movement word setter. Movement writes still OR
  new bits directly into row/column/board movement masks, so games that do not
  need movement line-all masks avoid the old dirty rebuild when no movement
  bits were cleared. Games with missing-movement line prechecks keep the
  previous dirty behavior because `clearMovementState()` leaves line-all masks
  stale until rebuild. Focused counter coverage in
  `make native_runtime_counters_tests` now asserts the `push_goal` canary drops
  below the old dirty profile; observed counters moved
  `mask_rebuild_dirty_calls` 13 -> 12, rows 21 -> 20, columns 75 -> 74.
  Serial smoke/parity stayed green.

  Raw timing against the N1 foundation (counters disabled, three runs per
  target, artifacts `build/native/measure-raw-n1-smoke-50-runs3.json` ->
  `build/native/measure-raw-n4a-smoke-50-runs3.json` and
  `build/native/measure-raw-n1-anonymous-game-portfolio-runs3.json` ->
  `build/native/measure-raw-n4a-anonymous-game-portfolio-runs3.json`) shows a
  small per-step improvement with unchanged solved splits. `smoke-50` stayed at
  33/16/1 solved/timeout/exhausted; summed target-median throughput moved
  92.141 -> 93.975 generated states/ms (+2.0%), median wall 38.822ms ->
  37.982ms. The named movement-heavy portfolio stayed at 1/53 solved/timeout;
  throughput moved 2.932 -> 2.982 generated states/ms (+1.7%), and median
  generated states moved 1192 -> 1221 inside the same 500ms cap. This is a
  worthwhile cheap cleanup, but the remaining N4 variants need a larger
  mechanism than this setter guard.

  Status update (2026-07-06): N4b rebuild-on-read was prototyped and backed
  out. The first version deferred line cleanup and removed the post-movement
  and end-of-turn rebuilds; it improved the tiny `push_goal` counter canary
  from 12 -> 9 dirty rebuild calls, rows 20 -> 18, columns 74 -> 71, but stale
  board masks weakened rule prechecks on the 50-target focus benchmark
  (`/tmp/n4a_focus_benchmark_6af3.json` ->
  `/tmp/n4b_focus_benchmark_6af3.json`): median wall 325.4ms -> 391.3ms
  (+20.3%), median step 235.7ms -> 327.3ms (+38.8%), solved samples
  215/250 -> 157/250. A refined version made board prechecks rebuild exact
  dirty rows while leaving columns lazy; it regressed further
  (`/tmp/n4b_board_focus_benchmark_6af3.json`): median wall 493.0ms (+51.5%)
  and step 395.3ms (+67.7%), solved samples 140/250. Do not revive N4b's
  broad phase-boundary rebuild deferral. If N4 continues, prefer N4c's
  decremental/refcounted line masks or a narrower, counter-proven site that
  preserves board-level pruning and does not add per-read overhead.

  Status update (2026-07-07): N4c exact object refcount masks were prototyped
  behind `PUZZLESCRIPT_N4C_OBJECT_REFCOUNT_MASKS=1`, with counters left on
  the default path for attribution. The opt-in path seeds per-object row,
  column, and board counts from the current board, then applies exact
  O(changed-bits) updates from `setCellObjectsFromWords`; all count caches are
  invalidated across materialization, compact-turn bridge, level replacement,
  and bulk mask-dirty paths. The `push_goal` counter canary now checks that
  N4c removes object row/column rebuilds, performs incremental refcount
  updates, and reports zero fallbacks. On the paired one-run `smoke-50`
  profile with runtime counters enabled, median wall was effectively flat
  (`39.451ms` baseline -> `39.548ms` N4c), while object scan attribution moved
  from 389.4M row/column scan cells to 96.4M full count-cache seed scan cells
  (-75.3%). The non-timeout paired subset was similar: object scan cells
  27.3M -> 8.5M (-68.9%), median step `2.936ms` -> `3.114ms`. This proves the
  decremental mask machinery is exact and structurally reduces line scans, but
  first seed shape was not a default speedup.

  Follow-up (2026-07-10): the cheaper N4c seed now reuses the object-major cell
  index that materialized solver edges already build, and reuses that index's
  exact board totals instead of maintaining a duplicate board-count vector.
  The counter-profile smoke run reports zero secondary full-board seed scans,
  159.1M compact object-index bits visited, 17.7M incremental refcount updates,
  and zero fallbacks. Three-run raw smoke-50 measurements kept the same
  33/16/1 solved/timeout/exhausted split. The original board-seed N4c regressed
  generated-state throughput 92.102 -> 89.550 states/ms (-2.77%); indexed
  seeding recovered to 92.893 states/ms. An A/N4c/A reverse-order control put
  the baseline midpoint at 92.464 states/ms, so the final candidate is only
  +0.46%; timeout throughput is +0.56%, while fixed-work solved step time is
  0.37% slower when forced across every game.

  The preserved wide-stride portfolio changes that decision for a bounded
  default: on its four-object-word game, indexed N4c moved raw three-run
  throughput from 2.892 -> 2.989 generated states/ms (+3.36%) with the same
  1/53 solved/timeout split. The 184-game checked corpus contains 176 one-word,
  six two-word, and two three-word games. N4c was neutral on the measured
  two-word smoke target, while a nine-run `=0`/automatic comparison on the
  three-word smoke target moved median `step_ms` 1.037 -> 0.963 (-7.2%). N4c
  therefore enables automatically when `Game::wordCount >= 3`; set
  `PUZZLESCRIPT_N4C_OBJECT_REFCOUNT_MASKS=0` for an explicit baseline or `=1`
  to force the diagnostic path on narrower games. The next broad interpreter
  representation experiment is N7.
- **N5 — sparse word iteration in `matchesPatternAt`.** Precompute per-mask
  nonzero-word spans (first/last word or tiny word-id list); loop only
  those. Near-free for stride-1 games, ~4-9x fewer word ops on wide games.
  Also order pattern checks by measured selectivity.

  Status update (2026-07-06): a first N5a prototype for direct
  `objectsPresent`/`objectsMissing`/`movementsPresent`/`movementsMissing`
  spans was tried and backed out. The red/green counter fixture proved the
  wide-mask loop reduction, but raw timing did not: after trimming the
  counter overhead, `smoke-50` still regressed versus N4a
  (`build/native/measure-raw-n4a-smoke-50-runs3.json` ->
  `build/native/measure-raw-n5a-smoke-50-runs3.json`) from 93.975 -> 90.188
  generated states/ms (-4.0%) with the same 33/16/1 solved split. An earlier
  named-portfolio diagnostic run also regressed (-6.4% step-throughput), so
  do not revive this exact direct-span shape. If N5 comes back, it needs a
  lower-overhead representation and should target any-mask/layer-coupled hot
  loops or measured wide-mask games specifically.
- **N6 — allocator work for the solver/HDA (metal).** Link mimalloc (or
  jemalloc) and measure — cross-thread-free contention is its home turf;
  then per-thread arenas/freelists for node `FullState` /
  `PersistentLevelState` if needed. Scratch-ify the multi-row match vectors
  (F5) like `singleRowMatchScratch`. Directly targets the measured 23%
  malloc + HDA scaling ceiling.
- **N7 — word-plane (SoA) board layout experiment (representation).** Store
  objects as per-word planes (all tiles' word w contiguous). Pattern checks
  touch only planes with nonzero masks → wide-stride games degrade to
  ~stride-1 cost; `rebuildMasks` becomes long vectorizable runs. Bigger
  refactor; prototype behind a compile-time flag like
  `PS_INTERPRETER_OBJECT_CELL_INDEX` and let counters decide. Overlaps N5 —
  do N5 first, it's 10x cheaper to build.

  Preflight (2026-07-10): temporary direct object-mask word counters measured
  186.8M checks on smoke-50, of which only 78.2K (0.04%) inspected a zero mask
  word. On the four-word portfolio they measured 1.057B checks, including
  496.9M zero-mask checks (47.0%), or 2.17 direct object-word checks per
  pattern test. Artifacts are
  `build/native/n7-preflight-smoke-50-runtime-counters.json` and
  `build/native/n7-preflight-anonymous-game-portfolio-runtime-counters.json`.
  This supports a wide-only N7 experiment and rejects a broad sparse-word
  consumer. The counters themselves were backed out: an always-inline
  profiled/unprofiled template split regressed smoke throughput 5.2%, a single
  body with per-word runtime counter branches regressed 4.1%, and a cold
  noinline profiled body still regressed 3.6%. If this attribution must be
  repeated, make it a compile-time profiling build; do not add runtime-selectable
  branches or duplicate matcher bodies to the default binary.

  Prototype result (2026-07-10): a compile-time-only N7 candidate kept the
  cell-major board canonical and maintained a derived word-major object plane
  for 3-64-word games. Direct pattern terms used precomputed nonzero-word
  metadata; the refined version stored present/missing words as 64-bit masks
  and any-object word masks in one game-level table, avoiding per-pattern heap
  vectors. A generated four-word canary caught an important lifecycle bug:
  reusable solver child states copied `board.objects` directly, so a first
  sibling's plane writes could leak into the next sibling. Routing that copy
  through the derived-cache invalidation boundary restored baseline/candidate
  solution parity. The canary, compile flag, and runtime prototype were removed
  after measurement along with that N7-only invalidation change.

  The refined candidate is rejected. On the 54-target four-word portfolio,
  baseline/candidate kept the same 1 solved / 53 timeout target split across
  three runs, but aggregate generated-state throughput fell from 3.152 to
  2.935 states/ms (-6.9%); median generated work at the 500ms deadline fell
  1360 -> 1269, median wall rose 634.3 -> 640.8ms, and total materialization
  time rose 50.8 -> 58.7ms (+15.5%). Artifacts are
  `build/native/measure-raw-n7-baseline-anonymous-game-portfolio-runs3.json`
  and
  `build/native/measure-raw-n7-word-mask-planes-anonymous-game-portfolio-runs3.json`.
  Smoke-50 was noise-level (+0.6% aggregate states/ms, identical 99 solved / 48
  timeout / 3 exhausted samples), artifacts
  `build/native/measure-raw-n7-baseline-smoke-50-runs3.json` and
  `build/native/measure-raw-n7-word-mask-planes-smoke-50-runs3.json`.
  The per-cell matcher benefits from the canonical cell's adjacent words in one
  cache line; sparse plane lookups replace cheap zero-word arithmetic with
  indirection and worse locality. Do not revive this per-cell SoA shape. N7 is
  only worth revisiting with a plane-wise matcher that batches many tiles per
  word (or a generated kernel that can vectorize that scan); otherwise move to
  the narrower counter-proven S1/N3 consumer or N8.
- **N8 — feed solver-scoped static opts into the native compile
  (high-level).** The JS passes (`src/tests/solver_static_opt.js`:
  inert/cosmetic/merge) shrink object count, **collision layers** (→ both
  strides), and rule count. Native compiles from source, so a
  source-to-source emit (or shared IR) serves interpreter and codegen tiers
  alike. Check `native/src/simplify` and `native/src/search/simplify.*` for
  existing scaffolding before building new.

  Status update (2026-07-10): the first native N8 consumer now applies the JS
  analyzer's S12 `win_relevance` certificate behind explicit
  `--solver-opt win-relevance`, pruning runtime rules by certified source
  line. Broad smoke measurement caught an unsound first certificate: movement
  marker propagation could be outside ordinary rule/win def-use edges while
  still being essential to movement resolution. `the red ring of immortality`
  went solved -> exhausted when its marker rule was removed. The analyzer now
  conservatively treats every movement-writing rule as a win-relevance root;
  the native canary copies that real game into an isolated corpus and requires
  baseline/optimized status and solution parity.

  With that repair, three-run smoke-50 kept the exact 99 solved / 48 timeout /
  3 exhausted sample split. The subsequent full-corpus audit exposed a second
  engine-level dependency: object writers on a mover's collision layer can
  open or close routes even when no rule reads those objects. In `pupush`, the
  first slice removed the door-opening rules and changed a baseline timeout
  into a false optimized exhaustion. The analyzer now also roots every rule
  whose object writes touch a collision layer containing a player or any
  rule-originated mover, publishing `movement_collision_root_rule_ids`.

  The corrected three-run smoke-50 pair still keeps 99 solved / 48 timeout /
  3 exhausted samples. Seventeen of 50 games retain removals (234 static rule
  instances), and aggregate generated-state throughput rises 88.39 -> 111.92
  states/ms (+26.6%). Artifacts are
  `build/native/measure-raw-n8-win-relevance-baseline-smoke-50-runs3.json` and
  `build/native/measure-raw-n8-win-relevance-collision-roots-smoke-50-runs3.json`.
  The benchmark runner starts one solver process per target, so optimized wall
  time includes reparsing the 184-game external hint manifest 50 times and is
  not representative of a normal corpus process, which loads it once. The
  four-word 54-target one-run pair also preserves the 1 solved / 53 timeout
  split; 37 rules are removed and aggregate throughput rises 2.991 -> 3.485
  states/ms (+16.5%), artifacts
  `build/native/measure-raw-n8-win-relevance-baseline-anonymous-game-portfolio-run1.json`
  and
  `build/native/measure-raw-n8-win-relevance-optimized-anonymous-game-portfolio-run1.json`.
  JS smoke parity/replay also passes with the repaired fact.

  Full-corpus native audit at 250ms, portfolio, eight jobs:
  `build/native/n8-full-baseline-250ms.json` ->
  `build/native/n8-full-optimized-collision-roots-250ms.json` keeps errors at
  zero and exhausted levels equal at 7, moves solved/timeout 743/596 ->
  747/592, removes 684 rules, and improves aggregate generated-state
  throughput 81.40 -> 86.47 states/ms (+6.2%). All 747 optimized solutions
  replay on the canonical JS runtime. Of nine baseline solves lost at the
  noisy 250ms/eight-job boundary, eight recover under a single-job 5s replay;
  the remaining target is a valid but severe state-hash/tie-break regression
  (the optimized JS solver finds the same-length solution in about 4.75s, and
  strict baseline-on-optimized replay passes). Decision: keep N8 explicit.
  The proof is now parity-clean on the audited solutions, but default promotion
  still needs practical hint delivery plus repeated paired full-corpus evidence
  and a policy for fixed-budget search-order regressions.
- **N9 — group dependency static analysis (high-level).**
  (a) Groups whose writes cannot feed their own reads need no confirm pass:
  currently even a single-fire group re-matches every rule once more to
  detect quiescence — provable single-pass groups halve their match work.
  (b) The JS "A.2 outer-loop group skip" (wired, disabled;
  `engine.js:3154-3156`) has the same native analog via cumulative changed
  masks — making it sound once benefits both engines.
- **N10 — solver-level hygiene.** Compact node storage default-on where
  parity-clean; finish deadline-check batching (clock was 14% in the HDA
  profile); keep detail timing off in production runs.

## Experiments (run in this order)

- **NX1 — counter attribution run** (~1h). Enable `ps_runtime_counters`, run
  the benchmark game + a ~50-game corpus slice, dump `maskRebuildCalls/Rows`,
  `candidateCellsTested`, `patternTests`, `rulesVisited/SkippedByMask`,
  `specializedRulegroup*`. Success: a ranked cost attribution that picks
  between N1/N4/N5/N7. **This precedes any build-out.**

  Status update (2026-07-05): runtime counters now include direct movement-
  anchor scan attribution:
  `movement_anchor_overlap_cells_scanned`,
  `movement_anchor_collection_cells_scanned`, and
  `movement_anchor_collections_used`. Focused coverage lives in
  `src/tests/native_runtime_counters_node.js` via
  `make native_runtime_counters_tests`. First one-run interpreted native
  `smoke-50` sample, artifact
  `build/native/nx1-smoke-50-runtime-counters.json`: solved 33/50, timeout
  16/50, exhausted 1/50, `step_ms=8352.841`, generated 494410 states,
  movement-anchor scans totaled 662643668 cells
  (337253328 overlap + 325390340 collection), with 1918405 anchored
  collections used. That is about 1340.272 movement-anchor scanned cells per
  generated state, which selected N1 as the next runtime prototype. Follow-up
  one-run interpreted native named benchmark-game samples over 54 playable
  levels, artifacts `build/native/nx1-anonymous-game-portfolio-runtime-counters.json`
  and `build/native/nx1-anonymous-game-hda8-runtime-counters.json`, make that
  stronger: portfolio solved 1/54, timeout 53/54, `step_ms=24050.269`,
  generated 25764 states, and scanned 2659392174 movement-anchor cells
  (1877059286 overlap + 782332888 collection), about 103221.246 cells per
  generated state. HDA x8 solved 1/54, timeout 53/54, generated 12900 states,
  and scanned 1940187483 movement-anchor cells, about 150402.130 cells per
  generated state. NX1 now picks N1/N2 as the first runtime prototype; N4/N5
  remain live second-tier candidates, and NX2 still runs independently for
  allocator/HDA scaling.
- **NX2 — mimalloc link test** (~1h). Relink the solver with mimalloc, rerun
  HDA x8 on the benchmark game + corpus slice. Success: HDA step_ms drops
  materially (target: close part of the 45%→linear scaling gap). Failure:
  contention is not allocator-internal → invest in arenas (N6b) instead.

  Status update (2026-07-05): Homebrew mimalloc 3.3.2 preload was verified
  with `DYLD_INSERT_LIBRARIES=/opt/homebrew/lib/libmimalloc.dylib`. One-run
  HDA x8 pairs did not meet the material-drop success bar. Named benchmark
  game artifacts `build/native/nx2-anonymous-game-hda8-default.json` and
  `build/native/nx2-anonymous-game-hda8-mimalloc.json`: solved count stayed
  1/54, median wall improved only 605.817ms → 595.140ms (-1.8%), and summed
  `step_ms` moved 155499.410 → 156990.420 (+1.0%). `smoke-50` artifacts
  `build/native/nx2-smoke-50-hda8-default.json` and
  `build/native/nx2-smoke-50-hda8-mimalloc.json`: solved count moved 32/50 →
  31/50, median wall 75.582ms → 84.350ms (+11.6%), and summed `step_ms`
  76527.948 → 79019.961 (+3.3%). Treat NX2 as no immediate allocator win; N2
  and N1 have since proceeded, and allocator work should only be revisited
  with repeated runs or a true linked-build comparison.
- **NX3 — N2 + N1 prototype** (done, 2026-07-06). Static movement-anchor
  masks and the moving-cell index are now in the native interpreter. The
  one-run N1 data removes movement-anchor full-grid scans as the top direct
  runtime tax without changing solved counts. Next runtime choices should be
  driven by the new residual counters: N4 mask rebuild deferral/counting,
  N5 sparse word iteration, and S1-backed N3 pruning are the obvious
  candidates.
- **NX4 — N3 paired JS/native landing** (~1-2 days). Same design as the JS
  plan's X5 (env-flagged guard extension, full sim fixtures, paired 250ms
  corpus compare), plus a native parity run.

## Do not do yet

- **N4c (refcounted line masks) or N7 (SoA layout) before NX1** — both are
  multi-day refactors whose payoff is unproven until counters attribute the
  time.
- **SIMD hand-tuning of mask loops** — `-O3 -march=native` + LTO is already
  on; word counts are 4-9; N5/N7 change the loop shape first. Revisit only
  with a profile showing vectorization failure.
- **Rewriting the interpreter around the compiled tier's design** — the
  compiled tier exists and is measured; the interpreter's value is
  game-agnosticism and zero compile latency. Keep improvements
  representation-level, not per-game.
- **HDA topology changes (work stealing, sharding) before NX2** — the
  profiling evidence points at the allocator, not the search distribution.
- **Trusting historical compiled/corpus artifacts for regression math** —
  refresh before tight claims (see JS plan X7).

## Expected outcome (inference)

Benchmark game: 717µs/step plausibly → 150-300µs with N1+N2+N3+N4+N5
compounding — roughly halfway to the compiled tier's 62-77µs while staying
game-agnostic. Corpus @500ms: interpreter 842 (historical) moving toward the
compiled portfolio's 917. HDA: NX2/N6 is the lever for the 8-thread scaling
ceiling, independent of per-step wins.
