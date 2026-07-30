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

### Correctness fix: run rules on level start

The GBC exporter and runtime now preserve and execute
`run_rules_on_level_start`. Loading a board performs the same zero-input early
rules, movement resolution, late rules, and command processing as the generic
C++ runtime. The pass does not create an undo entry, ignores `restart` and
`win`, and preserves `again`, `checkpoint`, and `message` behavior. Restarting
a level reapplies the pass.

A dedicated parity fixture moves its player from `(0,0)` to `(1,0)` only
during the startup pass. The native runtime and generated GBC runtime agree
after load, an ordinary move, and restart. A GBDK cartridge reports `(1,0)` as
its initial player coordinate through mGBA SRAM before any input.

Of the seven compatible production games, three use this metadata and were
incorrect before the fix: I Am a Gust of Wind, Short Adventure in Sticky Wall
Land, and Slot Machine.

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Sokoban logic (no metadata) | 649.719 ticks/turn | 651.305 ticks/turn | +0.244% |
| Sokoban walk logic | 650 ticks | 652 ticks | +0.308% |
| Sokoban push logic | 1315 ticks | 1317 ticks | +0.152% |
| Benchmark fixed ROM | 15331 bytes | 15765 bytes | +434 bytes |
| Static WRAM | 1701 bytes | 1701 bytes | unchanged |
| Generated game estimate | 1242 bytes | 1242 bytes | unchanged |
| Session RAM / snapshot SRAM | 229 / 210 bytes | 229 / 210 bytes | unchanged |

Slot Machine's startup and interaction render timings are not comparable
before and after: the corrected build starts from the rule-transformed board,
whereas the old build rendered the raw level. The instrumented fixture still
fits the fixed ROM bank at 16328/16384 bytes (56 bytes spare). All 89 native
CTest targets and all 753 JS tests pass.

All seven production cartridges pass header, link-map, hash, manifest, and
memory-limit checks. Five also pass the complete mGBA render-and-logic probe.
The two largest generated games cannot link that roughly 2 KiB probe alongside
the full runtime, so Short Adventure and Slot Machine use a lighter
coordinate/change/win SRAM probe instead; both pass in mGBA at 14956 and 15149
fixed-bank bytes respectively. The standalone startup fixture retains the full
renderer probe and directly proves the metadata-induced pre-input state.

### Compatibility option: cull oversized GBC levels

`export-gbc --cull-oversize-levels` omits board levels wider than 10 cells or
taller than 9 cells while retaining message levels and fitting boards in their
original order. The default export remains strict. The manifest records source,
retained, and culled level counts plus the zero-based source indices of every
omitted board. Export still fails if culling removes every board or another GBC
limit is exceeded.

The strict 178-game audit had 102 games whose first reported failure was board
size. A complete culling audit shows that only seven are otherwise compatible:
54 lose every board, while 41 reveal a later unsupported rule or other target
limit.

| Game | Retained boards | Source boards | Culled |
| --- | ---: | ---: | ---: |
| Dollyban | 6 | 15 | 9 |
| Fickle Fred | 4 | 5 | 1 |
| Gapfiller | 8 | 10 | 2 |
| Pushit | 2 | 4 | 2 |
| Recondite Star Sector Sigma | 8 | 10 | 2 |
| Voitex Rasteriser | 1 | 2 | 1 |
| Xorro The Chaos Warden | 3 | 4 | 1 |
| **Total** | **32** | **50** | **18** |

This raises the structurally exportable corpus from 7/178 to 14/178. Production
cartridges for all seven additional games pass header, link-map, ROM-bank, RAM,
hash, and manifest checks. Six pass the complete render-and-logic mGBA probe;
Voitex uses the logic-only cartridge probe because the full diagnostic payload
overflows bank 0, while its production ROM fits at 14759/16384 bytes. The other
production fixed-bank sizes are 14369-14383 bytes, and generated banks range
from 3167 to 7725 bytes. All 89 native CTests and all 753 JS tests pass.

The option changes only exported level data, so it adds no runtime work and has
no ROM or performance cost when disabled.

### Physical-LCD contrast: game-wide colour stretching

GBC export no longer treats authored RGB values as literal cartridge colours.
The contrast inventory contains every opaque, pixel-referenced object colour
plus the game's background colour. Declared but unused object colours are
excluded. The metadata foreground/text colour is still transformed for UI
rendering, but it is deliberately excluded as a contrast anchor: the usual
black-background/white-text defaults must not prevent the gameplay palette
from expanding.

The primary curve stretches HSV-style brightness (the largest RGB component)
from the darkest gameplay/background colour to 0 and the brightest to 31,
scaling all three channels together to preserve hue, saturation, neutral greys,
and channel ordering. The exporter also evaluates shared-component curves,
which can separate intermediate colours more strongly; they are eligible only
when the resulting gameplay colours still fill the 0-31 brightness gamut.
Black and white anchors therefore do not disable nonlinear redistribution of
the colours between them.

Both curve families evaluate 33 blends between linear and equal-rank spacing.
Selection is deterministic and lexicographic: fewest 15-bit colour collisions,
greatest minimum pairwise RGB distance, then greatest total pairwise distance.
The manifest lists every contrast-anchor colour alongside its literal and
selected BGR555 values, records the excluded metadata foreground separately,
and reports curve, brightness-range, collision, and pair-distance diagnostics.

Across all 14 compatible production games, all 14 fill the complete 0-31
gameplay brightness range and improve their closest colour pair. None gain a
BGR555 collision. Five games have a foreground-only metadata colour, and six
unused object colours are removed across six games. On the resulting set of
actually visible gameplay colours, the sum of the per-game minimum squared
distances rises from 838 to 1728 (+106.2%).
The dedicated four-colour test fixture rises from 48 to 221 (+360.4%) while
remaining collision-free.

This work is entirely in the host-side exporter. Every production link map is
byte-identical in fixed-bank use, generated-bank use, static WRAM, session RAM,
and the game-data estimate before and after (zero delta for all 14 games), so
runtime speed and cartridge memory use are unchanged. All 89 native CTests
pass. The instrumented cartridge passes its mGBA palette-register,
render-and-logic smoke, and all 14 production ROMs pass link/header/memory
checks and boot under mGBA.

### Playtest correction: collision-layer-aware palette reduction

Sokoban exposed a second, later colour loss that was not caused by the global
contrast stretch. The stretched player blue and both terrain greens were still
distinct, but the four-entry CGB background palette was populated in
lower-layer-first order. The two terrain greens, black, and orange consumed the
player palette; white and blue were then nearest-colour mapped onto those four
entries, turning the blue trousers terrain green.

The exporter now allocates palette entries by collision layer before spending
remaining entries on additional shades within a layer. Representatives are
selected by weighted RGB error. Palette reuse and the generated remap table
retain the same layer ownership, so an over-budget player colour is reduced to
another player colour rather than a terrain colour. The manifest records exact,
within-layer-quantized, and cross-layer-fallback colour counts.

For Sokoban the player palette becomes terrain green, player blue, player
white, and target dark-blue. Black and orange reduce within the player layer;
the blue trousers remain blue. Its audit reports 17 exact layer colours, three
within-layer reductions, and zero cross-layer reductions. Ten of the 14
production games also need no cross-layer fallback. The remaining four have
transparent candidates spanning more than four collision layers or exhaust
all eight hardware palettes, where the hardware limit makes some fallback
unavoidable and the manifest now makes that loss visible.

The runtime representation and code are unchanged. Exact before/after mGBA
benchmarks match at 83643 ticks for 128 turns, 6098 composition ticks, 50 walk
render ticks, and 58 push render ticks. The normal instrumented link remains
14762 fixed-bank bytes, 6912 generated-bank bytes, and 1497 static-WRAM bytes;
session RAM and SRAM are unchanged. The focused cartridge passes palette,
render, movement, and rule probes, all 14 production cartridges pass
link/header/memory checks and boot under mGBA, and all 89 native CTests pass.

### Playtest correction: per-quadrant palettes with whole-sprite consistency

The CGB already assigns a background palette to each 8x8 tile, so a logical
16x16 cell can use one palette for each member of its 2x2 tile quartet without
introducing sprites, scanline effects, or object-at-a-time drawing. The
exporter now builds palette candidates from the colours that can physically
reach each quadrant, including lower collision layers visible through
transparency.

The split is deliberately all-or-safe at object scope. An object may use
different quadrant palettes only when every one of its source colours is exact
in every quadrant where that colour occurs. If even one colour would be
quantized, all four quadrants are assigned the same palette. This prevents a
face, costume, or other repeated colour from changing at the 8-pixel boundary.
The manifest reports both the previous single-palette result and the selected
quadrant result, the number of multi-palette objects, and any inconsistent
object colours; the latter is a hard zero in the acceptance corpus.

Across the 15 accepted audit games, full-color objects rise from 95/125
(76.0%) to 107/125 (85.6%). Twelve objects are recovered and nine objects use
multiple quadrant palettes. Pushit gains one full-color object, Short
Adventure in Sticky Wall Land gains one, Slot Machine gains seven, and Voitex
Rasteriser gains three. The collision-layer-aware quality metric also improves:
cross-layer colour mappings fall from 316 to 228 (-27.8%), and no game regresses
because the exporter retains the old palette set when a proposed set would do
worse.

The generated representation stores sparse opaque-pixel blits and four packed
palette indices per object. This more than pays for the extra palette handling
during full composition:

| Five-cartridge benchmark | Delta |
| --- | ---: |
| Composition time | -16.81% to -55.08% |
| Initial render time | -18.25% to -26.79% |
| Incremental dirty-render time | -0.53% to +3.16% |
| Generated benchmark bank | +6 to +315 bytes (+0.06% to +4.28%) |
| Static WRAM | +84 bytes (+3.74% to +4.58%) |
| Fixed benchmark bank | unchanged |
| Session RAM / snapshot SRAM | unchanged |

Average logic timing changes by at most 0.0014%, consistent with measurement
noise; the render representation is not consulted by the rules engine. The
dedicated fixture is exported as two full-color objects rather than one, and
an mGBA framebuffer/attribute probe confirms that the hardware renderer uses
multiple palettes inside a cell. At this stage the structural Sokoban probe
passed, but did not assert the authored colours in the rendered player cell.
Later framebuffer inspection found that the player was still reduced and that
SDCC had miscompiled the new sparse-blit indexing expression; both limitations
are addressed below. All 15 accepted cartridges pass link, header, bank, RAM,
hash, and manifest checks. All 89 native CTests and all 753 JavaScript tests
pass.

### Playtest correction: visible lower pixels and safe sparse blits

Sokoban's player is not inherently over the per-quadrant hardware limit. Each
upper 8x8 quadrant contains three player colours, but the first quadrant
allocator also reserved both floor shades and the target colour. The target is
not genuinely visible: every one of its pixels is covered by an opaque player
pixel. The six-colour candidate was therefore an exporter artefact, not a real
composition.

Lower-layer candidates now pass through the current object's exact 5x5
transparency mask. Once every genuinely visible collision layer has one
palette entry, spare entries make the current object exact before preserving
additional shades underneath it. Sokoban therefore uses `3 player + 1 floor`
in each upper quadrant and `2 player + 2 floor` below. Black, orange, white,
and blue are all exact; only one floor shade is reduced within the terrain
layer. No target colour is reserved where the target cannot appear.

The exporter still computes the preceding conservative quadrant palette set.
If visibility-aware allocation would retain fewer exact objects or add a
cross-layer mapping, it emits that conservative set instead. This guard is
exercised by Short Adventure in Sticky Wall Land.

Across the 15-game acceptance corpus, exact-colour objects rise again from
107/125 to 113/125 (90.4%): 15 Push Pull gains one, Fickle Fred gains two,
Pushit gains one, Push Pull gains one, and Sokoban gains one. Relative to the
original single-palette allocator the total improvement is 95/125 to 113/125,
or 18 recovered objects. Twenty-one objects use multiple quadrant palettes,
the whole-object inconsistency count remains zero, and cross-layer mappings
fall from 228 to 181 (-20.6%). No game loses an exact-colour object.

The first mGBA colour assertion then found a separate runtime defect. SDCC
miscompiled two indexed reads through the same generated ROM pointer: sparse
destinations were correct, but later colour bytes came from a corrupted
address calculation. Walking the destination/value pairs sequentially avoids
the bad code generation; the emitted assembly was inspected, and the mGBA
framebuffer now contains all four authored Sokoban player colours as well as
the previously flattened wall and floor patterns.

Correct sparse compositing is slower than the accidentally truncated work in
the immediately preceding build: the isolated composition probe rises by
2.92%-22.99%. Initial rendering changes by -0.05%-+3.32%, incremental dirty
rendering by -1.07%-+0.49%, and interaction renders by at most 11 ticks. Against
the pre-quadrant baseline, the corrected implementation is still
14.39%-44.76% faster in composition and 18.19%-26.83% faster on initial
rendering. Logic timings are byte-for-byte identical. Each benchmark generated
bank shrinks by 23 bytes; fixed ROM, static WRAM, session RAM, and snapshot SRAM
are unchanged.

The final instrumented Sokoban cartridge passes its normal movement and tile
readback checks in mGBA and additionally requires black (`0`), orange (`7773`),
white (`32767`), and blue (`31140`) in the rendered player cell. All 15
production cartridges pass link, header, bank, RAM, hash, and manifest checks.
All 89 native CTests and all 753 JavaScript tests pass.

### GBC specialized turn codegen — solution replay bench (Task 10)

Revision: working tree on `gbc-specialized-turn-codegen`.

Added a checked-in level-0 solution for `sokoban_basic` (33 moves, solver-generated)
and a host-side replay bench (`puzzlescript_gbc_solution_replay_bench` +
`scripts/run_gbc_solution_replay_bench.py`). The bench verifies the solution wins
under the specialized GBC core and records per-turn host timings with
`timing_source: host_gbc_core`. Cartridge mGBA solution-feed replay is not wired
yet; cart timings should still use the existing 4096 Hz perf ROM methodology.

| Metric | Interpreter baseline (ledger) | Specialized Sokoban (this work) |
| --- | ---: | ---: |
| Logic ticks/turn (128-turn perf ROM) | 651.305 (~159 ms @ 4096 Hz) | not remeasured on cart (façade path) |
| Solution replay (33 turns) | — | wins; host mean ≪ 1 ms/turn (not cart comparable) |
| Linked fixed ROM | ~14762 (instrumented normal cart) | 15301 (+539 B) |
| Linked generated bank | ~6912 | 5868 (−1044 B net with façade objects) |
| `specialized_turn` manifest | false / absent | true |
| Snappy scoreboard (cart) | — | pending mGBA solution replay |

**Honest speed note:** the current specialized entry still executes early/late
rules through the shared façade rule walker plus `ps_gbc_resolve_movements`. That
is semantic specialization (single call site, bank-2 placement), not desktop-style
compact-turn unrolling. Do not expect cart speedups until real GbdC rule emission
lands (see Next below).

Make target: `make gbc_specialized_bench`.

### GBC specialized turn — single-player bake-in (Task 11)

Export-time analysis `gbcSinglePlayerCertified` requires exactly one player cell
on every retained board and rejects rules that net-create or net-destroy player
objects (conservative per-pattern check, ignoring crate-only clear masks). When
certified, the manifest sets `"single_player_cell": true` and generated code keeps
a static `ps_gbc_specialized_player_cell` refreshed after each successful turn.
Sokoban is certified; `gbc_spawn_second_player.txt` is not.

### GBC eligible corpus specialized scoreboard (Task 12)

`scripts/build_gbc_eligible_roms.py` now emits
`build/gbc/eligible/specialized-scoreboard.json` and supports
`--scoreboard-only` over an existing eligible tree. The checked-in scoreboard
reflects ROMs exported before the specialized manifest fields; rebuilding with
`make gbc_eligible` is required for accurate per-game `specialized_turn` flags.
Solution replay timings in the scoreboard remain null except where a fixture
exists (currently none among the 14 eligible slugs).

### GBC specialized turn — size/speed hardening notes (Task 13)

Bank placement: façade helpers (`compact_facade.c`, `facade_rules.c`) and
`generated_specialized_turn.c` link in generated-data bank 2 (`#pragma bank 2`);
the fixed shell stays in bank 0/1. The Sokoban specialized production cart leaves
**1085 bytes** spare in fixed bank 0 (15301/16384) and **10516 bytes** spare in
bank 1 (5868/16384) after linking façade + specialized turn objects.

GbdC emission intentionally avoids desktop-only hooks (`PersistentLevelState`,
`std::vector`, `PS_COMPACT_TURN_OUTPUT_HOOKS`). The bootstrap façade path is
complete for Sokoban parity but is not the final performance shape.

**Next:** emit real compact-turn **unrolled** early/late/movement GbdC rule bodies
(desktop `compact_turn_codegen` match/apply paths through the façade) instead of
calling `ps_gbc_facade_apply_groups` for whole rulegroups. Until that lands, treat
specialized carts as parity/orchestration wins only, not snappy-turn wins.

### GBC unrolled GbdC Sokoban slice (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

Sokoban `generated_specialized_turn.c` no longer calls
`ps_gbc_facade_apply_groups`. It emits a packed `ps_gbc_generated_pattern` table
plus shared match/apply helpers and per-rule/group control flow that uses façade
get/set only. Movement still goes through `ps_gbc_resolve_movements`.

| Check | Result |
| --- | --- |
| Structural | no `ps_gbc_facade_apply_groups`; `ps_gbc_specialized_apply_early/late` present |
| Oracle (crate-push replay) | PASS (`puzzlescript_gbc_specialized_oracle_smoke`) |
| Full solution (33 moves) | specialized wins; ≡ interpreter on host |
| Host mean ms/turn (solution, O2, 20 iters) | interpreter **0.000298** → specialized **0.000708** (**−137.6%** speedup; slower) |
| Cart/mGBA | not remeasured (out of slice gate) |

**Honest takeaway:** this is the first real unrolled GbdC emission path and clears
the walker for Sokoban with oracle parity. Host µs timings are still worse than
the interpreter on this tiny game (call overhead / code size dominate); treat as
an informational baseline for the eligible-14 unroll follow-on, not a snappy win.

### GBC inline match/apply + storage inline Sokoban (2026-07-24)

Revision: working tree on `gbc-inline-match-apply-sokoban`.

Replaced packed pattern-table specialized match/apply with dialect-style literal
inline checks/writes (`emitCompactInlineGbdCPatternMatch` / `Apply`), then inlined
façade cell get/set to direct `session->board` / `movements` / `dirty_bits` access.
Certified single-player apply-on-match rules use a slim O(1) live-`player_cells`
anchor (skipping stale pre-resolve entries) with match-all-then-apply fused loads.

| Check | Result |
| --- | --- |
| Structural | no pattern table / shared match-apply helpers; `session->board[` + `& 0x` present |
| Oracle | PASS (crate-push + full 33-move solution) |
| Host mean ms/turn (solution, O2, 200 iters) | interpreter **0.000297** → specialized **0.000174** (**+41.4%** speedup) |

Script: `python3 scripts/bench_gbc_sokoban_host_speed.py`.

**Retained:** host specialized turns are faster than the GBC interpreter on the
Sokoban solution replay. Cart/mGBA not remeasured in this slice.

### GBC specialized follow-on — cart size + eligible-14 host (2026-07-24)

Revision: `gbc-specialized-turn-codegen` @ `df784fea` (+ player_cells guard fix).

**Sokoban cartridge link sizes** (production `build-rom`, absolute GBDK; not
PERF_BENCH):

| Variant | Fixed | Banked sum | Linked code | Static WRAM |
| --- | ---: | ---: | ---: | ---: |
| Interpreter baseline | 15312 | 5868 | 21180 | 1565 |
| Specialized | 15301 | 13273 | 28574 | 1567 |
| Δ | −11 | **+7405** | **+7394** | +2 |

Artifacts: `build/gbc/sokoban-cart-compare/rom-size-compare.json`.

**Cart timing (mGBA Mac `.app`, PERF_BENCH 128 L/R, 3 deterministic runs):**

Specialized turn must live in **bank 1** with `generated_game.c`. Emitting it in
bank 2 hung when calling non-`NONBANKED` core helpers (never wrote PERF SRAM).
`scripts/run_gbc_benchmark.py` now discovers `/Applications/mGBA.app/.../mGBA`
and skips SDL dummy drivers for that Cocoa binary.

| Variant | ticks/turn | ms @ 4096 Hz | walk logic | push logic | Banked code |
| --- | ---: | ---: | ---: | ---: | ---: |
| Interpreter baseline | 202.227 | 49.37 | 163 | 221 | 8045 |
| Specialized (bank 1) | 130.930 | 31.97 | 124 | 168 | 15525 |
| Δ | **−35.3%** | | −24% | −24% | **+7480** |

Artifacts: `build/gbc/sokoban-cart-perf/{baseline,specialized}-mgba.json`,
`compare.json`. Phase counters are zero on the specialized path (not wired
through interpreter phase probes); whole-turn + interaction ticks are valid.

**Eligible-14 host solution benches** (`scripts/bench_gbc_eligible_solutions.py
--skip-rom --max-levels 2`): several games already beat the interpreter on host
(e.g. 15-push-pull ~+64%, i-am-a-gust-of-wind ~+68%, dollyban ~+31%). Remaining
issues: specialized win failures / timeouts on some boards (slot-machine,
voitex, xorro L0); net host slowdowns on pushit / recondite. Compile failure for
`SINGLE_PLAYER_CELL` without player-cell anchors was fixed by gating
`session->player_cells` behind `PS_GBC_HAS_PLAYER_CELL_ANCHORS`.

### GBC specialized resolve + won (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

Shape-gated emitters add `ps_gbc_specialized_resolve_movements` (literal layer
masks, direct board/movements/dirty, player anchors updated at the move site)
and `ps_gbc_specialized_won` (literal All/No/Some filters). `finish_turn` calls
the specialized won predicate when `PS_GBC_GENERATED_SPECIALIZED_WON`. Canmove
SFX is not emitted on the specialized resolve path yet (sounds out of scope).

| Check | Result |
| --- | --- |
| Oracle | PASS (`puzzlescript_gbc_specialized_oracle_smoke`) |
| Structural | Sokoban emit uses specialized resolve + won; no shared resolve call |
| Cart PERF (mGBA Mac `.app`, 3 runs) | see table |

| Variant | ticks/turn | ms @ 4096 Hz | walk | push | Banked |
| --- | ---: | ---: | ---: | ---: | ---: |
| Interpreter baseline | 202.227 | 49.37 | 163 | 221 | 8045 |
| Prior specialized (rules only) | 130.930 | 31.97 | 124 | 168 | 15525 |
| **Resolve + won** | **88.594** | **21.63** | **83** | **115** | 16454 |
| vs prior specialized | **−32.3%** | | | | +929 |
| vs interpreter | **−56.2%** | | | | |

Win phase probe (instrumented outside specialized body): ~37.4 → **5.45**
ticks/turn. Artifacts:
`build/gbc/sokoban-cart-perf/compare-resolve-won.json`,
`specialized-resolve-won-mgba.json`.

### Eligible correctness follow-up (2026-07-24)

Revision: `gbc-specialized-turn-codegen` @ `00d451a5`.

Fixes for host specialized replay:
- Gate `ps_gbc_specialized_won` on `PS_GBC_HAS_SPECIALIZED_TURN` (baseline host
  benches must not require the specialized object).
- Command-only matches (e.g. `[]->again`) set turn `changed` so `finish_turn`
  honors `pending_again`.
- Mismatched input-specialized groups **skip** instead of returning from the
  whole early/late phase (matches interpreter per-group `return false`).

Host `--skip-rom --max-levels 2` on the problem set:
| Game | Result |
| --- | --- |
| slot-machine | both boards win (correct again; slower than false no-again path) |
| pushit / recondite | both boards win (still net host slowdowns) |
| xorro L0 | win; **L1 still specialized lose** |
| voitex | solver timeout (unchanged) |

### Single-pass apply-on-match full-scan fix (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

**Bug:** Certified `PS_GBC_RULE_GROUP_SINGLE_PASS` rules used fused apply-on-match
emission that `goto`'d out of the scan after the first hit. Interpreter
single-pass still collect-all-then-applies every match in one rule invocation.
Xorro late `[flippedv]->[]` / `[flippedh]->[]` therefore cleared only one cell;
leftover flip markers diverged from baseline from turn 2 on board 1.

**Fix:** Keep apply-on-match fusion, but scan the whole grid (no early exit).

| Check | Result |
| --- | --- |
| xorro L1 host replay | baseline win ≡ specialized win (31 moves, board hash match) |
| voitex L0 | hand fixture 33 moves; both win (`--reuse-fixtures`) |
| Problem set (slot/pushit/recondite/xorro/voitex) | all solved boards won on specialized |

Voitex remains hard for `puzzlescript_solver` within 120s; canonical fixture:
`native/tests/fixtures/gbc_voitex_rasteriser_board0.txt` (copied into
`build/gbc/eligible/solution-fixtures/` for `--reuse-fixtures`). Bench script
gains `--reuse-fixtures`.

Eligible-14 host (`--skip-rom --reuse-fixtures --max-levels 2`): **25/25** solved
boards won on specialized. Remaining gap is solver-only:
`short-adventure-in-sticky-wall-land` board 1 times out (no specialized lose).

### GBC again net-change gate (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

**Bug:** `finish_turn` scheduled `pending_again` whenever `again && changed`.
Realtime-style games (slot-machine: late clear/redraw shadows + `[]->again`)
report `changed` every tick even when the board net-returns to the turn-start
state, so host solution replay drained **500 again ticks per move**.

**Fix (v1, rejected for cart):** Hash the board every turn at snapshot time —
fixed host again loops but blew Sokoban cart PERF from ~88.6 → **~304**
ticks/turn (`snapshot≈229`).

**Fix (retained):** Before `commit_undo`, when `again && changed`, compare the
live board to the turn-start undo slot (`snapshots.read` + memcmp). Cost only
on again turns; Sokoban / no-again games unpaid. Stop forcing `changed` for
again-only specialized command matches.

| Check | Before → After |
| --- | --- |
| slot L0 again ticks (11 moves) | 5002 → **12** |
| slot L1 again ticks (57 moves) | 28002 → **64** |
| slot host specialized ms/turn | ~4.1 → **~0.18** |
| slot host speedup vs interpreter | **−262% → +45.7%** |
| Sokoban cart specialized (phases) | **88.695** ticks/turn (was ~304 with hash) |
| vs resolve+won (~88.594) | within noise |
| Oracle / again-game wins | still green |

Artifacts: `build/gbc/sokoban-cart-perf/specialized-again-gate-v2-mgba.json`.

### GBC specialized resolve seeded-player fast path (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

**Idea:** After turn-start `memset` of movements, only seed and early rules can
introduce movers. Skip resolve when both are false. When seed ran and early did
not match, only the player cell can hold movement — resolve that cell in O(1)
instead of scanning the whole grid. Push turns (`early`) keep the full
multi-pass specialized resolve.

| Variant | ticks/turn | walk | push | Largest gen bank |
| --- | ---: | ---: | ---: | ---: |
| Prior specialized (again-gate v2) | 88.695 | 83 | 115 | 13524 |
| **Seeded-player fast path** | **55.812** | **49** | **116** | 14331 |
| vs prior | **−37.1%** | | | +807 |
| vs interpreter (~202.2) | **−72.4%** | | | |

Oracle + exporter structural asserts green. Artifacts:
`build/gbc/sokoban-cart-perf/specialized-resolve-fastpath-mgba.json`.

### GBC specialized resolve move-bit worklist (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

**Idea:** Rule apply marks cells that receive movement into a 12-byte bitset.
Full specialized resolve (push / multi-mover) walks only marked cells. The
seeded-player O(1) path stays unmarked so walk-heavy PERF averages do not pay
bitset overhead. Before full resolve, re-mark the seeded player cell when seed
ran (covers early matches that do not rewrite the player cell).

| Metric | Before (seeded-player) | After |
| --- | ---: | ---: |
| ticks/turn (128 R/L) | 55.812 | **55.852** (noise) |
| walk_logic | 49 | 50 |
| push_logic | 116 | **85 (−26.7%)** |
| static WRAM | 2276 | 2288 (+12) |
| Largest gen bank | 14331 | 14610 (+279) |

Oracle green. Artifacts:
`build/gbc/sokoban-cart-perf/specialized-move-bits-v2-mgba.json`.

### GBC specialized literal player-layer seed (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

When the player mask is a single object with a known movement layer, seed emits
`movement |= direction << (5 * layer)` instead of scanning object bits / looking
up `objects[id].movement_layer`.

| Metric | Before | After |
| --- | ---: | ---: |
| ticks/turn | 55.852 | **54.484 (−2.5%)** |
| walk_logic | 50 | **48** |
| push_logic | 85 | **83** |
| Largest gen bank | 14610 | **14476 (−134)** |

Oracle green. Artifacts:
`build/gbc/sokoban-cart-perf/specialized-literal-seed-mgba.json`.

### GBC specialized literal level dimensions (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

When every board level shares the same width×height, emit
`ps_gbc_specialized_level_width/height` and use those (plus a literal cell
count) in rules, resolve, seed, and won instead of `session->width/height`.

| Metric | Before | After |
| --- | ---: | ---: |
| ticks/turn | 54.484 | **51.703 (−5.1%)** |
| walk_logic | 48 | **46** |
| push_logic | 83 | 84 |
| win phase | 5.500 | **4.289** |
| Largest gen bank | 14476 | **13907 (−569)** |

Oracle green. Artifacts:
`build/gbc/sokoban-cart-perf/specialized-literal-dims-mgba.json`.

### GBC specialized direction-neighbor resolve (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

With uniform literal level size, resolve computes the neighbor by direction
(`cell±1` / `cell±height`) with cheap edge checks instead of
`div/mod/mul` coordinate math.

| Metric | Before | After |
| --- | ---: | ---: |
| ticks/turn | 51.703 | **48.859 (−5.5%)** |
| walk_logic | 46 | **43** |
| push_logic | 84 | **75 (−10.7%)** |
| Largest gen bank | 13907 | **13818 (−89)** |

Oracle green. Artifacts:
`build/gbc/sokoban-cart-perf/specialized-dir-neighbor-mgba.json`.

**Rejected (same session):** paired-byte SRAM snapshot copy in firmware
`snapshotWrite`/`snapshotRead` — snapshot phase 14→18, whole turn 51.7→55.7.

### GBC specialized size-budget interpreter fallback (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

After link, if `check_gbc_rom` fails (16 KiB per-bank or 512 KiB total) while
`generated_specialized_turn.c` is present, firmware `build-rom` deletes the
specialized turn, patches the manifest
(`specialized_turn_fallback_reason=linked_rom_bank_or_total_over_budget`), and
relinks interpreter-only. Export also accepts `--no-specialized-turn`.

Smoke: Sokoban keeps specialized; push-pull falls back (bank 16433→6152) and
passes size checks.

Eligible-14 rebuild (`--cull --continue`): **14/14 ROMs**. Specialized retained on
`no-forbidden-symbols` and `pushy-v-pully-h` only; the other 12 fall back with
`linked_rom_bank_or_total_over_budget`.

**Retired (2026-07-25, `gbc-any-layer-coupled-codegen`):** firmware `build-rom`
no longer falls back to interpreter on size-check failure; ROM builds fail hard
instead. `scripts/gbc_manifest_disable_specialized.py` remains for manual use
only.

### GBC good_games cull audit after any/layer-coupled specialized emit (2026-07-25)

Revision: `gbc-any-layer-coupled-codegen` (`scripts/audit_gbc_good_games_export.py --cull`).

| First-fail class | Before (cull audit) | After |
| --- | ---: | ---: |
| **export OK** | **14** | **35** |
| any/layer-coupled | 50 | **0** |
| board cull-all | 54 | 54 |
| object_count (>32) | — | 27 |
| multi-row rules | — | 19 |
| dynamic replacements | — | 19 |
| other (invalid layer, etc.) | 41 mixed | 18 |
| ellipsis | — | 3 |
| movement layers (>6) | — | 3 |

Milestone A removed the entire any/layer-coupled first-fail wall (+21 structurally
exportable games with cull). Remaining rejects are honest later limits: oversized
boards culled to zero, object count, multi-row/dynamic rule shapes, and a long
tail of invalid-layer or property edge cases. Production `ELIGIBLE_GAMES` (14) was
unchanged at Milestone A; expanded to 32 after ROM validation (see below).

### GBC eligible promote after Milestone A (2026-07-25)

Validation: `scripts/validate_gbc_promote_candidates.py` (cull + specialized + ≤512 KiB).

| Result | Count | Notes |
| --- | ---: | --- |
| Cull export OK (audit) | 35 | from `good-games-export-audit-cull.json` |
| Already eligible | 14 | unchanged baseline |
| ROM-validated & promoted | 18 | listed below |
| ROM failed (not promoted) | 3 | reasons below |

**Promoted:** `all-green-and-blue-on-yellow`, `all-green-to-blue`, `attractor-net`, `chevron-lodger`, `crate-guardian`, `crate-swap`, `don't-let-your-goals-slip-away`, `explodoban`, `flesh-handed-hot-casserole-delivery-bot`, `hedgehog-stimulator`, `m-c-eschers-armageddon`, `match-maker`, `muraphilic-monophobic-multiban`, `resin-caster`, `slime-vat-filler`, `the-monsterous-autoshove`, `two-step-pete`, `unclean-residues`

**Not promoted (export OK, ROM fail):**

| slug | error |
| --- | --- |
| *(none — all three fixed-ROM fails promoted 2026-07-25; see below)* | |

`ELIGIBLE_GAMES` size is now **32**. Host solution-replay scoreboard for new titles is follow-up (not a promote gate).

### GBC fixed-ROM interpreter dead-code + promote batch (2026-07-25)

Revision: `gbc-followups-batch` (follow-ups batch).

**Problem:** Three Milestone-A export-OK titles failed `check_gbc_rom.py` on fixed ROM
bank high-water (~16405–16593 B vs 16384 B limit). Map diagnosis: ~4–5 KiB of
interpreter rule engine in `core.c` (`ps_gbc_pattern_matches` …
`ps_gbc_apply_turn_phases`) plus `ps_gbc_won` when specialized win is emitted —
all dead once `PS_GBC_HAS_SPECIALIZED_TURN` is set for shipping carts.

**Fix:**

1. `#if !PS_GBC_HAS_SPECIALIZED_TURN` around interpreter rule/turn paths in
   `native/src/gbc/core.c`; gate `ps_gbc_won` when `PS_GBC_GENERATED_SPECIALIZED_WON`.
2. `firmware/gbc/Makefile`: export stamp (`gbc_manifest.json`) before any `.o`
   build; link specialized TUs from `specialized_sources.list` (`.c` only);
   evaluate `PS_GBC_HAS_SPECIALIZED_TURN` for `core.o` at recipe time.

**Fixed ROM before → after (linked map, specialized retained, ROM ≤512 KiB):**

| slug | before (B) | after (B) | spare (B) |
| --- | ---: | ---: | ---: |
| an-ok-multiban-level | ~16593 | 12122 | 4262 |
| head-skuller | 16405 | 12379 | 4005 |
| the-red-ring-of-immortality | ~16593 | 12029 | 4355 |

**Promoted to `ELIGIBLE_GAMES`:** all three above (`an-ok-multiban-level` and
`head-skuller` were already on the branch list; `the-red-ring-of-immortality`
added). Validation: `scripts/validate_gbc_promote_candidates.py` — 3/3 pass.

Design note: `docs/superpowers/specs/2026-07-25-gbc-fixed-rom-interpreter-dead-code.md`.

### GBC Milestone B property/aggregate specialized emit (2026-07-25)

Revision: `gbc-followups-batch` (`6b3fc344`). Cull audit after emit:

| First-fail class | Before (post Milestone A) | After Milestone B |
| --- | ---: | ---: |
| **export OK** | **35** | **48** |
| property/aggregate | (in mixed tail) | **0** |
| board cull-all | 54 | 67 |
| object_count (>32) | 27 | 27 |
| multi-row rules | 19 | 25 |
| dynamic replacements | 19 | 0 (absorbed / reclassified) |
| ellipsis | 3 | 5 |
| movement layers (>6) | 3 | 3 |
| random | — | 2 |
| rom_budget | — | 1 |

+13 structurally exportable games with cull. Multi-row/cull-all rose as former
property/aggregate first-fails reclassified. Aggregate player still rejected.
ROM validation of newly OK titles is the next promote step.

### GBC eligible-46 rebuild green (2026-07-25)

`make gbc_eligible GBC_CONTINUE=1` on `gbc-followups-batch`: **46/46** specialized ROMs ≤512 KiB.

Object_count (>32) remains the largest structural wall (**27** first-fails); board cull-all is policy (**67**). No soft raise of `PS_GBC_MAX_OBJECTS` in this batch.

### GBC follow-ups second-wave promote after 2-row (2026-07-25)

| Result | Count |
| --- | ---: |
| Cull export OK | 62 |
| Eligible before wave | 37 |
| Candidates tested | 25 |
| ROM-validated & promoted | **9** |
| ROM failed | 16 |

**Promoted (ELIGIBLE now 46):** `crates-move-when-you-move`, `manic_ammo`, `no-forbidden-symbols-2`, `subway-upholstry-snot-smearing-championship`, `take-heart-lass`, `the-red-ring-of-immortality`, `two-tone-tango`, `wand-spinner`, `yellow-box`.



Unstuck `the-red-ring-of-immortality` (was fixed-ROM fail; now passes with current specialized omit + 2-row toolchain).

Remaining walls: object_count 27, board cull-all 67, multi-row (>2) 4, rom_budget/ellipsis/random/dynamic_replacement/movement_layers tail.

### GBC specialized 2-row rules (2026-07-25)

Revision: `gbc-followups-batch` (`503b30b7`). Cull audit:

| First-fail class | After Milestone B | After 2-row |
| --- | ---: | ---: |
| **export OK** | **48** | **62** |
| multi-row | 25 | **4** (>2 rows) |
| object_count (>32) | 27 | 27 |
| board cull-all | 67 | 67 |
| dynamic_replacement | 0 | 2 |
| ellipsis | 5 | 7 |
| rom_budget | 1 | 4 |

+14 export-OK from bounded 2-row specialized emit. Remaining multi-row are 3+ rows.

### GBC follow-ups promote after Milestone B + fixed-ROM omit (2026-07-25)

Revision: `gbc-followups-batch`. ROM gate unchanged (specialized + ≤512 KiB).

| Result | Count | Notes |
| --- | ---: | --- |
| Cull export OK after Milestone B | 48 | before 2-row land |
| Already eligible | 32 | post first promote |
| Candidates ROM-tested | 16 | OK − eligible |
| ROM-validated & promoted | **5** | listed below |
| ROM failed (not promoted) | 11 | fixed ROM / link / check failures |

**Promoted (ELIGIBLE now 37):** `an-ok-multiban-level`, `head-skuller`, `nightmarecroban`, `pipe-puffer`, `sokobond-demake`.

**Unstuck prior fixed-ROM fails:** `an-ok-multiban-level`, `head-skuller` (omit interpreter bodies). Still failing: `the-red-ring-of-immortality`.

**Also failed this wave:** `bicycle-kick-football`, `eyeball-watching-flowers-bloom`, `icecrates`, `ledchallenge`, `make-way`, `slide-pull`, `subway-upholstry-snot-smearing-championship`, `take-heart-lass`, `two-tone-tango`, `yellow-box`.

2-row specialized emit (`503b30b7`) landed after this candidate snapshot; re-audit/promote follow-up expected.

### GBC eligible host solution-replay scoreboard (2026-07-25)

Revision: `gbc-followups-batch`. Command: `make gbc_eligible_solutions_bench` /
`scripts/bench_gbc_eligible_solutions.py --skip-rom --reuse-fixtures --max-levels 3`.

Artifact: `build/gbc/eligible/solution-bench-compare.json` (host desktop wall-clock; not cart).

| Metric | Value |
| --- | ---: |
| Games attempted | 32 |
| Games with ≥1 level solved+benched+won | **24** |
| Levels OK | 55 |
| Mean specialized speedup (over games with data) | **+34.7%** |

Games with no successful host replay level this run (solver miss, baseline/specialized lose, or bench error): `all-green-and-blue-on-yellow`, `all-green-to-blue`, `chevron-lodger`, `crate-guardian`, `don't-let-your-goals-slip-away`, `flesh-handed-hot-casserole-delivery-bot`, `muraphilic-monophobic-multiban`, `unclean-residues`.

Notable: several titles show specialized *slower* on host (`m-c-eschers-armageddon` −81%, `resin-caster` −45%, `recondite` −11%) — host ms is not cart timing; keep for triage only.

### GBC specialized turn → dedicated bank 3 (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

`generated_specialized_turn.c` now `#pragma bank 3` (was bank 1, shared with UI +
`generated_game.c`). Façade stays bank 2. Host exporter test asserts bank 3;
`puzzlescript_gbc_specialized_oracle_smoke` green.

Eligible-14 (`make gbc_eligible --cull`): **6/14 specialized** (was 2/14).

| Kept specialized | `_CODE_3` |
| --- | ---: |
| pushy-v-pully-h | 6555 |
| 15-push-pull-levels | 9408 |
| push-pull | 10281 |
| i-am-a-gust-of-wind | 10278 |
| no-forbidden-symbols | 10378 |
| fickle-fred | 10975 |

Still fallback (largest bank on failed specialized link): pushit 19876,
short-adventure 20487, recondite 22093, dollyban 23472, voitex 27392,
gapfiller 30296, slot-machine 33126, xorro 69551.

Next: multi-bank specialized emit (early / late+resolve) for the remaining 8.

### GBC specialized turn multi-bank rule packs (2026-07-24)

Revision: working tree on `gbc-specialized-turn-codegen`.

Split unrolled specialized rules into `generated_specialized_turn_rules_<N>.c`
(bank 4+N, greedy ~45 KiB source packs) when total rule source exceeds ~60 KiB;
smaller games stay a single bank-3 TU. Multi-pack layout:

- Bank 3: entry, WRAM globals, BANKED helpers (stubs only in home), resolve/won,
  phase apply
- Bank 4+: static rules + one BANKED `ps_gbc_specialized_rule_pack_N` dispatcher
  per pack (not per-rule BANKED — that blew fixed ROM with stub count)
- Level W×H duplicated per TU (safe ROM-local consts)

Eligible-14 (`make gbc_eligible --cull`): **14/14 specialized**.

| Note | Value |
| --- | --- |
| Retention | **14/14** (was 2/14 pre bank-3; 6/14 after bank-3; 10/14 after first multi-pack) |
| Largest gen bank (xorro) | 10157 (`_CODE_7`) |
| Xorro banks used | `_CODE_1`…`_CODE_10` (UI/game/façade/specialized packs) |

Oracle + exporter tests green. Phase-1 size goal for the eligible-14 is met.

### GBC co-located core/data bank bridge (2026-07-26)

Revision: `ba66baf3`. Commands:

- `make gbc_eligible GBC_CONTINUE=1`
- `python3 scripts/bench_gbc_eligible_solutions.py --skip-rom --max-levels 2`
- `make gbc_smoke GBC_EXPORT_FLAGS='--bank-base 7'`
- `make gbc_smoke`

The eligible corpus now runs the linked-ROM structural gate for every game. The
specialized cart build omits duplicate interpreter rule tables while retaining
the tables in non-specialized builds, keeping the approved generated core and
game data co-located in the computed game-core bank.

| Metric | Result |
| --- | ---: |
| Eligible ROMs linked and checked | **46/46** |
| Foundation HOME high-water range | **5670–5678 B** |
| Largest switchable bank | **15163 B** (`sokobond-demake`, bank 2) |
| Highest linked bank number | **15** |
| Core object ownership in computed bank 2 | **46/46** |
| Game object ownership in computed bank 2 | **46/46** |
| Forbidden shared→generated references | **0/46** |
| Generated object static WRAM users | **0/46** |

The strengthened corpus gate initially exposed three real bank-2 overflows.
Omitting the redundant specialized-cart interpreter tables reduced their final
largest banks to 15163 B (`sokobond-demake`), 13373 B (`manic_ammo`), and
13752 B (`wand-spinner`).

The two-level host solution comparison attempted 86 retained boards across 46
games. It produced **45 winning baseline+specialized replays across 26 games**,
with no win disagreement among successful comparisons. The remaining samples
were 3 solver timeouts, 37 baseline replay non-wins, and one specialized non-win
(`no-forbidden-symbols-2`). The latter was reproduced unchanged at `fe61a6ec`,
before the duplicate-table omission, so it is a pre-existing specialized gap
rather than a bank-bridge regression.

Live libmGBA smoke passed for both layouts:

- Standard: core/game bank 2, façade bank 3, specialized bank 4.
- Shifted: core/game bank 7, façade bank 8, specialized bank 9.

Both smokes passed the ROM structural checks, generated-reference/static-WRAM
gates, emulator warning gate, title/board rendering checks, and deterministic
player-movement assertion.

### GBC 46-game compilation cartridge (2026-07-27)

Revision: `master` after `e8cc453f`. Commands:

- `make gbc_cart GBDK_HOME=.codex_tmp/toolchains/gbdk`
- `python3 scripts/check_gbc_cart.py build/gbc/cart/puzzlescript-compilation-46.gb build/gbc/cart/cart-manifest.json build/gbc/cart/puzzlescript-compilation-46.map build/gbc/cart/objects`
- `make gbc_cart_smoke GBDK_HOME=.codex_tmp/toolchains/gbdk`

The production MBC5 cartridge now contains a launcher and all 46 eligible
games. Generated symbols are namespaced per game, core/data groups retain
dedicated descriptor banks, and façade/specialized objects are packed
first-fit-decreasing into the remaining bank space.

| Metric | Result |
| --- | ---: |
| Games linked / specialized | **46 / 46** |
| ROM size | **4,194,304 B** |
| Fixed HOME high-water | **6,377 B** |
| Packed game banks | **116** (banks 3–118) |
| Packed payload / capacity | **1,875,865 / 1,900,544 B (98.7%)** |
| Largest switchable bank | **16,384 B** |
| Maximum shared session arena | **1,242 B** |
| Unique game prefixes / hashes | **46 / 46** |
| Per-game static WRAM offenders | **0** |

Scripted libmGBA smoke passed launcher → game 1 → launcher → game 2 with
two distinct source hashes, one recorded return, LCD enabled, 107 nonzero
tile-map cells, and 3 emulator warnings (within the existing ceiling).
The exact production ROM also passed a 180-frame launcher boot with LCDC
`0xc1`, 195 nonzero tile-map cells, and zero emulator warnings.

### GBC VBlank dirty-map span batching rejected (2026-07-28)

Revision: uncommitted candidate on `4cf6842f`. Transient three-boot artifact
labels (not retained): `vblank-map-counts` and `vblank-map-phases`, measured
with the same relative compiler and GBDK paths as the Task 2 probes. The
Homebrew mGBA executable was specified because the `/Applications` launcher
exited before publishing SRAM; the candidate ROM published all expected
records under both libmGBA and Homebrew mGBA.

The prototype staged dirty 2×2 logical cells as per-row physical tile spans,
then flushed all tile numbers in VBK bank 0 and all attributes in VBK bank 1
immediately after the game loop's existing `vsync()`. The smoke counter defined
this as exactly two data-bank passes; restoring VBK bank 0 was not a third
pass. The pre-change one-cell probe failed at eight selections, and the
prototype passed at two. Live smoke also retained LCD-on incremental rendering
with zero map, attribute, palette, tile-upload, or unexpected-blanking errors.
The existing `vsync()` boundary meant no additional frame wait.

Count-only interaction redraws nevertheless regressed everywhere:

| Case | Task 2 walk/push | Span flush walk/push | Delta walk/push |
| --- | ---: | ---: | ---: |
| sokoban | 57 / 68 | 70 / 75 | +13 / +7 |
| large_board | 514 / 517 | 530 / 527 | +16 / +10 |
| rule_heavy | 53 / 52 | 66 / 62 | +13 / +10 |
| object_heavy | 476 / 465 | 536 / 527 | +60 / +62 |
| two_movement_lanes | 92 / 92 | 105 / 102 | +13 / +10 |

Diagnostic phases did confirm that the intended work was removed:

| Aggregate walk + push phase | Task 2 | Span flush | Delta |
| --- | ---: | ---: | ---: |
| compose | 130 | 130 | 0 |
| cache lookup | 194 | 197 | +3 |
| encode | 686 | 686 | 0 |
| tile upload | 24 | 21 | −3 |
| map write | 569 | 433 | **−136 (−23.9%)** |
| all attributed phases | 1,603 | 1,467 | −136 |

Phase-probe overhead over the count-only headline was respectively
`+6/+8`, `+16/+12`, `+6/+6`, `+69/+65`, and `+6/+6` walk/push ticks for the
five cases. The count-only result therefore remains the retention authority.
The most plausible measured explanation is that the two BANKED API calls and
two 18-row scans outweighed the saved per-tile VBK selections and STAT polls,
especially when spans contained gaps.

All non-performance gates passed before rejection: focused parser and
benchmark tests, 17 native GBC tests, seven cart-related Python suites, all 753
Node tests, live renderer smoke, the nine-game cart smoke, and the full
46-game production cart/checker. Production static WRAM was 5,959 / 6,144
bytes (+37, below the 6,080 contingency), fixed HOME was 7,062 / 8,192
(+42), and banked renderer code grew by 297 bytes. Packed game payload stayed
2,398,105 bytes across 148 banks and the ROM stayed 4 MiB.

**Decision: reject.** Both required map-heavy cases became slower, so no
renderer, smoke, parser, or benchmark source change is retained. Tile upload
was still only 21 / 1,467 attributed ticks (1.4%); the conditional DMA variants
were not attempted.

### GBC direct early pattern rejection rejected (2026-07-28)

Revision: uncommitted candidate on `c2ab4989`. Transient artifacts (not
retained) were `codegen-metrics-early-reject.json` and the three-boot
`early-reject-counts` suite. The candidate replaced stack-resident
`row_matched` flags with direct `return false` rejection in non-fused helpers
and `break` from collision-safe `do { ... } while (false)` wrappers in fused,
row-collection, and two-row paths.

The required structural red test failed on the old Sokoban output. After the
change, exporter and specialized-oracle parity passed, as did the any-mask,
layer-coupled, and general GBC parity smokes. The full production cart compiled
and linked all 46 games, and its checker passed. Property/aggregate capture
ordering, collect-all behavior, scan advancement, and two-row revalidation
remained covered by the generated fixtures and host oracles.

Static code results were substantial:

| Metric | Task 2 baseline | Early rejection | Delta |
| --- | ---: | ---: | ---: |
| Packed payload | 2,398,105 B | 2,335,688 B | **−62,417 B (−2.60%)** |
| Allocated payload | 2,424,832 B | 2,375,680 B | −49,152 B |
| Packed banks / highest bank | 148 / 150 | 145 / 147 | −3 / −3 |
| Physical 4 MB headroom | 1,747,047 B | 1,809,464 B | +62,417 B |
| Fixed HOME | 7,020 B | 7,020 B | 0 |
| Static WRAM | 5,922 B | 5,922 B | 0 |
| Frame mean / median / max | 30.097 / 32 / 128 B | 28.510 / 30 / 128 B | −1.587 / −2 / 0 B |
| `ldhl sp` instructions | 125,200 | 112,278 | **−12,922 (−10.32%)** |
| Estimated `ldhl sp` bytes | 250,400 B | 224,556 B | −25,844 B |

The same five count-only cases were then run for three byte-identical boots
each using Homebrew mGBA 0.10.5. Render sampling was neutral or one tick
different, but the logic result was mixed:

| Case | Task 2 logic | Early-reject logic | Delta | Task 2 walk/push | Early-reject walk/push |
| --- | ---: | ---: | ---: | ---: | ---: |
| sokoban | 44.602 | 44.602 | 0.00% | 57 / 68 | 57 / 68 |
| large_board | 104.125 | 90.438 | −13.15% | 514 / 517 | 514 / 517 |
| rule_heavy | 853.023 | 701.531 | −17.76% | 53 / 52 | 53 / 53 |
| object_heavy | 1,149.805 | 1,300.383 | **+13.10%** | 476 / 465 | 475 / 465 |
| two_movement_lanes | 2,440.359 | 2,161.203 | −11.44% | 92 / 92 | 92 / 91 |

At the 4,096 Hz timer rate, the `object_heavy` regression is +150.578
ticks/turn, or about **36.76 ms**. An alternating direct A/B check ran the
preserved Task 2 and candidate ROMs in baseline/candidate order three times.
Every pair reproduced `object_heavy` 1,149.805 → 1,300.383 logic ticks and
`rule_heavy` 53/52 → 53/53 render ticks, so neither difference is emulator
launch noise or run ordering.

**Decision: reject.** The 62 KB payload reduction, smaller frames, and three
logic wins do not justify a deterministic 13.10% regression in a required
representative case. No emitter or exporter-test source change is retained.

### GBC generated board/movement base-pointer hoist rejected (2026-07-28)

Revision: uncommitted candidate on `947ef126`. Transient artifacts (not
retained) were `codegen-metrics-hoist.json`, the three-boot
`board-pointer-hoist-counts` suite, and direct alternating A/B object-heavy
records. The candidate emitted one
`uint8_t* const board = session->board;` and one
`uint8_t* const movements = session->movements;` per generated rule function,
then routed board and movement reads/writes through those bases. Non-rule
callers retained explicit `session->board` and `session->movements` access,
and collect-all helpers received the two bases from their owning rule.

The required structural test first failed on the old Sokoban output. After
the change, exporter and specialized-oracle parity passed, as did the
any-mask, layer-coupled, and general GBC parity smokes. The assertions covered
Sokoban, layer-coupled apply, aggregate binding, multi-row, property,
collect-all, and two-byte object/movement storage. The full production cart
compiled and linked all 46 games, and its structural checker passed.

Generated C contained exactly one pointer pair at rule-function scope with no
direct session storage indexing in the rule bodies. Object-heavy assembly
showed SDCC placing both pointers in the rule's stack frame and accessing
them via `ldhl sp`; the hoist avoided repeated structure traversal but did not
keep the bases resident in registers.

Static code results improved substantially:

| Metric | Task 2 baseline | Base-pointer hoist | Delta |
| --- | ---: | ---: | ---: |
| Packed payload | 2,398,105 B | 2,287,366 B | **−110,739 B (−4.62%)** |
| Allocated payload | 2,424,832 B | 2,326,528 B | −98,304 B |
| Packed banks / highest bank | 148 / 150 | 142 / 144 | −6 / −6 |
| Physical 4 MB headroom | 1,747,047 B | 1,857,786 B | +110,739 B |
| Fixed HOME | 7,020 B | 7,020 B | 0 |
| Static WRAM | 5,922 B | 5,922 B | 0 |
| Frame mean / median / max | 30.097 / 32 / 128 B | 27.873 / 29 / 128 B | −2.224 / −3 / 0 B |
| `ldhl sp` instructions | 125,200 | 106,291 | **−18,909 (−15.10%)** |
| Estimated `ldhl sp` bytes | 250,400 B | 212,582 B | −37,818 B |

The same five count-only cases then ran for three byte-identical boots each
under Homebrew mGBA 0.10.5:

| Case | Task 2 logic | Base-pointer logic | Delta | Task 2 walk/push | Base-pointer walk/push |
| --- | ---: | ---: | ---: | ---: | ---: |
| sokoban | 44.602 | 44.297 | −0.68% | 57 / 68 | 57 / 67 |
| large_board | 104.125 | 94.805 | −8.95% | 514 / 517 | 514 / 518 |
| rule_heavy | 853.023 | 752.383 | −11.80% | 53 / 52 | 53 / 52 |
| object_heavy | 1,149.805 | 1,253.609 | **+9.03%** | 476 / 465 | 476 / 464 |
| two_movement_lanes | 2,440.359 | 2,252.047 | −7.72% | 92 / 92 | 92 / 92 |

At the 4,096 Hz timer rate, the `object_heavy` regression is +103.805
ticks/turn, or about **25.34 ms**. An alternating direct A/B check ran the
preserved Task 2 and candidate object-heavy ROMs in
baseline/candidate order three times. Every baseline run produced 1,149.805
logic ticks and every candidate run produced 1,253.609, with byte-identical
results within each side, excluding launch noise and run ordering.

**Decision: reject.** The 111 KB payload reduction and four logic wins do not
justify a deterministic 9.03% regression in a required representative case.
No emitter or exporter-test source change is retained.

### GBC collect-all matcher scan inlining rejected (2026-07-29)

Revision: uncommitted candidate on `d7785615`. Transient artifacts (not
retained) were `codegen-metrics-matches-at-inline.json`, the three-boot
`matches-at-inline` suite, and three alternating direct A/B rule-heavy
pairs.

Task 8's original sketch called for a `do/while` direct-rejection body, but
that depended on the rejected and fully reverted early-rejection experiment.
To keep this experiment isolated, the candidate instead emitted the current
`row_matched` matcher logic verbatim inside a lexical block at each
collect-all scan site. Full-grid, single-player-offset, and player-cell-anchor
plus fallback branches appended successful starts to
`session->match_cells[match_count]` in their existing order. Two-row rules,
fused match/apply rules, command handling, duplicate behavior, and the later
apply loop were unchanged.

The structural test first failed on the existing `_matches_at` symbol. After
the candidate, concatenated specialized sources contained no such helper or
call and covered all three scan shapes plus two-byte object and movement
loads. Exporter, specialized-oracle, any-mask, layer-coupled, and general GBC
parity tests passed. Generated C inspection confirmed lexical scoping,
unchanged candidate ordering, and append-only-after-`row_matched` behavior.
All 46 production games compiled and linked, and the cartridge structural
checker passed.

Static code size improved:

| Metric | Task 2 baseline | Matcher inlining | Delta |
| --- | ---: | ---: | ---: |
| Packed payload | 2,398,105 B | 2,332,472 B | **−65,633 B (−2.74%)** |
| Allocated payload | 2,424,832 B | 2,359,296 B | −65,536 B |
| Packed banks / highest bank | 148 / 150 | 144 / 146 | −4 / −4 |
| Physical 4 MB headroom | 1,747,047 B | 1,812,680 B | +65,633 B |
| Fixed HOME | 7,020 B | 7,020 B | 0 |
| Static WRAM | 5,922 B | 5,922 B | 0 |
| Framed rule/helper functions | 1,371 | 1,040 | −331 |
| Frame mean / median / max | 30.097 / 32 / 128 B | 37.808 / 36 / 128 B | +7.711 / +4 / 0 B |
| `ldhl sp` instructions | 125,200 | 118,754 | **−6,446 (−5.15%)** |
| Estimated `ldhl sp` bytes | 250,400 B | 237,508 B | −12,892 B |

The larger average frame is not directly like-for-like: removing the small
helper frames leaves only the larger rule functions in that population. The
total `ldhl sp` count and linked payload remain the useful aggregate results.

The exact five count-only cases then ran for three byte-identical boots each
under Homebrew mGBA 0.10.5:

| Case | Task 2 logic | Matcher-inlined logic | Delta | Task 2 walk/push | Matcher-inlined walk/push |
| --- | ---: | ---: | ---: | ---: | ---: |
| sokoban | 44.602 | 44.602 | 0.00% | 57 / 68 | 57 / 68 |
| large_board | 104.125 | 98.531 | −5.37% | 514 / 517 | 514 / 517 |
| rule_heavy | 853.023 | 874.070 | **+2.47%** | 53 / 52 | 53 / 53 |
| object_heavy | 1,149.805 | 1,149.742 | −0.01% | 476 / 465 | 477 / 464 |
| two_movement_lanes | 2,440.359 | 2,440.414 | +0.00% | 92 / 92 | 91 / 92 |

At the 4,096 Hz timer rate, the `rule_heavy` regression is +21.047
ticks/turn, or about **5.14 ms**. Three alternating direct A/B pairs ran the
preserved Task 2 and candidate ROMs in baseline/candidate order. Every
baseline produced 853.023 logic ticks and 53/52 rendering; every candidate
produced 874.070 and 53/53. The regression is therefore deterministic rather
than emulator launch noise or run ordering.

**Decision: reject.** The 65.6 KB payload reduction, lower aggregate stack
addressing, and large-board win do not justify a reproducible 2.47%
regression in a required representative case. No emitter or exporter-test
source change is retained.

### GBC shared specialized-rule scratch rejected (2026-07-29)

Revision: uncommitted candidate on `73801d7b`. Transient artifacts (not
retained) were the 46-game `task9-cart-candidate` build, the three-boot
`task9-shared-scratch-counts` suite, and three alternating direct A/B pairs
for each materially regressed case.

Task 9 re-tested file-scope scratch against the much larger specialized-rule
frames. Under a disabled-by-default emitter switch, selected scalar locals
(`session`, `commands`, `cell`, `match_count`, `match_index`, `delta`, and
`changed`) referred to one exact shared `ps_gbc_specialized_scratch` object.
Arrays, property and aggregate captures, and row-match arrays remained
stack-local. The candidate linked that one unnamespaced object once in
firmware and in the explicitly enabled desktop oracles; normal desktop builds
kept the existing local path.

The focused generated-rules `_BSS` fixture passed immediately because the
cart checker already enforced the intended invariant across every `gNN_*`
object; it added exact coverage rather than a new behavioral failure. The
checker also passed the candidate's full 46-game cartridge. Every `gNN_*`
object had zero `_DATA/_BSS`, while the one shared object contributed nine
bytes of static WRAM. Structural exporter tests established that specialized
rule bodies do not call one another, and source inspection established that
the firmware timer interrupt does not enter specialized rules. Exporter,
specialized, any-mask, layer-coupled, solution-replay, command/sound, and
cart structural checks passed. The automatic retention gate failed after the
full cart and runtime measurements. The separate eligible-ROM sweep was
therefore explicitly waived as an early-stop optimization; this is not a
claimed eligible-gate pass. The stronger full production-cart build had
already compiled and linked all 46 sources, and no candidate code could be
retained after the measured failures.

Static code shape improved, but linked cartridge size did not:

| Metric | Task 2 baseline | Shared scratch | Delta |
| --- | ---: | ---: | ---: |
| Packed payload | 2,398,105 B | 2,453,124 B | **+55,019 B (+2.29%)** |
| Allocated payload | 2,424,832 B | 2,490,368 B | +65,536 B |
| Packed banks / highest bank | 148 / 150 | 152 / 154 | +4 / +4 |
| Physical 4 MB headroom | 1,747,047 B | 1,692,028 B | −55,019 B |
| Fixed HOME | 7,020 B | 7,020 B | 0 |
| Static WRAM | 5,922 B | 5,931 B | +9 B |
| Framed rule functions | 1,371 | 1,387 | +16 |
| Frame mean / p90 / max | 30.097 / 50 / 128 B | 26.014 / 44 / 128 B | −4.083 / −6 / 0 B |
| `ldhl sp` instructions | 125,200 | 105,965 | **−19,235 (−15.36%)** |
| Estimated `ldhl sp` bytes | 250,400 B | 211,930 B | −38,470 B |

The exact five count-only cases then ran for three byte-identical boots each
under Homebrew mGBA 0.10.5:

| Case | Task 2 logic | Shared-scratch logic | Delta | Task 2 walk/push | Shared-scratch walk/push |
| --- | ---: | ---: | ---: | ---: | ---: |
| sokoban | 44.602 | 44.680 | +0.17% | 57 / 68 | 57 / 67 |
| large_board | 104.125 | 108.453 | **+4.16%** | 514 / 517 | 514 / 518 |
| rule_heavy | 853.023 | 942.242 | **+10.46%** | 53 / 52 | 53 / 53 |
| object_heavy | 1,149.805 | 1,186.336 | **+3.18%** | 476 / 465 | 476 / 464 |
| two_movement_lanes | 2,440.359 | 2,425.969 | −0.59% | 92 / 92 | 92 / 92 |

At the 4,096 Hz timer rate, the largest regression is `rule_heavy` at
+89.219 ticks/turn, or about **21.78 ms**. Three alternating direct A/B
pairs were then run for `large_board`, `rule_heavy`, and `object_heavy`.
Every baseline and candidate run reproduced its side's exact suite value, so
the regressions are deterministic rather than emulator launch noise or run
ordering.

**Decision: reject.** The experiment fails both halves of the retention rule:
three required representative cases regress materially, and packed payload
grows despite the smaller frames and lower stack-addressing count. The
scratch header/source, build wiring, emitter switch, and candidate tests were
fully removed; no dormant scratch subsystem is retained.

### GBC compilation-cart solution scoreboard (2026-07-29)

Revision: Task 10 implementation on `codex/gbc-extended-optimization`.
Artifact:
`build/gbc/cart/solution-bench-cart.json` (generated, not checked in).
Timing source: CGB 4,096 Hz hardware timer via in-process libmGBA.

The compilation cart now has a benchmark-only build mode. Generated game and
rule objects are unchanged; shared firmware starts an accumulator on a
direction/action press, includes all pending-`again` steps and corresponding
dirty renders, finalizes on the next press or win, and commits a versioned
32-byte record to SRAM bank 3 offset 512. The host harness imports the
canonical 46-game manifest, reuses or solves each first retained board,
launches one fresh emulator per game, and records failures instead of
dropping them.

The shipping-scale benchmark cart passed the structural checker:

| Metric | Production | Benchmark | Delta / result |
| --- | ---: | ---: | ---: |
| Games | 46 | 46 | all indexed |
| Packed game banks | 148 | 148 | unchanged |
| Fixed HOME | 7,020 B | 7,543 B | +523 B; below 8,192 B |
| Static WRAM | 5,922 B | 5,965 B | +43 B; below 6,080 B |
| Banked payload | 2,419,100 B | 2,420,020 B | +920 B shared instrumentation |
| Generated game/rule objects | 381 | 381 | 381 byte-identical; 0 mismatches |

Two complete fresh-boot sweeps reproduced every successful
`logic_ticks`/`render_ticks`/`max_turn_ticks` tuple and both worst-ten orders
exactly:

| Aggregate | Result |
| --- | ---: |
| Successful / total games | 36 / 46 |
| Measured user turns | 848 |
| Redraws | 904 |
| Weighted logic ticks/turn | 507.532 |
| Weighted interaction ticks/turn | 724.519 |
| Weighted render ticks/redraw | 203.545 |

The ranked cartridge targets are:

| Rank | Logic ticks/turn | Interaction ticks/turn |
| ---: | --- | --- |
| 1 | `sokobond-demake` 4,808.833 | `sokobond-demake` 5,283.500 |
| 2 | `wand-spinner` 2,554.867 | `wand-spinner` 2,939.800 |
| 3 | `m-c-eschers-armageddon` 1,702.500 | `take-heart-lass` 2,430.000 |
| 4 | `manic_ammo` 1,545.000 | `m-c-eschers-armageddon` 2,027.250 |
| 5 | `the-monsterous-autoshove` 941.351 | `attractor-net` 1,695.837 |
| 6 | `take-heart-lass` 941.000 | `manic_ammo` 1,677.667 |
| 7 | `short-adventure-in-sticky-wall-land` 897.060 | `short-adventure-in-sticky-wall-land` 1,667.000 |
| 8 | `xorro-the-chaos-warden` 886.375 | `the-monsterous-autoshove` 1,181.514 |
| 9 | `head-skuller` 806.029 | `xorro-the-chaos-warden` 1,002.417 |
| 10 | `match-maker` 787.941 | `match-maker` 985.059 |

Ten games remain explicit failures. `slot-machine` produces a zero-turn
record and `voitex-rasteriser` times out while solving. Eight solved fixtures
do not publish a cart win. A bounded fresh-export host-GBC replay classified
them without expanding Task 10 into game fixes:

| Game | Fixture turns | Host baseline | Host specialized | Classification |
| --- | ---: | --- | --- | --- |
| `crate-guardian` | 46 | no win | no win | existing GBC fixture/core divergence |
| `hedgehog-stimulator` | 47 | no win | win | cartridge/integration follow-up |
| `the-red-ring-of-immortality` | 15 | no win | win | cartridge/integration follow-up |
| `unclean-residues` | 35 | no win | win | cartridge/integration follow-up |
| `pipe-puffer` | 30 | win | win | cartridge/integration follow-up |
| `no-forbidden-symbols-2` | 48 | win | no win | existing specialized divergence |
| `two-tone-tango` | 27 | no win | no win | existing GBC fixture/core divergence |
| `yellow-box` | 43 | win | win | cartridge/integration follow-up |

Validation passed the scoreboard/build-mode unit contracts, the full
structural/capacity checker, all 17 native GBC tests, all 753 JS tests, and
the nine-game cart smoke (two launches, one return, distinct game hashes).
The legacy PERF ROM also published and parsed its complete main,
interaction, and render-detail records through fixed-frame libmGBA
(128 iterations, 5,709 logic ticks). The external macOS mGBA application
save-polling path missed records for both the new and pre-Task10 control ROMs,
so that result is an environmental harness limitation rather than a retained
firmware regression.
