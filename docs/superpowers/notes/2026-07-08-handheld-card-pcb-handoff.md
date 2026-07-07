# PuzzleScript Card — Custom PCB Handoff

Date: 2026-07-08. Audience: whoever executes the Track 2 custom PCB for the
PuzzleScript Card handheld. Read the spec first:
`docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`
(as amended 2026-07-08: 4.3-inch panel, 108 x 102 x 9 mm body, piezo
speaker, Menu off the down axis).

## What this board is

A single PCB (~104 x 98 mm) spanning a 9 mm-thick card. Everything mounts on
the FRONT side; the PCB back (routing, silkscreen, test pads) is a visible
product surface behind a translucent rear shell. Architecture and Z-stack are
in the spec ("Architecture: Single-Sided PCB" section). The device: ESP32-P4
handheld running the native PuzzleScript runtime, DSI display, D-pad + 3
buttons + Menu, USB-C (charge + mass storage), battery, piezo audio, LRA
haptic, RGB case LEDs, microSD (internal, service-only).

## Display (chosen part)

Waveshare **43H-800480 / 4.3-DSI-A, QLED variant, WITHOUT touch**.

- 800x480, 2-lane MIPI DSI, standard Raspberry Pi 15-pin 1.0 mm FFC.
- Powered entirely over the FPC (~1.2 W on 3V3 -> budget ~400 mA rail).
- Backlight driver is on the display assembly; software brightness control.
- Our side is therefore just: 15-pin FFC connector + two DSI data pairs +
  clock pair + 3V3. No backlight boost on our board.

**BLOCKING CHECK before layout:** Waveshare lists 112.4 x 75.1 x 7.33 mm for
this family's outline — wider than the 108 mm card and most of the 9 mm
Z-stack. Get the 2D drawing for the exact no-touch QLED variant, and measure
a physical unit. If the outline/thickness is real for our variant, the case
spec must grow first (update the spec + `tools/handheld_blockout` preset
before any board work). Active area (95.54 x 54.36) already matches the spec
reference.

## First design decision (open)

Chip-down vs module for the ESP32-P4:

- **Module/SoM that exposes DSI** (e.g., the module Waveshare's P4 boards are
  built on): recommended for the first spin. Costs height/area, removes BGA
  fanout and PSRAM risk. Must be the **32 MB in-package PSRAM** variant —
  16 MB is bring-up fallback only (parent spec).
- **Chip-down ESP32-P4NRW32** (BGA, 32 MB in-package): slimmest, hardest.
  Only if the first spin's height doesn't fit the 9 mm stack.

## Rest of the BOM (blocks)

- USB-C **mid-mount** receptacle (a 3.3 mm-tall topside part does not fit the
  stack): charge + USB 2.0 OTG for mass-storage mode.
- 1S charger + power path + fuel gauge (e.g., BQ2407x-class + MAX17048-class)
  for the ~32 x 30 x 4 mm, ~2.5 Wh pouch cell. Battery-safe shutdown per
  parent spec.
- 3V3 buck (display + system), sized for display ~400 mA + P4 bursts.
- Piezo disc (~O16-20 mm, in the shell layer, wired to pads) + drive circuit
  (transistor push-pull minimum; small boost/H-bridge if bench test says it
  is too quiet).
- LRA + driver (DRV2605-class) at the right edge of the band.
- Low-profile tact switches: 4x D-pad (under one-piece rocker), Action, Undo,
  Restart, Menu; edge switches for Power pill and Volume rocker (top/right
  edges per spec).
- Side-firing RGB LEDs into the translucent shell walls.
- microSD socket (internal), debug pads on PCB back (JTAG/UART/boot/reset).

## Placement source of truth

`tools/handheld_blockout/blockout.js` — the `card` preset holds every
front-face coordinate in mm (buttons, Menu, band, battery keep-out, grille,
piezo, USB-C X, power X, volume Y, FPC keep-out). Do not re-derive from the
spec by hand; export from the preset so PCB and case cannot drift. The
intended workflow (not yet built): a small exporter that emits board outline,
placement anchors, keep-outs, and mounting holes into KiCad via pcbnew
Python. `node tools/handheld_blockout/blockout_test.js` must stay green after
any preset change.

## Recommended toolchain

1. **Schematic as code**: SKiDL (Python -> KiCad netlist) or atopile, in a
   new `hardware/` directory. Headless design checks (every net driven,
   decoupling per rail) run like the blockout tests.
2. **KiCad 8+** for layout. Script the mechanical layer (outline, placement,
   keep-outs, mounting holes) from the blockout preset; hand-route the DSI
   pairs: 100 ohm differential, short, length-matched, 4-layer JLC stackup.
   Everything else is relaxed low-speed routing.
3. **Headless verification**: `kicad-cli` ERC/DRC in a test script; 3D export
   (STEP) to check against the case blockout.
4. **Output**: gerbers + JLCPCB assembly BOM/CPL; prefer JLC-stocked parts.

## Work order

1. Resolve the display mechanical check (blocking; may change the case).
2. Bench bring-up in parallel: wire the panel to the existing ESP32-P4 dev
   board (same 15-pin DSI as the current `firmware/esp32p4` targets),
   validate init, and **measure real backlight draw** — the ~2.5 h battery
   claim rests on the ~0.65 W display estimate.
3. Decide module vs chip-down.
4. Block diagram + pin budget doc; review against the spec.
5. Schematic-as-code + checks; review.
6. Layout: scripted mechanical pass, then interactive routing; DRC + STEP
   vs case check.
7. First spin order (JLC assembly), bring-up checklist, feed measured
   corrections back into the spec.

## Context and references

- Spec (canonical): `docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`
- Parent design (contracts, firmware plan, power discipline):
  `docs/superpowers/specs/2026-07-03-puzzlescript-handheld-design.md`
- Blockout tool + committed 1:1/legibility sheets:
  `tools/handheld_blockout/README.md`, `docs/superpowers/notes/2026-07-07-handheld-card-*.svg`
- Validation status: 1:1 sheet printed and approved on paper (2026-07-08).
  Foam mockup, playtest, and piezo bench test still pending — their findings
  may adjust placements before layout freezes.
- Panel pages: https://www.waveshare.com/43h-800480-ips.htm ,
  https://www.waveshare.com/wiki/43H-800480-IPS ,
  https://www.waveshare.com/4.3inch-dsi-qled.htm
