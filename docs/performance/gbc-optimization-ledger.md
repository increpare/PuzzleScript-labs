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
  tile-map upload, and palette upload loops.
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
