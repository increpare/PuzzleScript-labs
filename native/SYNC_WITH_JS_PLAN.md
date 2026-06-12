# Plan: bring the native C++ compiler/solver up to date with the JS implementation

Status snapshot measured 2026-06-12 (cloud container, branch
`claude/js-parser-compiler-perf-ezo853` == master `9141d45`). Companion docs:
`native/PLAN.md` (original port milestones), `native/src/solver/
HEURISTICS_IMPLEMENTATION.md` (native heuristic checklist),
`src/tests/JS_SOLVER_NEXT.md` (JS experiment ledger — the list of *validated
winners and losers* that drives Phase 2 below).

## Where parity actually stands (measured, not assumed)

| surface | state |
|---|---|
| runtime semantics | **469/469** sim corpus passes natively (`puzzlescript_cpp test simulation-corpus`, 1.6s vs ~12s JS) — includes the property-inference / aggregate-binding / rigid / random test cases |
| compiler diagnostics | **274/274** diagnostics corpus passes (`test diagnostics-corpus`, 0.1s) |
| per-turn trace parity (32-bit) | **unknown** — `simulation_tests_cpp_js_parity` not run in this pass; re-baseline in Phase 0 |
| solver search layer | **years behind JS**: one hardcoded heuristic (`winconditions`; `native/src/solver/main.cpp:1297`) vs JS's ~33 heuristics, `auto` per-condition router, A3 dead-cell cache, D2 region isolation, exact version-keyed field caches. Native wins on raw speed (62.2% vs 53.5% of corpus at 1s) purely by being ~4-5× faster per step |
| behavioral drift | (a) 4 levels classified `skipped_message` by native but playable by JS (`car crash` 1, `cratopia` 3); (b) `a distant sunset.txt` — JS parser falls apart on keyword-glyph object names (`^`,`|`,`>`), native compiles all 172 levels; (c) today's JS change making duplicate `no X` a warning has no native counterpart fixture |

Conclusion: the compiler and runtime are *not* meaningfully out of date — the
corpora gate them and they pass clean. The real drift is (1) the solver search
layer, where all of 2025-26's heuristic/caching work happened JS-side, and
(2) a short list of edge-case divergences. The plan is sized accordingly.

## Phase 0 — re-baseline every parity gate (half a day)

1. Build everything (`puzzlescript_cpp`, `_32`, `puzzlescript_solver`) — the
   `<unordered_map>` include fix already landed; expect clean builds.
2. Run and record in this file:
   - `make simulation_tests_cpp` / `compilation_tests_cpp` (both green today)
   - `make simulation_tests_cpp_js_parity` (32-bit per-turn trace diff — the
     deepest gate; state currently unknown)
   - `make solver_parity_smoke` and `make solver_canonical_replay`
     (JS↔native solution cross-replay)
3. Any failure found here is a P0 ahead of everything below.

## Phase 1 — close the semantic drift (1-2 days)

1. **Message-classification divergence** (`car crash`, `cratopia`): diff how
   each side decides a level is a message at load
   (`textMode/titleScreen/levels[i].message` in JS vs the native session
   loader). JS is the oracle unless inspection shows JS is wrong. Add the four
   levels as fixtures either way.
2. **`a distant sunset` JS tokenizer bug**: objects named with keyword glyphs
   derail the JS OBJECTS-section parse (object "name" containing a newline by
   line 812). Here *JS catches up to native*. Fixing it aligns the corpus
   denominators (both sides then see 1,506 playable levels) and is worth ~100
   solvable levels to the JS solver.
3. **Diagnostics drift from the `no X no X` change**: native already accepts
   these games but emits no warning. Port the warning to
   `native/src/compiler/compile_diagnostics.cpp`, and record an errormessage
   fixture so the diagnostics corpus pins both sides to the same message.
4. Regenerate the JS parity trace manifest after 1-3 and re-run the gates.

## Phase 2 — port the validated solver search layer (the real work, ~1-2 weeks)

`HEURISTICS_IMPLEMENTATION.md` is already written as the native checklist; the
JS ledger now says which items are proven. Port winners only, in evidence
order, each gated on solution cross-replay plus a serial
`solver_timeout_curve` overlay (the tool accepts both solvers' JSON):

1. **A3 static-dead-cell cache** (+14 solves in JS at 250ms): per-condition
   `{corner, edge}` bitmaps from static-blocker inference + map boundary.
   Pure per-level precomputation — cheap and simple in C++.
2. **D2 region-isolation penalty** (+1-4): component IDs folded into the same
   per-condition cache.
3. **`auto` per-condition router** as the default heuristic (all-on conditions
   get dead+isolation, base falls through to the existing `winconditions`
   signal). Keep `winconditions` as the legacy flag value.
4. **Exact version-keyed caches** (this week's JS work, search-order-proven):
   distance fields and player positions invalidated by a write-hook version
   that snapshots capture/restore. The native session model already has
   capture/restore and a cell-write path; mirror the
   `PUZZLESCRIPT_VERIFY_DISTANCE_FIELDS` assert mode.
5. **Search bookkeeping**: borrowed turn backup, turn dirty-flag
   modified-compare, fused restore+mask rebuild. Profile first with
   `--profile-runtime-counters` — the native session model may already avoid
   some of these costs; port only what its profile shows.

**Explicitly do not port** (measured negative or unsound in JS — see
`JS_SOLVER_NEXT.md`): multi-heuristic portfolio blending and phase-split
scheduling (C1/C1b), D1/D4/D7 heuristics, stale distance-field caching (the
discarded A2), occupancy-based no-op skip predicates (38% false-positive).

## Phase 3 — keep them in lockstep (process, ongoing)

1. One `make parity` umbrella target = sim corpus + diagnostics corpus +
   32-bit trace suite + solution cross-replay; run before merging anything
   touching `src/js/{compiler,engine,parser}.js` or `native/`.
2. Adopt the division of labour the last months proved out: **JS is the lab**
   (fast iteration, rich instrumentation, probe tooling), **native is the
   production runner**. Every JS experiment that lands gets a port-back entry
   in `HEURISTICS_IMPLEMENTATION.md` with its JS bench numbers; every
   negative result gets recorded so it is never ported.
3. Standard before/after artifact for any solver port:
   `solver_timeout_curve.js --series js:… --series c++:…` overlay, serial runs.
4. When the corpora gain coverage (e.g. new diagnostics like the `no X`
   warning), regenerate fixtures on the JS side first, then make native match.

## Expected outcome

- Phases 0-1: identical corpus denominators (1,506 playable levels both
  sides), all four gates green, drift list empty.
- Phase 2: native curve shifts up at fixed budget — JS evidence suggests
  +15-25 solves at 250ms from A3+D2+auto on this corpus shape, on top of the
  native speed advantage, putting ~65%+ of the corpus in reach at 1s.
