# Game Boy Color performance opportunity audit

Date: 2026-07-22
Target revision: `fc2ac859` (`Stretch GBC gameplay brightness across full gamut`)

## Executive conclusion

The current performance problem is rule matching, not drawing. On the five-case
suite, early plus late rule execution consumes 76% of a Sokoban turn and
89-98% of the other four turns. Normal incremental drawing costs 11-77 ms,
while logic costs 160 ms to 3.57 s.

There is a large C-level win available before handwritten SM83 should be used.
A performance-only prototype that hoisted repeated products out of the hot
loops, walked pattern pointers/cell indexes incrementally, and avoided movement
loads for object-only patterns reduced complete turn time by 30-37% in every
case for 75 bytes of fixed ROM. This prototype was measured and then reverted;
it had not passed the full correctness/parity gate when this audit was written.
The first independently gated part is now retained: deferring movement loads
reduced complete turn time by 5.21-7.17% for 45-46 fixed-ROM bytes, with no
game-bank, WRAM, or session-memory growth. The pointer/index streaming rewrite
is also retained: it reduced the already-improved times by another 28.47-35.81%
for 55 fixed-ROM bytes. Together they reduce the original whole-turn timings by
32.19-40.42% for 100-101 bytes, again without data-bank or RAM growth. Encoding
each rule's first pattern as a compile-time byte offset is retained as well: it
removes another 2.01-2.71% and saves 18 fixed-ROM bytes. The cumulative result
at that point is a 33.55-41.96% reduction for 82-83 net fixed-ROM bytes.
Narrowing internal cells, match counts, bounds, and deltas to their proved
8-bit range removes a further 5.72-9.28% and saves 268-289 bytes. All four P0
changes together reduce turns by 37.36-46.82% and save 186-206 fixed-ROM bytes.
A certified single-pass-group consumer is also retained. It is deliberately
workload-dependent: four cases improve by only 0.04-0.15%, while the certified
nine-rule late group in the object-heavy case improves by 15.12%. It costs one
fixed-ROM byte and no generated data or RAM.

Input specialization is now retained too. The exporter recognizes certified
contiguous direction layouts already produced by the compiler and encodes a
four-way, vertical-pair, or horizontal-pair layout in two unused group-count
bits. The runtime selects only the block reachable from the current input.
This cuts the post-single-pass turn times by 47.28%, 60.18%, 12.43%, and 16.63%
in the first four cases; the all-universal two-lane control changes by +0.02%.
The implementation costs 226 fixed-ROM bytes but no generated-game bytes,
static WRAM, or session memory.

A gated first-pattern object-presence precheck is retained after input
specialization. Sokoban and pushit compile it out and remain exactly unchanged.
Xorro, slot machine, and Voitex flag 22/62, 16/33, and 36/37 rules and improve
by another 33.45%, 25.74%, and 87.66%. The eligible builds cost 370-627
fixed-ROM bytes and use a one- or four-byte mask inside the already-reserved
session overhead; generated data, declared session arenas, and static WRAM do
not grow.

Ordered matched-start storage is retained next. The collector appends matching
cell indexes in scan order; the apply pass walks that array and keeps the same
per-start revalidation. This removes the match-bitset clear, variable shifts,
and full-board second scan. It cuts another 0.36-10.11%, saves 237-250
fixed-ROM bytes, and reduces the declared arena/static WRAM by 6-11 bytes by
placing the worst-case 90-byte array inside the existing private-session
overhead budget.

A compact player-cell posting list is the first retained anchor consumer.
Rules whose first pattern requires the player enumerate a monotone, sorted list
of cells that have held a player instead of every legal board start. It cuts
another 10.41%, 17.85%, and 6.78% in Sokoban, pushit, and Xorro. The list costs
42-63 bytes of declared session/static WRAM and 811-833 fixed-ROM bytes. The
feature is gated to one- and two-byte object boards: enabling the same code in
the four-byte slot-machine cartridge overflowed fixed ROM by 32 bytes. The two
four-byte controls therefore compile it out and are exactly unchanged.

The same read/write wake proof used for multi-rule single-pass certificates is
now retained for singleton groups. A singleton that cannot enable itself does
not need a no-change confirmation scan. This expands the certified group count
from 1 to 3 in Xorro, 1 to 12 in slot machine, and 7 to 13 in Voitex. Slot
machine improves by another 24.92%; all other cases are exact or within 0.005%.
It changes only existing group flag bits, so fixed ROM, game-bank ROM, and RAM
are all unchanged.

Full per-rule wake scheduling is not worthwhile after the retained certificate
work. New benchmark-only counters measured zero repeat passes in four cases and
only 0.016 repeat passes / 0.031 repeat-rule visits per turn in pushit. A wake
table would add data and hot checks to avoid almost no work. Broader object
anchors should wait until packed data or renderer cleanup frees fixed ROM.

The first renderer/data cleanup is now retained. The exporter centers every
legal source sprite into the native 5x5 PuzzleScript cell, emits a compact
render table in collision-layer order, and reduces rule-time object metadata
to layer plus movement-layer bytes. The compositor streams 25 pixels instead
of rescanning every object for every layer and rebuilding multiply-heavy
coordinates. Forced whole-board composition falls 82.50-91.62%, while initial
render falls 16.27-42.91%. It also saves 27-41 fixed-ROM bytes and 302-609
linked generated-bank bytes, with no RAM growth.

A clean-dirty-bitset render guard is retained as a narrow normal-frame win.
When rules report a transient change but leave the final board unchanged, the
renderer now returns before scanning the board or touching VRAM. The eligible
large-board trace falls from 52.50 to 3.50 ticks (-93.33%, or 12.8 to 0.85 ms).
Dirty-frame controls cost only 0.50-0.75 extra tick, cold rendering and logic
are unchanged, and the query costs 58 fixed-ROM bytes with no game-bank or RAM
growth.

Bounded precomposition of level masks is retained for cold rendering. Across
all retained levels, the five cartridges contain only 6, 5, 5, 5, and 2
distinct starting object masks. The exporter ranks those masks by frequency,
emits at most eight ready-to-upload 64-byte quartets, and trims the table to the
existing conservative 14 KiB generated-bank budget. Initial rendering falls
71.35%, 60.11%, 67.38%, 32.89%, and 47.91%. The tables add 138-414 bytes of
payload and 328-604 linked bank bytes including lookup code, with zero fixed-ROM
or RAM growth; logic is exactly unchanged. Uncaptured and dynamic masks retain
the original compositor fallback.

Complete pattern-sequence sharing is retained as a data-only ABI cleanup.
Xorro has 64 duplicate records among 126 logical patterns and Voitex has 24
among 61; the other three games are exact controls. Repointing rules at one
copy saves 2,368 and 888 linked generated-bank bytes respectively. All five
logic, initial-render, and incremental-render timings are exactly unchanged,
and fixed ROM and RAM do not move. This creates bank headroom for packed
patterns without adding a hot-loop indirection.

Handwritten assembly is worth a small, gated experiment only after those C and
algorithmic changes. A blanket SDCC speed-mode experiment was 2.64% slower and
62 bytes larger for the rule-heavy case, and applying the flag to the whole ROM
made `tile_cache.c` fail to assemble.

A cross-check against GBCTR revision 188 strengthens that conclusion but
changes the eventual assembly experiment: fuse the rule-pattern scan and the
width-specialized predicate so hot values stay in registers. A separately
called leaf predicate would retain much of the current stack and call overhead.

## Measurement protocol

The existing GBC benchmark harness was run at the current revision in mGBA SDL
0.10.5, CGB double-speed mode, using the emulated 4096 Hz hardware timer.

- Five shapes: Sokoban, a larger board, a rule-heavy game, an object-heavy game,
  and a two-movement-lane game.
- Logic sample: 128 alternating right/left turns on the first retained board.
- Render sample: four incremental frames plus isolated composition/upload tests.
- Interaction sample: initial board render, walk down, then push right.
- Three complete emulator boots per build; all records had to be identical.
- A separate phase build measured snapshot, setup, early rules, movement, late
  rules, commands, and win checks. Probe overhead was 0.10-2.15%.

The raw local results are:

- `.codex_tmp/benchmarks/audit-20260722-current.json`
- `.codex_tmp/benchmarks/audit-20260722-phases.json`
- `.codex_tmp/benchmarks/audit-conditional-pattern-loads.json`
- `.codex_tmp/benchmarks/audit-incremental-hot-loop-arithmetic.json`
- `.codex_tmp/benchmarks/audit-combined-c-hot-loops.json`
- `.codex_tmp/benchmarks/audit-core-speed.json`

The suite culls oversized levels because the current fixed-cell target is
10x9. `max_level_cells` below therefore describes the retained cartridge, not
necessarily the largest level in the source game.

## Current bottleneck

| Case | Cells / rules / patterns | Logic ticks | Logic time | Incremental render | Rule phases |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sokoban | 42 / 4 / 8 | 653.461 | 160 ms | 51.000 ticks / 12 ms | 75.98% |
| Large board | 63 / 8 / 24 | 1726.586 | 422 ms | 52.250 ticks / 13 ms | 89.23% |
| Rule-heavy | 56 / 62 / 126 | 7493.297 | 1.829 s | 47.000 ticks / 11 ms | 97.82% |
| Object-heavy | 72 / 33 / 62 | 14621.352 | 3.570 s | 316.750 ticks / 77 ms | 97.61% |
| Two movement lanes | 81 / 37 / 61 | 10580.523 | 2.583 s | 79.000 ticks / 19 ms | 95.35% |

The detailed phase split is equally clear:

| Case | Snapshot | Setup | Early rules | Movement | Late rules | Commands | Win |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sokoban | 2.09% | 5.55% | 75.77% | 7.84% | 0.21% | 0.72% | 5.61% |
| Large board | 1.14% | 3.02% | 89.15% | 2.31% | 0.08% | 0.33% | 3.12% |
| Rule-heavy | 0.16% | 0.43% | 28.62% | 0.64% | 69.20% | 0.06% | 0.69% |
| Object-heavy | 0.57% | 0.53% | 33.46% | 0.53% | 64.15% | 0.03% | 0.62% |
| Two movement lanes | 0.88% | 0.83% | 95.34% | 0.86% | 0.01% | 0.04% | 1.89% |

Snapshotting, movement resolution, and win checking have worthwhile local
improvements, but none can produce the first large reduction in input latency.

## Drawing audit

The retained dirty-cell renderer, composition cache, prepared sprites, stable
uploads, and fixed 16x16 quartets have already solved the normal-frame problem.

| Case | Incremental frame | Initial board | Forced uncached composition |
| --- | ---: | ---: | ---: |
| Sokoban | 51 ticks / 12 ms | 2553 ticks / 623 ms | 6098 ticks / 1.489 s |
| Large board | 52 ticks / 13 ms | 2277 ticks / 556 ms | 6784 ticks / 1.656 s |
| Rule-heavy | 47 ticks / 11 ms | 2277 ticks / 556 ms | 7500 ticks / 1.831 s |
| Object-heavy | 317 ticks / 77 ms | 5223 ticks / 1.275 s | 23173 ticks / 5.657 s |
| Two movement lanes | 79 ticks / 19 ms | 1512 ticks / 369 ms | 15803 ticks / 3.858 s |

The forced-composition number intentionally bypasses the useful cache and is
not a normal user-visible frame. It shows that the compositor itself remains
expensive, while initial-render and incremental caches are doing their job.

The existing 5x5-to-16x16 scaler is already exactly the intended one and is
not the target of the suggestions below. `composeTile` first produces the
logical 5x5 `gSourcePixels` buffer. `encodeQuartet` then expands it with
`kSourceCoordinate = {0,0,0,1,1,1,2,2,2,2,3,3,3,4,4,4}`: each outer source
row and column is repeated three times, while the centre row and column are
repeated four times. The result is the specified 15-to-16 adjustment and is
encoded as the four 8x8 tiles of the 16x16 cell.

Rendering work should therefore be lower priority than rule execution. The
best remaining rendering experiments are:

1. Optimize only the composition stage before the existing scaler. Have the
   exporter pre-center/pad each object into a fixed 5x5 source array, emit
   compact descriptors in collision-layer order, and stream those 25 pixels
   into `gSourcePixels` with advancing pointers. This removes the present
   layer-by-object scan and variable-width address arithmetic; it does not
   replace or change `kSourceCoordinate` or the 5x5-to-16x16 encoding.
2. Export precomposed 64-byte tile quartets for object masks present in levels
   and other statically common masks. **Retained:** the exporter frequency-ranks
   level masks, caps the table at eight entries and the available conservative
   game-bank budget, and leaves the dynamic compositor as fallback. Initial
   rendering improves 32.89-71.35% for 328-604 linked bank bytes and no fixed
   ROM or RAM.
3. Upload an aligned quartet with one four-tile `set_bkg_data` call instead of
   four one-tile calls. All cache/dedicated base tiles are multiples of four and
   therefore do not straddle the 256-tile VRAM-bank boundary. **Measured and
   rejected:** initial-render time was exactly unchanged in all five cases. It
   saved 28 linked generated-bank bytes, but GBDK already performs the same
   byte loop inside each call, so the removed call overhead was below the timer
   resolution and did not improve any user-visible workload.
4. Batch the two tile-map rows for a dirty 2x2 quartet and reduce repeated VBK
   switches/API calls. **Measured and rejected:** two generic 2x2
   `set_bkg_tiles` calls made incremental rendering 0.00-7.98% slower. Cold
   rendering was unchanged within one tick. The helper's rectangular-copy
   setup costs more than the six calls and VBK switches it removes at this
   tiny transfer size.
5. Do not call `renderBoard` when a turn reports a transient movement change
   but the final dirty-cell bitset is empty. **Retained:** a core-owned bitset
   query reduces the eligible trace from 52.50 to 3.50 ticks (-93.33%, 12.8 to
   0.85 ms). Dirty-frame controls add 0.50-0.75 tick; fixed ROM grows by 58
   bytes, while game-bank ROM and RAM are unchanged.

Do not spend more time optimizing full-screen palette or map uploads first:
they measure about 4 and 98 ticks respectively and are already skipped during
ordinary board frames.

## Generated cartridge C audit

The five benchmark games were freshly exported side by side and their complete
`generated_game.c`/`.h` output was inspected, rather than inferring its shape
only from the exporter. The output is clean as serialized data, but it keeps a
generic runtime ABI in places where a fixed cartridge can expose constants and
stream-ready tables to SDCC.

The most serious new finding is in rendering. `composeTile` loops over every
collision layer and then every object, constructs `1U << object_id` afresh, and
indexes a 17-byte object descriptor before rejecting the wrong layer. The
number of descriptor probes per uncached composition is therefore:

| Case | Objects x layers | Descriptor probes | Unique sprite arrays |
| --- | ---: | ---: | ---: |
| Sokoban | 5 x 3 | 15 | 5 / 5 |
| Large board | 6 x 3 | 18 | 6 / 6 |
| Rule-heavy | 8 x 6 | 48 | 7 / 8 |
| Object-heavy | 20 x 12 | 240 | 20 / 20 |
| Two movement lanes | 17 x 11 | 187 | 12 / 17 |

The rule-heavy generated build confirms the downstream codegen cost:

- `composeTile` has a 25-byte stack frame;
- `source_y * object->sprite_width` calls `__muluchar` for every source pixel;
- destination-row addressing calls `__muluchar` for every opaque pixel;
- centering width/height arithmetic is reconstructed inside the row/pixel
  loops even though the exporter already knows all dimensions;
- object lookup multiplies the id by the 17-byte descriptor stride.

This is not a problem with the upscaling step: `encodeQuartet` already performs
the specified 5x5-to-16x16 expansion. The opportunity is the dynamic work used
to construct its 5x5 input. The exporter accepts sprites no larger than 5x5,
and all objects in this suite are exactly 5x5. For smaller legal sprites, the
exporter can perform the existing centering once and emit a padded 25-byte
array. A compact render table sorted by collision layer can then scan each
object once, rather than `layer_count * object_count`, and copy with source and
destination pointers. This should be benchmarked before precomposing every
observed quartet because it improves every cache miss without multiplying
generated tile data.

That experiment is retained. Export-time centering preserves the same 5x5
input to `encodeQuartet`, including the doubled central source row/column in
the established 15-to-16 expansion. The layer-ordered table preserves the old
layer-then-object-id draw order but removes descriptor rejection, per-pixel
centering, and `__muluchar` addressing. Across the five cases, isolated
whole-board composition changes from 6098.00, 6784.25, 7500.25, 23172.25, and
15802.75 ticks to 1042.75, 1187.50, 1143.25, 1942.25, and 1499.00. Initial
render changes from 2526, 2237, 2243, 5113, and 1420 ticks to 2115, 1825, 1833,
2919, and 1146. The standard hardware/render smoke passes with fixed 16x16
cells and zero palette, map, attribute, or tile-upload mismatches. The generated
SM83 for `composeTile` now has a 13-byte rather than 25-byte stack frame and no
`__muluchar` calls.

The unused object names and transparent masks are now removed. Object names
remain exporter-only; title and author are the strings displayed by firmware,
and byte value `0xff` continues to represent transparent sprite pixels. Width,
height, palette, and sprite pointers move out of rule-time object metadata into
the new render-only table. The core's object stride is now two bytes instead of
17, and the actual linked generated-bank saving is 302-609 bytes after paying
for the ordered render entries.

The rule records have a similar hot/cold mixture:

| Case | Rules | No commands | No rule sounds | NULL messages |
| --- | ---: | ---: | ---: | ---: |
| Sokoban | 4 | 4 | 4 | 4 |
| Large board | 8 | 8 | 8 | 8 |
| Rule-heavy | 62 | 54 | 54 | 62 |
| Object-heavy | 33 | 32 | 31 | 33 |
| Two movement lanes | 37 | 36 | 32 | 37 |

Every scan pays a record stride containing command flags, first sound, sound
count, and a message pointer, although those fields are read only after a match
and are overwhelmingly empty here. Split the hot rule descriptor into pattern
pointer/offset, count, and direction, with compact optional action metadata for
the minority of rules that need it. Likewise, replace group `first_rule` plus
16-bit count with a direct rule pointer and generated-width count. The largest
suite case has only 62 rules and 29 groups.

Finally, the generated header already exposes facts such as cell dimensions,
mask widths, and sound counts as macros, but `tile_cache.c` still reloads cell
width/height and object/layer counts through `ps_gbc_generated_game`. SDCC has
no cross-translation-unit view of the constant initializer. Expand the
generated macro/direct-symbol interface for fixed cartridges so counts,
dimensions, background mask, and table bases become compile-time constants.
Keep the generic `ps_gbc_game_view` for native tests and non-generated callers.

Smaller ROM-only cleanup also exists: omit `{0}` sentinel arrays when the
associated count is zero, and share identical sprite arrays. These are useful
for bank headroom but should not be represented as latency wins.

## Generated SM83 audit

The hot generated assembly is inefficient for structural reasons, rather than
because SDCC missed one peephole:

- In a one-byte-object build, `ps_gbc_pattern_matches` has a 17-byte stack
  frame and is about 335 code bytes. It widens the one-byte board value to four
  bytes and unconditionally calls `ps_gbc_movement_get` before inspecting the
  pattern flags.
- `ps_gbc_rule_matches_at` calls `__mulint` for `index * delta` and repeatedly
  recomputes a 37-byte pattern-record address.
- `ps_gbc_collect_matches` computes `x * height + y` in the inner candidate
  loop.
- The apply pass scans every board cell, constructs a bit mask with a small
  shift loop, revalidates a match, then again multiplies the pattern index by
  the direction delta. Revalidation is semantically required after earlier
  replacements, but the arithmetic and full-board second scan are not.
- The apply-loop condition recomputes `width * height`; the generated assembly
  contains a runtime multiply in that repeated path.

The unconditional movement load is especially poorly matched to the exported
data:

| Case | Patterns | Unique records | Object-only patterns | Exact-sequence ROM saving |
| --- | ---: | ---: | ---: | ---: |
| Sokoban | 8 | 8 | 4 | 0 B |
| Large board | 24 | 8 | 16 | 0 B |
| Rule-heavy | 126 | 30 | 106 | 2368 B |
| Object-heavy | 62 | 36 | 50 | 0 B |
| Two movement lanes | 61 | 25 | 60 | 888 B |

“Exact-sequence ROM saving” is the linked GBDK saving from sharing an identical
contiguous rule pattern sequence between rules, at 37 bytes per pattern. It
requires no extra runtime indirection. Individual-pattern interning could save
more (3426 bytes in the rule-heavy case and 1271 bytes in the two-lane case),
but it adds an index load in the hottest loop and should be considered only
alongside a packed pattern ABI.

### Measured C prototypes

All prototypes used the same five ROMs and three deterministic emulator boots.
They were performance probes, then reverted. Fixed-ROM deltas are from the
instrumented benchmark link.

| Prototype | Sokoban | Large | Rule-heavy | Object-heavy | Two lanes | Fixed ROM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load movement only when the pattern uses it | -3.53% | -4.88% | -5.02% | -4.88% | -4.73% | +21 B |
| Increment pattern/cell pointers; hoist repeated products | -26.44% | -30.68% | -32.36% | -30.61% | -32.27% | +54 B |
| Combined | **-29.97%** | **-35.56%** | **-37.38%** | **-35.49%** | **-37.00%** | +75 B |

Combined absolute turn timings were 457.609, 1112.563, 4691.984, 9432.523,
and 6665.406 ticks respectively. No session, SRAM, or generated-game memory was
added. The instrumented fixed bank still fit in every case.

### Implementation experiment ledger

The exploratory prototypes above were reverted after measurement. Production
candidates are being reapplied independently, correctness-gated, measured with
three deterministic emulator boots per cartridge, and committed only when they
earn their cost.

| Candidate | Decision | Sokoban | Large | Rule-heavy | Object-heavy | Two lanes | Memory / ROM |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Defer movement-plane loads for object-only patterns | **Keep** | -5.21% | -6.92% | -7.17% | -5.89% | -6.58% | +45-46 B fixed ROM; game bank, static WRAM, and session unchanged |
| Stream pattern/cell indexes and hoist repeated products | **Keep** | -28.47% | -33.87% | -35.81% | -33.16% | -35.08% | +55 B fixed ROM; game bank, static WRAM, and session unchanged |
| Emit first-pattern byte offsets instead of indexes | **Keep** | -2.01% | -2.25% | -2.59% | -2.29% | -2.71% | -18 B fixed ROM; game bank, static WRAM, and session unchanged |
| Use proved 8-bit hot cells, bounds, counts, and deltas | **Keep** | -5.72% | -6.94% | -8.36% | -9.28% | -7.09% | -268 to -289 B fixed ROM; game bank, static WRAM, and session unchanged |
| Skip fixpoint confirmation for certified single-pass groups | **Keep** | -0.07% | -0.07% | -0.15% | -15.12% | -0.04% | +1 B fixed ROM; game bank, static WRAM, and session unchanged |
| Select certified directional rule blocks for the current input | **Keep** | -47.28% | -60.18% | -12.43% | -16.63% | +0.02% | +226 B fixed ROM; game bank, static WRAM, and session unchanged |
| Reject flagged rules whose first required objects are absent | **Keep** | 0.00% | 0.00% | -33.45% | -25.74% | -87.66% | compile-out controls unchanged; eligible builds +370-627 B fixed ROM and 1-4 B reserved session overhead; game bank/static WRAM/declared arena unchanged |
| Store ordered matched starts instead of a bitset/full-board apply scan | **Keep** | -0.94% | -1.32% | -2.78% | -10.11% | -0.36% | -237 to -250 B fixed ROM; -6 to -11 B declared arena/static WRAM; game bank unchanged |
| Enumerate first-pattern player cells on compact object boards | **Keep** | -10.41% | -17.85% | -6.78% | 0.00% | 0.00% | eligible builds +811-833 B fixed ROM and +42-63 B declared arena/static WRAM; four-byte controls compile out exactly; game bank unchanged |
| Skip confirmation for singleton groups proved unable to self-enable | **Keep** | 0.00% | 0.00% | -0.0004% | -24.92% | -0.0044% | fixed ROM, game-bank ROM, static WRAM, and session unchanged |
| Add per-rule wake scheduling after singleton certification | **Reject** | no repeat passes | 0.016 repeat passes/turn | no repeat passes | no repeat passes | no repeat passes | a table/check would target only 0.031 repeat-rule visits/turn at best |
| Emit centered 5x5 sprites and one layer-ordered render entry per object | **Keep** | composition -82.90%; initial -16.27% | composition -82.50%; initial -18.42% | composition -84.76%; initial -18.28% | composition -91.62%; initial -42.91% | composition -90.51%; initial -19.30% | -27 to -41 B fixed ROM; -302 to -609 B linked generated bank; RAM unchanged |
| Upload each aligned tile quartet with one GBDK call | **Reject** | initial 0.00% | initial 0.00% | initial 0.00% | initial 0.00% | initial 0.00% | logic exactly unchanged; -28 B linked generated bank; no fixed-ROM or RAM change |
| Map each dirty 2x2 quartet with two rectangular GBDK calls | **Reject** | incremental +2.46% | incremental 0.00% | incremental +2.67% | incremental +7.98% | incremental +1.89% | cold render unchanged within 1 tick; -65 B fixed ROM, +98 B linked generated bank; RAM unchanged |
| Skip rendering when the final dirty bitset is empty | **Keep** | dirty control +0.99% | clean frame -93.33% | dirty control +1.60% | dirty control +0.24% | dirty control +0.63% | cold render and logic unchanged; +58 B fixed ROM; game bank/RAM unchanged |
| Precompose frequent level-mask tile quartets | **Keep** | initial -71.35% | initial -60.11% | initial -67.38% | initial -32.89% | initial -47.91% | 6/5/5/5/2 entries; +328 to +604 B linked bank; fixed ROM/RAM unchanged; exact logic and pixel parity |
| Share identical complete pattern sequences | **Keep** | exact control | exact control | timing 0.00%; -2,368 B bank | exact control | timing 0.00%; -888 B bank | fixed ROM/RAM unchanged; no runtime indirection |

All retained candidates passed the GBC core, exporter, generated-cartridge,
native/GBC parity, level-start, static-layer, and action-movement tests. Their
measurements are
`.codex_tmp/benchmarks/p0-conditional-movement-final.json` and
`.codex_tmp/benchmarks/p0-streaming-arithmetic-final.json`, and
`.codex_tmp/benchmarks/p0-pattern-offset-final.json`, and
`.codex_tmp/benchmarks/p0-narrow-hot-indexes.json`, and
`.codex_tmp/benchmarks/p1-single-pass-certified.json`, and
`.codex_tmp/benchmarks/p1-input-direction-layout.json`, and
`.codex_tmp/benchmarks/p1-width-specialized-presence.json`, and
`.codex_tmp/benchmarks/p1-inline-matched-starts-final.json`, and
`.codex_tmp/benchmarks/p1-compact-player-cell-anchor.json`, and
`.codex_tmp/benchmarks/p1-singleton-confirmation.json`, and
`.codex_tmp/benchmarks/p2-ordered-render-table.json`, and
`.codex_tmp/benchmarks/p2-batched-quartet-upload.json`, and
`.codex_tmp/benchmarks/p2-batched-map-quartet.json`, and
`.codex_tmp/benchmarks/p2-skip-clean-render-final.json`, and
`.codex_tmp/benchmarks/p2-precomposed-level-masks.json`, and
`.codex_tmp/benchmarks/p2-shared-pattern-sequences.json`. Each logic row is
incremental against the retained row above it. Cumulative reductions against
the original baseline are now 70.76%, 81.96%, 71.95%, 80.23%, and 93.26%
respectively.

The scheduling decision uses the counter-only diagnostic
`.codex_tmp/benchmarks/post-singleton-schedule-counts.json`. Per turn it
records group passes/repeats/rule visits of 1/0/1, 1.016/0.016/2.031,
27/0/53, 16/0/24, and 14/0/37. This is diagnostic evidence rather than a
timing candidate; the counters compile out of production and ordinary timing
ROMs.

These transformations should be the first implementation, followed by native
and GBC parity, undo/cancel/restart, sound, render, and compatible-cartridge
gates. They are not a substitute for those gates.

### Should we write assembly?

Not yet for the general matcher. The C prototypes show that source shape is
currently more important than instruction spelling. Hand assembly around the
present interfaces would preserve unnecessary calls, 32-bit values, and
full-board scans.

A time-boxed assembly experiment becomes reasonable after the C rewrite and
packed pattern work. Restrict it to a fused kernel that combines the one-byte
object-only predicate with the rule-pattern scan, keep the C implementation as
the oracle/fallback, and retain it only if it wins at least 10% on the post-C
rule-heavy suite with a small fixed-bank cost. Do not generate per-rule
assembly until the data-bank cost has been compared with a compact shared
kernel.

The compiler-switch alternative was tested and rejected: compiling only
`core.c` with `--opt-code-speed` changed the rule-heavy case from 7493.297 to
7691.070 ticks (+2.64%) and fixed ROM from 15107 to 15169 bytes. Applying the
switch to all translation units also produced an invalid addressing mode in
the generated `tile_cache.c` assembly.

## GBCTR hardware-reference cross-check

The [GB: Complete Technical Reference, revision 188](https://gekkio.fi/files/gb-docs/gbctr.pdf)
was reviewed and its relevant pages were rendered for visual inspection. The
document carries an important caveat: it currently focuses on first- and
second-generation, pre-Color devices, and warns against assuming that its
peripheral details apply to later hardware. Its SM83 instruction timings are
directly useful here; its PPU and DMA chapters are not a complete GBC display
reference. In particular, the DMA chapter describes OAM DMA, not CGB VRAM
DMA, and its transfer-timing subsection is still `TODO`. The PPU chapter is
currently a register table without mode timing.

### What the instruction timings add

The baseline one-byte-object `ps_gbc_pattern_matches` body contains 34
`ldhl sp, #offset` instructions, eight pushes, ten pops, and a call. These are
static instruction counts; early returns mean they are not all executed on
every candidate. Even so, the manual makes the cost shape unambiguous:

| Construct | SM83 cost | Consequence for this matcher |
| --- | ---: | --- |
| `LD HL, SP+e`, then `LD r, (HL)` | 3 + 2 M-cycles | A stack-local byte reload commonly costs five M-cycles before useful work. |
| `LD A, (HL+)` | 2 M-cycles | A sequential load advances the only auto-incrementing general pointer for free. |
| `LD A, (DE)`, then `INC DE` | 2 + 2 M-cycles | SDCC's repeated DE load/increment sequences cost twice the streaming HL form. |
| `CALL nn` / `RET` | 6 / 4 M-cycles | Per-pattern function boundaries are expensive before argument shuffles and frame setup are counted. |
| `PUSH rr` / `POP rr` | 4 / 3 M-cycles | Spilling registers to make room for generic 32-bit values is itself costly. |
| Conditional `JR` | 2 not taken / 3 taken | Candidate rejection should be the fall-through edge when rejection is common. |

The CPU can perform only one memory access per M-cycle. This is why packed
match-only records are a speed optimization, not merely a ROM optimization,
and why copying unchanged ROM data to WRAM would not by itself make matching
faster. The most promising eventual assembly prototype is therefore a fused
`rule_matches_at` plus one-byte object-only scan that:

- streams flags and masks through HL;
- keeps the current board byte and common masks in registers;
- makes the common rejection edges fall through;
- advances both the pattern pointer and board cell pointer without multiply;
- returns to C for movement-bearing or wider-mask cases initially.

Keep the post-C implementation as the oracle and retain the existing 10%
post-C whole-turn win threshold. Do not add a new call to a tiny assembly leaf:
the manual shows that the call boundary and spills are part of the problem.

Two further rule-engine experiments follow from the timings:

1. Instrument which predicate rejects each candidate, then order specialized
   predicate classes so the cheapest, most selective object test is first and
   the common rejection is the not-taken branch path.
2. Test a transposed read mirror of the object board. The current column-major
   layout makes one axis sequential and the other strided. A mirror costs at
   most 90, 180, or 360 bytes for one-, two-, or four-byte object cells and can
   let both axial rule variants use streaming loads. Update it only through
   `ps_gbc_board_set`. Measure this after anchors, because object-position
   bitsets may make the mirror unnecessary.

### Display and cartridge implications

OAM DMA should not be pursued as a shortcut for this background-tile renderer.
The worthwhile CGB-only transfer experiment must instead use the CGB VRAM DMA
registers exposed by the target SDK and be measured on CGB hardware/emulation.
The natural microbenchmark is unusually clean: `gTileBytes` is exactly 64
bytes, every quartet base tile is four-tile aligned, and the current path makes
four `set_bkg_data` calls. Compare, in order:

1. the current four one-tile calls;
2. one four-tile `set_bkg_data` call;
3. one aligned four-block general-purpose VRAM DMA;
4. a four-block HBlank DMA queue if avoiding a visible stall matters.

Do not assume DMA will improve composition time: it only replaces the final
64-byte upload, and normal incremental rendering is already a secondary cost.

The LCDC `BG_MAP` selector also makes an inactive-map full-render path worth a
small UX experiment. The current code prepares board tiles while showing
`LOADING`, then blanks the LCD to upload the 20x18 tile-number and attribute
maps. Text uses tiles 0-46 and board tiles begin at 64, so the board tile data
can be prepared without corrupting the loading glyphs. Write both map banks to
the inactive 0x9800/0x9C00 region - tile numbers in VRAM bank 0 and attributes
in bank 1 - while the loading map remains visible. Retain the UI palette until
the handoff, then switch the palette and LCDC map bit in VBlank. This can
remove the full-render black flash and move the measured
24 ms map upload out of the display-off window; it does not remove the much
larger 0.37-1.28 s initial composition cost.

Finally, the manual confirms that MBC5 ROM bank selection uses separate lower
and upper registers. `SWITCH_ROM_MBC5(1)` in the main loop writes the tracked
bank plus both mapper registers every frame; the generated body is 64 T-cycles,
about 7.6 microseconds in double-speed mode. Removing the redundant write under
a proved bank-1 invariant is a reasonable cleanup, but it is only about 0.05%
of a 60 Hz frame and cannot affect the multi-hundred-millisecond turn latency.

## External optimization-guide cross-check

The most applicable additional sources were the
[GBDK coding guidelines](https://gbdk.org/docs/api/docs_coding_guidelines.html),
[GBDK toolchain and HRAM notes](https://gbdk.org/docs/api/docs_toolchain.html),
[GBDK banking documentation](https://gbdk.org/docs/api/docs_rombanking_mbcs.html),
[pret/pokecrystal SM83 optimization guide](https://github.com/pret/pokecrystal/wiki/Optimizing-assembly-code),
[RGBDS SM83 instruction reference](https://rgbds.gbdev.io/docs/master/gbz80.7),
and the Pan Docs pages on
[SM83 versus Z80](https://gbdev.io/pandocs/CPU_Comparison_with_Z80.html),
[VRAM access](https://gbdev.io/pandocs/Accessing_VRAM_and_OAM.html), and
[power consumption](https://gbdev.io/pandocs/Reducing_Power_Consumption.html).
The central lesson is consistent across them: change algorithms, data layout,
and register pressure before applying assembly peepholes. Generic Z80 advice
must also be checked against SM83; the Game Boy CPU lacks Z80 block operations
and index registers, while its `HL+`/`HL-` loads are unusually important.

Several recommendations are already satisfied or have now been tested:

- The build already uses GBDK's recommended
  `--max-allocs-per-node 50000`; its documentation says `--opt-code-speed`
  usually has a much smaller effect, consistent with the measured regression.
- The renderer keeps RAM shadow maps and does not read back VRAM in production.
  This avoids the access-mode stalls called out by GBDK and Pan Docs.
- Input is read once per loop and the idle path calls `vsync()`, which GBDK
  implements with `HALT`. Pan Docs estimates that using `HALT` while waiting can
  improve battery life by 5-50% or more, depending on workload. Speculative
  future-state execution would consume that currently saved power, strengthening
  the case against it unless latency remains bad after deterministic work.
- GBDK recommends whole assembly functions instead of mixed C/inline assembly.
  That supports the proposed self-contained fused kernel with a C oracle.

The source review adds six concrete experiments:

1. **Pre-relocate each rule's first pattern.** `ps_gbc_rule.first_pattern` is
   currently an index, so each match/apply entry computes
   `patterns + first_pattern * 37`. Emit a direct pattern pointer, or at least a
   precomputed byte offset, in the rule record. On the SM83 target it replaces
   the existing two-byte index rather than growing the record. This removes a
   stride multiply even before packed patterns land.
2. **Try GBC-only static matcher scratch.** GBDK explicitly notes that globals
   or static locals are often faster than stack locals, at the cost of
   re-entrancy. The generated cartridge engine is single-threaded and is not
   called by an ISR, so a benchmark-only static context is a valid comparison
   against the current 17-byte matcher frame. Keep the portable path re-entrant.
3. **Use HRAM only for a few proved-hot bytes.** GBDK's `SFR` placement lets
   SDCC use compact `LDH` accesses, but makes the variable volatile. Test this
   only after static scratch identifies values that are repeatedly loaded;
   do not move arrays or pointer-heavy state to scarce HRAM speculatively.
4. **Remove unnecessary banked-call conventions.** The two renderer entry
   points live in ROM bank 1, are invoked after main selects bank 1, and take
   five or six arguments. GBDK documents that `BANKED` forces every argument to
   the stack and calls through a save/switch/restore trampoline. Benchmark near
   calls under an asserted bank-1 invariant. This affects at most one render
   entry per frame, so it is a drawing cleanup, not a rule-engine priority.
5. **Add GBDK's HBlank stack copy to the tile-upload comparison.** The official
   `hblank_copy()` helper copies VRAM-safe 16-byte chunks and is a useful middle
   point between one four-tile `set_bkg_data` call and direct CGB VRAM DMA. It
   requires interrupts disabled and rounds to 16-byte chunks, which happens to
   fit the 64-byte quartet exactly.
6. **Profile PCs, not only phases.** [Emulicious](https://emulicious.net/)
   provides a profiler, source/disassembly views, tracing, and coverage. Build a
   profiling ROM with GBDK's `lcc -debug` output, replay the same deterministic
   cases, and use its address-level attribution to choose the one function worth
   inspecting or rewriting. Retain the hardware-timer suite as the acceptance
   measurement; the emulator profiler is diagnostic evidence.

The pokecrystal guide's useful micro-level advice is to stream with `HL+`, make
common control-flow edges fall through, use conditional returns, and avoid a
`CALL`/`RET` pair for tiny helpers through inlining, tail calls, or fusion. These
are implementation criteria for the post-C kernel, not a reason to hand-tune
the current generic 32-bit interface.

## Rule execution and pattern-matching opportunities

### P0: land the measured C hot-loop rewrite

**Retained.** Conditional loads, pointer/index streaming, compile-time
first-pattern byte offsets, and proved 8-bit hot indexes passed the production
gate independently. Caching the board-cell count in session state is no longer
a hot-loop requirement: the retained code computes it once per rule apply,
rather than in the board scan condition.

- Cache `cells = width * height` per level/session.
- Replace each rule's first-pattern index with an emitted direct pointer or
  byte offset, avoiding the current `first_pattern * 37` entry calculation.
- Traverse legal board cells with increments, not a multiply per candidate.
- Traverse pattern records and affected cells with pointer/index increments,
  not `index * delta` and repeated 37-byte address calculation.
- Delay object/movement loads until the flags say they are needed.
- Use `uint8_t` for cell/count indexes in generated builds where the hard limit
  is 90 cells; retain wider public/generic types if useful.

This is the only opportunity in the audit with a measured 30-37% suite-wide
whole-turn win.

### P1: consume existing static-analysis certificates

The JavaScript analyzer already emits proved wake masks for every rule in all
five cases (144/144). Use those masks in the GBC exporter/runtime rather than
inventing a separate analysis.

- Maintain a board object-presence mask and reject a rule if its required
  objects cannot be present.
- Track objects/movements changed by a rule/group and use certified wake masks
  to avoid rescheduling rules that cannot observe the change.
- Reuse the existing per-input specialization proof to exclude rule variants
  that cannot be reached by the current input.

The analyzer marks these real multi-rule source groups `single_pass_safe`:
Sokoban 1/1, large board 0/1, rule-heavy 1/27, object-heavy 1/7, and two-lane
7/7. The GBC exporter now reproduces those exact audited flow certificates and
encodes the result in the high bit of the existing group count, so it costs no
generated bytes. The runtime skips the redundant no-change confirmation pass.
The independent measurement found that certificate breadth is not the useful
predictor: the two-lane case is nearly neutral, while the object-heavy case's
one certified nine-rule late group cuts whole-turn time by 15.12%.

The proof is also sound for a one-rule group: if the rule's writes cannot wake
its own positive, negative, or movement reads, a second pass cannot find a new
match. Extending the existing certificate to these groups raises the counts to
1, 0, 3, 12, and 13 without adding data. The incremental timings are 191.422,
311.883, 2101.836, 2891.125, and 713.023 ticks per turn; the 24.92% slot-machine
win comes entirely from avoiding confirmation scans in frequently changing
singleton groups.

Input specialization is also consumed now without growing the rule records.
The compiler's early-rule masks reduce to universal rules or contiguous blocks
in three certified layouts: up/down/left/right quartets, up/down pairs, and
left/right pairs. The exporter encodes the layout in two otherwise-unused high
bits of `rule_count`; mixed or irregular groups remain universal. On the five
benchmarks this certifies 1, 1, 5, 6, and 0 groups respectively. For a left or
right turn the reachable early-rule counts are 1/4, 2/8, 11/20, 9/18, and
37/37. Selecting a block once per group is both smaller and faster than the
rejected prototype that stored and checked an input class on every rule. The
final incremental timings are 215.680, 384.758, 3484.773, 5768.320, and
5798.195 ticks per turn.

The first safe board-presence consumer is retained too. Rather than maintaining
32 exact object counters, it initializes a width-specialized OR mask when a
board is loaded and only accumulates objects created during the level. This can
leave harmless false positives after removals but cannot create a false
negative. A flagged rule is rejected only when the exact objects required by
its first pattern are absent. The exporter flags a rule only when that pattern
mentions an object not present on every retained starting board, and emits a
zero-count macro so games with no profitable candidates compile the cache and
test out completely. The rejected ungated prototype slowed Sokoban and pushit
by 0.45% and 0.51%; the retained gate restores both exactly while reducing the
other timings to 2319.305, 4283.648, and 715.617 ticks per turn.

### P1: stop scanning every possible start cell

Use an object required by the rule as a compile-time anchor.

The first retained slice uses the player because its aggregate mask is already
part of the runtime ABI. If a rule's first pattern requires a player, the
exporter flags it and the collector enumerates a sorted player-cell posting
list. The list is exact on level load and accumulates cells whenever rules or
movement create a player. Removed players may leave stale entries, which cause
only safe extra predicate checks; insertion order is normalized so match order
remains the same. This flags 2/4, 4/8, and 6/62 rules in the eligible compact
games and produces final timings of 191.422, 311.883, and 2101.844 ticks. The
20- and 17-object builds emit a zero-count macro and are exact timing, ROM, and
RAM controls.

The all-width prototype was rejected before retention: slot machine exceeded
the 16 KiB fixed bank by 32 bytes. Replacing the tiny insertion loop with
`memmove` was worse, growing the overflow to 216 bytes through helper-call
cost. Broader per-object bitsets/posting lists remain worth testing after ABI
and renderer work free fixed ROM, but should not be enabled indiscriminately.

- A per-object cell bitset costs at most `32 * ceil(90/8) = 384` bytes.
- Select a required object, enumerate only its occupied cells, and derive the
  candidate rule start from the pattern offset and direction.
- Fall back to the rectangular scan for negative-only patterns.
- Update the bitsets in `ps_gbc_board_set`, alongside the existing dirty bit.

This preserves scan order when candidates are enumerated in cell order. It is
more promising than only adding a board-wide precheck because the rule-heavy
boards can contain most object kinds while still having few cells for a
specific anchor.

The separate matched-start opportunity is now retained. A fixed 90-byte array
fits in `PS_GBC_SESSION_OVERHEAD_BUDGET`, so the explicit match bitset allocation
is removed and declared arenas become 6-11 bytes smaller. Local pointers keep
SDCC from repeatedly reconstructing the inline-array address. Match collection
is already in ascending cell order, and the apply pass still revalidates each
saved start immediately before replacement, preserving the previous semantics.
Final incremental timings are 213.664, 379.672, 2254.812, 3850.680, and 713.055
ticks per turn.

### P2: specialize the generated data ABI

**Complete-sequence sharing is retained.** Rules now reuse an existing exact
contiguous pattern sequence before appending new records. This removes 64
records / 2,368 linked bytes in Xorro and 24 records / 888 linked bytes in
Voitex; the other three cartridges are byte/timing controls. Runtime timings
are exactly unchanged because the rule's existing first-pattern byte offset
points directly at the shared sequence.

The runtime specializes live board/movement widths, but `ps_gbc_pattern` still
contains nine 32-bit masks plus flags. Generate mask fields at the selected
object and movement widths. Approximate packed records are 10 bytes for a
one-byte/one-byte game, 22 bytes for a four-byte/one-byte game, and 27 bytes for
a four-byte/two-byte game, versus 37 bytes in the GBDK layout now.

This reduces ROM reads as well as space. Consider splitting match predicates
from replacement data so failed candidates do not touch RHS-only fields. Share
identical complete pattern sequences first because it has no hot-loop
indirection; only then evaluate individual-pattern interning.

Apply the same hot/cold split to rules: keep the pattern pointer/offset, count,
and direction in the scanned record, and move commands, sounds, and messages to
optional action metadata. Emit group rule pointers with generated-width counts
instead of 16-bit index-plus-count pairs. Expose fixed counts, dimensions,
background mask, and direct table symbols in `generated_game.h`; do not make
SDCC recover constants through the generic cross-translation-unit game view.

Avoid unrestricted per-rule C generation initially. The conservative game-data
estimates range from 1268 to 7716 bytes, but instrumented bank-1 links already
range from 7056 to 12543 of 16384 bytes. A small family of width/flag-specialized
shared kernels is safer than 62 expanded rule functions.

### P2: secondary indexes

- Maintain a player-cell bitset to avoid scanning the entire board in setup.
- Maintain win-condition satisfaction/violation counts on board writes instead
  of rescanning every cell after every turn.
- Maintain a movement-nonempty bitset and enumerate it in cell order during
  resolution. A more aggressive work queue must be parity-tested carefully
  because revisit/order behavior is observable.
- Replace full SRAM snapshots with a mutation journal only after rule matching;
  snapshots are below 2.1% in four cases and 0.57-0.88% in the wide cases, so
  this is not a first-order optimization.

## Idle-time prediction

The cartridge is genuinely idle when there is no button edge and no pending
`again`; the main loop only polls input and waits for VBlank. Memory is not an
absolute blocker: normal builds use SRAM bank 0 for progress and bank 1 for
undo/checkpoint, leaving banks 2 and 3 (16 KiB total) unused. Banked CGB WRAM
also exists, although it is less convenient for C data.

Full future-state prediction is still not recommended now:

- Five possible inputs multiply a 160 ms-3.57 s turn cost by five.
- `ps_gbc_step` is monolithic. Starting a speculative slow turn can make a real
  input wait seconds unless evaluation becomes abortable or resumable.
- A correct cache must include session metadata, undo/checkpoint effects,
  message/level transitions, dirty cells, and audio, not only the board.
- Every accepted input invalidates the other candidates.
- The current `vsync()` idle path halts the CPU; speculation would replace a
  battery-saving sleep with continuous double-speed computation.

Use idle time first for safe derived data: object counts, anchor bitsets,
rule-eligibility masks, and possibly precomposed visual assets. Those structures
also accelerate the real turn without speculative semantics.

If optimized worst cases still exceed the responsiveness target, test a single
speculative entry for the last/repeated direction in SRAM bank 2, using a clone
with isolated snapshot I/O and cooperative joypad-abort checks. Do not begin
with all five futures or partial-state memoization.

## Missing instrumentation and guardrails

Add count-only probes to the separate phase ROM, not the headline ROM:

- rules visited and skipped by precheck;
- group invocations, changing passes, and confirmation passes;
- candidate cells, pattern tests, matches, and revalidations;
- replacement attempts/changes;
- dirty cells, composition-cache hits/misses, and uploaded quartets.

Also create a debug-symbol build for an Emulicious profile of the exact same
input traces. Use it to rank functions and instruction ranges, but do not mix
profiler overhead or emulator-only timing into the headline timer results.

The desktop runtime already exposes similarly named counters. Mirroring a small
subset on GBC and writing them to benchmark SRAM will make static scheduling and
anchor experiments explainable without adding a timer call to every pattern.

Keep these gates for every retained optimization:

1. Three-boot deterministic hardware-timer suite.
2. Native/GBC state parity, especially simultaneous matches and group loops.
3. Undo, cancel, restart, checkpoint, message, `again`, and level-start rules.
4. Sound-event parity for movement, failure, create/destroy, and rule SFX.
5. Link-map limits for fixed ROM, generated bank, WRAM, and SRAM.
6. All compatible production cartridges plus the mGBA render/hardware smoke.

## Recommended implementation order

1. Capture a source-attributed Emulicious profile of the baseline harness.
2. Retain the combined C hot-loop rewrite, plus the direct first-pattern
   pointer/offset, after the full correctness gate.
3. Add GBC count probes, then consume board prechecks, input specialization,
   wake masks, and certified single-pass groups one experiment at a time.
4. Extend the retained matched-start array and compact player posting list only
   where broader anchor indexes beat their fixed-ROM and RAM costs.
5. Introduce width-specialized packed patterns and exact sequence sharing.
6. Re-profile. Only then test GBC-only static scratch and a fused, one-byte
   object-only SM83 match/scan kernel with the C path retained as an oracle and
   fallback.
7. Address initial rendering first with fixed 5x5 pointer-streamed sprites and
   a compact layer-ordered render table and bounded precomposed quartets; then
   test GBDK HBlank copy, measured VRAM-DMA variants, an inactive-map handoff,
   and near-call renderer entry points if level-transition latency or blanking
   remains objectionable. The one-call quartet upload has already been measured
   and rejected at 0.00% initial-render improvement.
8. Consider one-entry idle speculation only if the optimized rule engine still
   misses the chosen interaction-latency target.
