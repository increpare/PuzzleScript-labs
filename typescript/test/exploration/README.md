# Small source-game exploration

This test tool generates complete readable PuzzleScript games and compares the
independent TypeScript implementation against pinned vanilla `57f9f6cb`. It uses
ordinary object names, unnamed collision layers, properties, rule text and cell
occupant arrays. It never records an engine's output as an expected board.

From the repository root:

```sh
npm --prefix typescript run explore -- --seed my-campaign --cases 200 --jobs 4 --out /tmp/ps-findings

# A larger, reproducible run with a machine-readable summary.
npm --prefix typescript run explore -- --seed interactions-2026-10-31 --cases 4096 --jobs 4 --out /tmp/ps-findings --json /tmp/ps-report.json

# Replay or reduce a saved JSON case after building.
node typescript/bin/explore.mjs --replay /tmp/ps-findings/case-HASH.json
node typescript/bin/explore.mjs --shrink /tmp/ps-findings/case-HASH.json --out /tmp/ps-reduced
```

The default campaign has 200 cases and four workers. `--start N` selects the
first case index; a seed/index pair is independent of scheduling and preceding
cases. `--jobs` accepts 1–16. `--timeout-ms` is each worker's time limit (default
5,000 ms); output also has a fixed size budget. Workers are killed on timeout,
output overflow or normal CLI shutdown. Each child loads and checks the native source
hashes before comparing. No preview servers or services are started.

The four families explore pushing/property transport, live multirow matching
with one/two ellipses, rigid retries with random objects/directions, and AGAIN
with checkpoint/cancel/restart. Boards are 1–4 by 1–3; tapes start with Action
and include movement, tick, undo and restart. Inputs use the portable corpus
encoding: 0=Up, 1=Left, 2=Down, 3=Right, 4=Action.

Compilation is compared completely before excluding a shared errorful or
uninstalled game. A candidate-only diagnostic is a discrepancy. Accepted,
error-free programs then run through the unchanged source-compiled session
oracle, including every input and automatic AGAIN observation, full RNG,
history, checkpoint/persistence events, sounds and return values. Candidate
operations cannot call native producers. Agreed warnings are permitted.

On the first failure, the campaign stops assigning new work and finishes the
already running children. Every in-flight failure is saved as JSON and `.ps`;
counts distinguish comparison assertions, other oracle exceptions, timeouts and
process/protocol failures. A native exception alone is not called a JS/TS
discrepancy. Unfinished campaigns never count unrun cases as passes.

Saved cases include the oracle revision/manifest digest, compiled candidate
module hashes, construction seed/index, execution seed, source model, input tape
and bounded failure evidence. Source identity counts exclude titles, seeds and
tapes. The writer preserves earlier files; replay requires the same oracle
authority but deliberately permits a changed candidate implementation.

## Reduction

Error-free findings are automatically reduced once per distinct failure
signature. The signature retains compilation/session phase, assertion or
exception category and a normalized differing field path. Runtime reductions
require compiler agreement with zero errors. Compiler-disagreement reductions
retain native error-free compilation, observed before candidate execution.

The reducer removes input/rule chunks, board rows/columns, optional occupants,
objects, properties and sounds. It keeps the execution seed and Player's cell.
Every accepted change strictly lowers an explicit lexicographic complexity.
It finds a local fixed point under these operations, not a globally smallest game.

`--shrink-checks` bounds search checks including original-case validation
(default 200). `--shrink-ms` is a search budget checked between worker runs
(default 30,000 ms). A running check can use its full per-case timeout, and a
separate final confirmation adds one check/timeout. Original validation is not
duplicated. A budget-limited result explicitly reports `fixedPoint: false`.
Unstable findings retain their original artifact and report reduction failure.

The tests intentionally inject candidate compiler diagnostics and incorrect
return values, boards, RNG and history. One injected return-value fault reduces
to one cell, no rules and one input; removing that input stops reproducing.
These are controls for the harness, not discovered engine defects.

## Initial campaign

[The saved report](campaign-2026-10-31.json) records seed
`interactions-2026-10-31`, indices 0–4095, with 1,024 cases per family:

- 4,096 compared games; no exclusions, failures, exceptions or timeouts.
- 28,859 session observations and candidate operations; 4,096 level loads.
- 4,027 distinct source programs, 104 rule sets and 3,566 initial boards.

The candidate engine is unchanged from local integration `24333ef1`. This
restricted grammar explores useful interactions; it does not cover the entire
language. A real finding still needs human interpretation and an explicitly
authored regression before export to `testdata.js`.
