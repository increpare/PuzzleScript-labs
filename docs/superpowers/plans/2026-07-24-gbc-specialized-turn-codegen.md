# GBC Specialized Turn Codegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retarget `compact_turn_codegen` to emit a per-game banked GBC specialized `ps_gbc_step`, with host oracle parity, a 512 KiB ROM ceiling, and interpreter fallback.

**Architecture:** Add a `GbdC` dialect to `CompactCodegenOptions`, a thin session façade for cell/movement access, and wire `ps_gbc_step` to call one banked specialized entry. Bootstrap with a semantic-equivalent stub (calls existing `ps_gbc_apply_turn_phases`) to prove banking/oracle/firmware, then replace the stub body with real GbdC emission from the compact-turn emitter. Measure with solution-replay timing; bake single-player `player_cell` when analysis proves it.

**Tech Stack:** C++ host compiler (`compact_turn_codegen`, GBC exporter), GBDK-2020 / SDCC (firmware), mGBA timing harness, existing GBC parity tests, Python ROM checker.

**Spec:** [docs/superpowers/specs/2026-07-24-gbc-specialized-turn-codegen-design.md](../specs/2026-07-24-gbc-specialized-turn-codegen-design.md)

---

## File map

| File | Role |
|------|------|
| `native/src/compiler/compact_turn_codegen.hpp` | Add `CompactCodegenTarget` + option field |
| `native/src/compiler/compact_turn_codegen.cpp` | Dialect-aware emission; GbdC entry + later full turn body |
| `native/include/puzzlescript/gbc_compact_facade.h` | Public façade API used by specialized code (host + GBDK) |
| `native/src/gbc/compact_facade.c` | Façade impl over `ps_gbc_session` (needs session layout visibility) |
| `native/src/gbc/session_internal.h` | Shared internal session struct for `core.c` + façade |
| `native/src/gbc/core.c` | Call specialized entry from `ps_gbc_step`; keep interpreter path |
| `native/include/puzzlescript/gbc.h` | Declare `ps_gbc_step_specialized` weak/optional hook contract |
| `native/src/gbc/exporter.cpp` | Optionally emit specialized turn `.c` + manifest flags |
| `firmware/gbc/Makefile` | Link specialized object; raise `-Wm-yo` toward 512 KiB when enabled |
| `scripts/check_gbc_rom.py` | Raise `MAX_ROM_BYTES` to 512 KiB (keep other budgets unless specialized) |
| `native/tests/gbc_compact_facade_tests.c` | Façade unit tests |
| `native/tests/gbc_specialized_oracle_smoke.cpp` | Interpreter vs specialized parity on fixed inputs / replay |
| `scripts/run_gbc_solution_replay_bench.py` | Solution-replay timing + snappy scoreboard JSON |
| `docs/performance/gbc-optimization-ledger.md` | Ledger entry after first real specialized win |

**Bootstrap note:** Tasks 1–6 prove plumbing with a specialized stub that calls `ps_gbc_apply_turn_phases`. Tasks 7+ replace that stub with compact-turn GbdC emission. Do not skip the stub milestone — it isolates banking/oracle bugs from emitter bugs.

---

### Task 1: Add `CompactCodegenTarget` to options

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.hpp`
- Modify: `native/tests/compiler_compact_turn_support.cpp` (or add a tiny assertion there)

- [ ] **Step 1: Extend options**

In `compact_turn_codegen.hpp`, add:

```cpp
enum class CompactCodegenTarget {
    NativeCpp,
    GbdC,
};

struct CompactCodegenOptions {
    CompactCodegenTarget target = CompactCodegenTarget::NativeCpp;
    bool interpreterMode = false;
    bool externalBoardStorage = false;
    bool externalSnapshotStorage = false;
    bool externalObjectCellIndexStorage = false;
    bool enableObjectCellIndex = true;
    bool enableMovementCellIndex = true;
};
```

- [ ] **Step 2: Keep default support path unchanged**

Ensure `compactTurnSupportForGame(game)` still defaults to `NativeCpp` behavior. No emission changes yet.

- [ ] **Step 3: Build / smoke**

```bash
cmake --build build --target puzzlescript_cpp
# or existing compact-turn support test target used in this repo
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add native/src/compiler/compact_turn_codegen.hpp
git commit -m "$(cat <<'EOF'
Add CompactCodegenTarget for NativeCpp vs GbdC emission.

EOF
)"
```

---

### Task 2: Extract session layout + façade header

**Files:**
- Create: `native/src/gbc/session_internal.h`
- Create: `native/include/puzzlescript/gbc_compact_facade.h`
- Modify: `native/src/gbc/core.c` (move `struct ps_gbc_session` into the internal header; include it)

- [ ] **Step 1: Move `struct ps_gbc_session` into `session_internal.h`**

Copy the existing struct from `core.c` (currently around the `struct ps_gbc_session { ... }` definition) into:

```c
/* native/src/gbc/session_internal.h */
#pragma once
#include "puzzlescript/gbc.h"
/* include the same feature ifdefs core.c already uses */
struct ps_gbc_session {
    const ps_gbc_game_view* game;
    uint8_t* board;
    uint8_t* movements;
    /* ... identical fields to current core.c ... */
};
```

`core.c` includes this header and deletes the duplicate struct definition.

- [ ] **Step 2: Add façade API**

```c
/* native/include/puzzlescript/gbc_compact_facade.h */
#pragma once
#include "puzzlescript/gbc.h"
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

uint16_t ps_gbc_facade_cell_count(const ps_gbc_session* session);
uint32_t ps_gbc_facade_get_objects(const ps_gbc_session* session, uint16_t cell);
void ps_gbc_facade_set_objects(ps_gbc_session* session, uint16_t cell, uint32_t objects);
uint32_t ps_gbc_facade_get_movements(const ps_gbc_session* session, uint16_t cell);
void ps_gbc_facade_set_movements(ps_gbc_session* session, uint16_t cell, uint32_t movements);
void ps_gbc_facade_mark_dirty(ps_gbc_session* session, uint16_t cell);
bool ps_gbc_facade_cell_has_any(const ps_gbc_session* session, uint16_t cell, uint32_t mask);
bool ps_gbc_facade_cell_has_all(const ps_gbc_session* session, uint16_t cell, uint32_t mask);

#ifdef __cplusplus
}
#endif
```

- [ ] **Step 3: Build gbc core tests to confirm no layout break**

```bash
cmake --build build --target puzzlescript_gbc_core_tests
ctest --test-dir build -R puzzlescript_gbc_core_tests --output-on-failure
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add native/src/gbc/session_internal.h native/include/puzzlescript/gbc_compact_facade.h native/src/gbc/core.c
git commit -m "$(cat <<'EOF'
Extract GBC session layout for compact-turn façade sharing.

EOF
)"
```

---

### Task 3: Implement façade + unit tests

**Files:**
- Create: `native/src/gbc/compact_facade.c`
- Create: `native/tests/gbc_compact_facade_tests.c`
- Modify: `native/CMakeLists.txt` (add sources + test target)

- [ ] **Step 1: Write failing test**

```c
/* native/tests/gbc_compact_facade_tests.c */
#include "puzzlescript/gbc_compact_facade.h"
#include "generated_game.h" /* use existing sokoban generated smoke dir pattern */
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Reuse snapshot helpers pattern from gbc_generated_smoke.c */
int main(void) {
    /* init session from ps_gbc_generated_game, load level 0 */
    /* set objects at cell 0 via façade, read back */
    uint32_t before = ps_gbc_facade_get_objects(session, 0);
    ps_gbc_facade_set_objects(session, 0, before | 1u);
    assert(ps_gbc_facade_get_objects(session, 0) == (before | 1u));
    assert(ps_gbc_facade_cell_has_any(session, 0, 1u));
    puts("gbc_compact_facade_tests: ok");
    return 0;
}
```

Wire the test like `puzzlescript_gbc_generated_smoke` (depends on exported sokoban `generated_game`).

- [ ] **Step 2: Run test — expect link failure / missing symbols**

```bash
cmake --build build --target puzzlescript_gbc_compact_facade_tests
```

Expected: FAIL (undefined `ps_gbc_facade_*`).

- [ ] **Step 3: Implement `compact_facade.c`**

Implement get/set using the same width rules as `ps_gbc_board_get` / movement helpers in `core.c` (1/2/4 byte object and movement widths from `session->game`). Prefer calling shared static helpers if you factor them into `session_internal.h` as `static inline`, or duplicate the small width switches once in the façade file.

Dirty marking must match existing dirty-bit layout in `core.c`.

- [ ] **Step 4: Run test — expect PASS**

```bash
cmake --build build --target puzzlescript_gbc_compact_facade_tests
ctest --test-dir build -R puzzlescript_gbc_compact_facade_tests --output-on-failure
```

- [ ] **Step 5: Commit**

```bash
git add native/src/gbc/compact_facade.c native/tests/gbc_compact_facade_tests.c native/CMakeLists.txt
git commit -m "$(cat <<'EOF'
Add GBC compact-turn session façade with unit tests.

EOF
)"
```

---

### Task 4: Specialized step hook + interpreter-bridge stub emission

**Files:**
- Modify: `native/include/puzzlescript/gbc.h`
- Modify: `native/src/gbc/core.c` (`ps_gbc_step`)
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (`emitCompactTurnBackend` GbdC branch)
- Modify: `native/src/gbc/exporter.cpp` (emit/write specialized file when requested)

- [ ] **Step 1: Declare hook**

In `gbc.h`:

```c
/* Returns true if a specialized turn ran. If false, caller uses interpreter phases. */
bool ps_gbc_try_specialized_turn(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands /* or opaque command sink matching core.c */);
```

Because `ps_gbc_commands` is currently private to `core.c`, either:
- move commands struct to `session_internal.h`, or
- keep the hook internal: `bool ps_gbc_specialized_apply_turn_phases(ps_gbc_session*, uint8_t direction, ps_gbc_commands* commands);` declared in an internal header used only by core + generated code.

Prefer **internal header** `native/src/gbc/specialized_turn.h` to avoid widening the public C API.

```c
/* native/src/gbc/specialized_turn.h */
#pragma once
#include "session_internal.h"
bool ps_gbc_specialized_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);
```

- [ ] **Step 2: Weak default stub (no specialized code)**

In `core.c` (or `compact_facade.c`):

```c
#if !defined(PS_GBC_HAS_SPECIALIZED_TURN)
bool ps_gbc_specialized_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands
) {
    (void)session; (void)direction; (void)commands;
    return false; /* means: not handled */
}
#endif
```

Change `ps_gbc_step` / `ps_gbc_apply_turn_phases` call site:

```c
changed = ps_gbc_specialized_apply_turn_phases(session, direction, &commands);
if (!changed && /* need a clearer protocol */) {
```

Use an explicit protocol instead of overloading `changed`:

```c
bool handled = false;
#if defined(PS_GBC_HAS_SPECIALIZED_TURN)
handled = ps_gbc_specialized_apply_turn_phases(session, direction, &commands, &changed);
#else
(void)handled;
changed = ps_gbc_apply_turn_phases(session, direction, &commands);
#endif
```

Final signature:

```c
/* returns true if specialized path executed (even if board unchanged) */
bool ps_gbc_specialized_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands,
    bool* out_changed);
```

- [ ] **Step 3: GbdC stub emitter**

When `options.target == CompactCodegenTarget::GbdC`, `emitCompactTurnBackend` (or a new `emitGbcSpecializedTurn`) writes:

```c
#pragma bank 2
#include "puzzlescript/gbc_compact_facade.h"
#include "specialized_turn.h"

/* Forward declare interpreter phases implemented in core (bank 0 / bank 1).
   Bootstrap only: call existing semantics. */
bool ps_gbc_apply_turn_phases(ps_gbc_session* session, uint8_t direction, ps_gbc_commands* commands);

bool ps_gbc_specialized_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands,
    bool* out_changed
) {
    *out_changed = ps_gbc_apply_turn_phases(session, direction, commands);
    return true;
}
```

Note: calling `ps_gbc_apply_turn_phases` across banks may require it to be `BANKED` or non-banked in bank 0. For bootstrap, **emit the stub into the same bank as `core.o`** (`#pragma bank 1` alongside current core) OR compile stub without bank pragma first. Prefer **no pragma in bootstrap** so it links with `core.o` and proves the function pointer/call only; introduce `#pragma bank 2` in Task 6 once the real emitter lands.

- [ ] **Step 4: Exporter writes `generated_specialized_turn.c`**

In `export-gbc`, after game data emission, if compact-turn support is native-kernel for the game:

```cpp
CompactCodegenOptions opt;
opt.target = CompactCodegenTarget::GbdC;
emitCompactTurnBackend(specializedOut, game, sourcePath, hash, 0, opt);
```

Manifest field:

```json
"specialized_turn": true
```

- [ ] **Step 5: Commit**

```bash
git add native/src/gbc/specialized_turn.h native/src/gbc/core.c native/src/compiler/compact_turn_codegen.cpp native/src/gbc/exporter.cpp native/include/puzzlescript/gbc.h
git commit -m "$(cat <<'EOF'
Wire GBC specialized-turn hook with interpreter-bridge stub emission.

EOF
)"
```

---

### Task 5: Host oracle smoke (stub must match interpreter)

**Files:**
- Create: `native/tests/gbc_specialized_oracle_smoke.cpp`
- Modify: `native/CMakeLists.txt`

- [ ] **Step 1: Write oracle test**

Pattern after `gbc_parity_smoke.cpp`, but compare **two GBC sessions**:

1. Session A: `PS_GBC_HAS_SPECIALIZED_TURN` undefined / forced interpreter  
2. Session B: specialized stub linked  

Drive the same input sequence on `src/demo/sokoban_basic.txt` first board, e.g. `RIGHT,LEFT,RIGHT,UP,DOWN` plus a short known push sequence from a checked-in fixture file:

Create `native/tests/fixtures/gbc_sokoban_basic_replay.txt`:

```text
right
right
up
left
left
```

(Adjust to a legal non-winning prefix that exercises movement; later tasks replace with a full solution.)

For each input, assert boards equal via `ps_gbc_cell_objects`, and `ps_step_result` fields `changed/won/restarted/transitioned` match.

- [ ] **Step 2: Run — expect PASS with stub**

```bash
cmake --build build --target puzzlescript_gbc_specialized_oracle_smoke
ctest --test-dir build -R puzzlescript_gbc_specialized_oracle_smoke --output-on-failure
```

Expected: PASS (stub delegates to interpreter).

- [ ] **Step 3: Commit**

```bash
git add native/tests/gbc_specialized_oracle_smoke.cpp native/tests/fixtures/gbc_sokoban_basic_replay.txt native/CMakeLists.txt
git commit -m "$(cat <<'EOF'
Add GBC specialized vs interpreter oracle smoke.

EOF
)"
```

---

### Task 6: Firmware link + 512 KiB ROM ceiling

**Files:**
- Modify: `firmware/gbc/Makefile`
- Modify: `scripts/check_gbc_rom.py`
- Modify: exporter/manifest consumption in Makefile `export` step

- [ ] **Step 1: Raise ROM ceiling**

In `scripts/check_gbc_rom.py`:

```python
MAX_ROM_BYTES = 512 * 1024
```

In `firmware/gbc/Makefile` `LDFLAGS`, change `-Wm-yo8` to `-Wm-yo32` (32 × 16 KiB = 512 KiB). Keep MBC5 flags.

- [ ] **Step 2: Link specialized object when present**

```make
SPECIALIZED_SRC := $(GENERATED)/generated_specialized_turn.c
SPECIALIZED_OBJ := $(if $(wildcard $(SPECIALIZED_SRC)),$(BUILD)/generated_specialized_turn.o,)
OBJECTS := ... $(SPECIALIZED_OBJ)

$(BUILD)/generated_specialized_turn.o: $(SPECIALIZED_SRC) ...
	"$(LCC)" $(CFLAGS) -DPS_GBC_HAS_SPECIALIZED_TURN=1 -c -o $@ $<
```

Also compile `core.o` with `-DPS_GBC_HAS_SPECIALIZED_TURN=1` when specialized source exists.

- [ ] **Step 3: Build cart**

```bash
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME=.codex_tmp/toolchains/gbdk
```

Expected: `puzzlescript_gbc.gb` links; `check_gbc_rom.py` passes under 512 KiB.

- [ ] **Step 4: Commit**

```bash
git add firmware/gbc/Makefile scripts/check_gbc_rom.py
git commit -m "$(cat <<'EOF'
Allow 512 KiB GBC ROMs and link specialized turn objects.

EOF
)"
```

---

### Task 7: Real GbdC emission — access layer + empty rule shell

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp`

- [ ] **Step 1: Split emission helpers by target**

Introduce small helpers used at emit sites:

```cpp
bool isGbdC(const CompactCodegenOptions& o) {
    return o.target == CompactCodegenTarget::GbdC;
}

std::string emitTypeInt(const CompactCodegenOptions& o) {
    return isGbdC(o) ? "int16_t" : "int32_t";
}
```

For GbdC, **do not** emit `PersistentLevelState`, `std::vector`, or `SpecializedCompactTurnBackend`. Emit only:

1. includes + `#pragma bank 2`
2. width constants from the game / GBC export facts
3. `ps_gbc_specialized_apply_turn_phases` definition

- [ ] **Step 2: First real body — player seed + call movement/rules still via interpreter helpers if needed**

Incremental replacement order inside the specialized function:

1. clear movements / audio counters (façade)
2. seed player movement for `direction` (hand-specialized loop using façade + player mask constants)
3. call remaining interpreter pieces **only if still required** for parity
4. remove interpreter calls as generated rulegroups land

For this task, implement steps 1–2 in generated C and keep `ps_gbc_apply_turn_phases` for the rest **or** factor `ps_gbc_apply_turn_phases` so specialized can call sub-phases. Prefer extracting in `core.c`:

```c
bool ps_gbc_apply_early_rules(...);
bool ps_gbc_apply_movement(...);
bool ps_gbc_apply_late_rules(...);
bool ps_gbc_apply_commands_and_win(...);
```

Specialized stub becomes: seed (generated) + shared phase functions (same bank or bank 0 non-banked).

- [ ] **Step 3: Oracle must still PASS**

```bash
ctest --test-dir build -R puzzlescript_gbc_specialized_oracle_smoke --output-on-failure
```

- [ ] **Step 4: Commit**

```bash
git add native/src/compiler/compact_turn_codegen.cpp native/src/gbc/core.c
git commit -m "$(cat <<'EOF'
Start GbdC specialized emission with façade player seeding.

EOF
)"
```

---

### Task 8: Emit specialized early/late rulegroups from compact-turn patterns

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (reuse match/apply emit paths with GbdC type substitutions)
- Modify: `native/tests/fixtures/gbc_sokoban_basic_replay.txt` (expand coverage)

- [ ] **Step 1: Map compact match emit → façade**

Where NativeCpp emits:

```cpp
const MaskWord* cell = compact_turn_cell_objects_SUFFIX(levelState, tileIndex);
```

GbdC emits:

```c
uint32_t cell = ps_gbc_facade_get_objects(session, (uint16_t)tileIndex);
```

For GBC v1 object counts ≤32, a single `uint32_t` mask is enough (already true for eligible export). Do not emit multi-`MaskWord` loops unless `object_count > 32` (unsupported on GBC v1).

- [ ] **Step 2: Port one Sokoban rulegroup end-to-end**

Generate early rules for `sokoban_basic` without calling `ps_gbc_apply_early_rules`. Keep movement/late/win shared until oracle passes.

- [ ] **Step 3: Expand oracle fixture** to include a crate push.

- [ ] **Step 4: Run oracle + existing GBC smokes**

```bash
ctest --test-dir build -R 'puzzlescript_gbc_' --output-on-failure
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
Emit GbdC specialized early rules for Sokoban via façade.

EOF
)"
```

---

### Task 9: Finish specialized whole turn for Sokoban + remove interpreter fallback on that path

**Files:**
- Modify: `compact_turn_codegen.cpp`, `core.c` phase helpers as needed

- [ ] **Step 1: Generate movement resolution + late rules + win/commands for Sokoban**

Specialized function must not call `ps_gbc_apply_turn_phases` anymore for this game.

- [ ] **Step 2: Oracle PASS on full fixture**

- [ ] **Step 3: Build cart and run `make gbc_smoke`**

```bash
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME=.codex_tmp/toolchains/gbdk
```

Expected: smoke PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Complete GbdC specialized whole turn for sokoban_basic.

EOF
)"
```

---

### Task 10: Solution-replay bench harness + ledger baseline

**Files:**
- Create: `scripts/run_gbc_solution_replay_bench.py`
- Create: `native/tests/fixtures/gbc_sokoban_basic_solution.txt` (full solution tokens)
- Modify: `docs/performance/gbc-optimization-ledger.md`
- Modify: `Makefile` (optional `gbc_specialized_bench` target)

- [ ] **Step 1: Check in a real solution**

Generate once with the native solver / editor, save as line-oriented tokens (`up`/`down`/`left`/`right`/`action`).

- [ ] **Step 2: Bench script**

Script responsibilities:

1. Build autotest/perf ROM with specialized turn (or use existing PERF_BENCH hooks).
2. Feed solution inputs (extend autotest SRAM protocol or mGBA scripting already used by `run_gbc_smoke.py` / benchmark suite).
3. Emit JSON: per-turn ticks, mean ms, `% <=50ms`, `% <=80ms`, ROM size, bank count.

Reuse timing methodology from `docs/performance/gbc-optimization-ledger.md` (4096 Hz timer, CGB double-speed).

- [ ] **Step 3: Record ledger entry** for specialized Sokoban vs immediate predecessor interpreter cart.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Add GBC specialized solution-replay bench and Sokoban ledger entry.

EOF
)"
```

---

### Task 11: Single-player bake-in (analysis-gated)

**Files:**
- Modify: exporter / static analysis near GBC export
- Modify: GbdC player-seed emission
- Test: oracle + unit test that `player_cell` updates on move

- [ ] **Step 1: Analysis predicate**

```cpp
bool gbcSinglePlayerCertified(const Game& game, const GbcExportView& view);
```

True only if:

1. every retained level has exactly one player cell, and  
2. no rule replacement can change player object cardinality (no create/destroy of player mask objects; no transform that removes player without placing one).

- [ ] **Step 2: Emit `uint16_t player_cell` session field maintenance** in specialized seed/apply paths when certified; skip board scans.

- [ ] **Step 3: Tests**

- certified Sokoban uses player_cell path (manifest flag `"single_player_cell": true`)
- a synthetic fixture that creates a second player forces non-certified emission

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Bake certified single-player cell into GbdC specialized turns.

EOF
)"
```

---

### Task 12: Eligible corpus specialization + scoreboard (M3)

**Files:**
- Modify: `scripts/build_gbc_eligible_roms.py` (record specialized/fallback + ROM bytes)
- Create/extend: bench over all 14 games with available solutions
- Modify: ledger

- [ ] **Step 1: For each eligible game**, attempt GbdC emission; on unsupported or ROM > 512 KiB, fall back to interpreter and record reason.

- [ ] **Step 2: Produce `build/gbc/eligible/specialized-scoreboard.json`**

```json
{
  "format": "puzzlescript-gbc-specialized-scoreboard-v1",
  "games": [
    {
      "slug": "pushit",
      "specialized": true,
      "rom_bytes": 0,
      "replay_turns": 0,
      "pct_le_50ms": 0.0,
      "pct_le_80ms": 0.0,
      "fallback_reason": null
    }
  ]
}
```

- [ ] **Step 3: Commit scoreboard tooling + docs update**

```bash
git commit -m "$(cat <<'EOF'
Specialize eligible GBC corpus and emit snappy scoreboard.

EOF
)"
```

---

### Task 13: Size/speed hardening (M4)

**Files:**
- `compact_turn_codegen.cpp`, `firmware/gbc/Makefile`, ledger

- [ ] **Step 1:** If a game’s specialized bank exceeds 16 KiB, split **only** at early/late phase boundary into bank 2/3; keep match loops switch-free.

- [ ] **Step 2:** Trim GbdC emission of desktop-only counters/hooks (`PS_COMPACT_TURN_OUTPUT_HOOKS`, `std::vector` helpers already forbidden).

- [ ] **Step 3:** Re-bench top games; update ledger with size deltas.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Harden GbdC specialized banking and trim desktop-only emission.

EOF
)"
```

---

## Spec coverage checklist

| Spec item | Task(s) |
|-----------|---------|
| Dialect + reuse compact_turn_codegen | 1, 7, 8, 9 |
| GBC façade | 2, 3 |
| Whole specialized step | 4, 7–9 |
| Host oracle first | 5, 8, 9 |
| Banked cart, one hot entry | 6, 9, 13 |
| 512 KiB ceiling + fallback | 6, 12 |
| Solution-replay measurement | 10, 12 |
| Snappy scoreboard | 12 |
| Single-player bake-in | 11 |
| Ledger | 10, 12, 13 |
| No desktop C++ blobs on SDCC | 7 (explicit GbdC emit path) |

## Placeholder / consistency self-review

- Protocols use `ps_gbc_specialized_apply_turn_phases(..., bool* out_changed)` returning whether specialized handled the turn — consistent across Tasks 4–9.
- ROM ceiling 512 KiB aligned in Makefile (`-Wm-yo32`) and `check_gbc_rom.py`.
- Bootstrap stub is intentional; Task 9 removes interpreter delegation for Sokoban.
- Solution fixture path fixed under `native/tests/fixtures/`.
