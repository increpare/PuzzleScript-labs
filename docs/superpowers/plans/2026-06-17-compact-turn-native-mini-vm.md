# Compact Turn Native Mini-VM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace compact-turn compiler-mode interpreter bridges with native generated compact-turn mini-VM executors until solver corpus coverage reaches `182/182` native kernels and `0/182` bridges.

**Architecture:** Add an explicit compact-turn program model that lowers game semantics into generated native executor control flow. Keep specialized rule match/apply kernels native, while the executor owns phase sequencing, solver command policy, rule loops, level-start turns, and `AgainPolicy::Drain`.

**Tech Stack:** C++17 native runtime/compiler, generated C++ compact-turn backends, Node.js regression scripts, Make/CMake build targets.

---

## Scope Check

This plan implements compact-turn native kernel parity only. It does not change the older compiled tick or specialized full-turn backends. It is one subsystem with clear boundaries: compact-turn codegen, compact-turn runtime outcome plumbing, solver edge handling, and coverage/perf tests.

## File Structure

- Create: `native/src/compiler/compact_turn_program.hpp`
  - Owns compact-turn program IR types used by codegen.
- Create: `native/src/compiler/compact_turn_program.cpp`
  - Builds a compact-turn program from `Game` rulegroups, loop tables, metadata, and command flags.
- Modify: `native/CMakeLists.txt`
  - Adds the new compiler source file.
- Modify: `Makefile`
  - Adds strict parity/perf targets and fingerprints the new compiler source/header.
- Modify: `native/src/runtime/compiled_rules.hpp`
  - Extends `SpecializedCompactTurnOutcome` with solver discard fields.
- Modify: `native/src/runtime/core.cpp`
  - Teaches compact-turn runtime wrapper to honor discard outcomes before restart/win/checkpoint handling.
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
  - Emits rule kernels through the generated program executor, removes bridge-only blocker gates, and emits native handling for each blocker category.
- Modify: `native/src/compiler/compact_turn_codegen.hpp`
  - Keeps support reporting explicit and removes accepted compiler-mode bridge support at the end.
- Modify: `native/src/solver/main.cpp`
  - Skips solver child-state work for compact-turn discard outcomes.
- Create: `src/tests/compact_turn_native_parity_node.js`
  - Verifies strict native coverage and named blocker removal.
- Modify: `src/tests/compact_turn_perf_regression_node.js`
  - Tightens the Voitex case from "native or deliberate skip" to native-only after coverage parity lands.

## Task 1: Add A Strict Coverage Regression Gate

**Files:**
- Create: `src/tests/compact_turn_native_parity_node.js`
- Modify: `Makefile`

- [x] **Step 1: Write the failing coverage test**

Create `src/tests/compact_turn_native_parity_node.js`:

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');

const jsonPath = process.argv[2];
if (!jsonPath) {
    throw new Error('Usage: node src/tests/compact_turn_native_parity_node.js COVERAGE_JSON');
}

const coverage = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const compact = coverage.aggregate && coverage.aggregate.compact_turn;
assert.ok(compact, `${jsonPath}: missing aggregate.compact_turn`);

const sources = compact.sources;
assert.strictEqual(sources, 182, `expected solver corpus source count to stay 182, got ${sources}`);
assert.strictEqual(compact.whole_turn_supported, sources, 'every source must have a callable compact-turn backend');
assert.strictEqual(compact.native_kernel_supported, sources, 'every source must use a native compact-turn kernel');
assert.strictEqual(compact.interpreter_bridge_supported, 0, 'compiler-mode compact-turn bridges are not accepted');

const reasons = compact.native_kernel_status_reason_counts || {};
const forbidden = [
    'interpreter_bridge',
    'native_compact_generator_rebuild',
    'no_rules',
    'rule_loops',
    'again_command',
    'cancel_command',
    'run_rules_on_level_start_late_rules',
    'run_rules_on_level_start_native_perf_guard',
    'aggregate_bindings',
    'transparent_object_compact_unsupported',
    'verbose_logging',
];

for (const reason of forbidden) {
    assert.strictEqual(reasons[reason] || 0, 0, `unexpected native blocker remains: ${reason}=${reasons[reason] || 0}`);
}
assert.strictEqual(reasons.native_kernel, sources, `expected native_kernel=${sources}, got ${reasons.native_kernel || 0}`);

console.log(`compact_turn_native_parity_node passed native=${compact.native_kernel_supported}/${sources}`);
```

- [x] **Step 2: Add the Make target**

Add the target after `compact_turn_codegen_coverage` in `Makefile`:

```make
compact_turn_native_parity: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	mkdir -p "$$(dirname "$(COMPACT_TURN_CODEGEN_COVERAGE_JSON)")"; \
	$(PUZZLESCRIPT_CPP) compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json "$(COMPACT_TURN_CODEGEN_COVERAGE_JSON)"; \
	$(NODE) src/tests/compact_turn_native_parity_node.js "$(COMPACT_TURN_CODEGEN_COVERAGE_JSON)"
```

Add `compact_turn_native_parity` to the `.PHONY` block near the other compact-turn targets.

- [x] **Step 3: Run the test and verify it fails on current coverage**

Run:

```bash
make compact_turn_native_parity
```

Expected: fail with `every source must use a native compact-turn kernel` because current coverage is `33/182`.

- [x] **Step 4: Commit the failing test**

```bash
git add Makefile src/tests/compact_turn_native_parity_node.js
git commit -m "test: add strict compact turn native parity gate"
```

## Task 2: Add Compact-Turn Solver Discard Outcome Plumbing

**Files:**
- Modify: `native/src/runtime/compiled_rules.hpp`
- Modify: `native/src/runtime/core.cpp`
- Modify: `native/src/solver/main.cpp`

- [x] **Step 1: Extend the compact-turn outcome interface**

In `native/src/runtime/compiled_rules.hpp`, change `SpecializedCompactTurnOutcome` to:

```cpp
struct SpecializedCompactTurnOutcome {
    bool handled = false;
    ps_step_result result{};
    bool pendingAgain = false;
    bool hasCheckpoint = false;
    bool discard = false;
    const char* discardReason = nullptr;
};
```

- [x] **Step 2: Extend the solver compact result**

In `native/src/solver/main.cpp`, change `CompactTurnTryResult` to:

```cpp
struct CompactTurnTryResult {
    bool attempted = false;
    bool handled = false;
    bool discard = false;
    const char* discardReason = nullptr;
    PersistentLevelState state;
    ps_step_result stepResult{};
};
```

Then copy the fields in `trySpecializedCompactTurn` after `result.handled = outcome.handled;`:

```cpp
    result.discard = outcome.discard;
    result.discardReason = outcome.discardReason;
```

- [x] **Step 3: Skip child creation for discarded compact edges**

In `stepSolverEdge`, directly after a handled compact turn is recorded and before the fallback child preparation block, add:

```cpp
    if (edge.compactTurn.handled && edge.compactTurn.discard) {
        edge.stepResult = edge.compactTurn.stepResult;
        return edge;
    }
```

- [x] **Step 4: Skip solver queue work for discarded compact edges**

In each solver loop that currently checks `if (stepResult.restarted) { continue; }`, replace it with:

```cpp
            if ((edge.compactTurn.handled && edge.compactTurn.discard) || stepResult.restarted) {
                continue;
            }
```

There are three loops to update: the BFS/weighted loop, portfolio loop, and HDA loop.

- [x] **Step 5: Make the runtime wrapper return discard immediately**

In `compiledCompactPrimaryTurn` in `native/src/runtime/core.cpp`, after `ps_step_result result = outcome.result;`, add:

```cpp
    if (outcome.discard) {
        session.meta.pendingAgain = false;
        markAllMasksDirty(session);
        rebuildMasks(session);
        gThreadTurnResult = TurnResult{};
        gThreadTurnResult.core = result;
        return result;
    }
```

- [x] **Step 6: Build and run existing compact parity**

Run:

```bash
make build
make compact_turn_codegen_solver_parity
```

Expected: both pass with no behavior change, because no generated backend sets `discard=true` yet.

- [x] **Step 7: Commit outcome plumbing**

```bash
git add native/src/runtime/compiled_rules.hpp native/src/runtime/core.cpp native/src/solver/main.cpp
git commit -m "feat: add compact turn solver discard outcome"
```

## Task 3: Add Compact Turn Program IR

**Files:**
- Create: `native/src/compiler/compact_turn_program.hpp`
- Create: `native/src/compiler/compact_turn_program.cpp`
- Modify: `native/CMakeLists.txt`
- Modify: `Makefile`

- [x] **Step 1: Add the IR header**

Create `native/src/compiler/compact_turn_program.hpp`:

```cpp
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "runtime/core.hpp"

namespace puzzlescript::compiler {

enum class CompactTurnProgramOp {
    BeginTurn,
    SeedInputMovement,
    RunEarlyGroup,
    RunLateGroup,
    JumpIfChanged,
    ResolveMovements,
    HandleCommands,
    EvaluateWin,
    DrainAgain,
    ReturnOutcome,
};

struct CompactTurnProgramInstruction {
    CompactTurnProgramOp op = CompactTurnProgramOp::BeginTurn;
    int32_t groupIndex = -1;
    int32_t jumpTarget = -1;
    bool late = false;
};

struct CompactTurnProgram {
    std::vector<CompactTurnProgramInstruction> instructions;
    bool hasEarlyRules = false;
    bool hasLateRules = false;
    bool hasAgain = false;
    bool hasCancel = false;
    bool hasRestart = false;
    bool hasCheckpoint = false;
    bool hasOutputOnlyCommands = false;
    bool hasRuleLoops = false;
    bool runRulesOnLevelStart = false;
};

CompactTurnProgram buildCompactTurnProgram(const Game& game);
const char* compactTurnProgramOpName(CompactTurnProgramOp op);

} // namespace puzzlescript::compiler
```

- [x] **Step 2: Add the IR builder implementation**

Create `native/src/compiler/compact_turn_program.cpp`:

```cpp
#include "compiler/compact_turn_program.hpp"

#include <algorithm>

namespace puzzlescript::compiler {

namespace {

bool hasLoopPoint(const LoopPointTable& table) {
    return std::any_of(table.entries.begin(), table.entries.end(), [](const std::optional<int32_t>& value) {
        return value.has_value();
    });
}

void appendRuleGroups(
    CompactTurnProgram& program,
    const std::vector<std::vector<Rule>>& groups,
    const LoopPointTable& loopPoints,
    bool late
) {
    for (size_t index = 0; index < groups.size(); ++index) {
        CompactTurnProgramInstruction run;
        run.op = late ? CompactTurnProgramOp::RunLateGroup : CompactTurnProgramOp::RunEarlyGroup;
        run.groupIndex = static_cast<int32_t>(index);
        run.late = late;
        program.instructions.push_back(run);

        if (index < loopPoints.entries.size() && loopPoints.entries[index].has_value()) {
            CompactTurnProgramInstruction jump;
            jump.op = CompactTurnProgramOp::JumpIfChanged;
            jump.groupIndex = static_cast<int32_t>(index);
            jump.jumpTarget = *loopPoints.entries[index];
            jump.late = late;
            program.instructions.push_back(jump);
        }
    }
}

void scanCommands(CompactTurnProgram& program, const std::vector<std::vector<Rule>>& groups) {
    for (const std::vector<Rule>& group : groups) {
        for (const Rule& rule : group) {
            for (const RuleCommand& command : rule.commands) {
                if (command.name == "again") program.hasAgain = true;
                else if (command.name == "cancel") program.hasCancel = true;
                else if (command.name == "restart") program.hasRestart = true;
                else if (command.name == "checkpoint") program.hasCheckpoint = true;
                else if (command.name == "message" || command.name.rfind("sfx", 0) == 0) program.hasOutputOnlyCommands = true;
            }
        }
    }
}

} // namespace

CompactTurnProgram buildCompactTurnProgram(const Game& game) {
    CompactTurnProgram program;
    program.hasEarlyRules = std::any_of(game.rules.begin(), game.rules.end(), [](const std::vector<Rule>& group) {
        return !group.empty();
    });
    program.hasLateRules = std::any_of(game.lateRules.begin(), game.lateRules.end(), [](const std::vector<Rule>& group) {
        return !group.empty();
    });
    program.hasRuleLoops = hasLoopPoint(game.loopPoint) || hasLoopPoint(game.lateLoopPoint);
    program.runRulesOnLevelStart = game.metadata.values.find("run_rules_on_level_start") != game.metadata.values.end();
    scanCommands(program, game.rules);
    scanCommands(program, game.lateRules);

    program.instructions.push_back({CompactTurnProgramOp::BeginTurn});
    program.instructions.push_back({CompactTurnProgramOp::SeedInputMovement});
    appendRuleGroups(program, game.rules, game.loopPoint, false);
    program.instructions.push_back({CompactTurnProgramOp::ResolveMovements});
    appendRuleGroups(program, game.lateRules, game.lateLoopPoint, true);
    program.instructions.push_back({CompactTurnProgramOp::HandleCommands});
    program.instructions.push_back({CompactTurnProgramOp::EvaluateWin});
    if (program.hasAgain) {
        program.instructions.push_back({CompactTurnProgramOp::DrainAgain});
    }
    program.instructions.push_back({CompactTurnProgramOp::ReturnOutcome});
    return program;
}

const char* compactTurnProgramOpName(CompactTurnProgramOp op) {
    switch (op) {
    case CompactTurnProgramOp::BeginTurn: return "BeginTurn";
    case CompactTurnProgramOp::SeedInputMovement: return "SeedInputMovement";
    case CompactTurnProgramOp::RunEarlyGroup: return "RunEarlyGroup";
    case CompactTurnProgramOp::RunLateGroup: return "RunLateGroup";
    case CompactTurnProgramOp::JumpIfChanged: return "JumpIfChanged";
    case CompactTurnProgramOp::ResolveMovements: return "ResolveMovements";
    case CompactTurnProgramOp::HandleCommands: return "HandleCommands";
    case CompactTurnProgramOp::EvaluateWin: return "EvaluateWin";
    case CompactTurnProgramOp::DrainAgain: return "DrainAgain";
    case CompactTurnProgramOp::ReturnOutcome: return "ReturnOutcome";
    }
    return "Unknown";
}

} // namespace puzzlescript::compiler
```

- [x] **Step 3: Wire the new compiler source into CMake and Make fingerprints**

In `native/CMakeLists.txt`, add `src/compiler/compact_turn_program.cpp` to `PUZZLESCRIPT_COMPILER_SOURCES` directly after `src/compiler/compact_turn_codegen.cpp`.

In `Makefile`, add these two files to `COMPILED_RULES_FINGERPRINT_INPUTS`:

```make
	native/src/compiler/compact_turn_program.cpp \
	native/src/compiler/compact_turn_program.hpp \
```

- [x] **Step 4: Build**

Run:

```bash
make build
```

Expected: native build passes.

- [x] **Step 5: Commit the IR scaffold**

```bash
git add native/CMakeLists.txt Makefile native/src/compiler/compact_turn_program.hpp native/src/compiler/compact_turn_program.cpp
git commit -m "feat: add compact turn program ir"
```

## Task 4: Route Current Native Kernels Through A Generated Program Executor

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp`

- [x] **Step 1: Include the program builder**

Near the top of `native/src/compiler/compact_turn_codegen.cpp`, add:

```cpp
#include "compiler/compact_turn_program.hpp"
```

- [x] **Step 2: Emit a program description comment for each generated backend**

In `emitCompactTurnBackend`, immediately after computing the `suffix`, add:

```cpp
    const CompactTurnProgram program = buildCompactTurnProgram(game);
```

Then emit a comment block before the generated access layer:

```cpp
    out << "// compact-turn program source_index=" << sourceIndex
        << " instructions=" << program.instructions.size()
        << " has_again=" << (program.hasAgain ? "true" : "false")
        << " has_cancel=" << (program.hasCancel ? "true" : "false")
        << " has_restart=" << (program.hasRestart ? "true" : "false")
        << " has_rule_loops=" << (program.hasRuleLoops ? "true" : "false")
        << "\\n";
```

- [x] **Step 3: Rename the existing single-turn body as the first executor backend**

Keep the current generated semantics intact by renaming the emitted function from:

```cpp
specialized_compact_turn_single_<suffix>
```

to:

```cpp
compact_turn_execute_program_<suffix>
```

Then update every generated call site inside `emitCompactTurnCompilerStepBody` and `emitCompactTurnCompilerDrainBody` to call `compact_turn_execute_program_<suffix>`.

- [x] **Step 4: Build and run parity**

Run:

```bash
make build
make compact_turn_codegen_solver_parity
```

Expected: parity still passes and coverage remains `33/182` native because blocker gates are unchanged.

- [x] **Step 5: Commit the executor routing**

```bash
git add native/src/compiler/compact_turn_codegen.cpp
git commit -m "refactor: route compact turns through generated executor"
```

## Task 5: Native No-Rule Programs

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `src/tests/compact_turn_native_parity_node.js`

- [x] **Step 1: Add a no-rule focused assertion**

In `src/tests/compact_turn_native_parity_node.js`, after reading `reasons`, add:

```javascript
assert.strictEqual(reasons.no_rules || 0, 0, 'no-rule games must lower to tiny native programs');
```

- [x] **Step 2: Remove the no-rule support blocker**

In `compactNativeTurnUnsupportedReasonForGame`, delete this block:

```cpp
    if (!hasAnyRulegroups(game.rules) && !hasAnyRulegroups(game.lateRules)) {
        return "no_rules";
    }
```

- [x] **Step 3: Ensure empty rule phases are valid**

In `emitCompactRulePhaseGroupFunctions`, keep the existing no-group emission path and make sure it emits:

```cpp
bool compact_turn_apply_<phase>_rules_<suffix>(LevelDimensions dimensions, PersistentLevelState& levelState, Scratch& scratch, CompactTurnCommands_<suffix>& commands, std::vector<bool>* bannedGroups) {
    (void)dimensions;
    (void)levelState;
    (void)scratch;
    (void)commands;
    (void)bannedGroups;
    return false;
}
```

- [x] **Step 4: Verify no-rule coverage improves**

Run:

```bash
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json /tmp/compact_no_rules.json
node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/compact_no_rules.json","utf8")).aggregate.compact_turn; if ((c.native_kernel_status_reason_counts.no_rules||0)!==0) throw new Error("no_rules remains"); console.log(c.native_kernel_supported);'
make compact_turn_codegen_solver_parity
```

Expected: `no_rules` count is zero and solver parity passes.

- [x] **Step 5: Commit no-rule native lowering**

```bash
git add native/src/compiler/compact_turn_codegen.cpp src/tests/compact_turn_native_parity_node.js
git commit -m "feat: lower no-rule compact turns natively"
```

## Task 6: Native Solver Command Policy For Cancel, Restart, And Output Commands

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/src/solver/main.cpp`

- [x] **Step 1: Emit command discard helpers**

Inside `emitCompactTurnAccessLayer`, after `CompactTurnCommands_<suffix>`, emit:

```cpp
SpecializedCompactTurnOutcome compact_turn_solver_discard_<suffix>(const char* reason) {
    SpecializedCompactTurnOutcome outcome;
    outcome.handled = true;
    outcome.discard = true;
    outcome.discardReason = reason;
    outcome.result.changed = false;
    outcome.pendingAgain = false;
    return outcome;
}
```

- [x] **Step 2: Return discard for solver cancel/restart**

In the generated command handling section of the executor, before player-policy rollback/restart code, emit:

```cpp
    if (options.solverMode && commands.hasCancel) {
        addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);
        return compact_turn_solver_discard_<suffix>("cancel");
    }
    if (options.solverMode && commands.hasRestart) {
        addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);
        return compact_turn_solver_discard_<suffix>("restart");
    }
```

Use the real generated suffix in the emitted text.

- [x] **Step 3: Keep checkpoint/message/sfx output-only in solver mode**

Confirm `emitCompactRuleCommandFunction` only sets flags for checkpoint/message/sfx and does not mutate board state. Add this comment in the generated message/sfx branches:

```cpp
    // Solver policy treats this command as output-only; player policy handles visible effects outside compact solver search.
```

- [x] **Step 4: Remove the cancel blocker**

In `compactNativeTurnUnsupportedReasonForGame`, delete:

```cpp
    if (hasRuleCommand(game, "cancel")) {
        return "cancel_command";
    }
```

- [x] **Step 5: Run command parity**

Run:

```bash
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json /tmp/compact_commands.json
node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/compact_commands.json","utf8")).aggregate.compact_turn; if ((c.native_kernel_status_reason_counts.cancel_command||0)!==0) throw new Error("cancel_command remains"); console.log(c.native_kernel_supported);'
make compact_turn_codegen_solver_parity
```

Expected: `cancel_command` count is zero and solver parity passes.

- [x] **Step 6: Commit command policy**

```bash
git add native/src/compiler/compact_turn_codegen.cpp native/src/solver/main.cpp
git commit -m "feat: handle compact solver command discards natively"
```

## Task 7: Native Again Drain

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `src/tests/compact_turn_perf_regression_node.js`

- [x] **Step 1: Remove `again` as a native blocker**

In `compactNativeTurnUnsupportedReasonForGame`, delete:

```cpp
    if (hasRuleCommand(game, "again")) {
        return "again_command";
    }
```

- [x] **Step 2: Preserve native drain behavior in generated executor**

In `emitCompactTurnCompilerDrainBody`, keep this structure and make every call target the renamed executor:

```cpp
    bool hasAgain = false;
    SpecializedCompactTurnOutcome outcome = compact_turn_execute_program_<suffix>(
        dimensions,
        currentLevelIndex,
        levelState,
        scratch,
        input,
        options,
        &hasAgain,
        false
    );
    outcome.pendingAgain = hasAgain;
    if (!outcome.handled || options.againPolicy != AgainPolicy::Drain || outcome.discard) {
        return outcome;
    }
```

Inside the drain loop, keep the parent edge when an automatic `again` tick
discards:

```cpp
        if (!tickOutcome.handled) {
            return tickOutcome;
        }
        if (tickOutcome.discard) {
            hasAgain = false;
            outcome.pendingAgain = false;
            break;
        }
```

- [x] **Step 3: Verify `AgainPolicy::Drain` in coverage and parity**

Run:

```bash
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json /tmp/compact_again.json
node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/compact_again.json","utf8")).aggregate.compact_turn; if ((c.native_kernel_status_reason_counts.again_command||0)!==0) throw new Error("again_command remains"); console.log(c.native_kernel_supported);'
make compact_turn_codegen_solver_parity
```

Expected: `again_command` count is zero and solver parity passes.

Status: coverage passed with `again_command=0` and native coverage `74/182`.
`make compact_turn_codegen_solver_parity` passed with `games=153/153`,
`levels=2513`, `compact_turn_unhandled=0`, and `compact_turn_oracle_failures=0`.
The previous `It gets its Feet Wet.txt#1` mismatch was fixed by preserving the
primary edge when an internal automatic `again` tick returns solver discard and
by teaching generated pattern matching to honor `anyMovements` and
layer-coupled movement pattern masks. The run still reported
`compact_timeout_regressions=5`, which is performance debt for a follow-up.

- [x] **Step 4: Tighten the Voitex perf regression to require native**

In `src/tests/compact_turn_perf_regression_node.js`, replace the Voitex native-skip assertion:

```javascript
            const usedNative = compiled.result.compact_turn_native_hits > 0;
            assert.ok(
                usedNative || compiled.result.compact_turn_native_attempts === 0,
                'Voitex should either use native compact turns or deliberately skip native compact turns'
            );
```

with:

```javascript
            assert.ok(
                compiled.result.compact_turn_native_hits > 0,
                'Voitex should use native compact turns after mini-VM parity'
            );
```

- [x] **Step 5: Commit native again support**

```bash
git add docs/superpowers/plans/2026-06-17-compact-turn-native-mini-vm.md native/src/compiler/compact_turn_codegen.cpp native/src/runtime/core.cpp native/src/solver/main.cpp native/tests/compact_turn_solver_command_api.txt native/tests/player_api_tests.cpp src/tests/compact_turn_perf_regression_node.js
git commit -m "feat: drain compact again natively"
```

## Task 8: Native Rule Loop Execution

**Files:**
- Modify: `native/src/compiler/compact_turn_program.cpp`
- Modify: `native/src/compiler/compact_turn_codegen.cpp`

- [x] **Step 1: Use generated loop metadata from the program**

In `compact_turn_program.cpp`, confirm `JumpIfChanged` instructions are emitted after every group with a loop target. Keep the exact block from Task 3:

```cpp
        if (index < loopPoints.entries.size() && loopPoints.entries[index].has_value()) {
            CompactTurnProgramInstruction jump;
            jump.op = CompactTurnProgramOp::JumpIfChanged;
            jump.groupIndex = static_cast<int32_t>(index);
            jump.jumpTarget = *loopPoints.entries[index];
            jump.late = late;
            program.instructions.push_back(jump);
        }
```

- [x] **Step 2: Remove the rule-loop native blocker**

In `compactNativeTurnUnsupportedReasonForGame`, delete:

```cpp
    if (hasLoopPoints(game.loopPoint) || hasLoopPoints(game.lateLoopPoint)) {
        return "rule_loops";
    }
```

- [x] **Step 3: Keep generated phase loop functions authoritative**

Use the already-generated `compact_turn_lookup_<phase>_loop_point_<suffix>` and `compact_turn_apply_<phase>_rules_<suffix>` functions for loop execution. Confirm the generated phase function still contains:

```cpp
            const int32_t target = compact_turn_lookup_<phase>_loop_point_<suffix>(groupIndex);
            if (target >= 0) {
                groupIndex = target;
                continue;
            }
```

- [x] **Step 4: Verify loop coverage and parity**

Run:

```bash
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json /tmp/compact_loops.json
node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/compact_loops.json","utf8")).aggregate.compact_turn; if ((c.native_kernel_status_reason_counts.rule_loops||0)!==0) throw new Error("rule_loops remains"); console.log(c.native_kernel_supported);'
make compact_turn_codegen_solver_parity
```

Expected: `rule_loops` count is zero and solver parity passes.

Status: coverage passed with `rule_loops=0` and native coverage `75/182`.
`make compact_turn_codegen_solver_parity` passed with `games=153/153`,
`levels=2513`, `compact_turn_unhandled=0`, and
`compact_turn_oracle_failures=0`. The run reported
`compact_timeout_regressions=6`, which remains performance debt.

- [x] **Step 5: Commit native rule loops**

```bash
git add docs/superpowers/plans/2026-06-17-compact-turn-native-mini-vm.md native/src/compiler/compact_turn_codegen.cpp
git commit -m "feat: support compact native rule loops"
```

## Task 9: Native Run-Rules-On-Level-Start Support

**Files:**
- Modify: `native/src/compiler/compact_turn_program.hpp`
- Modify: `native/src/compiler/compact_turn_program.cpp`
- Modify: `native/src/compiler/compact_turn_codegen.cpp`

- [x] **Step 1: Add entry mode to the program model**

In `native/src/compiler/compact_turn_program.hpp`, add:

```cpp
enum class CompactTurnProgramEntry {
    NormalTurn,
    LevelStart,
};
```

and add this field to `CompactTurnProgram`:

```cpp
    CompactTurnProgramEntry entry = CompactTurnProgramEntry::NormalTurn;
```

- [x] **Step 2: Build a level-start program variant**

In `compact_turn_program.hpp`, declare:

```cpp
CompactTurnProgram buildCompactTurnLevelStartProgram(const Game& game);
```

In `compact_turn_program.cpp`, add:

```cpp
CompactTurnProgram buildCompactTurnLevelStartProgram(const Game& game) {
    CompactTurnProgram program = buildCompactTurnProgram(game);
    program.entry = CompactTurnProgramEntry::LevelStart;
    return program;
}
```

- [x] **Step 3: Remove run-start blockers**

In `compactNativeTurnUnsupportedReasonForGame`, delete both blocks:

```cpp
    if (hasGameMetadata(game, "run_rules_on_level_start") && hasAnyRulegroups(game.lateRules)
        && !hasTransparentColoredObject(game)) {
        return "run_rules_on_level_start_late_rules";
    }
```

and:

```cpp
    if (hasGameMetadata(game, "run_rules_on_level_start")) {
        return "run_rules_on_level_start_native_perf_guard";
    }
```

- [x] **Step 4: Keep solver restart discard ahead of level-start**

In generated command handling, confirm solver restart discard appears before any player restart branch:

```cpp
    if (options.solverMode && commands.hasRestart) {
        addProfileNs(RuntimeCounterId::CompactTurnCanonicalizeNs);
        return compact_turn_solver_discard_<suffix>("restart");
    }
```

- [x] **Step 5: Verify run-start coverage and parity**

Run:

```bash
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json /tmp/compact_run_start.json
node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/compact_run_start.json","utf8")).aggregate.compact_turn; const r=c.native_kernel_status_reason_counts; if ((r.run_rules_on_level_start_late_rules||0)!==0 || (r.run_rules_on_level_start_native_perf_guard||0)!==0) throw new Error("run_rules_on_level_start blockers remain"); console.log(c.native_kernel_supported);'
make compact_turn_codegen_solver_parity
```

Expected: both run-start blocker counts are zero and solver parity passes.

Status: coverage passed with native compact coverage `111/182` and both
`run_rules_on_level_start_*` blocker counts at zero. A generated matcher
regression surfaced in `gem soketeer.txt#11`: layer-coupled movement masks were
flattened as AND terms instead of OR-within-each-coupled-group. Added a focused
compiled compact command API regression for property movement alternatives and
fixed codegen to emit coupled match group first/count tables. Verification:
`make compact_turn_codegen_solver_command_api` passed, targeted
`gem soketeer.txt#11` compact oracle passed with a timeout warning, and full
`make compact_turn_codegen_solver_parity` passed with `games=153/153`,
`levels=2513`, `compact_turn_unhandled=0`,
`compact_turn_oracle_failures=0`, and `compact_timeout_regressions=43`.

- [x] **Step 6: Commit run-start support**

```bash
git add native/src/compiler/compact_turn_program.hpp native/src/compiler/compact_turn_program.cpp native/src/compiler/compact_turn_codegen.cpp
git commit -m "feat: support compact native level-start turns"
```

## Task 10: Native Aggregate Binding Lowering

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp`

- [ ] **Step 1: Remove aggregate bindings as a native blocker**

In `compactNativeTurnUnsupportedReasonForRule`, delete:

```cpp
    if (!rule.aggregateBindings.empty()) {
        return "aggregate_bindings";
    }
```

- [ ] **Step 2: Emit aggregate binding comments into affected rule kernels**

In each compact rule emit path that receives a `Rule& rule`, before emitting the apply body, add this generated comment when bindings exist:

```cpp
    if (!rule.aggregateBindings.empty()) {
        out << "// compact aggregate bindings: " << rule.aggregateBindings.size() << "\\n";
    }
```

- [ ] **Step 3: Use lowered replacement masks for aggregate-bound rules**

Confirm aggregate binding resolution has already populated runtime replacement masks in `Rule` lowering. Generated compact apply code must continue using the existing `Pattern` replacement masks and must not inspect source-level aggregate names during execution.

The emitted apply path should still call:

```cpp
compact_turn_pattern_apply_<suffix>(dimensions, levelState, scratch, tileIndex, replacementPattern, commands);
```

for aggregate-bound rules.

- [ ] **Step 4: Verify aggregate coverage and parity**

Run:

```bash
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json /tmp/compact_aggregate.json
node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/compact_aggregate.json","utf8")).aggregate.compact_turn; if ((c.native_kernel_status_reason_counts.aggregate_bindings||0)!==0) throw new Error("aggregate_bindings remains"); console.log(c.native_kernel_supported);'
make compact_turn_codegen_solver_parity
```

Expected: `aggregate_bindings` count is zero and solver parity passes. If parity fails, inspect the first oracle mismatch and keep the blocker removed only after generated apply semantics match interpreter output.

- [ ] **Step 5: Commit aggregate support**

```bash
git add native/src/compiler/compact_turn_codegen.cpp
git commit -m "feat: support compact aggregate bindings natively"
```

## Task 11: Native Transparent Object And Verbose Metadata Support

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp`

- [ ] **Step 1: Remove transparent object and verbose blockers**

In `compactNativeTurnUnsupportedReasonForGame`, delete:

```cpp
    if (hasTransparentColoredObject(game)
        && (hasGameMetadata(game, "again_interval")
            || hasGameMetadata(game, "run_rules_on_level_start")
            || hasGameMetadata(game, "require_player_movement"))) {
        return "transparent_object_compact_unsupported";
    }
```

and:

```cpp
    if (hasGameMetadata(game, "verbose_logging")) {
        return "verbose_logging";
    }
```

- [ ] **Step 2: Keep transparent objects semantic-only in compact execution**

In `hasTransparentColoredObject`, keep the helper for diagnostics, but do not use it in native support gating. Add this comment above the function:

```cpp
// Transparent color affects rendering, not compact solver semantics. Keep this
// helper for diagnostics only; native compact-turn support must not gate on it.
```

- [ ] **Step 3: Verify transparent coverage and parity**

Run:

```bash
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json /tmp/compact_transparent.json
node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/compact_transparent.json","utf8")).aggregate.compact_turn; const r=c.native_kernel_status_reason_counts; if ((r.transparent_object_compact_unsupported||0)!==0 || (r.verbose_logging||0)!==0) throw new Error("transparent/verbose blockers remain"); console.log(c.native_kernel_supported);'
make compact_turn_codegen_solver_parity
```

Expected: transparent and verbose blocker counts are zero and solver parity passes.

- [ ] **Step 4: Commit transparent support**

```bash
git add native/src/compiler/compact_turn_codegen.cpp
git commit -m "feat: allow transparent compact native kernels"
```

## Task 12: Remove Accepted Compiler-Mode Bridges

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/src/compiler/compact_turn_codegen.hpp`
- Modify: `src/tests/compact_turn_native_parity_node.js`

- [ ] **Step 1: Make compiler mode report native for all supported games**

Change `compactTurnSupportForGame` to stop converting unsupported native cases into accepted bridges. The final function should be:

```cpp
CompactTurnSupport compactTurnSupportForGame(const Game& game, const CompactCodegenOptions& options) {
    CompactTurnSupport support = compactNativeTurnSupportForGame(game);
    support.nativeKernelStatusReason = support.statusReason;
    if (options.interpreterMode) {
        support.backendKind = CompactTurnBackendKind::InterpreterBridge;
        support.statusReason = "interpreter_bridge";
        return support;
    }
    return support;
}
```

- [ ] **Step 2: Make native support default to native kernel when no blocker remains**

At the end of `compactNativeTurnSupportForGame`, keep:

```cpp
    CompactTurnSupport support;
    support.backendKind = CompactTurnBackendKind::NativeKernel;
    support.statusReason = "native_kernel";
    return support;
```

- [ ] **Step 3: Run strict coverage**

Run:

```bash
make compact_turn_native_parity
```

Expected:

```text
compact_turn_native_parity_node passed native=182/182
```

- [ ] **Step 4: Commit strict native support reporting**

```bash
git add native/src/compiler/compact_turn_codegen.cpp native/src/compiler/compact_turn_codegen.hpp src/tests/compact_turn_native_parity_node.js
git commit -m "feat: require native compact compiler coverage"
```

## Task 13: Full Correctness And Perf Validation

**Files:**
- Modify: `src/tests/compact_turn_perf_regression_node.js`
- Modify: `Makefile`

- [ ] **Step 1: Run core build**

Run:

```bash
make build
```

Expected: build passes.

- [ ] **Step 2: Run strict native coverage**

Run:

```bash
make compact_turn_native_parity
```

Expected:

```text
compact_turn_native_parity_node passed native=182/182
```

- [ ] **Step 3: Run solver parity**

Run:

```bash
make compact_turn_codegen_solver_parity
```

Expected: JSON totals include `compact_turn_oracle_failures=0`, `compact_turn_unhandled=0`, and all required compact attempts handled.

- [ ] **Step 4: Add a concrete targeted perf Make target**

Add `compact_turn_perf_regression` to the `.PHONY` block.

Add this variable near the compact-turn variables:

```make
COMPACT_TURN_PERF_TIMEOUT_MS ?= 1000
```

Add this target near the other compact-turn codegen targets:

```make
compact_turn_perf_regression: $(PUZZLESCRIPT_SOLVER)
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(find src/tests/solver_tests -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-turn-perf-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-turn-perf-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/solver_tests,compact_turn_perf_$$hash,--compact-turn-only --compact-turn-mode=compiler); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
	$(NODE) src/tests/compact_turn_perf_regression_node.js --corpus src/tests/solver_tests --interpreter-solver "$(PUZZLESCRIPT_SOLVER)" --compiled-solver "$$build_dir/native/puzzlescript_solver" --timeout-ms "$(COMPACT_TURN_PERF_TIMEOUT_MS)"
```

- [ ] **Step 5: Run targeted perf harness**

Run:

```bash
make compact_turn_perf_regression
```

Expected: `compact_turn_perf_regression_node passed`, `manic_ammo` remains a strong native win, and `Voitex` uses native compact turns without throughput regression.

- [ ] **Step 6: Run timeout curve validation**

Run:

```bash
make solver_timeout_curve SOLVER_TIMEOUT_CURVE_MAX_MS=1000 SOLVER_TIMEOUT_CURVE_PROGRESS=quiet COMPILED_RULES_PERF=true
```

Expected: compiled portfolio and compiled HDA solve at least as many levels as their interpreter counterparts at 1000ms.

- [ ] **Step 7: Commit validation target updates**

```bash
git add Makefile src/tests/compact_turn_perf_regression_node.js
git commit -m "test: validate compact native mini vm performance"
```

## Task 14: Merge Readiness Check

**Files:**
- No code changes expected.

- [ ] **Step 1: Inspect final status**

Run:

```bash
git status --short --branch
git log --oneline -8
```

Expected: clean worktree on the implementation branch.

- [ ] **Step 2: Record final coverage numbers**

Run:

```bash
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json /tmp/solver_compact_turn_coverage_final.json
node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("/tmp/solver_compact_turn_coverage_final.json","utf8")).aggregate.compact_turn; console.log(JSON.stringify({sources:c.sources,native:c.native_kernel_supported,bridge:c.interpreter_bridge_supported,reasons:c.native_kernel_status_reason_counts}, null, 2));'
```

Expected:

```json
{
  "sources": 182,
  "native": 182,
  "bridge": 0,
  "reasons": {
    "native_kernel": 182
  }
}
```

- [ ] **Step 3: Prepare handoff summary**

Write a short summary with:

```text
Coverage: native 182/182, bridge 0/182
Correctness: compact_turn_codegen_solver_parity passed
Perf: targeted harness passed
Curve: compiled >= interpreter at 1000ms
Known risks: any remaining perf variance or long-running full curve notes
```

Do not commit this summary unless it is added to an existing project handoff document.

---

## Implementation Notes

- Keep bridge generation available for `--compact-turn-mode=interpreter`; the strict ban applies to compiler mode.
- Do not remove oracle checks while developing. Oracle failures are signal, not noise.
- Prefer adding compact helpers over making `compact_turn_codegen.cpp` larger when a helper has a stable interface.
- The first task that makes `make compact_turn_native_parity` pass is Task 12. Earlier tasks should improve blocker counts while strict coverage still fails.
- When a blocker removal causes a parity mismatch, keep the failing coverage test and fix generated semantics before committing that blocker removal.
