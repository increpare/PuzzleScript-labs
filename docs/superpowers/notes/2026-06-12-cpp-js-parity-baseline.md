# C++/JS parity baseline (Phase 0)

**Date:** 2026-06-12  
**Git commit:** `c48a1ebd68e08651e8b5702a7031fafafb2da300`  
**Host:** darwin (AppleClang 21), `PS_MASK_WORD_BITS=64` native build

## Native build

| Artifact | Present |
|----------|---------|
| `build/native/puzzlescript_cpp` | yes (~1.8 MB) |
| `build/native/puzzlescript_solver` | yes (~1.1 MB) |

`make build build_solver` completed successfully (~29 s).

## Parity test targets

| Target | Command | Result | First failure / notes | Wall time (approx.) |
|--------|---------|--------|----------------------|---------------------|
| `js_parity_tests` | `make js_parity_tests` | **FAIL** | First trace replay mismatch: **unnecessary number of rules sokobond** (index 33). Aggregate: `trace_replay_passed=375`, `trace_replay_failed=94` / 469 (`simulation_tests_cpp_js_parity`). Did not reach `compilation_tests_cpp_32`. | ~77 s |
| `simulation_tests` | `make simulation_tests` | **PASS** | JS: 469/469; C++ direct corpus: 469/469 | ~11 s |
| `compilation_tests` | `make compilation_tests` | **PASS** | JS: 274/274; C++ diagnostics corpus: 274/274 | ~1.4 s |
| `rule_plan_parity_tests` | `make rule_plan_parity_tests` | **FAIL** | **ellipsisPropagationBug2** (index 7); `game.rule_plan_v1.rules.[2].[0].replacements.[0].movements_set_bits` | ~1.5 s |
| `solver_parity_smoke` | `make solver_parity_smoke` | **PASS** | 7/7 cases | ~0.6 s |
| `ctest` | `make ctest` | **FAIL** | **puzzlescript_rule_plan_parity** (same `ellipsisPropagationBug2`); 17/18 passed | ~16 s |

### `js_parity_tests` sub-target not executed

- **`compilation_tests_cpp_32`**: skipped because `make js_parity_tests` stopped on `simulation_tests_cpp_js_parity` failure.

## Solver corpus (side-by-side)

Corpus: `src/tests/solver_tests` (184 games, **2790** level entries).

| Setting | JS (`solver_tests_js`) | Native (`solver_tests_cpp`) |
|---------|------------------------|----------------------------|
| `SOLVER_TIMEOUT_MS` | **1000** (see note below) | **1000** |
| `SOLVER_OUTPUT_ARGS` | `--quiet --json --no-solutions` | same |
| **solved** | 762 | 887 |
| **timeout** | 547 | 448 |
| **exhausted** | 37 | 7 |
| **skipped_message** | 1444 | 1448 |
| **errors** | 0 | 0 |
| Wall time | ~11 min | ~10 min |

**Timeout note:** A trial run with `SOLVER_TIMEOUT_MS=5000` for JS was stopped after **>15 minutes** with no JSON summary emitted (`--quiet`). Baseline counts use **1000 ms** per level for both engines so the full corpus could finish in reasonable time. Counts are not directly comparable to a 5000 ms budget.

**Solver delta (same timeout):** Native reports **+125 solved** and **−99 timeout** vs JS, with small differences in exhausted/skipped_message. This may reflect engine/search parity gaps and/or performance (native expands more nodes in the same wall-clock budget).

## Top gaps (from failures and solver delta)

1. **JS↔native simulation trace replay:** 94/469 testdata cases diverge on serialized level / session snapshots (first: *unnecessary number of rules sokobond*); prepared-session checks still 469/469.
2. **Rule plan v1 parity:** `ellipsisPropagationBug2` — native sets `movements_set_bits` where JS does not.
3. **Solver outcome mismatch at 1 s:** Native solves more levels than JS under identical timeout; needs parity analysis (not necessarily “native better”—could be timing, heuristics, or step semantics).
4. **Orthogonal / perpendicular movement error cases** appear repeatedly in detailed trace failures (e.g. #682, #498, #496)—likely related to movement propagation semantics.
5. **`compilation_tests_cpp_32` not measured** in this run; 32-bit mask build parity still unknown.

## Commands skipped

| Command | Reason |
|---------|--------|
| `compilation_tests_cpp_32` (via `js_parity_tests`) | Parent `make js_parity_tests` failed early |
| `solver_tests_*` at `SOLVER_TIMEOUT_MS=5000` | JS run exceeded 15 min without completing; baseline used 1000 ms instead |
