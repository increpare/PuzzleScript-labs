# MIS95 game-wide optimizer integration

MIS95 now runs the shared static analyzer, solver optimizer, semantic canonicalizer
and source emitter in its workers. The browser bundle uses the same implementations
as the Node tools. Preparation happens once per worker initialization; board edits
and generated candidates project through an explicit original-to-solver object map.

Analysis treats every declared object as potentially present and requests only
mergeability, movement/ACTION and win-relevance facts. Cosmetic tags are derived
independently of fact-family selection. No authored-level reachability, count,
transient or setup-retirement facts are consumed. Random or error-bearing sources
retain their original solver. Native workers reuse the original native game when
no rule/object/layer reduction applies and native analysis independently proves
ACTION unnecessary (or original metadata already disables it).

Optimized solved results are replayed in the original JS game before generator
admission, effort/budget updates, or user-visible editing. Native optimized profiles
also retain an original native game for ordinary-runtime replay, with object-table
compatibility checks. A rejected path disables the optimized profile and retries
against the original JS game.

## Paired browser check

Command: `node src/tests/mis_optimization_browser.cjs`, installed Chrome on this
Apple silicon Mac. Four fresh worker runs per game/backend, in off/on/on/off order;
three repetitions of each selected board per worker. The first two playable boards
are used, plus two deterministic transformed candidates when the game supports the
test's Wall transform. One synthetic projection fixture and four bundled demos
exercise both JS and WASM. The older ALL GREEN TO BLUE source reports compiler
errors and intentionally exercises original-game fallback.

All **360 assessments** retained the same outcomes in both pair directions.
All **312 solved paths** independently replayed in the original JS engine. Preparation
was about **8–22 ms** for optimized profiles in this sample. The table sums both
baseline runs and both optimized runs, excluding preparation but including board
projection and original-game validation.

| Game | Backend | Baseline assessment time | Optimized assessment time | Change |
| --- | --- | ---: | ---: | ---: |
| Sokoban basic | JS | 196.5 ms | 179.2 ms | -8.8% |
| Microban | JS | 200.7 ms | 190.0 ms | -5.3% |
| Lunar Lockout | JS | 946.9 ms | 819.7 ms | -13.4% |
| Sokoban basic | WASM, existing reduction reused | 99.6 ms | 102.3 ms | +2.7% |
| Microban | WASM, existing reduction reused | 95.2 ms | 100.3 ms | +5.4% |
| Lunar Lockout | WASM, existing reduction reused | 133.6 ms | 136.3 ms | +2.0% |

These short checks establish wiring and replay correctness, not a universal speedup
or an end-to-end generator throughput estimate. Native passthrough uses the same
search path on both sides; its small timing differences include run noise. On the
tiny projection fixture, extra JS verification costs more than its sub-millisecond
native solve: 1.6 ms baseline versus 4.5 ms optimized across six assessments.
Larger games with removable rules/objects need separate throughput measurements;
the earlier static-tag consumer corpus report remains evidence for those reductions.

Raw data: [paired worker measurements](2026-10-25-mis-game-wide-optimization.json).

## Correctness coverage

`make mis_tests` includes portable/Node parity, aggregate WIN round trips,
original-to-canonical projection across 32-bit word boundaries, arbitrary injected
objects absent from authored levels, required ACTION, Simplify/Tighten in original
IDs, randomized-source fallback, failed-preparation fallback, rejected-solution
fallback before generator admission, native table compatibility and MESSAGE replay.
Canonical serialization now preserves aggregate AND win predicates rather than
silently emitting OR properties. Source-line pruning requires every expansion on
that source line to be proved irrelevant.

The main engine suite passes 794 tests. Canonicalizer, decanonicalizer, static
analyzer/setup, static optimizer, adversarial analyzer and testdata runner checks
also pass. Web tests exercise nested deployment and actual generation workers;
the desktop build includes the optimizer bundle and rebuilt WASM offline.
