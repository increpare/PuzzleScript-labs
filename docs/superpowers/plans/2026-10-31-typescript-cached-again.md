# TypeScript cached AGAIN implementation plan

**Goal:** Extend the approved JS/C++ cached-AGAIN design to the readable TypeScript
session engine, retaining its pinned vanilla compatibility contract.

**Architecture:** Retain only a prepared `TurnRulesResult` and its execution input,
before session effects. An internal WeakMap associates preparation with an exact
returned immutable session value; public spread/copies take the uncached path.
Validate board, complete RNG, pending movements, rigid marks, command message and
game identity before reuse. Clone prepared containers at commitment so repeated
branches and mutations of returned JS containers cannot alter private work.
Keep commitment in the existing session effect/history/win path.

Vanilla's probe mutates RNG, pending movements and bookkeeping and can emit effects.
Preserve that default through a new explicit `againProbeHasSideEffects` quirk.
Only reuse a vanilla preparation when the actual next simulation input still
matches the input that was probed. With the quirk off, probe on an independent
machine; keep ordinary state/effects private until commitment while making rule
diagnostics visible. `noQuirks` gets the isolated behavior already approved for
Labs. Do not change frozen vanilla sources, expectations or oracle hashes.

- [x] Establish a fresh strict-suite baseline and preserve its compiled modules.
- [x] Add red count regressions for deterministic 100-turn chains and clean random
  chains, plus independent pending-state/effect, branch-copy and invalidation cases.
- [x] Implement the prepared rule/effect split, WeakMap ownership, input guards,
  isolated clean lookahead and explicit vanilla compatibility switch.
- [x] Verify strict/pinned session parity; cover RNG fallback, late movements,
  rigid retries, undo/restart/advance/new input, win/message/checkpoint/cancel,
  speculative diagnostics, state mutation and repeated branching.
- [x] Compare baseline/candidate timing and actual rule work on identical sources,
  seeds and inputs; include ordinary-turn controls and full board/RNG outcomes.
- [x] Independently review, document limitations and results, commit and integrate
  locally; leave the main checkout clean and do not push.
