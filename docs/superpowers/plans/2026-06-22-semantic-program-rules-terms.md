# SemanticProgram Rules — Slice 7b (Term Contents) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rule skeleton's LHS/RHS *counts* (from slice 7a) with the full authored cell/term contents — each cell's `{ellipsis, terms:[{dir, name}]}` — completing the rules representation in the `SemanticProgram` contract.

**Architecture:** Slice 7a already captures the full `{dir, name}` terms on the C++ side (the lowerer's `ParsedCell.items` are copied verbatim into `SemanticRule.lhs`/`rhs`). So the C++ change is purely serialization: emit the captured cells/terms instead of counts. The work is on the **JS side** — emitting `{dir, name}` cells that match the C++ `ParsedRow` tokenization exactly (movement/direction modifiers, ellipsis, and command-vs-object classification). The corpus gate is the arbiter. Prerequisite: slice 7a (`docs/superpowers/plans/2026-06-22-semantic-program-rules-skeleton.md`) is landed — `SemanticRule` with `lhs`/`rhs` term contents already populated, and the JS authored (pre-expansion) rule list already produced.

**Tech Stack:** C++17 (`puzzlescript_compiler`), Node.js (JS oracle), CMake/CTest.

**Prerequisite facts (from 7a):**
- `SemanticRule` already holds `std::vector<SemanticRow> lhs/rhs`, where `SemanticCell { bool ellipsis; std::vector<SemanticTerm> terms; }` and `SemanticTerm { std::string dir; std::string name; }` — fully populated by the lowerer capture.
- 7a serializes LHS/RHS as `lhs_cell_term_counts`/`rhs_cell_term_counts` (per-cell term counts, `-1` for ellipsis). This slice replaces those two fields with `lhs`/`rhs` (full cell/term objects).
- 7a established a JS pre-expansion authored-rule list whose cell/term structure (or its source rule strings) is available to the snapshot emitter.
- Ground truth: sokoban_basic's one rule is `[ > Player | Crate ] -> [ > Player | > Crate ]` — LHS row of 2 cells: cell 0 `{terms:[{dir:">",name:"player"}]}`, cell 1 `{terms:[{name:"crate"}]}`; RHS row of 2 cells: cell 0 `{terms:[{dir:">",name:"player"}]}`, cell 1 `{terms:[{dir:">",name:"crate"}]}`.

---

## File Structure

- **Modify** `native/src/compiler/semantic_program.cpp` — serialize full cell/term contents (replace the count serializer).
- **Modify** `src/tests/js_oracle/lib/puzzlescript_semantic_program.js` — emit full `{dir, name}` cells.
- **Modify** `native/tests/compiler_semantic_program.cpp` — assert sokoban's rule term contents.

---

## Task 1: Serialize full cell/term contents (C++)

**Files:**
- Modify: `native/src/compiler/semantic_program.cpp`
- Modify: `native/tests/compiler_semantic_program.cpp`

- [ ] **Step 1: Strengthen the unit test to assert term contents (red)**

In `native/tests/compiler_semantic_program.cpp`, extend the rule assertions (from 7a) with the actual terms. The `> Player` terms carry a direction modifier; `Crate` in the LHS does not:

```cpp
    // Slice 7b: the authored cell/term contents of sokoban's rule.
    assert(sokRule.lhs[0][0].terms.size() == 1);
    assert(sokRule.lhs[0][0].terms[0].name == "player");
    assert(!sokRule.lhs[0][0].terms[0].dir.empty());   // "> Player" has a direction modifier
    assert(sokRule.lhs[0][1].terms.size() == 1);
    assert(sokRule.lhs[0][1].terms[0].name == "crate");
    assert(sokRule.lhs[0][1].terms[0].dir.empty());    // bare "Crate"
    assert(sokRule.rhs[0][0].terms[0].name == "player" && !sokRule.rhs[0][0].terms[0].dir.empty());
    assert(sokRule.rhs[0][1].terms[0].name == "crate" && !sokRule.rhs[0][1].terms[0].dir.empty());
    assert(!sokRule.lhs[0][0].ellipsis);
```

Also update the JSON-shape assertions: replace the 7a count-field check with the term-field check:

```cpp
    assert(json.find("\"terms\"") != std::string::npos);
    assert(json.find("\"ellipsis\"") != std::string::npos);
```

- [ ] **Step 2: Replace the count serializer with the term serializer**

In `native/src/compiler/semantic_program.cpp`, remove `appendRowCounts` (from 7a) and add `appendRowTerms` in the anonymous namespace:

```cpp
void appendRowTerms(std::string& out, const std::vector<SemanticRow>& rows) {
    out += '[';
    for (size_t r = 0; r < rows.size(); ++r) {
        if (r != 0) {
            out += ',';
        }
        out += '[';
        for (size_t c = 0; c < rows[r].size(); ++c) {
            if (c != 0) {
                out += ',';
            }
            const auto& cell = rows[r][c];
            out += "{\"ellipsis\":";
            out += cell.ellipsis ? "true" : "false";
            out += ",\"terms\":[";
            for (size_t t = 0; t < cell.terms.size(); ++t) {
                if (t != 0) {
                    out += ',';
                }
                out += "{\"dir\":";
                appendJsonString(out, cell.terms[t].dir);
                out += ",\"name\":";
                appendJsonString(out, cell.terms[t].name);
                out += "}";
            }
            out += "]}";
        }
        out += ']';
    }
    out += ']';
}
```

In `appendRuleArray`, replace the two count lines:

```cpp
        out += ",\"lhs_cell_term_counts\":";
        appendRowCounts(out, rule.lhs);
        out += ",\"rhs_cell_term_counts\":";
        appendRowCounts(out, rule.rhs);
```

with:

```cpp
        out += ",\"lhs\":";
        appendRowTerms(out, rule.lhs);
        out += ",\"rhs\":";
        appendRowTerms(out, rule.rhs);
```

- [ ] **Step 3: Build and run the unit test (green)**

Run:
```bash
cmake --build build --target compiler_semantic_program -j
ctest --test-dir build -R '^compiler_semantic_program$' --output-on-failure
```
Expected: `Passed`. (If the `dir` token for `>` is empty or the names differ, print `sokRule.lhs[0][0].terms[0].dir` and reconcile against the lowerer's `ParsedItem.dir` value — do not loosen the assertion.)

- [ ] **Step 4: Commit**

```bash
git add native/src/compiler/semantic_program.cpp native/tests/compiler_semantic_program.cpp
git commit -m "feat(native): serialize authored rule term contents (SemanticProgram rules 7b)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Emit full cell/term contents (JS) + corpus parity

**Files:**
- Modify: `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`

- [ ] **Step 1: Emit `{dir, name}` cells from the authored JS rule list**

In `src/tests/js_oracle/lib/puzzlescript_semantic_program.js`, replace 7a's `rowCounts` in `ruleList` with `rowTerms`, producing the full cell/term objects from the authored (pre-expansion) JS rule cells established in 7a:

```js
    function rowTerms(rows) {
        return rows.map(function (row) {
            return row.map(function (cell) {
                if (cell.isEllipsis) {
                    return { ellipsis: true, terms: [] };
                }
                return {
                    ellipsis: false,
                    terms: cell.terms.map(function (term) {
                        return { dir: term.dir || '', name: term.name };
                    }),
                };
            });
        });
    }
```

and in the returned rule object replace the `lhs_cell_term_counts`/`rhs_cell_term_counts` fields with:

```js
            lhs: rowTerms(rule.lhs),
            rhs: rowTerms(rule.rhs),
```

> Implementation note: the cell/term shape here (`cell.terms` of `{dir, name}`) must come from the JS authored-rule structure. The match that matters is JS term `{dir, name}` ↔ C++ `ParsedItem {dir, name}`. The three places they can diverge — and must be reconciled against `native/src/compiler/lower_to_runtime.cpp` (the `parseSide`/`ParsedItem` builder and `isJsBracketPostfixCommand`/`cellNameRefersToLegendOrObject`) — are: (1) the spelling of direction/movement modifiers in `dir` (e.g. `>` vs `right`, `moving`, `no`, `stationary`, `randomdir`, `action`); (2) ellipsis representation; (3) RHS tokens that are **commands** (`sfx1`, `cancel`, `checkpoint`, `again`, `win`, `restart`, `message`, …) must become `commands`, not cell terms, on both sides. The corpus gate (Step 3) surfaces every mismatch concretely.

- [ ] **Step 2: Build the CLI and spot-check sokoban parity**

Run:
```bash
cmake --build build --target puzzlescript_cpp -j
bash scripts/diff_semantic_program_against_js.sh src/demo/sokoban_basic.txt; echo "sokoban exit=$?"
```
Expected: `exit=0` — JS and C++ agree on sokoban's rule terms.

- [ ] **Step 3: Validate full rule parity over the corpus**

Run:
```bash
node src/tests/semantic_program_parity_corpus_node.js build/native/puzzlescript_cpp src/tests/solver_tests
```
Expected: `conforming + parity-matched: 161` with `parity failures: 0`, now including full rule terms. Triage any failure by inspecting the diverging game's `rules[].lhs`/`rhs` in both outputs (`--snapshot-phase semantic` vs `--emit-semantic-program`); classify as a `dir`/ellipsis/command-classification mismatch in the JS emitter (fix the emitter to match the lowerer), or a genuine JS↔C++ tokenization divergence the contract correctly surfaces (record it). Do not loosen the gate.

- [ ] **Step 4: Run the full semantic suite and commit**

```bash
ctest --test-dir build -R 'semantic_program' --output-on-failure
git add src/tests/js_oracle/lib/puzzlescript_semantic_program.js
git commit -m "feat(js-oracle): emit authored rule term contents; gate full rule parity (rules 7b)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Completes the design's rules representation — the authored `{dir, name}` cells, ellipsis, and command-vs-object classification, gated JS↔C++ by the corpus harness. With 7b landed, the SemanticProgram contract covers objects, collision layers, legends, levels, win conditions, metadata, sounds, and rules.

**Placeholder scan:** Code steps carry complete code. The Task 2 Step 1 implementation note enumerates the exact reconciliation points (modifier spelling, ellipsis, command classification) against named source functions — it is a "confirm against the code / let the gate arbitrate" instruction, the proven workflow from every prior slice, not a vague requirement.

**Type consistency:** `appendRowTerms` emits `{ellipsis, terms:[{dir, name}]}` per cell, matched field-for-field by the JS `rowTerms`. The C++ `SemanticTerm.dir`/`.name` (from 7a) map to JS `{dir, name}`. The 7a count fields (`lhs_cell_term_counts`/`rhs_cell_term_counts`) are removed on both sides and replaced by `lhs`/`rhs` consistently.

**Risk note:** All real risk is the JS-vs-lowerer tokenization match (Task 2). The C++ side is a mechanical serialization of already-captured data. If a conforming game surfaces a genuine, intended JS↔C++ rule-tokenization divergence (not an emitter bug), that is the contract doing its job — record it as a finding rather than masking it, exactly as the legends/levels slices handled their divergences.
