# GBC Launcher Instant Page Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GBC launcher's 46-frame runtime page rasterization with build-time card assets and LCD-on CGB DMA uploads that complete by the next emulated frame.

**Architecture:** `build_gbc_cart.py` will render exact 160-by-16 header and progress-aware card bands and pack one launcher-art object per game. The generated cart index will expose each art object's bank and pointer. Firmware will map the requested art bank through a fixed-bank copy bridge, stage one aligned band in WRAM, split transfers at signed-tile and VRAM-bank boundaries, and upload with CGB general-purpose DMA while leaving the LCD enabled.

**Tech Stack:** Python 3 cart builder/tests, C11 host unit tests, SDCC/GBDK GBC firmware, MBC5 bank packing, CGB VRAM DMA, libmGBA smoke automation.

---

## File map

- `scripts/build_gbc_cart.py`: pure launcher-band renderer, launcher-art C emission, art object compilation, and bank metadata generation.
- `scripts/build_gbc_cart_test.py`: deterministic raster, variant, source emission, and bank metadata tests.
- `native/include/puzzlescript/gbc_cart.h`: generated-cart entry fields for launcher-art bank/pointer/count.
- `firmware/gbc/source/cart_launcher.c`: pure progress-variant and 40-tile DMA split calculations.
- `firmware/gbc/source/cart_launcher.h`: declarations and transfer-span type for those pure helpers.
- `native/tests/gbc_cart_launcher.c`: host tests for progress mapping and every transfer boundary.
- `firmware/gbc/source/game_dispatch.c`: fixed-bank arbitrary-ROM copy entry point.
- `firmware/gbc/source/game_dispatch.h`: declaration for the copy entry point.
- `firmware/gbc/source/text.c`: pre-rendered band loading, aligned staging, CGB DMA, page refresh, and pre-rendered header updates.
- `firmware/gbc/source/text.h`: page-refresh declaration.
- `firmware/gbc/source/main.c`: use the fast page refresh for Left/Right.
- `scripts/gbc_mgba_shim.c`: bounded per-frame LCDC and background-state trace.
- `scripts/run_gbc_smoke.py`: shim ABI/accessor declarations.
- `scripts/run_gbc_cart_smoke.py`: page-changing lifecycle and one-frame/LCD-on assertions.
- `scripts/run_gbc_cart_smoke_test.py`: scripted input and trace assertion tests.
- `Makefile`: build a nine-game autotest cart so paging is exercised.
- `build/gbc/cart/cart-manifest.json`: regenerated 46-game cart metadata.
- `build/gbc/cart/puzzlescript-compilation-46.gb`: regenerated deliverable ROM.

### Task 1: Build-time band rasterizer

**Files:**
- Modify: `scripts/build_gbc_cart.py`
- Modify: `scripts/build_gbc_cart_test.py`

- [ ] **Step 1: Write failing raster and progress-state tests**

Add a synthetic card with a striped background and player pixels, then assert:

```python
labels = build_gbc_cart.launcher_progress_labels(launcher_card)
assert labels == ("--", "1/2", "2/2", "DONE")

header = build_gbc_cart.render_launcher_header_band(1, 46)
card = build_gbc_cart.render_launcher_card_band(
    title="FIRST",
    card=launcher_card,
    game_index=1,
    game_count=46,
    progress="1/2",
)
assert len(header) == build_gbc_cart.LAUNCHER_BAND_BYTES
assert len(card) == build_gbc_cart.LAUNCHER_BAND_BYTES
assert build_gbc_cart.launcher_band_pixel(header, 0, 0) == 0
assert build_gbc_cart.launcher_band_pixel(header, 4, 15) == 3
assert build_gbc_cart.launcher_band_pixel(card, 158, 0) in (0, 3)
```

Also assert repeat calls return byte-identical bands and that a 17-board card
produces 19 progress variants.

- [ ] **Step 2: Run the builder test and verify RED**

Run:

```bash
python3 scripts/build_gbc_cart_test.py
```

Expected: failure because `launcher_progress_labels`,
`render_launcher_header_band`, and `render_launcher_card_band` do not exist.

- [ ] **Step 3: Implement the exact pure-Python rasterizer**

Add:

```python
LAUNCHER_BAND_TILES = 40
LAUNCHER_BAND_BYTES = LAUNCHER_BAND_TILES * 16

def launcher_progress_labels(card: LauncherCard) -> tuple[str, ...]:
    if card.board_level_count == 0:
        return ("--", "DONE")
    return (
        "--",
        *(f"{board}/{card.board_level_count}"
          for board in range(1, card.board_level_count + 1)),
        "DONE",
    )

def render_launcher_header_band(
    selected: int,
    game_count: int,
) -> bytes:
    band = bytearray(LAUNCHER_BAND_BYTES)
    counter = f"{selected + 1} / {game_count}"
    counter_x = 156 - len(counter) * 6
    _draw_launcher_text(band, "PUZZLESCRIPT", 4, counter_x)
    _draw_launcher_text(band, counter, counter_x, 158)
    for x in range(160):
        _set_launcher_band_pixel(band, x, 15, 3)
    return bytes(band)

def render_launcher_card_band(
    *,
    title: str,
    card: LauncherCard,
    game_index: int,
    game_count: int,
    progress: str,
) -> bytes:
    band = bytearray(card.background_tile * LAUNCHER_BAND_TILES)
    for y in range(8):
        for x in range(8):
            player = card.player_pixels[y * 8 + x]
            if player != 0xFF:
                _set_launcher_band_pixel(band, x + 2, y + 4, player)
    progress_x = max(12, 154 - len(progress) * 6)
    _draw_launcher_text(band, title[:31], 12, progress_x - 2)
    _draw_launcher_text(band, progress, progress_x, 158)
    thumb_top = (game_index // PS_GBC_CART_PAGE_SIZE) * 8 * 128 // game_count
    thumb_height = max(4, 8 * 128 // game_count)
    row = game_index % PS_GBC_CART_PAGE_SIZE
    for y in range(16):
        global_y = row * 16 + y
        color = 3 if thumb_top <= global_y < thumb_top + thumb_height else 0
        _set_launcher_band_pixel(band, 158, y, color)
        _set_launcher_band_pixel(band, 159, y, color)
    return bytes(band)
```

Define `_set_launcher_band_pixel()` with the current tile-order row offsets and
pixel masks. Define `_draw_launcher_text()` with the current `kGlyphs`: build
seven five-bit glyph rows, clear the nine-row one-pixel outline mask to color
0, then set the seven foreground rows to color 3. These tables and operations
are copied byte-for-byte from `firmware/gbc/source/text.c`; card bands exclude
the selection border.

- [ ] **Step 4: Run the builder test and verify GREEN**

Run:

```bash
python3 scripts/build_gbc_cart_test.py
```

Expected: `build_gbc_cart_test: ok`.

- [ ] **Step 5: Commit the rasterizer**

```bash
git add scripts/build_gbc_cart.py scripts/build_gbc_cart_test.py
git commit -m "Pre-render GBC launcher bands in the cart builder"
```

### Task 2: Emit and bank-pack launcher-art objects

**Files:**
- Modify: `scripts/build_gbc_cart.py`
- Modify: `scripts/build_gbc_cart_test.py`
- Modify: `native/include/puzzlescript/gbc_cart.h`

- [ ] **Step 1: Write failing ABI and source-emission tests**

Construct entries with explicit launcher-art banks and assert:

```python
art = build_gbc_cart.render_launcher_art(entry, 0, 46)
assert len(art.bands) == (
    1 + len(build_gbc_cart.launcher_progress_labels(launcher_card))
) * build_gbc_cart.LAUNCHER_BAND_BYTES

source = build_gbc_cart.emit_launcher_art_source(entry, art, 3)
assert "#pragma bank 3" in source
assert "const uint8_t g00_ps_gbc_launcher_art" in source

cart_source = build_gbc_cart.emit_cart_source(entries)
assert "g00_ps_gbc_launcher_art" in cart_source
assert "launcher_art_bank" in Path(
    "native/include/puzzlescript/gbc_cart.h"
).read_text()
```

Add a packer test proving a 12,800-byte art item remains in one bank.

- [ ] **Step 2: Run the builder test and verify RED**

Run:

```bash
python3 scripts/build_gbc_cart_test.py
```

Expected: failure because the art model/emitter and cart-entry ABI fields are
missing.

- [ ] **Step 3: Implement generated art and index metadata**

Add an immutable model:

```python
@dataclass(frozen=True)
class LauncherArt:
    bands: bytes
    progress_variant_count: int

@dataclass(frozen=True)
class CartIndexEntry:
    slug: str
    prefix: str
    title: str
    source_hash: int
    descriptor_bank: int
    session_bytes: int
    launcher_art_bank: int
    launcher_card: LauncherCard
```

Emit one `gNN_launcher_art.c` per game containing header band 0 followed by
progress variants. Compile it, add it as an unpinned `CartItem`, relocate it
with the existing packer, then use `dataclasses.replace()` to record its final
bank before generating `generated_cart.c`.

Extend `ps_gbc_cart_entry` with:

```c
uint8_t launcher_art_bank;
const uint8_t* launcher_art;
uint8_t launcher_progress_variant_count;
```

Make the generated index declare every art symbol and initialize these fields.
Record `launcher_art_bank`, `launcher_art_bytes`, and
`launcher_progress_variant_count` in each cart manifest game record.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
python3 scripts/build_gbc_cart_test.py
python3 scripts/check_gbc_cart_test.py
```

Expected: both scripts print `ok`.

- [ ] **Step 5: Commit art packing**

```bash
git add scripts/build_gbc_cart.py scripts/build_gbc_cart_test.py \
  native/include/puzzlescript/gbc_cart.h
git commit -m "Pack pre-rendered launcher art into GBC carts"
```

### Task 3: Add pure firmware progress and DMA planning

**Files:**
- Modify: `firmware/gbc/source/cart_launcher.h`
- Modify: `firmware/gbc/source/cart_launcher.c`
- Modify: `native/tests/gbc_cart_launcher.c`

- [ ] **Step 1: Write failing progress and split tests**

Add:

```c
failed |= require_true(
    ps_gbc_cart_launcher_progress_variant(
        &card, false, false, 0U) == 0U
        && ps_gbc_cart_launcher_progress_variant(
            &card, true, false, 1U) == 2U
        && ps_gbc_cart_launcher_progress_variant(
            &card, true, true, 0U) == 3U,
    "launcher progress did not select the pre-rendered variant");

count = ps_gbc_cart_launcher_transfer_plan(120U, false, spans);
failed |= require_true(
    count == 2U
        && spans[0].vram_bank == 0U
        && spans[0].tile == 120U
        && spans[0].tile_count == 8U
        && spans[1].tile == 128U
        && spans[1].source_tile == 8U
        && spans[1].tile_count == 32U,
    "signed tile wrap was not split");
```

Add equivalent checks for screen tile 240 crossing into VRAM bank 1 and screen
tile 280 mapping wholly into bank 1.

- [ ] **Step 2: Run the C test and verify RED**

Run:

```bash
cmake --build build --target puzzlescript_gbc_cart_launcher_tests
ctest --test-dir build -R '^puzzlescript_gbc_cart_launcher_tests$' \
  --output-on-failure
```

Expected: compile failure for the missing helpers/types.

- [ ] **Step 3: Implement the pure helpers**

Declare:

```c
typedef struct ps_gbc_launcher_transfer_span {
    uint8_t vram_bank;
    uint8_t tile;
    uint8_t source_tile;
    uint8_t tile_count;
} ps_gbc_launcher_transfer_span;

uint8_t ps_gbc_cart_launcher_progress_variant(
    const ps_gbc_launcher_card* card,
    bool has_save,
    bool completed,
    uint8_t level);
uint8_t ps_gbc_cart_launcher_transfer_plan(
    uint16_t first_screen_tile,
    bool unsigned_mode,
    ps_gbc_launcher_transfer_span spans[2]);
```

Progress variant 0 means `--`, unfinished variants equal the displayed board
number, and completion is `board_level_count + 1`. The transfer planner emits
40 tiles total and splits before signed tile 128 and screen tile 256.

- [ ] **Step 4: Run the C test and verify GREEN**

Run the same build and CTest commands. Expected: one passing test.

- [ ] **Step 5: Commit the pure firmware helpers**

```bash
git add firmware/gbc/source/cart_launcher.c \
  firmware/gbc/source/cart_launcher.h native/tests/gbc_cart_launcher.c
git commit -m "Plan GBC launcher art transfers"
```

### Task 4: Replace runtime page rasterization with pre-rendered DMA

**Files:**
- Modify: `firmware/gbc/source/game_dispatch.c`
- Modify: `firmware/gbc/source/game_dispatch.h`
- Modify: `firmware/gbc/source/text.c`
- Modify: `firmware/gbc/source/text.h`
- Modify: `firmware/gbc/source/main.c`

- [ ] **Step 1: Add a failing source/build regression**

Extend `scripts/build_gbc_cart_test.py` to assert the firmware source exposes a
separate page refresh and does not blank inside it:

```python
text_source = Path("firmware/gbc/source/text.c").read_text()
page_body = text_source.split("void updateCartLauncherPage(", 1)[1]
page_body = page_body.split("\\n}", 1)[0]
assert "DISPLAY_OFF" not in page_body
assert "displayOffForFullRewrite" not in page_body
assert "HDMA5_REG" in text_source
```

Run `python3 scripts/build_gbc_cart_test.py`; expected failure because
`updateCartLauncherPage` does not exist.

- [ ] **Step 2: Add fixed-bank ROM copy and aligned staging**

Expose:

```c
bool ps_gbc_rom_copy(
    uint8_t source_bank,
    const void* source,
    void* destination,
    uint16_t byte_count) NONBANKED;
```

Implement it through the existing `kMbc5Access` and `ps_gbc_bank_copy`.
Replace `gLauncherBand` with 655 bytes of storage and an aligned 640-byte view:

```c
static uint8_t gLauncherBandStorage[LAUNCHER_BAND_BYTES + 15U];
#define LAUNCHER_BAND ((uint8_t*)(
    ((uint16_t)gLauncherBandStorage + 15U) & 0xfff0U))
```

- [ ] **Step 3: Implement CGB DMA upload**

For each transfer span, set `VBK_REG`, derive the signed/unsigned destination
with `ps_gbc_cart_launcher_tile_data_address()`, program `HDMA1_REG` through
`HDMA5_REG`, and upload an integer number of 16-byte blocks from aligned WRAM.
Restore `VBK_REG` to bank 0.

- [ ] **Step 4: Load pre-rendered cards and headers**

Replace launcher card rasterization calls with:

```c
const uint8_t variant =
    ps_gbc_cart_launcher_progress_variant(
        &gLauncherCard, has_save, completed, level);
const uint8_t band = (uint8_t)(1U + variant);
ps_gbc_rom_copy(
    entry.launcher_art_bank,
    entry.launcher_art
        + (uint16_t)band * LAUNCHER_BAND_BYTES,
    LAUNCHER_BAND,
    LAUNCHER_BAND_BYTES);
uploadPreparedLauncherBand((uint8_t)(2U + row * 2U));
```

Header band 0 comes from the selected game's art. Add
`updateCartLauncherPage(selected, first_visible)`, which uploads target rows,
blank unused rows, uploads the header, loads palettes, and adds the selected
border without disabling the LCD or rewriting the tile maps.

Make `updateCartLauncherSelection()` use the pre-rendered header. Change the
Left/Right branch in `main.c` to call `updateCartLauncherPage()` instead of
`showCartLauncher()`.

- [ ] **Step 5: Build a nine-game autotest cart and verify firmware GREEN**

Run:

```bash
python3 scripts/build_gbc_cart.py \
  --repository . \
  --compiler build/native/puzzlescript_cpp \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --out build/gbc/cart-smoke \
  --limit 9 \
  --autotest
python3 scripts/check_gbc_cart.py \
  build/gbc/cart-smoke/puzzlescript-compilation-autotest-9.gb \
  build/gbc/cart-smoke/cart-manifest.json \
  build/gbc/cart-smoke/puzzlescript-compilation-autotest-9.map \
  build/gbc/cart-smoke/objects
```

Expected: successful link and all cart checks pass.

- [ ] **Step 6: Commit runtime DMA**

```bash
git add firmware/gbc/source/game_dispatch.c \
  firmware/gbc/source/game_dispatch.h firmware/gbc/source/text.c \
  firmware/gbc/source/text.h firmware/gbc/source/main.c \
  scripts/build_gbc_cart_test.py
git commit -m "Upload GBC launcher pages without blanking"
```

### Task 5: Prove one-frame LCD-on paging in mGBA

**Files:**
- Modify: `scripts/gbc_mgba_shim.c`
- Modify: `scripts/run_gbc_smoke.py`
- Modify: `scripts/run_gbc_cart_smoke.py`
- Modify: `scripts/run_gbc_cart_smoke_test.py`
- Modify: `Makefile`

- [ ] **Step 1: Write failing smoke-script tests**

Change the key script to page Right to game 8, launch it, execute one gameplay
input, return, page Left, move Down, and launch game 1. Assert exact key frames
and expected telemetry `8,1`.

Add a pure trace validator test:

```python
run_gbc_cart_smoke.validate_page_trace(
    lcdc=[0xC1] * 20,
    hashes=[1] * 10 + [2] * 10,
    input_frame=9,
    stable_frame=10,
    comparison_frame=15,
)
```

Reject a trace containing `0x41` or a changing hash after `stable_frame`.

- [ ] **Step 2: Run the smoke unit test and verify RED**

Run:

```bash
python3 scripts/run_gbc_cart_smoke_test.py
```

Expected: failure because trace validation and the page-changing script are
missing.

- [ ] **Step 3: Add bounded per-frame trace accessors**

Bump `PSGBC_ABI_VERSION`. Store up to 2048 LCDC values and FNV-1a hashes of both
VRAM banks plus all CGB background palette bytes after each `runFrame()`. Expose:

```c
unsigned psgbc_frame_trace_count(void);
unsigned psgbc_frame_lcdc(unsigned frame);
uint32_t psgbc_frame_background_hash(unsigned frame);
```

Declare their return types in `run_gbc_smoke.load_libmgba_shim()`.

- [ ] **Step 4: Enforce paging timing in cart smoke**

Build nine games in `gbc_cart_smoke`. In `run_smoke()`, validate the Right and
Left trace windows: LCDC bit 7 stays set, the target hash is stable by the frame
after input, and it remains stable until the next scripted input. Keep the
existing gameplay lifecycle, distinct hash, final LCD, and warning checks.

- [ ] **Step 5: Run the smoke unit and emulator tests**

Run:

```bash
python3 scripts/run_gbc_cart_smoke_test.py
make gbc_cart_smoke GBDK_HOME=.codex_tmp/toolchains/gbdk
```

Expected: unit script prints `ok`; smoke reports games `8,1`, LCDC `0xc1`,
stable one-frame page traces, two launches, one return, and no warning-limit
failure.

- [ ] **Step 6: Commit emulator regression coverage**

```bash
git add scripts/gbc_mgba_shim.c scripts/run_gbc_smoke.py \
  scripts/run_gbc_cart_smoke.py scripts/run_gbc_cart_smoke_test.py Makefile
git commit -m "Test one-frame GBC launcher paging"
```

### Task 6: Rebuild and deliver the 46-game cart

**Files:**
- Modify: `build/gbc/cart/cart-manifest.json`
- Modify: `build/gbc/cart/puzzlescript-compilation-46.gb`

- [ ] **Step 1: Run focused and native regression tests**

```bash
python3 scripts/build_gbc_cart_test.py
python3 scripts/run_gbc_cart_smoke_test.py
cmake --build build
ctest --test-dir build -R '^puzzlescript_gbc_' --output-on-failure
```

Expected: all commands pass.

- [ ] **Step 2: Build and check the production cart**

```bash
make gbc_cart GBDK_HOME=.codex_tmp/toolchains/gbdk
```

Expected: 46 unique games, all specialized, all bank/header/HOME checks pass,
and the ROM remains exactly 4,194,304 bytes.

- [ ] **Step 3: Run production timing and gameplay QA**

Run the mGBA page trace against the production ROM for page 1 to page 2 and
back, then launch games from both pages and execute an input. Expected: every
page trace keeps LCDC bit 7 set, each target page stabilizes by the next frame,
and gameplay remains at the normal idle PC rather than crashing.

- [ ] **Step 4: Run the full PuzzleScript regression suite**

```bash
node src/tests/run_tests_node.js
```

Expected: all simulation and compilation-error tests pass.

- [ ] **Step 5: Verify repository state and artifact identity**

```bash
git diff --check
shasum -a 256 build/gbc/cart/puzzlescript-compilation-46.gb
git status --short
```

Expected: only intended source, plan, manifest, and ROM changes; no whitespace
errors; one SHA-256 is printed for handoff.

- [ ] **Step 6: Commit and push**

```bash
git add -u
git add -f build/gbc/cart/cart-manifest.json \
  build/gbc/cart/puzzlescript-compilation-46.gb
git commit -m "Make GBC launcher paging instant"
git push origin master
```

Expected: `master` and `origin/master` point at the final commit.
