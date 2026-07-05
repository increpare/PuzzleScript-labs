# PuzzleScript Handheld Track 1 Dev-kit Design

Status: proposed, board ordered.
Date: 2026-07-06.

## Summary

Track 1 now has a concrete primary board: the Waveshare
ESP32-P4-WIFI6-Touch-LCD-7B, the 7-inch ESP32-P4 HMI board the user has
ordered. Use it as the first hardware truth source for the PuzzleScript
handheld. The goal is not to make this board the final product shape. The goal
is to get the native PuzzleScript compiler/runtime, ESP-IDF heap
instrumentation, display output, SD/user-game path, controls, audio, and basic
power behavior onto real ESP32-P4 silicon as quickly as possible.

This spec narrows Track 1 from "some ESP32-P4 dev-kit handheld" to a concrete
bring-up target and acceptance ladder. It extends the broader handheld design
in `docs/superpowers/specs/2026-07-03-puzzlescript-handheld-design.md` without
changing the final product contract: the final handheld still targets a
rectangular 5-inch 800x480 LCD/IPS-class display with whole-board PuzzleScript
visibility.

## Board Decision

Use the Waveshare ESP32-P4-WIFI6-Touch-LCD-7B as the primary Track 1 firmware
bench.

Known useful board properties:

- ESP32-P4NRW32 class module with 32 MB PSRAM and 32 MB flash.
- ESP32-C6 companion for Wi-Fi 6 and Bluetooth 5 LE, connected by SDIO.
- 7-inch 1024x600 landscape capacitive touch LCD over MIPI DSI.
- USB OTG 2.0 high-speed Type-A port and USB-C debug/programming ports.
- SDIO 3.0 TF card slot.
- ES8311 audio codec, ES7210 echo-cancellation chip, dual microphones, and a
  speaker header.
- Battery connector, battery placement area, power switch, boot/reset buttons,
  I2C/UART/CAN/RS485 headers, and a GPIO expansion header.
- Official Waveshare examples and schematic are available.

This board is "P4 truth": it should tell us whether the embedded native
compiler/runtime premise is plausible on ESP32-P4 with 32 MB PSRAM. It is not
"handheld truth": the panel is larger and higher resolution than the intended
5-inch 800x480 product, and the development board's power path, enclosure, and
connector layout are not the final device.

## Development Stack

Use ESP-IDF for Track 1. Waveshare's own docs note that ESP32-P4 Arduino
support is still limited and recommend ESP-IDF for stable development at this
stage. The bring-up app should be an ESP-IDF project in this repo:

```text
firmware/esp32p4/
```

Suggested internal component boundaries:

- `board_waveshare_7b`: board pins, display init, backlight, SD, audio, and
  board-specific probe helpers.
- `ps_core`: a minimal ESP-IDF component wrapping the existing native
  PuzzleScript compiler/runtime source files needed for compile, load, and
  headless stepping.
- `ps_renderer`: draws PuzzleScript board/text frames into RGB565 framebuffers.
- `ps_storage`: loads built-in and SD-card `.txt` sources.
- `ps_instrumentation`: structured heap, timing, and phase logs over serial.
- `main`: boot flow, bring-up menu, test-game launcher, and feature gates.

Do not start with LVGL as the PuzzleScript renderer. Vendor LVGL examples are
useful for display smoke tests, but PuzzleScript only needs crisp sprite/text
rendering and a small library UI. A direct renderer is simpler to measure and
keeps the first memory numbers cleaner.

## Display Strategy

The ordered board has a 1024x600 panel. The final handheld contract remains
800x480. Therefore Track 1 firmware must support two display modes from the
start:

1. `native_1024x600`: prove that the board display, DMA, backlight, and panel
   timing work reliably at the panel's real resolution.
2. `target_800x480`: render the final handheld's 800x480 virtual display into
   a centered letterboxed area on the 1024x600 panel.

All PuzzleScript fit decisions, corpus gates, and "whole board visible" claims
use `target_800x480`. The native panel mode is for driver confidence,
performance profiling, and debugging convenience only.

Framebuffer budget must report both sizes:

- 800x480 RGB565: 768,000 bytes per framebuffer; 1,536,000 bytes for double
  buffering.
- 1024x600 RGB565: 1,228,800 bytes per framebuffer; 2,457,600 bytes for double
  buffering.

Track 1 should begin with one framebuffer unless the display driver requires
or clearly benefits from double buffering. The serial heap report must make the
framebuffer allocation policy explicit.

## First Testable Firmware Slice

The first deliverable should be a board-probe firmware, not a complete console
UI. It should flash quickly, boot without user assets, draw something visible,
and print machine-readable logs.

On boot it should:

1. Print chip, flash, PSRAM, ESP-IDF version, app version, and reset reason.
2. Print heap snapshots for internal RAM, SPIRAM, and 8-bit-capable memory.
3. Initialize display/backlight and draw a visible diagnostic pattern.
4. Mount the TF card when present and report mount status.
5. Compile and launch a built-in `sokoban_basic`-class source in headless mode.
6. Render one PuzzleScript board frame into the `target_800x480` virtual area.
7. Print heap/timing snapshots for each phase.
8. Keep a serial command or boot-menu option for repeating tests without
   reflashing.

The first pass can use touch or serial input instead of physical buttons. GPIO
buttons belong in the next slice once the core boot, heap, display, and compile
path are alive.

## Instrumentation Contract

Every board run should emit JSON-lines or similarly easy-to-parse serial logs.
At minimum, each phase log includes:

- phase name
- elapsed milliseconds for the phase
- free bytes, low-water mark, largest free block, and allocation count where
  available for `MALLOC_CAP_INTERNAL`
- the same values for `MALLOC_CAP_SPIRAM`
- the same values for `MALLOC_CAP_8BIT`
- active display mode and framebuffer policy
- game title/source identifier when a game is involved
- pass/fail status and a short failure code

Required phases:

```text
BOOT
DISPLAY_INIT
STORAGE_INIT
LOAD_SOURCE_FLASH
COMPILE_SOURCE
CREATE_RUNTIME
LOAD_LEVEL
RENDER_FRAME
RUN_INPUT_TRACE
UNLOAD_GAME
LOAD_SOURCE_SD
```

Register an ESP-IDF allocation-failure hook early so failed allocations identify
requested size, capability mask, and active phase. Heap tracing and heap
poisoning are optional debug builds, not the default pass/fail configuration,
because they change memory use and timing.

## PuzzleScript Test Set

Use a tiny, fixed game set before attempting the full corpus:

- `src/demo/sokoban_basic.txt` or equivalent built-in source for the first
  compile/run/render smoke.
- One `flickscreen` or `zoomscreen` game selected from the existing handheld
  display report to prove viewport semantics.
- One text/title/message-heavy game to prove the 34x13 terminal renderer.
- The memory-audit outlier `gallery game: at the hedges of time`, because the
  host audit identified it as the current peak-RSS outlier.
- One intentionally broken source to prove compile diagnostics remain readable
  and recoverable.

The outlier does not have to pass in the first firmware slice. It must produce
a clear phase-specific result: pass, compile diagnostic, unsupported feature,
or allocation failure with heap state.

## Storage And User Game Path

The ordered board's TF card slot is the first user-game storage target. Track 1
should prove:

- mount a FAT-formatted TF card
- scan a `/games` directory
- load at least one `.txt` game from the card
- handle a broken `.txt` file without crashing the library/probe shell
- unmount/remount cleanly across reset

USB mass-storage exposure is not required for the first board-probe firmware.
It remains part of the broader handheld design, but the fastest path to
testable hardware is SD-card loading plus serial logs.

## Controls And Feedback

For the first physical-control slice, wire a temporary button daughterboard or
breadboard to the GPIO expansion header. The exact pin map must be derived from
the Waveshare schematic before wiring.

Minimum controls for Track 1:

- D-pad up/down/left/right
- Action
- Undo
- Restart
- Menu or Back

Each button should have edge and held-state reporting over serial before it is
allowed to drive PuzzleScript input. Once mapped into the runtime, measure
button-to-redraw latency for turn-based play.

Audio bring-up should use the onboard ES8311/speaker path after the core
runtime smoke passes. Haptics and RGB LEDs should use external breakout parts
on GPIO after the button path is stable. They are useful, but they must not
block the first compile/render/heap truth run.

## Memory Interpretation

The earlier macOS peak-RSS audit remains useful for ranking games, but the board
run is the memory truth source. macOS allocator residency does not map directly
to ESP32-P4 heap pressure.

Track 1 answers these questions:

- How much SPIRAM is available after boot, display init, storage init, and
  static framework allocations?
- Does the native compiler/runtime build for ESP32-P4 without dragging in SDL,
  solver, generator, desktop filesystem assumptions, or avoidable C++ runtime
  bulk?
- How much heap is consumed by compile, runtime creation, level load, and first
  render?
- Does the largest-free-block number remain high enough after compile/free, or
  does fragmentation become the real limiter?
- Does the outlier fail because of logical live data, temporary compile-time
  allocations, fragmentation, stack, or a desktop-only dependency?

Do not treat "game passed on 7-inch native mode" as final product validation.
For product validation, the renderer must run in `target_800x480` mode and
reuse the display-fit semantics already tested by `make handheld_report`.

## Acceptance Ladder

Track 1 is complete enough to move toward PCB/interface planning when these are
true:

1. The vendor display example builds, flashes, and lights the panel.
2. The repo-owned board-probe firmware builds and flashes with ESP-IDF.
3. Serial logs report 32 MB-class PSRAM, flash, heap snapshots, and reset
   reason.
4. The firmware draws both native 1024x600 diagnostics and centered 800x480
   target diagnostics.
5. A built-in PuzzleScript game compiles on-device, creates a runtime session,
   loads the first board level, renders one frame, and reports phase heaps.
6. At least one `.txt` game loads from TF card and follows the same path.
7. A broken `.txt` file reports a compiler diagnostic without rebooting.
8. Temporary physical buttons drive D-pad, Action, Undo, Restart, and Menu
   events through the runtime.
9. Audio can play one PuzzleScript sound event through the onboard speaker path.
10. The outlier game has a phase-specific measured result, even if that result
    is an honest unsupported/too-large outcome.

## Non-goals

- Do not design the final custom PCB in this slice.
- Do not lock the final part list from the dev board.
- Do not infer final 5-inch battery life from the 7-inch panel.
- Do not require USB mass storage before SD-card user-game loading works.
- Do not require Wi-Fi/Bluetooth.
- Do not build the final library UI before the compile/render/heap path is
  measured on-device.
- Do not use the 1024x600 panel to relax the final 800x480 display contract.

## Follow-up Implementation Plan

After this spec is reviewed, write a dedicated implementation plan for the
first board-probe firmware. That plan should be separate from the earlier host
display and memory audit plans. It should be built around the ordered
Waveshare board, ESP-IDF, serial heap logs, the `target_800x480` display mode,
and one built-in PuzzleScript compile/render smoke.

## Sources

- Waveshare ESP32-P4-WIFI6-Touch-LCD-7B documentation:
  https://docs.waveshare.com/ESP32-P4-WIFI6-Touch-LCD-7B
- Waveshare ESP32-P4-WIFI6-Touch-LCD-7B product page:
  https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-7b.htm
- ESP32-P4 product page:
  https://www.espressif.com/en/products/socs/esp32-p4
- ESP-IDF heap memory debugging:
  https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/system/heap_debug.html
- ESP-IDF heap memory allocation:
  https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/api-reference/system/mem_alloc.html
