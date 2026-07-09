# PuzzleScript Card — PCB Design Review

Date: 2026-07-09. Scope: spin-1 part selection, layout/blockout, and ergonomics
review of the reset-baseline card PCB.

Inputs reviewed:

- `docs/superpowers/notes/2026-07-08-handheld-card-pcb-handoff.md`
- `docs/superpowers/specs/2026-07-08-handheld-card-reset-design.md`
- `hardware/card/BLOCK_DIAGRAM.md`, `PIN_BUDGET.md`, `COMPONENT_SELECTION.md`
- `hardware/card/mechanical/layout.json`
- `hardware/card/COMPONENTS_REPORT.md` (controls research)

## Verdict

The reset direction is sound and the part choices are mostly the right
"boring, JLC-assemblable" picks — the buck-boost correction, the one-pouch
decision, and piezo-for-sfxr are all good calls. Two areas need work before
layout: **the Z-stack arithmetic doesn't obviously close** (in both the 8 mm
display zone and the 11.5 mm band), and **the power/enable block is the
least-designed part of the board** while being the hardest to patch after
spin 1. Plus one concrete geometry bug: all four mounting holes nearly break
out of the rounded PCB corners.

## Parts choice — mostly agree

- **TPS63070 buck-boost** replacing the TPS62135 buck was the right
  correction — a 1S pouch spends real capacity below 3.3 V + dropout, and a
  plain buck would silently cost the bottom third of the discharge curve.
  TPS63070 has the headroom for panel + P4 bursts. Treat its inductor loop as
  seriously as the DSI pairs; it is the noisiest thing on the board and the
  PMIC cluster at (76, 57) sits under the display zone.
- **BQ24075 + MAX17048** is a well-trodden pairing. Two caveats:
  1. BQ24075 is a *linear* charger — charging at ~1 A from 5 V into a
     mid-charge cell dissipates close to a watt inside a sealed 9–11 mm card
     with the pouch right there; set ISET conservatively (~0.5 C).
  2. It has SYSOFF but no true ship mode and no I2C — if the parent spec's
     "battery-safe shutdown" means a real latch-off, an external push-button
     controller or PMOS latch is needed, which is exactly the block currently
     marked "draft" in `PIN_BUDGET.md`. Design that schematic sub-sheet
     *first*, not last — it is the classic spin-1 respin cause.
- **ESP32-P4-Module-32MB** for spin 1 over chip-down: right call. DSI over
  castellations is proven on Waveshare's own boards. The C6 antenna will be
  badly compromised sandwiched between ground pours, battery, and display —
  fine since v1 doesn't need WiFi, but don't promise OTA later without
  checking.
- **KMR2 tacts under guided plungers** for spin 1 instead of a membrane
  stack: pragmatic, and one point in its favor the docs don't mention —
  PuzzleScript is strictly 4-way, so the classic tact-D-pad weakness (mushy
  diagonals on 0.2 mm travel) doesn't apply at all. The COMPONENTS_REPORT's
  membrane recommendation is aimed at 8-way Nintendo feel; deferring it is
  correct.
- **EVP-AKE31A** for edge controls, **DRV2605L in VSSOP**, mid-mount USB-C,
  test pads instead of a debug connector — all sensible.
- **Piezo:** the plan says "transistor push-pull first, boost/H-bridge if too
  quiet." It *will* be too quiet — a bare disc swung 3.3 Vpp is barely
  audible through a shell. Since the fallback is already known, put the
  H-bridge/boost footprints on spin 1 as DNP. Zero cost, and it converts
  "piezo bench test fails" from a respin into a rework.

## Flags, ranked

### 1. Mounting holes vs. corner radius (concrete bug)

PCB corner radius is 7 mm (arc center (9, 9)), holes are Ø2.2 at (5, 5) etc.
Distance from hole center to arc center is 5.66 mm, so the hole edge comes
within **0.24 mm of the board edge** — that fails any DRC and will break out
in fab. Same at all four corners by symmetry. Move holes inboard to ~(7, 7)
or shrink the corner radius. This lives in
`hardware/card/mechanical/layout.json`, so fix it in the blockout preset, not
downstream.

### 2. Z-stack in the band

`COMPONENT_SELECTION.md` targets a 503048/603048 pouch — 5–6 mm thick. Rough
band stack:

| Layer | mm |
|-------|----|
| Front shell | ~1.2 |
| Cap travel | ~0.5 |
| KMR2 tact | 1.9 |
| PCB | 1.6 |
| Pouch | 5–6 |
| Swelling allowance | 0.5 |
| Rear shell | ~1.2 |
| **Total** | **~11.9–12.9** |

Against an 11.5 mm budget it doesn't close even with the thinner cell.
Options: accept a 4 mm-class pouch (e.g. 403048, ~600 mAh → roughly 2 h at
the ~1 W confirmed budget — decide if that's acceptable), thicken the band,
or recess the pouch into the rear shell beyond the PCB plane. The reset spec
lists Z-stack as a validation gate; run that arithmetic *now*, because it
feeds directly into the cell choice deliberately left open.

### 3. Z-stack and keep-out conflicts in the display zone

The ESP module (47.5, 43, 25×25) and PMIC cluster sit entirely under the
display module's footprint, in the **8 mm** zone: display 2.9 + PCB 1.6 +
module ~2.4 + rear shell ~1 + lens ≈ 9 mm before any air gap. Related
contradictions to resolve:

- The display keepout note says "optional PCB window" — you can't have a
  window and the ESP there.
- The ESP rectangle sits *inside* `fpc_top_keepout` ("no tall parts under
  display FPC fold", x 47–72, y 0–72). If that keepout is front-side-only
  it's fine, but the JSON's `layer` semantics don't say so — make front/back
  explicit before someone places to it.
- The mid-mount USB-C at (25, 2): its body reaches ~y 10, overlapping the
  display module region from y 3.5, and mid-mounts protrude ~1.2 mm above the
  board where the display wants to sit.

### 4. Sleep/wake wiring contradicts the power model

On the P4, only the LP GPIO bank (roughly GPIO0–15) wakes from deep sleep,
but `SW_POWER` is on GPIO38 and the wake buttons are on GPIO28–34.
`PIN_BUDGET.md` acknowledges this in a side note, but as drawn, "short press
= wake from deep sleep" doesn't work — the pill would have to yank ESP_EN,
which is a full reset, losing state. Move the power pill (and D-pad-down +
Action) to LP GPIOs now; it changes the GPIO map, which ripples into
`connectivity.json` and `board_card_pins.hpp`, so it's cheap today and
annoying later.

Same theme: `+3V3_PANEL` hangs directly off the buck-boost with no load
switch, so the panel leaks in sleep regardless of what the P4 does. Add a
panel-rail load switch or sleep current will be dominated by the display.

### 5. Board flex under the buttons

116×106 mm of FR4 with only four corner holes, and 0.2 mm-travel tacts being
mashed in the middle of the unsupported span — presses will flex the board
more than the switch travel, feeling mushy and stressing solder joints. Add
shell bosses or support ribs under the D-pad and action cluster (they don't
all need screws; standoff pads in the blockout are enough).

## Ergonomics

The front layout is fundamentally good: D-pad center 22 mm from the left edge
matches Game Boy-class spacing, Action at 14 mm with 10 mm Undo/Restart gives
a clear size hierarchy, Menu recessed and angled off the down axis is a nice
touch, and battery low-center puts the mass in the grip. Piezo grille dead
center stays clear of both palms. Charging from the top edge doesn't fight
the grip. Three things to look at:

- **Restart at (92, 102) is a thumb-slip away from Action at (89, 83)** —
  directly below it, same column. Undo softens the cost, but make Restart
  hold-to-trigger in firmware and consider a slightly stiffer switch or
  deeper recess for it.
- Restart's pad edge is ~3 mm from the bottom of the body — verify the shell
  can form a cap ring and wall in 3 mm.
- **The power pill anchor (x=113) sits on the corner arc** — body radius 9
  means the top edge stops being straight at x=111. Either it's intentionally
  a corner control (verify on the 1:1 sheet) or nudge it left.

## Minor

- Three RGB LEDs driven by shared R/G/B lines means all-same-color; a single
  addressable side-view LED chain would free two GPIOs and allow per-corner
  color — only worth it if the shell lighting is meant to be expressive.
- If USB mass storage exposes the microSD, SPI-mode SD (~1–2 MB/s) will make
  the card feel slow over USB; 4-bit SDIO is kept as an option — decide based
  on what MSC actually exposes (internal flash vs. card).
- With Rd-only CC you can still sense source capability by ADC-reading the CC
  voltage if you ever want >500 mA charging — worth a divider footprint, DNP.

## Process

The process side — blockout as single source of truth, connectivity JSON
regenerating KiCad, DSI-first routing order, DNP-friendly conservatism — is
genuinely better discipline than most spin-1 hobby boards. Fix the corner
holes, close the two Z-stacks on paper, and design the enable-logic sub-sheet
before footprint import, and this is in good shape to route.
