# Compact Turn Native Mini-VM Design

Date: 2026-06-17

## Summary

The compact-turn compiler should stop treating hard PuzzleScript semantics as reasons to fall back to an interpreter bridge. Instead, compiler mode should lower every solver corpus game into a native generated compact-turn program and execute that program with a generated semantic mini-VM.

The target is strict compact-turn native-kernel parity:

- `compact_turn.native_kernel_supported = 182/182`
- `compact_turn.interpreter_bridge_supported = 0/182`
- No compact-turn solver edge should require a compiler-dispatched interpreter bridge.

This design focuses only on compact-turn native kernels for solver use. It does not require feature parity for older compiled tick or specialized full-turn backends.

## Current State

The current compact-turn compiler has a callable backend for every solver corpus source, but most are interpreter bridges:

- Native compact kernels: `33/182`
- Interpreter bridges: `149/182`

Current native-kernel blockers are:

- `transparent_object_compact_unsupported`: 49
- `run_rules_on_level_start_late_rules`: 26
- `cancel_command`: 25
- `again_command`: 19
- `aggregate_bindings`: 13
- `rule_loops`: 9
- `no_rules`: 5
- `run_rules_on_level_start_native_perf_guard`: 2
- `verbose_logging`: 1

The recent sparse object-anchor fix restored sanity for a known worst case, but it did not remove most bridge coverage. The next step is semantic coverage, not another local scan optimization.

## Goals

- Generate native compact-turn kernels for every solver corpus source.
- Preserve solver correctness against the interpreted compact-turn oracle.
- Make solver command semantics explicit and cheap.
- Support `AgainPolicy::Drain` natively so compiled solver turns settle `again` without bridge fallback.
- Keep generated rule matching and replacement hot paths native and optimizable.
- Make coverage and performance regressions easy to detect.

## Non-Goals

- Full parity for older compiled tick or specialized full-turn backends.
- A general-purpose bytecode interpreter shared across all runtimes.
- UI-visible command behavior improvements beyond what compact-turn parity needs.
- Broad solver heuristic changes.
- A solver rewrite.

## Architecture

Compiler mode will lower each game into a generated compact-turn program. The generated C++ executor runs that program directly. This is a mini-VM in structure, but it is still native generated C++: instruction streams, rule kernel calls, and control flow are emitted per source.

The mini-VM has five core pieces.

### Compact Turn IR

The compiler builds a small IR for turn semantics. Instructions include:

```text
BeginTurn
SeedInputMovement
RunRuleGroup phase=early group=N
JumpIfChanged target=M
ResolveMovements
RunRuleGroup phase=late group=N
HandleCommands
EvaluateWin
DrainAgain
ReturnOutcome
```

Rule loops become explicit jumps or loop targets in this IR. `run_rules_on_level_start` becomes a program variant or entry mode. No-rule games become tiny native programs instead of bridge cases.

### Rule Kernel Functions

Existing generated match and apply logic becomes callable rulegroup kernels. These kernels should stay specialized:

- Fixed-row sparse object-anchor scans remain available.
- Existing row and ellipsis scanners remain fallback scan strategies inside native kernels.
- Random, rigid, movement, late, and win-related behavior remains native where currently implemented.

The rule kernels report whether they changed board or movement state and which commands they queued. They do not decide solver policy.

### Generated Program Executor

Each source gets a generated executor that walks the compact-turn IR. It owns:

- Turn frame setup.
- Movement clear and input seeding.
- Early rule execution.
- Rigid retry control.
- Movement resolution.
- Late rule execution.
- Command policy.
- Win evaluation.
- Again drain.
- Outcome construction.

The executor should make the phase order explicit and align with `executeTurn` in `native/src/runtime/core.cpp`, while avoiding player-only work in solver mode.

### Runtime Semantic State

The executor uses shared runtime state for:

- Persistent compact board objects.
- Live movement masks.
- Row, column, and board masks.
- Object-cell indexes.
- Command flags.
- Turn frame snapshots when player policy requires them.
- Rigid retry scratch.
- Profiling counters.

Generated code should not duplicate data-structure ownership. It should call small helpers for shared state operations and emit source-specific rule logic.

### Registry Backend

Every compiled source should register a native compact-turn backend. Bridge backend generation remains available only as a temporary development fallback behind test-only flags, not as an accepted compiler-mode outcome.

## Execution Policies

The mini-VM needs explicit execution policy because solver semantics are not the same as player semantics.

### Solver Policy

Solver policy is the primary target.

- `cancel`: return a discard/no-successor outcome as soon as the command is known. Do not rollback, copy back, or materialize a child state.
- `restart`: return a discard/no-successor outcome so the solver skips the edge. Do not restore the restart target and do not run level-start rules. During migration, existing callers may also receive `restarted=true`, but the canonical compact-turn solver signal is `discard=true`.
- `checkpoint`: no-op.
- `message`: no-op.
- `sfx*`: no-op.
- Interactive `undo`: not a solver input. If it reaches this layer, treat it as no successor.
- `again`: semantic and required. It must schedule, probe, and drain natively when policy requests it.
- `win`: semantic and required. It remains a valid solver terminal.

The compact-turn outcome should distinguish these cases:

```text
handled=true
discard=true       // solver should skip this edge without child-state work
changed=false      // ordinary unchanged turn, not a command discard
won=true           // valid solve
restarted=true     // compatibility during migration, not required for discard
pendingAgain=true  // only for yielding policies
```

The solver should use the cheapest discard signal available and avoid hash/state capture for discarded edges.

### Player Policy

Player policy preserves existing runtime behavior where compact turns are used outside solver mode:

- `cancel` restores turn-start state and reports normal command/audio behavior.
- `restart` restores the restart target and runs level-start rules.
- `checkpoint`, `message`, and `sfx*` keep existing player-facing effects.
- `again` may yield to `pendingAgain` pacing unless `AgainPolicy::Drain` is requested.

Player policy is required for oracle parity, but solver policy is allowed to bypass player-only work.

## Again Drain

`AgainPolicy::Drain` already exists in the C++ runtime, the solver uses it, and the CLI exposes settled execution through `--settle-again`. The compact-turn mini-VM must support it natively.

For `AgainPolicy::Drain`:

- After a turn queues `again`, execute native tick subturns immediately.
- Continue until no `again` is pending, the result is terminal, no change occurs, or the max-iteration cap is reached.
- Merge drained tick outcomes into the original step outcome.
- Never bridge to the interpreter for `again`.

For `AgainPolicy::Yield`:

- Return `pendingAgain=true` for player/runtime pacing.
- Respect `again_interval` as UI pacing only. It has no solver timing effect.

## Data Flow

Compile-time flow:

```text
Game runtime model
 -> compact turn feature analysis
 -> compact turn IR
 -> rulegroup native kernels
 -> generated mini-VM executor
 -> native compact-turn registry backend
```

Runtime solver flow:

```text
solver input
 -> compact node state plus scratch
 -> native compact-turn executor
 -> generated rule kernels
 -> native movement and command policy
 -> optional native again drain
 -> compact-turn outcome
 -> solver edge handling
```

Feature analysis no longer decides "native or bridge." It decides which instructions and helpers are needed.

## Lowering Requirements By Current Blocker

### No Rules

Emit a tiny native program that seeds input movement if needed, resolves movement, evaluates win, and returns.

### Rule Loops

Represent loop points in the compact-turn IR. Generated rulegroup instructions branch according to changed status and existing loop targets.

### Again

Remove `again_command` as a native blocker. Lower `again` commands to command flags consumed by `DrainAgain` or by yield policy.

### Cancel And Restart

Remove `cancel_command` as a native blocker. Lower both commands into policy-aware command handling. Solver policy returns a discard/no-successor outcome without restoring state. Player policy preserves existing behavior.

### Run Rules On Level Start

Generate a level-start program entry or mode. For solver restart policy, do not run this path for discarded restart edges. For real level loads and player restart behavior, preserve semantics.

### Aggregate Bindings

Lower aggregate bindings into explicit generated operand selection or helper calls. The rule kernel owns the binding resolution result; the executor treats the rulegroup like any other native group.

### Transparent Objects

Support transparent-colored objects in compact board and mask handling instead of using them as a native blocker. Transparent drawing properties should not affect solver semantics; only object identity, collision layers, and rule masks matter for compact-turn execution.

### Verbose Logging

Logging metadata should not block native solver mode. Solver policy may suppress verbose output while preserving state semantics.

## Error Handling

- If a generated native executor detects an impossible structural mismatch, return `handled=false` only in development builds and fail coverage tests.
- Solver mode should treat discard outcomes as handled edges, not fallback failures.
- Again drain must retain the existing max-iteration cap. If the cap is reached, the generated path must return the same outcome as interpreted `AgainPolicy::Drain` for that source and input, and record an overflow counter for diagnostics.
- Oracle mismatch remains the primary correctness failure signal.

## Instrumentation

The existing runtime counters should remain and gain enough detail to diagnose mini-VM behavior:

- Native compact calls.
- Bridge compact calls, expected to be zero in accepted compiler mode.
- Discarded solver edges by command reason.
- Again drain calls and iterations.
- Rulegroup calls.
- Rule loop jumps.
- Candidate cells tested.
- Row, ellipsis, object-anchor, and future movement-anchor scans.

Coverage JSON should make strict parity visible:

```json
{
  "native_kernel_supported": 182,
  "interpreter_bridge_supported": 0,
  "whole_turn_status_reason_counts": {
    "native_kernel": 182
  }
}
```

## Testing And Acceptance

Coverage gate:

```sh
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests \
  --stats-only \
  --compact-turn-only \
  --compact-turn-mode=compiler \
  --coverage-json /tmp/solver_compact_turn_coverage.json
```

Acceptance:

- `native_kernel_supported = 182/182`
- `interpreter_bridge_supported = 0/182`
- No native-kernel fallback reasons remain for solver corpus sources.

Correctness gates:

- `make compact_turn_codegen_solver_parity`
- Targeted tests for `again`, `cancel`, `restart`, `checkpoint`, `message`, `sfx`, rule loops, aggregate bindings, transparent objects, no-rule games, and `run_rules_on_level_start`.
- Oracle checks must report zero failures.

Performance gates:

- The existing compact-turn perf regression harness remains a ratchet.
- `manic_ammo.txt#26` keeps a strong native win.
- `Voitex Rasteriser 2.txt#1` must not regress below interpreter throughput.
- Full solver timeout curves should show compiled portfolio and compiled HDA at least matching interpreter counterparts at 1000ms, while preserving early-budget gains.

## Rollout Strategy

Implement in vertical slices that each remove a blocker category while preserving strict final coverage:

1. Introduce compact-turn IR data structures and generated executor skeleton.
2. Lower no-rule games and existing native-supported games through the new executor.
3. Add solver discard outcomes for `cancel` and `restart`.
4. Add native `again` drain support and tests.
5. Add rule loop lowering.
6. Add `run_rules_on_level_start` entry support.
7. Add aggregate binding lowering.
8. Add transparent object support.
9. Remove bridge acceptance from compiler-mode coverage tests.
10. Run full parity and timeout-curve validation.

Each slice should keep the corpus correct. Native coverage may climb incrementally during development, but the final acceptance remains strict `182/182`.

## Risks

- A generated mini-VM may initially be slower than the current hand-shaped native path. The perf harness should catch this early.
- Solver and player command policies can diverge accidentally. Tests must cover both policy outputs where compact turns are used outside solver mode.
- `again` cycles can expose non-termination bugs. The generated drain path must preserve the existing max-iteration cap.
- Aggregate binding and transparent object support may require deeper lowering changes than the executor itself.
- `compact_turn_codegen.cpp` is already large. The implementation plan should split IR construction, executor emission, and rule kernel emission into clearer units as part of this work.

## Open Decisions Resolved

- Priority is strict compact-turn native parity, not partial performance-gated coverage.
- The selected architecture is the generated semantic mini-VM.
- Solver policy treats `cancel` and `restart` as discard/no-successor outcomes without rollback.
- `checkpoint`, `message`, and `sfx*` are solver no-ops.
- `again` is required and must support native `AgainPolicy::Drain`.
