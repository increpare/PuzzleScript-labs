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
3. **Specialized emitter:** Tasks 6-9. Early rejection was attempted first and
   rejected by its performance gate. Pointer hoisting, helper fusion, and
   static scratch remain independent experiments, each measured and committed
   or reverted separately.
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

- [x] **Step 1: Define the failing Python record contract**

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

- [x] **Step 2: Run the parser test red**

```bash
python3 scripts/run_gbc_benchmark_test.py
```

Expected: failure because `parse_benchmark_sram()` and render-detail constants
do not exist.

- [x] **Step 3: Add render probe enums to the shared ABI**

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

- [x] **Step 4: Implement headline counters and diagnostic timers**

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

- [x] **Step 5: Probe mutually exclusive renderer regions**

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

- [x] **Step 6: Capture initial, walk, and push samples independently**

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

- [x] **Step 7: Parse and surface the new record**

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

- [x] **Step 8: Add suite comparison tests**

Assert `compare_case()` compares `walk_render_ticks` and `push_render_ticks`,
does not treat alternating render as a headline regression, and retains the
diagnostic value in JSON.

- [x] **Step 9: Run focused and native tests**

```bash
python3 scripts/run_gbc_benchmark_test.py
python3 scripts/run_gbc_benchmark_suite_test.py
cmake --build build --target puzzlescript_gbc_core_tests
ctest --test-dir build/native -R puzzlescript_gbc --output-on-failure
```

Expected: all pass.

- [x] **Step 10: Measure probe overhead separately**

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

- [x] **Step 11: Commit instrumentation**

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

**Completed decision (`5415f0e0` + `e0106a42`):** the corrected count-only
walk/push ticks are Sokoban 57/68, large-board 514/517, rule-heavy 53/52,
object-heavy 476/465, and two-movement-lanes 92/92. Across the real
walk/push phase samples, encode accounts for 686 ticks (42.8%), map writes
569 (35.5%), cache lookup 194 (12.1%), compose 130 (8.1%), and tile upload
24 (1.5%). Dedicated fallbacks are zero in every sample.

Task 5 therefore runs next: it targets the largest measured component covered
by the existing renderer tasks and needs no new static-WRAM allocation.
Task 4 is deferred because its dedicated-fallback mechanism was not exercised.
Task 3 remains behind its approved memory-design checkpoint; the measured
encode cost must be included in that design rather than assuming composition
staging is the primary win. Phase-probe builds remain diagnostic only: their
walk/push overhead ranges from +21 to +353 ticks after count-only hooks were
compiled out.

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

**Outcome (2026-07-28): completed and rejected.** The prototype passed its
semantic, smoke, cart, and memory gates, but the three-boot count-only suite
regressed in all five cases. No runtime or test change was retained. Full
measurements and the rejection rationale are recorded in the
[optimization ledger](../../performance/gbc-optimization-ledger.md#gbc-vblank-dirty-map-span-batching-rejected-2026-07-28).

**Files:**

- Modify: `firmware/gbc/source/tile_cache.h`
- Modify: `firmware/gbc/source/tile_cache.c`
- Modify: `firmware/gbc/source/main.c`
- Modify: `firmware/gbc/source/benchmark.c`
- Modify: `scripts/run_gbc_smoke.py`

- [x] **Step 1: Extend the render smoke contract**

The existing smoke already checks:

- incremental render does not blank the LCD;
- shadow tile map/attributes equal hardware;
- tile uploads read back correctly.

Add a telemetry field for map-bank flips and assert a one-cell dirty render
uses exactly two flips: one to tile-number bank 0 and one to attribute bank 1.

- [x] **Step 2: Run red**

```bash
make gbc_smoke
```

Expected: the flip assertion fails because `mapComposition()` currently flips
twice per physical tile, eight flips per logical cell.

- [x] **Step 3: Track pending row spans**

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

- [x] **Step 4: Implement a grouped flush**

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

- [x] **Step 5: Flush immediately after the next `vsync()`**

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

- [x] **Step 6: Verify smoke and the phase split**

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

- [x] **Step 7: Gate tile-data upload variants — skipped by gate**

Post-map `tile_upload` remained only 21 / 1,467 attributed ticks (1.4%), so
the conditional DMA variants were not attempted.

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

- [x] **Step 8: Apply the retention gate — rejected**

Count-only walk/push redraws regressed in every case, including
`large_board` (514/517 → 530/527) and `object_heavy`
(476/465 → 536/527). The candidate source, smoke/parser contract, and
generated artifacts were reverted. Commit `0fb67653` retained only the
measured rejection and roadmap status; there is no map-batching runtime
commit.

---

### Task 6: Emit direct early rejection instead of `row_matched`

**Outcome (2026-07-28): completed and rejected.** Structural and semantic
gates passed, packed payload fell by 62,417 bytes, mean/median/max frames fell
from 30.097/32/128 to 28.510/30/128 bytes, and `ldhl sp` fell 10.32%. However,
`object_heavy` logic deterministically regressed 1,149.805 → 1,300.383
ticks/turn (+13.10%, about 36.76 ms). Alternating direct A/B boots reproduced
the regression, so no emitter or exporter-test change was retained. Full
measurements are recorded in the
[optimization ledger](../../performance/gbc-optimization-ledger.md#gbc-direct-early-pattern-rejection-rejected-2026-07-28).

**Files:**

- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [x] **Step 1: Add failing structural assertions for every rule shape**

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

- [x] **Step 2: Run exporter test red**

```bash
cmake --build build --target puzzlescript_gbc_exporter_tests
build/native/puzzlescript_gbc_exporter_tests
```

Expected: structural assertion failure.

- [x] **Step 3: Change the match emitter contract**

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

- [x] **Step 4: Use structured rejection at each caller**

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

- [x] **Step 5: Run structural and semantic parity tests**

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

- [x] **Step 6: Measure bytes, frames, and five-case ticks**

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

- [x] **Step 7: Apply the retention gate — rejected**

The candidate improved three logic cases, left Sokoban neutral, and regressed
`object_heavy` by 13.10%. Candidate source, structural assertions, cart
objects, linked ROM, and perf artifacts were reverted. Only this decision and
the measured ledger entry are retained.

---

### Task 7: Experiment 6a — hoist board and movement base pointers

**Files:**

- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [x] **Step 1: Add a failing structural assertion**

For each emitted rule body, require:

```c
uint8_t* const board = session->board;
uint8_t* const movements = session->movements;
```

and require hot pattern loads to use `board[cell]` /
`((uint16_t*)movements)[cell]`, not `session->board[cell]` /
`session->movements[cell]`.

- [x] **Step 2: Parameterize storage emit helpers**

Change the internal `emitGbdCBoardGet/Assign/Set` and movement siblings to take
`boardExpr` / `movementsExpr`. Existing non-rule callers may pass
`"session->board"` and `"session->movements"`; generated rule functions pass
`"board"` and `"movements"`.

Emit both pointer locals once at the narrowest function that contains the scan
loop. Do not duplicate them in each candidate-cell block.

- [x] **Step 3: Run exporter and oracle tests**

```bash
cmake --build build --target \
  puzzlescript_gbc_exporter_tests \
  puzzlescript_gbc_specialized_oracle_smoke
ctest --test-dir build/native \
  -R "puzzlescript_gbc_(exporter|specialized_oracle)" \
  --output-on-failure
```

- [x] **Step 4: Measure before deciding**

Rebuild the cart and record ticks, payload, frame distribution, and `ldhl sp`.
Hoisted pointers can themselves spill on SM83; retain only if the five-case
suite and frame/ROM metrics improve together. Revert the complete experiment
if SDCC increases frames or payload without a clear tick win.

- [x] **Step 5: Apply the retention gate — rejected**

The candidate reduced packed payload by 110,739 bytes (4.62%), reduced
`ldhl sp` by 18,909 instructions (15.10%), and improved four of the five
logic cases. However, `object_heavy` regressed deterministically from
1,149.805 to 1,253.609 logic ticks per turn: +9.03%, reproduced in three
alternating direct A/B pairs. SDCC kept both pointers in each rule's stack
frame and reloaded them through `ldhl sp`; the global static improvement did
not predict this hot-path loss.

Candidate emitter/test changes and generated, linked, and performance
artifacts were reverted. Only this decision and the measured
[ledger entry](../../performance/gbc-optimization-ledger.md#gbc-generated-boardmovement-base-pointer-hoist-rejected-2026-07-28)
are retained.

---

### Task 8: Experiment 6b — fuse non-fused `matches_at` helpers into scans

**Files:**

- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [x] **Step 1: Add a failing no-helper assertion**

For a fixture that emits collect-all semantics (`applyOnMatch == false`),
assert no symbol contains `_matches_at` and the scan body still writes every
successful candidate into:

```c
session->match_cells[match_count]
```

- [x] **Step 2: Extract one reusable C++ emission lambda**

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

**Dependency adjustment (2026-07-29):** the `do/while` direct-rejection body
in the sketch depended on Task 6's rejected early-rejection experiment. Task
8 was therefore isolated from Task 6: the candidate emitted the current
`row_matched` matcher body verbatim inside a lexical block at each scan site.
It did not reintroduce direct rejection or otherwise change matching
semantics.

- [x] **Step 3: Verify structural and semantic behavior**

```bash
cmake --build build --target \
  puzzlescript_gbc_exporter_tests \
  puzzlescript_gbc_specialized_oracle_smoke
ctest --test-dir build/native \
  -R "puzzlescript_gbc_(exporter|specialized_oracle)" \
  --output-on-failure
```

- [x] **Step 4: Apply the size/speed gate**

Measure all five cases, packed payload, mean/p90/max frames, and `ldhl sp`.
Retain only if call-boundary savings outweigh duplicated bodies. A tick win
that grows the cart requires an explicit byte trade justified by Task 10's
shipping-cart scoreboard and the physical-headroom report.

- [x] **Step 5: Commit or document rejection — rejected**

If retained, commit the code and ledger. If rejected, restore the code, add
only the measured rejection to the ledger, and commit that documentation
separately.

The candidate removed all non-fused helper symbols and passed the exporter,
specialized, any-mask, layer-coupled, and general parity tests. All 46 games
built and passed the cartridge checker. Packed payload fell by 65,633 bytes
(2.74%), packed banks fell from 148 to 144, and `ldhl sp` fell by 6,446
instructions (5.15%).

The required three-boot suite was mixed: Sokoban was neutral, `large_board`
improved 5.37%, `object_heavy` and `two_movement_lanes` were effectively
neutral, but `rule_heavy` regressed from 853.023 to 874.070 logic ticks
(+2.47%, about 5.14 ms/turn) and push rendering regressed from 52 to 53 ticks.
Three alternating direct Task 2/candidate A/B pairs reproduced those exact
numbers. This violates the no-material-fixture-regression gate, so the
emitter, tests, generated artifacts, and performance artifacts were restored.
Only this decision and the measured
[ledger entry](../../performance/gbc-optimization-ledger.md#gbc-collect-all-matcher-scan-inlining-rejected-2026-07-29)
are retained.

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

- [x] **Step 1: Preserve the cart's shared-WRAM invariant in a failing test**

Extend `scripts/check_gbc_cart_test.py` with a generated rules object that has
nonzero `_BSS`; keep the expectation that it is rejected. The experiment must
not put file-scope statics in any `gNN_*` object.

- [x] **Step 2: Add one unnamespaced shared scratch object**

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

- [x] **Step 3: Add an emitter-only experiment switch**

Under a disabled-by-default option, emit references to the shared scratch for
the selected locals. Keep the normal stack-local path for desktop builds
unless the host test explicitly defines the experiment macro.

Never move arrays, property captures, aggregate captures, or row-match arrays
into the shared object in this experiment.

- [x] **Step 4: Run re-entrancy and parity checks**

Document and assert that no interrupt handler calls specialized rules and no
specialized rule recursively calls another rule. Run exporter, oracle,
eligible, cart, and sound/command gates.

Eligible-gate disposition: explicitly waived after the automatic payload and
representative-runtime retention gates failed. This is an early-stop waiver,
not a claimed eligible pass. The full production-cart build had already
compiled and linked all 46 sources, and the measured candidate could no
longer be retained.

- [x] **Step 5: Measure against the new baseline**

Compare:

- five-case count-only ticks;
- packed payload;
- static WRAM;
- mean/p90/max frame bytes;
- `ldhl sp`.

Retain only for a clear speed **and** payload/frame win. The prior 0.301%
interpreter result is not enough, and any per-game `_DATA/_BSS` is an automatic
rejection.

- [x] **Step 6: Commit or fully remove**

If rejected, delete the new header/source/build wiring and record the result
in the ledger. Do not leave a disabled scratch subsystem behind.

Completed 2026-07-29: rejected and fully removed. The candidate used exactly
one shared, unnamespaced nine-byte scratch object; the full 46-game cartridge
passed with zero per-game `_DATA/_BSS`, and structural tests proved that
specialized rule bodies do not call one another or run from the timer
interrupt. The focused `_BSS` fixture passed immediately because the checker
already enforced the invariant; it supplied exact coverage rather than a new
behavioral failure. Mean/p90 rule frames fell from 30.097/50 to 26.014/44
bytes and `ldhl sp` fell 15.36%, but packed payload grew by 55,019 bytes
(2.29%) and four banks. Three-boot mGBA runs regressed `large_board` by
4.16%, `rule_heavy` by 10.46%, and `object_heavy` by 3.18%; three alternating
direct A/B pairs reproduced each result exactly. This failed both the runtime
and payload retention gates, so the header/source, build wiring, switch,
tests, and transient artifacts were restored. The failed gate ended the
experiment with an explicit early-stop waiver for the remaining eligible-ROM
sweep; it is not recorded as an eligible pass. The full production cart had
already compiled and linked all 46 sources. Only this decision and the
measured
[ledger entry](../../performance/gbc-optimization-ledger.md#gbc-shared-specialized-rule-scratch-rejected-2026-07-29)
are retained.

---

### Task 10: Build a cartridge-native per-game solution scoreboard

**Files:**

- Create: `scripts/bench_gbc_cart_solutions.py`
- Create: `scripts/bench_gbc_cart_solutions_test.py`
- Modify: `scripts/build_gbc_cart.py`
- Modify: `firmware/gbc/source/main.c`
- Modify: `firmware/gbc/source/benchmark.c`
- Modify: `firmware/gbc/source/benchmark.h`
- Modify: `Makefile`

- [x] **Step 1: Write failing key-script and telemetry tests**

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

- [x] **Step 2: Add benchmark-cart build mode**

Add `benchmark: bool` to `build_cart()` and CLI `--benchmark`, mutually
exclusive with `--autotest`. Compile shared firmware with:

```text
PS_GBC_CART_BUILD=1
PS_GBC_CART_BENCHMARK=1
```

Name the output `puzzlescript-compilation-benchmark-46.gb` and record
`"benchmark": true` in the cart manifest. Generated game/rule objects remain
byte-identical to production; only shared instrumentation differs.

- [x] **Step 3: Refactor the hardware timer for both benchmark modes**

Compile timer primitives when either `PS_GBC_PERF_BENCH` or
`PS_GBC_CART_BENCHMARK` is set. Do not enable phase probes in the cart
scoreboard.

- [x] **Step 4: Accumulate one user-visible turn correctly**

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

- [x] **Step 5: Reuse/generate first-retained-board fixtures**

Import `ELIGIBLE_GAMES` from `build_gbc_eligible_roms.py`; do not copy the
46-entry tuple again.

Use fixtures from
`build/gbc/eligible/solution-fixtures/<slug>/board-0.txt` when present.
Otherwise reuse the existing retained-board solving helpers in
`bench_gbc_eligible_solutions.py` to solve board 0 and cache the fixture.
Report unsolved games explicitly; never silently omit them.

- [x] **Step 6: Drive one fresh libmGBA boot per game**

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

- [x] **Step 7: Add the Make target**

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

- [x] **Step 8: Run focused tests and a three-game smoke scoreboard**

```bash
python3 scripts/bench_gbc_cart_solutions_test.py
python3 scripts/bench_gbc_cart_solutions.py \
  --repository . --limit 3 \
  --compiler build/native/puzzlescript_cpp \
  --gbdk-home .codex_tmp/toolchains/gbdk \
  --out build/gbc/cart/solution-bench-cart-3.json
```

Expected: three indexed, winning rows with nonzero timer counts.

- [x] **Step 9: Run all 46 and commit**

```bash
make gbc_cart_solutions_bench
```

Expected: a report for all 46 games, explicit failures for any unsolved first
board, and stable worst-ten lists across a repeated run.

```bash
git add scripts/bench_gbc_cart_solutions.py \
  scripts/bench_gbc_cart_solutions_test.py scripts/build_gbc_cart.py \
  firmware/gbc/source/main.c firmware/gbc/source/benchmark.c \
  firmware/gbc/source/benchmark.h Makefile
git commit -m "Benchmark solution turns on the GBC compilation cart"
```

Task 10 completed on 2026-07-29. The 46-game benchmark cart linked across
148 packed banks at 7,543/8,192 HOME bytes and 5,965/6,080 static WRAM bytes.
All 381 generated game/rule objects were byte-identical to the matching
production build; the benchmark adds only shared instrumentation.

Two fresh-boot libmGBA sweeps reproduced exactly: 36/46 games published
winning records, 848 user-visible turns were timed, and both worst-ten index
orders plus every successful `(logic, render, maximum-turn)` tick tuple were
identical. Weighted totals were 507.532 logic ticks/turn, 724.519 combined
interaction ticks/turn, and 203.545 render ticks/redraw. The slowest measured
logic games were `sokobond-demake`, `wand-spinner`,
`m-c-eschers-armageddon`, and `manic_ammo`; this confirms the scoreboard is
not Sokoban-only.

Successful rows expose fixture consumption explicitly.
`sokobond-demake` remains successful and ranked, but is classified as a
cart-versus-fixture semantic divergence because the cart wins after 6 of its
10 fixture tokens. Its row records 4 unused tokens and `early_cart_win=true`;
ordinary successful replays record zero unused tokens and
`early_cart_win=false`.

Failures remain explicit in the JSON: `slot-machine` has a zero-turn replay,
`voitex-rasteriser` times out in the solver, and eight fixtures do not publish
a cart win. Bounded host-GBC classification found two baseline/specialized
fixture divergences (`crate-guardian`, `two-tone-tango`), one specialized-only
divergence (`no-forbidden-symbols-2`), and five cartridge/integration
follow-ups (`hedgehog-stimulator`, `the-red-ring-of-immortality`,
`unclean-residues`, `pipe-puffer`, `yellow-box`). Those follow-ups are not
silently excluded and are outside Task 10's measurement-harness scope.

Validation passed the focused Python contracts, all 17 native GBC tests, all
753 JS tests, the nine-game launcher/cart smoke, the full structural/capacity
checker, and a fixed-frame libmGBA replay of the legacy PERF ROM. The external
macOS mGBA app/save polling path failed on both the new and pre-Task10 control
ROMs, while the in-process libmGBA backend parsed the complete perf record;
that is recorded as an environmental harness limitation, not a firmware
timer regression.

---

### Task 11: Inventory shareable cart objects before changing the bank ABI

**Files:**

- Create: `scripts/analyze_gbc_cart_sharing.py`
- Create: `scripts/analyze_gbc_cart_sharing_test.py`

- [x] **Step 1: Write a failing normalized-cluster test**

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

- [x] **Step 2: Implement source/object normalization**

Normalize only:

- leading `_gNN_` / `b_gNN_` symbol namespaces that match the containing
  `gNN_` object, plus the corresponding leading object/module prefix;
- `_CODE_N` area numbers;
- symbol addresses and generated bank literals.

Do not normalize instruction bytes, constants, call targets after namespace
removal, or relocation kinds.

Parse defined/undefined symbols from the ASxxxx text objects and list every
normalized per-game reference. Mark an object directly shareable only when a
single definition can satisfy every consumer without a per-game alias or
cross-bank access.

- [x] **Step 3: Run against the shipping cart**

```bash
python3 scripts/analyze_gbc_cart_sharing.py \
  --objects build/gbc/cart/objects \
  --manifest build/gbc/cart/cart-manifest.json \
  --out build/gbc/cart/sharing-analysis.json
```

Expected: reconcile the roadmap's approximately 148 KB gross duplicates and
explain how much is blocked by namespaced data/call references.

- [x] **Step 4: Apply the design gate**

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

- [x] **Step 5: Commit the analysis tool/report conclusion**

Commit the tool/test and the ledger conclusion. Build artifacts remain
untracked.

Task 11 completed on 2026-07-30 against the preserved Task 10 revision
`9dab2dfa`. The untracked report is
`build/gbc/cart-task10-9dab2dfa/sharing-analysis.json`.

The analyzer parsed 473 per-game ASxxxx objects and reproduced the roadmap
exactly: 110,558 duplicate bytes in `generated_core`, 27,160 in
`generated_facade_rules`, and 10,644 in `generated_compact_facade`, for
148,362 bytes total. The manifest/object map is an exact 473/473 bijection.
All 1,634 per-game symbol-reference records resolved; 884 are same-bank, 750
are cross-bank, and none has unknown bank ownership. No duplicate cluster is
directly shareable because every cluster needs namespaced aliases, per-game
references, different-bank ownership, or consumers outside the retained
implementation bank.

The conservative design model retains one implementation for each of 25
configuration clusters and subtracts 1,034 bytes of descriptor/context
state, 7,664 bytes of HOME/`BANKED` aliases, 1,856 bytes for 58 modeled shared
bridge/thunks, and a 25,414-byte genericity reserve. That model yields
112,394 bytes net. A stronger stress bound replaces the 58-thunk allowance
with 32 bytes for each of all 750 observed cross-bank reference records
(24,000 bytes), yielding 90,250 bytes. The 65,536-byte gate uses the stress
bound and still passes.

Per the gate, no packer, generated-code, or bank-ABI change was made here.
The approved follow-up design and its separate unexecuted plan are:

- `docs/superpowers/specs/2026-07-30-gbc-shared-compact-facade-design.md`
- `docs/superpowers/plans/2026-07-30-gbc-shared-compact-facade.md`

They authorize only a default-off, same-bank `g21`/`g31` compact-facade
alias canary. Broader facade-rules/core or cross-bank sharing requires a new
evidence checkpoint and approval.

---

### Task 12: Experiment with shared direction-expanded rule bodies

**Files:**

- Modify: `native/src/compiler/compact_turn_codegen.hpp`
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/src/gbc/exporter.cpp`
- Modify: `native/tests/gbc_exporter.cpp`

- [x] **Step 1: Add an opt-in failing structural test**

Add `shareDirectionalBodies` to `GbcSpecializedTurnEmitOptions`, default
false. In an exporter fixture with four direction-expanded siblings, enable it
and assert:

- one parameterized family body is emitted;
- four thin rule entry points retain the original rule indices/order;
- the family receives direction, `delta`, and scan bounds explicitly;
- default exports remain byte-for-byte structurally unchanged.

- [x] **Step 2: Emit one family only for proved-equivalent siblings**

Build a family key from every semantic field except direction and derived scan
bounds:

- pattern masks/flags/replacements;
- property, aggregate, any-layer, and layer-coupled bindings;
- commands, message, and sound references;
- row shape and apply-on-match mode.

Only siblings with identical keys may share. Emit the existing body once with
direction/delta/bounds parameters, and retain thin indexed wrappers so group
scheduling and rule sound/message identity do not change.

- [x] **Step 3: Verify oracle and full structural parity**

Run exporter/oracle tests, the full eligible corpus, command/sound gates, and
cart smoke. Reject on any ordering, simultaneous-match, or sound difference.

- [x] **Step 4: Judge with the cart scoreboard**

Compare:

- packed payload and rule-pack bytes;
- worst-ten cart logic and interaction ticks;
- weighted ticks/turn across successful rows;
- function frames and `ldhl sp`.

Retain only if payload falls by at least 1%, weighted cart timing regresses by
no more than 2%, and no measured game regresses by more than 5%. These are
experiment gates, not a permanent product latency target.

- [x] **Step 5: Commit or record rejection**

Keep the option default false until the complete gate passes. If it passes,
make the selected policy explicit in exporter/cart build configuration and
commit one measured change. If it fails, remove the option and record the
result.

Completed 2026-07-30: rejected and fully removed. The default-off structural
fixture first failed on the missing option, then proved one parameterized
body, original indexed wrappers/order, explicit direction/delta/bounds, and
byte-identical default output. The complete family key covered every required
semantic field; 45 conservative two-rule families produced 90 wrappers in
eight games. The exact 46-game benchmark cart passed export, link, bank,
HOME, WRAM, identity, and specialization checks.

Size passed: packed payload fell 32,218 bytes (1.34%), rule packs fell 3.30%,
and allocated banks/highest bank fell from 148/150 to 146/148. Aggregate
timing also passed: weighted logic rose 0.55% and interaction rose 0.39%.
However, two fresh-emulator sweeps reproduced `dollyban` at
675.296→745.259 logic ticks/turn (+10.36%) and 819.444→889.593 interaction
ticks/turn (+8.56%), violating the mandatory 5% per-game ceiling. Its five
families replaced direct unrolled entry with ten wrappers that stack eight
arguments before the family call. The candidate eligible-ROM and cart-smoke
sweeps were waived after this automatic rejection gate failed; they are not
claimed as passes. The option, implementation, wiring, and tests were
restored. Only this disposition and the measured
[ledger entry](../../performance/gbc-optimization-ledger.md#gbc-direction-expanded-rule-body-sharing-rejected-2026-07-30)
remain.

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
