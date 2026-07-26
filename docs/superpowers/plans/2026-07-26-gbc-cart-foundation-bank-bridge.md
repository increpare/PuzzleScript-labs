# GBC Cart Foundation — HOME Bank Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the single-game cart foundation by co-locating each private
`core.c` with its generated game data in a computed switchable bank, while
shared firmware reads game-owned ROM only through a tested HOME-resident bridge.

**Architecture:** A generated descriptor records the game/data bank, render
tables and core entry points. HOME copies that descriptor and the game view into
WRAM, dispatches core calls while the game bank is mapped, and exposes bounded
ROM-copy operations that save and restore the caller's bank. The work is staged
so the bridge is running against today's bank-1 data before `core.c` moves;
only then does the build adopt bank base 2 and relocate core/data together.

**Tech Stack:** C11 for portable bridge tests, C/SDCC through GBDK-2020 for
firmware, C++17 for the exporter, CMake/CTest, Python 3 ROM/link gates, and the
existing in-process libmGBA smoke harness.

**Spec:** `docs/superpowers/specs/2026-07-25-gbc-multi-game-cart-design.md`

---

## Scope and current state

This plan supersedes Tasks 4–7 of
`docs/superpowers/plans/2026-07-25-gbc-cart-foundation-banked-core.md`.
Its Tasks 1–3 are already merged: layout reporting and generated symbol
namespacing remain valid. The fixed-bank prototype was reverted in `fdd43201`
because MBC5 exposes only one switchable ROM window; core in bank 11 could not
read a game view in bank 1.

This plan completes only Plan A. It does not link two games, build the launcher,
or change SRAM slot ownership. It leaves these reusable boundaries for Plan B:

- `ps_gbc_game_descriptor` is safe to copy from any descriptor-table bank;
- `ps_gbc_activate_game()` owns the one active WRAM descriptor and view;
- no shared object refers to `ps_gbc_generated_*`;
- `--bank-base` allocates one non-overlapping per-game bank range and reports
  the first unused bank.

## File map

**New portable boundary**

- `native/include/puzzlescript/gbc_bank_access.h` — bank-switch callback and
  bounded copy/string-copy API.
- `native/src/gbc/bank_access.c` — target-independent save/map/copy/restore
  implementation.
- `native/tests/gbc_bank_access.c` — fake-bank host tests.
- `native/include/puzzlescript/gbc_descriptor.h` — descriptor and core function
  pointer types shared by exporter and firmware.

**New HOME firmware boundary**

- `firmware/gbc/source/game_dispatch.h` — active-game, ROM-copy and `psd_*`
  declarations.
- `firmware/gbc/source/game_dispatch.c` — MBC5 adapter, active WRAM copies and
  core call dispatch.

**Exporter and layout**

- `native/src/gbc/exporter.hpp`, `native/src/gbc/exporter.cpp` — `bankBase`,
  descriptor, bank manifest, and generated wrappers for core/facade sources.
- `native/src/cli/main.cpp` — `--bank-base`.
- `native/src/compiler/compact_turn_codegen.cpp` — honor the supplied main bank
  for the unsplit one-file specialized output.
- `native/src/gbc/compact_facade.c`, `native/src/gbc/facade_rules.c` — suppress
  their legacy bank-2 pragmas when included by a generated bank wrapper.
- `native/tests/gbc_exporter.cpp` — default/shifted layout assertions.

**Consumers**

- `firmware/gbc/source/audio.c` — copy named IDs/seeds through HOME.
- `firmware/gbc/source/text.c`, `text.h` — copy game strings/palette into WRAM.
- `firmware/gbc/source/tile_cache.c` — copy render records and palette/tile
  slices into scratch buffers.
- `firmware/gbc/source/main.c`, `autotest.c`, `benchmark.c` — use the active
  WRAM view, ROM-copy API and core dispatch.
- `native/src/gbc/specialized_turn.h` — make the specialized-to-core resolve
  call banked after relocation.
- `native/src/gbc/session_internal.h` — own specialized scratch state in the
  session arena rather than generated file statics.
- `firmware/gbc/Makefile`, repository `Makefile` — compile generated wrappers
  and forward bank-base flags.

**Gates and evidence**

- `scripts/check_gbc_rom.py`, `scripts/check_gbc_rom_test.py` — HOME budget,
  object bank ownership, forbidden shared references and generated-static gate.
- `docs/performance/gbc-optimization-ledger.md` — corpus layout evidence.

## Invariants

- Bank 0 HOME target is at most 8,192 bytes; hardware limit remains 16,384.
- Bank 1 contains cart-global `audio`, `text`, `tile_cache`,
  `frontend_flow`, autotest and benchmark code.
- Default per-game base is 2: core/data bank 2, facade bank 3, specialized main
  bank 4, split rule packs from bank 5.
- Every switchable bank is at most 16,384 bytes; bank numbers stay in 1–255.
- Shared consumers never dereference a pointer from `ps_gbc_game_view`.
- The bridge restores the incoming bank on success, truncation and rejection.
- Direct core calls outside `core.c` are replaced by `psd_*` calls.
- Existing host tests, standard smoke, shifted-base smoke and the eligible
  corpus remain green.

---

### Task 1: Add the portable bank-copy primitive

**Files:**

- Create: `native/include/puzzlescript/gbc_bank_access.h`
- Create: `native/src/gbc/bank_access.c`
- Create: `native/tests/gbc_bank_access.c`
- Modify: `native/CMakeLists.txt`

- [ ] **Step 1: Write the failing fake-bank test**

Create `native/tests/gbc_bank_access.c`:

```c
#include "puzzlescript/gbc_bank_access.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct fake_bank {
    uint8_t current;
    uint8_t switches[8];
    uint8_t switch_count;
} fake_bank;

static uint8_t fake_current(void* context) {
    return ((fake_bank*)context)->current;
}

static void fake_switch(void* context, uint8_t bank) {
    fake_bank* fake = (fake_bank*)context;
    fake->switches[fake->switch_count++] = bank;
    fake->current = bank;
}

int main(void) {
    fake_bank fake = {7U, {0U}, 0U};
    const ps_gbc_bank_access access = {
        &fake, fake_current, fake_switch
    };
    const uint8_t source[] = {3U, 1U, 4U, 1U};
    uint8_t destination[4] = {0U};
    char text[5] = {'x', 'x', 'x', 'x', 'x'};

    assert(ps_gbc_bank_copy(
        &access, 2U, source, destination, sizeof(destination)));
    assert(memcmp(source, destination, sizeof(source)) == 0);
    assert(fake.switch_count == 2U);
    assert(fake.switches[0] == 2U && fake.switches[1] == 7U);
    assert(fake.current == 7U);

    fake.switch_count = 0U;
    assert(!ps_gbc_bank_copy_string(
        &access, 2U, "abcdef", text, sizeof(text)));
    assert(strcmp(text, "abcd") == 0);
    assert(fake.current == 7U && fake.switch_count == 2U);

    fake.switch_count = 0U;
    assert(ps_gbc_bank_copy(&access, 2U, NULL, NULL, 0U));
    assert(fake.switch_count == 0U);
    assert(!ps_gbc_bank_copy(&access, 2U, NULL, destination, 1U));
    assert(!ps_gbc_bank_copy_string(&access, 2U, "x", NULL, 0U));
    assert(fake.switch_count == 0U && fake.current == 7U);

    puts("gbc_bank_access: ok");
    return 0;
}
```

Register `puzzlescript_gbc_bank_access_tests` in `native/CMakeLists.txt`, with
`tests/gbc_bank_access.c` and `src/gbc/bank_access.c` as its sources and
`native/include` on its include path.

- [ ] **Step 2: Run the test to prove it is red**

Run:

```bash
cmake --build build/native --target puzzlescript_gbc_bank_access_tests
```

Expected: compilation fails because `puzzlescript/gbc_bank_access.h` does not
exist.

- [ ] **Step 3: Add the exact bridge interface and minimal implementation**

Create `native/include/puzzlescript/gbc_bank_access.h`:

```c
#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef uint8_t (*ps_gbc_current_bank_fn)(void* context);
typedef void (*ps_gbc_switch_bank_fn)(void* context, uint8_t bank);

typedef struct ps_gbc_bank_access {
    void* context;
    ps_gbc_current_bank_fn current_bank;
    ps_gbc_switch_bank_fn switch_bank;
} ps_gbc_bank_access;

bool ps_gbc_bank_copy(
    const ps_gbc_bank_access* access,
    uint8_t source_bank,
    const void* source,
    void* destination,
    uint16_t byte_count);

bool ps_gbc_bank_copy_string(
    const ps_gbc_bank_access* access,
    uint8_t source_bank,
    const char* source,
    char* destination,
    uint16_t capacity);
```

Create `native/src/gbc/bank_access.c`. Both functions validate before switching,
save `access->current_bank(access->context)`, map the source, copy with a byte
loop, and restore the saved bank before returning. `ps_gbc_bank_copy_string`
copies at most `capacity - 1`, always writes the terminator, and returns `true`
only when it encountered the source terminator.

- [ ] **Step 4: Run focused and full host tests**

Run:

```bash
cmake --build build/native --target puzzlescript_gbc_bank_access_tests
ctest --test-dir build/native -R puzzlescript_gbc_bank_access --output-on-failure
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
```

Expected: `gbc_bank_access: ok`; all GBC tests pass.

- [ ] **Step 5: Commit**

```bash
git add native/include/puzzlescript/gbc_bank_access.h \
  native/src/gbc/bank_access.c native/tests/gbc_bank_access.c \
  native/CMakeLists.txt
git commit -m "Add a tested GBC ROM bank-copy primitive"
```

---

### Task 2: Parameterize the generated per-game bank range

**Files:**

- Modify: `native/src/gbc/exporter.hpp`
- Modify: `native/src/gbc/exporter.cpp`
- Modify: `native/src/cli/main.cpp`
- Modify: `native/src/compiler/compact_turn_codegen.hpp`
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/src/gbc/compact_facade.c`
- Modify: `native/src/gbc/facade_rules.c`
- Test: `native/tests/gbc_exporter.cpp`

The transitional library default stays bank base 1 so this task does not break
the current firmware build. Task 6 makes the firmware pass `--bank-base 2`.

- [ ] **Step 1: Write shifted-layout exporter assertions**

Extend `exportFixture()` in `native/tests/gbc_exporter.cpp` with a
`uint8_t bankBase = 1U` argument and assign it to `options.bankBase`. Add:

```cpp
static void test_shifted_bank_base_moves_every_per_game_artifact() {
    const auto out = exportFixture("sokoban_basic", "", 7U);
    const std::string header = readFile(out / "generated_game.h");
    const std::string source = readFile(out / "generated_game.c");
    const std::string core = readFile(out / "generated_core.c");
    const std::string facade = readFile(out / "generated_compact_facade.c");
    const std::string rules = readFile(out / "generated_facade_rules.c");
    const std::string specialized =
        readFile(out / "generated_specialized_turn.c");
    const std::string manifest = readFile(out / "gbc_manifest.json");

    assertTrue(header.find("PS_GBC_GENERATED_ROM_BANK 7U")
        != std::string::npos, "game bank follows bank base");
    assertTrue(source.find("#pragma bank 7") != std::string::npos,
        "game data moves to bank base");
    assertTrue(core.find("#pragma bank 7") != std::string::npos,
        "core wrapper shares the game-data bank");
    assertTrue(facade.find("#pragma bank 8") != std::string::npos
        && rules.find("#pragma bank 8") != std::string::npos,
        "facade wrappers use base plus one");
    assertTrue(specialized.find("#pragma bank 9") != std::string::npos,
        "specialized main uses base plus two");
    assertTrue(manifest.find("\"game_core_bank\": 7")
            != std::string::npos
        && manifest.find("\"facade_bank\": 8") != std::string::npos
        && manifest.find("\"specialized_main_bank\": 9")
            != std::string::npos
        && manifest.find("\"next_bank\": 10") != std::string::npos,
        "manifest reports the complete allocated range");
}
```

Invoke the test from `main()`.

Also copy the Sokoban fixture into the test output with a 256-character title,
export it, and assert `exportGame()` throws with
`"GBC text exceeds the 255-byte staging limit"`. Repeat with a 256-character
level message. These are the red tests for the text buffer contract.

- [ ] **Step 2: Run the exporter test to prove it is red**

```bash
cmake --build build/native --target puzzlescript_gbc_exporter_tests
ctest --test-dir build/native -R puzzlescript_gbc_exporter --output-on-failure
```

Expected: compile failure because `ExportOptions::bankBase` is absent.

- [ ] **Step 3: Emit the bank range and wrappers**

Add to `ExportOptions`:

```cpp
uint8_t bankBase = 1U;
```

Parse `--bank-base N` using `std::stoul`, rejecting values outside 1–253.
Thread these values through the emitters:

```cpp
const unsigned gameCoreBank = options.bankBase;
const unsigned facadeBank = gameCoreBank + 1U;
compiler::GbcSpecializedTurnEmitOptions turnOptions;
turnOptions.mainBank = facadeBank + 1U;
turnOptions.firstRulesBank = turnOptions.mainBank + 1U;
```

Make the one-file specialized path pass a
`GbcSpecializedSplitEmitMode` whose `bankNumber` is
`turnOptions.mainBank`; it must no longer fall back to the hard-coded bank 3.
Add `unsigned bankNumber = 0U` to
`GbcSpecializedTurnSourceFile`; populate it for the specialized main and each
rule-pack C file (the shared header keeps zero). Pass `turnOptions` through
`writeSpecializedTurnArtifacts()` and compute the manifest's high/next bank
from those recorded values rather than parsing generated C text.

Emit these generated wrappers:

```c
/* generated_core.c */
#if defined(__SDCC)
#pragma bank GAME_CORE_BANK
#endif
#include "core.c"
```

```c
/* generated_compact_facade.c / generated_facade_rules.c */
#if defined(__SDCC)
#pragma bank FACADE_BANK
#endif
#define PS_GBC_GENERATED_FACADE_WRAPPER 1
#include "compact_facade.c" /* or facade_rules.c */
```

Replace `GAME_CORE_BANK` and `FACADE_BANK` with decimal literals in emitted
text. Guard the existing hard-coded `#pragma bank 2` in both facade sources
with `!defined(PS_GBC_GENERATED_FACADE_WRAPPER)`, so the inner include cannot
undo the wrapper's bank.

Make `emitHeader()` and `emitSource()` take `gameCoreBank`, and add
`bank_base`, `game_core_bank`, `facade_bank`, `specialized_main_bank`,
`specialized_first_rules_bank`, and `next_bank` to the manifest. Compute
`next_bank` as one past the highest emitted specialized file, and reject any
layout whose highest bank exceeds 255.

Before writing artifacts, reject a title, author, packed level message or
packed rule message whose UTF-8 byte length is 256 or greater. This guarantees
that Task 4's 256-byte WRAM staging buffer never truncates an accepted export.

- [ ] **Step 4: Run exporter and existing codegen tests**

```bash
cmake --build build/native --target puzzlescript_cpp \
  puzzlescript_gbc_exporter_tests
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
```

Expected: all GBC tests pass; the existing default assertions still see banks
1, 2 and 3.

- [ ] **Step 5: Commit**

```bash
git add native/src/gbc/exporter.hpp native/src/gbc/exporter.cpp \
  native/src/cli/main.cpp native/src/compiler/compact_turn_codegen.hpp \
  native/src/compiler/compact_turn_codegen.cpp \
  native/src/gbc/compact_facade.c native/src/gbc/facade_rules.c \
  native/tests/gbc_exporter.cpp
git commit -m "Parameterize the GBC per-game bank range"
```

---

### Task 3: Add the active descriptor and HOME dispatch

**Files:**

- Create: `native/include/puzzlescript/gbc_descriptor.h`
- Create: `firmware/gbc/source/game_dispatch.h`
- Create: `firmware/gbc/source/game_dispatch.c`
- Modify: `native/src/gbc/exporter.cpp`
- Modify: `native/tests/gbc_exporter.cpp`
- Modify: `firmware/gbc/Makefile`
- Modify: `firmware/gbc/source/main.c`

- [ ] **Step 1: Assert the descriptor is generated**

In `native/tests/gbc_exporter.cpp`, assert the header declares
`ps_gbc_generated_descriptor` and the source initializer contains the selected
game bank, `&ps_gbc_generated_game`, render/precomposed table addresses and all
core entry-point names.

Run the exporter test and expect it to fail on the missing descriptor.

- [ ] **Step 2: Define the descriptor**

Create `native/include/puzzlescript/gbc_descriptor.h`. Define function-pointer
typedefs matching every public core signature in `puzzlescript/gbc.h`, including
the four-argument `ps_gbc_session_init`:

```c
typedef ps_gbc_session* (*ps_gbc_session_init_fn)(
    void*, size_t, const ps_gbc_game_view*, const ps_gbc_snapshot_io*);
typedef bool (*ps_gbc_load_level_fn)(ps_gbc_session*, uint16_t);
typedef void (*ps_gbc_step_fn)(
    ps_gbc_session*, ps_input, ps_step_result*);
typedef void (*ps_gbc_defer_wins_fn)(ps_gbc_session*, bool);
typedef bool (*ps_gbc_advance_level_fn)(ps_gbc_session*);
typedef bool (*ps_gbc_undo_fn)(ps_gbc_session*);
typedef bool (*ps_gbc_restart_fn)(ps_gbc_session*);
typedef void (*ps_gbc_status_get_fn)(
    const ps_gbc_session*, ps_gbc_status*);
typedef uint32_t (*ps_gbc_cell_objects_fn)(
    const ps_gbc_session*, int16_t, int16_t);
typedef const uint8_t* (*ps_gbc_dirty_cells_fn)(const ps_gbc_session*);
typedef bool (*ps_gbc_has_dirty_cells_fn)(const ps_gbc_session*);
typedef void (*ps_gbc_clear_dirty_cells_fn)(ps_gbc_session*);
typedef bool (*ps_gbc_first_player_position_fn)(
    const ps_gbc_session*, int16_t*, int16_t*);
typedef const void* (*ps_gbc_board_fn)(const ps_gbc_session*);
```

Then define:

```c
typedef struct ps_gbc_game_descriptor {
    uint8_t game_bank;
    uint16_t session_bytes;
    const ps_gbc_game_view* game;
    const ps_gbc_render_object* render_objects;
    uint8_t render_object_count;
    const uint32_t* precomposed_masks;
    const uint8_t* precomposed_palettes;
    const uint8_t* precomposed_tiles;
    uint8_t precomposed_count;
    ps_gbc_session_init_fn session_init;
    ps_gbc_load_level_fn load_level;
    ps_gbc_step_fn step;
    ps_gbc_defer_wins_fn defer_wins;
    ps_gbc_advance_level_fn advance_level;
    ps_gbc_undo_fn undo;
    ps_gbc_restart_fn restart;
    ps_gbc_status_get_fn status_get;
    ps_gbc_cell_objects_fn cell_objects;
    ps_gbc_dirty_cells_fn dirty_cells;
    ps_gbc_has_dirty_cells_fn has_dirty_cells;
    ps_gbc_clear_dirty_cells_fn clear_dirty_cells;
    ps_gbc_first_player_position_fn first_player_position;
    ps_gbc_board_fn board;
} ps_gbc_game_descriptor;
```

SDCC 4.5 hits an internal code-generator error on an indirect function call
that returns `ps_step_result` by value. Emit a bank-local
`ps_gbc_descriptor_step(session, input, result)` adapter that calls
`ps_gbc_step()` directly and writes through the third argument; point the
descriptor at that void-return adapter.

Have `generated_game.h` declare `ps_gbc_generated_descriptor`. Emit its
initializer after `ps_gbc_generated_game`, using null precomposed pointers when
the generated count is zero.

Extend `kNamespacedSymbols` with
`ps_gbc_generated_descriptor`, `ps_gbc_generated_render_objects`,
`ps_gbc_generated_precomposed_masks`,
`ps_gbc_generated_precomposed_palettes`, and
`ps_gbc_generated_precomposed_tiles`. Extend the namespace exporter test with
the same names so two future game exports cannot collide on render assets.

- [ ] **Step 3: Write the HOME adapter**

Create `game_dispatch.c` under `#pragma bank 0`. It owns:

```c
static ps_gbc_game_descriptor gActiveDescriptor;
static ps_gbc_game_view gActiveGameView;
static const ps_gbc_bank_access kMbc5Access;
```

Its MBC5 callbacks read `CURRENT_BANK` and call `SWITCH_ROM_MBC5`. Expose:

```c
bool ps_gbc_activate_game(
    uint8_t descriptor_bank,
    const ps_gbc_game_descriptor* descriptor);
const ps_gbc_game_descriptor* ps_gbc_active_descriptor(void);
const ps_gbc_game_view* ps_gbc_active_game_view(void);
bool ps_gbc_active_rom_copy(
    const void* source, void* destination, uint16_t byte_count);
bool ps_gbc_active_rom_copy_string(
    const char* source, char* destination, uint16_t capacity);
```

Activation first copies the descriptor from `descriptor_bank`, then copies
`*gActiveDescriptor.game` from `gActiveDescriptor.game_bank` into
`gActiveGameView`. Use stack-local `descriptor_copy` and `game_view_copy` for
those two operations, then assign both statics only after both copies succeed;
activation must not expose a half-updated game.

Add `psd_*` wrappers for every function pointer in the descriptor. Each wrapper
saves `CURRENT_BANK`, maps `gActiveDescriptor.game_bank`, calls the copied
function pointer, and restores the saved bank. Pointer-returning wrappers may
return only WRAM pointers (`board` and `dirty_cells`); no wrapper returns the
descriptor's game-ROM pointer.

`game_dispatch.h` declares this exact dispatch surface:

```c
ps_gbc_session* psd_session_init(
    void* arena, size_t bytes, const ps_gbc_snapshot_io* snapshots);
bool psd_load_level(ps_gbc_session* session, uint16_t level);
ps_step_result psd_step(ps_gbc_session* session, ps_input input);
void psd_defer_wins(ps_gbc_session* session, bool defer);
bool psd_advance_level(ps_gbc_session* session);
bool psd_undo(ps_gbc_session* session);
bool psd_restart(ps_gbc_session* session);
void psd_status_get(
    const ps_gbc_session* session, ps_gbc_status* status);
uint32_t psd_cell_objects(
    const ps_gbc_session* session, int16_t x, int16_t y);
const uint8_t* psd_dirty_cells(const ps_gbc_session* session);
bool psd_has_dirty_cells(const ps_gbc_session* session);
void psd_clear_dirty_cells(ps_gbc_session* session);
bool psd_first_player_position(
    const ps_gbc_session* session, int16_t* x, int16_t* y);
const void* psd_board(const ps_gbc_session* session);
```

- [ ] **Step 4: Activate without changing call sites**

Compile `bank_access.c` and `game_dispatch.c` into HOME from
`firmware/gbc/Makefile`. At the start of `main()` replace the raw initial bank
switch with:

```c
if (!ps_gbc_activate_game(
        PS_GBC_GENERATED_ROM_BANK,
        &ps_gbc_generated_descriptor)) {
    for (;;) vsync();
}
```

Keep direct core calls for this task; core still lives in HOME. This proves
descriptor copying and bank restoration independently of relocation.

- [ ] **Step 5: Run the standard smoke**

```bash
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt \
  GBDK_HOME="$GBDK_HOME"
```

Expected: all host tests pass and libmGBA reports the existing successful
autotest result.

- [ ] **Step 6: Commit**

```bash
git add native/include/puzzlescript/gbc_descriptor.h \
  firmware/gbc/source/game_dispatch.h \
  firmware/gbc/source/game_dispatch.c firmware/gbc/source/main.c \
  firmware/gbc/Makefile native/src/gbc/exporter.cpp \
  native/tests/gbc_exporter.cpp
git commit -m "Add the active GBC game descriptor and HOME dispatch"
```

---

### Task 4: Route shared firmware through the bridge

**Files:**

- Modify: `firmware/gbc/source/audio.c`
- Modify: `firmware/gbc/source/text.c`
- Modify: `firmware/gbc/source/text.h`
- Modify: `firmware/gbc/source/tile_cache.c`

- [ ] **Step 1: Establish the red structural assertion**

Run:

```bash
rg -n "ps_gbc_generated_" firmware/gbc/build-autotest/{audio,text,tile_cache}.o
```

Expected: references from all three objects.

- [ ] **Step 2: Bridge audio data**

Replace `audioPlayNamed()`'s direct view/table reads with the active WRAM view
and two bounded scalar copies:

```c
const ps_gbc_game_view* game = ps_gbc_active_game_view();
uint8_t sound_id;
int32_t seed;
if (game == NULL || sound >= PS_GBC_NAMED_SOUND_COUNT) return;
if (!ps_gbc_active_rom_copy(
        game->named_sound_ids + sound, &sound_id, sizeof(sound_id))) return;
if (sound_id == PS_GBC_NO_SOUND || sound_id >= game->sound_count) return;
if (!ps_gbc_active_rom_copy(
        game->sound_seeds + sound_id, &seed, sizeof(seed))) return;
audioPlaySeed(seed);
```

- [ ] **Step 3: Stage text and palettes**

Add one `static char gTextBuffer[256]` and `static uint16_t gUiPalette[4]` in
`text.c`. Add these exact entry points to `text.h`:

```c
void showGameText(const char* game_message) BANKED;
void showGameTitleText(void) BANKED;
```

`showGameText()` copies one ROM message into `gTextBuffer`.
`showGameTitleText()` copies and renders the active title, then reuses the
buffer for the active author. `showTitleMenu()` does the same staging around
its menu rows. All three copy `game->ui_palette` into `gUiPalette` before
calling `set_bkg_palette`. A null status-message pointer is rendered as the
local empty string without invoking the bridge.

Keep `showText()` for HOME/shared literal strings such as `"MEMORY ERROR"` and
the render autotest phrase. No local string is passed to the game-ROM copy API.

- [ ] **Step 4: Stage tile-cache records**

In `tile_cache.c`, remove `generated_game.h` and include `game_dispatch.h`.
Add `static uint8_t gPaletteRemap[32]`.

`composeTile()` takes render-table metadata from the active descriptor, copies
one `ps_gbc_render_object` into a stack local, copies its sprite bytes into
`gTileBytes`, and then composites from `gTileBytes` into `gSourcePixels`.
`encodeQuartet()` copies the selected 32-byte remap slice into
`gPaletteRemap`. `loadPrecomposedComposition()` copies each mask scalar until
it matches, then copies the palette scalar and the 64 tile bytes. Full-board
rendering reads `background_mask` from the active WRAM view.

- [ ] **Step 5: Prove the shared objects are clean and smoke**

```bash
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt \
  GBDK_HOME="$GBDK_HOME"
rg -n "ps_gbc_generated_" \
  firmware/gbc/build-autotest/{audio,text,tile_cache}.o
```

Expected: smoke passes; `rg` exits 1 with no matches.

- [ ] **Step 6: Commit**

```bash
git add firmware/gbc/source/audio.c firmware/gbc/source/text.c \
  firmware/gbc/source/text.h firmware/gbc/source/tile_cache.c
git commit -m "Route shared GBC assets through the HOME bank bridge"
```

---

### Task 5: Route HOME, autotest and benchmark through active state

**Files:**

- Modify: `firmware/gbc/source/main.c`
- Modify: `firmware/gbc/source/autotest.c`
- Modify: `firmware/gbc/source/benchmark.c`

- [ ] **Step 1: Record all unsafe references and direct core calls**

```bash
rg -n "ps_gbc_generated_|ps_gbc_(session_init|load_level|step|defer_wins|advance_level|undo|restart|status_get|cell_objects|dirty_cells|has_dirty_cells|clear_dirty_cells|first_player_position|board)\\(" \
  firmware/gbc/source/{main,autotest,benchmark}.c
```

Expected: every site listed in the current source; retain this output as the
replacement checklist.

- [ ] **Step 2: Replace core calls**

Replace each public core call with its same-suffix `psd_*` wrapper. Initialize
the session with:

```c
gSession = psd_session_init(
    gSessionArena, sizeof(gSessionArena), &snapshot_io);
```

`psd_session_init()` supplies `gActiveDescriptor.game` while the active game
bank is mapped.

- [ ] **Step 3: Replace game-view and table reads**

Use `ps_gbc_active_game_view()` for scalar values such as `source_hash`,
`level_count`, `max_level_cells`, `movement_bytes_per_cell`, and
`background_mask`.

For palettes, copy into a local or one reusable 32-entry WRAM buffer before
comparison/upload. For level-kind scans, copy one `ps_gbc_level` record at a
time:

```c
ps_gbc_level level;
if (!ps_gbc_active_rom_copy(
        game->levels + index, &level, sizeof(level))) return false;
if (level.kind == PS_GBC_LEVEL_BOARD) { /* existing action */ }
```

Use `showGameText(status.message)` for status messages and keep
`showText()` for local literals. Benchmark title timing calls
`showGameTitleText()`; it never passes the raw title pointer to `showText()`.

- [ ] **Step 4: Prove no unsafe references remain**

```bash
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt \
  GBDK_HOME="$GBDK_HOME"
rg -n "ps_gbc_generated_" \
  firmware/gbc/build-autotest/{audio,text,tile_cache,autotest,benchmark}.o
rg -n "ps_gbc_(session_init|load_level|step|defer_wins|advance_level|undo|restart|status_get|cell_objects|dirty_cells|has_dirty_cells|clear_dirty_cells|first_player_position|board)\\(" \
  firmware/gbc/source/{main,autotest,benchmark}.c
```

Expected: smoke passes; both `rg` checks exit 1. References inside generated
objects, `core.c`, or `game_dispatch.c` are intentionally outside this check.

- [ ] **Step 5: Commit**

```bash
git add firmware/gbc/source/main.c firmware/gbc/source/autotest.c \
  firmware/gbc/source/benchmark.c
git commit -m "Route the GBC frontend through active game state"
```

---

### Task 6: Co-locate core and game data at bank base 2

**Files:**

- Modify: `firmware/gbc/Makefile`
- Modify: repository `Makefile`
- Modify: `native/src/gbc/specialized_turn.h`
- Modify: `native/src/gbc/exporter.hpp`
- Modify: `native/src/cli/main.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [ ] **Step 1: Add the HOME ≤ 8 KiB gate first**

Add `MAX_FOUNDATION_HOME_BYTES = 8 * 1024` and a failing
`"foundation HOME budget"` check to `scripts/check_gbc_rom.py`. Run:

```bash
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
```

Expected: FAIL because `core.o` is still in HOME.

- [ ] **Step 2: Switch the firmware build to the generated wrappers**

Set this default in both makefiles:

```make
GBC_EXPORT_FLAGS ?= --bank-base 2
EXPORT_GBC_FLAGS ?= --bank-base 2
```

Compile `$(GENERATED)/generated_core.c`,
`generated_compact_facade.c`, and `generated_facade_rules.c` instead of the
source files directly. Keep the native source files as explicit prerequisites,
and keep `../../native/src/gbc` on the include path so wrapper includes resolve.

Forward the root value to firmware as
`EXPORT_GBC_FLAGS="$(GBC_EXPORT_FLAGS)"`, and use it on the root `gbc_export`
target too.

Change `ExportOptions::bankBase` from the transitional 1 to the production
default 2, and change CLI validation to reject bases below 2. Update the
exporter test's default expectations from game/facade/specialized banks 1/2/3
to 2/3/4. The explicit shifted-base test remains 7/8/9. This also covers
`scripts/build_gbc_eligible_roms.py`, whose cull build supplies only
`--cull-oversize-levels` and therefore relies on the exporter's production
default.

Add an export-configuration prerequisite containing `$(GAME)` and
`$(EXPORT_GBC_FLAGS)`. Recreate it only when that text changes, and make
`$(EXPORT_STAMP)` depend on it. This ensures a bank-7 smoke followed by the
default smoke actually re-exports instead of silently reusing stale generated
bank pragmas.

- [ ] **Step 3: Make specialized resolve a banked call**

In the freestanding branch of `specialized_turn.h`, change:

```c
#define PS_GBC_CORE_RUNTIME_NONBANKED BANKED
```

Host builds still expand it to nothing. This makes a specialized pack in bank
4 switch to core/data bank 2 for `ps_gbc_resolve_movements()` and return to the
pack bank afterward.

- [ ] **Step 4: Build and inspect before running**

```bash
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
python3 scripts/report_gbc_layout.py firmware/gbc/puzzlescript_gbc.map \
  --build-dir firmware/gbc/build
rg -n "^A _CODE_2 " \
  firmware/gbc/build/{core,generated_game}.o
```

Expected: build and size gate pass; HOME is ≤8,192; both objects declare
`_CODE_2`; no bank exceeds 16,384.

- [ ] **Step 5: Run host and live verification**

```bash
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt \
  GBDK_HOME="$GBDK_HOME"
```

Expected: all host tests pass and libmGBA completes the full render/audio
autotest. A null session or hang is a bank-boundary failure and must be debugged
before proceeding.

- [ ] **Step 6: Commit**

```bash
git add firmware/gbc/Makefile Makefile \
  native/src/gbc/specialized_turn.h native/src/gbc/exporter.hpp \
  native/src/cli/main.cpp native/tests/gbc_exporter.cpp \
  scripts/check_gbc_rom.py
git commit -m "Co-locate GBC core and game data in a computed bank"
```

---

### Task 7: Add permanent linker/object gates and shifted-base smoke

**Files:**

- Create: `scripts/check_gbc_rom_test.py`
- Modify: `scripts/check_gbc_rom.py`
- Modify: `native/src/gbc/session_internal.h`
- Modify: `native/src/gbc/exporter.cpp`
- Modify: repository `Makefile`

- [ ] **Step 1: Write parser tests for ownership and forbidden references**

Create synthetic SDCC object text in `scripts/check_gbc_rom_test.py` and assert:

```python
assert check_gbc_rom.object_code_banks(core_object) == {7}
assert check_gbc_rom.object_code_banks(game_object) == {7}
assert check_gbc_rom.forbidden_generated_references(shared_object) == [
    "ps_gbc_generated_game"
]
assert check_gbc_rom.forbidden_generated_references(
    namespaced_shared_object
) == ["g07_ps_gbc_generated_render_objects"]
assert check_gbc_rom.generated_static_bytes(build_dir) == {
    "generated_specialized_turn.o": 14
}
```

Run the script and expect `AttributeError` for the first missing helper.

- [ ] **Step 2: Implement and wire the gates**

Parse `A _CODE_N` records for object ownership and `S _name Ref` records for
references. The live checks must enforce:

- `core.o` and `generated_game.o` each have exactly the manifest's
  `game_core_bank`;
- shared `audio.o`, `text.o`, `tile_cache.o`, `autotest.o`, and `benchmark.o`
  contain no reference whose normalized name contains
  `ps_gbc_generated_`, which also catches namespaced per-game equivalents;
- generated objects contribute zero `_DATA`, `_BSS` plus `_INITIALIZED`;
- manifest ranges start at bank 2 or above, end below 256, and do not include
  shared bank 1;
- HOME ≤8 KiB and every switchable bank ≤16 KiB.

The build directory is the optional fourth CLI argument, defaulting to the
map's sibling `build`/`build-autotest` directory. Update firmware make targets
to pass the actual `$(BUILD)` directory.

- [ ] **Step 3: Make generated specialized scratch session-owned**

The live gate initially reports 14 WRAM bytes: the 12-byte movement bitset and
the initialized 2-byte player cell. Add these fields to `ps_gbc_session` under
the specialized-turn build guard:

```c
uint8_t specialized_move_bits[(PS_GBC_MAX_BOARD_CELLS + 7U) / 8U];
uint16_t specialized_player_cell;
```

Change the specialized emitter so every generated reference is
`session->specialized_move_bits` or `session->specialized_player_cell`; remove
both file-scope variables. Initialize the player cell to `UINT16_MAX` at the
start of the generated refresh/apply path before it is observed.

- [ ] **Step 4: Make the parser and live gates green**

```bash
python3 scripts/check_gbc_rom_test.py
make gbc GBC_GAME=src/demo/sokoban_basic.txt GBDK_HOME="$GBDK_HOME"
```

Expected: unit script prints `check_gbc_rom_test: ok`; live gates report zero
generated static WRAM and all other checks `status=ok`.

- [ ] **Step 5: Prove the layout is not accidentally fixed**

```bash
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt \
  GBC_EXPORT_FLAGS="--bank-base 7" GBDK_HOME="$GBDK_HOME"
python3 scripts/report_gbc_layout.py \
  firmware/gbc/puzzlescript_gbc_autotest.map \
  --build-dir firmware/gbc/build-autotest
```

Expected: smoke passes with core/data bank 7, facade bank 8 and specialized main
bank 9. No shared object gains a generated-symbol reference.

- [ ] **Step 6: Restore and verify the default build**

```bash
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt \
  GBDK_HOME="$GBDK_HOME"
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
```

Expected: default bank-2 smoke and all host GBC tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/check_gbc_rom.py scripts/check_gbc_rom_test.py Makefile \
  firmware/gbc/Makefile native/src/gbc/session_internal.h \
  native/src/gbc/exporter.cpp
git commit -m "Gate GBC cross-bank ownership and shifted layouts"
```

---

### Task 8: Rebuild the eligible corpus and record evidence

**Files:**

- Modify: `docs/performance/gbc-optimization-ledger.md`

- [ ] **Step 1: Rebuild all eligible ROMs**

```bash
make gbc_eligible GBDK_HOME="$GBDK_HOME"
```

Expected: every previously eligible game builds. Do not remove games from
`ELIGIBLE_GAMES` to hide a bank overflow.

- [ ] **Step 2: Run solution parity**

```bash
python3 scripts/bench_gbc_eligible_solutions.py --skip-rom --max-levels 2
```

Expected: no new solution or specialized-win failure.

- [ ] **Step 3: Record measured layout**

Append `### GBC co-located core/data bank bridge (2026-07-26)` to
`docs/performance/gbc-optimization-ledger.md`. Record game count, HOME
minimum/maximum, largest switchable bank, highest bank number, zero forbidden
shared references, zero generated statics, standard smoke result and shifted
bank-7 smoke result.

- [ ] **Step 4: Run final verification**

```bash
python3 scripts/check_gbc_rom_test.py
python3 scripts/run_gbc_smoke_test.py
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
make gbc_smoke GBC_GAME=src/demo/sokoban_basic.txt \
  GBDK_HOME="$GBDK_HOME"
git status --short
```

Expected: both Python test scripts pass, all host GBC tests pass, live smoke
passes, and only the ledger is modified.

- [ ] **Step 5: Commit**

```bash
git add docs/performance/gbc-optimization-ledger.md
git commit -m "Document GBC bank-bridge corpus results"
```

---

## Self-review checklist

- **Spec coverage:** Tasks 1 and 3 implement bounded save/map/copy/restore and
  the WRAM descriptor copy; Tasks 4–5 remove shared/direct reads; Task 6
  co-locates core/data and preserves shared firmware; Task 7 covers structural
  and shifted-bank gates; Task 8 supplies corpus evidence.
- **Failure ordering:** No task relocates core until the active descriptor,
  shared asset bridge and frontend dispatch have each passed a live smoke.
- **Type consistency:** `ps_gbc_session_init_fn` includes snapshot I/O;
  descriptor/core dispatch use `uint8_t` bank IDs and `uint16_t` byte counts;
  the active view is a WRAM `ps_gbc_game_view` value whose pointer fields remain
  opaque.
- **Memory:** Added persistent WRAM is one descriptor, one game view, a
  256-byte text buffer, an 8-byte UI palette and a 32-byte remap slice. It stays
  inside the existing 6 KiB static-WRAM gate and adds no second tile/sprite
  working set.
- **No fallback:** Rules-free games remain rejected from specialized export;
  the plan does not revive the unsafe fallback walker or interpreter relink.
