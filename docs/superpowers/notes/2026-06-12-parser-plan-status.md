# Parser-plan closure status (Phase 1 Task 1.3)

**Date:** 2026-06-12  
**Git HEAD (before this note):** `ca9894db` — Task 1.2 duplicate-`no` warning  
**Prior Phase 1 fixes:** `8c656ab5` (keyword names / `namesSet`), `ca9894db` (duplicate-`no` warning)

## Executive summary

Parser port is **effectively complete** for gameplay sources: **469/469** `testdata.js` fixtures match JS `ParserState` byte-for-byte. Diagnostics parity is green (**274/274** `compilation_tests`). The remaining parser-plan work is one errormessage edge case (vertical-tab JSON escaping) and formal plan bookkeeping (progress/results docs, optional CI corpus gate). **Do not invest in more parser syntax** — the open parity gates (`rule_plan_parity_tests`, `js_parity_tests` trace replay) are **lowering/runtime movement semantics** (JS 5c-3 `inferredPropertyBindings`), not parser tokenization.

---

## Harness inventory

| Artifact | Status |
|----------|--------|
| `scripts/diff_parser_state_against_js.sh` | **Present** — single-fixture diff via `export_ir_json.js --snapshot-phase parser` + `puzzlescript_cpp compile --emit-parser-state` |
| `scripts/diff_parser_state_corpus.js` | **Present** — whole-corpus runner (`testdata` + `errormessage`); used by `scripts/run_cpp_test_pipeline.sh` |
| `src/tests/js_oracle/export_ir_json.js --snapshot-phase parser` | **Present** |
| `puzzlescript_cpp compile --emit-parser-state` | **Present** (requires `PS_ENABLE_DEV_SERIALIZERS=ON` at configure time) |
| `scripts/diff_parser_state_against_js.sh --corpus` | **Not implemented** — plan Task 9 mentions `--corpus`; actual corpus path is `node scripts/diff_parser_state_corpus.js` |

Smoke: `bash scripts/diff_parser_state_against_js.sh src/demo/sokoban_basic.txt` → exit 0.

---

## Parser-state corpus diff (Task 43)

Run (2026-06-12):

```bash
cmake -DPS_ENABLE_DEV_SERIALIZERS=ON -S native -B build/native
cmake --build build/native --target puzzlescript_cpp
node scripts/diff_parser_state_corpus.js --cli build/native/puzzlescript_cpp
```

| Corpus | Checked | Passed | Failed | Notes |
|--------|---------|--------|--------|-------|
| `testdata.js` | 469 | **469** | 0 | Full green |
| `errormessage_testdata.js` | 274 | **273** | **1** | See below |
| **Total** | **743** | **742** | **1** | 99.9% |

**Single remaining diff:** errormessage index 273 — *fixes #1163 (Vertical tab can cause compiler to hang)*. JS serializer emits `\u000b` in JSON; C++ emits a literal vertical-tab character in the `rule` / `mixed_case` string fields. This is a **dev-serializer canonicalization** mismatch on an exotic control character, not a gameplay-parser syntax gap. Low priority; fix in `parser_state_serialize.cpp` if pursuing 743/743.

Implementation note: section handlers from the original 47-task plan were consolidated into monolithic `native/src/compiler/parser.cpp` (~2.9k LOC) rather than separate `parser_*.cpp` files per section. Behavior evidence (469/469 testdata) supersedes file-layout checklist items.

---

## Phase 1 compiler gates (post Tasks 1.1–1.2)

| Gate | Command | Result | Detail |
|------|---------|--------|--------|
| Compile diagnostics | `make compilation_tests` | **PASS** | `passed=274 failed=0 total=274` |
| Rule-plan IR | `make rule_plan_parity_tests` | **FAIL** | See next section |
| JS parity suite | `make js_parity_tests` | **FAIL** (early stop) | `trace_replay_passed=375 trace_replay_failed=94` / 469; unchanged from baseline |

---

## `rule_plan_parity_tests` — `ellipsisPropagationBug2`

```
rule_plan_v1 mismatch index=7 name="ellipsisPropagationBug2"
first_diff path=game.rule_plan_v1.rules.[2].[0].replacements.[0].movements_set_bits
jsLength=0 nativeLength=1
js_sha256=b21f4aa2… native_sha256=393152d6…
```

**Classification: lowering/compiler (5c-3), NOT parser.**

- Fixture: testdata index 7 — MoveGuide seeding rules with ellipsis patterns (`UP [Player | ... |] -> …`, `VERTICAL [ Horizontal MoveGuide | ] -> …`).
- Native `lower_to_runtime.cpp` leaves a direct `movementsSet` bit on the replacement; JS routes movement through **5c-3 property inference** (`inferredPropertyBindings` / `layerCoupledMovementMasks`) and the JS rule-plan exporter (`puzzlescript_ir.js` `movementBitPairs`) **omits** `movements_set_bits` when inference owns the movement.
- Fixing this requires porting 5c-3 lowering plumbing — explicitly **out of scope** for Task 1.3 (do not attempt full 5c-3 port here).

Related: the same movement-semantics gap drives most of the 94 `js_parity_tests` trace-replay failures (orthogonal/perpendicular propagation cases #682, #498, #496, etc.).

---

## Parser-plan task index — complete vs open

Reference: `docs/superpowers/plans/2026-04-22-cpp-compiler-phase1-parser.md` (47 tasks).

### Appears complete (validated by gates or file presence)

| Range | Topic | Evidence |
|-------|-------|----------|
| 1–5 | CMake lib, C API skeleton, diagnostics, language constants | `puzzlescript_compiler` target; `native/include/puzzlescript/compiler.h`; `compilation_tests` green |
| 6–9 | JS snapshot, C++ serializer, diff scripts | `--snapshot-phase parser`; `diff_parser_state_against_js.sh`; `diff_parser_state_corpus.js` |
| 11–13 | ParserState defaults, comment/line loop, section routing | 469/469 testdata parser-state parity |
| 14–42 | Preamble, OBJECTS, LEGEND, SOUNDS, COLLISIONLAYERS, RULES, WINCONDITIONS, LEVELS | Consolidated in `parser.cpp`; testdata corpus green |
| 44 | Diagnostics parity | `make compilation_tests` 274/274; `diagnostics-parity` CLI |
| 44b | C API `ps_compiler_parse_source` | `native/src/compiler/c_api.cpp`, used by CLI + diagnostics parity |

### Open / incomplete

| Task | Item | Status |
|------|------|--------|
| 10 | `2026-04-22-cpp-compiler-phase1-progress.md` baseline table | **Missing** — never created |
| 43 | Full corpus 0 diffs | **742/743** — one VT-tab serializer diff on errormessage |
| 45–46 | CI corpus gate + Phase 1 results doc | **Partial** — CTest smokes (`puzzlescript_cpp_parser_state_smoke`, sokoban diff) exist; no automated full-corpus parser-state CTest; no `phase1-results.md` |
| Plan checkboxes | All 47 tasks still `- [ ]` in plan markdown | Documentation debt only |

Tasks 1.1–1.2 (parity sync plan) landed separately: `namesSet`/`abbrevNamesSet` (`8c656ab5`), duplicate-`no` warning (`ca9894db`).

---

## Recommended next compiler work

**Priority: `lower_to_runtime.cpp` / rule-plan movement (Phase 2), not parser syntax.**

1. Port JS **5c-3** property-inference lowering (`inferredPropertyBindings`, `layerCoupledMovementMasks`, coalesced read/write movement slots) — closes `ellipsisPropagationBug2` and most trace-replay gaps.
2. Port **`classifyForceAlwaysRun`** / empty-LHS handling and runtime `applyRuleGroup` pruning (slots [14–18]) — needed for full `js_parity_tests` green.
3. Optionally close the **743/743** parser-state gate with VT-tab JSON escaping in dev serializer (low user impact).

Defer: Phase 1 Task 1.4 (remove Node from default compile path), static analysis, solver heuristics.

---

## Verification commands (reproduce)

```bash
make compilation_tests                                    # expect 274/274 PASS
make rule_plan_parity_tests                               # expect FAIL ellipsisPropagationBug2
make js_parity_tests 2>&1 | tail -30                      # expect FAIL ~375/469 trace replay
cmake -DPS_ENABLE_DEV_SERIALIZERS=ON -S native -B build/native && cmake --build build/native --target puzzlescript_cpp
node scripts/diff_parser_state_corpus.js --cli build/native/puzzlescript_cpp
```
