# Cached AGAIN in Labs

**Goal:** Port vanilla's local `codex/cached-again` prototype (`92d045d3`)
onto Labs `631fee59`, reusing speculative turns during ordinary playback.
The user explicitly accepts changed random behavior for AGAIN; preserve the
immutable TypeScript vanilla reference and document current-Labs expectations.

**Design:** Separate simulation from effects/history, keep speculative RNG and
outputs private until commitment, reuse two board buffers, and invalidate pending
work on input, undo/restart, recompile, level changes and debugger changes.
Preserve Labs' sparse/capture/dynamic rule paths, input specialization and solver
fast path. Solver/MIS callers using `skipAgainProbe` must keep their existing
single-simulation path and state ownership.

- [x] Establish the clean core baseline and failing existing cached-AGAIN browser
  scenarios in `/Users/stephenlavelle/Documents/puzzlescript_testdump/ui/`.
- [x] Adapt the engine/RNG/console changes without replacing Labs-only code.
  Check caches, sound ownership, RNG, debug traces, level identity and solver hooks.
- [x] Independently review changed seeded fixtures against a baseline with only
  speculative RNG isolation; retain historical pinned-reference expectations.
- [x] Run meaningful solver/MIS regressions and inspect native interoperability;
  keep any pre-existing native differences visible.
- [x] Benchmark current Labs and adapted Labs in alternating order with matching
  games/work, including deterministic, random, rigid and ordinary-turn controls.
- [x] Rebuild standalone assets and check real browser timing/effects, exported
  games, undo/restart/recompile and cached buffer reuse across three browsers.
- [x] Review, record evidence and feature provenance separately from the vanilla
  master sync cursor, then commit and integrate locally without pushing.
