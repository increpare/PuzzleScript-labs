# PuzzleScript Hardware Handheld Design

Status: proposed, review-updated.
Date: 2026-07-03.

## Summary

Build a small-run physical PuzzleScript handheld: a dedicated, instant-on
PuzzleScript player with a custom PCB, a 3D-printable translucent case, a
5-inch 800x480 landscape color display, proper PuzzleScript controls, speaker,
haptics, and subtle case lighting.

The device is not a general retro console and not an on-device editor. It is a
comfortable physical way to browse and play a curated PuzzleScript corpus and
user-supplied `.txt` games. It targets the existing native C++ PuzzleScript
compiler/runtime directly on an ESP32-P4-class microcontroller, so it avoids a
Linux boot path and can wake into play quickly. That embedded runtime premise is
not yet proven; it must pass the Track 0 memory and rv32 portability gates below
before dev-kit or custom-PCB spending.

The display contract is strict: the whole level is visible at all times unless
the game declares `flickscreen` or `zoomscreen`. In those metadata modes the
declared viewport is fitted as large as possible. There is no player-controlled
camera or zoom mode in normal play.

## Goals

- Make a dedicated, tactile PuzzleScript handheld for a curated, permissioned
  corpus and user `.txt` games.
- Use a 32 MB PSRAM ESP32-P4 package as the reference MCU, after Track 0 proves
  runtime memory and 32-bit portability are plausible.
- Run the native C++ compiler/runtime on-device. V1 should compile from source;
  compiled caches are optional follow-up work unless measured on-device compile
  time proves they are needed.
- Use a 5-inch 800x480 landscape color display and fit each level or declared
  viewport with integer scaling.
- Provide PuzzleScript-native controls: D-pad, Action, Undo, Restart, Menu, and
  power/sleep.
- Provide mono speaker output, haptics, and subtle RGB case glow that can follow
  the game's background color.
- Support built-in curated games and user games added over USB-C mass storage.
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

The first reproducible sizing source is the native handheld report harness. On
the current `testdata` corpus, `make handheld_report` reports 470 compiling
games, 2,651 board levels, 2,461 text/title/message screens, and 0 degraded
board fits at 800x480. Earlier ad-hoc sizing found most levels compact
(roughly 11x9 median, 21x17 p90, 25x19 p95), but those statistics should be
regenerated from checked-in tooling whenever the corpus changes.

For no-camera levels, the renderer must show the entire board. On 800x480, the
large no-camera outliers still fit if the renderer is allowed to choose smaller
integer cell scales. Most no-camera levels fit comfortably at much larger
scales. This makes 800x480 landscape a good default: it favors the common corpus
shape while still preserving the PuzzleScript rule that the puzzle board should
not be cropped.

Rendering uses PuzzleScript's 5x5 sprite grid as the base unit for board play.
This deliberately preserves uniform sprite pixels by using tile sizes of 5, 10,
15, ... pixels. It may leave some screen resolution unused compared with
uneven-pixel scalers, but it keeps PuzzleScript art crisp and predictable on a
small fixed panel. For a board level or viewport of `W x H` tiles:

1. Compute available tile-cell size from `800 / W` and `480 / H`.
2. Choose the largest integer multiple of the 5-pixel sprite grid that fits.
3. Treat one native 5x5 sprite cell as the normal minimum for corpus play.
4. If a future/user level cannot fit even at 5 pixels per tile, show an honest
   "level too large for this display" screen rather than fractional
   downsampling or cropping.
5. Center the board and fill the unused border with the game's background color.

Text screens use the existing 34x13 text terminal constraints and should be
scaled independently from board sprites. They are reported and tested
separately from board rendering.

## Product Contract

The handheld boots into a library UI, not a desktop, shell, or raw file browser.
The library includes:

- built-in curated corpus games that have permission to ship
- user games copied onto storage as `.txt`
- recent games
- per-game status such as last played and completion where available

The first release can keep browsing simple, but it should feel curated. Search,
tags, favorites, and screenshots can come later if they prove useful.

Per-game status in the library is written in legend glyphs from the Simple
Block Pushing Game (`src/demo/sokoban_basic.txt`) rather than generic icons:
an unfinished game is `*` (crate), a completed game is `@` (crate on target),
and the selection cursor is `P` (player). Anyone who has written PuzzleScript
reads the library instantly; anyone who has not learns the legend by osmosis.
(Adopted 2026-07-07.)

The library owns cross-game browsing, recent games, and system settings. After a
game is selected, the handheld should preserve the game's own 34x13 title
screen and its "new game / continue" semantics rather than silently replacing
them with a library-only resume flow.

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

The Menu button should always offer a way back to the library. It may also offer
a "jump to reached level" list using per-game progress, so getting stuck on a
hard level does not make that physical game entry feel bricked. This is a
product affordance layered over saves, not a change to in-level PuzzleScript
rules.

## System Architecture

The reference architecture is a no-Linux ESP32-P4 handheld running the existing
native C++ PuzzleScript compiler/runtime. This is the preferred architecture,
but it remains contingent on proving memory use, 32-bit portability, and binary
size before hardware commitments.

Firmware is divided into these layers:

- boot, power, and recovery
- storage and USB mass-storage mode
- game library/index
- `.txt` compiler and optional compiled-cache experiment
- PuzzleScript runtime/session
- display renderer
- input scanner and button mapping
- audio, haptic, and LED feedback
- settings and save data

The ESP32-P4 high-performance cores run fast for compile, load, and redraw
bursts, then idle or underclock between moves. This matches PuzzleScript's
sokoban-style cadence: the panel may scan at 60 Hz, but gameplay does not need
a continuous 60 Hz render loop. Redraws happen after accepted input, animation,
messages, `again` ticks, win handling, and declared realtime ticks. Realtime
games are the worst case for this power model and must be measured separately.

The ESP32-P4 LP core should own low-power button scanning, wake-on-input, and
battery monitoring while the high-performance cores are asleep.

The design uses a three-track reference build:

0. A no-hardware Track 0 proves the native runtime on a constrained target:
   desktop peak-memory audit across the corpus, 32-bit/rv32 cross-build smoke
   test, corpus parity under emulation where practical, binary-size budget, and
   on-target compile-time estimates. Track 0 must either prove "whole curated
   corpus playable" or define a documented too-large-game failure mode.
1. A dev-kit handheld proves firmware, display, controls, storage, audio,
   haptics, LEDs, and power behavior.
2. A custom PCB and 3D-printable case reuse the proven logical interfaces.

The ESP32-P4 is fixed as the reference brain. If a specific display interface is
painful, the architecture can move between MIPI DSI, parallel RGB, or a
controller-backed panel without changing the PuzzleScript runtime model.

## Hardware Components

### MCU And Memory

Use an ESP32-P4 variant/package with 32 MB PSRAM. The extra memory is useful
for on-device compilation, frame buffers, library metadata, rendering scratch
space, and runtime load peaks. 16 MB should be treated as a bring-up fallback,
not the reference target.

The ESP32-P4 product family has a 400 MHz dual-core high-performance RISC-V
system, an LP core, MIPI DSI, parallel display support, USB 2.0 OTG, SDIO, 2D
DMA/PPA display helpers, and packaged PSRAM options. Those features align well
with this handheld: it wants rich display I/O and bursty compute, not a radio.

The memory budget must be tracked explicitly before PCB work. Initial budget
lines are: two 800x480 RGB565 framebuffers (about 1.5 MB), display/DMA scratch,
runtime/session heap, compiler/lowering peak, library index, save snapshot, file
I/O buffers, and safety headroom. Current desktop measurements suggest some
outlier games may exceed embedded PSRAM by a wide margin, so Track 0 must
measure and shrink that path or define a too-large-game outcome.

### Display

The reference display is a 5-inch 800x480 landscape color LCD/IPS-class panel
with software/PWM brightness control. A commodity Waveshare-class 5-inch DSI LCD
is a useful benchmark: it is 800x480, supports up to 60 Hz, and lists about 1.2 W
power consumption.

Panel preference order:

1. MIPI DSI panel with an existing ESP-IDF `esp_lcd` driver or public
   controller initialization sequence if ESP32-P4 tooling is stable.
2. Parallel RGB panel if it is easier to drive reliably.
3. Controller-backed panel if event-driven partial updates and simpler firmware
   matter more than raw interface neatness.

Avoid panels whose initialization path depends on Raspberry-Pi-specific bridge
boards unless a prototype proves the same sequence is available on ESP32-P4.

AMOLED is not the v1 baseline because PuzzleScript often shows static boards
and UI, which makes burn-in a real product risk. Color e-paper is not the v1
baseline because color refresh is still too slow for satisfying interactive
feedback, even if PuzzleScript does not need 60 gameplay frames per second.

### Storage

The device exposes one writable game volume over USB-C mass storage. The exact
physical storage can be validated in the prototype:

- internal microSD
- managed flash/eMMC-style storage
- large external flash with a wear-leveling filesystem internally and a
  FAT-compatible USB mass-storage partition only if practical

The logical contract is more important than the part choice: users can copy
`.txt` games onto the device, and firmware can store saves and library metadata
safely. The storage design must name its wear story: per-move autosaves should
not hammer a raw FAT directory, and remount after USB mass-storage mode should
fsck or quarantine corrupted host-written content.

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
the PuzzleScript sfxr-style sound events already present in the engine and
should reuse or port the native player's sfxr synthesis path. The handheld must
play both runtime-recorded audio events and cosmetic UI audio events.

Each unit's serial number is a valid sfxr seed, and the device's per-unit wake
chirp is that serial played through `generateFromSeed` (adopted 2026-07-07).
The seed format in `src/js/sfxr.js`: `seed % 100` (mod 10) selects the
generator family (0 pickupCoin, 1 laserShoot, 2 explosion, 3 powerUp,
4 hitHurt, 5 jump, 6 blipSelect, 7 pushSound, 8 random, 9 birdSound) and
`floor(seed / 100)` seeds the RNG. Serial assignment can therefore fix the
last two digits to a pleasant family (for example `...06` for blipSelect)
while the leading digits count units, giving every device a unique but
in-family voice. Typing a unit's serial into the web editor's SOUNDS section
reproduces its chirp. Constraints: `floor(serial / 100)` must stay below 2^31
(the RNG takes a 32-bit integer), and the chirp obeys the global feedback/
volume settings and never delays or gates the instant-on wake path.

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

Target roughly a 10 Wh pack (about 2,700 mAh at 3.7 V) for the first physical
design. That is a practical lower bound for about 6 hours at a 1.5-2.0 W play
budget while still fitting a 5-inch handheld envelope. Larger 12-16 Wh packs can
be evaluated if case thickness remains pleasant.

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

Turn-based games should idle between accepted inputs. `realtime_interval` games
do not have that luxury, so they are the battery and thermal worst case and need
their own validation run.

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
4. Scan the curated corpus index and user game directory.
5. Load the library UI.

Game launch flow:

1. Select game in library.
2. Compile `.txt` source on-device with the native C++ compiler.
3. On success, launch the game.
4. On failure, show a readable compiler error screen.

Compiled caches are a post-v1 optimization unless measured ESP32-P4 compile
times prove they are needed. If introduced, cache keys must include source hash,
compiler/runtime version, and cache format, and the cache format must not
increase the Track 0 memory peak.

Runtime flow:

1. Scan input, including held-button state and repeat timing.
2. Map D-pad/Action/Undo/Restart/Menu into PuzzleScript runtime commands.
3. Step runtime.
4. Emit rendering, audio, haptic, LED, save, and UI events.
5. Redraw only when state or visible effects change.
6. Idle or underclock between events.

Save data stores the current level snapshot, restart snapshot, completion state,
settings, and optionally a bounded number of undo snapshots. Do not rely on
move-history replay for resume; replay requires bit-exact RNG and simulation
stability across firmware versions. It is acceptable for the in-session undo
stack to disappear after power-off if that keeps saves robust.

USB-C has two normal user modes:

- charge while playing
- mass-storage mode for copying `.txt` games

Mass-storage mode pauses gameplay and flushes local writes before exposing the
volume to the host computer. Firmware update/recovery is separate from normal
game storage so bad game files cannot brick the device. On remount, firmware
should fsck or quarantine the exposed volume before rebuilding the library
index.

## PuzzleScript Semantics

The device must preserve existing PuzzleScript behavior.

- `flickscreen` and `zoomscreen` define the visible viewport. Fit that viewport,
  not the whole level.
- Without those metadata flags, fit the whole level.
- `realtime_interval` causes scheduled runtime ticks; the renderer still
  redraws only when those ticks change visible state or effects.
- `again_interval` controls repeated `again` ticks; the runtime loop must keep
  those ticks responsive without forcing a permanent 60 Hz gameplay loop.
- `key_repeat_interval` controls held-direction repeat. The input scanner must
  track both button edges and held state so movement feel can match the web
  player.
- `noaction` disables or hides Action affordances where appropriate.
- `norestart` makes Restart report a blocked command rather than silently doing
  nothing.
- `noundo` means Undo cannot recover moves, including a restart. The physical
  Restart button remains direct, but feedback should be clear.
- Title and message screens use the 34x13 PuzzleScript terminal. The game title
  screen remains part of the game experience even though the device has a
  separate library UI.
- Audio, haptic, and LED hooks should consume the runtime event stream. Do not
  invent a parallel effects system that can drift from PuzzleScript outcomes.

## Error Handling And Safety

Game failures are recoverable. If a user `.txt` game fails to compile, the
handheld shows filename, line/column if available, and the compiler diagnostic.
The library remains usable.

Compiled caches, if added after v1, are disposable. Missing, stale, corrupt, or
crashing caches are ignored and rebuilt from source.

Saves are versioned. If a save cannot be resumed, firmware launches the game
from the first level with a small notice instead of failing the whole game.

File writes use atomic temp-then-rename behavior for saves and library
metadata. Low battery first dims and warns, then autosaves and sleeps, then
performs clean shutdown at the critical threshold.

Global settings can disable or cap audio, haptics, and LEDs. Display brightness
has sensible defaults and a safe cap.

Recovery mode must work even if settings, library metadata, or user game files
are corrupt.

## Validation And Prototype Plan

### Track 0: No-Hardware Feasibility

Before buying Track 1 parts, run desk validation of the riskiest assumptions:

- per-game peak-memory audit across the corpus on desktop, with a hard embedded
  memory ceiling and outlier report
- diagnose and shrink the runtime-load path for outliers, or document a
  too-large-game failure mode
- cross-build the compiler/runtime subset for rv32 or another 32-bit target,
  excluding SDL, solver, generator, and desktop-only tools
- run corpus parity under emulation where practical
- measure runtime-only binary size and estimate flash budget
- measure or estimate ESP32-P4 compile time enough to decide whether compiled
  caches belong in v1

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

- every curated corpus game has permission to ship
- every curated corpus game compiles on the embedded compiler
- every curated game launches, or has a documented too-large/unsupported screen
- every initial level renders
- representative smoke inputs survive without runtime crashes
- every level generates a fit/scale report
- no no-camera level is cropped
- every `flickscreen`/`zoomscreen` game uses the declared viewport
- text screens remain readable
- save/restore works across power cycles
- held-key repeat matches the web player closely enough to feel natural
- corrupt source/save files fail gracefully

### Hardware Validation

Measure:

- cold boot to library
- wake from sleep to playable game
- compile time with no cache
- launch time, with cache only if caches survive the v1 scope gate
- input-to-redraw latency, targeting no more than 50 ms button-to-photon for
  turn-based play
- display brightness and readability
- battery runtime at several brightness levels for turn-based play
- battery runtime on a `realtime_interval` game
- sleep current
- charge behavior
- heat at sustained high brightness
- speaker loudness and audio latency
- haptic feel
- LED color matching and diffusion
- USB mass-storage reliability
- held-key repeat feel against the web player

Acceptance target: instant-on feel, practical 6-8 hour battery life for
turn-based play, curated corpus playable within documented limits, and no
supported level becoming cropped or unreadable.

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
