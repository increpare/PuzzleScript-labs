# Cached AGAIN

Ported on 31 October 2026 from the local vanilla branch `codex/cached-again`,
commit `92d045d3180eb03af34fc07fe6a56c87ebc298e8`, onto Labs `631fee59`.
The user explicitly approved changing random behavior for AGAIN.

## Behavior

Ordinary player/editor playback simulates the next automatic turn once, on a
separate board and cloned random stream. If that continuation will run, its
board, RNG, sounds, commands and debug trace remain private until the interval
expires. Commitment reuses that result. Two alternating level buffers avoid
allocating fresh board/movement/rigid storage throughout a chain.

Input, undo/restart, recompilation, level changes, a changed source board, an
externally advanced random stream, or changed debugger context invalidates
pending work. Runtime errors remain visible even when a speculative no-op is
discarded; ordinary verbose output is deferred to commitment.

Callback-backed RNGs cannot be cloned independently. They use a conservative
uncached path that schedules the automatic turn without speculative callback
calls; this can leave one final no-op interval. Seeded RC4 gameplay uses caching.

The four-argument `processInput` interface remains available. JS solver and MIS
search callers using `skipAgainProbe` keep their existing single-simulation path
and live level identity, including Zobrist hooks and input specialization. The
native interpreter and generated compact Yield probes restore their random
state after speculation. The subsequent [native cache implementation](native-cached-again.md)
also reuses accepted continuations in C++; solver/Drain execution retains its
existing uninterrupted path.

## Accepted random-sequence change

The old engine consumed random draws during a discarded probe, then drew again
when the actual turn ran. The cache commits the prepared draw; a discarded or
canceled candidate does not consume the live stream. Undo still retains draws
from real committed turns.

Eight recorded fixtures change: Cute Train, Sok7, Drop Swap 1/2/3, Tidy the Cafe,
JAM3 Game, and Expand/Avoid the Flames. Two authored AGAIN semantic cases and
the seeded startup-drain assertion also change. Sources, tapes and seeds stay
unchanged. Historical vanilla/TypeScript expectations remain pinned; authored
current-Labs boards use explicit `labsExpected` overrides.

Before updating expectations, an independent oracle used the original Labs
engine with only RNG cloning/restoration added around the old recursive probe.
All **632 gameplay cases** matched the adapted engine's final boards and sound
histories; all original cases passed their original expectations on the baseline.
Exactly ten failed their old board expectations on the candidate. This checks
the intended RNG change independently of the simulation/commit refactor.

## Paired measurements

Same Labs baseline and adapted Labs, fixed seed, 100 turns, four warm-ups per
implementation and 13 samples in alternating order. Compilation and animation
delay are excluded. These are synthetic simulation CPU measurements on this Mac
using Node 25.8.1; they do not predict every game's wall-clock improvement.

| Scenario | Baseline | Cached | Ratio |
| --- | ---: | ---: | ---: |
| 400 cells, deterministic AGAIN | 4.04 ms | 2.25 ms | 1.80× |
| 10,000 cells, deterministic AGAIN | 27.78 ms | 15.99 ms | 1.74× |
| 10,000 cells, rigid AGAIN | 130.76 ms | 88.51 ms | 1.48× |
| 10,000 cells, random AGAIN | 27.42 ms | 16.15 ms | 1.70× |
| 10,000 cells, ordinary turns | 81.63 ms | 84.70 ms | 0.96× |
| 10,000 cells, solver bypass | 13.00 ms | 13.06 ms | 0.99× |
| 10,000 cells, random solver bypass | 13.18 ms | 12.66 ms | 1.04× |

AGAIN cases execute **200 → 101** movement-resolution passes. Ordinary/solver
controls remain **100 → 100**. Deterministic boards/RNG and solver boards/RNG
match. The random AGAIN stream differs intentionally. The ordinary-turn control
is 3.8% slower in this run; the controls are not evidence of a universal speedup.

The standalone test collection owns the reproducible audit/benchmark tool,
`tools/assess-labs-cached-again.cjs`. Raw sources, hashes, all paired samples and
fixture observations are saved under
`puzzlescript_testdump/results/2026-10-31-labs-cached-again/`.
Portable timings and source hashes are also committed in
[the measurement data](benchmarks/2026-10-31-cached-again.json).

```sh
node tools/assess-labs-cached-again.cjs BASELINE_CHECKOUT CANDIDATE_CHECKOUT OUTPUT_DIR audit
node tools/assess-labs-cached-again.cjs BASELINE_CHECKOUT CANDIDATE_CHECKOUT OUTPUT_DIR bench
```

Run these from the standalone collection; both checkouts are read-only inputs.
The vanilla master sync cursor remains independent of this local-branch port.

The [TypeScript follow-up](typescript-cached-again.md) implements the same reuse
behind that engine's explicit vanilla compatibility boundary.

## Validation

- Core: **976/976**, plus random replay, stale-frontier, sparse replacement and
  callback-RNG regression checks. The initial port failed precisely the ten
  independently reviewed random AGAIN expectations.
- Pinned TypeScript semantics: **151/151**; pinned vanilla authored boards:
  **140/140**, with its two existing diagnostic messages. Frozen references and
  historical `expected` boards are unchanged.
- CM6: **216/216**; input-specialization parity: **640 cases**; intra-turn AGAIN
  and rigid contracts: **52 cases**. Solver startup drain, solver smoke with
  incremental-Zobrist verification, MIS tools, and `make mis_tests` pass.
- Native player API tests pass with the generated compact RNG fixture required.
  The regression failed before the change in both interpreted and generated
  execution. Native gameplay remains **631/632**: the sole failure is the
  pre-existing checkpoint-history undo-of-arrival case documented in the sync
  report. No new native gameplay mismatch accompanies the revised JS fixtures.
- Chromium, Firefox and WebKit: **69/69** cached-AGAIN cases, **21/21** player
  checks, **30/30** held-input checks and **12/12** export checks. This includes
  real interval timing, sound playback observations, buffer reuse, visible
  diagnostics, external RNG advancement, pending input, recompile/resize and
  MIS solve/play/watch/undo/restart.
- A broader input run is **135/147**. Its twelve issue-916 held-input timing
  failures reproduce unchanged on the baseline in all three browsers. The
  existing expectations and failure traces remain visible; they were not
  relaxed for this port.
- The unchanged diagnostics suite passes **5/13** on the candidate and **1/13**
  on the baseline. Every remaining failing case also fails on the baseline.
  Its duplicate-message and rule-loop-limit expectations remain unchanged;
  the candidate adds visible lookahead errors, rigid notices and exception
  restoration without claiming that older diagnostic work is complete.
- Standalone/release assets and the native WebAssembly backend were rebuilt;
  **257 Brotli sidecars** verify. Temporary browser servers are stopped after
  each run; no preview or deployment is created.

Standalone cached-AGAIN tests and the audit tool are committed in the private
collection as `494cf78`. Other concurrent coverage work in that checkout is
outside this change. Independent final integration review found no actionable
issue in the cache/effects split, invalidation, solver hooks or native RNG guards.

Browser artifacts remain in the standalone collection under `results/`:
`2026-10-31T07-52-03-034Z-ui` (candidate),
`2026-10-31T07-55-40-516Z-ui` (baseline timing),
`2026-10-31T07-56-18-589Z-ui` (candidate diagnostics), and
`2026-10-31T07-57-04-057Z-ui` (baseline diagnostics).
