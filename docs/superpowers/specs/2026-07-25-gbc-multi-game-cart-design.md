# GBC multi-game cart — design

Date: 2026-07-25
Status: approved design, not yet planned or implemented

## Goal

Ship one Game Boy Color cartridge that holds every GBC-eligible PuzzleScript
game, fronted by a launcher that lets the player pick one. Every game on the
cart uses its specialized turn codegen — there is no interpreter fallback.

## Why this is not just a bigger ROM

Cart capacity is not the constraint. Measured from the fourteen built eligible
ROMs' link maps:

| Cost | Per game | Range |
| --- | ---: | --- |
| Game data (`generated_game.o`) | ~2.4 KiB | 1,428 B – 3,950 B |
| Specialized turn code + façade | ~25.5 KiB | 9.5 KiB – 75 KiB |

Thirty-two games therefore need roughly 1 MB. The blockers are architectural:

1. **HOME is full.** Bank 0 measures 15,312–16,262 bytes against a 16,384 cap.
   Three otherwise-exportable games were rejected purely on HOME overflow.
2. **The build is monomorphized per game.** `core.c` compiles against
   `generated_game.h` macros — `OBJECT_BYTES_PER_CELL`,
   `MOVEMENT_BYTES_PER_CELL`, mask typedefs, packed-pattern flags. There is no
   single interpreter binary that can run two different games.
3. **Banked calls cap at 4 MB.** GBDK documents that `SWITCH_ROM_MBC5_8M` is
   incompatible with banked SDCC calls, so the 8 MB MBC5 ceiling is unreachable
   while the specialized code relies on `BANKED` dispatch.

HOME composition today, from the object files:

| Module | HOME bytes |
| --- | ---: |
| `core.o` (`_CODE` + `_HOME`) | 12,277 |
| `main.o` | 2,305 |
| GBDK runtime (div/mul/memcpy/palette) | ~900 |
| header | ~330 |

`audio.o`, `text.o`, `tile_cache.o` and `frontend_flow.o` are already banked, so
the launcher does not need HOME space for its rendering. `core.c` is what
squats there.

Note that `core.c` already `#ifdef`s out the generic rule interpreter when
`PS_GBC_HAS_SPECIALIZED_TURN` is defined (lines 573–910, 1171–1237, 1239+).
Because every game on this cart is specialized, that code is already absent; the
remaining 12.3 KiB is session init, level load, render feed, undo/snapshot and
movement resolve.

## Cart shape

MBC5, cart type `0x1B` (MBC5+RAM+BATTERY), CGB-only. **Hard cap 255 ROM banks
(4 MB)** so `BANKED` calls keep working. Thirty-two games land near 64 banks.

| Region | Contents |
| --- | --- |
| Bank 0 (HOME, 16 KiB) | boot, main loop, input, VRAM/tilemap/palette plumbing, SRAM framing, bank dispatch, launcher trampoline, width-agnostic half of `core.c` |
| Launcher bank | menu code and the launcher cards for every game |
| Shared firmware banks | `audio`, `text`, `tile_cache`, `frontend_flow` |
| Per-game banks | game data, façade, specialized turn packs, width-coupled core slice |

## Splitting core.c

The split follows the width boundary, so each game keeps its own optimal object
and movement widths. Widths vary meaningfully across the corpus: eleven of the
fourteen measured games use 1-byte object masks, `short-adventure` uses 2 bytes
(13 objects), and `voitex-rasteriser` and `slot-machine` use 4 bytes (17 and 20
objects). Forcing a cart-wide width would tax thirty games to accommodate two.

**Stays in HOME (width-agnostic):** frame loop, input polling, tilemap and
palette writes, SRAM save framing, banking helpers, launcher dispatch.

**Moves to the game's bank (width-coupled):** board cell access, movement plane
access, snapshot and restore, level load, render feed, turn entry, resolve, won.

The interface is a per-game descriptor holding the game's bank number and
function pointers into it. HOME switches to the game's bank and calls through
the pointer. Calls back into HOME from a banked game are safe because HOME is
permanently mapped — this is exactly why the earlier attempt to place
specialized code in bank 2 hung when it called non-`NONBANKED` core helpers, and
this layout removes the hazard rather than working around it. Cross-pack calls
within a single game continue to use ordinary `BANKED` calls, which save and
restore the bank.

## WRAM arena

One `gArena` declared in HOME, sized to the maximum requirement over the games
on the cart. Each game's descriptor declares its arena size and its internal
offsets — board, movement plane, dirty bitset, match bitset. Games choose their
own layout within the arena.

**Hygiene gate:** generated translation units must contribute zero bytes to
`_DATA` and `_BSS`. Today `generated_specialized_turn.o` contributes 12 bytes of
`_DATA`; those move into the arena. The link check fails the build otherwise,
because per-game statics would otherwise sum across all games rather than
sharing one arena.

Existing budgets hold: static WRAM ≤ 6 KiB, hot state < 4 KiB. Measured static
WRAM today is 1,565–1,928 bytes per game, so the maximum over a 32-game cart has
ample margin.

## SRAM

32 KiB across four 8 KiB banks.

**Bank 0** holds a cart header (magic, format version, game count), one progress
slot per game, and the launcher's cursor and scroll offset. A slot is about 8
bytes — level reached, completion flag, checksum — so 32 games cost 256 bytes
and the full 178-game corpus would still fit. Each slot is keyed by the game's
`source_hash`, already present in the manifest, so re-exporting one game
invalidates only that game's save.

**Bank 1** holds the active game's undo ring and checkpoint snapshot, as today,
tagged with the active game index so a snapshot left behind by a different game
is rejected on load.

Persisting the launcher cursor in SRAM means returning from a game lands on the
same entry regardless of what the game did to WRAM.

## Launcher

Eight full-width entry rows, 16 px tall. The screen is 18 tile rows, so a 2-row
header plus eight 2-row entries fits exactly, and eight entries is precisely the
Game Boy Color's cap of 8 background palettes.

```
+------------------------------------+
|  PUZZLESCRIPT             6 / 32   |  header, selected game's palette
+====================================+
| [@@] dollyban              12/20 |#|  pal 0   scrollbar column
| [@@] fickle fred            DONE |#|  pal 1   uses each row's
| [@@] gapfiller              3/15 | |  pal 2   own palette
|+----------------------------------+|
||[@@] i am a gust of wind      -- | ||  pal 3  <- 1px border = selected
|+----------------------------------+|
| [@@] no forbidden symbols   8/12 | |  pal 4
| [@@] push pull               1/9 | |  pal 5
| [@@] pushit                   -- | |  pal 6
| [@@] pushy-v pully-h       5/5 * | |  pal 7
+------------------------------------+
  A launch   up/down row   L/R page
```

Each row is decorated with the game's own material: its background object tiled
across the row, its player sprite at the left, its title in `text_color`, and
its progress from SRAM. The header adopts the selected row's palette rather than
spending a ninth.

**Per-row palette (4 colours):** `background_color`, background object detail,
player primary, `text_color`. When a game's background object or player sprite
needs more colours than this affords, the exporter reduces detail colours first
and records the reduction in the manifest — the same discipline the exporter
already applies to in-game palettes.

**Text legibility:** the title is drawn in `text_color` with a 1 px outline in
`background_color`, so it reads over any background pattern. One font serves
every row: glyph pixels take the palette's foreground index and the outline
takes the background index, so each row's palette recolours the same tiles.

`text.c` builds the font at runtime from 5×7 glyphs into 8×8 tiles; a 5×7 glyph
plus a 1 px outline is 7×9, one pixel too tall for a single tile. Since each row
is 16 px, the outlined glyph sits at y ≈ 3–11 straddling the tile boundary. The
launcher composes the title band per row at load time by copying the game's
background pattern into a scratch tile buffer and OR-ing in glyph and outline.
That is about 28 composed tiles per row, 224 for all eight visible rows, plus 64
for player and pattern tiles — 288 of the 512 addressable background tiles.
Scrolling one row recomposes one row, roughly 450 bytes.

**Controls:** up/down moves one row, left/right pages, A launches. From a
launched game's title screen, B or Select returns to the launcher. The title
screen is an already-defined state, so no session teardown is required and the
arena is only ever re-initialised at launch.

**Launcher cards.** The exporter pre-bakes one card per game — title, 4-colour
palette, background tile, player tile, source hash, descriptor pointer — about
165 bytes each, roughly 5 KiB for 32 games, all in the launcher bank so cursor
movement never switches banks. `ps_game_background_color` and `text_color` exist
in the compiler but are not currently carried into the GBC export; adding them
is part of this work. `ps_gbc_game.title` already exists.

## Build flow

A cart manifest in the shape of today's `ELIGIBLE_GAMES`, plus
`scripts/build_gbc_cart.py`, which:

1. exports each game with a bank base offset;
2. bin-packs translation units into banks — today's one-TU-per-bank layout
   wastes roughly 40% of each bank;
3. emits the game descriptor table and the launcher card table;
4. links once;
5. runs the cart gates.

The exporter needs a way to emit at a bank base — either a `--bank-base N` flag
or bank-relative output with a post-pass that rewrites `#pragma bank`.

**Gates (`scripts/check_gbc_cart.py`):**

- HOME ≤ 16 KiB
- every bank ≤ 16 KiB
- total ROM ≤ 4 MB and ≤ 255 banks
- maximum arena over all games within the WRAM budget
- zero `_DATA`/`_BSS` from generated translation units
- every game specialized — build fails otherwise, consistent with the retired
  interpreter fallback

## Testing

Single-game ROM builds and their autotest harness continue to work unchanged.

New cart smoke test under mGBA: boot to the launcher, navigate to a game,
launch it, replay its existing solution fixture, return via the title screen,
launch a different game, and verify its replay is unaffected. Cross-game
contamination through the shared arena or stale SRAM snapshots is the failure
mode this architecture is most exposed to, so the test exercises it directly.

**Parity gate:** a game's solution replay on the cart must produce the same
result as its standalone ROM.

## Out of scope

Widening GBC eligibility beyond the current 32 games. Of 178 games in
`good_games`, 35 export OK and 32 are ROM-validated; the rejects are board
cull-all (54), object count above 32 (27), multi-row rules (19), dynamic
replacements (19), and a long tail. That work proceeds separately and this cart
picks up whatever is eligible when it is built.

The three games that failed promotion solely on HOME overflow —
`an-ok-multiban-level`, `head-skuller`, `the-red-ring-of-immortality` — may
become eligible as a side effect of moving width-coupled code out of HOME, but
confirming that is follow-up work, not a goal here.
