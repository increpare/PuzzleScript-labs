# Review: PuzzleScript Hardware Handheld Design

**Date:** 2026-07-04
**Spec:** `docs/superpowers/specs/2026-07-03-puzzlescript-handheld-design.md`
**Scope:** design-doc review only (no implementation). Engine-facing claims were
checked against the repo; memory/timing numbers below were measured on this
machine against the current native build (`build/native/puzzlescript_cpp`,
arm64 Release).

## 1. Overall verdict

The product shape is good and the non-goals are the strongest part of the doc:
no Linux, no editor, no wireless, no player camera, LCD-not-AMOLED are all
correct calls, each with a stated reason. The display contract (whole level
always visible, integer scaling, `flickscreen`/`zoomscreen` honored) is
faithful to PuzzleScript and testable.

However, the spec treats "run the existing native C++ compiler/runtime on an
ESP32-P4" as a settled premise, and it is currently the least-validated part of
the design. Two measured facts and one legal question need to be resolved
before any Track 2 (custom PCB) spend, and arguably before buying Track 1
hardware:

1. **Runtime-load memory for outlier corpus games currently peaks at ~110 MB**
   — 3–7× the largest available PSRAM option (§3, M1).
2. **The native code is desktop-only today** — pervasive C++ exceptions,
   `std::thread`, only ever built/tested on 64-bit arm64 (§3, M4).
3. **The built-in corpus is other people's games** — shipping them on hardware
   needs permission (§3, M3).

None of these kill the design. All of them are cheap to de-risk on a desk,
before hardware, and the validation plan should be reordered to do so.

## 2. Claims verified against the repo

| Spec claim | Verdict |
|---|---|
| Text screens are 34×13 | **Correct.** `TERMINAL_WIDTH`/`TERMINAL_HEIGHT` derive from `intro_template` (`src/js/engine.js:88`), which is 34 chars × 13 rows. |
| `flickscreen`, `zoomscreen`, `realtime_interval`, `noundo`, `noaction`, `norestart` semantics | **All exist** (`src/js/parser.js:216-217`); the described behaviors match the engine. |
| No mouse input to support | **Correct.** Mouse handling in `src/js/inputoutput.js` is level-editor-only; games are keyboard-driven. D-pad + Action covers gameplay. |
| Native C++ compiler/runtime exists and is session-capable | **Correct.** `native/include/puzzlescript/puzzlescript.h` exposes compile, seeded state creation (`ps_full_state_create_with_loaded_level_seed`), undo (`ps_full_state_undo`), and sound seeds (`ps_game_sound_seed`). |
| ESP32-P4 feature list (400 MHz dual RISC-V, MIPI DSI, USB 2.0 OTG, LP core, in-package PSRAM up to 32 MB, no radio) | **Correct** per the cited datasheet. |
| 5×5 sprite grid as base unit | **Correct** for this engine. |

One claim I could not reproduce: the corpus sizing stats ("444 games and 2,074
levels, median 11×9, p90 21×17, p95 25×19"). `src/tests/solver_tests` has 184
games and `src/demo` has 96; the remainder presumably comes from
`testdata.js`. The numbers are plausible, but the sizing script should be
checked in (or referenced from the spec) so the stats are reproducible when
the corpus changes — they drive the central display decision.

## 3. Major findings

### M1 — Runtime-load memory vs PSRAM is the design's biggest unexamined risk

Measured peak memory footprint of the current full load path
(`puzzlescript_cpp run <game> --headless` = compile → lower → init runtime):

| Game | Peak memory footprint |
|---|---|
| `one_move.txt` (401-byte toy) | ~2 MB |
| `8 happy snakes.txt` (typical) | ~4.4 MB |
| `i sure look tasty.txt` (largest source, 91 KB) | **~109 MB** |
| `easyenigma.txt` | **~111 MB** |

For comparison, compile-only stages on `easyenigma`: `--diagnostics` peaks at
~12 MB and `--emit-ir-json` at ~25 MB. So the blow-up is in **runtime
lowering/initialization**, not parsing. `PUZZLESCRIPT_INPUT_SPECIALIZATION=0`
does **not** help (still ~110 MB), so it is not the per-input specialization
tables. The specific allocation source is an open question.

Implications for the spec:

- Typical corpus games fit 16–32 MB PSRAM with room to spare. The heavy tail
  does not, by 3–7×. 64-bit desktop pointers and allocator slack inflate these
  numbers relative to rv32, but not by 3–7×.
- **Compiled caches do not obviously save you.** If the peak is building the
  in-memory runtime structures, loading a cache reaches a similar peak unless
  the cache format *is* (close to) the in-memory layout. The spec currently
  assumes caches solve relaunch speed; it should not also silently assume they
  solve memory.
- **Requested change:** add to Software Validation, as the *first* item, a
  desktop per-game peak-memory audit across the whole corpus (this is an
  afternoon of scripting), with an explicit per-game memory ceiling as an
  acceptance criterion. Add a work item to diagnose and diet the runtime-load
  path, or explicitly accept a documented "this game is too large for the
  handheld" failure mode — which would contradict the current acceptance
  target of "whole corpus playable," so the tension must be resolved in the
  spec either way.

### M2 — The compiled cache is speculative; consider descoping it from v1

The spec lists a "`.txt` compiler and compiled-cache manager" as a firmware
layer and specifies cache keys, invalidation, and crash recovery. But no
serialization format for a compiled game exists in `native/` today — this is a
real, non-trivial design-and-versioning work item, not plumbing.

Meanwhile the motivating problem may not exist: desktop compile of the largest
corpus game is ~30 ms. Even at a pessimistic 100× penalty on a 400 MHz RV32
core, worst-case on-device compile is ~3 s, and typical games well under 1 s.
That is compatible with "instant-on feel" for everything except perhaps the
heaviest games.

**Requested change:** either (a) descope compiled caches from v1 and simplify
the launch flow to always compile — deleting a firmware layer, a file format,
a versioning scheme, and three error-handling paths from the spec — or (b) if
caches stay, justify them with a measured on-device compile time and specify
that the cache format must also address the M1 memory peak (e.g. a
memory-image-friendly layout), otherwise it earns neither of its keeps.

### M3 — Corpus licensing is unaddressed

"Built-in main corpus games" means shipping ~hundreds of third-party authors'
games on a physical product, even a boutique one. The test corpus was gathered
for engine testing; redistribution on hardware is a different act. This needs
a curation/permission pass and it will change the shipped-corpus size, which
in turn feeds the library UI and storage sizing.

**Requested change:** add a "corpus curation and permissions" work item to the
plan, and soften "built-in main corpus" to "built-in curated corpus (games we
have permission to ship)."

### M4 — Embedded portability of the native code needs a step-zero smoke test

The native tree is desktop-first in ways the spec doesn't acknowledge:

- C++ exceptions are used pervasively (`native/CMakeLists.txt` explicitly
  documents that `-fno-exceptions` would require a large rewrite). ESP-IDF
  supports exceptions, but they must be enabled and cost flash + heap.
- `<thread>` is used in `native/src/runtime/core.cpp` and several mains.
  FreeRTOS pthread shims exist but stack sizing is manual and failure modes
  differ.
- Everything has only ever been built and parity-tested on 64-bit arm64. Note
  that the Makefile's `build_32` target is the 32-bit *bitmask* variant, not a
  32-bit *architecture* build — the spec should not mistake one for the other.
- Binary size is ~2.2 MB on desktop with LTO for the full multi-tool CLI; the
  runtime-only subset needs its own flash budget line.

**Requested change:** add "Track 0" before the dev-kit: cross-compile the
compiler+runtime (no SDL, no solver, no generator) for rv32 (or any 32-bit
target under qemu) and run the existing corpus parity suite. This is days of
work, costs no hardware, and retires the single biggest architectural
assumption in the document. It also produces the real embedded binary-size and
compile-speed numbers that M1/M2 need.

## 4. PuzzleScript semantics — gaps and clarifications

- **Held-key repeat is missing.** `key_repeat_interval` (`parser.js:216`)
  governs move repeat while a direction is held, and it is essential to how
  PuzzleScript games feel. The input scanner section should specify held-state
  tracking and repeat timing, not just edge-triggered button events. Same for
  `again_interval` — the doc's redraw list says "animation," but naming the
  actual mechanisms (`again` ticks, `realtime_interval` ticks, message
  advance) would make the renderer contract precise.
- **Realtime games undermine the power model.** "Idle or underclock between
  moves" is the load-bearing assumption in the power budget, and
  `realtime_interval` games violate it by design. The battery section should
  name realtime games as the worst case, and Hardware Validation should
  measure battery on one (e.g. a corpus realtime game) alongside the
  turn-based number.
- **Who owns the title screen?** Games have their own 34×13 title screens with
  "new game / continue." The spec's library UI overlaps that responsibility.
  Decide and state: library → game title screen (faithful, slightly
  redundant), or library replaces it (cleaner, less faithful, and "continue"
  semantics move into library saves).
- **Stuck players have no exit.** With no level select, a player stuck on
  level 3 of a hard game owns a brick (for that game). Faithful to the web
  player, but a physical device invites a kinder option: Menu → jump to any
  previously-reached level (the save data already tracks progress). Product
  decision; the spec should make it explicitly rather than by omission.
- **Save format: recommend snapshots, not move replay.** "Move history/undo
  stack where supported" is ambiguous. Replaying move history to reconstruct
  state requires persisting the RNG seed and bit-exact simulation stability
  across firmware versions — fragile. Serializing the level state (plus a
  bounded number of undo snapshots, or none) is simpler and matches the native
  API surface. Recommend: persist current-level snapshot + restart snapshot +
  completion state; accept that the in-session undo stack dies at power-off,
  or cap it.
- **Audio path needs one more sentence.** The engine emits sfxr *seeds*
  (`ps_game_sound_seed`); something on-device must synthesize PCM from them.
  The SDL player presumably already has a native sfxr synth — the spec should
  say "reuse the native player's sfxr synthesis" if true, or add the port as a
  work item if not. Also note the native runtime distinguishes recorded
  `audio_events` from cosmetic `ui_audio_events`; the handheld must play both,
  and haptic/LED event hooks should tap the same event stream rather than
  growing a parallel one.

## 5. Display and rendering comments

- **Multiple-of-5 scaling: state the trade-off you're making.** Restricting
  cell sizes to 5, 10, 15… px guarantees uniform sprite pixels but forfeits up
  to ~40% of linear resolution in unlucky cases (e.g. a 27-wide level: 29 px
  available → 25 px used). The alternative — arbitrary integer cell sizes with
  uneven per-pixel widths (4-5-4-5…) — is what many scalers do and looks fine
  above ~3×. The current choice is defensible on a small fixed panel; the spec
  should record it as a decision with the rejected alternative, since it will
  otherwise be relitigated at first playtest.
- **Exempt text screens from the 5-grid rule.** 34 columns on 800 px gives
  23 px cells; snapping to 20 wastes 15% of the width of the screen users see
  most often (titles, messages). Text glyphs have their own grid; scale them
  independently.
- **The "degraded downsample mode" (step 4) will produce mush.** Fractional
  downscaling of 5 px-per-tile art is unreadable; a warning doesn't fix that.
  Since the corpus audit shows nothing needs it (5 px/tile covers up to
  160×96 tiles on this panel), recommend replacing it with a hard error screen
  ("level too large for this display") — simpler, honest, and it can't
  silently ship an unreadable game.
- Filling the border with the game background color matches engine behavior —
  good. Note `background_color` metadata (and per-palette background) is the
  right source, and the LED "match background" feature should read the same
  value.

## 6. Hardware comments

- **Put the battery math in the doc.** 1.5–2.0 W × 6–8 h = 9–16 Wh =
  2,500–4,300 mAh at 3.7 V. The bottom of that range is a comfortable 5-inch
  handheld; the top is phone-battery territory and drives case thickness.
  Commit to a Wh figure (suggest ~10 Wh / 2,700 mAh targeting 6 h at
  mid-brightness) so the case and PCB teams have a number.
- **Prefer the 32 MB PSRAM option, and budget it.** Two 800×480 RGB565
  buffers are 1.5 MB, and DSI refresh streams ~88 MB/s from PSRAM at 60 Hz,
  contending with compile/load bursts. Given M1, 16 MB has no headroom; the
  spec should just pick 32 MB and include a PSRAM budget table (framebuffers,
  runtime, library index, scratch).
- **Panel selection: prioritize esp_lcd driver support over the Waveshare
  reference.** Waveshare's RPi-oriented DSI panels often carry RPi-specific
  I2C init/backlight bridges — a known integration tar pit on non-RPi hosts.
  The fallback ordering in the spec is right; sharpen it by requiring a panel
  whose controller (e.g. ILI9881C/EK79007 class) has an existing ESP-IDF
  `esp_lcd` driver and public init sequence.
- **Use the LP core; it's sitting right there.** The ESP32-P4's LP core can
  own button scanning, wake-on-input, and battery monitoring during sleep —
  it is the natural implementation of the "instant-on, sleep between moves"
  story and deserves a line in the architecture section.
- **Storage: name the wear story.** "Large external flash plus a FAT
  volume layer" without a flash translation layer will wear-hole the FAT
  region, especially with per-move autosaves. Either pick managed storage
  (microSD/eMMC) for the writable volume, or specify littlefs/FTL internally
  with FAT exposed only for the USB MSC partition. Also specify save-write
  frequency (per move? per level? on sleep?) since it drives both wear and
  low-battery behavior.
- The USB MSC design (pause gameplay, flush, expose volume; firmware recovery
  separate from game storage) is right. Add one line: fsck/quarantine the FAT
  volume on remount, since the host can corrupt it freely.

## 7. Validation plan — requested additions

The corpus-first software validation list is good. Add:

1. **Per-game peak-memory audit** (desktop first, then on-target) with a hard
   ceiling — see M1. This should be the first gate, not a hardware-phase one.
2. **rv32/32-bit cross-build + corpus parity run under emulation** — see M4 —
   before Track 1 hardware purchase.
3. **A numeric input-to-redraw latency target** (suggest ≤ 50 ms
   button-to-photon for turn-based play); "measure it" without a target can't
   fail.
4. **Battery runtime on a realtime-interval game**, not just turn-based play.
5. **Held-key repeat feel test** against the web player as reference.

## 8. Verdict

| Gate | Result |
|---|---|
| Product shape / non-goals | **Sound.** No changes requested. |
| Display contract | **Sound**, with §5 refinements (text-screen exemption, drop downsample mode). |
| "Native runtime on ESP32-P4" premise | **Not yet validated.** Blocked on M1 (memory audit + diet-or-descope decision) and M4 (32-bit/embedded build smoke test). Both are desk work. |
| Compiled-cache layer | **Recommend descope from v1** or re-justify with measurements (M2). |
| Corpus shipping | **Blocked on licensing/curation** (M3). |
| Proceed to Track 1 (dev-kit) | **Yes, after** the M1 desktop memory audit and the M4 cross-build smoke test — both cheaper and faster than the hardware they de-risk. |
| Proceed to Track 2 (custom PCB) | Premature to schedule; gate on Track 0/1 outcomes. |
