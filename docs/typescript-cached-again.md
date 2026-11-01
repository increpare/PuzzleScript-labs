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

The readable turn refactor makes this boundary explicit. `calculateTurn` returns
one flat `CalculatedTurn`, including its `TurnInput`; `None` runs a turn without
player input. `finishTurn` handles actual session consequences. `prepareAgain`
calculates None and calls `observeProbe` directly, with no recursive general
session step or mutable capture parameter. Only the calculation is retained.
The existing Movement|null public APIs and their result schemas remain intact.

Private association, complete reuse validation and result copying live in
`typescript/src/prepared-again.ts`. The public API passes the pending record into
its working session explicitly. Current viewport/history, restart targets and
win options are read during actual completion; preparation never captures them.
See the [reading walkthrough](../typescript/READABILITY.md#5-a-calculated-turn-can-be-inspected-now-and-finished-later)
and [implementation audit](superpowers/plans/2026-11-01-turn-lifecycle.md).

Validation compares the game identity and all incoming rule inputs: board
objects and Set order, complete RNG, pending movements, rigid marks and command
message. Game/object/rule identities retain their existing immutable contract.
History and other session metadata are read fresh at commitment. Private probes
share the outer operation's owned snapshots until a helper replaces them; they
do not deep-copy the entire history a second time.

The cache originally targeted vanilla `5a94bde1`; the reference refresh advances
the default to `57f9f6cb`. Its new explicit
`againProbeHasSideEffects` quirk is on: old speculative random draws, movement
restoration, execution events and cancel sounds remain observable. The refreshed
checkpoint fix prevents checkpoint writes during speculative turns. A prepared turn is reused only when the actual next input still
equals what was probed. Random draws and some late-movement cases therefore
take the old reevaluation path in this compatibility mode.

With the quirk off, ordinary speculative state and effects stay private, and
random continuations reuse the prepared draw. This is included in `noQuirks`;
callers may also disable only this switch while leaving the other vanilla
quirks on. Diagnostics remain visible at discovery and appear on a later real
commit just as they would under uncached execution. These are separate public
operations; diagnostics themselves never alias the private cache.

The cache change itself left frozen sources and hashes unchanged. The separate
reference refresh updates them to `57f9f6cb`; current verification is recorded in
the [refresh audit](superpowers/plans/2026-10-31-typescript-vanilla-refresh.md).

The subsequent turn-structure refactor passes **2,134 strict tests**, including
the existing deterministic/private-random reuse counts, vanilla RNG fallback and
rigid-result reuse. Eleven new session witnesses check current commitment
context and probe branch ordering. A fresh generated campaign passes **256 games**
and **1,822 per-operation observations**. The
[turn audit](superpowers/plans/2026-11-01-turn-lifecycle.md) keeps this evidence
separate from the original cache timings and its bounded recorded-game replays.

## Reproduction

The commands and measurements below belong to the original cache commit
`8628b57e`, with the historical `5a94bde1` oracle. Check out that commit before
reproducing them with the `fba2000a` baseline. The current oracle requires the
refreshed behavior profile, so its audit tool cannot compare that old build.

For a new comparison at `57f9f6cb`, copy the current candidate build to a separate
baseline directory and replace only its `session.js` and `session.js.map` with
the uncached versions built from `6f40be98`. This keeps both sides' parser,
compiler, oracle and eight-switch compatibility profile identical. Use those
directories with the commands below; the old timings are not measurements of
the refreshed authority.

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
