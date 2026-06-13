# Supercharged JS solver — tree-shrinking via statically-certified transforms

Status: design approved, pending implementation plan.
Date: 2026-06-13.
Branch context: `supercharged-js-solver`, branched from `native-solver-auto-heuristic`.
Scope: **JS solver only** (`src/tests/run_solver_tests_js.js` + helpers). The
native C++ solver is explicitly out of scope for this work.

Success metric (chosen): **maximise solved-count on the `src/tests/solver_tests`
corpus at a fixed wall-clock budget** (250ms and 5s), measured with the existing
bench harness. No optimality requirement — solutions need not be shortest.

## 1. Background — why the fancy and naive solvers tie

The user observed that the naive greedy best-first solver (`src/tests/solver_naive.js`,
PuzzleScriptPlus-style: order by `getScore()` then path length) solves roughly
the same number of corpus levels as the weighted A* solver. Both the solver
progress log and the perf forensics report explain why:

- **Node *ordering* is not the binding constraint.** At a fixed wall-clock
  budget, solves are governed by `nodes_expanded × cost_per_node`.
- **~86% of search time is `step_ms`** — the engine running `processInput`
  per action (`JS_SOLVER_NEXT.md` profiling; `JS_SOLVER_PERF_REPORT.md`). The
  heuristic layer is ~10%.
- **The heuristic-shape space is exhausted.** Single best heuristic gains ~+5
  solves at the 5s budget; portfolios (C1/C1b) and new heuristics (D1/D4/D7)
  were all measured neutral-to-negative (`JS_SOLVER_NEXT.md`).

So both solvers fire essentially the *same enormous raw-button-press tree* at
the engine at the *same* engine-bound rate. Greedy-by-score and `f = depth + 2h`
merely reshuffle the order of a tree that is too big to exhaust. Reordering an
unexhaustable tree cannot move the needle — hence the tie.

The entire existing backlog is "reorder the tree" (heuristics) or "make each
node cheaper" (no-op steps, distance-field caching, the rule-matching ceiling).
Both are roughly linear. **What is absent is shrinking the tree itself** — the
structural moves that make serious Sokoban solvers 10–100× faster.

### 1.1 Relevant facts about the current solver (verified in source)

- Search is over raw button presses: `DIRECTION_ACTIONS` (`right/up/down/left`)
  plus an optional `action` token (`run_solver_tests_js.js:73-79`,
  `solverActionsForGame`).
- Dedup is an incremental **Zobrist board hash** over `level.objects` words with
  an `ignoredHashObjectWords` set (cosmetic/static words excluded) and a per-cell
  write hook `level.solverZobristUpdateCell` (`installZobristHash`, ~line 882).
- The hash includes the player object word, so different player positions are
  currently distinct states.
- Per-win-condition **static dead-cell masks** already exist
  (`staticDeadCellsCache` = `{corner, edge}` Uint8Arrays, built once via
  `inferStaticBlockerMask` + map boundaries, ~line 776). They are consumed
  **only as a soft heuristic penalty** today (`deadPositionPenalty`,
  `regionIsolationPenalty`).
- `getPlayerPositions` is a cached full-grid scan.
- Profiled step mix: **~41% no-ops** (`changed=false`), **~32% duplicates**,
  ~26% useful (`JS_SOLVER_PERF_REPORT.md`). A large fraction of both no-ops and
  duplicates is *player-walk noise* — pressing into walls, or wandering and
  returning to an equivalent board.
- Per the 2026-06-11 static-analysis audit
  (`memory/static-analysis-soundness-findings.md`), the open cosmetic/undo
  soundness bug **does not affect solvers, because solvers never undo.** Static
  inert/cosmetic/static-object claims are therefore safe to use for solver
  gating.

## 2. Strategy

Anchor: **tree-shrinking via statically-certified transforms, sequenced by
evidence.** Each transform is *gated per game* by a static analysis ("solver
profile") that certifies it is sound for that game; games that do not qualify
fall back cleanly to today's exact search. Throughput (perf-report) items are
kept in reserve as a compounding fallback, not the headline.

Rejected alternatives (recorded so they are not relitigated):

- *Throughput-only* (perf-report ceiling): exact and low-risk but capped at
  ~+12–25 solves; linear, not transformative.
- *Better heuristics / portfolios*: exhausted, see §1.
- *Full structural program in one build*: hardest to debug and to attribute
  solve-count movement; rejected in favour of evidence-sequencing.

## 3. Correctness model (the backstop that makes aggression safe)

Two layers:

1. **Solution-replay-verification as a hard invariant.** Every reported
   solution is replayed through the *unmodified* engine and must reach a win,
   or it is discarded as `invalid_solution`. The branch already has a replay
   path (the 469/469 trace-parity work); this design hardens it into a
   mandatory gate on every Tier > 0 solve.

   **Consequence:** any transform can only ever cause a *missed* solve
   (incompleteness), **never a false "solved."** This collapses the risk
   profile: static gates can be tuned *empirically against the corpus* (an
   over-aggressive gate shows up as fewer solves on specific games, surfaced by
   the bench), instead of requiring airtight up-front proofs.

2. **Per-game fallback ladder.** Each game runs the highest tier its solver
   profile licenses:
   - **Tier 0** — today's exact raw-button-press search. Always correct;
     the universal fallback.
   - **Tier 1** — Tier 0 + hard deadlock pruning (§5).
   - **Tier 2** — interaction-level (push-macro) search + reachability
     canonicalization (§6). Subsumes Tier 1's pruning.

## 4. The static "Solver Profile" pass

One analysis at level-load producing an immutable flags object, **reusing
existing machinery** rather than reinventing it (`inferStaticBlockerMask`,
`createStaticHashObjectWords`, the inert/cosmetic analysis in
`src/tests/solver_static_opt.js`, and `has_random`/`randomDir` tagging).

Flags (initial set; extended as gates are tuned):

- `playerIsSingleTranslatingObject` — exactly one player object, moves by
  grid translation.
- `walkInert` — the player moving onto a non-blocking, non-interactive cell
  fires no board-mutating rule (only its own position/movement bits change).
- `walkReversible` — an inert walk can be undone by the opposite press.
- `transitionsPathIndependent` — the set of board-changing interactions
  available depends only on `(board, player-reachable-region)`, not on the
  player's specific cell or the path taken to it.
- `boxObjects[]` — objects that are movable **and conserved** (never created or
  destroyed by any rule); eligible for deadlock pruning.
- `deadCellGateSound` — the dead-cell inference is valid given the rule set.
- `noRandom` — derived from `has_random` (already available).
- `noInputIndependentMutators` — no per-turn global / `late` rule mutates board
  state independent of input (would break walk-inertness / path-independence).

Each transform reads only the flags it needs; any unmet flag disables that
tier for the game. The profile is computed once per `loadLevel` and hung off
the solver specialization next to `staticDeadCellsCache`.

## 5. Slice 1 — Hard deadlock pruning (Tier 1; cheap, standalone, first)

Promote `staticDeadCellsCache` from a soft penalty to **subtree deletion**:
when a generated transition lands a conserved `boxObject` on a statically-dead
cell (a corner/edge it can never be pushed off, where the win condition
requires it elsewhere), **do not enqueue the child node.**

- **Why first:** it works on the *current* raw-button-press search unchanged —
  no new search engine required — and reuses masks already built. Fastest thing
  to land and measure.
- **Gate:** `boxObjects` conserved (Profile) ∧ `deadCellGateSound`. The
  win-condition shapes that have dead-cell masks today are the all-on/some-on
  placement conditions the masks were built for.
- **Safety:** the replay backstop turns any over-prune into a missed solve, not
  a wrong answer. Tune the gate against per-game lost-solve diffs.

Expected: removes whole subtrees on Sokoban-shaped levels; immediate bench
signal at both 250ms and 5s.

## 6. Slice 2 — Interaction-level (push-macro) search + canonicalization (Tier 2; the ceiling)

> **Note (corrected from initial framing):** reachability canonicalization and
> push-macro search are **the same slice**, not separable. Canonicalizing the
> player to its reachable region in the dedup key while still generating raw
> single presses is *incomplete*: the walk needed to set up a push elsewhere in
> the region collides with the canonical key and is pruned, removing the very
> walk that enables the other push. Completeness requires a canonical node to
> generate **all region-boundary pushes directly** (macro moves). Hence the two
> ship together.

For games whose profile is "Sokoban-inert" (`walkInert ∧ walkReversible ∧
transitionsPathIndependent ∧ playerIsSingleTranslatingObject ∧ noRandom ∧
noInputIndependentMutators`), replace move generation:

1. **Region BFS.** From a node, compute the player's inert-reachable region:
   - *Fast gate:* static grid-BFS over `blockerMask ∪ boxCells` (no engine
     steps) when the profile proves walking is pure translation blocked only by
     static blockers and box objects.
   - *General gate:* engine-validated walk-BFS — attempt each direction; a
     neighbour is in-region iff the step changes only the player's
     position/movement bits (board otherwise byte-identical). Sound by
     construction for walk-inertness; relies on the profile for
     path-independence/reversibility, with the replay backstop catching any gap.
2. **Macro move generation.** Emit one macro edge per board-changing
   interaction on the region boundary (each push / action-interaction). Edge
   cost = walk-distance + 1 (for solution length).
3. **Canonical dedup.** Key = `(board hash with the player word removed,
   canonical region cell)` where the canonical cell is the min tile-index of
   the region. Folds away every "player wandered around" duplicate — directly
   attacking the ~32% duplicate and ~41% no-op slices, which are largely walk
   noise.
4. **Solution reconstruction.** Expand each macro back into concrete presses
   (BFS walk path within the region + the pushing press), concatenate, then the
   Tier-0 replay gate (§3) confirms the full button sequence reaches a win.

Effect: branching factor drops from ~5-per-tile-walked to ~(#available pushes);
depth drops from (#presses) to (#pushes). This is the 10–100× regime on the
Sokoban-skewed corpus.

Shared infrastructure: the region BFS and walk-path reconstruction are reused
by both the move generator and the solution reconstructor.

## 7. Slice 3 — Throughput as compounding fallback

Keep the `JS_SOLVER_PERF_REPORT.md` items in reserve: cheaper no-op steps
(engine-side `processCommandQueue` short-circuit, shared undo backup, direct
word scans), version-keyed static distance fields, fused `restore()` +
row/col-mask rebuild. They are not the headline, but the Slice 2 region-BFS
*runs engine steps*, so cheaper steps compound directly with it. Pull in only
if structural wins underdeliver, or to accelerate the region BFS.

## 8. Measurement, gates, and decision points

- All transforms flag-gated; default behaviour unchanged until a tier is
  switched on.
- Measure with `src/tests/bench_solver.js` at **250ms and 5s**, paired runs,
  with per-game solve diffs (the F1 `--json` flow).
- **Parity mode** (à la `--solver-opt-parity`): assert every Tier-N solve
  replays through the unmodified engine, and track per-game *lost* solves vs
  Tier 0 to tune gate strictness.
- Instrumentation: existing counters (`expanded`, `unique_states`,
  `duplicates`, `step_no_op`) plus new `macro_edges_generated` /
  `region_bfs_steps` for Slice 2.
- **Decision gates:**
  1. Land Slice 1 (deadlock pruning); measure delta + lost-solve diff.
  2. Commit to Slice 2 only if Slice 1's delta plus the duplicate/no-op profile
     still justify the larger build (expected: yes).
  3. Pull Slice 3 items individually only when they unblock or compound a
     measured win.

## 9. Risks and mitigations

- **Walk-inertness violated** (trails, ice, growth, per-turn animation rules):
  caught by `walkInert` / `noInputIndependentMutators`; game falls to Tier 0/1.
- **Reversibility / path-independence violated** (one-way doors, irreversible
  consumption mid-walk): caught by gate flags; residual gaps caught by the
  replay backstop as missed solves, surfaced on the bench.
- **Non-translating / multi / absent player:** `playerIsSingleTranslatingObject`
  disables Tier 2.
- **Randomness:** `noRandom` gate; canonicalization assumes determinism.
- **Deadlock over-prune:** replay backstop + per-game lost-solve tracking.
- **Region-BFS cost** (engine-validated path): bounded because the region is
  computed once per *expanded canonical* node and replaces re-expanding those
  walks as separate frontier nodes; Slice 3 lowers per-step cost if needed.

## 10. Out of scope

- The native C++ solver.
- Optimal / shortest-solution guarantees.
- Further heuristic-shape work (exhausted; see `JS_SOLVER_NEXT.md`).
- Solver behaviour changes on non-qualifying games (must remain byte-identical
  to today at Tier 0).
