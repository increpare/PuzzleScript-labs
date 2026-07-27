# GBC launcher instant page switching — design

Date: 2026-07-27
Status: approved approach; awaiting written-spec review

## Goal

Make Left/Right page changes in the 46-game GBC launcher appear immediate.
The LCD must remain enabled, the screen must not flash black, and the complete
target page must be visible by the next emulated frame. The launcher keeps its
current card styling, title bar, selection border, scrollbar, and SRAM-backed
progress display.

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
  completion (`DONE`).

The card bands retain the game's tiled background object, player sprite,
outlined title, progress text, and the scrollbar pixels for the game's fixed
page and row. Selection is deliberately excluded: the existing small
selection-line updater adds or removes that border in VRAM.

The 46 games contain 293 board levels, producing 385 card variants. At 640
bytes per band, the card variants cost 246,400 bytes. The 46 headers add 29,440
bytes. The total is about 270 KiB, well inside the 4 MiB MBC5 ROM and the
current cart's unused bank budget.

## Bank packing and ABI

The builder emits one launcher-art object per game. A game with the maximum 17
board levels needs 20 bands—one header plus 19 card states—or 12,800 bytes, so
every game's launcher art fits wholly inside one 16 KiB bank.

Launcher-art objects participate in the existing cart bank packer. They do not
need to share a bank with their game. Each cart index entry records the art
bank, the base ROM pointer, and the number of progress variants. The generated
cart ABI exposes bounded copy access rather than leaving bank ownership implicit.

Runtime progress maps to an asset index as follows:

- invalid or absent save: variant 0;
- valid unfinished save: variants 1 through `board_level_count`, using the
  existing level bitmap to map message levels to the displayed board number;
- completion marker: variant `board_level_count + 1`.

The builder rejects a band count that cannot fit one bank, a malformed launcher
card, or generated art whose size differs from the declared variant count.

## Runtime transfer

The runtime uses one 16-byte-aligned 640-byte WRAM staging band. A fixed-bank
helper temporarily maps the selected art bank, copies one pre-rendered band to
WRAM, restores the caller's ROM bank, and starts CGB general-purpose VRAM DMA.
Transfers split where the signed background tile address wraps at tile 128 and
where launcher tiles move from VRAM bank 0 to bank 1.

On a page change the launcher:

1. reads progress for the eight target games and selects their card variants;
2. uploads the eight pre-rendered rows without disabling the LCD;
3. uploads the selected game's pre-rendered header;
4. loads the eight row palettes and selected header palette;
5. applies the selected row's border and leaves the launcher input loop ready
   for the next frame.

The tile map layout and attribute layout remain stable across pages, so the
page path does not rewrite the full 20-by-18 maps. The final short page uploads
blank bands for unused rows.

Initial launcher display uses the same assets. Up/Down keeps the existing
incremental border update but replaces runtime header-counter rasterization
with the selected game's pre-rendered header, eliminating that avoidable work
as well.

## Tests and acceptance

Builder tests cover deterministic header/card rasterization, progress-variant
ordering, per-game asset sizing, generated ABI fields, and bank packing.
Firmware unit tests cover progress-to-variant mapping and every DMA split at
tile 128 and the VRAM-bank boundary.

The cart smoke path adds Left and Right inputs and records per-frame LCDC plus
the visible launcher page. It must prove:

- LCDC bit 7 remains set on every sampled frame;
- the complete target page is visible no later than the frame after input;
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
