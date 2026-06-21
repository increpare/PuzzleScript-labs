# JS solver profiling and instrumentation

Guide to measuring `src/tests/run_solver_tests_js.js`. For performance
forensics and optimization history see also `JS_SOLVER_PERF_REPORT.md` and
`JS_SOLVER_NEXT.md`.

## Quick start

```bash
# Corpus timing + search counters (default detail timing on)
node src/tests/run_solver_tests_js.js src/tests/solver_tests \
  --timeout-ms 250 --quiet --json --no-solutions > build/solver-baseline.json

# Step-internal breakdown (rule phases, movement, match vs apply)
PUZZLESCRIPT_SOLVER_STEP_PROFILE=1 node src/tests/run_solver_tests_js.js \
  src/tests/solver_tests --timeout-ms 250 --quiet --json --no-solutions \
  > build/solver-step-profile.json

# V8 CPU profile (disable harness timing in the hot loop first)
PUZZLESCRIPT_SOLVER_DETAIL_TIMING=0 node --cpu-prof --cpu-prof-dir=build/prof \
  src/tests/run_solver_tests_js.js src/tests/solver_tests \
  --timeout-ms 250 --quiet --json --no-solutions

# Multi-config A/B bench
node src/tests/bench_solver.js src/tests/solver_tests --timeout-ms 250 \
  --out build/bench.json

# Full instrumentation pack (baseline + step profile + noop probe + cpu-ready)
node src/tests/run_js_solver_instrumentation_pack.js src/tests/solver_tests \
  --out-dir build/js/solver_instrumentation_pack --timeout-ms 250
node src/tests/analyze_js_solver_instrumentation_pack.js \
  build/js/solver_instrumentation_pack/summary.json --markdown build/js/solver_instrumentation_pack/report.md
```

Diff two JSON runs:

```bash
node src/tests/compare_solver_static_opt_runs.js baseline.json optimized.json
```

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `PUZZLESCRIPT_SOLVER_DETAIL_TIMING` | `1` (on) | When `0`, skip `performance.now()` in the search hot loop. Use for `--cpu-prof`. JSON `*_ms` search buckets are zeroed. |
| `PUZZLESCRIPT_SOLVER_STEP_PROFILE` | off | When `1`, monkey-patch engine entry points and record step-phase timings including rule match vs apply. |
| `PUZZLESCRIPT_SOLVER_NOOP_PROBE` | off | When `1`, measure candidate no-op skip predicates vs actual outcomes. Zero cost when off. |
| `PUZZLESCRIPT_VERIFY_ZOBRIST` | off | Assert incremental Zobrist hash matches full recompute. |
| `PUZZLESCRIPT_VERIFY_DISTANCE_FIELDS` | off | Assert cached distance fields match recompute. |
| `PUZZLESCRIPT_INPUT_SPECIALIZATION` | on (engine) | Set `0` to disable per-input rule-set specialization. |
| `PUZZLESCRIPT_INCREMENTAL_PRUNE` | `0` in harness | Inner-loop rule pruning; regresses solver corpus at 250ms when enabled. |
| `PUZZLESCRIPT_DISABLE_HASH_BUCKETS` | off | Force Map-based visited set instead of bucketed structure. |
| `PUZZLESCRIPT_VERIFY_SOLUTION_REPLAY` | on | Reject search wins whose path does not replay. |

## JSON timing fields

### Search loop (always when detail timing on)

| Field | Meaning |
|---|---|
| `clone_ms` | `restore()` from parent snapshot |
| `snapshot_ms` | `capture()` for child nodes |
| `step_ms` | `processInput` + settle |
| `heuristic_ms` | Total heuristic evaluation time |
| `heuristic_classify_ms` | Auto-heuristic penalty/router adders |
| `heuristic_score_ms` | Base distance/scoring work |
| `hash_ms` | Zobrist hash + visited lookup |
| `queue_ms` | Priority queue operations |
| `reconstruct_ms` | Solution path rebuild |

### Step profile (`PUZZLESCRIPT_SOLVER_STEP_PROFILE=1`)

| Field | Meaning |
|---|---|
| `step_profile_early_rules_ms` | `state.rules` via `applyRules` |
| `step_profile_late_rules_ms` | `state.lateRules` |
| `step_profile_other_rules_ms` | Other rule arrays |
| `step_profile_rule_match_ms` | `Rule.findMatches` (all rule groups) |
| `step_profile_rule_apply_ms` | `Rule.tryApply` apply path (excludes match) |
| `step_profile_movement_ms` | `resolveMovements` |
| `step_profile_command_ms` | `processCommandQueue` |
| `step_profile_win_ms` | `checkWin` |

### Search counters

| Field | Meaning |
|---|---|
| `expanded` | Nodes popped from frontier |
| `generated` | Actions tried |
| `step_no_op` / `step_changed` | Step outcome mix |
| `expanded_per_solved` | `expanded / (solved + 1)` — lower is better steering |

### Auto heuristic (`heuristic: auto`)

Per-level `heuristic_breakdown` is a string array describing static routing,
e.g. `["base:all-on-clear-path", "cond0:dead-position+region-isolation"]`.

### No-op probe (`PUZZLESCRIPT_SOLVER_NOOP_PROBE=1`)

| Field | Meaning |
|---|---|
| `probe_dir_steps` | Direction presses probed |
| `probe_noops` | Steps with `changed=false` |
| `probe_blocked` | Predicate “all move targets blocked” fired |
| `probe_blocked_changed` | False positives (blocked but board changed) |
| `probe_blocked_noop` | True blocked no-ops |

## Benchmarking discipline

1. Run serially for comparable solve counts (`--jobs` shares CPU).
2. Capture baseline JSON before optimization work.
3. Re-run with identical args after changes; use `compare_solver_static_opt_runs.js`.
4. Only keep changes that improve `solved`, `us_per_step`, or `expanded_per_solved` without breaking simulation tests.
5. Use `PUZZLESCRIPT_SOLVER_DETAIL_TIMING=0` when profiling hot functions with V8.

## Makefile targets

```bash
make solver_bench_js SOLVER_TIMEOUT_MS=250
make solver_tests_js SOLVER_TIMEOUT_MS=250
```

Tests:

```bash
node src/tests/js_solver_instrumentation_pack_node.js
node src/tests/solver_static_opt_node.js
```
