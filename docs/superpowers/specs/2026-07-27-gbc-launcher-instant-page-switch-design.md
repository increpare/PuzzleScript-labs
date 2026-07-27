# GBC launcher instant page switching — design

Date: 2026-07-27
Status: implemented and verified

## Goal

Make Left/Right page changes in the 46-game GBC launcher appear immediate.
The LCD must remain enabled, the screen must not flash black, and the complete
target page must be visible within one display scan. The launcher keeps its
current card styling, white title bar with black text, selection border,
scrollbar, and SRAM-backed progress display.

## Confirmed cause

The production ROM disables the LCD before `showCartLauncher()` rebuilds the
header and eight 160-by-16 card bands. Each title and progress label is
rasterized on the Game Boy CPU from 5-by-7 glyphs, including its one-pixel
outline, then blended pixel-by-pixel over the selected game's background tile.

An mGBA reproduction presses Right at frame 100. LCDC changes from `0xc1` to
`0x41` at frame 102 and does not return to `0xc1` until frame 148. Program
counter samples during those 46 blank frames are concentrated in the launcher
band preparation and glyph rasterization code. The page-selection arithmetic
is not the bottleneck.

Keeping the LCD on around this work would remove the black frame but preserve
the roughly 0.77-second delay and reveal a partial row-by-row redraw. The
expensive rasterization must leave the cartridge runtime.

## Build-time launcher assets

The cart builder will reproduce the existing launcher rasterizer and emit ready
to upload 2bpp bands.

Each game contributes:

- one 160-by-16 header band containing `PUZZLESCRIPT` and that game's
  `n / 46` counter;
- one unselected 160-by-16 card band for each distinct progress state:
  no save (`--`), board positions `1/total` through `total/total`, and
  completion (`DONE`);
- one selected-border version of every progress-state card.

The card bands retain the game's tiled background object, player sprite,
outlined title, progress text, and the scrollbar pixels for the game's fixed
page and row. Selected variants include the border at build time so page
changes never need scattered per-tile VRAM writes.

The 46 games contain 293 board levels, producing 385 card variants in each
selection state. At 640 bytes per band, both card sets cost 492,800 bytes. The
46 headers add 29,440 bytes. The total remains well inside the 4 MiB MBC5 ROM
and the current cart's unused bank budget.

## Bank packing and ABI

The builder emits two launcher-art objects per game: headers plus unselected
cards, and selected cards. A game with the maximum 17 board levels needs 20
ordinary bands (12,800 bytes) and 19 selected bands (12,160 bytes), so each
object fits wholly inside one 16 KiB bank.

Launcher-art objects participate in the existing cart bank packer. They do not
need to share a bank with their game or each other. Each cart index entry
records both art banks, both base ROM pointers, and the number of progress
variants. The generated cart ABI exposes explicit bank ownership.

Runtime progress maps to an asset index as follows:

- invalid or absent save: variant 0;
- valid unfinished save: variants 1 through `board_level_count`, using the
  existing level bitmap to map message levels to the displayed board number;
- completion marker: variant `board_level_count + 1`.

The builder rejects a band count that cannot fit one bank, a malformed launcher
card, or generated art whose size differs from the declared variant count.

## Runtime transfer

Initial launcher display caches every game's ordinary/selected art banks,
header/card pointers, palette, and background tile while the LCD is already
off. Page changes therefore do not repeat cart-index or SRAM metadata lookups
for each visible row. Ordinary and selected cards transfer directly from their
banked ROM objects; a 16-byte-aligned zero band supplies unused rows.

A fixed-bank helper maps the selected art bank and keeps it mapped while a
bounded transfer scheduler uploads each band. Transfers split where the signed
background tile address wraps at tile 128 and where launcher tiles move from
VRAM bank 0 to bank 1.

A complete page contains 360 16-byte blocks, which cannot fit in the CGB's
4,560-dot VBlank. The 40-block header uploads in the starting VBlank. The
scheduler then transfers at most four blocks (64 bytes) after each fresh Mode
0 begins. Four blocks take about 32 microseconds and fit within the worst-case
Mode 0 plus following Mode 2 window. When VBlank begins again, the remaining
tail is finished with general-purpose DMA. A visible-scan latch prevents any
later span from treating that VBlank as a new starting window. Interrupts stay
disabled and each DMA completion is observed before the ROM bank is restored
or another transfer is programmed.

On a page change the launcher:

1. selects cached progress variants for the eight target games;
2. uploads the selected header and its tile attributes in the starting VBlank;
3. streams all eight rows from top to bottom without disabling the LCD;
4. uploads deterministic blank bands and palettes for unused rows;
5. loads the row palettes while retaining the shared white title palette and
   the selected row's pre-rendered border.

The tile map layout remains stable across pages, so the page path does not
rewrite the full 20-by-18 map. The header's 20-by-2 attributes are refreshed
in VBlank because the selected palette slot can change on a short final page.
The final short page uploads blank bands for unused rows.

Initial launcher display uses the same assets. Up/Down keeps the existing
incremental border update but replaces runtime header-counter rasterization
with the selected game's pre-rendered header, eliminating that avoidable work
as well.

## Tests and acceptance

Builder tests cover deterministic header/card rasterization, progress-variant
ordering, per-game asset sizing, generated ABI fields, and bank packing.
Firmware unit tests cover progress-to-variant mapping and every DMA split at
tile 128 and the VRAM-bank boundary.

The cart smoke path adds Left and Right inputs and records per-frame LCDC,
visible launcher state, and page-DMA telemetry. It must prove:

- LCDC bit 7 remains set on every sampled frame;
- the page update starts in VBlank and completes within one display scan;
- no more than 142 blocks (2,272 bytes) remain for the final VBlank tail;
- the complete target page is stable at the first post-scan sample;
- Right then Left preserves the selected row and returns to the original page;
- titles, progress, palettes, selection border, and the white header with black
  text match the current launcher;
- launching games before and after paging still selects the intended distinct
  game and gameplay rules still execute.

The normal GBC native tests, full 46-game cart checker, cart smoke test, and
PuzzleScript Node test suite remain required before the ROM is committed and
pushed.

## Non-goals

This change does not redesign the launcher, alter game order, change save
format, add background sprites to games that define no background sprite, or
change the in-game renderer. It replaces only the launcher's expensive runtime
card rasterization and full page rewrite.
