# Vanilla PuzzleScript sync, 3 November 2026

**Goal:** Review every vanilla master commit after `57f9f6cba69f6aa52ed738d5aee1d709d0037648` through `caa902120185b354f8b9bdb7bf67a9424be0665d` and selectively port useful changes to Labs JavaScript, native C++ and readable TypeScript.

**Architecture:** Adapt the final upstream source delta to each implementation. Preserve Labs optimizations, CM6, explicit TypeScript domain types and authored regressions. Refresh TypeScript's immutable vanilla source/corpus and hash manifest together, keeping all oracle production boundaries intact. Avoid merging generated vanilla assets.

**Validation:** Import upstream fixtures before fixes, observe failures, run full JS/TypeScript suites and targeted native compiler/runtime checks. Keep browser regressions and dependencies in the external `puzzlescript_testdump/ui/` collection. Build fresh standalone/editor assets and inspect all excluded commits.

- [x] Fetch upstream, validate checkpoint ancestry and inspect the complete commit range.
- [x] Import new/changed upstream fixtures without replacing Labs-only cases.
- [x] Port JS parser/compiler/runtime changes and verify regressions.
- [x] Adapt applicable C++ parser/compiler/runtime fixes with focused regressions.
- [x] Refresh TypeScript vanilla pin and adapt compiler/session/loop behavior; verify strict and corpus comparisons.
- [x] Port useful editor/player/input/image-paste, diagnostics, browser runner and CM6 autocomplete changes; test browser behavior externally.
- [x] Rebuild generated assets, run combined verification, inspect the final diff, and record every upstream disposition.
- [x] Advance `.upstream-sync.json` with baseline `3d27de13` and update `docs/upstream-sync.md` with results and limitations.

Implementation used `.worktrees/upstream-2026-11-03` on `codex/upstream-2026-11-03`. Implementation areas are delegated to separate agents with disjoint file ownership; integration and source/build/browser checks remain with the primary agent. No push or deployment is requested.
