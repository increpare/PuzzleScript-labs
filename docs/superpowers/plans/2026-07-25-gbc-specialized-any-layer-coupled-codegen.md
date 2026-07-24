# GBC Specialized Any / Layer-Coupled Codegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock GBC export for games that need any-object / any-movement / layer-coupled movement by emitting those checks in specialized GbdC rule match/apply (desktop compact-turn semantics), and fail export/ROM build hard if specialized cannot ship — no interpreter fallback.

**Architecture:** Extend `GbcSpecializedPatternEmit` + packing from lowered `Pattern` (not only today’s literal `PackedPattern` fields). Teach `emitCompactInlineGbdCPatternMatch` / `Apply` to emit `>=1 bit` any-mask tests and layer-coupled term checks/replacements as uint32 literals. Remove exporter rejects for those shapes. Retire firmware size→interpreter fallback.

**Tech Stack:** C++ exporters/codegen, GBDK specialized `.c`, host oracle smoke, `good_games` cull audit script.

**Spec:** [`docs/superpowers/specs/2026-07-25-gbc-specialized-any-layer-coupled-codegen-design.md`](../specs/2026-07-25-gbc-specialized-any-layer-coupled-codegen-design.md)

---

## File map

| File | Role |
|---|---|
| `native/tests/fixtures/gbc_any_object_mask.txt` | Minimal single-row game using a property / `moving`-style any-object match |
| `native/tests/gbc_exporter.cpp` | Structural: export succeeds; specialized C contains any-mask tests |
| `native/src/gbc/exporter.cpp` | Drop validateRule reject; pack any/coupled into specialized pattern emit; require specialized artifacts |
| `native/src/compiler/compact_turn_codegen.hpp` | Extend `GbcSpecializedPatternEmit` |
| `native/src/compiler/compact_turn_codegen.cpp` | GbdC match/apply emit for any + layer-coupled |
| `firmware/gbc/Makefile` | Size check failure → fail (delete fallback block) |
| `scripts/audit_gbc_good_games_export.py` | Optional thin wrapper around cull export classification (or reuse ad-hoc audit) |
| `docs/performance/gbc-optimization-ledger.md` | Audit delta row |

## Critical packing note

Today `packPattern` / `samePattern` / `internPatternSequence` only see literal present/missing fields. Two cells that share literals but differ in `anyObjects*` would incorrectly intern as one pattern. **Any/coupled must participate in pack identity** (extend `PackedPattern` + `samePattern`, or build specialized pattern tables from `Game` rules without interning collapses). Prefer extending pack identity so interpreter tables and specialized tables stay aligned.

Desktop model for match loops: `matchesPatternAt` in `native/src/runtime/core.cpp` (~3527+). Desktop table emit for any masks: `compact_turn_codegen.cpp` ~908–970. GBC emit today: `emitCompactInlineGbdCPatternMatch` (~7186) — literals only.

---

### Task 1: Fixture + failing exporter test

**Files:**
- Create: `native/tests/fixtures/gbc_any_object_mask.txt`
- Modify: `native/tests/gbc_exporter.cpp`

- [ ] **Step 1: Add minimal fixture**

A tiny PuzzleScript game (≤32 objects, 5×5 sprites, board ≤10×9, single-row rules) that lowers to `anyObjectsCount > 0` on at least one pattern. Prefer a named property used in a rule LHS (e.g. `Thing = A or B` then `[ > Player | Thing ] -> [ > Player | > Thing ]`) rather than copying a full `good_games` title.

Verify lowering in a throwaway `export-gbc` or unit assert: after compile, some `Pattern` has `anyObjectsCount > 0`.

- [ ] **Step 2: Exporter test expecting success + specialized any emit**

```cpp
puzzlescript::gbc::ExportOptions anyMask;
anyMask.sourcePath = root / "native" / "tests" / "fixtures" / "gbc_any_object_mask.txt";
anyMask.outputDirectory = output / "any_object_mask";
const auto anyResult = puzzlescript::gbc::exportGame(anyMask);
require(std::filesystem::exists(anyResult.generatedSpecializedTurnPath),
    "any-object fixture must emit specialized turn");
const std::string specialized = readFile(anyResult.generatedSpecializedTurnPath);
// After Task 3 this becomes a real assertion; for TDD now expect export to throw
// OR specialized missing — capture current failure mode:
```

First make the test assert **current** behavior fails with the known reject string (documents baseline), then flip in Task 2–3.

```cpp
bool rejected = false;
try {
    (void)puzzlescript::gbc::exportGame(anyMask);
} catch (const std::runtime_error& error) {
    rejected = std::string(error.what()).find("any/layer-coupled") != std::string::npos;
}
require(rejected, "baseline: any-object fixture is rejected by GBC v1 validateRule");
```

- [ ] **Step 3: Run test**

```bash
cmake --build build/native --target puzzlescript_gbc_exporter_tests -j8
./build/native/puzzlescript_gbc_exporter_tests
```

Expected: PASS (baseline reject asserted).

- [ ] **Step 4: Commit**

```bash
git add native/tests/fixtures/gbc_any_object_mask.txt native/tests/gbc_exporter.cpp
git commit -m "$(cat <<'EOF'
Add GBC any-object fixture capturing v1 exporter reject.

EOF
)"
```

---

### Task 2: Pack any / layer-coupled into specialized pattern emit + allow export

**Files:**
- Modify: `native/src/gbc/exporter.cpp` (`validateRule`, `PackedPattern` / `packPattern` / `samePattern`, specialized pattern fill)
- Modify: `native/src/compiler/compact_turn_codegen.hpp` (`GbcSpecializedPatternEmit`)

- [ ] **Step 1: Extend emit struct**

In `compact_turn_codegen.hpp`:

```cpp
struct GbcSpecializedLayerCoupledLayerEmit {
    uint32_t objectMask = 0;
    uint32_t movementsAny = 0;
    uint32_t movementsPresent = 0;
    uint32_t movementsMissing = 0;
    int8_t layerIndex = 0;
};

struct GbcSpecializedLayerCoupledTermEmit {
    std::vector<GbcSpecializedLayerCoupledLayerEmit> layers;
    // Apply-side fields when packing from replacement.dynamic:
    uint32_t replacementMovementMask = 0;
    bool hasReplacementMovementMask = false;
};

struct GbcSpecializedPatternEmit {
    // existing uint32 fields...
    std::vector<uint32_t> anyObjectMasks;
    std::vector<uint32_t> anyMovementMasks;
    std::vector<GbcSpecializedLayerCoupledTermEmit> layerCoupledMatchTerms;
    std::vector<GbcSpecializedLayerCoupledTermEmit> layerCoupledReplacementTerms;
};
```

- [ ] **Step 2: Pack from `Pattern` with movement layout**

In `exporter.cpp`, when packing each pattern (inside `packGroups` loop over `sourceRule.patterns.front()`):

1. Keep existing literal `packPattern` fields.
2. For each `anyObjectsFirst + i`, append `maskWord(game, game.anyObjectOffsets[...])` (object arena offsets → uint32).
3. Same for `anyMovementOffsets` via `repackMovementMask`.
4. For each `pattern.layerCoupledMovementMasks` term, pack each `LayerCoupledMovementLayerTerm` masks through object/`repackMovementMask`.
5. If `pattern.replacement` has `dynamic->layerCoupledMovementReplacements`, pack into `layerCoupledReplacementTerms`.

Update `samePattern` / intern so two patterns differing only in any/coupled **do not** share an index.

- [ ] **Step 3: Remove validateRule rejects for A**

Delete / gate out:

```cpp
if (pattern.anyObjectsCount != 0U || pattern.anyMovementsCount != 0U
    || !pattern.layerCoupledMovementMasks.empty()) {
    throw ...
}
```

Keep rejects for property/aggregate bindings, multi-row, ellipsis, rigid, random (Milestone B / later).

If replacement has layer-coupled dynamic **only** (no property bindings), allow it.

- [ ] **Step 4: Require specialized turn when any/coupled present**

After packing, if any specialized pattern has non-empty any/coupled vectors, `writeSpecializedTurnArtifacts` must succeed (`info.supported && !generatedPath.empty()`). Otherwise `throw std::runtime_error("GBC export requires specialized turn for any/layer-coupled patterns")`.

- [ ] **Step 5: Flip exporter test**

Replace baseline reject assert with: export OK, specialized file exists, manifest `specialized_turn: true`. (Match emit string assert lands in Task 3.)

- [ ] **Step 6: Build + test + commit**

```bash
cmake --build build/native --target puzzlescript_gbc_exporter_tests -j8
./build/native/puzzlescript_gbc_exporter_tests
```

```bash
git commit -m "$(cat <<'EOF'
Pack GBC any/layer-coupled masks into specialized pattern emit.

Allow export past validateRule for those shapes when specialized turn is required.
EOF
)"
```

---

### Task 3: Emit GbdC match (any + layer-coupled)

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (`emitCompactInlineGbdCPatternMatch`)

- [ ] **Step 1: After present/missing object checks, emit any-object tests**

For each mask `M` in `pattern.anyObjectMasks` (when objects already loaded into `objectVar`, or load if only anys):

```c
if ((objectVar & 0x..M..) == 0U) matchedFlagName = false;
```

- [ ] **Step 2: Any-movement tests** similarly on `movementVar`.

- [ ] **Step 3: Layer-coupled match terms**

For each term, for each layer sub-term, mirror desktop `layerCoupledMovementMaskTermMatches`:

- Object mask on cell must hit (or match desktop’s layer object requirement).
- Movement any/present/missing against repacked movement word.

Keep codegen boring and branchy; correctness over cleverness. Prefer copying control flow from `native/src/runtime/core.cpp` `layerCoupledMovementLayerMatches` / `layerCoupledMovementMaskTermMatches`.

- [ ] **Step 4: Exporter structural assert**

```cpp
require(specialized.find(") == 0U) ") != std::string::npos
        || specialized.find("any") /* prefer a distinctive comment or stable literal from fixture */,
    "specialized turn emits any-object mask tests");
```

Better: compute the expected hex mask from the fixture’s lowered property and `require(specialized.find("0x..") != npos)`.

- [ ] **Step 5: Oracle**

Extend `puzzlescript_gbc_specialized_oracle_smoke` **or** add `puzzlescript_gbc_any_mask_oracle_smoke` that exports the fixture, links specialized turn on host, and replays a short input vs desktop `step` / compact-turn. Minimal: one push/move that exercises the any match.

```bash
cmake --build build/native --target puzzlescript_gbc_specialized_oracle_smoke puzzlescript_gbc_exporter_tests -j8
./build/native/puzzlescript_gbc_exporter_tests
./build/native/puzzlescript_gbc_specialized_oracle_smoke
```

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
Emit GbdC any-object/any-movement and layer-coupled match in specialized rules.

EOF
)"
```

---

### Task 4: Emit GbdC apply for layer-coupled replacements

**Files:**
- Modify: `emitCompactInlineGbdCPatternApply` in `compact_turn_codegen.cpp`

- [ ] **Step 1: After standard clear/set**, if `layerCoupledReplacementTerms` non-empty, apply desktop-equivalent bit updates for coupled movement replacements (see `applyReplacementAt` coupled branch in `core.cpp`).

- [ ] **Step 2: Fixture or second fixture** that writes a coupled replacement (if the any-object fixture already does, assert apply path in specialized C / oracle). If hard to find a tiny coupled-replacement case, add `gbc_layer_coupled_apply.txt` trimmed from a known `good_games` pattern.

- [ ] **Step 3: Tests + commit**

```bash
git commit -m "$(cat <<'EOF'
Apply layer-coupled movement replacements in specialized GbdC rules.

EOF
)"
```

---

### Task 5: Retire size→interpreter fallback (hard fail)

**Files:**
- Modify: `firmware/gbc/Makefile` `build-rom` recipe
- Modify: tests/docs that mention fallback (`docs/performance/gbc-optimization-ledger.md` note; any script asserting fallback)

- [ ] **Step 1: Replace fallback with fail**

```makefile
build-rom: $(TARGET).gb
	"$(PYTHON)" ../../scripts/check_gbc_rom.py \
		$(TARGET).gb $(GENERATED)/gbc_manifest.json $(TARGET).map
```

Remove the block that deletes `generated_specialized_turn*.c` and relinks interpreter.

- [ ] **Step 2: Smoke eligible Sokoban / one eligible slug still builds**

```bash
make -B -C firmware/gbc \
  GBDK_HOME=$$PWD/.codex_tmp/toolchains/gbdk \
  PUZZLESCRIPT_CPP=$$PWD/build/native/puzzlescript_cpp \
  GAME=$$PWD/src/demo/sokoban_basic.txt
```

Expected: size check OK, specialized retained.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
Fail GBC ROM builds when specialized turn exceeds bank limits.

Removes interpreter fallback so shipping carts require successful specialized emit.
EOF
)"
```

---

### Task 6: good_games cull audit + ledger

**Files:**
- Optionally create: `scripts/audit_gbc_good_games_export.py` (classify export errors like the ad-hoc audit)
- Modify: `docs/performance/gbc-optimization-ledger.md`
- Update: `scripts/build_gbc_eligible_roms.py` `ELIGIBLE_GAMES` only if you intentionally expand the production list — **not required for A**; audit numbers matter more than expanding the hardcoded 14 in the same PR.

- [ ] **Step 1: Run cull audit**

```bash
# reuse or check in scripts/audit_gbc_good_games_export.py
python3 scripts/audit_gbc_good_games_export.py --cull --compiler build/native/puzzlescript_cpp
```

Expected: previous **50** `any/layer-coupled` first-failures drop sharply; OK count rises (some may hard-fail on size/object_count/multi-row instead).

- [ ] **Step 2: Ledger row** with before/after counts and top remaining rejects.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
Record good_games GBC export unlock after any/layer-coupled specialized emit.

EOF
)"
```

---

## Verification cheat sheet

```bash
cmake --build build/native --target puzzlescript_cpp puzzlescript_gbc_exporter_tests puzzlescript_gbc_specialized_oracle_smoke -j8
./build/native/puzzlescript_gbc_exporter_tests
./build/native/puzzlescript_gbc_specialized_oracle_smoke
python3 scripts/audit_gbc_good_games_export.py --cull --compiler build/native/puzzlescript_cpp
```

## Spec coverage

| Spec item | Task |
|---|---|
| Codegen match any/coupled | Task 3 |
| Codegen apply coupled | Task 4 |
| Remove exporter reject / require specialized | Task 2 |
| Hard fail on size (no interpreter fallback) | Task 5 |
| Fixture + oracle | Tasks 1, 3 |
| good_games audit | Task 6 |
| Milestone B out of scope | — |

## Risks

- Interning bugs if `samePattern` ignores any/coupled — Task 2 packing note is mandatory.
- Layer-coupled apply edge cases — oracle + one real `good_games` sample after audit.
- Newly unlocked games may still fail bank limits — correct under hard-fail policy; multi-bank packs already exist.
