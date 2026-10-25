# Current-level solver implementation plan

**Goal:** A selected level searches until solved, exhausted, explicitly stopped, or replaced; generator candidates and background level health retain their budgets.

**Design:** The selected level uses an explicit unlimited primary search (`timeMs: -1`, `maxExpanded: 0`) on both JS and native backends. Native negative timeouts mean no deadline, rather than being clamped to 1 ms. Supplemental difficulty/shortest-path refinement remains bounded. A Stop solver / Retry solve button controls the focus worker; changing level or backend terminates stale work even when the destination result is cached. Errors and user cancellation are distinct from exhaustion and never become final cached proofs.

1. Add regressions for negative timeout propagation in `native/tests/generator_difficulty_contract.cpp`, unlimited native search/cancellation in `native/tests/solver_generated_replay.cpp`, JS unlimited search in `src/tests/mis_core_node.js`, and the focus-worker/UI contract in `src/tests/mis_analysis_browser.cjs`. Run the failing checks first.
2. Add the explicit native API negative-timeout contract in `native/include/puzzlescript/puzzlescript.h`, `native/src/solver/main.cpp`, and `native/src/search/difficulty.cpp`. Preserve positive budgets and cooperative cancellation.
3. Honor the matching JS contract in `src/js/mis/mis_core.js`. Rebuild `src/js/mis/wasm/mis_native.{js,wasm}` with `make mis_wasm`.
4. Update `src/js/mis/mis_app.js`, `src/js/mis/mis_worker.js`, and `src/mis.html` for the unlimited selected-level request, user cancellation, stale job invalidation, accurate cache status, and useful error messages.
5. Verify Heroes of Sokoban playable level 4 with the real native worker and replay its solution. Verify Stop, Retry, cached-level switching, and the JS backend. Run MIS core/web regressions, then publish using `node scripts/publish-mis.mjs` and verify the live level.

Completed: native and JS contracts, rebuilt WASM, cancellation/error UI, and local/live browser regressions passed. Heroes level 4 produced a replay-verified 32-move solution on the requested public site. The publishing script's destination changed concurrently, so the final bundle was deployed directly to the originally authorized PuzzleScript directory with backups.
