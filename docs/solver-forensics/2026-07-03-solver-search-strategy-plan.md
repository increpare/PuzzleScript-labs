# Solver Search Strategy Plan — turbo-charging beyond the current frontier

Written 2026-07-03. Handoff plan for structurally new solving approaches —
search lanes, pruning oracles, and transfer — aimed at levels the current
solvers cannot reach at any tuned setting. This is deliberately *not* another
heuristic-shape plan: the experiment log proves that space is exhausted
(see §2).

Companion documents:

- `2026-07-03-anonymous-game-500ms-optimization-plan.md` — JS engine/runtime
  (P1-P6, X1-X7)
- `2026-07-03-native-interpreter-optimization-plan.md` — C++ interpreter
  (N1-N10, NX1-NX4)
- `2026-07-03-static-analyzer-extension-proposals.md` — analysis families
  (S1-S18); several proposals below consume specific S-items
- `src/tests/JS_SOLVER_NEXT.md` — the canonical experiment log; read the
  TL;DR before touching anything here

Everything here compounds with the runtime plans: depth budget =
wall-clock ÷ step cost, and the runtime plans attack the denominator
(2-30x) while this plan attacks required depth and wasted steps.

## 1. Current solving stack (inventory)

- **Search modes** (`src/tests/run_solver_tests_js.js`, native
  `src/search/search_common.hpp`): BFS, weighted A* (w=2 default; wa8,
  deep variants), greedy, portfolio (priority-formula mixes), phase-split,
  naive; native adds HDA x8 parallel A*.
- **Heuristics**: ~35 named wincondition-shape distance heuristics
  (`HEURISTIC_FUNCTIONS`, run_solver_tests_js.js:2698) — all-on / some-on /
  no-on families over chamfer/matching distance fields, plus static
  dead-cell (A3) and region-isolation (D2) penalties. Default `auto` =
  per-condition router. Native mirrors via `winConditionHeuristicScore` /
  `matchingDistanceField`.
- **Perf substrate already landed**: version-keyed distance-field caches
  (R1), player-position cache (R3), fused restore+mask rebuild (R2),
  no-op probe plumbing (`PUZZLESCRIPT_SOLVER_NOOP_PROBE`).

## 2. Lessons already paid for (do not relearn)

From `JS_SOLVER_NEXT.md`, all measured on the full corpus:

- **The heuristic-shape space is exhausted.** The entire heuristic pass
  netted +14-17 solves at 250ms, compressing to ~5 at the 5s budget. Every
  D-series refinement (BFS-through-walls distances D1, push-access D7,
  lifecycle D4) was neutral or negative.
- **Budget density beats diversity.** Single best heuristic at 500ms = 700
  solved vs 631 for a phase-split giving two heuristics 250ms each (−69).
  Interleaved multi-heuristic portfolios: neutral-to-negative. Any new
  "lane" must run *instead of* the main lane (per level, per game, or per
  core), never interleaved within one budget.
- **Step waste dominates.** Of 8.10M step calls at 250ms: 38.3% no-ops,
  32.3% duplicates, 29.4% useful. The no-op slice ≈33% of solver wall time.
- **Occupancy-based no-op predicates are dead.** Measured: the "all player
  move-targets occupied" predicate covers 94.5% of no-ops but 38.4% of its
  fires are false positives (a push looks identical to a blocked move at
  cell level). Soundness requires rule-level reasoning.

## 3. What is actually out of reach (fresh corpus evidence, 2026-07-03)

Cross-join of historical corpus artifacts
(`build/solver-forensics/anonymous-js-first-500ms/historical/corpus-js.json`
vs `corpus-cpp-hda-8-compiled.json`, 1346 playable levels):

- **Depth is the discriminator.** JS-solved levels: median solution length
  24 (p90 = 53). The 252 levels HDA-compiled solves but JS misses: median
  38, p90 = 77, max 211. The hard tail is the same puzzles, deeper.
- **300 levels time out in both best configs** — the genuine frontier.
- **79% of the hard tail is intra-game transferable:** 238 of the 302
  HDA-timeout levels sit in games where HDA already solves sibling levels
  (76 such games). The mechanics are demonstrably tractable; the deeper
  instances are not. No current technique exploits this.

## 4. Proposals (T-series), ordered by expected impact

- **T1 — push-space search for certified transport games.** Search in push
  space, not move space: canonicalize the player position to its reachable
  region (bitboard flood fill per state), branch over walk-to-and-push
  macro actions. Effects: solution depth drops from move count to push
  count (typically 3-10x — exponential tree savings), and the
  player-position quotient collapses a large slice of the 32% duplicate
  steps. This is the standard architecture of every serious Sokoban solver,
  and the corpus is "heavily Sokoban-skewed" (log's words). Soundness:
  requires certifying walking is state-inert — the analyzer's mechanic
  schema classification (S10), which is also exactly why naive E1 failed
  (rule level distinguishes push from blocked; cell level cannot).
  Implement as a portfolio lane active only for certified games.
  Difficulty: medium-high. Prototype JS-first with a manual
  Sokoban-like whitelist before S10 lands.
- **T2 — rule-derived no-op oracle (E1 done right).** Per game, per
  direction, an analyzer-derived local predicate proving "no rule LHS can
  match a board whose only delta is player movement bits" (consumes
  S1-style certified read masks). Abstains when unprovable —
  false-negative-safe by construction; total for walker/pusher games.
  Directly reclaims up to ~33% of solver wall time (log's own estimate;
  probe plumbing already exists to validate coverage/soundness per game).
  Difficulty: medium. This supersedes any further occupancy-predicate work.
- **T3 — novelty search (IW / BFWS).** Width-based search from classical
  planning (Lipovetzky & Geffner): prefer states that make a *new atom*
  true. PuzzleScript atoms are (object, cell) bits, so novelty-1 is one
  vectorized `board & ~seenAccumulator != 0` test against an accumulator
  plane — far cheaper than a distance field. Novelty attacks exactly the
  failure mode distance heuristics have (plateaus where h doesn't
  discriminate); best-first width search (novelty + h tie-break) is
  state-of-the-art in planning without learned models. Half-day JS
  prototype; genuinely orthogonal signal. Difficulty: low. Risk: none
  as a tie-breaker; pruning variants (IW(1)) change completeness and
  need corpus A/B.
- **T4 — intra-game transfer (aimed at the 79% stat).** Two cheap forms:
  (a) *move-ordering priors* — input n-gram frequencies mined from solved
  sibling levels of the same game, used to order successor expansion
  (near-free per node, compounds in greedy/WA*); (b) *macro mining* —
  recurring input subsequences from sibling solutions become candidate
  macros in a dedicated lane. Schedule easy levels first, transfer, retry
  hard ones (per-game curriculum). Addressable pool: 238 currently
  unsolved levels. Difficulty: low for (a), medium for (b).
- **T5 — checkpoint and subgoal serialization lanes.** PuzzleScript's
  `checkpoint` command is a designer-provided landmark. A greedy lane that
  commits at checkpoints (clear visited, restart frontier from the
  checkpoint state) converts one depth-80 search into several depth-20
  searches. Similarly: goal-ordering serialization for multi-target all-on
  conditions (Sokoban goal-ordering literature). Both incomplete → run as
  lanes (see T7), never as the sole strategy. Difficulty: low (checkpoint
  detection is a command hook in the harness).
- **T6 — dead-end pruning with certificates.** Consume S9 (Petri-style
  count invariants → provably unwinnable states) and S11 (certified
  corner/freeze deadlocks for pusher-schema games) to *prune* rather than
  penalize. A3's +14 showed the shape works as a soft signal; proofs make
  it hard pruning, redirecting budget to live subtrees. Also yields
  level-unsolvability certificates (skip the whole budget). Difficulty:
  medium, mostly on the analyzer side.
- **T7 — heterogeneous parallel lanes (the portfolio result, inverted).**
  Within-budget portfolios lose (§2), but HDA proves 8 cores are available.
  Run *different* configs across cores — wa2 / greedy / novelty (T3) /
  push-space (T1) / checkpoint-commit (T5) — sharing only a solution flag.
  Diversity across cores does not dilute per-lane budget density, which
  reconciles the union-of-solves observation (different heuristics solve
  different levels; union 622 vs best-single 618) with the budget-density
  lesson. Difficulty: low-medium in native (lane configs exist as
  strategies); JS analog via `--jobs`-style process sharding.
- **T8 — input-relevance branching reduction.** Consume S3
  (direction-instance movement reachability): if input `d` provably cannot
  fire any state-changing rule in any reachable state, drop it from the
  action set. Branching 4→3 compounds exponentially with depth.
  Difficulty: low once S3 exists; certificate-backed, so no search risk.
- **T9 — plateau-adaptive lane switching (extends runtime plan P3).**
  Detect h_min stagnation (no improvement in K expansions) and switch
  in-place: raise w, go greedy, or hand the remaining budget to the novelty
  lane. Sequential (restart-shaped), so it respects budget density.
  Difficulty: low. Needs careful corpus A/B — restart heuristics are
  notoriously bench-sensitive.

## 5. Experiments (falsifiable, in order)

- **TX1 — novelty tie-break** (~0.5 day): greedy+novelty-1 vs greedy, full
  corpus at 500ms, serial bench discipline (±7 solve noise band per the
  log — use paired runs). Success: any net positive. Failure: novelty
  signal uninformative for grid rewriting — still worth knowing.
- **TX2 — push-space prototype** (~1-2 days): manual whitelist of ~20
  Sokoban-like corpus games; push-space lane vs baseline on that slice.
  Success metric: solves on the slice's current timeouts; also record
  push-depth vs move-depth ratio (predicts generalization). Failure:
  walking-inertness violations (validate with replay parity on found
  solutions) or region-flood cost dominating.
- **TX3 — sibling move-ordering priors** (~1 day): needs only the existing
  solutions directory + an expansion-order hook. Success: net positive on
  the 76 mixed games. Failure: priors mislead on levels that subvert their
  game's motifs.
- **TX4 — heterogeneous 8-lane native run** (~1 day): lanes = {wa2, wa8,
  greedy, bfs, + variants}, union-of-solves vs homogeneous HDA x8 on the
  300-level hard tail at equal total core-seconds. Success: union beats
  homogeneous. This experiment is valid before T1/T3 exist and gets
  stronger as lanes are added.
- **TX5 — checkpoint-commit lane** (~0.5 day): harness hook on the
  checkpoint command; bench on games that use checkpoints (grep the corpus
  for `checkpoint`). Small addressable set; cheap to know.
- **TX6 — no-op oracle coverage audit** (analyzer-side, ~1-2 days): emit
  the rule-derived predicate per game, replay against the existing probe
  ground-truth plumbing corpus-wide. Success: >50% of games with 100%-sound
  coverage; then wire into the solver.

Solve-count evaluation discipline (from the log): serial benches, paired
runs, report unions and per-level attribution, never compare wall-clock
counts across `--jobs` configurations.

## 6. Do not do (yet)

- **More distance-field heuristic variants or blends** — measured,
  exhausted, rejected (§2).
- **Within-budget interleaving or phase-splits** — decisively negative
  (−69 at 500ms).
- **Occupancy-based no-op predicates** — measured 38.4% false-positive;
  T2 is the sound replacement.
- **Learned/NN guidance** — premature while T1-T4 are unexplored; those
  are days of work with clear falsification, not months.
- **Backward/bidirectional search** — PuzzleScript goals are constraint
  sets, not states, and rule inversion is not well-defined; regression
  through rewriting rules is a research project, not a plan item.
- **Pattern databases** — precomputation cannot amortize inside per-level
  budgets; revisit only if a per-game (not per-level) cache story emerges
  alongside intra-game transfer (T4).

## 7. Key numbers

| Measure | Value | Source |
| --- | --- | --- |
| Corpus playable levels | 1346 | corpus artifacts |
| Best-config solved (HDA x8 compiled, historical) | 1035 | corpus-cpp-hda-8-compiled.json |
| Hard tail (timeout in both JS and HDA-compiled) | 300 | cross-join, this doc §3 |
| Hard-tail levels in games with solved siblings | 238/302 (79%) | cross-join, this doc §3 |
| JS-solved median solution length | 24 (p90 53) | corpus-js.json |
| HDA-solved-JS-missed median length | 38 (p90 77, n=252) | cross-join |
| Step waste at 250ms | 38.3% no-ops + 32.3% duplicates | JS_SOLVER_NEXT profiling pass |
| Whole-heuristic-pass yield | +14-17 @250ms, ~+5 @5s | JS_SOLVER_NEXT TL;DR |
| Single-best vs split portfolio @500ms | 700 vs 631 | JS_SOLVER_NEXT C1/C1b |
