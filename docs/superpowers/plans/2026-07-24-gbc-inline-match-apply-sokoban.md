# GBC Inline Match/Apply Sokoban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sokoban specialized turns emit desktop-style literal match/apply C (dialect remap of `emitCompactInlinePatternMatchTest` + new inline apply) so host specialized solution replay is faster than the GBC interpreter.

**Architecture:** Extract dialect-aware inline match/apply emitters shared with desktop compact-turn. Rewire `emitGbcSpecializedRuleFunction` to emit per-cell literal checks/writes via `ps_gbc_facade_get/set_*`. Delete the packed `ps_gbc_specialized_patterns[]` mini-interpreter. Keep seed + `ps_gbc_resolve_movements`. Gate: host specialized mean ms/turn &lt; interpreter on the 33-move solution.

**Tech Stack:** `compact_turn_codegen` (GbdC dialect), GBC exporter, host oracle, dual host bench compile.

**Spec:** [docs/superpowers/specs/2026-07-24-gbc-inline-match-apply-sokoban-design.md](../specs/2026-07-24-gbc-inline-match-apply-sokoban-design.md)

---

## File map

| File | Role |
|------|------|
| `native/src/compiler/compact_turn_codegen.cpp` | Dialect-aware inline match/apply; rewrite GBC rule emit; remove pattern table helpers |
| `native/src/compiler/compact_turn_codegen.hpp` | Declarations for new emit helpers if needed outside the cpp |
| `native/tests/gbc_exporter.cpp` | Structural asserts: no pattern table / shared helpers; hex literals in rule bodies |
| `scripts/bench_gbc_sokoban_host_speed.py` | Dual-compile host before/after; exit 1 if specialized not faster |
| `docs/performance/gbc-optimization-ledger.md` | Record host speed win |

---

### Task 1: Failing structural tests

**Files:**
- Modify: `native/tests/gbc_exporter.cpp` (specialized-turn `require` block ~lines 70–87)

- [ ] **Step 1: Extend the specialized-turn structural require**

In the existing `require(... specialized turn unrolls ...)` block, add absences and a presence check for literal masks:

```cpp
&& specializedTurn.find("ps_gbc_specialized_patterns") == std::string::npos
&& specializedTurn.find("ps_gbc_specialized_pattern_matches") == std::string::npos
&& specializedTurn.find("ps_gbc_specialized_apply_replacement") == std::string::npos
&& specializedTurn.find("ps_gbc_specialized_rule_matches_at") == std::string::npos
&& specializedTurn.find("& 0x") != std::string::npos
```

Keep existing absences of `ps_gbc_facade_apply_groups` and presence of `ps_gbc_specialized_apply_early` / `ps_gbc_facade_get_objects`. Update the require message to:

```text
specialized turn emits inline literal match/apply without pattern-table helpers
```

- [ ] **Step 2: Run exporter test — expect FAIL**

Run:

```bash
cmake --build build/native --target puzzlescript_gbc_exporter_tests -j 8
ctest --test-dir build/native -R puzzlescript_gbc_exporter_tests --output-on-failure
```

Expected: FAIL on the new structural require (current Sokoban emit still has `ps_gbc_specialized_patterns`).

- [ ] **Step 3: Commit failing test**

```bash
git add native/tests/gbc_exporter.cpp
git commit -m "$(cat <<'EOF'
Require Sokoban specialized turns to use literal inline match/apply.

EOF
)"
```

---

### Task 2: Dialect-aware inline match + apply emitters

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (near `emitCompactInlinePatternMatchTest` ~1165)
- Modify: `native/src/compiler/compact_turn_codegen.hpp` only if helpers need public declarations (prefer file-static + use from `emitGbcSpecialized*` in the same cpp)

- [ ] **Step 1: Add GbdC hex helper if missing**

Reuse existing `emitGbcHexU32` (already in this cpp). If it is not callable from new helpers, keep helpers in the same anonymous namespace / file section.

- [ ] **Step 2: Add `emitCompactInlineGbdCPatternMatch`**

File-local function that takes a `GbcSpecializedPatternEmit` (or the uint32 masks + flags) and emits literal match code. Behavior must match current `ps_gbc_specialized_pattern_matches` / desktop present-missing semantics:

```cpp
void emitCompactInlineGbdCPatternMatch(
    std::ostream& out,
    const GbcSpecializedPatternEmit& pattern,
    std::string_view indent,
    std::string_view cellExpr,
    std::string_view matchedFlagName
) {
    // if NEVER_MATCH flag: matchedFlagName = false; return;
    // if objects present/missing flags or masks non-zero:
    //   uint32_t <prefix>_objects = ps_gbc_facade_get_objects(session, cellExpr);
    //   if present: if ((objects & 0x..) != 0x..) matched = false;
    //   if missing: if ((objects & 0x..) != 0) matched = false;
    // same for movements via ps_gbc_facade_get_movements
}
```

Use distinct local names per call site via a `tileVariableName` parameter (same pattern as desktop `tileVariableName + "_objects"`).

- [ ] **Step 3: Add `emitCompactInlineGbdCPatternApply`**

Emit literal apply matching current `ps_gbc_specialized_apply_replacement` semantics (including movement layer clear when `PS_GBC_REPLACEMENT_CLEAR_MOVEMENT_LAYERS` is set in flags, dirty on object change, return-style via `changedFlagName`):

```cpp
void emitCompactInlineGbdCPatternApply(
    std::ostream& out,
    const GbcSpecializedPatternEmit& pattern,
    std::string_view indent,
    std::string_view cellExpr,
    std::string_view changedFlagName
) {
    // if !(flags & HAS_REPLACEMENT): leave unchanged / no-op
    // load objects/movements via façade
    // next_objects = (objects & ~clear) | set  with literal 0x..U
    // optional movement_layer_mask clear
    // next_movements = (movements & ~clear) | set
    // ps_gbc_facade_set_objects / set_movements
    // if objects changed: ps_gbc_facade_mark_dirty
    // changedFlagName = changedFlagName || (objects or movements changed)
}
```

Player-cell anchor maintenance (`PS_GBC_HAS_PLAYER_CELL_ANCHORS` block in today’s apply helper) must be preserved when those macros are active — copy the same `#if` guarded logic into the emitted apply body (or call a tiny shared façade helper only if already exists; prefer emit the same block for parity).

- [ ] **Step 4: Wire desktop `emitCompactInlinePatternMatchTest` dialect path**

Add a `CompactCodegenTarget target` parameter (default `NativeCpp` at every existing call site, or overload). When `target == GbdC` and `game.wordCount == 1` / `movementWordCount == 1`, emit the façade/`uint32_t` form instead of `MaskWord*` / `compact_turn_cell_*`. When NativeCpp, keep today’s emission byte-for-byte.

If threading `target` through all desktop call sites is too large for this slice, it is acceptable to:
1. Implement Steps 2–3 as the GbdC emitters used by specialized turn, and
2. Have `emitCompactInlinePatternMatchTest` call the shared mask-check core for NativeCpp only,

…but the GbdC emitters **must** share the same present/missing check shape as desktop (literal `&` / `!=`), not a table walker. Document in a one-line comment above the GbdC helpers: `// Dialect sibling of emitCompactInlinePatternMatchTest for GbdC façade loads.`

- [ ] **Step 5: Build compiler library**

```bash
cmake --build build/native --target puzzlescript_compiler -j 8
```

Expected: success (no behavior change yet until Task 3).

- [ ] **Step 6: Commit emitters**

```bash
git add native/src/compiler/compact_turn_codegen.cpp native/src/compiler/compact_turn_codegen.hpp
git commit -m "$(cat <<'EOF'
Add GbdC inline pattern match/apply emitters for specialized turns.

EOF
)"
```

---

### Task 3: Rewire GBC rule emit; delete pattern table

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (`emitGbcSpecializedRuleFunction`, `emitGbcSpecializedPatternTable`, `emitGbcSpecializedTurn`)

- [ ] **Step 1: Replace table-driven match-at with per-rule inline match**

In `emitGbcSpecializedRuleFunction`, stop emitting `first_pattern` table indexing. For a candidate `cell` / `start`, emit an inlined match of all `patternCount` cells:

```cpp
// Pseudocode of emitted C for match of rule with 2 patterns, delta known:
bool row_matched = true;
uint8_t match_cell = start;
// pattern 0:
emitCompactInlineGbdCPatternMatch(..., patterns[first+0], ..., "match_cell", "row_matched");
match_cell = (uint8_t)((int16_t)match_cell + delta);
// pattern 1:
if (row_matched) {
  emitCompactInlineGbdCPatternMatch(..., patterns[first+1], ..., "match_cell", "row_matched");
}
```

Use this both in the scan loop (collect matches) and in the apply loop (re-validate before apply). Delete calls to `ps_gbc_specialized_rule_matches_at`.

Concrete approach: emit a file-local helper function per rule:

```c
static bool ps_gbc_specialized_rule_N_matches_at(
    ps_gbc_session* session, uint8_t start, int8_t delta)
```

whose body is fully unrolled inline match (no pattern array). Then the existing scan loops can call `ps_gbc_specialized_rule_N_matches_at(session, cell, delta)` — this satisfies the structural assert that `ps_gbc_specialized_rule_matches_at` (generic) is absent, while keeping scan structure readable.

- [ ] **Step 2: Replace apply_replacement loop with inline apply**

In the apply loop, for each pattern index emit:

```cpp
emitCompactInlineGbdCPatternApply(
    out, patterns[rule.firstPattern + patternIndex], "            ", "cell", "changed");
out << "            cell = (uint8_t)((int16_t)cell + delta);\n";
```

No calls to `ps_gbc_specialized_apply_replacement`.

- [ ] **Step 3: Stop emitting the pattern table and shared helpers**

In `emitGbcSpecializedTurn`, remove the call to `emitGbcSpecializedPatternTable`. Delete (or leave unused and remove) `emitGbcSpecializedPatternTable`, `emitGbcSpecializedPatternMatch` helpers that emit `ps_gbc_specialized_pattern_matches` / `apply_replacement` / `rule_matches_at`.

- [ ] **Step 4: Run exporter test — expect PASS**

```bash
cmake --build build/native --target puzzlescript_gbc_exporter_tests -j 8
ctest --test-dir build/native -R puzzlescript_gbc_exporter_tests --output-on-failure
```

Expected: PASS.

- [ ] **Step 5: Commit rule rewire**

```bash
git add native/src/compiler/compact_turn_codegen.cpp
git commit -m "$(cat <<'EOF'
Emit Sokoban specialized rules with literal inline match/apply.

EOF
)"
```

---

### Task 4: Oracle + GBC regression suite

**Files:**
- No fixture changes expected (crate-push replay already present)
- Verify: `native/tests/fixtures/gbc_sokoban_basic_replay.txt`, `gbc_sokoban_basic_solution.txt`

- [ ] **Step 1: Run specialized oracle smoke**

```bash
cmake --build build/native --target puzzlescript_gbc_specialized_oracle_smoke -j 8
ctest --test-dir build/native -R puzzlescript_gbc_specialized_oracle_smoke --output-on-failure
```

Expected: PASS.

- [ ] **Step 2: Full solution oracle check**

```bash
cp native/tests/fixtures/gbc_sokoban_basic_replay.txt /tmp/gbc_replay_short.bak
cp native/tests/fixtures/gbc_sokoban_basic_solution.txt native/tests/fixtures/gbc_sokoban_basic_replay.txt
cmake --build build/native --target puzzlescript_gbc_specialized_oracle_smoke -j 8
./build/native/puzzlescript_gbc_specialized_oracle_smoke
cp /tmp/gbc_replay_short.bak native/tests/fixtures/gbc_sokoban_basic_replay.txt
```

Expected: `gbc_specialized_oracle_smoke: ok` and exit 0. Restore short fixture before committing.

- [ ] **Step 3: Run all GBC CTests**

```bash
ctest --test-dir build/native -R 'puzzlescript_gbc_' --output-on-failure
```

Expected: all PASS.

- [ ] **Step 4: Spot-check NativeCpp compact-turn smoke (dialect safety)**

```bash
ctest --test-dir build/native -R 'compact_turn_oracle_smoke|compact_turn_codegen' --output-on-failure
```

Expected: PASS (or skip with note if those targets are not in the default native build — then run whatever compact-turn tests exist in `ctest -N`).

---

### Task 5: Host speed gate + ledger

**Files:**
- Create: `scripts/bench_gbc_sokoban_host_speed.py`
- Modify: `docs/performance/gbc-optimization-ledger.md`

- [ ] **Step 1: Add host speed script**

Create `scripts/bench_gbc_sokoban_host_speed.py` that:
1. Ensures `build/native/generated/gbc_sokoban/generated_specialized_turn.c` exists (build `puzzlescript_gbc_solution_replay_bench` if needed).
2. Reuses `compile_host_benches` / `run_host_bench` from `scripts/bench_gbc_eligible_solutions.py` (import or subprocess).
3. Runs interpreter + specialized on `native/tests/fixtures/gbc_sokoban_basic_solution.txt` with `--iterations 20`.
4. Prints JSON with `before_ms`, `after_ms`, `speedup_pct`.
5. Exits `0` only if both won and `after_ms < before_ms`; else exit `1`.

Minimal main:

```python
#!/usr/bin/env python3
from pathlib import Path
import json, subprocess, sys

# import compile_host_benches, run_host_bench from bench_gbc_eligible_solutions
# or duplicate the small dual-compile block from that module

def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    # build export if missing...
    baseline, specialized = compile_host_benches(...)
    fixture = repo / "native/tests/fixtures/gbc_sokoban_basic_solution.txt"
    before = run_with_iterations(baseline, fixture, 20)
    after = run_with_iterations(specialized, fixture, 20)
    report = {
        "before_ms": before["mean_ms_per_turn"],
        "after_ms": after["mean_ms_per_turn"],
        "speedup_pct": 100.0 * (before["mean_ms_per_turn"] - after["mean_ms_per_turn"])
            / before["mean_ms_per_turn"],
        "baseline_won": before["won"],
        "specialized_won": after["won"],
    }
    print(json.dumps(report, indent=2))
    if not before["won"] or not after["won"]:
        return 1
    return 0 if after["mean_ms_per_turn"] < before["mean_ms_per_turn"] else 1

if __name__ == "__main__":
    sys.exit(main())
```

Wire `run_with_iterations` to pass `--iterations 20` (extend `run_host_bench` in `bench_gbc_eligible_solutions.py` with an optional `iterations` arg defaulting to 3, rather than forking logic).

- [ ] **Step 2: Run speed gate**

```bash
python3 scripts/bench_gbc_sokoban_host_speed.py
```

Expected: exit 0 and `speedup_pct` &gt; 0. If exit 1, **stop** per spec risk mitigation — do not expand to façade storage inline in this plan; report numbers and escalate.

- [ ] **Step 3: Ledger entry**

Append to `docs/performance/gbc-optimization-ledger.md`:

```markdown
### GBC inline match/apply Sokoban (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

Replaced packed pattern-table specialized match/apply with dialect-style
literal inline checks/writes (`emitCompactInlineGbdCPatternMatch` /
`Apply`) through façade get/set.

| Check | Result |
| --- | --- |
| Structural | no pattern table / shared match-apply helpers |
| Oracle | PASS (crate-push + full solution) |
| Host mean ms/turn (solution, 20 iters) | interpreter **X** → specialized **Y** (**+Z%** speedup) |

Script: `python3 scripts/bench_gbc_sokoban_host_speed.py`.
```

Fill X/Y/Z from Step 2 output.

- [ ] **Step 4: Commit speed tooling + ledger**

```bash
git add scripts/bench_gbc_sokoban_host_speed.py scripts/bench_gbc_eligible_solutions.py docs/performance/gbc-optimization-ledger.md
git commit -m "$(cat <<'EOF'
Gate Sokoban specialized turns on a host speedup vs the interpreter.

EOF
)"
```

---

### Task 6: Final verification commit (if dirty)

- [ ] **Step 1: Re-run gates**

```bash
ctest --test-dir build/native -R 'puzzlescript_gbc_' --output-on-failure
python3 scripts/bench_gbc_sokoban_host_speed.py
```

Expected: all PASS / exit 0.

- [ ] **Step 2: Commit any remaining stray fixes**

Only if `git status` is dirty; otherwise skip.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Dialect remap / literal match via façade | Task 2–3 |
| Inline apply (not `apply_replacement`) | Task 2–3 |
| No pattern table / shared helpers | Task 1, 3 |
| Seed + resolve_movements unchanged | Task 3 (do not touch) |
| Oracle crate-push + full solution | Task 4 |
| NativeCpp stays green | Task 2 dialect gate + Task 4 Step 4 |
| Host specialized &lt; interpreter | Task 5 |
| Ledger before/after | Task 5 |
| No façade storage inline / no movement specialize | Out of scope (not tasked) |
