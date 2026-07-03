# PuzzleScript Hardware Handheld Design

Status: proposed.
Date: 2026-07-03.

## Summary

Build a small-run physical PuzzleScript handheld: a dedicated, instant-on
PuzzleScript player with a custom PCB, a 3D-printable translucent case, a
5-inch 800x480 landscape color display, proper PuzzleScript controls, speaker,
haptics, and subtle case lighting.

The device is not a general retro console and not an on-device editor. It is a
comfortable physical way to browse and play the main PuzzleScript corpus and
user-supplied `.txt` games. It uses the existing native C++ PuzzleScript
compiler/runtime directly on an ESP32-P4-class microcontroller, so it avoids a
Linux boot path and can wake into play quickly.

The display contract is strict: the whole level is visible at all times unless
the game declares `flickscreen` or `zoomscreen`. In those metadata modes the
declared viewport is fitted as large as possible. There is no player-controlled
camera or zoom mode in normal play.

## Goals

- Make a dedicated, tactile PuzzleScript handheld for the main corpus and user
  `.txt` games.
- Use an ESP32-P4 as the reference MCU, with enough PSRAM for compilation,
  rendering, library metadata, and cache handling.
- Run the native C++ compiler/runtime on-device, with compiled caches for faster
  relaunch.
- Use a 5-inch 800x480 landscape color display and fit each level or declared
  viewport with integer scaling.
- Provide PuzzleScript-native controls: D-pad, Action, Undo, Restart, Menu, and
  power/sleep.
- Provide mono speaker output, haptics, and subtle RGB case glow that can follow
  the game's background color.
- Support built-in corpus games and user games added over USB-C mass storage.
- Target practical 6-8 hour battery life in normal use, with brightness and
  feedback controls.
- Keep the enclosure 3D-printable, screw-serviceable, and intentionally suited
  to a smoky or frosted transparent shell.

## Non-goals

- No Linux application processor in v1.
- No on-device game editor in v1.
- No mandatory wireless stack in v1. Wireless can be a later companion-chip
  experiment if there is a real need.
- No AMOLED or e-paper production baseline in v1. AMOLED and color e-paper can
  remain display experiments, but the reference design is color LCD/IPS class.
- No player-controlled zoom/camera mode for normal PuzzleScript levels.
- No commercial manufacturing commitments in this design. The target is a
  boutique/small-run custom PCB and 3D-printable case.

## Corpus And Display Constraints

The current local corpus sample used for sizing contains 444 games and 2,074
levels from the test corpus plus demos. Most levels are compact: median level
size is about 11x9 tiles, p90 is about 21x17, and p95 is about 25x19. There are
rare wide/tall outliers, and some extreme cases already use `flickscreen` or
`zoomscreen`.

For no-camera levels, the renderer must show the entire board. On 800x480, the
large no-camera outliers still fit if the renderer is allowed to choose smaller
integer cell scales. Most no-camera levels fit comfortably at much larger
scales. This makes 800x480 landscape a good default: it favors the common corpus
shape while still preserving the PuzzleScript rule that the puzzle board should
not be cropped.

Rendering uses PuzzleScript's 5x5 sprite grid as the base unit. For a level or
viewport of `W x H` tiles:

1. Compute available tile-cell size from `800 / W` and `480 / H`.
2. Choose the largest integer multiple of the 5-pixel sprite grid that fits.
3. Treat one native 5x5 sprite cell as the normal minimum for corpus play.
4. If a future/user level cannot fit even at 5 pixels per tile, use a degraded
   whole-board preview/downsample mode with a warning rather than cropping.
5. Center the board and fill the unused border with the game's background color.

Text screens use the existing 34x13 text terminal constraints and should be
tested separately from board rendering.

## Product Contract

The handheld boots into a library UI, not a desktop, shell, or raw file browser.
The library includes:

- built-in main corpus games
- user games copied onto storage as `.txt`
- recent games
- per-game status such as last played and completion where available

The first release can keep browsing simple, but it should feel curated. Search,
tags, favorites, and screenshots can come later if they prove useful.

Gameplay controls are physical and direct:

- D-pad for movement
- large Action button
- Undo button
- Restart button
- Menu button
- Power/Sleep
- volume controls or a compact volume rocker

Restart is not hidden or recessed. PuzzleScript restart is normally undoable,
and the rare `noundo` games should be handled through honest UI feedback rather
than by making Restart awkward.

## System Architecture

The reference architecture is a no-Linux ESP32-P4 handheld running the existing
native C++ PuzzleScript compiler/runtime.

Firmware is divided into these layers:

- boot, power, and recovery
- storage and USB mass-storage mode
- game library/index
- `.txt` compiler and compiled-cache manager
- PuzzleScript runtime/session
- display renderer
- input scanner and button mapping
- audio, haptic, and LED feedback
- settings and save data

The ESP32-P4 high-performance cores run fast for compile, load, and redraw
bursts, then idle or underclock between moves. This matches PuzzleScript's
sokoban-style cadence: the panel may scan at 60 Hz, but gameplay does not need
a continuous 60 Hz render loop. Redraws happen after accepted input, animation,
messages, win handling, and declared realtime ticks.

The design uses a two-track reference build:

1. A dev-kit handheld proves firmware, display, controls, storage, audio,
   haptics, LEDs, and power behavior.
2. A custom PCB and 3D-printable case reuse the proven logical interfaces.

The ESP32-P4 is fixed as the reference brain. If a specific display interface is
painful, the architecture can move between MIPI DSI, parallel RGB, or a
controller-backed panel without changing the PuzzleScript runtime model.

## Hardware Components

### MCU And Memory

Use an ESP32-P4 variant/package with 16 MB or 32 MB PSRAM. The extra memory is
useful for on-device compilation, frame buffers, library metadata, rendering
scratch space, and cache handling.

The ESP32-P4 product family has a 400 MHz dual-core high-performance RISC-V
system, an LP core, MIPI DSI, parallel display support, USB 2.0 OTG, SDIO, 2D
DMA/PPA display helpers, and packaged PSRAM options. Those features align well
with this handheld: it wants rich display I/O and bursty compute, not a radio.

### Display

The reference display is a 5-inch 800x480 landscape color LCD/IPS-class panel
with software/PWM brightness control. A commodity Waveshare-class 5-inch DSI LCD
is a useful benchmark: it is 800x480, supports up to 60 Hz, and lists about 1.2 W
power consumption.

Panel preference order:

1. MIPI DSI panel if ESP32-P4 tooling and panel initialization are stable.
2. Parallel RGB panel if it is easier to drive reliably.
3. Controller-backed panel if event-driven partial updates and simpler firmware
   matter more than raw interface neatness.

AMOLED is not the v1 baseline because PuzzleScript often shows static boards
and UI, which makes burn-in a real product risk. Color e-paper is not the v1
baseline because color refresh is still too slow for satisfying interactive
feedback, even if PuzzleScript does not need 60 gameplay frames per second.

### Storage

The device exposes one writable game volume over USB-C mass storage. The exact
physical storage can be validated in the prototype:

- internal microSD
- managed flash/eMMC-style storage
- large external flash plus a FAT-compatible volume layer, if practical

The logical contract is more important than the part choice: users can copy
`.txt` games onto the device, and firmware can store compiled caches, saves, and
library metadata safely.

### Controls

Controls should use good tactile domes or low-profile switches. Avoid mushy
rubber feel unless a prototype proves it is pleasant. Suggested front layout:

- left D-pad
- large right Action button
- smaller Undo and Restart buttons near Action
- Menu button reachable but not in the movement path
- Power/Sleep on top or side
- volume rocker or two small side buttons

Action can be visually emphasized; Undo and Restart should be clearly labeled.
Restart is not recessed.

### Feedback

Audio is mono through a small speaker and class-D amplifier. The firmware uses
the PuzzleScript sfxr-style sound events already present in the engine.

Haptics use a coin motor or LRA. Haptic events should be short and optional:
undo, restart, win, blocked command, compile error, and menu selection are good
candidates.

Internal RGB LEDs sit behind the smoky/frosted transparent shell. Default glow
matches the game background color or the nearest stable palette color. Subtle
event pulses can accompany win, undo, restart, messages, and errors. LEDs must
have global brightness and off controls.

### Power And Service

Use a single-cell LiPo/Li-ion pack, possibly physically shaped as two cells
wired as 1S for case ergonomics. Include USB-C charging, a fuel gauge,
power-path management, battery-safe shutdown, display backlight control, and
sleep support.

Expose debug pads for firmware work: JTAG or ESP32-P4-supported debug access,
UART, boot/recovery, reset, and test pads for display/storage/power rails.

The case is 3D-printable, screw-serviceable, and translucent. Because the PCB is
visible, routing, silkscreen, LED placement, and battery/speaker cable paths are
part of the product design rather than hidden internals.

## Power Budget

Rough expectation:

- display/backlight: about 1.2 W at the Waveshare 5-inch DSI LCD reference point
- ESP32-P4: roughly 0.1-0.3 W for plausible underclocked/active play bursts,
  higher during full-speed compile bursts
- storage, amp, LEDs, haptics, regulators, and fuel gauge: variable, but small
  compared with the backlight unless LEDs or speaker are abused

The ESP32-P4 is not free, but it is not the dominant draw. The display/backlight
is. A realistic normal-play budget is likely around 1.5-2.0 W depending on
brightness and feedback settings. That supports the 6-8 hour practical target
with a comfort-sized battery, while still leaving headroom for short compile
bursts.

Firmware should make this true in practice:

- dim aggressively in menus and low battery
- sleep the high-performance cores between moves
- avoid continuous redraw
- cap LED brightness by default
- keep haptics short
- provide easy global feedback-off settings

## Firmware Data Flow

Boot flow:

1. Initialize power, display, buttons, storage, audio, haptics, LEDs.
2. Show a minimal splash/status screen.
3. Mount internal storage.
4. Scan the built-in corpus index and user game directory.
5. Load the library UI.

Game launch flow:

1. Select game in library.
2. Hash source and compare against compiled-cache metadata.
3. If a valid cache exists, load it.
4. Otherwise compile `.txt` source on-device with the native C++ compiler.
5. On success, write compiled cache and launch.
6. On failure, show a readable compiler error screen.

Runtime flow:

1. Scan input.
2. Map D-pad/Action/Undo/Restart/Menu into PuzzleScript runtime commands.
3. Step runtime.
4. Emit rendering, audio, haptic, LED, save, and UI events.
5. Redraw only when state or visible effects change.
6. Idle or underclock between events.

Save data stores current level, move history/undo stack where supported, restart
snapshot, settings, and completion state. Saves are versioned so stale saves can
be rejected cleanly.

USB-C has two normal user modes:

- charge while playing
- mass-storage mode for copying `.txt` games

Mass-storage mode pauses gameplay and flushes local writes before exposing the
volume to the host computer. Firmware update/recovery is separate from normal
game storage so bad game files cannot brick the device.

## PuzzleScript Semantics

The device must preserve existing PuzzleScript behavior.

- `flickscreen` and `zoomscreen` define the visible viewport. Fit that viewport,
  not the whole level.
- Without those metadata flags, fit the whole level.
- `realtime_interval` causes scheduled runtime ticks; the renderer still
  redraws only when those ticks change visible state or effects.
- `noaction` disables or hides Action affordances where appropriate.
- `norestart` makes Restart report a blocked command rather than silently doing
  nothing.
- `noundo` means Undo cannot recover moves, including a restart. The physical
  Restart button remains direct, but feedback should be clear.

## Error Handling And Safety

Game failures are recoverable. If a user `.txt` game fails to compile, the
handheld shows filename, line/column if available, and the compiler diagnostic.
The library remains usable.

Compiled caches are disposable. Cache keys include source hash,
compiler/runtime version, and target cache format. Missing, stale, corrupt, or
crashing caches are ignored and rebuilt from source.

Saves are versioned. If a save cannot be resumed, firmware launches the game
from the first level with a small notice instead of failing the whole game.

File writes use atomic temp-then-rename behavior for saves, caches, and library
metadata. Low battery first dims and warns, then autosaves and sleeps, then
performs clean shutdown at the critical threshold.

Global settings can disable or cap audio, haptics, and LEDs. Display brightness
has sensible defaults and a safe cap.

Recovery mode must work even if settings, library metadata, or user game files
are corrupt.

## Validation And Prototype Plan

### Track 1: Reference Dev-kit Handheld

Build a rough but playable dev-kit handheld:

- ESP32-P4 dev board
- candidate 800x480 display
- button daughterboard
- speaker and amp
- haptic motor
- RGB LEDs behind a simple translucent diffuser
- storage and USB mass-storage path
- battery/power hardware if practical

This prototype proves firmware, corpus behavior, display scaling, input feel,
power draw, and basic industrial design before the custom PCB.

### Track 2: Custom PCB And Case

Once interfaces are proven, design the custom PCB and 3D-printable enclosure.
The custom board preserves the same logical interfaces as the dev-kit build:
display, storage, buttons, audio, haptic, LEDs, USB-C/power, and debug pads.

Case iteration is based on real measurements:

- button spacing
- display bezel and viewing angle
- grip comfort
- speaker chamber
- battery volume
- cable/connector access
- heat
- translucent LED diffusion

### Software Validation

Validation is corpus-first:

- every built-in corpus game compiles on the embedded compiler
- every game launches
- every initial level renders
- representative smoke inputs survive without runtime crashes
- every level generates a fit/scale report
- no no-camera level is cropped
- every `flickscreen`/`zoomscreen` game uses the declared viewport
- text screens remain readable
- save/restore works across power cycles
- corrupt source/cache/save files fail gracefully

### Hardware Validation

Measure:

- cold boot to library
- wake from sleep to playable game
- compile time with no cache
- launch time with cache
- input-to-redraw latency
- display brightness and readability
- battery runtime at several brightness levels
- sleep current
- charge behavior
- heat at sustained high brightness
- speaker loudness and audio latency
- haptic feel
- LED color matching and diffusion
- USB mass-storage reliability

Acceptance target: instant-on feel, practical 6-8 hour battery life, whole
corpus playable, and no level becoming cropped or unreadable except known
extreme corpus outliers that still remain fully visible.

## Sources

- ESP32-P4 product page:
  https://www.espressif.com/en/products/socs/esp32-p4
- ESP32-P4 datasheet:
  https://www.espressif.com/sites/default/files/documentation/esp32-p4_datasheet_en.pdf
- Waveshare 5-inch DSI LCD reference:
  https://www.waveshare.com/wiki/5inch_DSI_LCD
- Waveshare 5-inch HDMI AMOLED reference:
  https://www.waveshare.com/wiki/5inch_HDMI_AMOLED
- E Ink Gallery 3 color e-paper reference:
  https://www.eink.com/brand/detail/Gallery_3
- Adafruit RA8875 display controller reference:
  https://learn.adafruit.com/ra8875-touch-display-driver-board
