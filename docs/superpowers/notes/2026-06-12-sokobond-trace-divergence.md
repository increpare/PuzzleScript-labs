# Sokobond trace replay divergence (`unnecessary number of rules sokobond`)

**Date:** 2026-06-12  
**Fixture:** `sim-15c72e42305db218` (manifest index 32, trace suite detailed failure #33)  
**Sources:** `build/js-parity-data/ir/sim-15c72e42305db218.json`, `build/js-parity-data/traces/sim-15c72e42305db218.json`, `/tmp/sokobond.txt` (from `testdata.js`)

## Summary

First JS↔native divergence is **snapshot[1]** — immediately after **input 0 (UP)** on **level 34**. Prepared-session snapshot[0] matches; RNG, command queue, and title/message state match at the failure point. The bug is **movement propagation + resolve**, not rule-plan serialization (453/453 rule_plan parity passes on this source).

**Root cause (primary):** Native runtime does not implement JS **`layerCoupledMovementReplacements`** (Phase 5c-3). Rule group **line 316** (`[ > Atom AtomStuff] -> [> Atom > AtomStuff]`) matches in native but **`changed=0`**; JS applies coupled movement writes that shift UP movement from atom layers onto **Orbital** (`1electron`, etc.) before `resolveMovements`. Native resolves player+hydrogen UP without electron layer movement, producing a different post-resolve board.

**Status:** `DONE` — actionable fix path identified; not a one-line patch.

---

## Reproduction commands

```bash
# Fixture metadata
node -e "const m=require('./build/js-parity-data/fixtures.json'); console.log(m.simulation_fixtures[32])"

# First divergent snapshot (exit 1, prints diff)
build/native/puzzlescript_cpp diff-trace \
  build/js-parity-data/ir/sim-15c72e42305db218.json \
  build/js-parity-data/traces/sim-15c72e42305db218.json

# Step to failing input with rule/move logs
PS_DEBUG_RULES=1 PS_DEBUG_MOVES=1 \
  build/native/puzzlescript_cpp trace-step-at \
  build/js-parity-data/ir/sim-15c72e42305db218.json \
  build/js-parity-data/traces/sim-15c72e42305db218.json 0
```

---

## First divergent point

| Field | Value |
|--------|--------|
| Snapshot index | **1** (after input 0) |
| Input | **0** = UP (`direction` mask 1) |
| Level | 34 (`target_level` 34, seed `1781278318639.7185`) |
| Mismatch field | `serialized_level` row 4 (player + hydrogen + electron strip) |

**Expected (JS trace):**
```
3,1,3electron background nitrogen:4,0,0,1,1electron background hydrogen player:5,1,1,
```

**Native actual:**
```
3,1,3electron background nitrogen:4,0,0,1,background hydrogen player:5,1electron background:6,1,
```

**Unchanged at divergence:** `current_level_index`, RNG preview bytes, `command_queue` (empty), `movement_word_count_nonzero` (0 after step — movements consumed during resolve).

---

## Turn timeline (input 0)

### JS oracle

1. `startMovement(UP)` — seeds player movement; serialized board unchanged.
2. Rule groups run in order (302→306 orbital, 308 push, 310–314 bond chain, 316 AtomStuff, 318 cancel).
3. **Line 316** changes **movement bits only** at tile 43 `(5,3)`:
   - Before 316: `movements = [32800, 0]` (player + hydrogen UP)
   - After 316: `movements = [1081376, 0]` (UP also on Orbital / AtomStuff layers)
4. `resolveMovements` — row 4 electron shuffle; player column stays 5.

Orbital groups (302, 303, 305) report `tryApply` success in JS but **do not change** `serialized_level` before resolve on this input (no-op replacements on already-assigned orbitals).

### Native (same IR)

1. `seedPlayerMovements(UP)` — OK (`direction=1 seeded=1`).
2. **Line 308** (`[> Player Atom]`) — **only rule group with `changed=1`**; adds UP on player layer 1 and hydrogen layer 3 at `(5,3)`.
3. **Lines 310–314** — `matches=0` (bond propagation; not on critical path for this input).
4. **Line 316** — `matched=1 changed=0` (pattern hit, replacement no-op).
5. **`resolveMovements`** — moves player (layer 1) and hydrogen (layer 3) toward `(5,2)`; electron layout wrong.

Native debug (abbreviated):
```
[rules] line=308 apply tile=43@(5,3) movements_after=[layer=1:up,layer=3:up]
[rules] line=316 matched=1 changed=0
[moves] resolve tile=(5,3) target=(5,2) layer=1 objects=[player]
[moves] resolve tile=(5,3) target=(5,2) layer=3 objects=[hydrogen]
```

---

## Root cause analysis

### Primary: missing `layerCoupledMovementReplacements` (line 316)

Live JS compiled rule 316 carries:

```javascript
layerCoupledMovementReplacements: [{
  layers: [...],
  objectMask: BitVec(...),  // AtomStuff = Bond | Orbital
  replacementMovementMask: 1  // UP
}]
```

IR export (`src/tests/js_oracle/lib/puzzlescript_ir.js` `serializePattern` / `serializeReplacement`) serializes `movements_layer_mask` but **not** `layerCoupledMovementReplacements`, `layerCoupledMovementMasks`, or `inferredPropertyBindings`.

Native `applyReplacementAt` (`native/src/runtime/core.cpp`) ORs `movements_layer_mask` into **clear** only; it does not run coupled layer→property movement copies. That matches native **`changed=0`** on line 316 despite a pattern match.

This aligns with [2026-06-12-5c3-lowering-backlog.md](./2026-06-12-5c3-lowering-backlog.md): Phase 5c-3 property / layer-coupled movement is **deferred** in native runtime.

### Secondary (not the first visible diff here)

- **`applyRuleGroup` incremental pruning** (`forceAlwaysRun`, `readObjects`/`readMovements` slots [14–18]) — native loops all rules with mask precheck only; JS skips/prunes inner loops. Sokobond input 0 orbital groups are no-ops on serialized state before resolve, so this is not the first divergence for this fixture.
- **`any_movements_present` / aggregate movement match path** — relevant for bond rules 310–314; those do not match on either engine for this input after 308.

### Not the cause

- Rule-plan JSON mismatch (passes for this source).
- Prepared-session / initial snapshot mismatch (passes).
- RNG drift (preview bytes match at snapshot[1]).
- Late bond rules (native `late_rule_changed=0` on this step).

---

## Recommended next implementation task

**Task:** Port Phase 5c-3 **layer-coupled movement** from JS `engine.js` to native runtime + IR export.

1. **IR export** (`puzzlescript_ir.js`): serialize `layer_coupled_movement_masks` on patterns and `layer_coupled_movement_replacements` on replacements (mirror JS `CellPattern` / `CellReplacement` fields).
2. **Native parse** (`native/src/runtime/core.cpp` `parsePattern` / `parseReplacement`): load new fields.
3. **Native apply** (`applyReplacementAt`): implement JS `layerCoupledMovementReplacements` copy loop (see `engine.js` ~2231+, `generateApplyFunction` coupled branch).
4. **Gate:** `build/native/puzzlescript_cpp diff-trace build/js-parity-data/ir/sim-15c72e42305db218.json build/js-parity-data/traces/sim-15c72e42305db218.json` → exit 0; then full `make js_parity_tests`.

**Files:** `src/tests/js_oracle/lib/puzzlescript_ir.js`, `native/src/runtime/core.cpp` (`applyReplacementAt`, `matchesPatternAt` if masks added), optionally `native/src/compiler/lower_to_runtime.cpp` for native-compile path parity.

**Follow-ups (same 5c-3 tranche):** `inferredPropertyBindings`, `any_movements_present` match OR-path, `classifyForceAlwaysRun` / incremental `applyRuleGroup` — needed for other trace failures (#682 orthogonal movement, etc.) but secondary for this specific first failure once 316 is fixed.

---

## Evidence checklist

- [x] Fixture located in `build/js-parity-data/fixtures.json` index 32
- [x] `diff-trace` / `trace-step-at` first mismatch at snapshot[1]
- [x] JS vs native rule-level debug on input 0
- [x] Movement bit delta at tile 43 before/after JS rule 316
- [x] Live JS vs IR metadata diff for line 316
- [x] Manual JS replay: groups 0–7 + `resolveMovements` reproduces expected row 4
