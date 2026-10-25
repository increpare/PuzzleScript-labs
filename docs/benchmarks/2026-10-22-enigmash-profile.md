# ENIGMASH: JS playback profile and optimization experiments

22 October 2026. Engine baseline: `5392d278`. Local Mac, Node v25.8.1,
and the installed Playwright Chromium and WebKit engines. These are
investigation prototypes; no production engine code was changed.

Follow-up: [individual optimization measurements](2026-10-22-enigmash-individual-optimizations.md)
isolates all three changes and reports repeated full-suite timings, per-game
regressions and their investigation.

## Reproduction and correctness

The supplied recording contains 109 inputs, starting at level index 1 with seed
`1792674318185.163`. Draining `again` produces 187 externally observed actions
and 188 state boundaries including the initial state. Three recorded inputs are
undo. Internal `again` lookahead performs additional simulations.

Use the separately supplied `enigmash.txt` as the game source. The recording's
embedded source is missing the literal `<l.....>` on map line 2520; this makes
the row nonrectangular and changes the simulation. HTML interpretation during
test-case export is a likely explanation, not a proven diagnosis of the export
path. With the intact game file, the unmodified engine reproduces the recording's
expected final state exactly. Differences between the two supplied vanilla
sources are mostly whitespace, plus that map fragment and a trailing level.

The playable map is 102 by 104: 10,608 cells, 261 objects, 86 collision layers,
9 object words and 18 movement words per cell. The runtime contains 674 early
rules and 339 late rules after expansion and deduplication.

Artifacts, including the intact source, recording, scripts, prototype patches,
JSON timing/state digests and profiles, are in the ignored local directory
`build/enigmash-profile/2026-10-22/`.

## What causes the stalls

The expensive work is reproducible without graphics or audio output. The
game clears and rebuilds its aesthetic objects over the entire map, every turn.
The ordinary rule matcher, replacement code and rule-group convergence checks
dominate this work.

One instrumented replay on the intact source measured:

| Source rule | Total inclusive rule time | Matching time | Rule visits |
| --- | ---: | ---: | ---: |
| 2240: `late [? ae] -> [?]` | 2,419 ms | 1,366 ms | 53,200 |
| 2238: `late [] -> [?]` | 699 ms | 60 ms | 532 |
| 2379: `late [?] -> []` | 479 ms | 63 ms | 532 |
| 2289: background-three sprite rebuild | 284 ms | 63 ms | 532 |
| 2284: wall-three sprite rebuild | 258 ms | 65 ms | 532 |

`ae` expands the cleanup rule into 100 runtime rules. This does not establish
that every cosmetic-looking rule is safe to suppress: for example, the existing
static analyzer does not classify `wallone` or the `?`/`near2` marker as cosmetic.

Inputs 24 and 25 each cause 12 externally observed turns including their `again`
cascade. They each take roughly a second to settle in the baseline. This is
aggregate simulation time across the cascade, not a claim that the browser runs
the whole cascade in one uninterrupted task. Each individual turn is already
long enough to cause a visible hitch. `again` also probes the following turn,
so it can pay for another full cosmetic rebuild before scheduling that turn.

## Measured engine-only prototypes

Three changes were applied to compiled runtime objects after compilation,
without changing the game source:

1. **Sparse constant replacements.** For deterministic replacements without
   rigid or dynamic binding behavior, generate operations only for object and
   movement words the replacement can change. Preserve sound creation/destruction
   masks and conservative row, column and map summaries. The existing general
   replacement copies and compares all 27 words even for tiny changes.
2. **Fused unary matching and replacement.** For deterministic, command-free,
   nonrigid, single-cell rules without cross-cell captures, test and replace in
   one scan. Mutating one cell cannot affect another candidate cell. This avoids
   materializing match arrays and rechecking every candidate after the first.
   Maintain the existing traversal order and row/column filters.
3. **One pass for an idempotent singleton group.** A single-cell, deterministic,
   constant replacement reaches its fixed point after one application per cell.
   A group containing only that rule needs no second full no-change scan.
   Groups with dynamic bindings, randomness, rigid behavior or commands retain
   the original path.

An exploratory Node run isolated the first two changes: each reduced replay
time by about a quarter; together they reduced it from about 12.3s to 6.6s.
Adding the narrow single-pass path reduced it further to about 6.2s. Those
exploratory comparisons used the damaged embedded source; the final checks below
all use the intact game and verify the recording's expected state.

| Runtime | Baseline simulation | All three prototypes | Speedup | 95th percentile action, before / after |
| --- | ---: | ---: | ---: | ---: |
| Node | 11.834s | 6.181s | 1.91x | 88.6 / 46.7 ms |
| Chromium | 12.697s | 6.127s | 2.07x | 95.7 / 46.3 ms |
| WebKit | 9.773s | 5.156s | 1.90x | 74 / 40 ms |

Chromium's slowest input including its cascade falls from 1.145s to 0.551s;
WebKit's falls from 0.883s to 0.473s. This improves responsiveness substantially
but does not meet a 16.7ms frame budget.

Timing is the sum of synchronous action durations, including nested engine
lookahead. Compilation, instrumentation setup and state hashing are excluded.
These are individual cold process/page pairs, not a statistical performance
claim across the whole game corpus. Browser runs use real JS engines with
headless shims for graphics/audio, not end-to-end editor rendering.

Correctness checks performed:

- All three runtimes reach the recording's exact expected final state.
- Baseline and optimized SHA-256 digests match at all 188 boundaries within
  each runtime. Digests cover objects, movements, RNG state, commands, sound
  history, `again`, winning, text/message state, level index and undo-stack
  depth. Node additionally includes rigid movement bookkeeping.
- The three prototypes, installed after each compilation, pass all 471 existing
  game simulation tests: zero failures and zero errors.
- Disabling existing incremental pruning and input specialization in an
  exploratory replay does not change its trace or resolve the bottleneck.

These checks are evidence for further implementation, not a complete proof or
a release gate. In particular the sparse prototype does not implement the
solver Zobrist hook, and the single-pass prototype does not preserve verbose
debugger timeline events. Production paths must preserve those or fall back.
Cross-cell binding, random and rigid paths retain the existing implementation.

## Where static analysis helps next

The existing analysis on the recorded source finds 102 cosmetic objects,
191 cosmetic rules and 69 of 95 reported rule-group flow facts with
`single_pass_safe`. These facts are useful starting points, but the initial
single-pass experiment above uses a narrower, direct runtime proof. Promote
sound certificates into shared compiler metadata before consuming broader
group optimizations in the browser. Existing native measurements also show
that fewer rule visits alone do not guarantee a speedup; retain this replay
as an actual wall-time benchmark.

The next substantial target is avoiding repeated scans of unchanged regions:

- Choose a mandatory positive object as a pattern anchor and maintain exact
  object/cell or chunk indexes. Enumerate possible origins from that anchor,
  then run the full original matcher in the original candidate order. Include
  every property alternative. Fall back for patterns without a useful anchor.
- Use object/movement dependencies, including negative predicates, to invalidate
  cached chunk or row matches. Account for movement clearing, undo, restart,
  level changes, rigid rollback and internal lookahead. Object-only dirtiness
  is insufficient.
- For a proven local deterministic aesthetic stage, consider caching its full
  output for unchanged logical inputs. Retain observable objects and turn/undo
  behavior. This needs a stronger certificate than the existing cosmetic tag.
- Consider coalescing property-deletion rules like the 100-way `ae` cleanup.
  Clear only layers whose aliases actually match. A naive union of replacement
  clear masks is unsound: this game's alias collision layers also contain
  non-`ae` objects such as warp/connector objects and the other barrier variants.

Do not automatically impose the old player radius. The original extension uses
`local_radius 17` and explicit `global` rule annotations; those are author-supplied
semantics. Proximity to the player alone cannot prove that distant rules are
irrelevant. An exact anchor/chunk index can reduce scans while retaining the
vanilla game's global behavior.

Do not apply the solver's cosmetic-object or cosmetic-rule deletion directly to
interactive play. `src/tests/STATIC_ANALYSIS_SOUNDNESS.md` explicitly scopes
those claims to forward solver search: undo and random draw behavior can differ.

## Recommended implementation order

First add a reusable opt-in replay/rule profiler, then implement sparse
replacements and fused unary scans with explicit fallback paths and regression
tests. Add the narrow singleton certificate after measuring its independent
benefit. Keep this complete recording as a parity and latency canary.

Then profile the remaining cost and prototype exact spatial candidate indexes
or a certified cached aesthetic stage. This is the route to eliminating the
remaining frame hitches without game edits.

The opt-in profiler should report source line, compilation expansion count,
rule/group passes, time matching versus replacing, cells scanned, candidate
tuple counts and user-input latency including `again`. Distinguish actual turns
from speculative probes and use exclusive phase timing so nested `processInput`
calls are not counted twice. Disabled profiling should leave the hot loop alone.

## Re-run the local artifacts

Run from the repository root. The artifact directory contains investigation
scripts, not production dependencies.

```sh
ARTIFACTS=build/enigmash-profile/2026-10-22
PROBE_OUT=/tmp/enigmash-baseline.json node "$ARTIFACTS/profile-replay.cjs" "$ARTIFACTS/recording.txt" "$ARTIFACTS/game.txt"
PROBE_PATCH="$ARTIFACTS/enigmash-sparse-probe.js,$ARTIFACTS/enigmash-fused-probe.js,$ARTIFACTS/enigmash-singlepass-probe.js" PROBE_OUT=/tmp/enigmash-optimized.json node "$ARTIFACTS/profile-replay.cjs" "$ARTIFACTS/recording.txt" "$ARTIFACTS/game.txt"
PROBE_RULES=1 PROBE_OUT=/tmp/enigmash-rule-profile.json node "$ARTIFACTS/profile-replay.cjs" "$ARTIFACTS/recording.txt" "$ARTIFACTS/game.txt"
node "$ARTIFACTS/profile-browsers.cjs" "$ARTIFACTS/recording.txt" "$ARTIFACTS/game.txt"
```

Browser harness results are written to `/tmp/enigmash-{chromium,webkit}-{baseline,optimized}.json`.
No HTTP server is started: Playwright fulfills the test page in memory.
