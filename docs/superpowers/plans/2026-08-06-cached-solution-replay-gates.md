# Cached Solution Replay Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make checked-in eligible-corpus solutions a standard correctness gate
for host GBC + native C++ (default) and cart/libmGBA (thorough).

**Architecture:** Shared manifest + token files under
`src/tests/solution_cache/eligible/`; thin Python runners for default/thorough
gates; maintainer refresh script; Makefile/CMake wiring. No solver in test
gates.

**Tech Stack:** Python 3, existing GBC host export/bench helpers, `puzzlescript_cpp
run --headless --inputs-file`, libmGBA cart harness, CMake/CTest, Make.

**Spec:**
[`docs/superpowers/specs/2026-08-06-cached-solution-replay-gates-design.md`](../specs/2026-08-06-cached-solution-replay-gates-design.md)

---

## File map

| Path | Responsibility |
| --- | --- |
| `src/tests/solution_cache/eligible/manifest.json` | Tag filter source of truth |
| `src/tests/solution_cache/eligible/solutions/<slug>/board-<n>.txt` | Cached tokens |
| `scripts/solution_cache.py` | Load/validate/filter manifest helpers |
| `scripts/solution_cache_test.py` | Unit tests for helpers |
| `scripts/refresh_eligible_solution_cache.py` | Seed/classify/optional solve |
| `scripts/run_solution_cache_tests.py` | Host GBC + C++ (+ JS optional) replay gate |
| `scripts/run_gbc_cart_solution_cache_tests.py` | Thorough cart/libmGBA gate |
| `Makefile` | `solution_cache_tests`, thorough targets, wire into `tests` / `all_tests_thorough` |
| `native/CMakeLists.txt` | Optional ctest wrapper invoking the Python default gate |

---

### Task 1: Manifest helpers + unit tests

**Files:**
- Create: `scripts/solution_cache.py`
- Create: `scripts/solution_cache_test.py`

- [ ] Implement load/filter/hash/token helpers
- [ ] Unit tests for tag filter, hash mismatch, token parse
- [ ] `python3 scripts/solution_cache_test.py` passes

### Task 2: Seed cache from 2026-08-06 verified fixtures

**Files:**
- Create: `src/tests/solution_cache/eligible/**`
- Create/Modify: `scripts/refresh_eligible_solution_cache.py` (seed mode)

- [ ] Copy 280 JS-valid fixtures into `solutions/<slug>/board-<n>.txt`
- [ ] Write manifest with `js_valid` / `host_known_good` tags + source hashes
- [ ] Commit seed (or leave staged with runners in same commit batch)

### Task 3: Default/thorough host+C++ runner

**Files:**
- Create: `scripts/run_solution_cache_tests.py`

- [x] `--tag host_known_good` (default): replay C++ + host GBC; hard fail
- [x] `--tag js_valid` (thorough): C++ + host hard fail (quarantine policy retired;
      see `2026-08-08-strict-thorough-solution-cache-policy.md`)
- [x] Verify default gate passes on seeded cache

### Task 4: Cart thorough runner

**Files:**
- Create: `scripts/run_gbc_cart_solution_cache_tests.py`

- [x] One benchmark cart build; replay every cached board via libmGBA
- [x] Hard fail on any non-win

### Task 5: Wire Make/CTest

**Files:**
- Modify: `Makefile`
- Modify: `native/CMakeLists.txt` (add_test invoking default Python gate)

- [ ] `make solution_cache_tests` runs default gate
- [ ] `make tests` depends on it
- [ ] `make all_tests_thorough` includes thorough + cart gates
- [ ] Document targets in help text

### Task 6: Refresh script polish + verify

**Files:**
- Modify: `scripts/refresh_eligible_solution_cache.py`

- [ ] Default: re-classify/classify without solve
- [ ] `--solve --timeout-ms N` fill gaps
- [ ] End-to-end: default gate green; unit tests green
