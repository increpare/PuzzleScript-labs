# PuzzleScript Card - Spin-1 Simplification (thicker card, module compute, feature cuts)

Date: 2026-07-12. Status: approved by owner.

Supersedes for spin 1:

- `2026-07-09-handheld-card-chip-down-design.md` (whole spec: chip-down is
  reverted to the module)
- the 9 mm / 11.5 mm thickness contract in
  `2026-07-07-handheld-compact-card-design.md` and the Z-stack gates in
  `2026-07-08-handheld-card-reset-design.md`
- the haptic (DRV2605L + LRA), RGB case-glow LED, and microSD lines in the
  reset design, `hardware/card/` docs, `connectivity.json`, and the blockout

Unchanged and still binding:

- `2026-07-09-handheld-card-power-switch-design.md` (slide switch, no latch)
- front-face layout, controls, and ergonomics from the compact-card spec and
  the 2026-07-09 PCB review addendum (four TL3315-class dome tacts)
- display contract, firmware plan, library/product contract, save model, and
  Track 0 gates from `2026-07-03-puzzlescript-handheld-design.md`

## Why

The card design mutated five times in one week (compact card, two-sided,
reset, chip-down, power switch), and each fix made the next thing harder. The
root cause was the 9-11.5 mm Z-budget: it forced chip-down soldering of a
QFN-104 at 0.35 mm pitch (plus owning flash, crystal, and DC-DC bring-up), a
mid-mount USB-C with a PCB cutout, the thinnest 403048 pouch, and constant
tenth-of-a-millimeter stack accounting. The goals of this reset are:

1. a schematic a human can lay out (or hand to a contractor) without heroics
2. components that are all easy to procure, first try
3. an enclosure that is easy to design and print

The front-face ergonomics were never the problem and are not touched.

## Decisions

### 1. Thickness: ~14 mm uniform body

The card grows from 9-11.5 mm to a uniform ~14 mm slab, same 120 x 110 mm
face. Both Z-stacks close on paper with real margin:

Display zone:

| Layer | mm |
|-------|----|
| Lens / front shell | ~1.2 |
| WS24773 display module | 2.9 |
| Gap under display | ~0.2 |
| PCB | 1.6 |
| ESP32-P4 module on back | 3.3 |
| Clearance | ~0.3 |
| Rear shell | ~1.5 |
| **Total** | **~11.0 (closes at 14 with ~3 mm margin)** |

Band:

| Layer | mm |
|-------|----|
| Front shell | ~1.5 |
| Cap clearance/travel | ~0.5 |
| TL3315 dome tact | 1.2 |
| PCB | 1.6 |
| 603048 pouch | 6.0 |
| Swelling allowance | 0.5 |
| Rear shell | ~1.5 |
| **Total** | **~12.8 (closes at 14 with ~1.2 mm margin)** |

The exact body number (13.5 vs 14 vs 14.5) is tuned in the blockout once real
shell walls are drawn; the contract is "both stacks close with >= 1 mm margin
without recesses or mid-mount tricks".

### 2. Battery: 603048-class pouch

The thicker band upgrades the cell from 403048 (~600 mAh, ~2 h) to a
**603048-class 1S pouch, ~900 mAh / ~3.3 Wh, ~3+ h play** at the confirmed
~1 W budget. 503048 (~750 mAh) is the fallback if the band tightens; both are
the most commodity pouch sizes available. Protection circuit on the cell
required (it is the deep-discharge backstop per the power-switch spec).
Placement is unchanged from the reset spec: low and centered on the back,
tabs toward the power cluster.

### 3. Compute: Waveshare ESP32-P4-Module-32MB (chip-down reverted)

Spin 1 solders the **ESP32-P4-Module-32MB** as a castellated SMT part:

- No QFN-104 0.35 mm escape routing; castellations are hand-routable and
  hand-inspectable.
- No ownership of QSPI flash, 40 MHz crystal, DC-DC inductor/feedback, or
  strap network - the module carries them, already proven on Waveshare's own
  DSI boards.
- Bring-up risk drops to "does the board power the module" instead of "does
  the chip boot at all".
- The module's ESP32-C6 radio rides along unused (~$10 BOM delta vs bare
  chip, accepted). No antenna keep-out is honored; v1 has no wireless and
  promises no OTA (unchanged from the parent spec).
- The chip-down spec's GPIO map survives verbatim (P4 GPIO numbers are
  chip-level); the module castellation pin numbers return to the pin budget.
- Z-cost (3.3 mm) is absorbed by decision 1.

Storage: module QSPI flash holds firmware, curated corpus, user games, and
saves, exposed to the host via USB mass storage. **Gate: confirm the
module's flash size at order time** (16 MB class expected); the corpus is
`.txt` files, so tens of MB is comfortable.

### 4. Feature cuts: haptics, RGB glow, microSD deleted

Removed from spin 1 entirely (schematic, BOM, blockout, pin budget):

- **DRV2605L + LRA haptics** - a driver IC, a motor sourcing question, and a
  mounting question, for feedback that is a nicety. Spin-2 candidate.
- **RGB case-glow LEDs** - cheap parts but placement, diffusion, firmware,
  and battery cost. The translucent-shell identity survives passively (the
  PCB back and mascot relief are still visible). Spin-2 candidate.
- **microSD** - redundant once USB mass storage over module flash is the
  user-facing file path. Service access is debug pads + USB.

Kept: **MAX17048 fuel gauge** (one tiny I2C staple; honest battery UI is
worth one BOM line). The freed GPIOs return to the spare pool.

### 5. Schematic scope after cuts

Sheets: Power (BQ24075 + MAX17048 + TPS63070 + panel load switch + charge
LED, exactly as the power-switch spec drew it), Compute (module castellations
+ EN pull-up/TP + boot strap), Display (15-pin DSI FFC per
`DSI_PANEL_INTERFACE.md`), Controls (8 tacts + volume rocker + slide switch),
Audio (piezo transistor drive + DNP boost/H-bridge escape), USB-C, Debug
(UART/JTAG/boot test pads).

Three power ICs on the board (charger, gauge, buck-boost) plus a small
panel load switch and the module.
The only careful routes are the DSI pairs (module to FFC, first-routed) and
USB D+/D-. Everything else is GPIO-class. This is a board a competent
hobbyist lays out in a weekend or a contractor quotes without questions.

USB-C returns to a **standard top-mount mid-profile receptacle** (no
mid-mount, no PCB cutout) - the 14 mm stack absorbs a normal 3.2-3.3 mm
connector.

### 6. Procurement contract

Every BOM line must be purchasable from Waveshare, LCSC/JLC, or
Digikey-class distribution with no NRND parts and no exotic assembly:

| Part | Source | Note |
|------|--------|------|
| ESP32-P4-Module-32MB | Waveshare direct | confirm flash size at order |
| WS24773 4.3" 800x480 DSI, no-touch | Waveshare direct | envelope confirmed 2026-07-08 |
| TPS63070, BQ24075, MAX17048 | JLC/LCSC stocked staples | |
| TL3315-class dome tacts x8 | Digikey / LCSC equivalent | **gate: verify LCSC equivalent or accept hand-soldering 8 switches** |
| 603048 1S pouch w/ protection | commodity | verify real dimensions before layout |
| USB-C 16-pin top-mount, slide switch, volume rocker, piezo disc, FFC connector | commodity | |

### 7. Enclosure: printed two-shell

- Front shell: flat face, screen window, five button holes + Menu slot,
  piezo grille (5x5 sprite grid), edge slots for slide switch and rocker.
- Rear shell: flat back with pouch pocket, mascot relief inside, charge-LED
  light path, screw holes.
- Joining: heat-set inserts in the front shell, machine screws from the
  back. Mounting holes move inboard to ~(7, 7) per PCB-review flag #1.
- Shell bosses/standoffs under the D-pad diamond center and the
  Action/Undo/Restart cluster (resolves PCB-review flag #5, board flex).
- Translucent material (frosted/smoky), any FDM/SLS service or home printer;
  14 mm depth means normal 1.5 mm-class walls and normal bosses, no
  tenth-millimeter chasing.

## What This Unwinds From The Review Flags

From `2026-07-09-handheld-card-pcb-review.md`: flag #1 (corner holes) fixed
in the blockout; flags #2 and #3 (both Z-stacks) closed by thickness, module
Z absorbed; flag #4 (sleep/wake) already resolved by the power-switch spec;
flag #5 (board flex) resolved by shell bosses. The piezo DNP escape and
Restart hold-to-trigger firmware rule carry over unchanged.

## Implementation Order

1. Update `hardware/card/mechanical/layout.json` blockout: 14 mm body, 603048
   pouch zone, module keep-out (25 x 25), delete LRA/LED/microSD zones,
   corner holes to (7, 7), USB-C top-mount, support bosses.
2. Update `hardware/card/schematic/connectivity.json`: delete haptic, RGB
   LED, microSD blocks and nets; compute block becomes module castellations;
   regenerate KiCad (`make handheld_card_kicad`) and keep
   `make handheld_card_schematic_tests` green.
3. Update `hardware/card/` docs (`README.md`, `BLOCK_DIAGRAM.md`,
   `PIN_BUDGET.md`, `COMPONENT_SELECTION.md`, `FOOTPRINT_LOCK_MATRIX.md`,
   `bom_jlc.csv`) to the module + cuts baseline.
4. Re-export the 1:1 sheet; verify slide-switch slot position (corner-arc
   note) and button spacing candidates as before.

## Validation Gates (before ordering)

- Both Z-stacks close with >= 1 mm margin using the chosen real pouch and
  real shell walls drawn in CAD.
- Module flash size confirmed against corpus + saves budget.
- TL3315 LCSC-equivalent decision made (assembly vs hand-solder).
- Real 603048 datasheet dimensions vs blockout pouch zone.
- DSI pairs and USB routed and manually inspected; DRC/ERC clean with JLC
  rules.
- Piezo bench test against representative sfxr sounds (DNP escape already on
  board).
- 1:1 print sheet re-verified for the thicker edge (slide switch, rocker,
  USB-C opening heights).

## Open Questions

- Exact body thickness (13.5-14.5 mm) after CAD walls are drawn.
- Exact TL3315 equivalent part number for JLC assembly.
- Whether the volume rocker survives contact with the 14 mm edge or becomes
  two discrete buttons (blockout decision, not schematic).
