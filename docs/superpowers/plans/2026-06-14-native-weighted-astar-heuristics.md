# Native Weighted A* Heuristics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve native weighted-A* and portfolio behavior on marginal solver cases with explicit heuristic selection, an all-on assignment/player heuristic, compact/full heuristic parity, and plain-NO lifecycle routing.

**Architecture:** Keep heuristic choice in the solver CLI and pass it into both standalone search and portfolio search. Use the existing `native/src/solver/heuristics.hpp` board-based `HeuristicContext` as the shared scorer for full and compact node storage, so compact portfolio lanes do not silently use a weaker heuristic. Keep portfolio routing tag-based and general: multi-goal lifecycle-style plain-NO games should get a BFS-first profile instead of a misleading distance heuristic, while single plain-NO lifecycle games keep balanced scheduling so weighted lanes are not starved.

**Tech Stack:** C++17 native solver, Node.js test harnesses, Makefile solver test targets.

---

### Task 1: Native Heuristic Selection Tests

**Files:**
- Create: `src/tests/run_native_solver_heuristic_selection_node.js`
- Modify: `Makefile`

- [ ] Add a Node test that runs `puzzlescript_solver` with `--solver-heuristic winconditions` on `src/tests/solver_smoke_tests/one_move.txt` and asserts JSON reports `heuristic: "winconditions"`.
- [ ] Add a Node test that runs `--strategy weighted-astar --solver-heuristic all-on-matching` on `Pushy-V Pully-H.txt#15` and asserts it solves within the 1000ms target.
- [ ] Add a Node test that runs portfolio on `color chained.txt#5` and asserts it solves through `portfolio:bfs` with profile `breadth-first`.
- [ ] Wire the test into `solver_search_mode_tests`.
- [ ] Run the new test before implementation and confirm it fails because the CLI does not yet support the option and portfolio still misses the lifecycle plain-NO case.

### Task 2: CLI And Search Plumbing

**Files:**
- Modify: `native/src/solver/main.cpp`
- Modify: `native/src/solver/heuristics.hpp`

- [ ] Add `zero`, `winconditions`, `auto`, `all-on-matching`, and `all-on-player` to `HeuristicKind`.
- [ ] Parse `--solver-heuristic NAME` in the native solver CLI.
- [ ] Store `HeuristicKind` in `Options` and pass it to `solveLevel`, `runSearch`, and `runAdaptivePortfolioSearch`.
- [ ] Report the selected heuristic in JSON for non-BFS standalone searches; continue reporting `zero` for BFS.

### Task 3: Shared Board-Based Heuristic Scoring

**Files:**
- Modify: `native/src/solver/heuristics.hpp`
- Modify: `native/src/solver/main.cpp`

- [ ] Add `HeuristicContext::score(const MaskWord* board)` that computes the base wincondition score, auto extras, and selected all-on assignment/player variants against a board pointer.
- [ ] Use that method for full-state and compact-state node heuristic scoring.
- [ ] Preserve existing auto behavior for the default solver path.
- [ ] Remove or bypass the old duplicated `compactHeuristicScore` logic after the shared path is in place.

### Task 4: All-On Assignment/Player Heuristic

**Files:**
- Modify: `native/src/solver/heuristics.hpp`

- [ ] For a single non-plain `ALL A ON B` condition, collect unsatisfied `A` tiles and all target `B` tiles.
- [ ] Compute min-cost source-to-target assignment using Manhattan/chamfer tile distance, falling back to `kNoMatchingDistance` when no target exists.
- [ ] For `all-on-matching`, return `unsatisfied_count * 10 + assignment_distance`.
- [ ] For `all-on-player`, add the nearest player-to-unsatisfied distance capped at 16.
- [ ] Cap the assignment DP to small cases and fall back to base auto/wincondition scoring for larger cases.

### Task 5: Portfolio Plain-NO Lifecycle Routing

**Files:**
- Modify: `native/src/solver/main.cpp`

- [ ] In `choosePortfolioProfile`, route games whose winconditions are multiple plain `NO` goals plus random/again lifecycle features to `BreadthFirst`.
- [ ] Keep the rule general: no game-name checks and no level-specific checks.
- [ ] Ensure JSON profile reporting exposes `portfolio_profile: "breadth-first"` for those cases.

### Task 6: Verification

**Files:**
- Existing test targets only.

- [ ] Run `make solver_search_mode_tests`.
- [ ] Run `make solver_portfolio_regression_tests`.
- [ ] Run focused native probes for `Pushy-V Pully-H.txt#15`, `make way.txt#3`, `crate guardian.txt#9`, `Legend of Swixero.txt#7`, and `color chained.txt#5`.
- [ ] Run `make solver_js_coverage_cpp SOLVER_JS_COVERAGE_TIMEOUT_MS=1000 SOLVER_JS_COVERAGE_JOBS=1 SOLVER_JS_COVERAGE_STRATEGY=portfolio`.
