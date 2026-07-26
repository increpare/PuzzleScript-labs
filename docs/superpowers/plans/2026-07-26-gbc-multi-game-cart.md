# GBC Multi-Game Compilation Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one playable Game Boy Color ROM containing all 46
`ELIGIBLE_GAMES`, with a launcher that can start any game and return from a
game's title screen.

**Architecture:** Export every game with a unique C symbol prefix and a
dedicated core/data bank, compile each generated translation unit once, then
reassign the relocatable object's `_CODE_N` area into a first-fit-decreasing
cart-wide bank layout. A generated bank-2 index stores copied launcher entries
and opaque descriptor pointers. HOME owns activation and the outer launcher
loop; shared bank-1 rendering reads widths from the active WRAM game view
instead of a single game's compile-time macros.

**Tech Stack:** Python 3 cart builder/checker, C11 portable runtime tests,
C/SDCC through GBDK-2020, C++17 exporter tests, CMake/CTest, and libmGBA.

**Approved design:**
`docs/superpowers/specs/2026-07-25-gbc-multi-game-cart-design.md`

---

## File map

**Cart build and validation**

- Create `scripts/build_gbc_cart.py`: export, compile, size, pack, relocate,
  link, and report the 46-game cart.
- Create `scripts/build_gbc_cart_test.py`: deterministic packer, object-area
  relocation, and generated-index tests.
- Create `scripts/check_gbc_cart.py`: cartridge header, bank, HOME, WRAM,
  specialization, ownership, and collision gates.
- Create `scripts/check_gbc_cart_test.py`: synthetic map/object/manifest tests.
- Modify `Makefile`: `gbc_cart` and `gbc_cart_smoke` entry points.

**Cart ABI and launcher**

- Create `native/include/puzzlescript/gbc_cart.h`: copied cart-entry ABI and
  constants.
- Create `firmware/gbc/source/cart_launcher.h`: launcher model and UI entry
  points.
- Create `firmware/gbc/source/cart_launcher.c`: selection/page state and
  bank-1 launcher rendering orchestration.
- Create `native/tests/gbc_cart_launcher.c`: host selection/page tests.
- Modify `firmware/gbc/source/text.h`, `text.c`: render an eight-entry cart
  page with the existing font and tile buffers.
- Modify `firmware/gbc/source/main.c`: maximum arena, outer cart loop,
  per-game save slots, activation, and return-to-launcher.
- Modify `firmware/gbc/source/game_dispatch.h`, `game_dispatch.c`: clear active
  state safely between launches.

**Per-game/shared runtime hygiene**

- Modify `native/src/gbc/session_internal.h`, `core.c`: move the remaining
  per-core `again` scratch array into the shared session arena.
- Create `native/include/puzzlescript/gbc_packed_cell.h` and
  `native/src/gbc/packed_cell.c`: width-driven board-cell reads.
- Create `native/tests/gbc_packed_cell.c`: 1/2/4-byte cell tests.
- Modify `firmware/gbc/source/tile_cache.c`: remove all generated-game macros
  and use the active descriptor/view at runtime.
- Modify `firmware/gbc/source/main.c`: calculate snapshot offsets from
  `game->object_bytes_per_cell`.
- Modify `firmware/gbc/Makefile`: support cart-generated headers and objects.

**Exporter metadata and smoke**

- Modify `native/src/gbc/exporter.cpp`: add title and author to the manifest.
- Modify `native/tests/gbc_exporter.cpp`: assert metadata JSON.
- Modify `scripts/gbc_mgba_shim.c`: accept a frame-indexed key script.
- Create `scripts/run_gbc_cart_smoke.py`: boot launcher, navigate, launch,
  return, launch another game, and verify SRAM telemetry.
- Create `scripts/run_gbc_cart_smoke_test.py`: key-script and telemetry parser
  tests.

---

### Task 1: Eliminate per-game static WRAM

**Files:**

- Modify: `native/src/gbc/session_internal.h`
- Modify: `native/src/gbc/core.c`
- Modify: `scripts/check_gbc_cart.py`
- Test: `scripts/check_gbc_cart_test.py`

- [ ] **Step 1: Write the failing object-hygiene test**

Create a synthetic ASxxxx object containing:

```text
XL4
H B areas 1 global symbols
M g00_core
A _DATA size 168 flags 0 addr 0
A _CODE_3 size 1ECC flags 0 addr 0
```

Assert that `generated_static_areas()` reports
`{"g00_core.o": {"_DATA": 0x168}}` and that `check_cart()` rejects it with
`per-game static WRAM`.

- [ ] **Step 2: Run the test to verify it is red**

Run:

```bash
python3 scripts/check_gbc_cart_test.py
```

Expected: failure because `check_gbc_cart.py` does not exist.

- [ ] **Step 3: Move `again` scratch into the session**

Inside the specialized section of `struct ps_gbc_session`, add:

```c
uint8_t again_probe[PS_GBC_MAX_BOARD_CELLS * 4U];
```

Delete `g_ps_gbc_again_probe` from `core.c` and replace its three uses with
`session->again_probe` and `sizeof(session->again_probe)`.

- [ ] **Step 4: Add the minimal object static-area parser**

Implement:

```python
OBJECT_AREA = re.compile(r"^A\s+(\S+)\s+size\s+([0-9A-Fa-f]+)\b")
STATIC_AREAS = {"_DATA", "_BSS", "_INITIALIZED"}

def object_areas(path: Path) -> dict[str, int]:
    ...

def generated_static_areas(paths: Iterable[Path]) -> dict[str, dict[str, int]]:
    ...
```

`generated_static_areas()` must omit objects whose total is zero.

- [ ] **Step 5: Verify green**

Run:

```bash
python3 scripts/check_gbc_cart_test.py
cmake --build build --target puzzlescript_gbc_core_tests
ctest --test-dir build/native -R puzzlescript_gbc_core --output-on-failure
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add native/src/gbc/session_internal.h native/src/gbc/core.c \
  scripts/check_gbc_cart.py scripts/check_gbc_cart_test.py
git commit -m "Move GBC core scratch into the session arena"
```

---

### Task 2: Make shared rendering game-width independent

**Files:**

- Create: `native/include/puzzlescript/gbc_packed_cell.h`
- Create: `native/src/gbc/packed_cell.c`
- Create: `native/tests/gbc_packed_cell.c`
- Modify: `native/CMakeLists.txt`
- Modify: `firmware/gbc/source/tile_cache.c`
- Modify: `firmware/gbc/source/main.c`

- [ ] **Step 1: Write the failing packed-cell test**

Test this exact API:

```c
uint32_t ps_gbc_packed_cell_read(
    const void* board,
    uint16_t cell,
    uint8_t bytes_per_cell);
```

Cover 1-byte `0xab`, 2-byte `0xcdef`, 4-byte `0x89abcdef`, null board, and an
unsupported width returning zero.

- [ ] **Step 2: Run red**

Run:

```bash
cmake --build build --target puzzlescript_gbc_packed_cell_tests
```

Expected: missing header/source failure.

- [ ] **Step 3: Implement the width-driven reader**

Use byte reads and shifts rather than unaligned integer casts:

```c
uint32_t result = 0U;
const uint8_t* bytes = (const uint8_t*)board
    + (uint16_t)(cell * bytes_per_cell);
uint8_t index;
if (board == NULL
    || (bytes_per_cell != 1U
        && bytes_per_cell != 2U
        && bytes_per_cell != 4U)) return 0U;
for (index = 0U; index < bytes_per_cell; ++index) {
    result |= (uint32_t)bytes[index] << (uint8_t)(index * 8U);
}
return result;
```

- [ ] **Step 4: Remove generated macros from shared firmware**

In `tile_cache.c`:

- remove `generated_game.h`;
- replace `PS_GBC_GENERATED_CELL_PIXELS` with
  `game->cell_width * game->cell_height`;
- replace `PS_GBC_GENERATED_CELL_WIDTH` with `game->cell_width`;
- replace `BOARD_OBJECTS` with `ps_gbc_packed_cell_read(...,
  game->object_bytes_per_cell)`;
- replace the preprocessor precomposed branch with
  `descriptor->precomposed_count != 0U`.

In `main.c`, use `game->object_bytes_per_cell` for snapshot slot offsets.

- [ ] **Step 5: Verify green and single-game compatibility**

Run:

```bash
cmake --build build --target puzzlescript_gbc_packed_cell_tests
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
make gbc_smoke GBDK_HOME="$GBDK_HOME"
```

Expected: packed-cell test, all GBC host tests, and libmGBA smoke pass.

- [ ] **Step 6: Commit**

```bash
git add native/include/puzzlescript/gbc_packed_cell.h \
  native/src/gbc/packed_cell.c native/tests/gbc_packed_cell.c \
  native/CMakeLists.txt firmware/gbc/source/tile_cache.c \
  firmware/gbc/source/main.c
git commit -m "Make shared GBC rendering width independent"
```

---

### Task 3: Export launcher metadata

**Files:**

- Modify: `native/src/gbc/exporter.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [ ] **Step 1: Write the failing exporter assertion**

For `sokoban_basic`, parse `gbc_manifest.json` and assert it contains:

```json
"title": "Microban",
"author": "David W. Skinner"
```

Use the fixture's actual parsed title/author values if they differ.

- [ ] **Step 2: Run red**

Run:

```bash
cmake --build build --target puzzlescript_gbc_exporter_tests
build/native/puzzlescript_gbc_exporter_tests
```

Expected: metadata assertion fails.

- [ ] **Step 3: Emit escaped metadata**

Add adjacent manifest fields using `jsonString()`:

```cpp
out << "  \"title\": " << jsonString(game.title) << ",\n"
    << "  \"author\": " << jsonString(game.author) << ",\n";
```

- [ ] **Step 4: Verify and commit**

Run the exporter test again, then:

```bash
git add native/src/gbc/exporter.cpp native/tests/gbc_exporter.cpp
git commit -m "Export GBC launcher metadata"
```

---

### Task 4: Add deterministic cart packing

**Files:**

- Create: `scripts/build_gbc_cart.py`
- Create: `scripts/build_gbc_cart_test.py`

- [ ] **Step 1: Write failing packer tests**

Define:

```python
@dataclass(frozen=True)
class CartItem:
    name: str
    size: int
    objects: tuple[Path, ...]
    pinned_bank: int | None = None

@dataclass
class CartBank:
    number: int
    used: int = 0
    items: list[CartItem] = field(default_factory=list)
```

Tests must prove:

- pinned core/data groups remain in banks 3 and 4;
- 9 KiB + 7 KiB share one bank;
- 9 KiB + 8 KiB do not;
- equal-sized items sort by name for deterministic output;
- an item larger than 16 KiB is rejected;
- the allocator rejects bank numbers above 255.

- [ ] **Step 2: Run red**

Run:

```bash
python3 scripts/build_gbc_cart_test.py
```

Expected: import/API failure.

- [ ] **Step 3: Implement first-fit-decreasing**

Implement:

```python
def pack_items(
    items: Sequence[CartItem],
    *,
    first_bank: int,
    last_bank: int = 255,
    capacity: int = 16 * 1024,
) -> list[CartBank]:
    ...
```

Create pinned banks first, then place unpinned items sorted by
`(-size, name)` into the first bank with sufficient remaining capacity,
creating sequential banks as needed.

- [ ] **Step 4: Test relocatable object rewriting**

Given `A _CODE_7 size 1234 flags 0 addr 0`, assert:

```python
relocate_code_area(text, 42)
```

returns `A _CODE_42 size 1234 flags 0 addr 0`. It must reject an object with
zero or multiple non-empty `_CODE_N` areas.

- [ ] **Step 5: Implement and verify green**

Add `object_code_size()` and `relocate_object_code_area()` using the ASxxxx
area syntax. Run:

```bash
python3 scripts/build_gbc_cart_test.py
```

Expected: `build_gbc_cart_test: ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_gbc_cart.py scripts/build_gbc_cart_test.py
git commit -m "Add deterministic GBC cart bank packing"
```

---

### Task 5: Generate and link a two-game cart

**Files:**

- Create: `native/include/puzzlescript/gbc_cart.h`
- Modify: `scripts/build_gbc_cart.py`
- Modify: `scripts/build_gbc_cart_test.py`
- Modify: `firmware/gbc/Makefile`
- Modify: repository `Makefile`

- [ ] **Step 1: Write failing cart-index emission tests**

The generated header must contain:

```c
#define PS_GBC_CART_GAME_COUNT 2U
#define PS_GBC_CART_MAX_SESSION_BYTES 1024U
#define PS_GBC_CART_INDEX_BANK 2U

bool ps_gbc_cart_copy_entry(
    uint8_t index,
    ps_gbc_cart_entry* entry) BANKED;
```

The generated source must use `#pragma bank 2`, declare both namespaced
descriptors, and emit two fixed-size entries:

```c
{3U, &g00_ps_gbc_generated_descriptor, 0x12345678UL, "FIRST"},
{4U, &g01_ps_gbc_generated_descriptor, 0x90abcdefUL, "SECOND"},
```

- [ ] **Step 2: Run red**

Run `python3 scripts/build_gbc_cart_test.py`; expect missing emitter failure.

- [ ] **Step 3: Add the copied entry ABI**

Create:

```c
#define PS_GBC_CART_TITLE_CAPACITY 32U

typedef struct ps_gbc_cart_entry {
    uint8_t descriptor_bank;
    const ps_gbc_game_descriptor* descriptor;
    uint32_t source_hash;
    char title[PS_GBC_CART_TITLE_CAPACITY];
} ps_gbc_cart_entry;
```

- [ ] **Step 4: Implement export/compile/link flow**

For every selected `ELIGIBLE_GAMES` entry:

1. export with `--symbol-prefix gNN --bank-base (3 + NN)`;
2. require `specialized_turn == true`;
3. compile `generated_core.c`, `generated_game.c`, façade sources, and every
   file in `specialized_sources.list`;
4. pin the combined core/data group to `3 + NN`;
5. pack and relocate every other generated object;
6. compile shared firmware once with `PS_GBC_CART_BUILD=1`;
7. generate/compile the bank-2 cart index;
8. link with MBC5, CGB-only, 32 KiB RAM, and 256 ROM banks;
9. write `build/gbc/cart/cart-manifest.json`.

The CLI must support `--limit 2` for the red/green integration cycle and
default to all 46 games.

- [ ] **Step 5: Add build targets**

Add:

```make
.PHONY: gbc_cart
gbc_cart: build/native/puzzlescript_cpp
	python3 scripts/build_gbc_cart.py \
	  --repository . \
	  --compiler build/native/puzzlescript_cpp \
	  --gbdk-home "$(GBDK_HOME)" \
	  --out build/gbc/cart
```

- [ ] **Step 6: Run the two-game link**

Run:

```bash
python3 scripts/build_gbc_cart.py \
  --repository . \
  --compiler build/native/puzzlescript_cpp \
  --gbdk-home "$GBDK_HOME" \
  --out build/gbc/cart-two \
  --limit 2
```

Expected: one linked 4 MiB ROM and a manifest with two specialized games,
unique prefixes, non-overlapping packed assignments, and no bank overflow.

- [ ] **Step 7: Commit**

```bash
git add native/include/puzzlescript/gbc_cart.h \
  scripts/build_gbc_cart.py scripts/build_gbc_cart_test.py \
  firmware/gbc/Makefile Makefile
git commit -m "Link namespaced games into one GBC cartridge"
```

---

### Task 6: Add the eight-entry launcher

**Files:**

- Create: `firmware/gbc/source/cart_launcher.h`
- Create: `firmware/gbc/source/cart_launcher.c`
- Create: `native/tests/gbc_cart_launcher.c`
- Modify: `native/CMakeLists.txt`
- Modify: `firmware/gbc/source/text.h`
- Modify: `firmware/gbc/source/text.c`
- Modify: `scripts/build_gbc_cart.py`

- [ ] **Step 1: Write failing model tests**

Test:

```c
typedef struct ps_gbc_cart_launcher {
    uint8_t selected;
    uint8_t first_visible;
} ps_gbc_cart_launcher;

void ps_gbc_cart_launcher_init(...);
bool ps_gbc_cart_launcher_move(..., int8_t delta, uint8_t game_count);
bool ps_gbc_cart_launcher_page(..., int8_t delta, uint8_t game_count);
```

Prove wraparound at 0/45, eight-entry page alignment, and selection remaining
visible after moves.

- [ ] **Step 2: Run red**

Build `puzzlescript_gbc_cart_launcher_tests`; expect missing files.

- [ ] **Step 3: Implement the model**

Use `PS_GBC_CART_PAGE_SIZE 8U`; page left/right moves by eight and clamps the
last page so game 45 remains selectable.

- [ ] **Step 4: Render the launcher**

Expose:

```c
void showCartLauncher(
    uint8_t selected,
    uint8_t first_visible) BANKED;
```

Use the existing font/tile buffers, a fixed readable CGB palette, and
`ps_gbc_cart_copy_entry()` to render:

- `PUZZLESCRIPT NN/46` in the header;
- eight titles;
- brackets around the selected title;
- `A PLAY  L/R PAGE` on the last row when space permits.

- [ ] **Step 5: Verify**

Run launcher host tests, all GBC CTests, and rebuild the two-game cart.

- [ ] **Step 6: Commit**

```bash
git add firmware/gbc/source/cart_launcher.h \
  firmware/gbc/source/cart_launcher.c native/tests/gbc_cart_launcher.c \
  native/CMakeLists.txt firmware/gbc/source/text.h \
  firmware/gbc/source/text.c scripts/build_gbc_cart.py
git commit -m "Add the GBC compilation-cart launcher"
```

---

### Task 7: Add the outer game loop and per-game saves

**Files:**

- Modify: `firmware/gbc/source/main.c`
- Modify: `firmware/gbc/source/game_dispatch.h`
- Modify: `firmware/gbc/source/game_dispatch.c`
- Modify: `native/tests/gbc_frontend_flow.c`

- [ ] **Step 1: Write the failing lifecycle test**

Add a portable state test proving:

1. launcher selects game 1;
2. launch enters the title;
3. B on the title returns to launcher;
4. the launcher selection remains 1;
5. launching game 2 replaces the active source hash.

- [ ] **Step 2: Run red**

Run the focused frontend test; expect missing cart lifecycle behavior.

- [ ] **Step 3: Split `main()` into outer and inner loops**

Under `PS_GBC_CART_BUILD`:

- allocate `gSessionArena[PS_GBC_CART_MAX_SESSION_BYTES]`;
- show/update the launcher until A/Start;
- copy and activate the selected entry;
- initialize a fresh session in the shared arena;
- run the existing title/game loop;
- return from the inner loop when B or Select is pressed on the title screen;
- clear active dispatch and redraw the launcher.

Keep the standalone path byte-for-byte behavior-compatible behind the inverse
preprocessor branch.

- [ ] **Step 4: Store progress by game index**

Place `SaveRecord` at:

```c
uint16_t offset = (uint16_t)active_game_index * sizeof(SaveRecord);
```

in SRAM bank 0. Validate both checksum and source hash. Clear SRAM bank 1 on
launch so undo/checkpoint data from the previous game cannot leak.

- [ ] **Step 5: Verify two-game behavior**

Rebuild the two-game cart and verify it boots rather than parking in the
activation error loop.

- [ ] **Step 6: Commit**

```bash
git add firmware/gbc/source/main.c firmware/gbc/source/game_dispatch.h \
  firmware/gbc/source/game_dispatch.c native/tests/gbc_frontend_flow.c
git commit -m "Run multiple games through the shared GBC frontend"
```

---

### Task 8: Add cart gates and scripted libmGBA smoke

**Files:**

- Complete: `scripts/check_gbc_cart.py`
- Complete: `scripts/check_gbc_cart_test.py`
- Modify: `scripts/gbc_mgba_shim.c`
- Create: `scripts/run_gbc_cart_smoke.py`
- Create: `scripts/run_gbc_cart_smoke_test.py`
- Modify: `Makefile`

- [ ] **Step 1: Complete synthetic checker tests**

Cover:

- HOME ≤8192;
- every `_CODE_N` ≤16384;
- highest bank ≤255;
- ROM exactly 4 MiB or smaller;
- CGB flag `0xc0`, MBC5+RAM+battery `0x1b`, RAM `0x03`;
- 46 specialized games;
- unique prefixes and source hashes;
- per-game core/data ownership equality;
- zero per-game `_DATA`/`_BSS`/`_INITIALIZED`.

- [ ] **Step 2: Run red then implement**

Run `python3 scripts/check_gbc_cart_test.py`, implement the missing checks, and
rerun until `check_gbc_cart_test: ok`.

- [ ] **Step 3: Add frame-indexed input to the mGBA shim**

Add a second entry point:

```c
int psgbc_run_with_keys(
    ...,
    const uint32_t* frame_keys,
    unsigned frame_key_count,
    ...);
```

Before each `runFrame`, call `core->setKeys(core, frame_keys[frame])`, using
zero after the supplied script ends. Increment `SHIM_ABI_VERSION`.

- [ ] **Step 4: Write cart smoke parser tests**

Define a bank-3 telemetry record containing magic/version, launch count,
return count, first index/hash, and second index/hash. Test missing magic,
wrong indices, equal hashes, and the valid record.

- [ ] **Step 5: Add production instrumentation and scripted smoke**

For an autotest cart, record launcher/game transitions in SRAM. Drive:

1. launcher boot;
2. down + A to launch game 1;
3. B from title to return;
4. down + A to launch game 2.

Assert two launches, one return, indices 1 and 2, distinct source hashes, a
nonblank final frame, and emulator warnings within the existing ceiling.

- [ ] **Step 6: Add target and verify**

```make
.PHONY: gbc_cart_smoke
gbc_cart_smoke:
	python3 scripts/build_gbc_cart.py ... --autotest
	python3 scripts/run_gbc_cart_smoke.py \
	  build/gbc/cart/puzzlescript_compilation_autotest.gb
```

Run all three Python tests plus `make gbc_cart_smoke`.

- [ ] **Step 7: Commit**

```bash
git add scripts/check_gbc_cart.py scripts/check_gbc_cart_test.py \
  scripts/gbc_mgba_shim.c scripts/run_gbc_cart_smoke.py \
  scripts/run_gbc_cart_smoke_test.py firmware/gbc/source/main.c Makefile
git commit -m "Gate the GBC compilation cart in libmGBA"
```

---

### Task 9: Build and verify the full 46-game ROM

**Files:**

- Modify: `docs/performance/gbc-optimization-ledger.md`

- [ ] **Step 1: Run all focused host tests**

```bash
python3 scripts/build_gbc_cart_test.py
python3 scripts/check_gbc_cart_test.py
python3 scripts/run_gbc_cart_smoke_test.py
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
```

- [ ] **Step 2: Build the production compilation ROM**

```bash
make gbc_cart GBDK_HOME="$GBDK_HOME"
```

Expected artifact:

```text
build/gbc/cart/puzzlescript-compilation-46.gb
```

- [ ] **Step 3: Run cart checker and live smoke**

```bash
python3 scripts/check_gbc_cart.py \
  build/gbc/cart/puzzlescript-compilation-46.gb \
  build/gbc/cart/cart-manifest.json \
  build/gbc/cart/puzzlescript-compilation-46.map \
  build/gbc/cart/objects
make gbc_cart_smoke GBDK_HOME="$GBDK_HOME"
```

- [ ] **Step 4: Record evidence**

Append game count, ROM bytes, HOME bytes, highest bank, largest bank,
packing utilization, zero static per-game WRAM, and smoke result to the
optimization ledger.

- [ ] **Step 5: Run final cleanliness checks**

```bash
git diff --check
git status --short
```

- [ ] **Step 6: Commit**

```bash
git add docs/performance/gbc-optimization-ledger.md
git commit -m "Document the 46-game GBC compilation cart"
```

