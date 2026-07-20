# Game Boy Color optimization ledger

This ledger records retained and rejected GBC performance experiments. Each
experiment is isolated, tested for native/GBC parity, measured on the fixed
suite below, and committed separately when retained. Optimization commit
messages include the headline speed and memory deltas.

## Measurement protocol

- Emulator: mGBA SDL 0.10.5, CGB-only cartridge, CGB double-speed mode.
- Timing source: emulated CGB 4096 Hz hardware timer.
- Repetitions: three complete emulator boots; every counter must be identical.
- Logic sample: 128 alternating right/left turns on the first board level.
- Rendering sample: four frames, plus isolated composition, tile upload,
  tile-map upload, palette upload, and repeated text-screen timings.
- Memory: exporter session/SRAM/game-bank estimates plus linked benchmark ROM
  map usage.
- Correctness gate: focused GBC tests and mGBA render smoke for every experiment;
  all native/C++ tests and the compatible-game cartridge audit before milestone
  commits.
- Desktop gate: generic C++ changes also run the 64-bit simulation and solver
  suites against their immediately preceding commit.

The low-overhead total-timing ROM is the source of headline timings. A separate
`PERF_PHASES=1` ROM adds probes around snapshot, setup, early rules, movement,
late rules, commands, and win checks. Probe overhead is reported rather than
silently folded into the headline.

## Baseline

Target revision: `80ad5a59` (`Add bounded Game Boy Color target`).

| Case | Shape | Logic ticks/turn | Render ticks/frame | Composition | Session bytes | Snapshot SRAM | Game bank estimate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sokoban | 6 objects, 42 cells, 4 rules | 726.531 | 144243.250 | 143522.500 | 347 | 840 | 1494 |
| large_board | 6 objects, 210 cells, 8 rules | 2898.367 | 149350.250 | 148585.000 | 1208 | 4200 | 3797 |
| rule_heavy | 8 objects, 121 cells, 62 rules | 8761.008 | 150466.500 | 149773.250 | 752 | 2420 | 8617 |
| object_heavy | 20 objects, 72 cells, 33 rules | 14468.445 | 217342.500 | 216670.500 | 500 | 1440 | 5670 |
| two_movement_lanes | 17 objects, 121 cells, 37 rules | 10582.062 | 179742.000 | 179003.000 | 873 | 2420 | 5601 |

Tile upload is approximately 548 ticks/frame, map upload 98.5 ticks/frame, and
palette upload 4 ticks/frame in every case. Composition accounts for more than
99% of measured rendering time, so rendering experiments start there.

For Sokoban, phase probes increase whole-turn timing from 726.531 to 740.586
ticks/turn (+1.93%). The instrumented breakdown is:

| Phase | Ticks/turn |
| --- | ---: |
| Snapshot write | 50.078 |
| Setup/player movement seed | 45.109 |
| Early rules | 533.914 |
| Movement resolution | 51.039 |
| Late rules | 1.352 |
| Commands | 4.070 |
| Win check | 42.328 |

The machine-readable baseline is
[`gbc-baseline.json`](gbc-baseline.json).

## Experiment queue

1. Dirty-cell rendering.
2. Composite-tile deduplication.
3. Preconverted 8x8 2bpp sprites.
4. Stable palette, map, and font uploads.
5. Narrow 8/16/32-bit object storage.
6. Immutable static-object plane.
7. Delta or lazy undo snapshots.
8. Board-mask rule prechecks.
9. Rule read/write dependency scheduling.
10. Direct match-bit enumeration.
11. Generated specialization for common rule shapes.
12. Statically impossible/no-op rule removal.
13. Work-queue or dependency-based movement resolution.
14. Incremental player and win-condition indexes.
15. Packed pattern records.
16. Compressed level data.
17. Multi-bank generated data.

## Results

### 1. Dirty-cell rendering — retained

Revision under test: working tree after `3127c71a`.

The runtime keeps one dirty bit per maximum board cell. Rule replacements mark
cells only when their object masks change; movement marks its source and target;
load, restart, and undo mark the whole board. The renderer still performs a
full first/level-transition redraw, but normal turns only recompose and upload
marked board cells. Palette and full map uploads remain unchanged for a later
isolated experiment.

| Case | Logic ticks/turn | Logic delta | Render ticks/frame | Render delta | Session delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| sokoban | 727.305 | +0.106% | 1275.750 | -99.116% | +6 B |
| large_board | 2899.180 | +0.028% | 1328.000 | -99.111% | +27 B |
| rule_heavy | 8763.648 | +0.030% | 1358.250 | -99.097% | +16 B |
| object_heavy | 14575.820 | +0.742% | 33196.500 | -84.726% | +9 B |
| two_movement_lanes | 10582.836 | +0.007% | 1574.250 | -99.124% | +16 B |

Isolated full-board composition remains effectively unchanged, as expected:
143521.500 ticks/frame for Sokoban versus 143522.500 at baseline. This confirms
that the gain comes from avoiding unchanged work rather than accidentally
changing the composition workload.

The bitset costs 1–45 bytes depending on maximum board size. The non-performance
Sokoban autotest cartridge grows from 15242 to 15880 fixed-bank bytes (+638,
+4.19%), from 1328 to 1336 static WRAM bytes (+8), and from 347 to 353 session
bytes (+6); its generated game bank and snapshot SRAM are unchanged.

Benchmark-only measurement routines were moved from the nearly full fixed bank
into generated-data bank 1. This does not affect shipping cartridges. It keeps
the instrumented fixed bank valid at 16084 bytes and leaves the phase-probed
variant valid at 16168 bytes. Therefore benchmark-bank linked-size deltas are
not used as shipping-code metrics for this experiment.

### 2. Composite-tile deduplication — retained

Revision under test: working tree after `0c9d0e98`.

Dirty cells first look for an unchanged or already-updated board cell with the
same object mask. When one exists, the renderer points the cell at that
already-correct CGB tile instead of recomposing and uploading identical pixels.
A zero-RAM occupancy scan provides copy-on-write tile slots when no match
exists. First and level-transition redraws retain the unique-tile layout.

| Case | Render ticks/frame | Delta from dirty cells | Logic delta | Session delta |
| --- | ---: | ---: | ---: | ---: |
| sokoban | 1141.500 | -10.523% | 0.000% | 0 B |
| large_board | 1217.250 | -8.340% | 0.000% | 0 B |
| rule_heavy | 1208.500 | -11.025% | 0.000% | 0 B |
| object_heavy | 7700.000 | -76.805% | 0.000% | 0 B |
| two_movement_lanes | 1338.250 | -14.991% | 0.000% | 0 B |

A forced-full-redraw Sokoban build measures 144321.500 ticks/frame versus
144243.250 before the rendering optimizations (+0.054%), so title and level
transition cost is effectively unchanged.

The optimization adds no WRAM or session memory. Relative to dirty rendering,
the shipping Sokoban autotest adds 163 fixed-bank bytes (15880 to 16043) and
534 bank-1 bytes (1394 to 1928). The largest compatible generated-data case
remains comfortably valid: Dollyban uses 8672 of 16384 bank-1 bytes. The normal
and phase-probed benchmark images use 16227 and 16311 fixed-bank bytes,
respectively.

### 3. Preconverted 8x8 sprites — retained

Revision under test: working tree after `85731317`.

The exporter now scales every source sprite to the hardware 8x8 shape, expands
its palette indexes, and writes transparent pixels as a byte sentinel. The GBC
compositor copies those prepared bytes directly instead of doing coordinate
multiplication, source lookup, palette expansion, and 64-bit transparency tests
for every output pixel. This representation change increments the GBC game ABI
from 3 to 4.

| Case | Render ticks/frame | Render delta | Full composition delta | Game-bank delta |
| --- | ---: | ---: | ---: | ---: |
| sokoban | 562.250 | -50.745% | -79.134% | +195 B |
| large_board | 637.750 | -47.607% | -79.179% | +234 B |
| rule_heavy | 626.000 | -48.200% | -75.802% | +312 B |
| object_heavy | 3682.500 | -52.175% | -56.105% | +780 B |
| two_movement_lanes | 763.750 | -42.929% | -58.441% | +663 B |

Logic time, session RAM, static WRAM, and snapshot SRAM are unchanged in all
five cases. Forced-full Sokoban redraw improves from 144321.500 to 30805.250
ticks/frame (-78.655%).

The common compositor shrinks the fixed bank by 391 bytes. For the shipping
Sokoban autotest, fixed-bank usage falls from 16043 to 15652 while expanded
sprite data grows bank 1 from 1928 to 2123 bytes: a net 196-byte linked-content
reduction. The largest compatible generated-data case, Dollyban, remains valid
at 8984/16384 bank-1 bytes and 14597 fixed-bank bytes.

The separately phase-probed Sokoban ROM remains valid. Its whole-turn result is
741.359 ticks versus 727.305 without probes, so measurement overhead remains
1.932% (+14.055 ticks/turn).

### 4. Stable palette, map, and font uploads — retained

Revision under test: working tree after `86216d65`.

The firmware now tracks whether VRAM contains board or text assets. Consecutive
board frames retain their palettes, consecutive text screens retain their
palette and font, and dirty board frames update only tile-map entries whose
tile or attribute byte changed. First renders, level transitions, and
text-to-board transitions retain full-map uploads.

| Case | Render ticks/frame | Delta from preconverted sprites | Logic delta |
| --- | ---: | ---: | ---: |
| sokoban | 465.000 | -17.297% | 0.000000% |
| large_board | 545.500 | -14.465% | -0.000539% |
| rule_heavy | 529.250 | -15.455% | +0.000178% |
| object_heavy | 3605.000 | -2.105% | -0.000107% |
| two_movement_lanes | 671.000 | -12.144% | -0.000295% |

An identically repeated Sokoban title screen improves from 696 to 255 ticks
(-63.362%). The forced-full-redraw control changes from 30805.250 to 30801.500
ticks/frame (-0.012%), confirming that the normal-frame gain comes from stable
uploads. The phase-probed ROM remains valid at 741.352 logic ticks/turn and
464.000 render ticks/frame.

The state marker costs one byte of static WRAM. The shipping Sokoban cartridge
grows by 180 fixed-bank bytes (15652 to 15832), while its generated bank,
353-byte session, and 840-byte snapshots are unchanged. Dollyban remains valid
at 14777 fixed-bank bytes, 8984/16384 generated-bank bytes, and 1693 static
WRAM bytes.

### 5. Narrow 8/16/32-bit object storage — retained

Revision under test: working tree after `73198a59`.

The exporter selects one object-mask byte for up to eight objects, two bytes for
nine to sixteen, and four bytes for seventeen to thirty-two. Generated level
tables, the live board, and raw SRAM snapshots all share that width; rule masks
remain 32-bit. Generated builds use preprocessing-time direct loads/stores,
while the generic host library validates and dispatches the width dynamically.
The object-storage ABI changes from 4 to 5.

| Case | Objects / width | Logic ticks/turn | Logic delta | Render delta | Session delta | Snapshot delta | Game-bank estimate delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sokoban | 5 / 1 B | 649.719 | -10.668% | -15.323% | -124 B | -630 B | -252 B |
| large_board | 6 / 1 B | 2655.688 | -8.398% | -9.991% | -628 B | -3150 B | -1233 B |
| rule_heavy | 8 / 1 B | 8253.070 | -5.826% | -16.816% | -360 B | -1815 B | -801 B |
| object_heavy | 20 / 4 B | 14576.094 | +0.001983% | -0.027739% | 0 B | 0 B | 0 B |
| two_movement_lanes | 17 / 4 B | 10583.070 | +0.002510% | -0.037258% | 0 B | 0 B | 0 B |

The phase-probed Sokoban result attributes the largest gains to snapshot writes
(50.078 to 14.313 ticks, -71.420%), player setup (45.141 to 36.891,
-18.276%), early rules (533.836 to 505.820, -5.248%), and win checks (42.266
to 37.117, -12.181%). The instrumented whole turn is 663.766 ticks; probe
overhead rises to 2.162% because the underlying turn is faster.

The shipping Sokoban cartridge shrinks by 334 fixed-bank bytes and 320
generated-bank bytes. Static WRAM falls from 1337 to 1213 bytes, its session
from 353 to 229 bytes, and its five snapshots from 840 to 210 SRAM bytes.
Dollyban benefits more from compact level tables: its generated bank falls from
8984 to 5163 bytes (-3821), session from 709 to 381 bytes, snapshots from 2200
to 550 bytes, and fixed bank from 14777 to 14443 bytes. A separate nine-object
cartridge exercised the two-byte GBDK path and passed ROM validation and the
mGBA movement/undo/render smoke.

### Playtest correction: native-sized sprites — retained

Revision: `19271dba`.

The 8x8 Game Boy hardware tile is now a container rather than a scaling target.
Non-background PuzzleScript sprites keep one hardware pixel per source pixel
and are centred in the tile. The designated background remains full-bleed so
the board does not acquire gaps between cells.

Sokoban logic is unchanged at 649.719 ticks/turn. Dirty rendering improves from
393.750 to 391.000 ticks/frame (-0.70%) and full composition improves from
29945.0 to 29847.5 ticks/frame (-0.33%). Linked fixed ROM, generated ROM, WRAM,
session RAM, and SRAM are unchanged. The exporter test asserts the centred 5x5
layout and the mGBA render/movement smoke passes.

### Playtest correction: lower-layer palette colours — retained

Revision: `a99b8f9a`.

Transparency was already represented and layers were already composed from
bottom to top, but the final tile always used only the top object's palette.
Lower-layer pixels survived composition and were then quantized away. Object
palettes now prioritize the object's colours followed by successively lower
collision layers.

Microban's crate-on-goal composite now contains all four exact hardware colours:
16 orange crate pixels, 8 dark-blue target pixels, and the two background
greens. Logic remains 649.719 ticks/turn, rendering remains 391.000 ticks/frame,
and every ROM/WRAM/SRAM metric is unchanged.

### 6. Stable movement-rule convergence — retained

Revisions: benchmark `40a754dd`, fix `21ba75f6`.

The interaction probe measures initial rendering and a deterministic
walk-down/push-right sequence on the first Sokoban board. It exposed an
idempotence bug in movement replacements: the new movement mask was compared
with a locally cleared intermediate mask instead of the original cell. A
stable push rule therefore reported a change for all 200 safety-bound passes.

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Push logic | 113413 ticks / 27.689 s | 1315 ticks / 0.321 s | -98.84% |
| Push render | 700 ticks / 0.171 s | 740 ticks / 0.181 s | +5.71% |
| Complete push response | 114113 ticks / 27.860 s | 2055 ticks / 0.502 s | -98.20% |
| Ordinary walk logic | 651 ticks | 651 ticks | 0% |

The rule-heavy suite improves from 8253.070 to 7498.766 ticks/turn (-9.14%).
Three ordinary-turn controls are unchanged; the object-heavy control is
+0.123%. Shipping Sokoban fixed ROM grows by 17 bytes, while generated ROM,
WRAM, session RAM, and SRAM are unchanged. All 88 native CTests and the mGBA
render/movement smoke pass.

### 7. Full-render object-mask tile cache — retained

Revision: `8c6ba611`.

First renders and text-to-board transitions formerly composed and uploaded 360
unique hardware tiles while the LCD was off, even when nearly every cell was a
duplicate. The bank-1 renderer now caches the first 16 object masks and reuses
their tile and attribute entries. All 33 compatible games use at most 9
distinct masks in an initial level; additional masks retain a correct uncached
fallback.

| Case | Initial render before | Initial render after | Delta | Normal render delta |
| --- | ---: | ---: | ---: | ---: |
| sokoban | 30734 ticks / 7.503 s | 1261 ticks / 0.308 s | -95.90% | -20.33% |
| large_board | 31621 ticks / 7.720 s | 1196 ticks / 0.292 s | -96.22% | -16.53% |
| rule_heavy | 37100 ticks / 9.058 s | 1224 ticks / 0.299 s | -96.70% | -19.54% |
| object_heavy | 95077 ticks / 23.212 s | 2072 ticks / 0.506 s | -97.82% | -10.88% |
| two_movement_lanes | 75208 ticks / 18.361 s | 1116 ticks / 0.272 s | -98.52% | -12.30% |

Logic changes by no more than +0.0012%. Shipping Sokoban moves 207 bytes out of
fixed bank and adds 445 bytes to bank 1, for a net 238 ROM bytes. The cache
costs 80 bytes of static WRAM; session RAM and SRAM are unchanged. All five
benchmark cartridges link within their real bank limits and the mGBA
hardware-state smoke passes.

### Playtest correction: keep the LCD on for incremental renders — retained

Ordinary movement used the same display-off/display-on bracket as a complete
tile-map rewrite. On hardware and in mGBA this exposes the LCD-off blank colour
between moves. Only first renders, level changes, and text screens now blank
the display; dirty tile and attribute writes leave it enabled.

The instrumented mGBA smoke records zero blanking transitions across an
incremental move and confirms that the LCD remains on. Sokoban dirty rendering
improves from 311.5 to 288.0 ticks/frame (-7.54%); walk rendering improves from
308 to 287 ticks (-6.82%) and push rendering from 575 to 536 ticks (-6.78%).
Initial rendering is unchanged at 1261 ticks. Shipping fixed ROM grows by
8 bytes (14253 to 14261); static WRAM, generated ROM, session RAM, and SRAM are
unchanged.

### Playtest correction: native-size packed cells — superseded

The GBC background hardware still uses 8x8 tiles, but those tiles now act as a
packed framebuffer. PuzzleScript cells retain their native dimensions (5x5 in
the Sokoban fixtures), can cross hardware-tile boundaries, and are never
resampled. Native sprite bytes also remain compact in generated ROM. Dirty
logical cells mark only the physical tiles they intersect.

The renderer precomputes the repeating background phases, clips native-cell
blits to each physical tile, and bounds dirty traversal to the board rectangle.
This brought the first correct packed prototype down from 166065 ticks
(40.543 s) to 4337 ticks (1.059 s). The current title or a loading message
remains visible while a full board is prepared; the LCD is blanked only for the
final palette/tile-map handoff.

| Sokoban interaction | Stretched 8x8 | Native 5x5 | Delta |
| --- | ---: | ---: | ---: |
| Ordinary walk render | 287 ticks / 0.070 s | 266 ticks / 0.065 s | -7.32% |
| Crate-push render | 536 ticks / 0.131 s | 430 ticks / 0.105 s | -19.78% |
| Complete push response | 1851 ticks / 0.452 s | 1746 ticks / 0.426 s | -5.67% |
| Initial board preparation | 1261 ticks / 0.308 s | 4337 ticks / 1.059 s | +243.93% |

Across the five benchmark games, logic changes by at most 0.0012%. Ordinary
render probes range from -14.49% to +15.86% in four cases; Sokoban's synthetic
alternating probe is +53.93%, while its measured walk and push interactions
both improve as shown above. Complete push latency ranges from -2.27% to +3.40%
outside Sokoban.

For the benchmark Sokoban cartridge, fixed ROM falls by 293 bytes, bank 1 grows
by 2182 bytes, and static WRAM grows by 504 bytes. The conservative generated
game-data estimate grows by 213 bytes; session RAM and snapshot SRAM are
unchanged. The mGBA hardware-state smoke verifies a 5x5 cell pitch, a 30x35
pixel board, exact reserved-tile mapping, palette state, VRAM upload readback,
and zero LCD blanking transitions during an incremental move.

### Playtest correction: background-first packed palettes — superseded

A native 5x5 cell can share one physical 8x8 tile with several neighboring
cells, but GBC background tiles still have only four colours. Preserving every
colour in a transparent four-colour sprite displaced the two-colour floor and
created a visible halo. Generated object palettes now reserve the background
colours first, then object colours, then visible lower-layer colours when
capacity remains. Crates still retain their target colour because their
one-colour sprite, target, and two-colour floor fit exactly; over-budget
multi-colour sprites lose decorative detail instead of corrupting transparency.

The exporter also emits a 32-byte exact-colour candidate table. The renderer
uses it to select a hardware palette that preserves every source colour when
one exists. Instrumented mGBA probes count both all remaps and background-only
remaps. Sokoban falls from 153 total remapped pixels to 48, with zero background
remaps. Dollyban, Slot Machine, and Recondite Star Sector Sigma also report zero
background remaps across 3-, 5-, 12-, and 4-layer fixtures respectively.

Across five performance cartridges, palette selection adds 6.81% to 8.61% to
the isolated dirty-render probe and 3.90% to 7.91% to initial preparation;
logic changes by at most 0.0001%. Sokoban walk rendering is 287 ticks
(0.070 s), equal to the old stretched renderer, and push rendering is 461 ticks
(0.113 s), 13.99% faster than the old 536-tick result. The change adds 126
linked bank-1 bytes, 32 estimated game-data bytes, and 4 static WRAM bytes;
fixed ROM, session RAM, and snapshot SRAM are unchanged.

### Playtest correction: fixed 16x16 cells — retained

The packed 5x5 framebuffer and its cross-cell palette selection were rejected
after playtesting: the more complicated renderer still produced uneven-looking
sprites and made palette defects difficult to reason about. The replacement is
deliberately rigid. Every logical cell owns an aligned 2x2 quartet of CGB
hardware tiles. Each 5x5 source pixel expands to 3x3 output pixels, and the
middle source row and column expand to four pixels, yielding exactly 16x16.
Hardware tiles never contain pixels from neighboring logical cells.

The physical 20x18 tile screen therefore holds at most 10x9 logical cells
(90 cells). The first 16 object-mask compositions occupy a small shared quartet
cache; later compositions use a quartet reserved for that logical screen cell.
The old repeating-background phases, pixel blitter, exact-palette candidate
table, palette-priority table, and dirty physical-tile bitset are gone.

The mGBA smoke validates the 16x16 pitch, all 90 quartet mappings, VRAM upload
readback, palette and tile-map state, and zero LCD blanking events during an
incremental move. A synthetic 17-object board exercises 18 distinct
compositions, two cache-overflow cells, and two cells in VRAM pattern bank 1.

| Case / metric | Packed 5x5 | Fixed 16x16 | Delta |
| --- | ---: | ---: | ---: |
| Sokoban average dirty render | 520.25 ticks | 51.00 ticks | -90.20% |
| Sokoban initial render | 4474 ticks / 1.092 s | 2554 ticks / 0.624 s | -42.91% |
| Sokoban walk render | 287 ticks / 0.070 s | 50 ticks / 0.012 s | -82.58% |
| Sokoban push render | 461 ticks / 0.113 s | 58 ticks / 0.014 s | -87.42% |
| Sokoban static WRAM | 2952 bytes | 1701 bytes | -42.38% |
| Sokoban generated ROM bank | 5576 bytes | 3344 bytes | -40.03% |
| Slot Machine average dirty render | 3973.25 ticks | 316.25 ticks | -92.04% |
| Slot Machine initial render | 6387 ticks / 1.559 s | 3095 ticks / 0.756 s | -51.54% |
| Slot Machine static WRAM | 3232 bytes | 1981 bytes | -38.71% |

The benchmark's 128-turn logic timing is unchanged for Sokoban and changes by
only -0.0001% for Slot Machine. Generated-data estimates fall by 440 bytes for
each case because the packed-background and exact-palette tables no longer
exist. The compatibility loss is intentional: a game must now fit a 5x5 source
cell and every board/declared viewport must fit 10x9.

The post-change structural audit exports 7 of the 178 `good_games` fixtures:
15 Push Pull Levels, I Am a Gust of Wind, No Forbidden Symbols, Push Pull,
Pushy-V Pully-H, Short Adventure in Sticky Wall Land, and Slot Machine. Eight
of the 15 games accepted by the packed renderer exceed the new board limit.
Production ROMs for all seven pass cartridge-header, link-map, hash, and
manifest checks; separately instrumented builds of all seven boot and pass the
mGBA hardware-state smoke.
