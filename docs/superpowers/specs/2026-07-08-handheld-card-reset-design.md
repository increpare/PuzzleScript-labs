# PuzzleScript Card - PCB Reset Design

Date: 2026-07-08. Status: proposed reset. Supersedes the split-cell
tscircuit layout experiment from
`2026-07-08-handheld-card-two-sided-design.md` for the next PCB pass.

## Decision Summary

The current tscircuit PCB should be treated as a failed layout experiment, not
as a board to patch. It exposed useful constraints, but its component choices,
split-cell assumption, through-hole/connectors, and autorouter-driven placement
are not a good starting point for an EasyEDA/KiCad layout.

Spin reset decisions:

- Keep the 120 x 110 mm card body and 116 x 106 mm PCB envelope.
- Keep the front/player side mechanically anchored: display, controls, USB-C,
  FFC, volume/power controls, and speaker grille.
- Use one large rear 1S pouch cell, low and centered in the grip/base region.
- Put the ESP32-P4 module above the pouch on the PCB back.
- Keep piezo audio for spin 1. A dynamic speaker is only a fallback if bench
  tests prove the piezo is not good enough.
- Prefer SMT/JLC-assembly-friendly parts. Avoid through-hole connectors unless
  the mechanical or service constraint genuinely requires them.
- Use tscircuit as a source-of-truth/preview aid only where it helps; do the
  real layout handoff in KiCad/EasyEDA Pro.

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

- Do not salvage the existing tscircuit autorouted placement.
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
| Front/player side | Display outline and lens, D-pad, Action, Undo, Restart, Menu, top USB-C, DSI FFC, edge power/volume controls, piezo grille |
| Back/service side | One large pouch cell low and centered, ESP32-P4 module above pouch, charger/gauge/buck near pouch tabs, debug pads, service-only storage if it fits better there |

The battery should sit low and centered in the hand grip/base area. This keeps
the heaviest part where the device is held and avoids the split-cell wiring and
procurement problem. The ESP32-P4 module should move above the battery, closer
to the display FFC and USB-C routes than a bottom-mounted module would be.

## Battery

Use one rear 1S LiPo pouch, not two small pouches in parallel. The target shape
is a low, wide pouch in the lower band/back pocket. Exact dimensions must come
from a real supplier part before layout, but the layout strategy is:

- Center X around the device midpoint.
- Place low in the base/grip zone.
- Keep room for pouch swelling and a rear-shell pocket.
- Bring tabs toward the power cluster to keep high-current paths short.
- Use pads/tab soldering or a low-profile connector only after the real cell
  choice is known.

The old 1S2P split-cell plan is retired. It added balance, safety, wiring, and
layout complexity without solving a problem that one suitable pouch cannot
solve.

## Compute and Power Placement

The ESP32-P4 module belongs on the back above the pouch. Its exact X/Y can move
to satisfy antenna keep-out, DSI routing, USB routing, and pouch clearance. It
is not a player-facing component and should not be treated as mechanically
sacred.

Power components should cluster near the pouch tabs and the 3V3 distribution
path. They should use real JLC/EasyEDA footprints and standard SMT packages
where possible. The reset pass should avoid generic footprints that later fight
the assembly service.

Routing priority:

1. DSI pairs from ESP32-P4 to the FFC.
2. USB D+/D- from ESP32-P4 to USB-C.
3. Battery/SYS/3V3 power path.
4. I2C, SD, debug, LEDs, switches, haptic, and piezo control.

## Audio

Use a piezo disc in the front shell under the 5x5 grille. The piezo has nearly
zero PCB area cost, fits the card thickness better than a dynamic driver, and
matches PuzzleScript's short blip/sfxr-style sound well enough for spin 1.

A dynamic speaker remains a documented fallback only. If bench testing shows
the piezo is too weak, revisit a small rectangular dynamic driver, likely around
15 x 11 mm, with an audio amp and a shortened/notched battery zone. That is an
explicit trade against battery volume and enclosure simplicity, not the default.

## Tooling Approach

The tscircuit/Bun approach is not doomed, but it is the wrong center of gravity
for the final layout. The reset workflow should be:

1. Update the mechanical blockout first: one rear pouch, ESP above pouch,
   retired split-cell keep-outs, piezo retained.
2. Verify real components before schematic/layout: pouch, USB-C, FFC, charger,
   gauge, buck, switches, microSD, haptic, and piezo pads.
3. Generate or maintain a clean schematic/netlist with production-friendly
   footprints.
4. Export/import to KiCad or EasyEDA Pro as the human layout starting point.
5. Hand-route the constrained routes and use the editor DRC as the fabrication
   authority.

tscircuit can still be useful for netlist checks, previews, and BOM intent, but
the autorouter should not be trusted to solve this dense handheld layout.

## Validation

Before implementation is considered ready:

- Mechanical blockout shows no front control/display conflicts.
- Back blockout shows one pouch, ESP, and power cluster clearances.
- Z-stack includes pouch thickness, swelling allowance, PCB, ESP module, front
  controls, piezo disc, and shell walls.
- Chosen parts have real footprints and assembly/source paths.
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

