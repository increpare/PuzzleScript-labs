# PuzzleScript Card — Custom PCB Handoff

Date: 2026-07-08. Audience: whoever executes the Track 2 custom PCB for the
PuzzleScript Card handheld. Read the spec first:
`docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`
(as amended 2026-07-08b: 4.3-inch WS24773 no-touch panel, 120 x 110 x 9 mm body,
speaker, Menu off the down axis).

## What this board is

A single PCB (~116 x 106 mm) spanning a 9 mm-thick card. Everything mounts on
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

**Display mechanical (WS24773 no-touch):** Waveshare lists two outlines for the
43H-800480 family:

| Outline | Size (mm) | SKU |
|---------|-----------|-----|
| **Display module** (use this) | **105.42 × 67.07 × 2.9** | WS24773 no-touch |
| Touch stack | 112.40 × 75.10 × 5.0 | touch variants |

Active area **95.04 × 53.86 mm** → blockout lens **95 × 54**, centered in the
display module (X 12.5–107.5, Y 10–64). The earlier **112.4 × 75.1** figure
is the touch assembly; using it for the no-touch panel drew a false ~18 mm
"bezel" under the glass.

**Case:** body **120 × 110 × 9 mm**; control band Y 72–105 clears the 67 mm
display module. Re-print 1:1 sheet before re-approving on paper.

Our side is still just: 15-pin FFC connector + two DSI data pairs +
clock pair + 3V3. No backlight boost on our board.

## First design decision (locked spin 1)

**ESP32-P4-Module-32MB** (Waveshare, 25 × 25 mm castellated) reflowed onto the card
PCB — not a NANO/dev-kit carrier. See `hardware/card/BLOCK_DIAGRAM.md`.

Chip-down ESP32-P4NRW32 remains a spin-2 slimming option if 9 mm Z-stack requires it.

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
spec by hand; export from the preset so PCB and case cannot drift. Run:

```bash
make handheld_pcb_export          # writes hardware/card/mechanical/layout.{json,svg}
make handheld_blockout_tests      # blockout + export regression
```

Implementation: `tools/handheld_blockout/pcb_layout.js`,
`export_pcb_layout.js`. KiCad pcbnew import (optional next step):
`hardware/scripts/apply_mechanical_to_kicad.py`. `blockout_test.js` must stay
green after any preset change.

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

1. ~~Resolve the display mechanical check~~ — **done:** no-touch envelope
   **105.42 × 67.07 mm**; case **120 × 110 mm** in spec + blockout.
2. ~~Bench / datasheet assumptions~~ — **confirmed 2026-07-08 by owner:** WS24773
   no-touch outline, ~0.65 W display budget, hx8394-class DSI path, 15-pin FFC
   are accepted for schematic/layout. Optional physical backlight measure at
   first hardware still recommended.
3. ~~Decide module vs chip-down~~ — **done:** Waveshare **ESP32-P4-Module-32MB**
   for spin 1.
4. ~~Block diagram + pin budget~~ — **done:**
   `hardware/card/BLOCK_DIAGRAM.md`, `PIN_BUDGET.md`, `schematic/blocks.json`.
5. ~~Schematic connectivity~~ — **done:** `connectivity.json` + **KiCad generator**
   (`generate_kicad.js` → 9 sheets + PCB outline). User opens `card.kicad_pro`;
   assign footprints + route in KiCad (see `hardware/card/OPEN.md`).
6. Layout: route DSI, DRC, STEP vs case; JLC order.
7. First spin bring-up checklist.

## Context and references

- Spec (canonical): `docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`
- Parent design (contracts, firmware plan, power discipline):
  `docs/superpowers/specs/2026-07-03-puzzlescript-handheld-design.md`
- Blockout tool + committed 1:1/legibility sheets:
  `tools/handheld_blockout/README.md`, `docs/superpowers/notes/2026-07-07-handheld-card-*.svg`
- Validation status: **120 × 110 blockout + 1:1 sheet approved 2026-07-08**
  (owner). Datasheet power/mechanical assumptions confirmed same date. Foam
  mockup, playtest, and piezo bench test still pending.
- Panel pages: https://www.waveshare.com/43h-800480-ips.htm ,
  https://www.waveshare.com/wiki/43H-800480-IPS ,
  https://www.waveshare.com/4.3inch-dsi-qled.htm
