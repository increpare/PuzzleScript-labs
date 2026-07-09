# PuzzleScript Card - PCB Reset Design

Date: 2026-07-08. Status: proposed reset. Supersedes the split-cell
code-generated layout experiment from
`2026-07-08-handheld-card-two-sided-design.md` for the next PCB pass.

## Decision Summary

The current generated PCB attempt should be treated as a failed layout
experiment, not as a board to patch. It exposed useful constraints, but its
component choices, split-cell assumption, through-hole/connectors, and generated
placement are not a good starting point for an EasyEDA/KiCad layout.

Spin reset decisions:

- Keep the 120 x 110 mm card body and 116 x 106 mm PCB envelope.
- Keep the front/player side mechanically anchored: display, controls, USB-C,
  FFC, volume/power controls, and speaker grille.
- Use one large rear 1S pouch cell, low and centered in the grip/base region.
  Use a 4 mm-class 403048 pouch as the default unless a thicker rear-shell
  recess or thicker band is validated.
- Put the ESP32-P4 module above the pouch on the PCB back.
- Keep piezo audio for spin 1. A dynamic speaker is only a fallback if bench
  tests prove the piezo is not good enough. Include the DNP boost/H-bridge
  escape path on spin 1.
- Prefer SMT/JLC-assembly-friendly parts. Avoid through-hole connectors unless
  the mechanical or service constraint genuinely requires them.
- Use the blockout export, connectivity JSON, and KiCad/EasyEDA Pro for the
  next figuring-out loop.

## Goals

- Give the PCB layout a clean, manufacturable starting point.
- Preserve the approved front ergonomics and visual identity.
- Improve battery simplicity, weight distribution, and sourcing by replacing
  the two-small-cell assumption with one real pouch.
- Avoid needless rigidity in component placement: only player-facing and
  mass-critical components are fixed.
- Keep the first spin buildable by a normal PCB assembler with minimal manual
  soldering.

## Non-Goals

- Do not salvage the existing generated placement.
- Do not pursue a dynamic speaker unless piezo testing fails.
- Do not lock exact commodity part numbers in this reset spec; verify stocked
  parts before schematic/layout implementation.
- Do not optimize for the thinnest possible industrial design in this pass.

## Physical Architecture

One rigid 4-layer PCB remains the assumed structure. The front side is governed
by human-facing constraints. The back side carries the flexible electronics and
mass.

| Side | Fixed / Preferred Contents |
|------|----------------------------|
| Front/player side | Display outline and lens, D-pad, Action, Undo, Restart, Menu, top USB-C, DSI FFC, edge power/volume controls, piezo grille, shell support pads under the button clusters |
| Back/service side | One 403048-class pouch cell low and centered, ESP32-P4 module above pouch, charger/gauge/buck-boost/panel-switch/latch near pouch tabs, debug pads, service-only storage if it fits better there |

The battery should sit low and centered in the hand grip/base area. This keeps
the heaviest part where the device is held and avoids the split-cell wiring and
procurement problem. The ESP32-P4 module should move above the battery, closer
to the display FFC and USB-C routes than a bottom-mounted module would be.

## Battery

Use one rear 1S LiPo pouch, not two small pouches in parallel. The target shape
is a low, wide 4 mm-class 403048 pouch in the lower band/back pocket. Exact
dimensions must come from a real supplier part before layout, but the layout
strategy is:

- Center X around the device midpoint.
- Place low in the base/grip zone.
- Keep room for pouch swelling and a rear-shell pocket.
- Bring tabs toward the power cluster to keep high-current paths short.
- Use pads/tab soldering or a low-profile connector only after the real cell
  choice is known.

The old 1S2P split-cell plan is retired. It added balance, safety, wiring, and
layout complexity without solving a problem that one suitable pouch cannot
solve.

A 503048 or 603048-class pouch is not the default anymore: the 11.5 mm band
does not close with a 5-6 mm cell, tact stack, PCB, shell, and swelling
allowance unless the rear shell provides a measured recess or the industrial
design accepts a thicker band.

## Compute and Power Placement

The ESP32-P4 module belongs on the back above the pouch. Its exact X/Y can move
to satisfy antenna keep-out, DSI routing, USB routing, and pouch clearance. It
is not a player-facing component and should not be treated as mechanically
sacred.

Power components should cluster near the pouch tabs and the 3V3 distribution
path. They should use real JLC/EasyEDA footprints and standard SMT packages
where possible. The reset pass should avoid generic footprints that later fight
the assembly service.

Power/enable is a pre-layout gate, not a cleanup item. The BQ24075-class
charger is linear and should start with conservative charge current, roughly
0.5 C, until thermals are measured in the sealed card. Add a panel load switch
for `+3V3_PANEL`, and choose a real pushbutton latch/SYSOFF topology that owns
long-press latch-off and ESP_EN. The power pill, D-pad down, and Action should
land on LP GPIOs so deep-sleep wake is possible without treating the power
button as a full reset.

Routing priority:

1. DSI pairs from ESP32-P4 to the FFC.
2. USB D+/D- from ESP32-P4 to USB-C.
3. Battery/SYS/3V3 power path.
4. I2C, SD, debug, LEDs, switches, haptic, and piezo control.

## Audio

Use a piezo disc in the front shell under the 5x5 grille. The piezo has nearly
zero PCB area cost, fits the card thickness better than a dynamic driver, and
matches PuzzleScript's short blip/sfxr-style sound well enough for spin 1.
The PCB should include DNP boost/H-bridge footprints and a 0R return link near
the piezo pads so the bench result can be corrected by rework.

A dynamic speaker remains a documented fallback only. If bench testing shows
the piezo is too weak, revisit a small rectangular dynamic driver, likely around
15 x 11 mm, with an audio amp and a shortened/notched battery zone. That is an
explicit trade against battery volume and enclosure simplicity, not the default.

## Tooling Approach

The reset workflow should be:

1. Update the mechanical blockout first: one rear pouch, ESP above pouch,
   retired split-cell keep-outs, piezo retained and clear of controls.
2. Verify real components before schematic/layout: pouch, USB-C, FFC, charger,
   gauge, buck-boost, panel switch, power latch, switches, microSD, haptic, and
   piezo pads.
3. Keep nets in `hardware/card/schematic/connectivity.json` and regenerate the
   KiCad project when connectivity changes.
4. Use `hardware/card/mechanical/layout.json` / `layout.svg` as the placement
   contract for EasyEDA Pro or KiCad.
5. Place real stocked footprints, hand-route the constrained routes, and use the
   editor DRC/ERC as the fabrication authority.

## Validation

Before implementation is considered ready:

- Mechanical blockout shows no front control/display conflicts.
- Back blockout shows one pouch, ESP, power cluster, and support-pad
  clearances. Mounting holes must clear the rounded PCB corners; the current
  baseline uses about 7 mm body-frame centers, not the old 5 mm breakout-prone
  placement.
- Z-stack includes pouch thickness, swelling allowance, PCB, ESP module, front
  controls, piezo disc, and shell walls. The current gate is a 4 mm-class pouch
  in the 11.5 mm band and a 9.5 mm target for the display zone.
- Chosen parts have real footprints and assembly/source paths.
- U7 power-latch/SYSOFF topology and U6 panel load switch are chosen before
  final footprint import.
- Restart is hold-to-trigger in firmware or made materially harder to press
  accidentally with a stiffer/deeper mechanical treatment.
- KiCad/EasyEDA DRC passes with the intended manufacturer rules.
- DSI and USB routes are inspected manually, not treated as generic GPIO.
- Piezo is bench-tested against representative PuzzleScript sounds.

## Open Questions

- Exact pouch cell dimensions and supplier.
- Whether microSD should be front-accessible, rear-service-only, or omitted in
  favor of USB storage workflows for spin 1.
- Final power-path IC choice after checking assembly stock and thermal limits.
- Whether haptic motor placement should be tuned for feel after the battery
  mass is fixed.
