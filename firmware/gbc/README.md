# PuzzleScript Game Boy Color target

This target builds one precompiled PuzzleScript game per `.gb` cartridge. The
host compiler emits compact C tables; the cartridge runs a fixed-memory C
interpreter and never parses source or JSON.

## Requirements

- GBDK-2020 4.5 or newer
- a native `puzzlescript_cpp` build
- Python 3 for the post-link cartridge check

From a shell with `GBDK_HOME` set:

```sh
cd firmware/gbc
make GAME=../../src/demo/sokoban_basic.txt \
  PUZZLESCRIPT_CPP=../../build/native/Release/puzzlescript_cpp.exe
```

The output is `puzzlescript_gbc.gb`. It is marked CGB-only and uses an
MBC5+RAM+battery cartridge header with 32 KiB SRAM.

## Movement-storage performance benchmark

The guarded autotest benchmark runs 128 alternating turns, records CGB timer
ticks in SRAM, and compares the exported compact movement width with a forced
four-byte cell using the original direct 32-bit access:

```sh
make AUTOTEST=1 PERF_BENCH=1 PERF_WIDE=0
python ../../scripts/run_gbc_benchmark.py puzzlescript_gbc_autotest-perf-compact.gb

make AUTOTEST=1 PERF_BENCH=1 PERF_WIDE=1
python ../../scripts/run_gbc_benchmark.py puzzlescript_gbc_autotest-perf-wide.gb

# Add phase probes when diagnosing the whole-turn result. Keep them disabled
# for headline timing because the probes themselves have a measurable cost.
make AUTOTEST=1 PERF_BENCH=1 PERF_WIDE=0 PERF_PHASES=1
python ../../scripts/run_gbc_benchmark.py puzzlescript_gbc_autotest-perf-compact-phases.gb
```

Both ROMs reserve the same benchmark arena, so the comparison isolates
movement clearing and access width rather than changing the surrounding WRAM
layout. `PERF_WIDE` is a benchmark-only compatibility path; normal exports
always use the compact width selected by static analysis and compile a
width-specialized accessor for the exported game.

The representative optimization suite builds five fixed shapes (small,
large-board, rule-heavy, object-heavy, and two-movement-lane), requires
deterministic counters across independent emulator boots, and can compare a
candidate with a saved JSON baseline:

```sh
python ../../scripts/run_gbc_benchmark_suite.py \
  --repository ../.. --label working --runs 3 \
  --out ../../build-gbc-release/benchmarks/working.json

python ../../scripts/run_gbc_benchmark_suite.py \
  --repository ../.. --label candidate --runs 3 \
  --baseline ../../docs/performance/gbc-baseline.json \
  --out ../../build-gbc-release/benchmarks/candidate.json
```

Controls:

- D-pad: move
- A: action / continue
- B: undo
- Select: restart
- Start: title screen

Progress is stored in SRAM bank 0. Four in-level undo snapshots and one
checkpoint/restart snapshot share SRAM bank 1.

## Bounded v1 profile

The first hardware profile deliberately favors predictable memory use:

- at most 32 objects/collision layers and six movement-capable layers;
- board and viewport at most 20x18 (360 cells);
- fixed, single-row rules;
- up to four undo states;
- one 16 KiB switchable ROM bank for generated game data;
- no rigid, random, ellipsis, multi-row, dynamic-binding, aggregate-player,
  title-image, or audio support yet.

Compatibility is based only on compiled structures and memory budgets. Object
names and guessed game genres are never consulted. `export-gbc` reports the
first unsupported source rule with its line number.

Collision layers are retained exactly: they still control coexistence,
blocking, rules, levels, and rendering. A shared static-analysis pass finds
which collision layers can originate movement, then the exporter remaps only
those layers to compact movement lanes. Layers that can never move consume no
movement lane. One live lane uses one byte per board cell, two or three lanes
use two bytes, and four to six lanes use four bytes.

The hot board, compact movement plane, and match-bitset state stays below 4 KiB
of normal WRAM. Board snapshots live in cartridge SRAM because CGB extra WRAM
is exposed through a banked 4 KiB window rather than as one contiguous C
address range.

Rendering uses the CGB background tile hardware as a 20x18 tile framebuffer.
Each screen cell owns an 8x8 pattern in one of the two VRAM banks. Object
palettes are reduced to the eight hardware background palettes; colors from
lower transparent layers are remapped to the top visible object's palette.
