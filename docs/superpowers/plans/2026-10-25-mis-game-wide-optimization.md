# MIS95 game-wide solver optimization

**Goal:** Run the existing canonicalizer and static optimizer in MIS95's JS and WASM solver workers, using only ruleset-wide proofs valid for arbitrary generated boards.

**Design:** Keep the editor/model/transform representation unchanged. Compile a private semantic state, analyze it with every object considered potentially present, apply the existing inert/cosmetic/merge/ACTION/win-relevance passes, and canonicalize it with an explicit original-to-solver object map. Both backends compile the resulting source. Project each input board into solver IDs, and check solved paths in the original JS game. Cache preparation once per worker initialization. Random games and failed preparation use the original game. Simplification retains original object identities and uses the same projected solve interface.

Existing uncommitted work includes MIS95 and analyzer changes needed by this integration; work in this checkout and preserve those changes.

## Tasks

- [x] Extract portable canonicalization, semantic compilation, decanonicalization and compiled-state analysis APIs, preserving the Node entry points. Add browser/Node parity regressions before implementation.
- [x] Add arbitrary-board analysis mode: conservatively mark every object initially possible and request only mergeability, movement_action and win_relevance families. Do not consume per-level, count, transient, setup-retirement or authored-board projection facts.
- [x] Add an object provenance map to the optimizer hook. Test removal and many-to-one merge projection, source edits, required ACTION, random fallback, unsupported/error fallback and original-game solution replay.
- [x] Add a portable MIS solver-preparation/backend adapter. Optimize both JS and native solving/assessment, and use projected solves for simplify/tighten while returning original boards.
- [x] Bundle the portable helpers for offline worker loading. Integrate the bundle into source, static web, full-site and desktop builds; expose compact preparation telemetry in worker readiness for checks.
- [x] Run `make mis_tests`, canonicalizer/decanonicalizer/static analyzer/static optimizer regressions, real browser workers with both backends, web/desktop host checks as applicable, and paired candidate measurements with original-game replay.

Completed: shared browser/Node helpers, game-wide preparation, source/object provenance,
JS/WASM worker integration, editing and replay guards, rebuilt offline assets and
desktop package. Aggregate WIN and partial source-line proof defects found during
review were fixed with regressions. Both reviews have no remaining findings.
Validation: 794 engine tests, MIS/portable/aggregate/optimizer/analyzer suites,
360 paired browser assessments with 312 independent JS replays, nested-web actual
generation, native file tests and the packaged offline smoke check. Measurements
and scope are recorded in `docs/benchmarks/2026-10-25-mis-game-wide-optimization.md`.

## Acceptance

Both backends actually receive canonical optimized rules, merged/removed objects map correctly even when absent from authored levels, original source and board objects remain untouched, invalid optimization cannot produce a trusted solution, all bundled assets are present offline, and measured results distinguish preparation overhead from repeated solve work.
