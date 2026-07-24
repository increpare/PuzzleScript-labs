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
