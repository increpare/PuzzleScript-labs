# Game Boy Color extended optimization plan

Date: 2026-07-27
Revalidated: 2026-07-28
Target revision: `master` @ `980ce35b` (`Make GBC launcher paging hardware-safe`)
Supersedes as the active roadmap: the "Recommended implementation order" of
[`gbc-opportunity-audit-2026-07-22.md`](gbc-opportunity-audit-2026-07-22.md),
whose P0/P1/P2 items are now retained (see
[`gbc-optimization-ledger.md`](gbc-optimization-ledger.md)).

---

## 2026-07-28 master revalidation

Commits `a13b34a3` through `980ce35b` pre-rendered the launcher art, packed it
into the cart, and added fixed-bank ROM/WRAM-to-VRAM DMA helpers. They did not
change `tile_cache.c`, the benchmark scripts, or the specialized emitter, so
the render and code-generation measurements below remain the correct starting
questions. They do change two implementation constraints:

- The production cart now links at **5,922 / 6,144 bytes of static WRAM**.
  Renderer staging and a larger composition cache cannot be added as
  independent static arrays. Tasks 2-4 must first establish a phase-overlaid
  memory design that reuses launcher-only storage while a game is active, or
  be rejected. The measurement work may proceed before that design.
- The cart contains 46 games, 522,240 bytes of launcher art, and 2,398,105
  bytes of packed payload across 148 allocated banks. Those allocated banks
  are 98.90% full, but the highest used bank is only 150. Banks 151-255 leave
  approximately **1,747,047 bytes of physical 4 MB capacity** after the
  current packed payload. The immediate "4 MB wall" premise is therefore no
  longer true.
- `ps_gbc_rom_vram_dma_hblank()` and
  `ps_gbc_wram_vram_dma_hblank()` now provide tested, fixed-bank transfer
  primitives. Task 4 must reuse them rather than introduce another DMA path.
- Fixed ROM is now **7,020 / 8,192 bytes**. New NONBANKED code is a scarce
  resource and must be reported for every retained experiment.

Accordingly, Tasks 0-7 remain active. Task 8a/8b are optional size
experiments to judge after the cart-native scoreboard exists; Task 8c (8 MB)
is deferred until measured 4 MB headroom again becomes a product constraint.

---

## 1. Executive conclusion

Three things changed since the 2026-07-22 audit, and all three change what to
work on next.

**1. Rendering, not rule matching, is now the largest share of move latency in
two of the five benchmark shapes.** The audit concluded "the current
performance problem is rule matching, not drawing" and measured rule phases at
76–98% of a turn. Specialized turn codegen has since cut logic by 77–96%. It
did not touch the renderer. Re-measuring today on the same harness:

| Case | Logic (walk) | Redraw (walk) | Move latency | Redraw share |
| --- | ---: | ---: | ---: | ---: |
| sokoban | 44 ticks / 10.7 ms | 56 ticks / 13.7 ms | 24.4 ms | **56%** |
| large_board (pushit) | 99 ticks / 24.2 ms | 513 ticks / 125.2 ms | 149.4 ms | **84%** |
| rule_heavy (Xorro) | 849 ticks / 207 ms | 52 ticks / 12.7 ms | 220 ms | 6% |
| object_heavy (slot machine) | 1152 ticks / 281 ms | 460 ticks / 112 ms | 393 ms | 29% |
| two_movement_lanes (Voitex) | 2436 ticks / 595 ms | 91 ticks / 22.2 ms | 617 ms | 4% |

The entire retained optimization program — 40-plus ledger entries — points at
the logic column. The renderer has had no dedicated experiment since the
`2026-07-22` bounded-precomposition work, and it now costs more than logic in
the flagship case.

**2. ROM size remains a required score, but is no longer the binding product
constraint.** The shipping 46-game cartridge now has 2,398,105 packed bytes
and uses banks through 150. Its 148 allocated banks are 98.90% full, while
banks 151-255 leave about 1.75 MB of physical 4 MB headroom. Every
optimization is still scored on bytes as well as ticks, but speed work no
longer needs to fund the next game immediately. The old 6.0% game-data share
also predates 522,240 bytes of launcher art and must be re-reported by Task 0
before it is used for prioritization.

**3. The specialized emitter's SM83 output is dominated by stack-frame
addressing, and nobody has looked at it.** Across the 1,394 emitted rule
functions in the shipping cart, the mean stack frame is **31.2 bytes** (median
32, p90 53, max 128), and the rule packs contain **125,200 `LD HL,SP+e`
instructions** — at 2 bytes each, roughly **250 KB, or 13% of all code emitted
into the cartridge, spent purely on computing stack addresses**. Reducing
register pressure in the emitter is
simultaneously the largest remaining speed lever and the largest size lever.

The plan below is ordered by measured value per unit of risk: renderer first
(largest untouched win, smallest blast radius), emitter register pressure
second (largest combined speed+size win), cartridge capacity third.

Handwritten SM83 remains **not yet justified**. The audit's assembly threshold
was "after the C rewrite and packed pattern work"; those landed, but the
evidence below shows the emitted C is still asking SDCC for far more live
values than SM83 has registers. Fix the request before hand-coding the answer.

---

## 2. Measurement protocol used for this document

- Emulator: mGBA (Homebrew `mgba` 0.10.x and `/Applications/mGBA.app`),
  CGB-only cartridge, CGB double-speed (`cpu_fast()`, `main.c:983`).
- Timing source: emulated CGB 4096 Hz hardware timer. **1 tick = 244.14 µs**;
  one 59.7 Hz frame = 68.5 ticks.
- Harness: `scripts/run_gbc_benchmark_suite.py`, unchanged.
- Toolchain: `.codex_tmp/toolchains/gbdk`, `build/native/puzzlescript_cpp`.

Reproduce with:

```sh
python3 scripts/run_gbc_benchmark_suite.py \
  --label current-2026-07-27 --runs 3 \
  --gbdk-home "$PWD/.codex_tmp/toolchains/gbdk" \
  --compiler "$PWD/build/native/puzzlescript_cpp" \
  --baseline docs/performance/gbc-baseline.json \
  --out build-gbc-release/benchmarks/current-2026-07-27.json
```

Note both required deviations from the documented invocation: the suite's
default compiler path (`build-gbc-release/native/puzzlescript_cpp.exe`) does
not exist on this checkout, and `--compiler` / `--gbdk-home` **must be
absolute** or `firmware/gbc/Makefile` fails with `No rule to make target`.
Fixing those defaults is Task 0.

**Provenance and confidence.** The timing tables in §1 and §3 satisfy the
retained protocol. They were produced twice from independent builds: once at
`--runs 1` and once at `--runs 3`. The suite aborts with `nondeterministic
benchmark` if any two boots of a case disagree
(`scripts/run_gbc_benchmark_suite.py:273`), and the three-boot invocation
exited clean, so every counter was identical across three boots per case.
Comparing the two invocations, **all five cases agree exactly** on
`ticks_per_turn`, `walk_render`, `push_render`, and `initial_render` — four
independent boots per case in total. Raw result:
`build-gbc-release/benchmarks/confirm-3boot-2026-07-27.json`.

The static ROM/assembly measurements in §4 and §6 are exact — they are counted
from the shipped `build/gbc/cart/` artifacts, not sampled.

---

## 3. Current state

### 3.1 Whole-suite timings (2026-07-27)

| Case | Logic ticks/turn | vs original baseline | Isolated compose/frame | Initial render |
| --- | ---: | ---: | ---: | ---: |
| sokoban | 44.594 | −93.9% | 4096.2 | 895 ticks / 218 ms |
| large_board | 104.117 | −96.4% | 4728.2 | 1003 ticks / 245 ms |
| rule_heavy | 853.008 | −90.3% | 5307.2 | 882 ticks / 215 ms |
| object_heavy | 1149.797 | −92.1% | 10812.0 | 3684 ticks / **899 ms** |
| two_movement_lanes | 2440.352 | −76.9% | 8766.8 | 1048 ticks / 256 ms |

Memory, all within limits:

| Case | Session B | Static WRAM | Snapshot SRAM | Fixed ROM |
| --- | ---: | ---: | ---: | ---: |
| sokoban | 433 | 2577 | 210 | 6390 |
| large_board | 521 | 2665 | 315 | 6390 |
| rule_heavy | 490 | 2634 | 280 | 6390 |
| object_heavy | 916 | 3060 | 1440 | 6390 |
| two_movement_lanes | 1080 | 3224 | 1620 | 6390 |

### 3.2 A metric trap to fix immediately

`render_ticks_per_frame` for large_board reads **4.25** while its interaction
redraw reads **513**. The 128-turn logic sample alternates right/left, and
pushit's board net-returns to its previous state, so the retained clean-dirty
render guard correctly returns early and the "render" sample measures almost
nothing. The same distortion affects any game whose R/L alternation is a
no-op.

**`render_ticks_per_frame` is therefore not a usable headline rendering
metric.** Use `interaction_ticks.walk_render` / `push_render`. Task 1 changes
the suite to report and regress on those.

### 3.3 Current cart capacity

`scripts/build_gbc_cart.py` still caps the cart at bank 255 (4 MB), and
`scripts/check_gbc_cart.py` still enforces a 4 MiB ROM. The revalidated cart
uses 148 allocated payload banks at 98.90% fill, but only through bank 150,
leaving banks 151-255 available. Composition of the pre-launcher
1,894,332-byte build was:

| Module kind | Objects | Bytes | Avg | Share |
| --- | ---: | ---: | ---: | ---: |
| `generated_specialized_turn_rules_*` | 151 | 977,269 | 6,471 | **51.6%** |
| `generated_core` (`#include "core.c"`) | 46 | 386,112 | 8,393 | **20.4%** |
| `generated_specialized_turn` | 46 | 256,397 | 5,573 | 13.5% |
| `generated_facade_rules` | 46 | 126,951 | 2,759 | 6.7% |
| `generated_game` (**the actual game data**) | 46 | 113,063 | 2,457 | **6.0%** |
| `generated_compact_facade` | 46 | 16,073 | 349 | 0.8% |
| `cart_index` + shared firmware | 6 | 18,467 | — | 1.0% |

Treat this table as historical evidence for the emitter focus, not the
current cart composition. Task 0 replaces it with a reporter that includes
launcher-art objects and distinguishes allocated-bank slack from physical
bank headroom. The original measurement can be reproduced with:

```sh
python3 - <<'PY'
import re, pathlib, collections
AREA = re.compile(r"^(A\s+)_CODE_(\d+)(\s+size\s+)([0-9A-Fa-f]+)(\b.*)$")
sizes, counts = collections.Counter(), collections.Counter()
for f in sorted(pathlib.Path('build/gbc/cart/objects').glob('*.o')):
    total = sum(int(m.group(4), 16)
                for m in (AREA.match(l) for l in f.read_text(errors='replace').splitlines())
                if m)
    kind = re.sub(r'_rules_\d+$', '_rules_N', re.sub(r'^g\d+_', '', f.stem))
    sizes[kind] += total
    counts[kind] += 1
for k, v in sizes.most_common():
    print(f'{k:45} {counts[k]:4} {v:8}')
PY
```

---

## 4. Evidence: where the bytes and cycles actually go

### 4.1 The emitted matcher spends most of its instructions on the stack

`emitGbcSpecializedFusedMatchApplyAt`
(`native/src/compiler/compact_turn_codegen.cpp:8074`) and
`emitCompactInlineGbdCPatternMatch` (`:7225`) emit a boolean-flag protocol:

```c
bool row_matched = true;
uint8_t cell = start;
if (row_matched) { uint32_t p0_objects = session->board[cell];
                   if ((p0_objects & 0x3cU) != 0U) row_matched = false; }
cell = (uint8_t)((int16_t)cell + delta);
if (row_matched) { ... }
```

SDCC's actual SM83 output for that (`build/gbc/cart/objects/
g10_generated_specialized_turn_rules_0.asm`, game `pushit`, rule 0):

```asm
_ps_gbc_specialized_rule_0_matches_at:
        add     sp, #-4
        ...
        ldhl    sp, #0          ; row_matched lives on the stack
        ld      (hl), #0x01
        ...
        and     a, #0x3c        ; the useful work: 1 instruction
        jr      Z, 00104$
        ldhl    sp, #0
        ld      (hl), #0x00     ; row_matched = false
00104$:
        ldhl    sp, #1          ; reload cell
        ld      a, (hl)
        ldhl    sp, #6          ; reload delta
        add     a, (hl)
        ld      e, a
        ldhl    sp, #0          ; re-test row_matched
        bit     0, (hl)
        jr      Z, 00108$
```

Four separate observations, each independently actionable:

1. **The flag protocol costs ~9 M-cycles per pattern to emulate
   short-circuiting.** `ldhl sp,#0` (3 M) + `bit 0,(hl)` (3 M) + `jr` (2–3 M)
   runs before *every* pattern, on *every* candidate cell, and the
   `row_matched = false` store runs on the common rejection path. A `return
   false` / `goto next_cell` gives the same semantics for zero instructions
   and makes rejection the fall-through edge — precisely what the audit's
   GBCTR cross-check recommended (`gbc-opportunity-audit-2026-07-22.md:541`).
   There are **3,139 `if (row_matched)` guards across 1,064 emitted match
   sites** in the shipping cart.

2. **`static inline` is a no-op for SDCC.** `matches_at` is emitted as a real
   function with `add sp,#-4`, a `CALL`, and an `add sp,#4 / pop hl / inc sp /
   jp (hl)` epilogue — 10+ M-cycles of call boundary per candidate cell,
   which the audit called out explicitly (`:539`).

3. **Base pointers are re-derived per pattern.** Each `session->board[cell]`
   reloads the session pointer from the stack, walks to the `board` member,
   and rebuilds the pointer in BC; `session->movements[cell]` repeats the walk
   with a `+4` offset. Hoisting `board` and `movements` into the scan loop
   removes ~15 M-cycles per pattern.

4. **The `uint32_t` locals are *not* a problem.** SDCC correctly narrows
   `uint32_t p0_objects = session->board[cell]` to `ld a,(hl) / and a,#0x3c`
   for a one-byte board. The width-specialization work did its job; no action
   needed here.

### 4.2 Corpus-wide register pressure

Measured across every `*_generated_specialized_turn_rules_*.asm` in
`build/gbc/cart/objects`:

| Metric | Value |
| --- | ---: |
| Emitted rule functions | 1,394 |
| Mean stack frame | **31.2 bytes** |
| Median / p90 / max frame | 32 / 53 / 128 bytes |
| Functions with frame ≥ 32 B | 719 (52%) |
| `ldhl sp,#n` instructions | **125,200** |
| Estimated ROM in `ldhl sp` alone (2 B each) | **~250 KB (13% of emitted code)** |

For comparison, the audit celebrated reducing the *interpreter's* matcher
frame from 16 to 7 bytes and its replacement frame from 32 to 14
(`gbc-opportunity-audit-2026-07-22.md:824`). The specialized emitter has
regressed past the pre-optimization interpreter by 2–8×.

The `_ps_gbc_specialized_rule_0` prologue is `add sp, #-53`, followed by long
runs of byte-at-a-time copies *between stack slots*:

```asm
        ldhl    sp, #3
        ld      a, (hl)
        ldhl    sp, #45
        ld      (hl), a
        ldhl    sp, #3
        ld      a, (hl)
        ldhl    sp, #46
        ld      (hl), a
```

This is SDCC's register allocator giving up: the emitted function asks for
more simultaneously-live 16-bit values (session, commands, board, movements,
dirty, match_cells, plus loop induction variables) than SM83's three general
register pairs can hold.

**This re-opens a rejected experiment.** "GBC-only static matcher scratch" was
rejected at −0.301% for +79 bytes
(`gbc-opportunity-audit-2026-07-22.md:648`) — but that was measured against a
**7-byte** interpreter frame. GBDK documents that file-scope statics beat
stack locals on SM83 because they are absolutely addressable. Against a
31-byte frame the trade very plausibly inverts. Re-test it (Task 6).

### 4.3 The renderer pays an indirect bank-switch per object per cell

Measured: **`composeTile` costs 11.4 ticks (2.8 ms) per cell** on Sokoban
(`composition_ticks_per_frame` 4096.25 over 360 screen cells). For a 25-pixel
sprite composite that is roughly two orders of magnitude off.

`firmware/gbc/source/tile_cache.c:34-83` calls `ps_gbc_active_rom_copy` twice
inside the per-render-object loop — confirmed in
`build/gbc/cart/objects/shared_tile_cache.asm`, which contains exactly two
`call _ps_gbc_active_rom_copy` sites in `composeTile`'s body. Each call
reaches `ps_gbc_bank_copy` (`native/src/gbc/bank_access.c:11`), which does:

- three NULL/validity checks,
- an **indirect** call through `access->current_bank`,
- an **indirect** call through `access->switch_bank`,
- a byte-at-a-time copy loop with a `uint16_t` induction variable,
- a second indirect `switch_bank` to restore.

So a game with *N* render objects performs *N* bank save/switch/restore cycles
**per screen cell**, just to read *N* small structs that never change during a
render, plus one more per object that actually draws.

### 4.4 VRAM writes busy-wait, and there is no VBlank batching

`set_vram_byte` in the GBDK build is, verbatim from the linked ROM at `0x121C`
(`21 41 ff cb 4e 20 fc 12 c9`):

```asm
_set_vram_byte:
        ld      hl, #0xFF41     ; STAT
        bit     1, (hl)
        jr      NZ, -4          ; spin while PPU is in mode 2 or 3
        ld      (de), a
        ret
```

`mapComposition` (`tile_cache.c:234-264`) performs **eight** such writes per
dirty cell (four tile numbers + four attributes), each preceded by a `VBK_REG`
bank flip, all with the LCD on — `renderBoard()` runs at `main.c:976`,
*before* `vsync()` at `:978`, so none of it lands in VBlank. During active
display the PPU denies VRAM for roughly 252 of every 456 dots.

Two cheap structural wins fall out: the four tile-number writes and four
attribute writes can be grouped so the `VBK_REG` flip happens twice instead of
eight times, and the whole incremental update can be staged into the existing
`gTileMap` / `gAttributes` shadows and flushed inside VBlank.

### 4.5 The tile budget is statically partitioned for the worst case

`firmware/gbc/source/tile_cache.h`:

- `PS_GBC_CACHE_TILE_OFFSET 64` (tiles 0–63 are the 47-glyph text font)
- `PS_GBC_CACHE_COMPOSITIONS 16` → 64 tiles of shared composition cache
- `PS_GBC_DEDICATED_TILE_OFFSET 128`, then `PS_GBC_MAX_BOARD_CELLS 90` × 4 =
  **360 tiles reserved for the 10×9 worst case**

Total 488 of the 512 available BG tiles. But a level is usually far smaller
than 10×9 — Sokoban's first board is 42 cells, needing 168 dedicated tiles and
leaving **280 tiles ≈ 70 additional cache entries unused**. `findCachedComposition`
(`tile_cache.c:198`) is a linear scan, so the cache size is a pure
speed/coverage trade with no fixed cost. Sizing the split from the loaded
level's actual cell count is a small change with a large effect on the
cache-miss-bound cases (object_heavy: 460-tick redraw).

### 4.6 There are zero rendering probes

`ps_gbc_perf_phase` (`native/include/puzzlescript/gbc.h:77`) defines seven
phases — snapshot, setup, early rules, movement, late rules, commands, win.
All seven are logic. There is no probe for composition, cache lookup, cache
hit/miss, tile upload, map write, or VRAM stall.

Consequently the 56-tick Sokoban redraw and the 513-tick pushit redraw are
currently **unattributed**. §4.3–4.5 are three plausible causes with hard
supporting evidence, but the split between them is unmeasured. Task 1 fixes
this before Tasks 2–4 spend effort.

### 4.7 Duplicate code across the 46-game cart

Normalising each linked object for its per-game namespace (`gNN_` prefixes),
`_CODE_n` bank number, and symbol addresses, then hashing:

| Module | Distinct contents / 46 | Exact-duplicate bytes |
| --- | ---: | ---: |
| `generated_core` | 33 | 110,558 |
| `generated_facade_rules` | 36 | 27,160 |
| `generated_compact_facade` | 15 | 10,644 |
| **Total** | | **148,362 B (7.9% of payload)** |

`generated_core.c` is literally:

```c
#pragma bank 13
#include "generated_namespace.h"
#include "core.c"
```

i.e. the whole GBC core recompiled per game so that its constants specialise
and so that it lands co-located in that game's bank. 148 KB of it is
byte-identical. A further ~100 KB sits in same-size-but-different clusters
(23 distinct `generated_core` sizes over 46 games) that a configuration-
parameterised shared core could likely reach.

The obstacle is real and must be respected: the retained co-located
core/data bank bridge gate requires **0/46 forbidden shared→generated
references** and `46/46` core+game ownership in the computed bank
(`gbc-optimization-ledger.md:1303`). Sharing a core across games means calling
it across banks. That is a design change, not a linker flag.

---

## 5. What not to do

Recording these so the next session does not re-derive them.

- **Do not write handwritten SM83 for the matcher yet.** §4.1–4.2 show the
  emitted C still asks for 4–8× more live state than the machine has. Fix the
  request first; the audit's 10%-post-C threshold has not been reached because
  the post-C state was never achieved for the *specialized* path.
- **Do not enable `--opt-code-speed`.** Measured +2.64% slower and +62 bytes
  on rule_heavy, and it produced an invalid addressing mode in `tile_cache.c`
  (`gbc-opportunity-audit-2026-07-22.md:510`).
- **Do not pursue idle-time speculative execution.** Five inputs × a 220–617 ms
  turn, a monolithic non-abortable `ps_gbc_step`, and the loss of the
  `vsync()`/`HALT` battery saving. Revisit only if optimised worst cases still
  miss the latency target.
- **Do not re-try the one-call quartet upload.** Already measured at 0.00%
  initial-render improvement.
- **Do not re-try board hashing for the `again` net-change gate.** It blew
  Sokoban from 88.6 to ~304 ticks/turn; the retained undo-slot `memcmp` is the
  right shape (`gbc-optimization-ledger.md:929`).
- **Do not re-try paired-byte SRAM snapshot copies.** Snapshot phase 14→18,
  whole turn 51.7→55.7.
- **Do not raise `PS_GBC_VIEWPORT_*` or cull policy as a performance change.**
  The 67-game "board cull-all" wall is a product decision about 10×9 boards.
  It belongs in a compatibility plan, not this one.

---

## 6. The plan

Tasks are ordered so that each one's measurement justifies the next. Every
task carries the standing gates in §7.

### Task 0 — Make the benchmark harness runnable as documented

**Why:** two invocation defects cost 20 minutes before any measurement could
start, and they will cost the same for every future session.

**Files:**
- Modify: `scripts/run_gbc_benchmark_suite.py` — default `--compiler` to the
  repository's `build/native/puzzlescript_cpp` (and `.exe` on Windows), and
  `Path.resolve()` both `--compiler` and `--gbdk-home` before passing them to
  `make`.
- Modify: `firmware/gbc/README.md` — record the absolute-path requirement.

**Done when:** the §2 command works with relative `--compiler`/`--gbdk-home`
and produces the same JSON.

### Task 1 — Render-phase instrumentation and an honest render metric

**Why:** §4.6. Tasks 2–4 are three competing explanations for the same
unattributed 56/513/460-tick redraws. Do not guess between them.

**Files:**
- Modify: `native/include/puzzlescript/gbc.h:77` — add a
  `ps_gbc_perf_render_phase` enum: `COMPOSE`, `CACHE_LOOKUP`, `ENCODE`,
  `TILE_UPLOAD`, `MAP_WRITE`.
- Modify: `firmware/gbc/source/tile_cache.c` — probe those five phases under
  the existing `PS_GBC_PERF_PHASES` guard, plus **count-only** counters for
  dirty cells, cache hits, cache misses, dedicated-tile fallbacks, and
  uploaded quartets (count-only probes are cheap enough for the headline ROM;
  timer probes are not — keep them in the separate phases ROM, per the
  retained protocol).
- Modify: `firmware/gbc/source/benchmark.c` — publish them to SRAM alongside
  `phase_ticks` / `schedule_counts`.
- Modify: `scripts/run_gbc_benchmark_suite.py` — surface
  `interaction_ticks.walk_render` / `push_render` as the headline rendering
  metrics and mark `render_ticks_per_frame` as diagnostic-only (§3.2).

**Done when:** the five cases report a render-phase split whose probe overhead
is stated separately, and `walk_render` / `push_render` appear in the suite's
comparison output.

**Decision gate:** whichever of compose / cache-miss / VRAM-stall dominates
selects the order of Tasks 2, 3, 4.

### Task 2 — Remove render-time bank copies within the WRAM gate

**Why:** §4.3 — measured 2.8 ms per `composeTile`, with two indirect
bank save/switch/restore cycles per render object per cell.

The original whole-render bank bracket is invalid: `tile_cache.c` itself
executes from switchable bank 1, so selecting a game's data bank removes the
renderer code from `0x4000-0x7fff`. The active implementation direction is
one-time staging while the game bank is selected.

The 2026-07-28 cart has only 222 bytes of static-WRAM headroom, so staging
cannot use new independent globals. After Task 1 reports the phase split,
write and approve a focused memory-overlay design that proves launcher-only
storage and active-game renderer/session storage never overlap in time. The
design must include exact linked-byte accounting, launcher cache
reinitialization rules if any cached storage is overlaid, and a smoke test
that crosses launcher → game → launcher. Do not begin renderer staging until
that design is accepted.

Once accepted, stage the bounded render-object masks, palettes, sprite pixels,
and any precomposed data selected by the measurement. The hot composition
path must perform no active-ROM copies; all storage must remain inside the
existing 6 KiB link gate.

**Expected:** large reduction in `composition_ticks_per_frame` (currently
4096–10812) and in `initial_render` (currently 218–899 ms). Neutral on logic.

**Risk:** overlay lifetime mistakes can corrupt launcher paging or game
session state. Assert the mode transition and zero-render-copy invariants in
the autotest build.

### Task 3 — Size the composition cache from the loaded level

**Why:** §4.5 — 360 tiles are reserved for a 90-cell worst case while the
shared cache is pinned at 16 entries; object_heavy's 460-tick redraw is
cache-miss bound.

**Files:**
- Modify: `firmware/gbc/source/tile_cache.h:8-18` — make the cache/dedicated
  split a runtime value derived from the loaded level's cell count instead of
  two compile-time constants.
- Modify: `firmware/gbc/source/tile_cache.c:198-232` — allocate
  `gCompositionMasks` / `gCompositionPalettes` at the maximum
  (`(512 − 64) / 4 = 112` entries: 112 × 4 B masks + 112 × 1 B palettes =
  560 B static WRAM) and bound the live count by the level.
- Modify: `firmware/gbc/source/main.c:365` — recompute the split on level load.

**Measure first:** `findCachedComposition` is a linear scan with 32-bit
compares. Growing 16 → 70 entries lengthens every lookup. If Task 1 shows
lookup already material, narrow the compare to the game's proved
`object_bytes_per_cell` (the same width specialisation already retained for
patterns) before growing the table, or switch to a small hash.

**Expected:** near-elimination of dedicated-tile fallbacks on small boards.

### Task 4 — Batch incremental VRAM updates into VBlank

**Status (2026-07-28): rejected after measurement.** The implementation
sequence called this renderer experiment Task 5. A row-span prototype passed
the semantic, live-smoke, cart, and memory gates and reduced aggregate
diagnostic `map_write` time from 569 to 433 ticks. However, count-only
walk/push redraws regressed in all five benchmark cases, including
`large_board` (514/517 → 530/527) and `object_heavy`
(476/465 → 536/527). The BANKED flush and two full row scans cost more than
the grouped writes saved. No source change is retained; see the measured
rejection in `gbc-optimization-ledger.md`.

**Why:** §4.4 — eight STAT-polling VRAM writes per dirty cell, with the LCD
on, outside VBlank.

**Files:**
- Modify: `firmware/gbc/source/tile_cache.c:234-264` (`mapComposition`) —
  write all four tile numbers under one `VBK_REG = VBK_BANK_0`, then all four
  attributes under one `VBK_REG = VBK_BANK_1` (8 bank flips → 2).
- Modify: `firmware/gbc/source/tile_cache.c` + `main.c:365-414` — stage
  incremental updates into the existing `gTileMap` / `gAttributes` shadows and
  flush the touched spans inside VBlank rather than during active display.

Then, and only then, compare tile-data upload variants in this order — the
audit's ordering, with the one-call form already rejected and the new
fixed-bank DMA helpers reused:

1. current four one-tile `set_bkg_data` calls (control),
2. the existing `ps_gbc_wram_vram_dma_hblank()` helper;
3. the existing aligned ROM/WRAM general-purpose VRAM DMA path;
4. an HBlank queue built on the existing helpers.

**Expected:** the honest win is removing the stall, not the copy. Do not
assume DMA helps; it replaces only the final 64-byte upload.

**Retain the existing constraint:** the LCD stays on for incremental renders
(retained playtest correction, `gbc-optimization-ledger.md:322`). VBlank
batching must not reintroduce blanking.

### Task 5 — Early-out pattern rejection in the emitter

**Outcome (2026-07-28): rejected.** The structured direct-rejection prototype
passed semantic and 46-game cart gates and reduced packed payload by 62,417
bytes, mean/median/max frames from 30.097/32/128 to 28.510/30/128 bytes, and
`ldhl sp` by 10.32%. It nevertheless regressed `object_heavy` logic by 13.10%
(+150.578 ticks/turn, about 36.76 ms), reproduced in three alternating direct
A/B pairs. No emitter or structural-test change is retained; see the
[ledger](gbc-optimization-ledger.md#gbc-direct-early-pattern-rejection-rejected-2026-07-28).

**Why:** §4.1 observation 1. This is the highest-value emitter change: it
removes work from the innermost loop of every rule in every game and should
remove ROM at the same time.

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp:7225`
  (`emitCompactInlineGbdCPatternMatch`) — replace the `matchedFlagName`
  parameter with a rejection-target parameter, emitting
  `if ((objects & M) != V) goto <reject_label>;` instead of
  `if (...) row_matched = false;` wrapped in `if (row_matched) { ... }`.
- Modify: `native/src/compiler/compact_turn_codegen.cpp:8074`
  (`emitGbcSpecializedFusedMatchApplyAt`) — emit the reject label at the end
  of the candidate-cell body; in the non-fused `matches_at` helper emit
  `return false;`.
- Modify: the two other `row_matched` sites at `:8466` and `:8608` (the
  2-row and multi-row emitters) identically.

**Semantics to preserve exactly:** the flag protocol currently *evaluates
nothing* after the first failure (every subsequent block is guarded), so
early-out is behaviour-preserving — but the `cell = cell + delta` advances
happen **outside** the guards. Verify the rejection target is placed so that
no code with side effects is skipped, and that property/aggregate captures
(`:8109`, `:8060`) still run only on full match.

**Expected:** −3,139 guard sequences of ROM across the cart, lower stack
residency for `row_matched`, and rejection on the fall-through edge.

**Measure:** the five-case suite *and* a full `make gbc_cart` for the byte
delta. Report both.

### Task 6 — Cut emitted register pressure

**Why:** §4.2 — mean 31.2-byte frames, 125,200 `ldhl sp` instructions.

Three sub-experiments, each gated independently, cheapest first:

**6a. Hoist base pointers.** Emit `uint8_t *const board = session->board;` and
`uint8_t *const movements = session->movements;` once per rule function and
index those, instead of re-walking `session->` per pattern (§4.1 obs. 3).

**Measured outcome (2026-07-28): rejected.** The candidate cut packed payload
by 110,739 bytes (4.62%), reduced mean generated-rule frame size from 30.097
to 27.873 bytes, and removed 18,909 `ldhl sp` instructions (15.10%). Four of
five representative logic cases improved, but `object_heavy` reproducibly
regressed by 9.03% (1,149.805 → 1,253.609 ticks/turn) in the three-boot suite
and three alternating direct A/B pairs. Generated C and assembly confirmed
one pointer pair per rule, but SDCC stored the pointers in the stack frame and
reloaded them through `ldhl sp`. The emitter, tests, and transient artifacts
were fully reverted; see the
[ledger](gbc-optimization-ledger.md#gbc-generated-boardmovement-base-pointer-hoist-rejected-2026-07-28).

**6b. Manually inline `matches_at` into the scan loop.** SDCC ignores
`inline` (§4.1 obs. 2). The fused emitter already has an inline path; extend
it to the cases that currently emit a helper. Watch ROM: inlining trades call
overhead for duplicated bodies. **Report ticks and bytes together and let the
ratio decide against the revalidated physical-headroom metric.**

**Measured outcome (2026-07-29): rejected.** Because roadmap Task 5's
direct-rejection experiment was rejected and reverted, this candidate
deliberately inlined the current `row_matched` matcher body rather than
reviving that rejected Task 5 optimization. It removed
the non-fused helper boundaries, cut packed payload by 65,633 bytes (2.74%),
cut `ldhl sp` by 6,446 instructions (5.15%), and improved `large_board`
logic by 5.37%. However, `rule_heavy` reproducibly regressed by 2.47%
(853.023 → 874.070 ticks/turn, about 5.14 ms) and push rendering rose from
52 to 53 ticks in the three-boot suite and three alternating direct A/B
pairs. The emitter, tests, and transient artifacts were fully reverted; see
the
[ledger](gbc-optimization-ledger.md#gbc-collect-all-matcher-scan-inlining-rejected-2026-07-29).

**6c. Re-test file-scope static scratch.** Rejected at −0.301% against a
7-byte interpreter frame (`gbc-opportunity-audit-2026-07-22.md:648`); the
specialized frames are 31 bytes. GBDK documents statics as faster than stack
locals on SM83. Re-running a previously-rejected experiment against a changed
baseline is the point. Accept the re-entrancy loss only if it wins clearly;
the GBC core is single-threaded and non-re-entrant in practice, but the
desktop oracle build must keep the stack-local path.

**Measured outcome (2026-07-29): rejected.** One shared, unnamespaced scratch
object kept every generated per-game object at zero `_DATA/_BSS`, reduced
mean/p90 generated-rule frames from 30.097/50 to 26.014/44 bytes, and removed
19,235 `ldhl sp` instructions (15.36%). It also grew packed payload by
55,019 bytes (2.29%) and four banks. Three of five representative logic cases
regressed reproducibly: `large_board` by 4.16%, `rule_heavy` by 10.46%, and
`object_heavy` by 3.18%; three alternating direct A/B pairs reproduced each
result exactly. The candidate source, build wiring, switches, and tests were
fully removed; see the
[ledger](gbc-optimization-ledger.md#gbc-shared-specialized-rule-scratch-rejected-2026-07-29).

**Metric to track alongside ticks:** re-run the §4.2 counter after each
sub-experiment.

```sh
python3 - <<'PY'
import re, pathlib
frames, ldhl = [], 0
for f in pathlib.Path('build/gbc/cart/objects').glob('*_generated_specialized_turn_rules_*.asm'):
    t = f.read_text(errors='replace')
    ldhl += t.count('ldhl\tsp')
    frames += [int(m.group(1)) for m in re.finditer(r'add\tsp, #-(\d+)', t)]
frames.sort()
print('functions', len(frames), 'mean frame %.1f' % (sum(frames)/len(frames)),
      'median', frames[len(frames)//2], 'max', frames[-1], 'ldhl sp', ldhl)
PY
```

### Task 7 — Per-game cartridge timing scoreboard

**Why:** the five-shape suite is a proxy. The shipping product is a 46-game
cart, and its per-game move latency has **never been measured on the
cartridge** — the existing `solution-bench-compare.json` is host wall-clock,
which the ledger itself flags as non-comparable
(`gbc-optimization-ledger.md:1252`), and it already shows several titles
*slower* specialized on host (`m-c-eschers-armageddon` −81%,
`resin-caster` −45%).

The pieces already exist: `scripts/gbc_mgba_shim.c` drives libmGBA headless
with per-frame key injection and SRAM readback, `scripts/run_gbc_cart_smoke.py`
already scripts launcher → game → launcher, and the perf ROM already writes
timings to SRAM.

**Files:**
- Create: `scripts/bench_gbc_cart_solutions.py` — for each of the 46 games,
  boot the production cart, drive the launcher to that game, feed the checked-in
  solution as a key script, and read per-turn tick counts from SRAM.
- Modify: `Makefile` — add `gbc_cart_solutions_bench` next to
  `gbc_eligible_solutions_bench` (`Makefile:881`).

**Done when:** a JSON scoreboard reports cart ticks/turn and ticks/redraw per
game, and names the worst 10. Those become the real optimisation targets;
Voitex at 596 ms/turn is currently the only known worst case and it was chosen
in 2026-06, before 41 of the 46 games existed.

**Completed 2026-07-29.** A benchmark-only cart mode now measures each
user-visible turn with the CGB 4,096 Hz timer, including pending-`again` work
and dirty redraws, and publishes a versioned record through SRAM bank 3.
The harness reuses or solves the first retained board, boots libmGBA fresh per
game, reports every failure, and ranks weighted cartridge measurements.

The full 46-game cart linked across 148 packed banks at 7,543 HOME bytes and
5,965 static WRAM bytes. Its 381 generated game/rule objects were
byte-identical to the matching production build. Two full emulator sweeps
were exactly repeatable: 36 successes, 10 explicit failures, 848 measured
turns, 507.532 weighted logic ticks/turn, 724.519 weighted interaction
ticks/turn, and 203.545 render ticks/redraw. Both worst-ten orders and every
successful timing tuple matched across the repeat.

Successful rows now distinguish fixture length from the inputs consumed
before the cartridge publishes its win. `sokobond-demake` is intentionally
kept successful and ranked, but is flagged as a cart-versus-fixture semantic
divergence: the fixture contains 10 tokens and the cartridge wins after 6,
leaving 4 unused. The JSON exposes `fixture_tokens_consumed`,
`unused_fixture_tokens`, and `early_cart_win` so this result cannot look like
an ordinary full-fixture replay.

The new top cartridge targets are not limited to Sokoban:
`sokobond-demake`, `wand-spinner`, `m-c-eschers-armageddon`, and
`manic_ammo` lead logic ticks/turn. `take-heart-lass` and `attractor-net`
also enter the interaction worst ten because rendering changes the order.
The JSON retains the zero-turn `slot-machine` fixture, the
`voitex-rasteriser` solver timeout, and eight non-winning cartridge replays
as failures. Existing host-GBC replay evidence classifies three of those
eight as known fixture/specialized divergences and leaves five bounded
cartridge-integration follow-ups; Task 7 does not hide or fix them.

### Task 8 — Optional cartridge-size experiments

**Why:** §3.3 and §4.7 identify large duplication opportunities, but the
2026-07-28 cart has about 1.75 MB of physical 4 MB headroom. These are now
optional size/speed trade studies, not release blockers.

Do not start until Tasks 5–7 land, because those change the numbers and
provide the cart-native latency scoreboard needed to judge sharing.

**8a. Share byte-identical generated objects (≈148 KB, 7.9%).** Link one copy
of each content-identical `generated_core` / `generated_facade_rules` /
`generated_compact_facade` and point every game that hashes to it at that
copy. Modify `scripts/build_gbc_cart.py` (`pack_items`, `:159`) to key items
by normalised content hash. **The hard part is the bank bridge**, not the
dedup: the retained gate requires zero shared→generated cross-bank references
(`gbc-optimization-ledger.md:1303`). Design the call convention first, and
measure the `BANKED`-trampoline cost against the bytes saved — GBDK's
`BANKED` forces every argument to the stack.

**8b. Share direction-expanded rule bodies.** PuzzleScript expands one
authored rule into up to four directional rules; the emitter emits four
near-identical unrolled bodies that differ only in `delta` and the scan
bounds. The rule packs are 51.6% of the cart. Emitting one body parameterised
by `delta` and bounds, called from four thin entry points, is the single
largest available size lever — and it directly contradicts unrolling, so it
must be measured against Task 7's real per-game latency, not assumed.

**8c. Defer 8 MB.** The bundled GBDK `BANKED` ABI and
`SWITCH_ROM_MBC5` mechanism are 8-bit-bank/4 MB paths;
`SWITCH_ROM_MBC5_8M` does not update `CURRENT_BANK` and does not make BANKED
calls above bank 255 safe. Do not build a far-call spike while 4 MB headroom
remains. Reopen this as a separate design only when a measured cart forecast
shows the remaining 4 MB banks are insufficient.

---

## 7. Standing gates

Carried forward unchanged from the retained protocol
(`gbc-opportunity-audit-2026-07-22.md:933`). Every retained experiment must
pass all of these, and each retained experiment gets its own commit with
headline speed **and byte** deltas in the message.

1. Three-boot deterministic hardware-timer suite; all counters identical.
2. Native/GBC state parity, especially simultaneous matches and group loops.
3. Undo, cancel, restart, checkpoint, message, `again`, and level-start rules.
4. Sound-event parity for movement, failure, create/destroy, and rule SFX.
5. Link-map limits: fixed ROM (currently 7,020 / 8,192), generated bank,
   static WRAM (currently 5,922 / 6,144), SRAM.
6. All 46 eligible cartridges (`make gbc_eligible GBC_CONTINUE=1`) plus the
   mGBA render/hardware smoke, plus `make gbc_cart` + `check_gbc_cart.py`.
7. Rebuild the exporter after ABI edits; its baked generated ABI must match
   the runtime ABI (`PS_GBC_GAME_ABI_VERSION`, currently 19) before compiling.

**New gate for this plan:** report packed payload, allocated-bank slack,
highest used bank, and physical 4 MB headroom with every retained experiment.
A speed win that costs bytes requires an explicit trade, but is no longer an
automatic product regression while substantial physical headroom remains.

---

## 8. Open questions

1. **What is the actual composition of the 513-tick pushit redraw?** Task 1
   answers this. Everything in Tasks 2–4 is prioritised on an educated guess
   until it does.
2. **Can launcher-only storage safely overlay active-game render/session
   storage?** Task 2 requires a focused approved design before implementation.
3. **Is unrolling still paying for itself?** The specialized path won 56–72%
   on Sokoban cart timings, but the host scoreboard shows several games
   *slower* specialized. Task 7 is the only way to know whether 51.6% of the
   cartridge is buying speed on the games that need it.
4. **What is the target?** No latency budget is written down anywhere. One
   frame is 68.5 ticks. Sokoban is at 100 ticks/move (logic + redraw) and
   Voitex at 2527. Naming a target — say, "every eligible game under 4 frames
   per move" — would make it possible to declare this work finished.
