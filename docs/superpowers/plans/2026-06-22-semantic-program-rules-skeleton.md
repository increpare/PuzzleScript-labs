# SemanticProgram Rules — Slice 7a (Skeleton + Capture Mechanism) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authored (pre-expansion) rules to the `SemanticProgram` contract at the *skeleton* level — direction, modifiers, group, commands, line number, and LHS/RHS cell/term counts — by capturing the lowerer's existing `ParsedRow` structure off the runtime hot path.

**Architecture:** `lowerToRuntimeGame` already builds the authored `ParsedRow` (`{dir,name}` cells) per source rule before expansion, then discards it. This slice adds an optional out-parameter that captures those rows (plus direction/modifiers/group/commands) into a `std::vector<SemanticRule>`; the runtime/solver path passes `nullptr` and pays nothing. `buildSemanticProgram` takes the captured rules and emits them. The full `SemanticRule` struct (including terms) is defined here; 7a serializes only the skeleton + counts, and slice 7b fills in term contents. See the design doc `docs/superpowers/specs/2026-06-22-semantic-program-rules-design.md`.

**Tech Stack:** C++17 (`puzzlescript_compiler`), Node.js (JS oracle), CMake/CTest.

**Prerequisite facts (verified against the tree):**
- `lowerToRuntimeGame(const ParserState& state, LoadedGame& outGame)` (`native/src/compiler/lower_to_runtime.hpp`). The rule loop assembles, per source rule and **before expansion** (`native/src/compiler/lower_to_runtime.cpp` ~lines 1300-1506): `rigidRule`/`randomRule`/`lateRule`/`sameGroup` modifiers and the direction tokens (~1321-1340); `lhsRows` and `rhsRows` (`std::vector<ParsedRow>`) and `parsedCommands` (`std::vector<puzzlescript::RuleCommand>`) at ~1502-1506. The current group is `groups.back()` where `groups` is `game->lateRules` or `game->rules` (~1343-1347).
- `ParsedRow = std::vector<ParsedCell>`; `ParsedCell { bool isEllipsis; std::vector<ParsedItem> items; }`; `ParsedItem { std::string dir; std::string name; }`. These are local types inside `lowerToRuntimeGame` — this slice promotes the captured shape to the public `SemanticRule` contract types.
- `puzzlescript::RuleCommand { std::string name; std::optional<std::string> argument; }` (`native/src/runtime/core.hpp`).
- `buildSemanticProgram(const Game& game)` is called at `native/src/cli/main.cpp:6586` (the `--emit-semantic-program` path, which already has both the `parserState` and the lowered game) and in `native/tests/compiler_semantic_program.cpp`.
- JS `state.rules` entries carry `{ direction, lhs, rhs, lineNumber, late, rigid, groupNumber, commands, randomRule }` (`src/js/compiler.js`), where `lhs`/`rhs` are `CellMask[]` rows — usable for counts in 7a; term contents come in 7b.
- The corpus gate `semantic_program_parity_corpus_node.js` auto-covers any new top-level field across the 161 conforming games.

---

## File Structure

- **Modify** `native/src/compiler/types/semantic_program.hpp` — add `SemanticTerm`/`SemanticCell`/`SemanticRuleCommand`/`SemanticRule` types and a `rules` field.
- **Modify** `native/src/compiler/lower_to_runtime.hpp` / `.cpp` — add the optional capture out-parameter and populate it in the rule loop.
- **Modify** `native/src/compiler/semantic_program.hpp` / `.cpp` — `buildSemanticProgram` takes the captured rules; serialize the rule skeleton (counts).
- **Modify** `native/src/cli/main.cpp` — capture rules during lower, pass to `buildSemanticProgram`.
- **Modify** `native/tests/compiler_semantic_program.cpp` — capture rules in the test call; assert sokoban's rule skeleton.
- **Modify** `src/tests/js_oracle/lib/puzzlescript_semantic_program.js` — emit the rule skeleton.

---

## Task 1: Capture authored rules off the hot path

**Files:**
- Modify: `native/src/compiler/types/semantic_program.hpp`
- Modify: `native/src/compiler/lower_to_runtime.hpp`
- Modify: `native/src/compiler/lower_to_runtime.cpp`
- Modify: `native/src/compiler/semantic_program.hpp`
- Modify: `native/src/compiler/semantic_program.cpp`
- Modify: `native/src/cli/main.cpp`
- Modify: `native/tests/compiler_semantic_program.cpp`

- [ ] **Step 1: Add the SemanticRule contract types**

In `native/src/compiler/types/semantic_program.hpp`, add before `struct SemanticProgram` (the `<string>`/`<vector>` includes are already present):

```cpp
struct SemanticTerm {
    std::string dir;   // movement/direction modifier: "" | ">" | "<" | "^" | "v" | "moving" | "stationary" | "no" | "randomdir" | "action" | "up"/"down"/"left"/"right" | "horizontal"/"vertical" | "orthogonal" | "perpendicular" | "parallel"
    std::string name;  // object/legend name, lowercased
};

struct SemanticCell {
    bool ellipsis = false;            // "..." cell; terms is empty when true
    std::vector<SemanticTerm> terms;
};

using SemanticRow = std::vector<SemanticCell>;  // one bracket [ ... ]

struct SemanticRuleCommand {
    std::string name;
    std::string argument;  // "" when the command has no argument
};

struct SemanticRule {
    int32_t lineNumber = 0;
    std::vector<std::string> directions;  // as-written direction-prefix tokens (0+), e.g. {"horizontal"} or {"up"}
    bool rigid = false;
    bool random = false;
    bool late = false;
    int32_t groupNumber = 0;
    std::vector<SemanticRow> lhs;
    std::vector<SemanticRow> rhs;
    std::vector<SemanticRuleCommand> commands;
};
```

and add a field to `SemanticProgram` (after `sounds`):

```cpp
    std::vector<SemanticRule> rules;  // authored, pre-expansion; source-declaration order (early then late)
```

- [ ] **Step 2: Add the optional capture out-parameter to the lowerer**

In `native/src/compiler/lower_to_runtime.hpp`, add the include and the parameter (default `nullptr` so all existing callers and the runtime path are unaffected):

```cpp
#include <vector>

#include "compiler/types/parser_state.hpp"
#include "compiler/types/semantic_program.hpp"
#include "runtime/core.hpp"

namespace puzzlescript::compiler {

std::unique_ptr<puzzlescript::Error> lowerToRuntimeGame(
    const ParserState& state,
    puzzlescript::LoadedGame& outGame,
    std::vector<SemanticRule>* outAuthoredRules = nullptr
);

} // namespace puzzlescript::compiler
```

- [ ] **Step 3: Collect the as-written direction tokens in the rule loop**

In `native/src/compiler/lower_to_runtime.cpp`, the direction-parsing loop (~1321-1337) reads each token before the first `[` and classifies it. Add a local that records the raw direction words. Just before that `while` loop (next to `std::vector<std::string> ruleDirections;`), add:

```cpp
        std::vector<std::string> authoredDirections;
```

and inside the loop, in the branches that recognize a direction token (the `up/down/left/right` branch and the `horizontal/vertical/orthogonal` branch), record the raw token:

```cpp
            if (token == "up" || token == "down" || token == "left" || token == "right") {
                authoredDirections.push_back(token);
                ruleDirections.push_back(token);
            } else if (token == "horizontal" || token == "vertical" || token == "orthogonal") {
                authoredDirections.push_back(token);
                addDirectionAggregate(token);
            } else if (token == "rigid") {
```

(Only the first two `else if` arms change — append the `authoredDirections.push_back(token);` line; leave `rigid`/`random`/`late`/`+` arms as-is.)

- [ ] **Step 4: Capture the authored rule before expansion**

In `native/src/compiler/lower_to_runtime.cpp`, immediately after `rhsRows` is assigned (after the `auto rhsRows = ...;` block, ~line 1506) and before the expansion logic, add the capture. `lineNumber` is the per-rule line number already in scope in this loop; `groups` is the early/late group vector chosen at ~1343; the current group index is `groups.size() - 1`:

```cpp
        if (outAuthoredRules != nullptr) {
            auto toSemanticRow = [](const std::vector<ParsedRow>& rows) {
                std::vector<SemanticRow> out;
                out.reserve(rows.size());
                for (const auto& row : rows) {
                    SemanticRow semRow;
                    semRow.reserve(row.size());
                    for (const auto& cell : row) {
                        SemanticCell semCell;
                        semCell.ellipsis = cell.isEllipsis;
                        semCell.terms.reserve(cell.items.size());
                        for (const auto& item : cell.items) {
                            semCell.terms.push_back(SemanticTerm{item.dir, item.name});
                        }
                        semRow.push_back(std::move(semCell));
                    }
                    out.push_back(std::move(semRow));
                }
                return out;
            };

            SemanticRule authored;
            authored.lineNumber = lineNumber;
            authored.directions = authoredDirections;
            authored.rigid = rigidRule;
            authored.random = randomRule;
            authored.late = lateRule;
            authored.groupNumber = static_cast<int32_t>(groups.size()) - 1;
            authored.lhs = toSemanticRow(lhsRows);
            authored.rhs = toSemanticRow(rhsRows);
            authored.commands.reserve(parsedCommands.size());
            for (const auto& cmd : parsedCommands) {
                authored.commands.push_back(
                    SemanticRuleCommand{cmd.name, cmd.argument.value_or(std::string{})});
            }
            outAuthoredRules->push_back(std::move(authored));
        }
```

Note: `lhsRows`/`rhsRows` are non-const (later trimmed in place by the lowerer); capture is read-only and happens before any trimming, preserving the authored form. If `lineNumber` is not the exact local name in this loop, use the rule entry's line number already referenced when constructing the lowered `puzzlescript::Rule` (search for `.lineNumber` assignments within this loop body).

- [ ] **Step 5: Thread captured rules into buildSemanticProgram**

In `native/src/compiler/semantic_program.hpp`, change the signature:

```cpp
SemanticProgram buildSemanticProgram(
    const puzzlescript::Game& game,
    const std::vector<SemanticRule>& authoredRules = {}
);
```

In `native/src/compiler/semantic_program.cpp`, at the end of `buildSemanticProgram` (after `program.sounds.events = game.sfxEvents;`, before `return program;`):

```cpp
    program.rules = authoredRules;
```

and update the function definition's signature to match.

- [ ] **Step 6: Update the two call sites to capture + pass rules**

In `native/src/cli/main.cpp`, the `--emit-semantic-program` block (~line 6571-6587) compiles via `parseSource` + `lowerToRuntimeGame`. Change the lower call to capture and pass the rules:

```cpp
        std::vector<puzzlescript::compiler::SemanticRule> authoredRules;
        if (auto error = puzzlescript::compiler::lowerToRuntimeGame(parserState, loadedGame, &authoredRules)) {
            std::cerr << error->message << "\n";
            return 1;
        }
        if (!loadedGame.information) {
            std::cerr << "Failed to lower source to a runtime game.\n";
            return 1;
        }
        const auto program = puzzlescript::compiler::buildSemanticProgram(*loadedGame.information, authoredRules);
```

In `native/tests/compiler_semantic_program.cpp`, update the main `lowerToRuntimeGame`/`buildSemanticProgram` calls (~lines 35-39) the same way:

```cpp
    std::vector<puzzlescript::compiler::SemanticRule> authoredRules;
    auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame, &authoredRules);
    assert(!error);
    assert(loadedGame.information);

    const auto program = puzzlescript::compiler::buildSemanticProgram(*loadedGame.information, authoredRules);
```

- [ ] **Step 7: Assert the captured rule skeleton (sokoban)**

In `native/tests/compiler_semantic_program.cpp`, after the sounds assertions (before the `const std::string json = ...` line), add. sokoban_basic has one rule group with the single rule `[ > Player | Crate ] -> [ > Player | > Crate ]` (no modifiers, no commands, one LHS row of 2 cells, one RHS row of 2 cells):

```cpp
    // Rules: sokoban_basic has exactly one authored rule, `[ > Player | Crate ] ->
    // [ > Player | > Crate ]` — group 0, no modifiers/commands, one LHS row of 2
    // cells and one RHS row of 2 cells.
    assert(program.rules.size() == 1);
    const auto& sokRule = program.rules[0];
    assert(!sokRule.rigid && !sokRule.random && !sokRule.late);
    assert(sokRule.groupNumber == 0);
    assert(sokRule.commands.empty());
    assert(sokRule.lhs.size() == 1 && sokRule.lhs[0].size() == 2);
    assert(sokRule.rhs.size() == 1 && sokRule.rhs[0].size() == 2);
```

- [ ] **Step 8: Build and run the unit test (red → green)**

Run:
```bash
cmake -S . -B build
cmake --build build --target compiler_semantic_program -j
ctest --test-dir build -R '^compiler_semantic_program$' --output-on-failure
```
Expected: builds and `Passed`. (Before Step 1 the build fails — `SemanticRule` undefined — the red state. If the rule count/cell counts differ from the assertion, print `program.rules[0].lhs[0].size()` etc. and reconcile against sokoban's actual rule before adjusting — do not loosen the assertion to pass.)

- [ ] **Step 9: Commit**

```bash
git add native/src/compiler/types/semantic_program.hpp native/src/compiler/lower_to_runtime.hpp native/src/compiler/lower_to_runtime.cpp native/src/compiler/semantic_program.hpp native/src/compiler/semantic_program.cpp native/src/cli/main.cpp native/tests/compiler_semantic_program.cpp
git commit -m "feat(native): capture authored rules off the hot path (SemanticProgram rules 7a)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Serialize the rule skeleton + JS emitter + corpus gate

**Files:**
- Modify: `native/src/compiler/semantic_program.cpp`
- Modify: `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`
- Modify: `native/tests/compiler_semantic_program.cpp`

- [ ] **Step 1: Serialize the rule skeleton (C++)**

In `native/src/compiler/semantic_program.cpp`, add a skeleton serializer in the anonymous namespace (emits direction/modifiers/group/commands + LHS/RHS as per-cell term *counts*; ellipsis cells emit `-1`). Reuses `appendJsonString`/`appendIntArray`:

```cpp
void appendRowCounts(std::string& out, const std::vector<SemanticRow>& rows) {
    out += '[';
    for (size_t r = 0; r < rows.size(); ++r) {
        if (r != 0) {
            out += ',';
        }
        std::vector<int32_t> cellCounts;
        cellCounts.reserve(rows[r].size());
        for (const auto& cell : rows[r]) {
            cellCounts.push_back(cell.ellipsis ? -1 : static_cast<int32_t>(cell.terms.size()));
        }
        appendIntArray(out, cellCounts);
    }
    out += ']';
}

void appendRuleArray(std::string& out, const std::vector<SemanticRule>& rules) {
    out += '[';
    for (size_t i = 0; i < rules.size(); ++i) {
        if (i != 0) {
            out += ',';
        }
        const auto& rule = rules[i];
        out += "{\"line_number\":";
        out += std::to_string(rule.lineNumber);
        out += ",\"directions\":[";
        for (size_t d = 0; d < rule.directions.size(); ++d) {
            if (d != 0) {
                out += ',';
            }
            appendJsonString(out, rule.directions[d]);
        }
        out += "],\"rigid\":";
        out += rule.rigid ? "true" : "false";
        out += ",\"random\":";
        out += rule.random ? "true" : "false";
        out += ",\"late\":";
        out += rule.late ? "true" : "false";
        out += ",\"group_number\":";
        out += std::to_string(rule.groupNumber);
        out += ",\"lhs_cell_term_counts\":";
        appendRowCounts(out, rule.lhs);
        out += ",\"rhs_cell_term_counts\":";
        appendRowCounts(out, rule.rhs);
        out += ",\"commands\":[";
        for (size_t c = 0; c < rule.commands.size(); ++c) {
            if (c != 0) {
                out += ',';
            }
            out += "{\"name\":";
            appendJsonString(out, rule.commands[c].name);
            out += ",\"argument\":";
            appendJsonString(out, rule.commands[c].argument);
            out += "}";
        }
        out += "]}";
    }
    out += ']';
}
```

Then emit it in `serializeSemanticProgramJson`, replacing the sounds tail:

```cpp
    out += ",\"sounds\":{\"events\":";
    appendSoundEventsObject(out, program.sounds.events);
    out += "},\"rules\":";
    appendRuleArray(out, program.rules);
    out += "}}";
    return out;
```

(The previous tail ended `…appendSoundEventsObject(...); out += "}}}";` — the `sounds` object's closing `}` now precedes `,"rules":`, and the final `}}` closes `semantic_program` and root.)

- [ ] **Step 2: Add the rule JSON-shape assertion (C++)**

In `native/tests/compiler_semantic_program.cpp`, with the other `json.find(...)` assertions:

```cpp
    assert(json.find("\"rules\"") != std::string::npos);
    assert(json.find("\"group_number\"") != std::string::npos);
    assert(json.find("\"lhs_cell_term_counts\"") != std::string::npos);
```

- [ ] **Step 3: Emit the rule skeleton (JS)**

In `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`, add a helper above `buildSemanticProgramSnapshot`. JS `state.rules` are post-expansion, so the *authored* directions/grouping must be derived the same way 7a's C++ capture does — but for the skeleton, the JS rule object already carries the resolved per-rule fields, and cell/term counts come from the `CellMask[]` rows. Emit cell counts as the number of cells per row and term counts via each cell's term count (a `CellMask` exposes its terms through the engine's rule representation):

```js
function ruleList(state) {
    function rowCounts(rows) {
        return rows.map(function (row) {
            return row.map(function (cell) {
                // An ellipsis cell is encoded as the ellipsis sentinel; otherwise
                // count the cell's terms. `cell.length`/term access mirrors the
                // engine's CellMask term layout (see compiler.js rule processing).
                return cell.isEllipsis ? -1 : cell.termCount;
            });
        });
    }
    return state.rules.map(function (rule) {
        return {
            line_number: rule.lineNumber,
            directions: rule.directions,
            rigid: !!rule.rigid,
            random: !!rule.randomRule,
            late: !!rule.late,
            group_number: rule.groupNumber,
            lhs_cell_term_counts: rowCounts(rule.lhs),
            rhs_cell_term_counts: rowCounts(rule.rhs),
            commands: (rule.commands || []).map(function (cmd) {
                return { name: cmd[0], argument: cmd.length > 1 ? String(cmd[1]) : '' };
            }),
        };
    });
}
```

Then add `const rules = ruleList(state);` in `buildSemanticProgramSnapshot` and include `rules` in the returned `semantic_program` object.

> Implementation note: JS `state.rules` is **post-expansion** (one entry per directional variant) while the C++ capture is **pre-expansion** (one entry per source line). This will not match directly. Resolve by emitting the JS authored form from the same pre-expansion point the C++ capture uses — capture `state.rules` *before* `rulesToArray` performs direction/property expansion (or retain the authored rule list alongside the expanded one). Confirm the JS `rule.lhs`/`rhs` term-count and `directions`/`commands` encodings against `compiler.js` during implementation; the corpus gate (Step 5) is the arbiter.

- [ ] **Step 4: Build and run the unit + smoke tests**

Run:
```bash
cmake --build build --target compiler_semantic_program puzzlescript_cpp -j
ctest --test-dir build -R 'compiler_semantic_program|puzzlescript_cpp_semantic_program_smoke' --output-on-failure
```
Expected: pass; the emitted JSON contains a `rules` array.

- [ ] **Step 5: Validate JS↔C++ rule-skeleton parity over the corpus**

Run:
```bash
bash scripts/diff_semantic_program_against_js.sh src/demo/sokoban_basic.txt; echo "sokoban exit=$?"
node src/tests/semantic_program_parity_corpus_node.js build/native/puzzlescript_cpp src/tests/solver_tests
```
Expected: sokoban `exit=0`, and `conforming + parity-matched: 161` with `parity failures: 0`, now including the rule skeleton. The expected divergence sources to triage (this is the point of the slice): pre- vs post-expansion rule lists (the JS side must emit authored/pre-expansion rules — see Step 3's note), direction-token capture, and command encoding. Reconcile by making the JS emitter produce the authored form; do not loosen the gate.

- [ ] **Step 6: Run the full semantic suite and commit**

```bash
ctest --test-dir build -R 'semantic_program' --output-on-failure
git add native/src/compiler/semantic_program.cpp src/tests/js_oracle/lib/puzzlescript_semantic_program.js native/tests/compiler_semantic_program.cpp
git commit -m "feat(native): serialize + gate authored rule skeleton (SemanticProgram rules 7a)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Implements the design's "rule skeleton" phase (7a): direction, modifiers, group, commands, line number, LHS/RHS counts, captured off the hot path via the optional lowerer out-param (runtime `Game` untouched). Term contents are explicitly deferred to 7b. The `SemanticRule` struct is defined in full here so 7b only changes serialization, not the contract type.

**Placeholder scan:** Code steps carry complete code. Two steps carry explicit *implementation notes* rather than placeholders — the exact `lineNumber` local name in the lowerer rule loop (Step 4) and the JS pre-expansion capture point + `CellMask` term-count accessor (Task 2 Step 3). These are flagged because they require reading the surrounding code during implementation; the corpus gate (Task 2 Step 5) is the objective arbiter. They are genuine "confirm against the code" points, not vague requirements.

**Type consistency:** `SemanticRule`/`SemanticTerm`/`SemanticCell`/`SemanticRow`/`SemanticRuleCommand` (Task 1 Step 1) are populated by the lowerer capture (Task 1 Step 4), copied by `buildSemanticProgram` (Task 1 Step 5), serialized by `appendRuleArray`/`appendRowCounts` under keys `line_number`/`directions`/`rigid`/`random`/`late`/`group_number`/`lhs_cell_term_counts`/`rhs_cell_term_counts`/`commands` (Task 2 Step 1), matched field-for-field by the JS `ruleList` (Task 2 Step 3). The lowerer out-param is `std::vector<SemanticRule>*` consistently across the signature (Step 2), call sites (Step 6), and `buildSemanticProgram` (Step 5).

**Risk note:** The single biggest risk is the JS side emitting **pre-expansion** rules to match the C++ capture; `state.rules` is post-expansion. This is the crux of the slice and is called out in Task 2 Step 3 + Step 5. If retaining the JS authored form proves invasive, the fallback (consistent with the design doc) is a dedicated authored-rule structurer in the snapshot lib that re-derives rules from the rule strings in `ParserState` — but try the engine-capture route first.
