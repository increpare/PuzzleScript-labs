# Level Simplifier Design

Status: design approved, pending implementation plan.
Date: 2026-06-23.
Revision 2026-06-23 (performance pass): trace envelope now *classifies and
batches* candidates instead of pruning them away; per-trial BFS gets an
expansion cap derived from the baseline; greedy restart-on-accept replaced with
a single linear forward pass. See §4, §5, §7.
Branch context: `master`, pre-implementation. Builds on the existing native
generator (`native/src/generator/`), difficulty assessment
(`native/src/search/difficulty.cpp`), and C API solver
(`ps_solve_level_layer_cell_object_ids`).

## 1. Background

The declarative level-set generator and remix pipeline produce solvable levels
by sampling object placements, then keeping the hardest variants per block.
Generated levels are often **visually and mechanically busier than necessary**:
extra crates, floor decoration, or isolated objects that do not affect the
optimal solution length.

A **simplifier** post-processes an accepted level by removing redundant objects
while preserving a concrete puzzle invariant. The brainstorm considered full
state-space graph isomorphism (correct but intractable at generator scale) and
lighter proxies (rule-match masks, solution replay). The chosen criterion is:

> **Same optimal solution length** — the shortest number of inputs to win is
> unchanged after simplification.

This does not require the same move sequence, the same search difficulty, or
graph isomorphism. Removing clutter that only inflated the search tree without
affecting optimal depth is explicitly in scope.

## 2. Goals and non-goals

### Primary goal

A standalone pass that loads **any** PuzzleScript game, simplifies every playable
level, and writes a new game file — fewer occupied cells per level, with BFS
optimal solution length unchanged. Shipped as a dedicated `puzzlescript-simplify`
binary built on a reusable, dependency-free library primitive:
`simplifyLevel(compiled game, LevelTemplate, reference solution) → simplified
LevelTemplate`.

### Hard invariants

- Simplified level must remain solvable.
- `BFS(simplified).length == BFS(original).length`.
- Simplification never runs on levels whose baseline BFS did not complete within
  the configured timeout (fail closed: return the input level unchanged and
  mark `complete = false`).
- **Non-deterministic games are never simplified.** BFS optimal-length
  equivalence is undefined when any rule is random (a fixed-seed BFS proves only
  a seed-specific length, unsound for actual play). If the game contains any
  random rule (`Rule::isRandom`, or a random-entity/random-dir replacement),
  fail closed: return the input unchanged with `complete = false`.

### Success metrics

| Metric | Target |
| --- | --- |
| Object count reduction on remix corpus samples | Measurable decrease on ≥50% of tested levels |
| Optimal length preserved | 100% on all accepted simplifications |
| Simplifier wall time per keeper | Bounded to `baseline BFS + (inside-envelope count + k·log n) capped trial BFS`; in practice a small multiple of one optimality-proof solve (§7) |
| False acceptions (shorter alternate path introduced) | 0 (enforced by BFS gate) |

### Non-goals (v1)

- Full state-graph isomorphism or merge-detection across levels.
- Preserving difficulty metrics (`expandedPortfolio`, etc.) — simplification
  may make puzzles easier to *find* while keeping optimal depth.
- Preserving the exact optimal move sequence.
- Shrinking level dimensions (bounding-box crop) — only per-cell object removal.
- Identifying which objects are "decorative" by static analysis alone without
  solver verification.
- Generator keeper-admission integration (`--simplify-on-keep`): deferred to a
  future iteration — the standalone pass is the v1 path. See §10.
- JS engine / editor integration — native binary only for v1.

## 3. Equivalence criterion

**Accepted deletion:** clearing one cell's object(s) to background passes both
gates below.

**Rejected deletion:** either gate fails.

Equivalent levels are those with the same **BFS optimal input count**. Different
optimal paths of the same length are allowed. Levels where removal creates a
shorter winning path are rejected even if the reference solution still works.

## 4. Algorithm

### 4.1 Baseline

1. Convert `LevelTemplate` → layer-cell object-id grid via
   `levelTemplateToLayerCellObjectIds`.
2. BFS solve the original level (`PS_SOLVE_STRATEGY_BFS`) with the configured
   timeout. This baseline runs **uncapped** (timeout-bounded only) — it must
   prove the true optimal depth, so it is categorically more expensive than the
   solve performed at keeper admission (which finds *a* solution via a fast
   portfolio and runs only a tightly capped supplemental BFS). Budget for it as
   a full optimality proof, not a re-run of the admission solve.
3. Record `optimalLength = solution.size()` **and `baselineExpanded =
   result.expanded`**. If BFS does not solve within limits, abort simplification
   and return the input unchanged (`complete = false`).
4. Derive the per-trial expansion cap used by every subsequent deletion check:
   `trialMaxExpanded = bfsMaxExpanded` if the caller set it non-zero, else
   `baselineExpanded * bfsExpandedFactor` (default ×2). See §7 for why this is
   safe.

The reference solution carried on the keeper is the *portfolio* solution, which
is **not guaranteed optimal** (the admission supplemental BFS records only its
expansion count and never overwrites the stored solution). It is therefore used
only for the fast replay gate and for trace-based candidate classification — the
baseline BFS above sets the authoritative `optimalLength`.

### 4.2 Candidate set and trace classification

Enumerate every occupied cell across all layers, producing
`(layer, x, y, objectId)` deletion candidates. Exclude:

- The player spawn cell (initial player position at level load).
- Empty / background cells (nothing to delete).

When `useTraceBatch = true` (default on), classify candidates using the
reference-solution trace:

1. Replay the reference solution on the original level using
   `ps_full_state_turn` (solver mode).
2. Record the **solution trace envelope**:
   - every cell the player occupies after each input;
   - every cell where any object's occupancy changed during replay.
3. Split candidates into two sets:
   - **Outside-envelope** candidates — cells the solution never touches. These
     are the floor decoration, isolated objects and surplus clutter the feature
     exists to remove; removing them is *highly likely* safe. They are handled
     as a single batch (§4.4 phase 1) — **not dropped**.
   - **Inside-envelope** candidates — cells on the solution's path or whose
     occupancy changed. These are mostly load-bearing; handled individually
     (§4.4 phase 2).

> **Note:** an earlier draft *dropped* outside-envelope candidates. That is
> backwards — it discards exactly the safe-to-remove clutter while keeping the
> objects most likely to be rejected, paying BFS cost for almost no reduction.
> The envelope is used to *prioritise and batch*, never to prune away the
> primary removal targets.

Classification is a performance/efficacy heuristic only. Correctness is enforced
by the replay and BFS gates in every phase, evaluated against the live
(already-simplified) board.

### 4.3 Candidate ordering (inside-envelope phase)

The outside-envelope set (§4.4 phase 1) is removed as a batch, so ordering there
is irrelevant. Within the inside-envelope individual phase, try deletions in
this order (does not affect correctness, only how quickly clutter is found):

1. Objects on layers that never changed during reference-solution replay.
2. Objects adjacent to background on ≥3 sides (likely visual clutter).
3. All remaining candidates.

When `useTraceBatch = false`, there is no batch phase: every candidate is treated
as inside-envelope and runs through the individual phase in this order.

### 4.4 Deletion: batch first, then a single individual pass

Both phases share the same two gates, always evaluated against the **current
working board** (objects accepted so far are already removed):

**Fast gate (replay):** load the modified level, apply each input in
`referenceSolution` via `ps_full_state_turn` (solver mode). Reject if the session
does not reach win. Cost: O(solution length), microseconds to low milliseconds.
Note this only filters candidates the reference path *needs* — decorative
removals pass replay and rely on the BFS gate.

**Strong gate (BFS):** solve the modified level with BFS, capped at
`trialMaxExpanded` (§4.1) and `bfsTimeoutMs`. Accept only if solved and
`solution_count == optimalLength`. Reject if unsolved, timed out, **cap hit
without proof**, or a strictly shorter solution found.

#### Phase 1 — batch removal of the outside-envelope set

This is the main performance lever and the main source of reductions.

```
batch = all outside-envelope candidates
trial = working board with every cell in `batch` cleared
if gates(trial) pass:
    accept whole batch in ONE BFS; working board = trial
else:
    bisect(batch)          # delta-debug; isolates the few outliers
```

`bisect(S)`: re-evaluate the gates with the *whole* of `S` removed from the
current working board.
- pass → accept all of `S` (apply to working board), return.
- fail and `|S| == 1` → reject that single object, return.
- fail and `|S| > 1` → split `S` in half and `bisect` each half in turn (the
  second half is evaluated after the first half's acceptances are applied).

Because each accept is verified directly by the gates, bisection is always
correct; it only bounds BFS count to `O(k log n)`, where `k` is the number of
non-removable outliers (usually 0 — the whole batch passes in one BFS).

#### Phase 2 — single forward pass over inside-envelope candidates

```
for each candidate in inside-envelope order (§4.3):
    ++candidatesTried
    trial = working board with (layer, x, y) cleared
    if not replay(referenceSolution, trial): ++replayRejections; continue
    if BFS(trial).length != optimalLength:   ++bfsRejections;    continue
    accept: working board = trial; ++objectsRemoved   # no restart — continue
```

**No restart-on-accept.** Every acceptance is gate-verified against the
*cumulative* working board (prior removals already applied), so the final board
is always directly proven optimal — correctness never depends on re-scanning.
Restart-on-accept only chased rare *second-order* acceptances (a candidate that
becomes removable after some other object is gone), at quadratic BFS cost. v1
uses a single linear forward pass; a bounded re-pass is noted in §10.

### 4.5 Clearing semantics

Deletion sets the target layer cell to empty (`-1` in the layer grid) and
rebuilds the `LevelTemplate` via `levelTemplateFromLayerCellObjectIds`. Objects
on other layers at the same `(x, y)` are untouched. Multi-object same-cell
occupancy (if present in a game) clears the specified layer cell only.

## 5. API

New module: `native/src/search/simplify.hpp` / `simplify.cpp`.

```cpp
namespace puzzlescript::search {

struct SimplifyOptions {
    int64_t bfsTimeoutMs = 5000;
    // Per-trial BFS expansion cap. 0 = derive from the baseline solve as
    // baselineExpanded * bfsExpandedFactor (recommended). Non-zero overrides.
    uint64_t bfsMaxExpanded = 0;
    double bfsExpandedFactor = 2.0;
    // Classify candidates via the reference-solution trace and batch-remove the
    // outside-envelope set first (one BFS for the batch, bisect on failure).
    bool useTraceBatch = true;
};

struct SimplifyResult {
    LevelTemplate level;
    int32_t optimalLength = -1;
    int64_t baselineExpanded = -1;
    int32_t objectsRemoved = 0;
    int32_t candidatesTried = 0;
    int32_t replayRejections = 0;
    int32_t bfsRejections = 0;
    int32_t bfsCalls = 0;          // total BFS solves (baseline + trials)
    bool complete = false;         // true iff baseline BFS finished
};

SimplifyResult simplifyLevel(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& referenceSolution,
    const SimplifyOptions& options);

} // namespace puzzlescript::search
```

Internal helpers (not exported):

- `replaySolution` — returns win/loss after applying inputs.
- `buildSolutionTrace` — returns the envelope `(layer, x, y)` set used to split
  candidates into outside/inside-envelope.
- `bfsSolve` — wraps `ps_solve_level_layer_cell_object_ids` with BFS strategy and
  a `max_expanded` cap; returns `{solved, length, expanded}`.
- `bisectRemove` — delta-debug helper for the phase-1 batch fallback.

## 6. Integration

### 6.1 Library-first

`simplifyLevel` is a standalone search utility in `puzzlescript_native` with no
generator or CLI dependency. The binary — and any future caller — links it.

### 6.2 Standalone `puzzlescript-simplify` binary (primary v1 path)

A dedicated binary:

```
puzzlescript-simplify <in.ps> --out <out.ps>
    [--solver-timeout-ms N] [--simplify-timeout-ms N] [--bfs-expanded-factor F]
```

Per game:

1. Compile the game (parser → `lowerToRuntimeGame` → `attachLinkedCompiledRules`).
2. If the game uses randomness, emit every level unchanged (simplification is
   undefined under non-determinism, §2); still write a complete output file.
3. Walk levels in order:
   - **Message screen** → preserved verbatim (`message <LevelTemplate.message>`).
   - **Playable level** → portfolio-solve within `--solver-timeout-ms`.
     - *Unsolved within the timeout* → emit the level unchanged, continue.
     - *Solved* → `simplifyLevel(...)` with the portfolio solution as the
       reference; then re-solve the simplified level for an accurate
       `(solution: …)` comment.
4. Rewrite **only** the `LEVELS` section via `replaceLevelsSection`. Everything
   else — prelude, `OBJECTS` / `LEGEND` / `SOUNDS` / `RULES` /
   `COLLISIONLAYERS` / `WINCONDITIONS`, message screens, level ordering —
   round-trips untouched.
5. Print a per-level summary to stdout (`level 3: removed 7, optimal 24` /
   `level 5: skipped (unsolved)`).

**The pass never aborts on a hard or random level** — those pass through
unchanged, so the output is always a complete, playable game.

### 6.3 Makefile target

```
make simplify IN=path/to/game.txt OUT=path/to/out.txt
```

Thin wrapper over `puzzlescript-simplify`.

## 7. Cost control

BFS here proves *optimality* (no shorter solution exists), which is a different
and heavier task than the admission solve (which just finds *a* solution). Every
lever below exists to keep both the number and the unit cost of these proofs
bounded.

| Stage | Cost |
| --- | --- |
| Baseline BFS | One full optimality proof, uncapped / timeout-bounded. Once per level. Heavier than admission's capped supplemental BFS. |
| Phase 1 batch (outside-envelope) | **1 capped BFS** when the whole batch is safe (the common case). On failure, `O(k log n)` capped BFS via bisection (`k` = non-removable outliers). |
| Phase 2 individual (inside-envelope) | ≤1 capped BFS per inside-envelope candidate, single forward pass (no restart). |
| Replay gate | O(solution length) per trial; sub-millisecond. Filters only candidates the reference path *needs* — decorative removals pass replay and rely on the BFS gate. |

**Per-trial expansion cap (the key guard).** Every trial BFS is capped at
`trialMaxExpanded = baselineExpanded * bfsExpandedFactor` (default ×2). This is
safe because removing an object only relaxes the puzzle: a same-length removal
expands ≈ baseline or fewer states, while a shortcut-opening removal finds its
shorter solution *early* (far under the cap). A trial that hits the cap without
proving optimality is rejected (object kept). So each trial is bounded to ≈
baseline cost, and the total is `baseline + (insideEnvelopeCount + k·log n)`
capped trials — in practice a small multiple of the one-time baseline solve.

Guards:

- `bfsTimeoutMs` — per BFS call (baseline and every trial).
- `trialMaxExpanded` — per-trial node cap derived from the baseline (above);
  override with `bfsMaxExpanded`. Cap hit ⇒ reject the deletion.
- If the baseline BFS times out, skip the entire simplification pass
  (`complete = false`).
- The solver has **no depth bound** (`ps_solve_options` exposes `max_expanded`
  but not a max depth), so the expansion cap is the practical substitute for a
  "no win below depth L" check.

## 8. Error handling

| Condition | Behavior |
| --- | --- |
| Game uses randomness (any random rule) | Skip simplification entirely; return input, `complete = false` |
| Baseline BFS timeout | Return input level, `complete = false` |
| Empty reference solution | Skip replay gate; rely on BFS only |
| Level load error after deletion | Reject deletion |
| BFS timeout on modified level | Reject deletion (do not accept) |
| BFS expansion cap hit without proof | Reject deletion (do not accept) |
| All candidates rejected | Return level unchanged, `complete = true`, `objectsRemoved = 0` |
| Level unsolved within `--solver-timeout-ms` (binary) | Emit the level unchanged; continue with the next level |
| Random game (binary) | Emit every level unchanged; still write a complete output file |
| Message screen (binary) | Preserved verbatim |

Simplification is idempotent: running twice on an already-minimal level is a
no-op.

## 9. Testing

### Unit tests (`native/tests/simplify_level.cpp`)

1. **Redundant crate** — hand-built Sokoban micro-level with an extra box not on
   any optimal path; simplifier removes it; optimal length unchanged.
2. **Blocking shortcut** — extra box blocks a shorter route but is not on the
   reference solution path; replay passes, BFS rejects; object kept.
3. **Player spawn** — spawn cell never in candidate set.
4. **Idempotency** — second `simplifyLevel` call removes zero objects.
5. **Batch removal** — level with several off-path decorative objects; phase 1
   removes them in a single (or `O(log n)`) BFS; `result.bfsCalls` stays small
   and `objectsRemoved` equals the decoration count.
6. **Bisection** — batch containing one shortcut-opening object among safe ones;
   bisection keeps the outlier and removes the rest.

### Integration smoke

`src/tests/run_simplify_smoke.js` drives the `puzzlescript-simplify` binary on a
stock demo game (not just generator output):

- The output is a complete game: non-`LEVELS` sections byte-identical to input,
  message screens preserved, level count unchanged.
- Every level still solves, at the same BFS depth as the corresponding input
  level.
- No level's object count increases; at least one level decreases where the
  fixture has removable clutter.

### Manual validation

Run `--simplify` on a remix output game; visually inspect that levels look
cleaner and replay comments still match optimal length.

## 10. Future extensions (out of v1 scope)

- Generator keeper-admission hook (`--simplify-on-keep`): call `simplifyLevel`
  inside `block_scheduler` with difficulty re-assessment. Deferred because of the
  selection/dedup coupling (stale difficulty, wasted work on evicted candidates,
  dedup on the pre-simplified hash) — the standalone binary avoids all of it.
- `--strict` mode: also require `expandedPortfolio` within ε of original.
- Bounding-box crop after object removal (shrink `width`/`height`).
- Bounded second forward pass over inside-envelope candidates to recover the
  rare second-order acceptances dropped by the no-restart rule (§4.4).
- A `max_depth` solve option so trials can prove "no win below depth L" directly
  instead of via the expansion-count cap.
- JS solver path for editor-side "simplify this level" preview.
- Rule-fire mask as additional candidate filter (on top of trace envelope).

## 11. Open decisions resolved

| Question | Decision |
| --- | --- |
| Equivalence criterion | Same optimal solution length (goal A) |
| Graph isomorphism | Not used |
| Rule-match mask alone | Candidate filter only, not correctness |
| Reference solution role | Fast replay gate + trace classification; baseline BFS sets optimal length |
| Trace envelope use | Classify + batch outside-envelope removals (never prune them away) |
| Per-trial BFS cap | Derived from baseline expansions ×`bfsExpandedFactor`; cap hit ⇒ reject |
| Restart-on-accept | Removed — single linear forward pass (each accept verified vs cumulative board) |
| Non-deterministic games | Skipped, fail-closed (BFS equivalence undefined under randomness) |
| Integration | Dedicated `puzzlescript-simplify` binary; generator keeper hook deferred (§10) |
| Difficulty preservation | Not required for v1 |
