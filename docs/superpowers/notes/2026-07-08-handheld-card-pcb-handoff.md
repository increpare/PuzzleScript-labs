# PuzzleScript Card — Custom PCB Handoff

Date: 2026-07-08. Audience: whoever executes the Track 2 custom PCB for the
PuzzleScript Card handheld. Read the spec first:
`docs/superpowers/specs/2026-07-08-handheld-card-reset-design.md`
(reset baseline: 4.3-inch WS24773 no-touch panel, 120 x 110 mm body, stepped
~8 mm display zone / ~11.5 mm control and rear-pocket band, piezo audio, Menu
off the down axis).

**PCB reset (2026-07-08d):** the split-cell generated layout is retired for the
next PCB pass. Use one rear 1S pouch low/centered, put ESP32-P4 above it, keep
piezo for spin 1, and use `hardware/card/mechanical/layout.json` as the layout
starting point. See
`docs/superpowers/specs/2026-07-08-handheld-card-reset-design.md`.

## What this board is

A single two-sided PCB (~116 x 106 mm) inside the 120 x 110 mm card body. The
FRONT side is mechanically fixed by the display, controls, USB-C, FFC, edge
switches, piezo grille, and LRA feel. The BACK side is flexible except for mass
placement: one rear pouch sits low/centered, ESP32-P4 sits above it, and the
charger/gauge/buck-boost cluster stays near the pouch tabs. The device: ESP32-P4
handheld running the native PuzzleScript runtime, DSI display, D-pad + 3
buttons + Menu, USB-C (charge + mass storage), battery, piezo audio, LRA haptic,
RGB case LEDs, microSD (internal, service-only).

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

**Case:** body **120 x 110 mm**; stepped depth is about 8 mm at the display zone
and 11.5 mm through the control/rear-pocket band. Control band Y 72-105 clears
the 67 mm display module. Re-print 1:1 sheet before re-approving on paper.

Our side is still just: 15-pin FFC connector + two DSI data pairs +
clock pair + 3V3. No backlight boost on our board.

## First design decision (locked spin 1)

**ESP32-P4-Module-32MB** (Waveshare, 25 × 25 mm castellated) reflowed onto the card
PCB — not a NANO/dev-kit carrier. See `hardware/card/BLOCK_DIAGRAM.md`.

Chip-down ESP32-P4NRW32 remains a spin-2 slimming option if the Z-stack requires it.

## Rest of the BOM (blocks)

- USB-C **mid-mount** receptacle (a 3.3 mm-tall topside part does not fit the
  stack): charge + USB 2.0 OTG for mass-storage mode.
- 1S charger + power path + fuel gauge (e.g., BQ2407x-class + MAX17048-class)
  for one low, wide rear pouch cell. The blockout reserves a 58 x 30 mm rear
  pocket; pick a real stocked pouch before committing tabs, connector, or pocket
  depth. Battery-safe shutdown per parent spec.
- 3V3 buck-boost (display + system), sized for display ~400 mA + P4 bursts.
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

`tools/handheld_blockout/blockout.js` - the `card` preset holds every
front-face coordinate in mm (buttons, Menu, band, grille, piezo, USB-C X, power
X, volume Y, FPC keep-out) plus back-side keep-outs for the pouch, ESP module,
and PMIC cluster. Do not re-derive from the spec by hand; export from the preset
so PCB and case cannot drift. Run:

```bash
make handheld_pcb_export          # writes hardware/card/mechanical/layout.{json,svg}
make handheld_blockout_tests      # blockout + export regression
```

Implementation: `tools/handheld_blockout/pcb_layout.js`,
`export_pcb_layout.js`. KiCad pcbnew import (optional next step):
`hardware/scripts/apply_mechanical_to_kicad.py`. `blockout_test.js` must stay
green after any preset change.

## Recommended toolchain

1. **Mechanical handoff first**: start EasyEDA Pro or KiCad from
   `hardware/card/mechanical/layout.json` and `layout.svg`.
2. **Connectivity JSON**: keep nets and block wiring in
   `hardware/card/schematic/connectivity.json`, then regenerate the KiCad
   project when connectivity changes.
3. **KiCad/EasyEDA layout**: assign real JLC/LCSC footprints, place from the
   mechanical anchors, hand-route the DSI pairs first (100 ohm differential,
   short, length-matched, 4-layer JLC stackup). Everything else is relaxed
   low-speed routing.
4. **Headless verification**: `kicad-cli` ERC/DRC in a test script; 3D export
   (STEP) to check against the case blockout.
5. **Output**: gerbers + JLCPCB assembly BOM/CPL; prefer JLC-stocked parts.

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

- Reset spec (canonical for this pass):
  `docs/superpowers/specs/2026-07-08-handheld-card-reset-design.md`
- Earlier compact-card spec:
  `docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md`
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
