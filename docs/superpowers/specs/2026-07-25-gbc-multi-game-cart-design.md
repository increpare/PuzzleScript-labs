# GBC multi-game cart — design

Date: 2026-07-25
Status: approved, including the HOME bank-access bridge amendment reviewed
2026-07-26

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

Forty-six games therefore need roughly 1.3 MB. The blockers are architectural:

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
(4 MB)** so `BANKED` calls keep working. Forty-six games land near 1.85 MB
(~118 banks): ~1.3 MB of data and specialized code plus ~552 KiB of per-game core.

| Region | Contents |
| --- | --- |
| Bank 0 (HOME, 16 KiB) | boot, main loop, input, VRAM/tilemap/palette plumbing, SRAM framing, bank dispatch, launcher trampoline, ROM bank-access bridge |
| Launcher bank | menu code and the launcher cards for every game |
| Shared firmware banks | `audio`, `text`, `tile_cache`, `frontend_flow` |
| Per-game banks | one co-located game-data/private-core bank, façade, specialized turn packs |

MBC5 exposes only one switchable 16 KiB ROM window. Code running in one
switchable bank therefore cannot directly dereference data in another
switchable bank. This is a hard ownership boundary, not merely a linker-layout
detail:

- a private `core.c` and its `generated_game` data share the same computed
  per-game bank;
- shared firmware never directly references a per-game symbol or follows a
  pointer into a per-game bank;
- specialized turn packs contain the constants they need and do not read the
  generated game view across banks;
- HOME is permanently mapped and owns the only code allowed to switch banks in
  order to copy game-owned ROM data for shared firmware.

## Per-game core

Each game carries its **own private copy of `core.c`**, compiled with its own
width macros into the same bank as its generated game data. `core.c` is not
split. HOME keeps only `main.c`, the GBDK runtime, the bank dispatch, the
launcher trampoline and the bank-access bridge. The foundation gate is HOME
≤ 8 KiB, preserving at least 8 KiB for the launcher and future fixed-bank
stubs; the earlier measured target without the bridge was about 4 KiB.

This keeps each game's optimal object and movement widths, which vary
meaningfully across the corpus: eleven of the fourteen measured games use 1-byte
object masks, `short-adventure` uses 2 bytes (13 objects), and
`voitex-rasteriser` and `slot-machine` use 4 bytes (17 and 20 objects). Forcing
a cart-wide width would tax thirty games to accommodate two.

The cost is ROM: `core.o` is 12,277 bytes, so 46 games carry about 552 KiB of
duplicated core — 13% of the 4 MB cap, on top of the ~1.3 MB already projected.
Splitting `core.c` along the width boundary would recover roughly 6 KiB per game
but requires deriving that boundary function by function through a 1,522-line
file, and is not worth the breakage risk at this ROM budget.

`ps_gbc_resolve_movements` (`core.c:954`) is currently `NONBANKED` so the
specialized packs can call it while their own bank is mapped. Moving `core.c`
into the game's banks removes that guarantee, so the specialized packs call it
as an ordinary `BANKED` call, which saves and restores the bank.

**Symbol namespacing.** Forty-six copies of `ps_gbc_step`,
`ps_gbc_generated_game` and every other file-scope name collide at link time.
Every per-game translation unit — generated files and the game's `core.c` alike
— is compiled through a generated namespace header that `#define`s each exported
name to a per-game prefix (`g07_ps_gbc_step`).

**Dispatch.** A per-game descriptor holds the game's bank numbers, generated
game-view pointer, render-table pointers, required arena size and function
pointers. Launcher descriptors may live in launcher ROM, but HOME copies the
selected descriptor into a single WRAM `active_game` value before launch. HOME
and shared firmware must not retain a raw pointer to a descriptor in a
switchable ROM bank.

HOME switches to the game's core/data bank and calls through the copied
function pointer. Calls back into HOME from a banked game are safe because HOME
is permanently mapped — this is exactly why the earlier attempt to place
specialized code in bank 2 hung when it called non-`NONBANKED` core helpers, and
this layout removes the hazard rather than working around it. Cross-bank calls
within a single game use ordinary `BANKED` calls.

## HOME bank-access bridge

Shared `audio`, `text`, `tile_cache`, `frontend_flow`, autotest and benchmark
code runs with its own switchable bank mapped. It must treat every pointer in
`active_game` as an opaque ROM address. A small `NONBANKED` bridge in HOME
provides bounded operations that:

1. save the currently mapped MBC5 bank;
2. map `active_game.game_bank`;
3. copy a scalar, byte range or NUL-terminated string from game ROM into a
   caller-owned WRAM destination;
4. restore the previous bank on every return path.

The bridge never returns a dereferenceable game-ROM pointer. A zero-length copy
is a no-op; a non-zero copy with a null source or destination fails without
changing the mapped bank. String copies take a destination capacity, always
NUL-terminate when capacity is non-zero, and report whether the source fit.
Generated ROM is trusted after export validation, so the bridge does not try to
discover arbitrary ROM bounds at runtime.

The first consumers use the bridge at coarse granularity:

- `audio` copies the named-sound ID and selected seed into scalars before
  starting playback;
- `text` copies the UI palette and title, author or message into one reusable
  256-byte WRAM staging buffer before rendering;
- `tile_cache` copies render-object descriptors, sprite pixels, palette-remap
  slices and precomposed tile records into its existing WRAM scratch buffers;
- autotest and benchmark helpers copy the fields and table entries they inspect
  rather than bypassing the production boundary.

The text renderer displays at most eleven 16-character rows, so the 256-byte
staging buffer exceeds the visible payload. The exporter still records an error
if a source string cannot fit: silent runtime truncation is not an accepted
export.

`main.c` may directly inspect game ROM only inside an explicit interval where
HOME has mapped `active_game.game_bank`. A banked call ends that interval because
the call may remap the switchable window. After such a call, HOME must remap the
game bank before another direct read. This rule is enforced structurally rather
than depending on a caller remembering which bank happened to be left mapped.

## WRAM arena

`main.c:38` already declares `gSessionArena[PS_GBC_GENERATED_SESSION_BYTES]`,
and `ps_gbc_session_init(arena, size, …)` already places the entire session
inside it. The cart sizes that one array to the maximum requirement over the
games it contains; each game's descriptor carries its own required size, and
`ps_gbc_session_init` continues to lay out board, movement plane, dirty bitset
and player cells within it.

**Hygiene gate:** generated translation units must contribute zero bytes to
`_DATA` and `_BSS`. Today `generated_specialized_turn.o` contributes 12 bytes of
`_DATA`; those move into the arena. The link check fails the build otherwise,
because per-game statics would otherwise sum across all games rather than
sharing one arena.

Existing budgets hold: static WRAM ≤ 6 KiB, hot state < 4 KiB. Measured static
WRAM today is 1,565–1,928 bytes per game, so the maximum over a 46-game cart has
ample margin for the copied active descriptor and reusable 256-byte text
buffer. The bridge must reuse the existing tile-cache scratch buffers rather
than add a second sprite/tile working set.

## SRAM

32 KiB across four 8 KiB banks.

**Bank 0** holds a cart header (magic, format version, game count), one progress
slot per game, and the launcher's cursor and scroll offset. A slot is about 8
bytes — level reached, completion flag, checksum — so 46 games cost 368 bytes
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
|  PUZZLESCRIPT             6 / 46   |  header, selected game's palette
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
palette, background tile, player tile, source hash, descriptor-table index —
about 165 bytes each, roughly 7.4 KiB for 46 games, all in the launcher bank so
cursor movement never switches banks. `ps_game_background_color` and
`text_color` exist in the compiler but are not currently carried into the GBC
export; adding them is part of this work. `ps_gbc_game_view.title` already
exists.

## Build flow

A cart manifest in the shape of today's `ELIGIBLE_GAMES`, plus
`scripts/build_gbc_cart.py`, which:

1. reserves bank 1 for cart-global shared firmware and exports each game with a
   computed bank base (bank 2 for the first standalone/foundation build);
2. bin-packs translation units into banks — today's one-TU-per-bank layout
   wastes roughly 40% of each bank;
3. emits the game descriptor table and the launcher card table;
4. links once;
5. runs the cart gates.

The exporter emits an explicit bank manifest. At a game's base, the first bank
contains that game's generated data and private core together; the following
banks contain its façade and specialized packs. The manifest also reports the
first unused bank so the cart builder can allocate the next game without
reverse-engineering generated pragmas. No per-game range may overlap the shared
firmware or another game.

**Gates (`scripts/check_gbc_cart.py`):**

- HOME ≤ 8 KiB during the foundation phase (the hardware limit remains 16 KiB)
- every bank ≤ 16 KiB
- total ROM ≤ 4 MB and ≤ 255 banks
- maximum arena over all games within the WRAM budget
- zero `_DATA`/`_BSS` from generated translation units
- zero direct references from shared firmware, autotest or benchmark objects to
  `ps_gbc_generated_*` symbols or namespaced per-game equivalents
- each game-data symbol and its private core functions occupy the same bank
- every game specialized — build fails otherwise, consistent with the retired
  interpreter fallback

## Testing

Single-game ROMs use the same separated layout as carts: bank 1 holds shared
firmware, bank 2 is the default game/core base, and later banks hold the façade
and specialized packs. The existing headless libmGBA smoke must pass both at
that default base and at a deliberately non-default base (for example bank 7).
The non-default build is the regression that proves shared firmware is reading
through the bridge rather than succeeding accidentally because of a fixed bank.

New cart smoke test under mGBA: boot to the launcher, navigate to a game,
launch it, replay its existing solution fixture, return via the title screen,
launch a different game, and verify its replay is unaffected. Cross-game
contamination through the shared arena or stale SRAM snapshots is the failure
mode this architecture is most exposed to, so the test exercises it directly.

**Parity gate:** a game's solution replay on the cart must produce the same
result as its standalone ROM.

Host tests cover zero-length/null rejection, exact copies, string termination,
fit reporting and restoration of the previously selected bank. Exporter and
link-map tests cover the bank manifest, non-overlap, game/core co-location, HOME
budget and the absence of forbidden cross-bank symbol references. Live emulator
coverage is required because the failed bank-11 prototype compiled and linked
successfully but returned a null session only when the ROM ran.

## Out of scope

Widening GBC eligibility beyond the games already in `ELIGIBLE_GAMES`, which
holds 46 as of 2026-07-25 and is still growing. Of the 178 games in
`good_games`, the rejects are board cull-all (54), object count above 32 (27),
multi-row rules (19), dynamic replacements (19), and a long tail. That work
proceeds separately and this cart picks up whatever is eligible when it is
built — the cart's build reads `ELIGIBLE_GAMES` rather than a fixed count.

The three games that failed promotion solely on HOME overflow —
`an-ok-multiban-level`, `head-skuller`, `the-red-ring-of-immortality` — may
become eligible as a side effect of moving width-coupled code out of HOME, but
confirming that is follow-up work, not a goal here.
