# MIS95 per-level generation implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated helper tasks; integrate and review in the current session.

**Goal:** Make unattended multi-level generation work within MIS95’s existing level editor, including simple creation and direct resizing of seed boards.

**Architecture:** Per-level workspaces own transforms and result collections. One worker pool schedules resumable per-job generator contexts. Board geometry is a pure helper; controller owns source/undo/UI and checkpoints.

**Tech Stack:** Existing browser globals, Web Workers, JS/WASM adapters, Node assertions and installed Chrome/Playwright.

### Task 1 — board geometry
- [x] Write and run failing Node tests for `MISBoard.create(model,w,h)` and `MISBoard.resize(model,board,{left,right,top,bottom},locks)`.
- [x] Implement standalone helper returning `{board,locks}` from resize, preserving column-major multiword data and placing background in new cells; reject invalid dimensions.
- [x] Verify source write-back/recompile preserves new and resized boards.

### Task 2 — shared pool and cooperative generation
- [x] Test a controller pool with injected fake workers: start two jobs, keep worker count bounded, route replies by job/revision, pause one, preserve the other, stop all.
- [x] Implement `MISGenerationPool.create({size,spawn,onMessage,onChange})`, `start(id,payload)`, `pause(id)`, `stopAll()`, `destroy()`, `isRunning(id)`, `activeCount()`.
- [x] Extend worker messages with `generationJobs` assignments. Each worker preserves unchanged job/revision contexts and rotates at step boundaries. Include job/revision/context identity on all generation replies; keep legacy generate compatibility.
- [x] Bound per-context seen storage and verify real-worker legacy parity.

### Task 3 — controller and persistence
- [x] Scope transform/preset/cards/pins/special/session aliases to current level workspace. Remap on UI insertion; fail closed on structural source edits.
- [x] Wire shared pool callbacks to captured workspace identities; make meters/ranking/results selection-specific; add per-level thumbnail badge, active-count status, Stop all, Use for all transforms.
- [x] Persist per-level transform metadata and bounded candidate collections with game identity; restore paused. Throttle checkpoints and surface failed saves.
- [x] Add New dimensions dialog, duplicate inheritance, Add as new level, and resize handles with one undo/cancel and lock translation.

### Task 4 — verification and delivery
- [x] Add real-browser regression for two jobs, selection, pause, source edits, recovery, insertion and resizing. Observe it fail before UI implementation where practical.
- [x] Run helper/pool tests, make mis_tests, existing browser checks and web build; inspect narrow/wide workbench captures.
- [x] Review final diff against spec, repair material issues, build desktop and smoke-test with isolated profile. Integrate verified changes to master and keep worktree only if needed by a preview.

## Verification record

- `make mis_tests mis_levels_tests mis_app_tests`: passed. Board14, pool13, recovery4, core28, rule-goal6, portable/aggregate/optimizer suites, real-browser ownership/sizing/recovery and file tests. Existing Node experimental localStorage shim warnings remain.
- Existing MIS UI checks passed at 100%,125%,150%,200% browser scales; editor completion/search/undo and the unlimited focus solver regression passed, including original-game replay of Heroes of Sokoban.
- Both built web entry points passed real native-worker generation with no missing assets or page errors.
- Packaged desktop smoke passed with isolated user data, native offline solving, native save/recovery lifecycle, single-instance file opening and progress while minimized.
- Independent spec/quality review findings were fixed and regressed: scoped async results, paused invalidation, fast editor switching, source and legend undo, visible invalid draft recovery, balanced worker preservation and bounded overnight memory.
