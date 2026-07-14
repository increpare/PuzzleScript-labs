# PuzzleScript GBA ROM

This target builds one precompiled PuzzleScript game per Game Boy Advance ROM.
The host compiler emits ROM-backed level/art data and pre-synthesized SFX; the
cartridge never parses PuzzleScript source or JSON.

## Prerequisites

- devkitPro with the GBA/devkitARM packages (`gba-dev`)
- Maxmod and `mmutil` from the same devkitPro installation
- the native `puzzlescript_cpp` host executable

From a devkitPro MSYS shell:

```sh
cd firmware/gba
make GAME=../../src/demo/sokoban_basic.txt
```

To place an image behind the title text, pass a PNG, JPEG, BMP, TGA, GIF, PSD,
HDR, PIC, or PNM file through `TITLE_IMAGE`:

```sh
make GAME=../../src/demo/sokoban_basic.txt TITLE_IMAGE=../../art/title.png
```

The exporter uses the first image frame, nearest-neighbour fits it inside
240x160 without changing its aspect ratio, and fills unused edges with the
game background color. Image colors are converted to GBA BGR555 and share the
Mode 4 palette with game art; export fails if the combined image exceeds 256
deduplicated colors.

Audio is disabled by default. This keeps unverified ROMs silent and avoids
unexpected full-volume output from emulator or hardware audio paths. After
checking the generated WAV files at a safe listening level, opt in with:

```sh
make AUDIO=1 GAME=../../src/demo/sokoban_basic.txt
```

Opt-in audio uses a reduced Maxmod effects master volume; exported samples are
DC-centered, edge-faded, and capped at one eighth of PCM full scale.

The default Windows host compiler path is
`../../build/native/Release/puzzlescript_cpp.exe`; override
`PUZZLESCRIPT_CPP` when using another build or host OS. The result is
`puzzlescript_gba.gba` plus a linker map checked against the ROM, EWRAM, and
IWRAM limits.

The firmware enables the GBA Game Pak prefetch buffer and standard safe wait
states by default. This matters for the generated rule kernels, which execute
from cartridge ROM.

## Cycle benchmark

An opt-in benchmark ROM measures one right-input step and one complete Mode 4
redraw with cascaded GBA hardware timers. It runs 16 samples by default from a
repeatable level state and reports averages, minima, and maxima in CPU cycles,
milliseconds, and 59.7 Hz frame periods. It also reports a framebuffer hash so
renderer A/B tests can verify pixel-identical output. Benchmark ROMs reserve
timers 2 and 3 and therefore must be built with audio disabled.

Build and run one from the repository root with:

```sh
cd firmware/gba
make clean
make PERF_BENCHMARK=1 AUDIO=0 GAME=../../src/tests/solver_tests/zokoban.txt
cd ../..
python scripts/run_gba_benchmark.py firmware/gba/puzzlescript_gba.gba \
  --out build/gba/perf/zokoban.json
```

`make clean` is required when changing benchmark compiler switches because Make
does not track command-line flag changes as object dependencies. To reproduce a
no-prefetch baseline, add `ROM_PREFETCH=0`; normal builds use
`ROM_PREFETCH=1`. The runner uses mGBA's debug-register protocol for immediate
headless results while also writing the same versioned record to SRAM for real
hardware measurements. Benchmark mode is absent from ordinary ROMs.

`PERF_ITERATIONS=N` changes the sample count, and `PERF_RENDER_ONLY=1` skips
rule-step timing for pathological renderer stress cases. `RENDER_SET_BITS=0`
restores the old cells-times-all-objects renderer for an A/B baseline; normal
ROMs enumerate only the object bits present in each cell.
`RENDER_PACKED_BLIT=0` restores the old per-pixel/per-rectangle rasterizer;
normal ROMs pack two Mode 4 pixels per halfword and keep the hot row writer in
IWRAM.

To inspect an export without invoking `mmutil`:

```sh
../../build/native/Release/puzzlescript_cpp.exe export-gba \
  ../../src/demo/sokoban_basic.txt --out generated --no-mmutil
```

## Current compatibility profile

The ROM compiles and links each game's generated native compact-turn kernel.
There is no object-name or Sokoban-shape detector: movement, replacements,
late/rigid/random rules, commands, win conditions, `again`, and realtime ticks
come from the compiled PuzzleScript rules. The `src/tests/solver_tests` audit
currently exports all 184 games that fit 240x160. Small games retain 32 undo
snapshots; oversized boards receive the largest nonzero undo ring that fits the
160 KiB session ceiling.

The generated kernel still uses libstdc++ containers for transient rule-match
scratch. It is linked without the compiler, JSON, solver, SDL, filesystem, or
threading, but replacing those transient allocations with a bounded EWRAM
scratch allocator remains a hardware-hardening task.

Controls are D-pad to move, A to start/continue/action, B to undo, R to restart,
and Start to return to the title. Progress is stored as a source-hashed,
checksummed current-level record in cartridge SRAM; in-level undo state remains
session-only.
