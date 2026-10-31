# TypeScript cached AGAIN

This extends the approved [JS](cached-again.md) and [native](native-cached-again.md)
work to the readable TypeScript session engine, starting at Labs `fba2000a`.

## Behavior and compatibility

The cache retains only the result of rule execution, before session commands,
sounds, history, checkpoint, restart and win effects. The next null input reuses
that result through the existing session effect path. A WeakMap associates
private preparation with a returned session value; the public state shape is
unchanged. Copies and serialization discard only the optimization. Repeated
branches clone the preparation into independent returned containers.

Validation compares the game identity and all incoming rule inputs: board
objects and Set order, complete RNG, pending movements, rigid marks and command
message. Game/object/rule identities retain their existing immutable contract.
History and other session metadata are read fresh at commitment. Private probes
share the outer operation's owned snapshots until a helper replaces them; they
do not deep-copy the entire history a second time.

The default remains exact vanilla `5a94bde1`. Its new explicit
`againProbeHasSideEffects` quirk is on: old speculative random draws, movement
restoration, execution events, cancel sounds and checkpoint writes remain
observable. A prepared turn is reused only when the actual next input still
equals what was probed. Random draws and some late-movement cases therefore
take the old reevaluation path in this compatibility mode.

With the quirk off, ordinary speculative state and effects stay private, and
random continuations reuse the prepared draw. This is included in `noQuirks`;
callers may also disable only this switch while leaving the other vanilla
quirks on. Diagnostics remain visible at discovery and appear on a later real
commit just as they would under uncached execution. These are separate public
operations; diagnostics themselves never alias the private cache.

Frozen vanilla sources, oracle hashes and historical expectations are unchanged.

## Reproduction

```sh
npm --prefix typescript test
node typescript/tools/benchmark-cached-again.mjs BASELINE_BUILD typescript/build OUTPUT_JSON
node typescript/tools/audit-cached-again.cjs BASELINE_BUILD typescript/build OUTPUT_JSON 4 30
```

Build `fba2000a` separately for `BASELINE_BUILD`, retaining its TypeScript build
directory with a `package.json` containing `{"type":"module"}` if it is moved
outside the TypeScript package. Never overwrite baseline modules while comparing.
The benchmark times plain compiled games, counts early rule passes separately,
and computes complete final session/effect SHA-256 checksums outside the timer.
It uses the same sources, seeds and tapes for both implementations; compilation
and animation delay are excluded. Only pinned-vanilla timing controls are
compared, so intentional clean-mode random behavior changes do not weaken the
outcome check.

## Evidence

The original strict suite passed **1,750/1,750**. With the new regressions it
passes **1,779/1,779**, including unchanged compiler and frozen vanilla oracle
checks. The focused session/quirk subset passes **69/69**. Count regressions
first failed with 200 rather than 101 simulations; clean random isolation and
checkpoint-effect tests also failed before implementation.

The 100-turn deterministic chain now uses **101 rather than 200** rule passes
in vanilla and clean modes. A source-compiled random chain uses 101 with just
`againProbeHasSideEffects` off; vanilla's random fallback retains 200. Rigid
retry coverage verifies that a prepared retry result and its final failure
sound are reused. Additional tests cover deferred commands, rejected no-op
draws, mutable returned containers, Set order, branching, invalidation, late
movement fallback, history copying and diagnostic ownership.

Nine paired measurements in alternating process order, Node 25.8.1 on arm64,
three timed repetitions after two warmups per case, 1,000 cells and 100 visible
turns, all vanilla quirks on:

| Workload | Baseline | Cached | Median paired speedup | Early rule passes |
| --- | ---: | ---: | ---: | ---: |
| Deterministic AGAIN | 126.76 ms | 98.00 ms | 1.29× | 200 → 101 |
| Rigid AGAIN | 124.20 ms | 87.60 ms | 1.42× | 201 → 102 |
| Ordinary-turn control | 63.46 ms | 63.08 ms | 1.01× | 100 → 100 |

The rigid count includes the extra retry. Counts are collected independently
of timing. Final canonical session/effect SHA-256 checksums match in every
sample; canonical object identities use the fixture's unique names. These are
synthetic CPU timings, not predictions for every game. Raw samples and module
hashes are in the [measurement data](benchmarks/2026-10-31-typescript-cached-again.json).

An additional bounded audit selects **148 pinned corpus fixtures whose source
contains the word AGAIN**. Both baseline and candidate pass the frozen oracle
for **136** complete replays, with no failures or mismatches. The other **12**
hit the time limit on both versions and remain inconclusive. Each replay checks
source compilation and every session operation, including full RNG, sounds,
history, commands, checkpoint, persistence and level changes. The audit records
per-game time limits and outcomes; it does not claim all 478 corpus games pass.
The broader unbounded baseline run was stopped on the slow `collapse long` case.

[Audit data](benchmarks/2026-10-31-typescript-cached-again-audit.json) retains every
case and the input graphs' hashes. The audit tool resumes completed rows only
when both build graphs, fixtures, oracle helpers and tool hashes still match;
an altered-input rejection was verified. The historical seven-switch quirk
impact report remains unchanged and is labeled separately.

Independent implementation and tool review found no remaining actionable
issue. TypeScript remains a separate headless package; this change does not
rebuild the JS site or native WASM assets.
