# Compact Turn Codegen Pass 2 Design

## Goal

Make compiled compact-turn kernels faster through a second instrumented optimization pass focused on generated C++ runtime throughput, while preserving full native compact-turn coverage and solver behavior.

## Scope

This pass is limited to compact-turn compiler/runtime execution. It may change generated compact-turn C++ in `native/src/compiler/compact_turn_codegen.cpp`, runtime counters in `native/include/puzzlescript/puzzlescript.h` and native runtime/solver counter plumbing, and focused perf tests under `src/tests`. It will not change solver search heuristics, timeout policy, portfolio ordering, HDA behavior, JavaScript solver behavior, or non-compact native backends.

## Baseline

The first optimization pass restored full native compact-turn coverage and fixed the broad object-scan regression. Current focused measurements show compiled kernels are faster than the C++ interpreter on all tracked cases, but remaining time is concentrated in generated phase overhead:

- `big dog and little dog.txt#11`: `56.90us/generated`, mostly early rules.
- `Double-Entry Bookkeeping Simulator.txt#17`: `10.96us/generated`, mostly late rules.
- `gem soketeer.txt#21`: `17.03us/generated`, with millions of no-change rule applications.
- `easyenigma.txt#11`: `27.81us/generated`, with setup and late-rule cost.
- `Voitex Rasteriser 2.txt#1`: now roughly interpreter parity, still useful as a regression guard.

## Approach

The pass starts with fresh measurements from the existing perf suite and adds only the attribution needed to identify one generic generated-code hotspot. The preferred first optimization target is rule-dispatch and no-match churn: generated kernels currently enter rule apply functions many times where a cheap phase-level or rule-level precheck might skip the call entirely, or where replacement helpers can be specialized more aggressively.

Implementation must be incremental:

1. Measure current focused cases and record the top phase/counter contributors.
2. Add or tighten a failing perf/shape expectation for the chosen hotspot.
3. Implement one generic codegen/runtime optimization.
4. Re-run correctness gates, focused perf gates, and timeout-curve validation.
5. Commit each independently useful step.

## Acceptance Criteria

- `make compact_turn_native_parity` continues to report full native compact-turn coverage.
- `make compact_turn_codegen_solver_parity` passes with no oracle failures.
- `make compact_turn_codegen_perf_expectations` passes and records at least one tightened or newly meaningful expectation for the optimized hotspot.
- `make solver_timeout_curve SOLVER_TIMEOUT_CURVE_MAX_MS=1000 SOLVER_TIMEOUT_CURVE_PROGRESS=quiet COMPILED_RULES_PERF=true` shows no compiled-vs-interpreter regression at 1000ms.
- If profiling shows the planned hotspot is not the best target, the final write-up explains the evidence and the selected replacement target.

## Risks

Generated code changes can subtly alter PuzzleScript command or repeat-loop semantics, so parity gates are mandatory after each behavior-adjacent change. Perf noise is also expected at 1s timeouts; per-generated-state timing, phase counters, and rule counters are the primary optimization signal, with solved-count curves used as final portfolio validation.
