# PuzzleScript Card - Chip-Down Compute Design (module retired, no WiFi)

Date: 2026-07-09. Status: approved by owner. Supersedes the "module for
spin 1" decision in `2026-07-08-handheld-card-reset-design.md` and the
handoff work-order item 3. Closes review flag #3 (display-zone Z-stack) from
`docs/superpowers/notes/2026-07-09-handheld-card-pcb-review.md`.

## Decision Summary

Spin 1 solders the **ESP32-P4NRW32X** chip directly onto the card PCB
instead of reflowing the Waveshare ESP32-P4-Module-32MB. The card has **no
WiFi/Bluetooth**: the module's ESP32-C6 radio is not replaced. Owner
confirmed WiFi is not needed for this board generation (the parent spec
already treats v1 wireless as optional and warns against promising OTA).

Why the module lost its two advantages:

1. **Z-stack.** The module is 25 × 25 × **3.3 mm** (official spec). Under
   the display that makes the 9.5 mm display-zone stack ~10.5 mm — it does
   not close. The bare chip is 0.9 mm; the display zone closes with ~1.3 mm
   of margin (tables below).
2. **Pre-certified radio.** Only valuable if the radio is used. v1 ships
   without wireless, so the C6, shield, and antenna would be dead weight —
   and without any radio there is no RF certification concern at all.

Bring-up risk moves onto our board and is mitigated by copying Espressif's
reference design (their own dev boards are chip-down with public
schematics), plus the already-planned UART/JTAG/boot test pads.

## Part Facts (verified 2026-07-09)

- **ESP32-P4NRW32X**: QFN-104, 10 × 10 mm, 0.35 mm pad pitch, 0.9 mm max
  height, 32 MB PSRAM stacked in-package, −40…85 °C, chip revision v3.x.
- The non-X `ESP32-P4NRW32` is EOL/NRND (marked EOL Feb 2026). **The BOM
  must spec the X revision.** LCSC stocks the part (C22387510 lists the
  NRW32; confirm the X-revision part number and stock at order time), JLCPCB
  offers it for standard assembly (MSL 3, ~$4.6–5.8/unit).
- QFN, not BGA: perimeter pads + thermal pad, routable on JLC's standard
  4-layer stackup without via-in-pad.
- Support parts we now own (the module previously carried these):
  - QSPI NOR flash, 16/32 MB class, external to the P4 package.
    Voltage/part must match the Espressif reference design (VDD_SPI domain)
    — pick at schematic capture.
  - 40 MHz crystal + load caps.
  - Internal DC-DC support: inductor + feedback per the reference design,
    plus the decoupling network.
  - Strapping/EN network (EN pull-up already exists as R5/TP4).

## Z-Stack Closure (both stacks, on paper)

Band (11.5 mm budget) — closed by the TL3315 + 403048 decisions:

| Layer | mm |
|-------|----|
| Front shell | ~1.2 |
| Cap clearance/travel | ~0.5 |
| TL3315 dome tact | 1.2 |
| PCB | 1.6 |
| 403048 pouch | 4.0 |
| Swelling allowance | 0.5 |
| Rear shell | ~1.2 |
| **Total** | **~10.2 → closes, ~1.3 mm margin** |

The margin exists only with the 4 mm cell; a 503048 consumes nearly all of
it and a 603048 still requires the rear-shell recess.

Display zone (9.5 mm budget) — closes only with chip-down:

| Layer | Module (rejected) | Chip-down |
|-------|------------------|-----------|
| Lens / front shell | ~1.0 | ~1.0 |
| WS24773 display module | 2.9 | 2.9 |
| Gap under display | ~0.2 | ~0.2 |
| PCB | 1.6 | 1.6 |
| Compute on back | **3.3** | **~1.0** (chip 0.9 / flash ~0.75) |
| Clearance | ~0.3 | ~0.3 |
| Rear shell | ~1.2 | ~1.2 |
| **Total** | **~10.5 (fails)** | **~8.2 (closes, ~1.3 mm margin)** |

Still open in this stack: the **mid-mount USB-C protrusion** (~1.2 mm above
board) overlapping the display region — verify against the exact connector
drawing before routing (unchanged pre-route gate).

## Layout Consequences

- The back-side compute keep-out shrinks from 25 × 25 to a **20 × 20 mm
  chip-down cluster** (P4 + flash + crystal + DC-DC inductor + decoupling),
  same centroid as before (under the display, near the FFC), so DSI and USB
  runs stay short.
- No antenna keep-out anywhere; the module's C6/antenna rows in the pin
  budget are void.
- Escape routing a 0.35 mm-pitch QFN is careful work but only ~40 signals
  are used; DSI pairs remain the first-routed nets.
- BOM cost drops (~$5 chip + ~$1 support parts vs ~$15 module).

## What Does NOT Change

- All GPIO assignments (P4 GPIO numbers are chip-level; the map in
  `PIN_BUDGET.md` is unchanged — only the obsolete module castellation pin
  numbers are dropped).
- Power architecture (slide switch → TPS63070 EN, BQ24075, MAX17048, U6
  panel switch, charge LED) per
  `2026-07-09-handheld-card-power-switch-design.md`.
- Display, controls, audio, haptics, storage, debug-pad plans.

## Validation

- Schematic capture copies the Espressif chip-down reference design
  (crystal, flash domain, DC-DC inductor/feedback, straps) part-for-part;
  deviations must be justified in review.
- Confirm X-revision part number, JLC stock, and assembly tier at footprint
  import.
- ERC/DRC on the QFN escape; DSI/USB inspected manually as before.
- Bring-up checklist gains: crystal oscillation, flash boot, PSRAM sizing,
  internal DC-DC rails — before any peripheral work.

## Spin-2 Note

If wireless is ever wanted, it is a new board spin regardless (antenna,
placement, certification). Nothing in this decision forecloses that beyond
what the module plan already did — the module's antenna was going to be
buried between ground pours and a battery anyway.
