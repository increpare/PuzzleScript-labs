# Compact-turn layer-coupled movement replacements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native compact-turn kernel correctly apply *layer-coupled movement replacements* (the `[ > player player_move ] -> [ > player > player_move ]` pattern, where movement is coupled onto co-located property-member layers), and close the soundness hole where the kernel silently mis-applies any rule whose replacement uses an unimplemented dynamic mechanism.

**Architecture:** The interpreter's `applyReplacementAt` has a static-mask path and a dynamic path (`Replacement.dynamic`). The compact kernel (`compact_turn_pattern_apply_<suffix>`) only implements the static path, so it drops dynamic contributions. This plan (1) tightens the support analysis to bridge any rule with a dynamic mechanism the kernel does not implement — closing the silent-miscompile hole immediately — then (2) implements the fixed-mask layer-coupled-movement mechanism natively and (3) re-allows just that mechanism to run native, gated by the runtime oracle.

**Tech Stack:** C++17 codegen (`native/src/compiler/compact_turn_codegen.cpp`) emitting C++ that links into the SPECIALIZE solver; the interpreter reference is `native/src/runtime/core.cpp`; the gate is the runtime `--compact-turn-oracle` driven by `make compact_turn_codegen_solver_parity`.

---

## Background (root cause)

`the red ring of immortality` diverges from the interpreter on the very first move (`right`, depth 0): the compact kernel moves the Player bit but leaves the four co-located `player_move_*` tokens behind. The token movement is encoded in the replacement's `layer_coupled_movement_replacements` (LCMR), applied by the interpreter via `applyLayerCoupledMovementReplacements` ([core.cpp:1330](../../../native/src/runtime/core.cpp:1330)) but **never** by `compact_turn_pattern_apply_<suffix>` ([compact_turn_codegen.cpp:2572](../../../native/src/compiler/compact_turn_codegen.cpp:2572)), which only consumes the static masks + random choices.

IR confirms red ring uses **only** the fixed-mask LCMR path (4 instances, `replacement_movement_mask` set, no `replacement_aggregate_name`); no `property_bindings`, `aggregate_bindings`, or `inferred_*`. The fixed-mask LCMR apply (per layer term): if the cell's objects overlap the term's `objectMask` and the term's movement constraints (`movementsAny/Present/Missing`) match, clear that layer's 5-bit movement field and set `replacementMovementMask`.

Relevant C++ types (already defined): `LayerCoupledMovementReplacement` / `LayerCoupledMovementLayerTerm` ([core.hpp:183-196](../../../native/src/runtime/core.hpp:183)); `ReplacementDynamic` ([core.hpp:248](../../../native/src/runtime/core.hpp:248)) holds `layerCoupledMovementReplacements`, `inferredAggregateBindings`, `inferredPropertyBindings`, `inferredPropertySources`, `rhsPropertyPreserveMask`. `Rule` carries `propertyBindings` and `aggregateBindings`.

Compact kernel helpers already emitted per game: `compact_turn_layer_bits_<suffix>(cell, layer)` (read 5-bit field), `compact_turn_set_layer_bits_<suffix>(cell, layer, value)` (write), `compact_turn_layer_mask_<suffix>(layer)` (layer object mask), `compactMaskName(masks, game, offset, wordCount)` (emits/links a static mask array and returns its symbol).

---

## File Structure

- `native/src/compiler/compact_turn_codegen.cpp` — support-analysis predicate (close hole, then allow fixed LCMR); emit LCMR descriptor data per pattern; extend `compact_turn_pattern_apply_<suffix>` signature + body and its call site.
- `native/tests/compiler_compact_turn_support.cpp` — unit asserts: a fixed-mask-LCMR game is native; an aggregate-LCMR / property-binding game bridges.
- Gate (no new files): `make compact_turn_codegen_solver_parity` with a red-ring corpus; full-corpus `make solver_corpus_compact_codegen_compare`.

A one-game corpus dir for the gate (create it):

```bash
mkdir -p /tmp/cancel_repro_corpus
cp "src/tests/solver_tests/the red ring of immortality.txt" /tmp/cancel_repro_corpus/
```

---

### Task 1: Close the soundness hole — bridge all unimplemented dynamic mechanisms

Make the support analysis treat any rule whose replacement needs a dynamic mechanism the kernel does not implement as unsupported (→ interpreter bridge). After this task the kernel never silently mis-applies a dynamic rule.

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (`compactNativeTurnUnsupportedReasonForRule`, ~[:110](../../../native/src/compiler/compact_turn_codegen.cpp:110))
- Test: `native/tests/compiler_compact_turn_support.cpp`

- [ ] **Step 1: Add a helper that reports the dynamic reason for a rule.** Insert above `compactNativeTurnUnsupportedReasonForRule`:

```cpp
// Dynamic replacement mechanisms the compact kernel does not (yet) implement.
// Any rule needing one must bridge to the interpreter to stay parity-correct.
std::string compactRuleDynamicUnsupportedReason(const Rule& rule) {
    if (!rule.propertyBindings.empty()) {
        return "property_bindings";
    }
    if (!rule.aggregateBindings.empty()) {
        return "aggregate_bindings";
    }
    for (const std::vector<Pattern>& row : rule.patterns) {
        for (const Pattern& pattern : row) {
            if (!pattern.replacement.has_value()) {
                continue;
            }
            const ReplacementDynamic* dynamic = pattern.replacement->dynamic.get();
            if (dynamic == nullptr) {
                continue;
            }
            if (!dynamic->inferredAggregateBindings.empty()) {
                return "inferred_aggregate_bindings";
            }
            if (!dynamic->inferredPropertyBindings.empty()) {
                return "inferred_property_bindings";
            }
            if (!dynamic->inferredPropertySources.empty()) {
                return "inferred_property_sources";
            }
            if (dynamic->rhsPropertyPreserveMask != kNullMaskOffset) {
                return "rhs_property_preserve";
            }
            if (!dynamic->layerCoupledMovementReplacements.empty()) {
                return "layer_coupled_movement";
            }
        }
    }
    return {};
}
```

- [ ] **Step 2: Call it from `compactNativeTurnUnsupportedReasonForRule`.** Replace the existing `aggregateBindings` check body so the rule-level check delegates to the new helper:

```cpp
std::string compactNativeTurnUnsupportedReasonForRule(const Rule& rule) {
    const std::string ruleReason = compactRuleUnsupportedReason(rule);
    if (!ruleReason.empty()) {
        return ruleReason;
    }
    return compactRuleDynamicUnsupportedReason(rule);
}
```

- [ ] **Step 3: Unit test — red ring now bridges on `layer_coupled_movement`.** In `compiler_compact_turn_support.cpp` add (mirroring the existing `expectCompilerBridge` cases):

```cpp
const puzzlescript::Game redRingLcmr =
    compileGameFromPath("src/tests/solver_tests/the red ring of immortality.txt");
assert(!compactNativeTurnSupportForGame(redRingLcmr).nativeKernel());
assert(compactNativeTurnSupportForGame(redRingLcmr).statusReason == "layer_coupled_movement");
```

- [ ] **Step 4: Build + run the support unit test.**

Run: `cmake --build build/native --target compiler_compact_turn_support && ./build/native/compiler_compact_turn_support`
Expected: `compiler_compact_turn_support: ok`

- [ ] **Step 5: Full-corpus parity stays clean (no new `solved->exhausted`).**

Run: `make solver_corpus_compact_codegen_compare`
Expected: triage `work_mismatch_count` shows **no** `solved->exhausted`; any mismatches are bridged-timeout-boundary only (same character as the pre-change baseline).

- [ ] **Step 6: Commit.**

```bash
git add native/src/compiler/compact_turn_codegen.cpp native/tests/compiler_compact_turn_support.cpp
git commit -m "fix(compact-turn): bridge rules needing unimplemented dynamic replacement mechanisms"
```

---

### Task 2: Emit fixed-mask LCMR descriptor data per pattern

Emit, for each pattern whose replacement has fixed-mask-only LCMR, a static descriptor (flattened layer terms) the apply function can consume. Aggregate-name LCMR remains bridged (Task 1), so only the fixed-mask path is emitted.

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` — `emitCompactRuleMaskData` (~[:531](../../../native/src/compiler/compact_turn_codegen.cpp:531)) to emit descriptors; the apply call builder (~[:651](../../../native/src/compiler/compact_turn_codegen.cpp:651)).

- [ ] **Step 1: Define an emit helper for LCMR layer terms.** Add near `emitCompactRuleMaskData`. For a pattern `prefix`, emit a flat array of layer-term descriptors and a count, skipping any LCMR entry that has `replacementAggregateName` (those bridge):

```cpp
// Returns the emitted array symbol (or "nullptr") and sets outCount.
std::string emitCompactLcmrTerms(
    std::ostream& out,
    const CompactMaskConstantEmitter& masks,
    const Game& game,
    const Pattern& pattern,
    const std::string& prefix,
    size_t& outCount
) {
    outCount = 0;
    if (!pattern.replacement.has_value() || pattern.replacement->dynamic == nullptr) {
        return "nullptr";
    }
    const ReplacementDynamic& dyn = *pattern.replacement->dynamic;
    std::ostringstream body;
    for (const LayerCoupledMovementReplacement& coupled : dyn.layerCoupledMovementReplacements) {
        if (coupled.replacementAggregateName.has_value() || !coupled.hasReplacementMovementMask) {
            continue; // aggregate path is bridged by support analysis
        }
        for (const LayerCoupledMovementLayerTerm& term : coupled.layers) {
            body << "    {" << term.layerIndex
                 << ", " << compactMaskName(masks, game, term.objectMask, game.wordCount)
                 << ", " << compactMaskName(masks, game, term.movementsAny, game.movementWordCount)
                 << ", " << compactMaskName(masks, game, term.movementsPresent, game.movementWordCount)
                 << ", " << compactMaskName(masks, game, term.movementsMissing, game.movementWordCount)
                 << ", " << coupled.replacementMovementMask << "},\n";
            ++outCount;
        }
    }
    if (outCount == 0) {
        return "nullptr";
    }
    out << "static const CompactLcmrTerm " << prefix << "_lcmr_terms[] = {\n"
        << body.str()
        << "};\n"
        << "static const size_t " << prefix << "_lcmr_term_count = " << outCount << ";\n";
    return prefix + "_lcmr_terms";
}

// Deterministic predicate so the apply call site (a different function) can
// decide whether to reference the emitted symbols or pass nullptr/0, without
// threading state between functions.
bool compactPatternHasFixedLcmr(const Pattern& pattern) {
    if (!pattern.replacement.has_value() || pattern.replacement->dynamic == nullptr) {
        return false;
    }
    for (const LayerCoupledMovementReplacement& coupled :
         pattern.replacement->dynamic->layerCoupledMovementReplacements) {
        if (!coupled.replacementAggregateName.has_value() && coupled.hasReplacementMovementMask) {
            return true;
        }
    }
    return false;
}
```

The symbol names are derived purely from the pattern `prefix` (`compactPatternPrefix(...)`), so both the emit site and the call site compute them identically — no cross-function state is needed.

- [ ] **Step 2: Emit the `CompactLcmrTerm` struct once per game.** In the prelude emission (near the layer-bit helpers, before `compact_turn_pattern_apply_<suffix>`), emit:

```cpp
out << "struct CompactLcmrTerm {\n"
    << "    int32_t layerIndex;\n"
    << "    const MaskWord* objectMask;\n"
    << "    const MaskWord* movementsAny;\n"
    << "    const MaskWord* movementsPresent;\n"
    << "    const MaskWord* movementsMissing;\n"
    << "    int32_t replacementMovementMask;\n"
    << "};\n\n";
```

- [ ] **Step 3: Call `emitCompactLcmrTerms` in `emitCompactRuleMaskData`** alongside the existing replacement-mask emission (the `if (pattern.replacement.has_value())` block), storing the symbol + count for the apply call (reuse the existing per-pattern `prefix`).

- [ ] **Step 4: Pass the descriptor + count into the apply call** in the call builder `emitCompactFixedTileAtDirection` (~[:653](../../../native/src/compiler/compact_turn_codegen.cpp:653)). Compute the symbols from the same `prefix` and append two args after `randomDirLayerCount`:

```cpp
     << ", " << (compactPatternHasFixedLcmr(pattern) ? prefix + "_lcmr_terms" : "nullptr")
     << ", " << (compactPatternHasFixedLcmr(pattern) ? prefix + "_lcmr_term_count" : "0")
```

(The `prefix` here is the same `compactPatternPrefix(...)` value used by `emitCompactRuleMaskData` when it emitted the array via `emitCompactLcmrTerms`, so the symbol names match exactly.)

- [ ] **Step 5: Build the codegen tool to verify it compiles.**

Run: `cmake --build build/native --target puzzlescript_cpp`
Expected: builds clean.

- [ ] **Step 6: Commit.**

```bash
git add native/src/compiler/compact_turn_codegen.cpp
git commit -m "feat(compact-turn): emit fixed-mask layer-coupled-movement descriptors"
```

---

### Task 3: Apply LCMR in `compact_turn_pattern_apply_<suffix>`

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` — `compact_turn_pattern_apply_<suffix>` emission (~[:2572](../../../native/src/compiler/compact_turn_codegen.cpp:2572)).

- [ ] **Step 1: Extend the function signature.** Add two parameters after `randomDirLayerCount`:

```cpp
    << "    const CompactLcmrTerm* lcmrTerms,\n"
    << "    size_t lcmrTermCount\n"
```

- [ ] **Step 2: Capture the cell's pre-replacement objects/movements.** Immediately after the function opens (before any mask scratch is built), snapshot the current cell into locals (LCMR must test the *pre*-replacement state):

```cpp
    << "    const MaskWord* lcmrOldObjects = compact_turn_cell_objects_" << suffix << "(levelState, tileIndex);\n"
    << "    const MaskWord* lcmrOldMovements = compact_turn_cell_movements_" << suffix << "(scratch, tileIndex);\n"
```

- [ ] **Step 3: Apply LCMR contributions to `movementsClear`/`movementsSet`** — insert *after* the static `movementsClear`/`movementsSet` are populated from the input masks (after the loop at ~[:2604](../../../native/src/compiler/compact_turn_codegen.cpp:2604)) and *before* the `movementsLayerMask` OR-in (~[:2627](../../../native/src/compiler/compact_turn_codegen.cpp:2627)):

```cpp
    << "    for (size_t lcmrIndex = 0; lcmrIndex < lcmrTermCount; ++lcmrIndex) {\n"
    << "        const CompactLcmrTerm& term = lcmrTerms[lcmrIndex];\n"
    << "        bool objectOverlap = false;\n"
    << "        for (int32_t word = 0; word < compact_turn_object_stride_" << suffix << "; ++word) {\n"
    << "            if ((lcmrOldObjects[word] & term.objectMask[word]) != 0) { objectOverlap = true; break; }\n"
    << "        }\n"
    << "        if (!objectOverlap) { continue; }\n"
    << "        const int32_t moveField = compact_turn_layer_bits_" << suffix << "(lcmrOldMovements, term.layerIndex);\n"
    << "        const int32_t anyField = compact_turn_layer_bits_" << suffix << "(term.movementsAny, term.layerIndex);\n"
    << "        const int32_t presentField = compact_turn_layer_bits_" << suffix << "(term.movementsPresent, term.layerIndex);\n"
    << "        const int32_t missingField = compact_turn_layer_bits_" << suffix << "(term.movementsMissing, term.layerIndex);\n"
    << "        if (anyField != 0 && (moveField & anyField) == 0) { continue; }\n"
    << "        if (presentField != 0 && (moveField & presentField) != presentField) { continue; }\n"
    << "        if (missingField != 0 && (moveField & missingField) != 0) { continue; }\n"
    << "        compact_turn_set_layer_bits_" << suffix << "(movementsClear, term.layerIndex, 0x1f);\n"
    << "        const int32_t prevSet = compact_turn_layer_bits_" << suffix << "(movementsSet, term.layerIndex);\n"
    << "        compact_turn_set_layer_bits_" << suffix << "(movementsSet, term.layerIndex, prevSet | term.replacementMovementMask);\n"
    << "    }\n"
```

(Note: `compact_turn_layer_bits_<suffix>` reads a 5-bit field; passing `term.movementsAny` etc. reads that mask's field at `layerIndex`, matching `movementFieldAtLayer` in the interpreter. Clearing with `0x1f` mirrors `orMovementLayerClearMask`.)

- [ ] **Step 4: Build the codegen tool.**

Run: `cmake --build build/native --target puzzlescript_cpp`
Expected: builds clean.

- [ ] **Step 5: Commit.**

```bash
git add native/src/compiler/compact_turn_codegen.cpp
git commit -m "feat(compact-turn): apply fixed-mask layer-coupled movement in pattern apply"
```

---

### Task 4: Allow fixed-mask-LCMR-only rules to run native

Remove `layer_coupled_movement` from the bridge reason **only** when every LCMR entry is fixed-mask (no aggregate name); aggregate-name LCMR and all other dynamic mechanisms stay bridged.

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (`compactRuleDynamicUnsupportedReason` from Task 1)
- Test: `native/tests/compiler_compact_turn_support.cpp`

- [ ] **Step 1: Refine the LCMR branch** in `compactRuleDynamicUnsupportedReason` to bridge only aggregate-name LCMR:

```cpp
            for (const LayerCoupledMovementReplacement& coupled : dynamic->layerCoupledMovementReplacements) {
                if (coupled.replacementAggregateName.has_value() || !coupled.hasReplacementMovementMask) {
                    return "layer_coupled_movement_aggregate";
                }
            }
```

(Replace the prior unconditional `layer_coupled_movement` return. Fixed-mask-only LCMR now falls through → supported.)

- [ ] **Step 2: Update the unit test** — red ring is now native; keep an aggregate-LCMR/property-binding game asserted as bridged. Replace the Task 1 red-ring assertion with:

```cpp
const puzzlescript::Game redRingLcmr =
    compileGameFromPath("src/tests/solver_tests/the red ring of immortality.txt");
expectNativeKernel(compactNativeTurnSupportForGame(redRingLcmr), "red ring native (fixed LCMR)");
```

- [ ] **Step 3: Build + run the support unit test.**

Run: `cmake --build build/native --target compiler_compact_turn_support && ./build/native/compiler_compact_turn_support`
Expected: `compiler_compact_turn_support: ok`

- [ ] **Step 4: Commit.**

```bash
git add native/src/compiler/compact_turn_codegen.cpp native/tests/compiler_compact_turn_support.cpp
git commit -m "feat(compact-turn): run fixed-mask layer-coupled-movement rules natively"
```

---

### Task 5: Oracle + corpus verification

**Files:** none (verification only).

- [ ] **Step 1: Red-ring oracle is clean and native (the original failing case).**

Run:
```bash
make compact_turn_codegen_solver_parity \
  SOLVER_COMPACT_PARITY_CORPUS=/tmp/cancel_repro_corpus \
  SOLVER_COMPACT_PARITY_TIMEOUT_MS=2000 SOLVER_COMPACT_PARITY_STRATEGY=bfs
```
Expected: passes with `compact_turn_oracle_failures=0`, `compact_turn_native_hits>0`, no bridge. (Before this plan: `oracle failures=12`, first failure `input=right depth=0 word=15`.)

> If new oracle failures appear at a *later* depth, they are a separate divergence (e.g. `cancel`), not LCMR — localize with the enriched diagnostic (boards + revert flags) and open a new debugging cycle. Do not fold an unrelated fix into this plan.

- [ ] **Step 2: Full-corpus parity — no `solved->exhausted`, native coverage grew.**

Run: `make solver_corpus_compact_codegen_compare`
Expected: triage shows zero `solved->exhausted`; games previously bridged for fixed-mask LCMR now report `compact_turn_native_hits>0`.

- [ ] **Step 3: Existing compact-turn suites still pass.**

Run: `make compact_turn_oracle_smoke && make compact_turn_codegen_solver_parity`
Expected: both pass (`compact_turn_oracle_failures=0`).

---

## Notes on landing

Development happens in the `cancel-native-repro` worktree (branched from local HEAD `d3d42b9a`, which lacks the uncommitted `cancel_command` bridge so cancel runs native and the oracle exercises the LCMR path). The diagnostic instrumentation added to `native/src/solver/main.cpp` during root-cause is **debug-only**; drop it (or keep it behind the existing oracle path) before landing. When porting to the user's working branch, this work is independent of the in-flight `cancel_command` bridge and the new corpus tooling.
