# PuzzleScript Card - Power Switch Design (U7 latch removed)

Date: 2026-07-09. Status: approved by owner. Resolves the "U7 power latch /
SYSOFF" pre-route gate from
`docs/superpowers/notes/2026-07-08-handheld-card-pcb-handoff.md` and review
flag #4 in `docs/superpowers/notes/2026-07-09-handheld-card-pcb-review.md`.

## Decision Summary

Spin 1 uses a **physical slide switch** as the power control, not a momentary
pill plus a pushbutton latch IC. The U7 block (LTC2954/MAX16054 class,
previously "topology pending") is **deleted**. Hard off is the normal off.

- Top-edge slide switch gates the TPS63070 buck-boost `EN` pin
  (signal-level only; no battery current through the switch).
- OFF = true hard off. Battery drain is charger + gauge leakage (µA class).
- Charging works with the switch OFF: the BQ24075 sits upstream of the
  regulator, straight on VBUS/battery. A small LED on the charger's `CHG`
  status output (powered from VBUS) shows charge state without booting.
- The BQ24075 `SYSOFF` pin is tied inactive (to GND). No latch wiring.
- `SW_POWER`/GPIO8 is deleted from the GPIO map; GPIO8 returns to the spare
  LP-bank pool.
- Deep sleep is demoted from "the normal off" to an optional idle
  battery-saver while the switch is ON. D-pad-down and Action stay on LP
  GPIOs (GPIO9/GPIO10) so idle sleep can wake on input; nothing else depends
  on sleep anymore.

## Why

The owner-selected model is Game Boy / Arduboy style: instant-on feel from
cold boot, and saves that only need to be durable at level granularity.

- A tuned ESP32-P4 cold boot (~300-500 ms) plus DSI panel init plus
  on-device compile of the current game lands around 1-1.5 s to playing.
  That satisfies the parent spec's "instant-on feel" without resume-from-RAM.
- The parent spec (`2026-07-03-puzzlescript-handheld-design.md`) already
  mandates atomic temp-then-rename saves and explicitly allows the in-session
  undo stack to disappear on power-off. Hard off does not violate the save
  model; it leans on it.
- U7 was the least-designed block on the board and the classic spin-1 respin
  cause (press timing, EN sequencing, interrupt/kill handshake). A slide
  switch has no firmware dependency, no topology to get wrong, is visibly
  on/off, and is unkillable by a crashed firmware.

## Hardware Changes

| Item | Before | After |
|------|--------|-------|
| U7 pushbutton latch | LTC2954/MAX16054 class, topology TBD | Deleted |
| SW9 | EVP-AKE31A momentary pill, top edge | SPDT slide switch, top edge (C&K JS102000SAQN / ALPS SSSS8 class, right-angle SMD) |
| `SW_POWER` net (GPIO8) | Pill to GPIO8 + U7 PB | Deleted; GPIO8 spare (LP bank) |
| `SYSOFF` net | U2 SYSOFF driven by U7 | U2 SYSOFF tied to GND (normal operation) |
| `ESP_EN` | Driven by U7 EN_OUT | 10 kΩ pull-up to 3V3 (R5) + TP4 test pad only |
| New `PWR_EN` net | — | SW9 common → U4 (TPS63070) EN; ON position → SYS, OFF position → GND |
| Charge LED | — | D4 + R8 from VBUS_IN through BQ24075 `CHG` (open-drain, lights while charging, works with switch OFF) |
| U6 panel load switch | Kept | Kept (panel sequencing + idle sleep gating) |

Electrical notes:

- TPS63070 `EN` is a logic input referenced to VIN; driving it from SYS
  through the SPDT switch gives clean high/low with no pull resistors and no
  floating state.
- The slide switch carries no load current, so any low-profile SMD part
  works. Exact part chosen at footprint import; verify actuator height and
  knob/slot geometry against the top edge case section (same shear rule as
  the other edge switches: the shell slot guides the knob and takes end-stop
  force, solder joints only see actuation force).

## Mechanical Changes

- The top-edge power pill anchor becomes a slide-switch anchor
  (`SW_PWR_SLIDE`) at the same X (106 mm) in the blockout preset and
  mechanical export. The case gets a slide slot instead of a pill hole; knob
  travel and slot length come from the chosen part at footprint import.
- The pcb-review note about the pill anchor sitting on the corner arc
  (x=113 concern) still applies to the slide slot; verify on the next 1:1
  sheet.

## Firmware Contract

- **Saves:** persist completion state and settings at each level completion
  (plus settings changes), atomic temp-then-rename (already mandated by the
  parent spec). Resume after power-on = last game, start of the current
  level. Undo stack is session-only.
- **Boot:** cold-boot-to-playing is a tuned path (quiet bootloader, direct
  resume into last game, compile on launch). Target ~1-1.5 s; measure in
  validation.
- **Idle sleep (optional):** while switched ON and idle, firmware may dim,
  then deep-sleep with LP wake on D-pad-down/Action. This is a battery
  nicety, not a power-model dependency.
- **Low battery:** warn, save, then deep-sleep. The pouch protection circuit
  is the deep-discharge backstop. This reinterprets the parent spec's "clean
  shutdown at the critical threshold": with a slide switch, firmware cannot
  cut its own power; deep sleep plus cell protection fills that role.

## Parent Spec Deviation

`2026-07-03-puzzlescript-handheld-design.md` lists a "Power/Sleep" button in
the control set. For the Card, that control is now a slide switch, and sleep
is an automatic idle behavior rather than a button function. This spec
supersedes that line for the Card only.

## Validation

- Slide switch part chosen with real footprint; knob/slot verified on the
  1:1 print sheet with the other top-edge features.
- Charge LED visible through the shell (or a light pipe/hole is added to the
  case design).
- Measured: off-state battery drain (target µA class), cold-boot-to-playing
  time (target ~1-1.5 s), charge behavior with switch OFF.
- `make handheld_card_schematic_tests`, `make handheld_blockout_tests`, and
  KiCad regeneration pass after the connectivity/blockout updates.
