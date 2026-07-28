# GBC Extended Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce interaction and initial-render latency, shrink specialized
rule code, establish cartridge-native per-game timing, and preserve measured
capacity headroom while growing the 46-game GBC compilation cart.

**Architecture:** Add trustworthy render telemetry first, then optimize the
renderer without changing game semantics, followed by three separately gated
specialized-emitter experiments. Use a cartridge-native solution scoreboard
to judge the later size/speed trades. Keep every experiment independently
revertible and retain it only when it passes deterministic parity, memory, ROM,
and packed-payload gates.

**Tech Stack:** C11/SDCC through GBDK-2020 for the GBC runtime, C++17 for the
GBC exporter and specialized emitter, Python 3 for builds/measurements,
CMake/CTest for native tests, and libmGBA/mGBA for hardware-timer and render
smoke tests.

**Approved design and evidence:**
[`docs/performance/gbc-extended-optimization-plan-2026-07-27.md`](../../performance/gbc-extended-optimization-plan-2026-07-27.md)

---

## Scope and dependency order

This is one optimization program with four gated workstreams:

1. **Measurement:** Tasks 1-2. Nothing later lands without honest interaction
   render metrics and cart payload/frame metrics.
2. **Renderer:** Tasks 3-5. Task 2's render-phase split decides whether Tasks
   3, 4, or 5 is attempted first; the task numbering is not permission to skip
   that decision gate.
3. **Specialized emitter:** Tasks 6-9. Early rejection lands first. Pointer
   hoisting, helper fusion, and static scratch are independent experiments,
   each measured and committed or reverted separately.
4. **Shipping-cart capacity:** Tasks 10-12. The cart-native scoreboard must
   exist before direction sharing or any cross-bank sharing trade is judged.
   Task 13 records the 8 MB path as deferred while 4 MB headroom remains.

The source roadmap's capacity Task 8 intentionally does **not** become one
large implementation task here. Object sharing and directional-body sharing
have different ABIs and failure modes, so they remain separate experiments.
The former 8 MB spike is removed from active execution after revalidation.

| Source roadmap | This implementation plan |
| --- | --- |
| Task 0: harness paths | Task 1 |
| Task 1: render probes/metrics | Task 2 |
| Task 2: composition bank overhead | Task 3 (safe WRAM-staging form) |
| Task 3: dynamic cache | Task 4 |
| Task 4: VBlank batching | Task 5 |
| Task 5: early rejection | Task 6 |
| Task 6a/6b/6c: register pressure | Tasks 7/8/9 |
| Task 7: cart scoreboard | Task 10 |
| Task 8a/8b: optional size experiments | Tasks 11/12 |
| Task 8c: 8 MB | Task 13 (defer/reopen gate only) |
| Standing gates and roadmap closure | Task 14 |

## Corrections and 2026-07-28 master revalidation

Two source-roadmap sketches are unsafe as written:

- `tile_cache.c` is compiled into switchable ROM bank 1. It cannot enter the
  active game's data bank and continue executing the renderer, because
  selecting the game bank removes the renderer's own code from
  `0x4000-0x7fff`. Task 3 therefore stages the bounded render assets into
  shared WRAM once per game instead of holding the game bank across a render.
- Bundled GBDK 4.5 documents `SWITCH_ROM_MBC5` and SDCC `BANKED` calls as
  8-bit-bank/4 MB mechanisms. `SWITCH_ROM_MBC5_8M` neither updates
  `CURRENT_BANK` nor supports SDCC banked calls.

Master `980ce35b` adds 522,240 bytes of pre-rendered launcher art and tested
fixed-bank ROM/WRAM-to-VRAM DMA helpers. The production cart now reports:

| Metric | Revalidated baseline |
| --- | ---: |
| games | 46 |
| packed payload | 2,398,105 bytes |
| allocated payload banks | 148 |
| allocated-bank fill | 98.90% |
| highest used bank | 150 |
| physical 4 MB headroom after payload | 1,747,047 bytes |
| fixed ROM | 7,020 / 8,192 bytes |
| static WRAM | 5,922 / 6,144 bytes |

These commits leave `tile_cache.c`, the benchmark tools, and the specialized
emitter unchanged, so Tasks 1-2 and 6-10 remain valid. They do change the
renderer and capacity execution:

- Task 3 cannot add 1,516 bytes of renderer globals. After Task 2 supplies
  measurements, renderer staging requires its own approved phase-overlay
  design that reuses launcher-only memory while a game is active.
- Task 4's larger cache has the same constraint and belongs in that overlay
  design.
- Task 5 must reuse `ps_gbc_rom_vram_dma_hblank()` and
  `ps_gbc_wram_vram_dma_hblank()` instead of adding another DMA mechanism.
- Tasks 11-12 are optional measured size experiments, and Task 13 performs no
  implementation while the physical 4 MB headroom remains material.

There is also one file-location correction: the benchmark SRAM record is
currently written in `firmware/gbc/source/main.c`, not
`firmware/gbc/source/benchmark.c`.

## Standing acceptance gate

Run this gate for every retained performance experiment. Record the command,
revision, before/after JSON paths, five per-case tick deltas, packed payload
delta, maximum bank/WRAM values, and verdict in
`docs/performance/gbc-optimization-ledger.md`.

```bash
cmake --build build --target puzzlescript_cpp puzzlescript_gbc_exporter_tests
ctest --test-dir build/native -R "puzzlescript_gbc" --output-on-failure
node src/tests/run_tests_node.js
make gbc_eligible GBC_CONTINUE=1
make gbc_cart
make gbc_cart_smoke
python3 scripts/run_gbc_benchmark_suite.py \
  --label candidate --runs 3 \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --compiler build/native/puzzlescript_cpp \
  --baseline docs/performance/gbc-baseline.json \
  --out build-gbc-release/benchmarks/candidate.json
```

Expected:

- all native, JavaScript, eligible-ROM, cart-check, and mGBA smoke gates pass;
- all three boots produce byte-identical telemetry;
- native/GBC state, command, undo/restart/checkpoint, `again`, level-start,
  message, and sound behavior remain identical;
- no linked code bank exceeds 16 KiB, fixed ROM stays at or below 8 KiB,
  static WRAM stays at or below 6 KiB, and snapshot SRAM remains in range;
- the exporter and runtime agree on `PS_GBC_GAME_ABI_VERSION`;
- packed payload, allocated-bank slack, highest used bank, and physical 4 MB
  headroom are reported even when unchanged.

For a retained experiment, use a commit message body like:

```text
GBC: <concise experiment result>

ticks: sokoban <before> -> <after>; worst-case <before> -> <after>
payload: <before> -> <after> bytes (<signed delta>)
frames: mean <before> -> <after>; ldhl-sp <before> -> <after>
```

Do not combine two performance experiments in one commit.

---

## File map

### Measurement and reporting

- Create `scripts/run_gbc_benchmark_test.py`: synthetic SRAM parser tests.
- Create `scripts/run_gbc_benchmark_suite_test.py`: path resolution,
  headline-metric, and comparison tests.
- Create `scripts/report_gbc_cart_metrics.py`: payload/headroom, object-kind,
  rule-function frame, and `ldhl sp` report.
- Create `scripts/report_gbc_cart_metrics_test.py`: synthetic object/manifest
  tests.
- Modify `scripts/run_gbc_benchmark.py`: parse render-detail telemetry.
- Modify `scripts/run_gbc_benchmark_suite.py`: correct tool defaults and make
  interaction redraws the headline metrics.
- Modify `firmware/gbc/source/main.c`, `benchmark.h`, and `benchmark.c`: collect
  and publish per-interaction render phases and counts.
- Modify `native/include/puzzlescript/gbc.h`: render phase/counter ABI.
- Modify `firmware/gbc/README.md`: reproducible benchmark invocation.

### Renderer

- After Task 2, write a focused renderer-memory design before changing
  storage. Subject to approval, modify `firmware/gbc/source/tile_cache.h`,
  `tile_cache.c`, and launcher storage to phase-overlay render assets/cache
  with launcher-only memory; stage dirty map rows and flush grouped spans.
- Create `native/include/puzzlescript/gbc_tile_layout.h`: pure cache-layout
  API.
- Create `native/src/gbc/tile_layout.c`: validated cache/dedicated tile split.
- Create `native/tests/gbc_tile_layout.c`: boundary tests for 1, 42, and 90
  board cells.
- Modify `native/CMakeLists.txt`, `firmware/gbc/Makefile`, and
  `scripts/build_gbc_cart.py`: compile the layout helper everywhere.
- Modify `firmware/gbc/source/main.c`: bind renderer state once per game and
  flush staged map changes after `vsync()`.

### Specialized emitter

- Modify `native/src/compiler/compact_turn_codegen.cpp`: direct rejection,
  optional base-pointer locals, helper fusion, and optional shared scratch.
- Modify `native/src/compiler/compact_turn_codegen.hpp`: experiment switches
  only where an exporter-visible option is required.
- Modify `native/src/gbc/exporter.cpp`: pass experiment options and emit
  structural metadata.
- Modify `native/tests/gbc_exporter.cpp`: structural assertions for every
  emitted rule shape.
- Create `native/src/gbc/specialized_scratch.h` and
  `native/src/gbc/specialized_scratch.c` only for Task 9's scratch experiment.
- Modify `native/CMakeLists.txt`, `firmware/gbc/Makefile`, and
  `scripts/build_gbc_cart.py` only if Task 9 reaches implementation.

### Cart-native scoreboard and capacity

- Create `scripts/bench_gbc_cart_solutions.py`: build/boot/feed/read/report
  harness.
- Create `scripts/bench_gbc_cart_solutions_test.py`: key scripting, telemetry,
  aggregation, and worst-ten tests.
- Modify `scripts/build_gbc_cart.py`: benchmark-cart build mode and telemetry
  compile define.
- Modify `firmware/gbc/source/main.c`: cart benchmark accumulator and SRAM
  record.
- Modify `Makefile`: `gbc_cart_solutions_bench` target.
- Create `scripts/analyze_gbc_cart_sharing.py` and its test: normalized
  duplicate groups plus cross-bank reference inventory.
- Modify `native/src/compiler/compact_turn_codegen.cpp` and exporter tests for
  the optional direction-sharing experiment.
- Do not modify `scripts/build_gbc_cart.py` or `scripts/check_gbc_cart.py` for
  8 MB under this plan. Reopen that work through a separate approved design
  only when a measured forecast exhausts the remaining 4 MB banks.

---

### Task 1: Repair benchmark paths and add reproducible cart/codegen metrics

**Files:**

- Create: `scripts/run_gbc_benchmark_suite_test.py`
- Create: `scripts/report_gbc_cart_metrics.py`
- Create: `scripts/report_gbc_cart_metrics_test.py`
- Modify: `scripts/run_gbc_benchmark_suite.py`
- Modify: `firmware/gbc/README.md`

- [x] **Step 1: Write failing tool-path tests**

Extract these helpers into `run_gbc_benchmark_suite.py` and test them without
invoking GBDK:

```python
def default_compiler(repository: Path) -> Path:
    suffix = ".exe" if os.name == "nt" else ""
    return repository / "build" / "native" / f"puzzlescript_cpp{suffix}"


def resolve_tool_path(path: Path, *, repository: Path) -> Path:
    if not path.is_absolute():
        path = repository / path
    return path.resolve()
```

The test must assert:

```python
assert default_compiler(Path("/repo")) == Path(
    "/repo/build/native/puzzlescript_cpp"
)
assert resolve_tool_path(
    Path(".codex_tmp/toolchains/gbdk"), repository=Path("/repo")
) == Path("/repo/.codex_tmp/toolchains/gbdk")
```

Use `Path("C:/repo")` and the `.exe` expectation when `os.name == "nt"`.

- [x] **Step 2: Run the test red**

```bash
python3 scripts/run_gbc_benchmark_suite_test.py
```

Expected: import/assertion failure because the helpers and corrected default do
not exist.

- [x] **Step 3: Use the helpers before validation and Makefile invocation**

Replace the `build-gbc-release/native/puzzlescript_cpp.exe` default and resolve
both explicit/default paths:

```python
gbdk_home = resolve_tool_path(
    args.gbdk_home
    or Path(".codex_tmp/toolchains/gbdk"),
    repository=repository,
)
compiler = resolve_tool_path(
    args.compiler or default_compiler(repository),
    repository=repository,
)
```

Keep `make`, emulator, source, and output path handling unchanged.

- [x] **Step 4: Add a failing metrics parser test**

The synthetic object should contain two specialized functions:

```text
_ps_gbc_specialized_rule_0:
	add	sp, #-32
	ldhl	sp, #0
	ldhl	sp, #7
_ps_gbc_specialized_rule_1:
	add	sp, #-8
	ldhl	sp, #1
```

The synthetic cart manifest should contain packed-bank `used` values 100 and
200 and `highest_game_bank = 4`. Assert:

```python
assert report["packed_payload_bytes"] == 300
assert report["allocated_payload_bytes"] == 32768
assert report["allocated_slack_bytes"] == 32468
assert report["highest_used_bank"] == 4
assert report["physical_4mb_headroom_bytes"] == 4144852
assert report["rule_functions"] == 2
assert report["mean_frame_bytes"] == 20.0
assert report["median_frame_bytes"] == 32
assert report["max_frame_bytes"] == 32
assert report["ldhl_sp_count"] == 3
assert report["estimated_ldhl_sp_rom_bytes"] == 6
```

- [x] **Step 5: Implement the focused metrics reporter**

`scripts/report_gbc_cart_metrics.py` must:

- sum `packed_banks[*].used` from `cart-manifest.json`;
- report allocated-bank slack separately from physical capacity through bank
  255;
- report `highest_game_bank` without inferring physical fullness from it;
- classify launcher-art objects separately so they do not distort generated
  rule/core/data shares;
- scan only
  `*_generated_specialized_turn_rules_*.asm`;
- associate the first `add sp, #-N` after each
  `_ps_gbc_specialized_rule_...:` label with that function;
- count both `ldhl\tsp` and `ldhl    sp` spellings;
- emit stable, sorted JSON;
- fail clearly when no cart manifest or no specialized assembly exists.

CLI:

```bash
python3 scripts/report_gbc_cart_metrics.py \
  --manifest build/gbc/cart/cart-manifest.json \
  --objects build/gbc/cart/objects \
  --out build/gbc/cart/codegen-metrics.json
```

- [x] **Step 6: Run focused tests green**

```bash
python3 scripts/run_gbc_benchmark_suite_test.py
python3 scripts/report_gbc_cart_metrics_test.py
```

Expected: both print `ok`.

- [x] **Step 7: Reproduce the baseline with relative CLI paths**

```bash
python3 scripts/run_gbc_benchmark_suite.py \
  --label plan-baseline --runs 3 \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --compiler build/native/puzzlescript_cpp \
  --baseline docs/performance/gbc-baseline.json \
  --out build-gbc-release/benchmarks/plan-baseline.json
python3 scripts/report_gbc_cart_metrics.py \
  --manifest build/gbc/cart/cart-manifest.json \
  --objects build/gbc/cart/objects \
  --out build/gbc/cart/codegen-metrics-baseline.json
```

Expected: the suite completes with deterministic records and the metrics report
matches the roadmap's order of magnitude: 1,394 rule functions, mean frame
about 31 bytes, and about 125,200 `ldhl sp` instructions.

- [x] **Step 8: Update documentation and commit**

Document that explicit relative tool paths are resolved against
`--repository`, and show the repository-root command above.

```bash
git add scripts/run_gbc_benchmark_suite.py \
  scripts/run_gbc_benchmark_suite_test.py \
  scripts/report_gbc_cart_metrics.py \
  scripts/report_gbc_cart_metrics_test.py firmware/gbc/README.md
git commit -m "Make GBC performance measurements reproducible"
```

**Completed baseline (`980ce35b` artifacts):** 2,398,105 packed bytes,
2,424,832 allocated bytes, 26,727 allocated-bank slack, 1,747,047 physical
4 MB headroom, and highest bank 150. The validated artifact set contains 473
payload objects and 151 specialized-rule ASM files. It reports 1,513
specialized-rule labels, 1,371 functions with associated frames
(mean/median/max 30.097/32/128 bytes), and 125,200 `ldhl sp` instructions.
All five hardware cases were deterministic across three boots.

---

### Task 2: Add interaction-scoped render telemetry and honest headline metrics

**Files:**

- Create: `scripts/run_gbc_benchmark_test.py`
- Modify: `native/include/puzzlescript/gbc.h`
- Modify: `firmware/gbc/source/main.c`
- Modify: `firmware/gbc/source/benchmark.h`
- Modify: `firmware/gbc/source/benchmark.c`
- Modify: `firmware/gbc/source/tile_cache.c`
- Modify: `scripts/run_gbc_benchmark.py`
- Modify: `scripts/run_gbc_benchmark_suite.py`
- Modify: `scripts/run_gbc_benchmark_suite_test.py`

- [ ] **Step 1: Define the failing Python record contract**

Refactor SRAM decoding out of `run_once()`:

```python
def parse_benchmark_sram(data: bytes) -> dict[str, object]:
    ...
```

Add a versioned render-detail record at SRAM bank 3, offset 192:

```python
PERF_RENDER_DETAIL_MAGIC = 0x44434250
PERF_RENDER_DETAIL_OFFSET = 192
PERF_RENDER_PHASE_NAMES = (
    "compose",
    "cache_lookup",
    "encode",
    "tile_upload",
    "map_write",
)
PERF_RENDER_COUNTER_NAMES = (
    "dirty_cells",
    "cache_hits",
    "cache_misses",
    "dedicated_fallbacks",
    "uploaded_quartets",
)
PERF_RENDER_SAMPLE_NAMES = ("initial_render", "walk_render", "push_render")
PERF_RENDER_DETAIL_RECORD = struct.Struct(
    "<IHHH2x5I5H5I5H5I5H"
)
```

The synthetic test must cover:

- a valid version-1 detail record with three samples;
- invalid magic;
- wrong phase/counter count;
- truncated SRAM;
- a headline record with count values but zero phase ticks.

- [ ] **Step 2: Run the parser test red**

```bash
python3 scripts/run_gbc_benchmark_test.py
```

Expected: failure because `parse_benchmark_sram()` and render-detail constants
do not exist.

- [ ] **Step 3: Add render probe enums to the shared ABI**

In `native/include/puzzlescript/gbc.h` add:

```c
typedef enum ps_gbc_perf_render_phase {
    PS_GBC_PERF_RENDER_COMPOSE = 0,
    PS_GBC_PERF_RENDER_CACHE_LOOKUP = 1,
    PS_GBC_PERF_RENDER_ENCODE = 2,
    PS_GBC_PERF_RENDER_TILE_UPLOAD = 3,
    PS_GBC_PERF_RENDER_MAP_WRITE = 4,
    PS_GBC_PERF_RENDER_PHASE_COUNT = 5
} ps_gbc_perf_render_phase;

typedef enum ps_gbc_perf_render_counter {
    PS_GBC_PERF_RENDER_DIRTY_CELLS = 0,
    PS_GBC_PERF_RENDER_CACHE_HITS = 1,
    PS_GBC_PERF_RENDER_CACHE_MISSES = 2,
    PS_GBC_PERF_RENDER_DEDICATED_FALLBACKS = 3,
    PS_GBC_PERF_RENDER_UPLOADED_QUARTETS = 4,
    PS_GBC_PERF_RENDER_COUNTER_COUNT = 5
} ps_gbc_perf_render_counter;
```

Do not change `ps_gbc_perf_phase`; logic and render probes remain separate so
the existing seven-element record is backward compatible.

- [ ] **Step 4: Implement headline counters and diagnostic timers**

In `main.c`, under `PS_GBC_PERF_BENCH`, add phase starts/totals and counters.
Counts are always active during a selected render sample. Timer probes are
active only in `PS_GBC_PERF_PHASES` builds:

```c
void ps_gbc_perf_render_begin(uint8_t phase) {
#if defined(PS_GBC_PERF_PHASES)
    if (gPerfRenderEnabled && phase < PS_GBC_PERF_RENDER_PHASE_COUNT) {
        gPerfRenderPhaseStart[phase] = perfTimerTicks();
    }
#else
    (void)phase;
#endif
}

void ps_gbc_perf_render_end(uint8_t phase) {
#if defined(PS_GBC_PERF_PHASES)
    if (gPerfRenderEnabled && phase < PS_GBC_PERF_RENDER_PHASE_COUNT) {
        gPerfRenderPhaseTicks[phase] +=
            perfTimerTicks() - gPerfRenderPhaseStart[phase];
    }
#else
    (void)phase;
#endif
}

void ps_gbc_perf_render_count(uint8_t counter) {
    if (gPerfRenderEnabled
        && counter < PS_GBC_PERF_RENDER_COUNTER_COUNT
        && gPerfRenderCounts[counter] != UINT16_MAX) {
        ++gPerfRenderCounts[counter];
    }
}
```

Provide no-op macros in `tile_cache.c` outside `PS_GBC_PERF_BENCH`.

- [ ] **Step 5: Probe mutually exclusive renderer regions**

Instrument:

- `composeTile()` as `COMPOSE`;
- `findCachedComposition()` and `loadPrecomposedComposition()` as
  `CACHE_LOOKUP`;
- `encodeQuartet()` as `ENCODE`;
- `uploadQuartet()` as `TILE_UPLOAD`;
- incremental hardware-map writes, and later Task 5's flush, as `MAP_WRITE`.

Increment counters at these exact events:

```c
PS_GBC_RENDER_COUNT(PS_GBC_PERF_RENDER_DIRTY_CELLS);
PS_GBC_RENDER_COUNT(hit
    ? PS_GBC_PERF_RENDER_CACHE_HITS
    : PS_GBC_PERF_RENDER_CACHE_MISSES);
PS_GBC_RENDER_COUNT(PS_GBC_PERF_RENDER_DEDICATED_FALLBACKS);
PS_GBC_RENDER_COUNT(PS_GBC_PERF_RENDER_UPLOADED_QUARTETS);
```

Do not wrap `prepareComposition()` in one broad phase: nested/overlapping phase
ticks would make the split add up to more than the measured redraw.

- [ ] **Step 6: Capture initial, walk, and push samples independently**

Add:

```c
typedef struct perf_render_sample {
    uint32_t phase_ticks[PS_GBC_PERF_RENDER_PHASE_COUNT];
    uint16_t counts[PS_GBC_PERF_RENDER_COUNTER_COUNT];
} perf_render_sample;
```

Before each render in `perfMeasureInteraction()`, zero the live probe arrays;
after it, copy them into the matching sample. Preserve the existing overall
`initial_render_ticks`, `walk_render_ticks`, and `push_render_ticks`.

Publish the three samples at SRAM offset 192 after writing zero magic, then
write the detail magic last. Keep the legacy phase/interaction offsets and
versions intact.

- [ ] **Step 7: Parse and surface the new record**

`run_gbc_benchmark.py` must return:

```json
"render_detail": {
  "initial_render": {"phase_ticks": {}, "counts": {}},
  "walk_render": {"phase_ticks": {}, "counts": {}},
  "push_render": {"phase_ticks": {}, "counts": {}}
}
```

`benchmark_derived()` must keep `render_ticks_per_frame` under:

```json
"diagnostic": {"alternating_render_ticks_per_frame": 4.25}
```

and expose these as headline values:

```json
"headline_render": {
  "walk_render_ticks": 513,
  "push_render_ticks": 0
}
```

Keep the old flat derived keys for baseline-file compatibility during one
migration cycle, but stop printing `render_ticks_per_frame` as `render=`.
Print:

```text
walk_render=<ticks> push_render=<ticks> alternating_render_diagnostic=<ticks>
```

- [ ] **Step 8: Add suite comparison tests**

Assert `compare_case()` compares `walk_render_ticks` and `push_render_ticks`,
does not treat alternating render as a headline regression, and retains the
diagnostic value in JSON.

- [ ] **Step 9: Run focused and native tests**

```bash
python3 scripts/run_gbc_benchmark_test.py
python3 scripts/run_gbc_benchmark_suite_test.py
cmake --build build --target puzzlescript_gbc_core_tests
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
```

Expected: all pass.

- [ ] **Step 10: Measure probe overhead separately**

```bash
python3 scripts/run_gbc_benchmark_suite.py \
  --label render-counts --runs 3 \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --compiler build/native/puzzlescript_cpp \
  --out build-gbc-release/benchmarks/render-counts.json
python3 scripts/run_gbc_benchmark_suite.py \
  --label render-phases --runs 3 --phases \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --compiler build/native/puzzlescript_cpp \
  --out build-gbc-release/benchmarks/render-phases.json
```

Expected: count-only records have nonzero counts and zero phase ticks;
diagnostic records have a five-phase split. Record the difference between the
two builds as probe overhead. Use the count-only ROM for all headline timing.

- [ ] **Step 11: Commit instrumentation**

```bash
git add native/include/puzzlescript/gbc.h \
  firmware/gbc/source/main.c firmware/gbc/source/benchmark.h \
  firmware/gbc/source/benchmark.c firmware/gbc/source/tile_cache.c \
  scripts/run_gbc_benchmark.py scripts/run_gbc_benchmark_test.py \
  scripts/run_gbc_benchmark_suite.py \
  scripts/run_gbc_benchmark_suite_test.py
git commit -m "Attribute GBC interaction rendering costs"
```

**Decision gate:** rank Tasks 3-5 by the `walk_render`/`push_render` split.
Attempt the largest measured component first. Do not use the alternating
right/left render sample to choose.

---

### Task 3: Design, then stage immutable render assets within the WRAM gate

**Why this replaces the roadmap's bank bracket:** code in `tile_cache.c` runs
from bank 1 and cannot execute while the active game-data bank is selected.
One-time staging remains the safe way to remove inner-loop bank copies, but
master now leaves only 222 bytes below the static-WRAM gate. The old
independent 1,516-byte array sketch is invalid.

**Files:**

- Create after approval:
  `docs/superpowers/specs/2026-07-28-gbc-render-memory-overlay-design.md`
- Modify: `firmware/gbc/source/tile_cache.h`
- Modify: `firmware/gbc/source/tile_cache.c`
- Modify: `firmware/gbc/source/main.c`
- Modify: `firmware/gbc/source/game_dispatch.c`
- Modify only as required by the approved design:
  `firmware/gbc/source/text.c`

- [ ] **Step 1: Stop for the renderer-memory design checkpoint**

Use Task 2's phase/count results and the production link map to compare at
least:

1. phase-overlaying launcher band/cache storage with active-game
   session/render storage;
2. staging only the measured hot render-object subset;
3. rejecting staging and proceeding to the next measured renderer bottleneck.

The design must state exact byte layouts/lifetimes, prove launcher and
active-game states are mutually exclusive, specify cache reinitialization
after returning from a game, preserve the 6,144-byte link gate with at least
64 bytes of contingency, and add launcher → game → launcher corruption
coverage. Get user approval before implementation. If no option satisfies
those constraints, record Task 3 as rejected.

- [ ] **Step 2: Add a failing autotest invariant**

Under `PS_GBC_AUTOTEST`, count calls to `ps_gbc_active_rom_copy()` and expose:

```c
void ps_gbc_active_rom_copy_count_reset(void) NONBANKED;
uint16_t ps_gbc_active_rom_copy_count(void) NONBANKED;
```

In the render autotest:

1. bind the renderer;
2. reset the counter;
3. perform one full and one dirty render;
4. write the count into the existing render-autotest SRAM record.

Extend `scripts/run_gbc_smoke.py` to require a count of zero during rendering
and a successful launcher → game → launcher transition.

- [ ] **Step 3: Run render smoke red**

```bash
make gbc_smoke
```

Expected: the new assertion fails because `composeTile()` and precomposition
lookup still copy from game ROM.

- [ ] **Step 4: Add bounded staged storage from the approved overlay**

The renderer side of the approved overlay may contain the equivalent of:

```c
#define PS_GBC_SOURCE_CELL_PIXELS 25U
#define PS_GBC_MAX_PRECOMPOSED_COMPOSITIONS 8U

uint32_t render_masks[PS_GBC_MAX_OBJECTS];
uint8_t render_palettes[PS_GBC_MAX_OBJECTS];
uint8_t render_pixels[
    PS_GBC_MAX_OBJECTS][PS_GBC_SOURCE_CELL_PIXELS];
uint8_t render_object_count;

uint32_t precomposed_masks[
    PS_GBC_MAX_PRECOMPOSED_COMPOSITIONS];
uint8_t precomposed_palettes[
    PS_GBC_MAX_PRECOMPOSED_COMPOSITIONS];
uint8_t precomposed_tiles[
    PS_GBC_MAX_PRECOMPOSED_COMPOSITIONS][64];
uint8_t precomposed_count;
bool renderer_bound;
```

Do not declare these as additional file-scope storage. They must be views into
the approved phase overlay, and the final cart must retain at least 64 bytes
below the 6 KiB gate.

- [ ] **Step 5: Bind once after game activation**

Implement:

```c
bool ps_gbc_renderer_bind_active_game(void) BANKED;
void ps_gbc_renderer_unbind(void) BANKED;
```

The bind function must:

- reject null descriptor/view;
- reject `render_object_count > PS_GBC_MAX_OBJECTS`;
- reject `precomposed_count > 8`;
- copy each `ps_gbc_render_object`, then exactly 25 source pixels;
- copy precomposed masks, palettes, and 64-byte quartets;
- set `gRendererBound = true` only after every copy succeeds;
- clear counts and return false on partial failure.

Call it once in `runActiveGame()` after session initialization and before any
title/board rendering. A failed bind shows `RENDER MEMORY ERROR` and returns
to the launcher. Unbind after a cart game returns.

- [ ] **Step 6: Make the hot renderer WRAM-only**

Rewrite `composeTile()` to iterate `gRenderObjectCount` and read
`gRenderMasks`, `gRenderPalettes`, and `gRenderPixels`.

Rewrite `loadPrecomposedComposition()` to use the staged precomposed arrays.
After this change, `ps_gbc_active_rom_copy` may appear only inside
`ps_gbc_renderer_bind_active_game()`, never in compose, encode, cache lookup,
upload, or map code.

- [ ] **Step 7: Verify zero render-time bank copies and WRAM**

```bash
make gbc_smoke
make gbc_cart
python3 scripts/check_gbc_cart.py \
  build/gbc/cart/puzzlescript-compilation-46.gb \
  build/gbc/cart/cart-manifest.json \
  build/gbc/cart/puzzlescript-compilation-46.map \
  build/gbc/cart/objects
rg -n "ps_gbc_active_rom_copy" firmware/gbc/source/tile_cache.c
```

Expected:

- smoke reports zero render-time ROM-copy calls;
- the only `rg` hits are in the bind function;
- the launcher → game → launcher cycle is intact;
- static WRAM is at most 6,080 bytes, preserving 64 bytes of contingency;
- cart checks pass.

- [ ] **Step 8: Measure and retain/revert**

Run count-only and phase suites. The expected signal is a large drop in
`compose`, `composition_ticks_per_frame`, and initial render, with zero logic
change. Retain only if every case is neutral or faster and packed payload does
not regress materially.

- [ ] **Step 9: Commit the retained result**

```bash
git add firmware/gbc/source/tile_cache.h \
  firmware/gbc/source/tile_cache.c firmware/gbc/source/main.c \
  firmware/gbc/source/game_dispatch.h \
  firmware/gbc/source/game_dispatch.c scripts/run_gbc_smoke.py
git commit -m "Stage GBC render assets outside the composition loop"
```

---

### Task 4: Size the shared composition cache from the loaded board

**Precondition:** Task 3's approved renderer-memory design reserves this
cache inside the active-game overlay. Do not add the roadmap's 480-byte cache
growth as independent static storage.

**Files:**

- Create: `native/include/puzzlescript/gbc_tile_layout.h`
- Create: `native/src/gbc/tile_layout.c`
- Create: `native/tests/gbc_tile_layout.c`
- Modify: `native/CMakeLists.txt`
- Modify: `firmware/gbc/Makefile`
- Modify: `scripts/build_gbc_cart.py`
- Modify: `firmware/gbc/source/tile_cache.h`
- Modify: `firmware/gbc/source/tile_cache.c`
- Modify: `firmware/gbc/source/main.c`

- [ ] **Step 1: Write the failing pure layout test**

Define:

```c
typedef struct ps_gbc_tile_layout {
    uint8_t cache_entries;
    uint16_t dedicated_tile_offset;
    uint16_t board_tile_limit;
} ps_gbc_tile_layout;

bool ps_gbc_tile_layout_compute(
    uint16_t board_cells,
    ps_gbc_tile_layout* layout);
```

Assert:

```c
assert(ps_gbc_tile_layout_compute(90U, &layout));
assert(layout.cache_entries == 22U);
assert(layout.dedicated_tile_offset == 152U);
assert(layout.board_tile_limit == 512U);

assert(ps_gbc_tile_layout_compute(42U, &layout));
assert(layout.cache_entries == 70U);
assert(layout.dedicated_tile_offset == 344U);
assert(layout.board_tile_limit == 512U);

assert(!ps_gbc_tile_layout_compute(0U, NULL));
assert(!ps_gbc_tile_layout_compute(91U, &layout));
```

The formula is:

```c
cache_entries = 112U - board_cells;
dedicated_tile_offset = 64U + cache_entries * 4U;
board_tile_limit = dedicated_tile_offset + board_cells * 4U;
```

- [ ] **Step 2: Run red**

```bash
cmake --build build --target puzzlescript_gbc_tile_layout_tests
```

Expected: missing target/source failure.

- [ ] **Step 3: Implement and register the pure helper**

Add the source/test target to `native/CMakeLists.txt`; add
`tile_layout.o` to the standalone firmware Makefile and
`native/src/gbc/tile_layout.c` to the cart's `shared_sources`.

- [ ] **Step 4: Grow only metadata arrays to the hardware maximum**

Replace the fixed 16-entry arrays with:

```c
#define PS_GBC_MAX_CACHE_COMPOSITIONS 112U
static uint32_t gCompositionMasks[PS_GBC_MAX_CACHE_COMPOSITIONS];
static uint8_t gCompositionPalettes[PS_GBC_MAX_CACHE_COMPOSITIONS];
static uint8_t gCompositionCapacity;
static uint16_t gDedicatedTileOffset;
static uint16_t gBoardCells;
```

This grows cache metadata from 80 to 560 bytes. Do not allocate tile bytes in
WRAM; cached tile data remains in VRAM.

- [ ] **Step 5: Configure on every full level render**

Add:

```c
bool ps_gbc_tile_cache_configure(uint16_t board_cells) BANKED;
```

Call it when `renderBoard()` detects a new level, before
`ps_gbc_render_full_board()`. It computes the layout, sets live capacity and
offset, and resets `gCompositionCount`.

Pre-seed the background composition into cache entry zero before scanning the
viewport. This guarantees off-board background cells never need a dedicated
slot.

- [ ] **Step 6: Address dedicated tiles by board cell, not viewport cell**

Change `prepareComposition()` to accept `dedicated_slot`. Full and dirty board
paths pass the column-major `board_cell` index already used by packed board
storage. Off-board full-render cells pass `UINT16_MAX` and must hit the
pre-seeded background cache.

Fallback:

```c
if (dedicated_slot >= gBoardCells) return 0xffffU;
base_tile = gDedicatedTileOffset
    + dedicated_slot * PS_GBC_TILES_PER_CELL;
```

Never derive a dedicated tile from `logical_screen_cell`; a centered small
board can have a large viewport index even though it owns few dedicated slots.

- [ ] **Step 7: Verify layout, render parity, WRAM, and lookup cost**

```bash
cmake --build build --target puzzlescript_gbc_tile_layout_tests
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
make gbc_smoke
make gbc_cart
```

Run the phase suite. If `cache_lookup` regresses enough to erase the
cache-miss/upload win, add an object-width-aware mask type:

```c
typedef uint32_t ps_gbc_render_mask;
```

and compare only the active 1/2/4 bytes in a dedicated helper before
considering a hash table. Do not introduce hashing unless the measured linear
lookup is material.

- [ ] **Step 8: Commit only a measured win**

```bash
git add native/include/puzzlescript/gbc_tile_layout.h \
  native/src/gbc/tile_layout.c native/tests/gbc_tile_layout.c \
  native/CMakeLists.txt firmware/gbc/Makefile \
  scripts/build_gbc_cart.py firmware/gbc/source/tile_cache.h \
  firmware/gbc/source/tile_cache.c firmware/gbc/source/main.c
git commit -m "Size the GBC composition cache per level"
```

---

### Task 5: Stage dirty map spans and flush them at VBlank

**Files:**

- Modify: `firmware/gbc/source/tile_cache.h`
- Modify: `firmware/gbc/source/tile_cache.c`
- Modify: `firmware/gbc/source/main.c`
- Modify: `firmware/gbc/source/benchmark.c`
- Modify: `scripts/run_gbc_smoke.py`

- [ ] **Step 1: Extend the render smoke contract**

The existing smoke already checks:

- incremental render does not blank the LCD;
- shadow tile map/attributes equal hardware;
- tile uploads read back correctly.

Add a telemetry field for map-bank flips and assert a one-cell dirty render
uses exactly two flips: one to tile-number bank 0 and one to attribute bank 1.

- [ ] **Step 2: Run red**

```bash
make gbc_smoke
```

Expected: the flip assertion fails because `mapComposition()` currently flips
twice per physical tile, eight flips per logical cell.

- [ ] **Step 3: Track pending row spans**

Add:

```c
static uint8_t gPendingRowMin[PS_GBC_SCREEN_TILE_HEIGHT];
static uint8_t gPendingRowMax[PS_GBC_SCREEN_TILE_HEIGHT];
static bool gPendingMap;
```

An empty row has `min = PS_GBC_SCREEN_TILE_WIDTH`, `max = 0`. When a 2×2
logical cell changes, widen the spans of its two physical rows. Continue
writing `gTileMap` and `gAttributes` immediately; remove all hardware map
writes from `mapComposition()`.

- [ ] **Step 4: Implement a grouped flush**

Expose:

```c
bool ps_gbc_has_pending_map(void) BANKED;
void ps_gbc_flush_pending_map(void) BANKED;
```

Flush:

```c
VBK_REG = VBK_BANK_0;
for each pending row:
    set_bkg_tiles(min, row, width, 1, &gTileMap[row * 20U + min]);

VBK_REG = VBK_BANK_1;
for each pending row:
    set_bkg_tiles(min, row, width, 1, &gAttributes[row * 20U + min]);

VBK_REG = VBK_BANK_0;
clear all pending spans;
```

Wrap only this function in the `MAP_WRITE` render phase. A gap between two
dirty cells may upload unchanged shadow bytes; that is correct and avoids a
larger queue.

- [ ] **Step 5: Flush immediately after the next `vsync()`**

At the end of the active-game loop:

```c
vsync();
if (ps_gbc_has_pending_map()) {
    ps_gbc_flush_pending_map();
}
```

This creates a one-frame staging boundary but keeps the LCD on. Full renders
continue to use `DISPLAY_OFF` and whole-map writes exactly as before.

In `perfMeasureInteraction()`, measure staged render work and the isolated
post-`vsync()` flush separately, excluding the wait itself, then sum them into
the existing interaction render total. This preserves comparison with prior
compute-time measurements while assigning the write cost to `MAP_WRITE`.

- [ ] **Step 6: Verify smoke and the phase split**

```bash
make gbc_smoke
python3 scripts/run_gbc_benchmark_suite.py \
  --label vblank-map --runs 3 --phases \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --compiler build/native/puzzlescript_cpp \
  --out build-gbc-release/benchmarks/vblank-map.json
```

Expected:

- incremental blank count remains zero;
- hardware/shadow mismatch counts remain zero;
- map flips are two;
- `map_write` drops on dirty renders.

- [ ] **Step 7: Gate tile-data upload variants**

Only if Task 2 reports `tile_upload` as material after grouped map flush, test
these as separate commits/measurements:

1. four one-tile `set_bkg_data()` calls (control);
2. the existing `ps_gbc_wram_vram_dma_hblank()` helper;
3. the existing aligned WRAM-to-VRAM general-purpose DMA path;
4. an HBlank queue built on the existing helper contract.

Revert each variant before trying the next. Retain the first variant that is
faster on the count-only suite, passes tile readback, and does not grow packed
payload. Do not duplicate the launcher DMA implementation and do not re-test
the already rejected one-call `set_bkg_data(..., 4)`.

- [ ] **Step 8: Commit the retained map batching**

```bash
git add firmware/gbc/source/tile_cache.h \
  firmware/gbc/source/tile_cache.c firmware/gbc/source/main.c \
  firmware/gbc/source/benchmark.c scripts/run_gbc_smoke.py
git commit -m "Flush GBC dirty map spans at VBlank"
```

---

### Task 6: Emit direct early rejection instead of `row_matched`

**Files:**

- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [ ] **Step 1: Add failing structural assertions for every rule shape**

For the existing Sokoban, aggregate/property, and two-row fixtures, concatenate
all `generated_specialized_turn*.c` files and assert:

```cpp
require(
    source.find("bool row_matched") == std::string::npos,
    "specialized rules do not materialize row_matched");
require(
    source.find("if (row_matched)") == std::string::npos,
    "specialized rules do not guard every pattern");
require(
    source.find("return false; /* pattern reject */")
        != std::string::npos
        || source.find("break; /* pattern reject */")
        != std::string::npos,
    "specialized rules emit direct rejection");
```

Also assert property and aggregate capture markers remain present and the
two-row fixture still emits both row scratch arrays.

- [ ] **Step 2: Run exporter test red**

```bash
cmake --build build --target puzzlescript_gbc_exporter_tests
build/native/puzzlescript_gbc_exporter_tests
```

Expected: structural assertion failure.

- [ ] **Step 3: Change the match emitter contract**

Replace `matchedFlagName` with a complete rejection statement:

```cpp
void emitCompactInlineGbdCPatternMatch(
    std::ostream& out,
    const GbcSpecializedPatternEmit& pattern,
    std::string_view indent,
    std::string_view cellExpr,
    std::string_view tileVariableName,
    std::string_view rejectStatement,
    uint8_t objectBytesPerCell,
    uint8_t movementBytesPerCell);
```

Emit direct guards:

```c
if ((p0_objects & 0x3cU) != 0U) {
    break; /* pattern reject */
}
```

For a non-fused `matches_at` helper, pass
`"return false; /* pattern reject */"`. Keep a local boolean only for an
individual any-layer/layer-coupled alternative; never use one to guard the
next pattern.

- [ ] **Step 4: Use structured rejection at each caller**

Use `do { ... } while (false)` so labels cannot collide:

```c
do {
    uint8_t check_cell = start;
    /* each failed pattern executes break */
    /* property and aggregate capture occur only after all tests */
    /* replacements occur only after captures */
    changed = true;
} while (false);
```

For non-fused helpers:

```c
/* each failed pattern returns false */
return true;
```

For row collection, place `++cell` outside the `do/while`, preserving scan
advancement after rejection. For two-row revalidation, set
`still_matches = false` and break the row wrapper; skip the second row when
`still_matches` is already false.

The old `cell += delta` statements may be skipped after rejection because they
mutate only a dead local. Property/aggregate capture and all writes must remain
after the final match test.

- [ ] **Step 5: Run structural and semantic parity tests**

```bash
cmake --build build --target \
  puzzlescript_gbc_exporter_tests \
  puzzlescript_gbc_specialized_oracle_smoke
ctest --test-dir build/native \
  -R "puzzlescript_gbc_(exporter|specialized_oracle)" \
  --output-on-failure
```

Expected: all fixtures pass, including simultaneous matches, property
bindings, aggregate bindings, and two-row rules.

- [ ] **Step 6: Measure bytes, frames, and five-case ticks**

```bash
make gbc_cart
python3 scripts/report_gbc_cart_metrics.py \
  --manifest build/gbc/cart/cart-manifest.json \
  --objects build/gbc/cart/objects \
  --out build/gbc/cart/codegen-metrics-early-reject.json
```

Then run the standing gate. Expected:

- `row_matched` stack residency disappears;
- guard sequences and packed payload decrease;
- rejection-heavy cases improve;
- no case or semantic gate regresses.

- [ ] **Step 7: Commit**

```bash
git add native/src/compiler/compact_turn_codegen.cpp \
  native/tests/gbc_exporter.cpp \
  docs/performance/gbc-optimization-ledger.md
git commit -m "Short-circuit generated GBC pattern rejection"
```

---

### Task 7: Experiment 6a — hoist board and movement base pointers

**Files:**

- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [ ] **Step 1: Add a failing structural assertion**

For each emitted rule body, require:

```c
uint8_t* const board = session->board;
uint8_t* const movements = session->movements;
```

and require hot pattern loads to use `board[cell]` /
`((uint16_t*)movements)[cell]`, not `session->board[cell]` /
`session->movements[cell]`.

- [ ] **Step 2: Parameterize storage emit helpers**

Change the internal `emitGbdCBoardGet/Assign/Set` and movement siblings to take
`boardExpr` / `movementsExpr`. Existing non-rule callers may pass
`"session->board"` and `"session->movements"`; generated rule functions pass
`"board"` and `"movements"`.

Emit both pointer locals once at the narrowest function that contains the scan
loop. Do not duplicate them in each candidate-cell block.

- [ ] **Step 3: Run exporter and oracle tests**

```bash
cmake --build build --target \
  puzzlescript_gbc_exporter_tests \
  puzzlescript_gbc_specialized_oracle_smoke
ctest --test-dir build/native \
  -R "puzzlescript_gbc_(exporter|specialized_oracle)" \
  --output-on-failure
```

- [ ] **Step 4: Measure before deciding**

Rebuild the cart and record ticks, payload, frame distribution, and `ldhl sp`.
Hoisted pointers can themselves spill on SM83; retain only if the five-case
suite and frame/ROM metrics improve together. Revert the complete experiment
if SDCC increases frames or payload without a clear tick win.

- [ ] **Step 5: Commit only if retained**

```bash
git add native/src/compiler/compact_turn_codegen.cpp \
  native/tests/gbc_exporter.cpp \
  docs/performance/gbc-optimization-ledger.md
git commit -m "Hoist generated GBC board base pointers"
```

---

### Task 8: Experiment 6b — fuse non-fused `matches_at` helpers into scans

**Files:**

- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [ ] **Step 1: Add a failing no-helper assertion**

For a fixture that emits collect-all semantics (`applyOnMatch == false`),
assert no symbol contains `_matches_at` and the scan body still writes every
successful candidate into:

```c
session->match_cells[match_count]
```

- [ ] **Step 2: Extract one reusable C++ emission lambda**

Inside `emitGbcSpecializedRuleFunction()`, add an emitter-side lambda:

```cpp
auto emitCollectMatchAt = [&](std::string_view indent,
                              std::string_view startExpr) {
    // emit do/while direct-rejection body
    // append startExpr to match_cells only after every pattern passes
};
```

Invoke it in full-grid and player-anchor scan paths. This duplicates emitted C
where the generated control-flow branches differ, but removes the actual SDCC
call/prologue/epilogue per candidate.

Do not change collect-all ordering or the later apply loop over
`session->match_cells`.

- [ ] **Step 3: Verify structural and semantic behavior**

```bash
cmake --build build --target \
  puzzlescript_gbc_exporter_tests \
  puzzlescript_gbc_specialized_oracle_smoke
ctest --test-dir build/native \
  -R "puzzlescript_gbc_(exporter|specialized_oracle)" \
  --output-on-failure
```

- [ ] **Step 4: Apply the size/speed gate**

Measure all five cases, packed payload, mean/p90/max frames, and `ldhl sp`.
Retain only if call-boundary savings outweigh duplicated bodies. A tick win
that grows the cart requires an explicit byte trade justified by Task 10's
shipping-cart scoreboard and the physical-headroom report.

- [ ] **Step 5: Commit or document rejection**

If retained, commit the code and ledger. If rejected, restore the code, add
only the measured rejection to the ledger, and commit that documentation
separately.

---

### Task 9: Experiment 6c — re-test shared static scratch without per-game WRAM

**Files:**

- Create: `native/src/gbc/specialized_scratch.h`
- Create: `native/src/gbc/specialized_scratch.c`
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/CMakeLists.txt`
- Modify: `firmware/gbc/Makefile`
- Modify: `scripts/build_gbc_cart.py`
- Modify: `native/tests/gbc_exporter.cpp`

- [ ] **Step 1: Preserve the cart's shared-WRAM invariant in a failing test**

Extend `scripts/check_gbc_cart_test.py` with a generated rules object that has
nonzero `_BSS`; keep the expectation that it is rejected. The experiment must
not put file-scope statics in any `gNN_*` object.

- [ ] **Step 2: Add one unnamespaced shared scratch object**

Define only values shown by the current assembly to be repeatedly copied
between stack slots:

```c
typedef struct ps_gbc_specialized_scratch {
    ps_gbc_session* session;
    ps_gbc_commands* commands;
    uint8_t cell;
    uint8_t match_count;
    uint8_t match_index;
    int8_t delta;
    bool changed;
} ps_gbc_specialized_scratch;

extern ps_gbc_specialized_scratch g_ps_gbc_specialized_scratch;
```

Compile `specialized_scratch.c` once as shared firmware, not through
`generated_core.c`. The desktop oracle links the same source. Do not add the
symbol to `kNamespacedSymbols`.

- [ ] **Step 3: Add an emitter-only experiment switch**

Under a disabled-by-default option, emit references to the shared scratch for
the selected locals. Keep the normal stack-local path for desktop builds
unless the host test explicitly defines the experiment macro.

Never move arrays, property captures, aggregate captures, or row-match arrays
into the shared object in this experiment.

- [ ] **Step 4: Run re-entrancy and parity checks**

Document and assert that no interrupt handler calls specialized rules and no
specialized rule recursively calls another rule. Run exporter, oracle,
eligible, cart, and sound/command gates.

- [ ] **Step 5: Measure against the new baseline**

Compare:

- five-case count-only ticks;
- packed payload;
- static WRAM;
- mean/p90/max frame bytes;
- `ldhl sp`.

Retain only for a clear speed **and** payload/frame win. The prior 0.301%
interpreter result is not enough, and any per-game `_DATA/_BSS` is an automatic
rejection.

- [ ] **Step 6: Commit or fully remove**

If rejected, delete the new header/source/build wiring and record the result
in the ledger. Do not leave a disabled scratch subsystem behind.

---

### Task 10: Build a cartridge-native per-game solution scoreboard

**Files:**

- Create: `scripts/bench_gbc_cart_solutions.py`
- Create: `scripts/bench_gbc_cart_solutions_test.py`
- Modify: `scripts/build_gbc_cart.py`
- Modify: `firmware/gbc/source/main.c`
- Modify: `firmware/gbc/source/benchmark.h`
- Modify: `Makefile`

- [ ] **Step 1: Write failing key-script and telemetry tests**

Define key conversion:

```python
TOKEN_KEYS = {
    "up": KEY_UP,
    "left": KEY_LEFT,
    "down": KEY_DOWN,
    "right": KEY_RIGHT,
    "action": KEY_A,
}
```

Menu presses occupy one frame and are followed by at least two release frames.
Solution presses use a conservative 502 release frames: the runtime/oracle
limit is 500 pending-`again` ticks, plus two frames for release/settling.
The script must:

1. press Down `game_index` times in the launcher;
2. press A to launch;
3. press A to start a new game;
4. feed the solution tokens;
5. leave 502 release frames after each solution token so even the maximum
   supported `again` chain drains before the next user input.

Test a versioned record:

```python
@dataclass(frozen=True)
class CartBenchTelemetry:
    game_index: int
    user_turns: int
    redraws: int
    logic_ticks: int
    render_ticks: int
    max_turn_ticks: int
    won: bool
```

Cover bad magic/version/index, zero turns, truncated data, weighted mean, and
descending worst-ten ordering.

- [ ] **Step 2: Add benchmark-cart build mode**

Add `benchmark: bool` to `build_cart()` and CLI `--benchmark`, mutually
exclusive with `--autotest`. Compile shared firmware with:

```text
PS_GBC_CART_BUILD=1
PS_GBC_CART_BENCHMARK=1
```

Name the output `puzzlescript-compilation-benchmark-46.gb` and record
`"benchmark": true` in the cart manifest. Generated game/rule objects remain
byte-identical to production; only shared instrumentation differs.

- [ ] **Step 3: Refactor the hardware timer for both benchmark modes**

Compile timer primitives when either `PS_GBC_PERF_BENCH` or
`PS_GBC_CART_BENCHMARK` is set. Do not enable phase probes in the cart
scoreboard.

- [ ] **Step 4: Accumulate one user-visible turn correctly**

In the active-game loop:

- start a new accumulator on a pressed direction/action;
- add every subsequent pending-`again` `psd_step()` to the same accumulator;
- add every corresponding dirty render/flush;
- finalize the previous user turn immediately before the next pressed input or
  when the level wins;
- track total logic/render ticks, user-turn count, redraw count, and maximum
  combined turn;
- exclude title/launcher/menu time.

Publish one record in SRAM bank 3 at offset 512. Write zero magic first and
valid magic last. A fresh emulator boot measures one game, so the record does
not need 46 slots.

- [ ] **Step 5: Reuse/generate first-retained-board fixtures**

Import `ELIGIBLE_GAMES` from `build_gbc_eligible_roms.py`; do not copy the
46-entry tuple again.

Use fixtures from
`build/gbc/eligible/solution-fixtures/<slug>/board-0.txt` when present.
Otherwise reuse the existing retained-board solving helpers in
`bench_gbc_eligible_solutions.py` to solve board 0 and cache the fixture.
Report unsolved games explicitly; never silently omit them.

- [ ] **Step 6: Drive one fresh libmGBA boot per game**

Reuse `run_gbc_smoke.load_libmgba_shim()` and
`psgbc_run_with_keys()`. For each game:

- copy the benchmark ROM to a fresh temporary directory;
- run the generated key script;
- read/validate SRAM;
- require the telemetry game index to match the manifest;
- require `won` for a successful scoreboard row;
- store ticks/turn, ticks/redraw, maximum turn, turn/redraw counts, fixture
  path, source hash, and wall time.

Output:

```json
{
  "format": "puzzlescript-gbc-cart-solution-bench-v1",
  "timing_source": "cgb_4096hz_timer_via_libmgba",
  "games": [],
  "worst_10_logic": [],
  "worst_10_interaction": []
}
```

- [ ] **Step 7: Add the Make target**

```make
GBC_CART_SOLUTIONS_BENCH_OUT ?= \
  $(GBC_CART_OUT)/solution-bench-cart.json

gbc_cart_solutions_bench: $(PUZZLESCRIPT_CPP)
	python3 scripts/bench_gbc_cart_solutions.py \
	  --repository . \
	  --compiler "$(abspath $(PUZZLESCRIPT_CPP))" \
	  --gbdk-home "$(if $(strip $(GBDK_HOME)),$(abspath $(GBDK_HOME)),.codex_tmp/toolchains/gbdk)" \
	  --out "$(GBC_CART_SOLUTIONS_BENCH_OUT)"
```

Add the target to `.PHONY` and help text.

- [ ] **Step 8: Run focused tests and a three-game smoke scoreboard**

```bash
python3 scripts/bench_gbc_cart_solutions_test.py
python3 scripts/bench_gbc_cart_solutions.py \
  --repository . --limit 3 \
  --compiler build/native/puzzlescript_cpp \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --out build/gbc/cart/solution-bench-cart-3.json
```

Expected: three indexed, winning rows with nonzero timer counts.

- [ ] **Step 9: Run all 46 and commit**

```bash
make gbc_cart_solutions_bench
```

Expected: a report for all 46 games, explicit failures for any unsolved first
board, and stable worst-ten lists across a repeated run.

```bash
git add scripts/bench_gbc_cart_solutions.py \
  scripts/bench_gbc_cart_solutions_test.py scripts/build_gbc_cart.py \
  firmware/gbc/source/main.c firmware/gbc/source/benchmark.h Makefile
git commit -m "Benchmark solution turns on the GBC compilation cart"
```

---

### Task 11: Inventory shareable cart objects before changing the bank ABI

**Files:**

- Create: `scripts/analyze_gbc_cart_sharing.py`
- Create: `scripts/analyze_gbc_cart_sharing_test.py`

- [ ] **Step 1: Write a failing normalized-cluster test**

Use synthetic objects/symbol tables to distinguish:

- byte-identical code with no per-game references;
- normalized-identical code whose undefined symbols refer to `g00_`/`g01_`
  game data;
- same-size but different code;
- a cluster with a computed gross-byte saving.

The report row must include:

```json
{
  "kind": "generated_core",
  "members": ["g00_generated_core.o", "g01_generated_core.o"],
  "gross_duplicate_bytes": 8192,
  "per_game_symbol_references": ["ps_gbc_generated_game"],
  "directly_shareable": false
}
```

- [ ] **Step 2: Implement source/object normalization**

Normalize only:

- `gNN_` namespace prefixes;
- `_CODE_N` area numbers;
- symbol addresses and generated bank literals.

Do not normalize instruction bytes, constants, call targets after namespace
removal, or relocation kinds.

Parse defined/undefined symbols from the ASxxxx text objects and list every
normalized per-game reference. Mark an object directly shareable only when a
single definition can satisfy every consumer without a per-game alias or
cross-bank access.

- [ ] **Step 3: Run against the shipping cart**

```bash
python3 scripts/analyze_gbc_cart_sharing.py \
  --objects build/gbc/cart/objects \
  --manifest build/gbc/cart/cart-manifest.json \
  --out build/gbc/cart/sharing-analysis.json
```

Expected: reconcile the roadmap's approximately 148 KB gross duplicates and
explain how much is blocked by namespaced data/call references.

- [ ] **Step 4: Apply the design gate**

Do **not** change `pack_items()` merely because normalized bytes match.
Proceed to a new shared-core design only if the report identifies at least
64 KiB net opportunity after estimating:

- one shared implementation per configuration cluster;
- descriptor/context data needed per game;
- HOME or `BANKED` bridge bytes;
- hot-path indirect/cross-bank calls.

If the threshold is met, write a focused design/spec for the smallest safe
cluster (prefer compact facade before core) and create a separate
implementation plan. If not, record Task 8a as rejected with the report.

- [ ] **Step 5: Commit the analysis tool/report conclusion**

Commit the tool/test and the ledger conclusion. Build artifacts remain
untracked.

---

### Task 12: Experiment with shared direction-expanded rule bodies

**Files:**

- Modify: `native/src/compiler/compact_turn_codegen.hpp`
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/src/gbc/exporter.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [ ] **Step 1: Add an opt-in failing structural test**

Add `shareDirectionalBodies` to `GbcSpecializedTurnEmitOptions`, default
false. In an exporter fixture with four direction-expanded siblings, enable it
and assert:

- one parameterized family body is emitted;
- four thin rule entry points retain the original rule indices/order;
- the family receives direction, `delta`, and scan bounds explicitly;
- default exports remain byte-for-byte structurally unchanged.

- [ ] **Step 2: Emit one family only for proved-equivalent siblings**

Build a family key from every semantic field except direction and derived scan
bounds:

- pattern masks/flags/replacements;
- property, aggregate, any-layer, and layer-coupled bindings;
- commands, message, and sound references;
- row shape and apply-on-match mode.

Only siblings with identical keys may share. Emit the existing body once with
direction/delta/bounds parameters, and retain thin indexed wrappers so group
scheduling and rule sound/message identity do not change.

- [ ] **Step 3: Verify oracle and full structural parity**

Run exporter/oracle tests, the full eligible corpus, command/sound gates, and
cart smoke. Reject on any ordering, simultaneous-match, or sound difference.

- [ ] **Step 4: Judge with the cart scoreboard**

Compare:

- packed payload and rule-pack bytes;
- worst-ten cart logic and interaction ticks;
- weighted ticks/turn across successful rows;
- function frames and `ldhl sp`.

Retain only if payload falls by at least 1%, weighted cart timing regresses by
no more than 2%, and no measured game regresses by more than 5%. These are
experiment gates, not a permanent product latency target.

- [ ] **Step 5: Commit or record rejection**

Keep the option default false until the complete gate passes. If it passes,
make the selected policy explicit in exporter/cart build configuration and
commit one measured change. If it fails, remove the option and record the
result.

---

### Task 13: Record the 8 MB path as deferred

**Files:**

- Modify: `docs/performance/gbc-optimization-ledger.md`

- [ ] **Step 1: Record the revalidated capacity**

Record the current packed payload, allocated-bank slack, highest used bank,
and physical headroom through bank 255. State explicitly that allocated-bank
fill is not physical-ROM fill.

- [ ] **Step 2: Record the ABI constraint**

Document that normal GBDK `BANKED` calls and `SWITCH_ROM_MBC5` carry an
8-bit bank and that `SWITCH_ROM_MBC5_8M` does not make generated calls above
bank 255 safe.

- [ ] **Step 3: Define the reopen gate**

No spike or production code is part of this plan. Reopen 8 MB as a separate
brainstorm/design/implementation cycle only when a cart forecast shows less
than 256 KiB of physical 4 MB headroom or a queued game set demonstrably
cannot pack below bank 256.

- [ ] **Step 4: Commit the deferral**

Commit only the ledger conclusion. Do not add high-bank smoke scripts, widen
bank types, or modify the packer/checker/ROM header.

---

### Task 14: Final program gate and roadmap update

**Files:**

- Modify: `docs/performance/gbc-optimization-ledger.md`
- Modify: `docs/performance/gbc-extended-optimization-plan-2026-07-27.md`

- [ ] **Step 1: Run the complete standing gate from a clean rebuild**

Use fresh candidate labels and rebuild exporter artifacts after any ABI
change. Also run:

```bash
make gbc_cart_solutions_bench
python3 scripts/report_gbc_cart_metrics.py \
  --manifest build/gbc/cart/cart-manifest.json \
  --objects build/gbc/cart/objects \
  --out build/gbc/cart/codegen-metrics-final.json
```

- [ ] **Step 2: Produce one final before/after table**

Include:

- five-case logic, walk-render, push-render, and initial-render ticks;
- render phase/count split for the relevant interaction;
- all-46 cart worst ten and weighted ticks/turn;
- packed payload, allocated-bank slack/fill, highest used bank, and physical
  4 MB headroom;
- specialized rule-pack bytes;
- function frame mean/median/p90/max and `ldhl sp`;
- fixed ROM, maximum bank, static WRAM, and snapshot SRAM.

- [ ] **Step 3: Reconcile every roadmap task**

Mark Tasks 0-8 in the source roadmap as retained, rejected, superseded,
deferred, or split into a follow-up design. Preserve the corrected renderer
bank-bracket, WRAM-overlay, physical-capacity, and 8 MB GBDK conclusions.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/performance/gbc-optimization-ledger.md \
  docs/performance/gbc-extended-optimization-plan-2026-07-27.md
git commit -m "Record the extended GBC optimization results"
```

## Program completion criteria

This plan is complete when:

- interaction rendering is measured by real walk/push redraws and attributed
  by phase/count;
- each renderer and emitter experiment has a deterministic retain/reject
  result with tick and byte deltas;
- cart-native timing covers every solvable eligible title and publishes a
  stable worst-ten list;
- the cart reports allocated and physical capacity separately; optional
  sharing experiments have measured verdicts; and the far-bank ABI has an
  explicit reopen threshold;
- all standing semantic, sound, render, memory, and cart gates pass;
- the ledger and active roadmap match the shipped implementation.
