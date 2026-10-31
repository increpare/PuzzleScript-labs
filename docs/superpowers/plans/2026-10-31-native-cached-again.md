# Native cached AGAIN

**Goal:** Reuse native AGAIN lookahead in the interpreter and generated compact
C++ playback, matching current Labs JS semantics, and rebuild WebAssembly.
Baseline: Labs `a304a3e6`. Random lookahead isolation is already implemented;
this task must also eliminate the second simulation of an accepted continuation.

**Design:** Keep a prepared simulation and deferred outputs separate from the
visible session. Validate its source state and execution options before a TICK
commits it. Reuse allocated buffers across a chain. Invalidate on new input,
undo/restart, level/game/board/RNG changes, and incompatible execution options.
Solver/Drain paths must retain their established behavior and cheap state copies.
Generated C++ must exercise prepared turns as well as interpreted execution.

- [x] Establish native baseline and red simulation-count/effect regressions.
- [x] Implement interpreter cache, invalidation and deferred effect commitment.
- [x] Implement generated compact C++ equivalent with explicit backend coverage.
- [x] Cover deterministic/random/rigid chains, no-op/cancel/restart/win/message/
  checkpoint, audio, undo/restart/new input, state copies and solver options.
- [x] Benchmark identical native baseline/candidate work, including no-AGAIN and
  solver controls; report execution counts as well as timings and allocations.
- [x] Run native gameplay/diagnostics and relevant existing tests, preserving
  the known checkpoint-history baseline failure in reporting.
- [x] Rebuild WASM/release assets, run MIS and source JS smoke checks, review
  independently, document evidence, commit and integrate locally without pushing.
