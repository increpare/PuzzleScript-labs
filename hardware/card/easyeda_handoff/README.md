# EasyEDA Handoff - PuzzleScript Card

This package is for manual PCB routing in EasyEDA Pro. It ships a full KiCad project
with JLC/LCSC part numbers, EasyEDA footprint names, schematic sheets, placement anchors,
and an unrouted PCB.

**Important:** EasyEDA Pro's KiCad importer brings in placement, nets, and custom fields,
but it does **not** auto-link parts to EasyEDA's LCSC library. That linking only happens
when you place parts from EasyEDA's own library panel. The `LCSC` / `MPN` fields here are
for procurement (JLCPCB BOM export from KiCad) and as a lookup table while you associate
parts in EasyEDA — not for automatic import-time matching.

## Start Here (EasyEDA Pro)

1. **Import the full KiCad project**: `import/card.kicad_pro` (File → Import → KiCad).
2. **Associate LCSC parts** (required, not automatic):
   - Open **Left panel → Device Standardization** for flagged mismatches.
   - Or **Tools → Device Manager**: select a component, choose **Assign LCSC Part**,
     and search by the `LCSC` column from `import/bom_jlc.csv` (e.g. `C2765186`), not
     by the generic KiCad value string.
   - There are **29 unique LCSC parts** for 48 designators — group identical values in
     Device Manager so each LCSC number only needs to be assigned once per part type.
3. Cross-check `import/bom_jlc.csv` and `import/schematic/jlc_catalog.json`.
4. Keep `mechanical/layout.svg` open while verifying footprint placement.
5. Route manually in this order: DSI, USB, power, storage, then low-speed controls/audio/haptics/LEDs.

### Skip EasyEDA association entirely?

If the goal is JLCPCB assembly rather than EasyEDA routing, you can stay in KiCad:
pull real symbols/footprints with [easyeda2kicad](https://github.com/uPesy/easyeda2kicad.py)
using the LCSC numbers in `bom_jlc.csv`, route in KiCad, and order with the JLCPCB
Fabrication Toolkit. The LCSC fields are already in the right shape for that path.

## JLC Catalog Coverage

- Locked parts: 27
- Candidate parts (gate still open): 20
- Open / off-board: 1

Re-check LCSC stock and assembly tier immediately before ordering.

## Current Generated Route Reference

| Family | Status | Generated routes | Airwires | Gate |
|---|---:|---:|---:|---|
| Low-speed | routed-first-pass | 37 | 0 |  |
| DSI | routed-assumption-gated | 6 | 0 | GATE-DSI-FFC-CONTACT |
| USB | routed-first-pass-review | 4 | 0 |  |
| Power | routed-first-pass-review | 22 | 0 |  |
| Storage | routed-first-pass-gated | 4 | 0 | GATE-MICROSD-FOOTPRINT |

The generated reference currently reports 73 routed traces and 0 airwires.
Treat those traces as connectivity proof only, not a manufacturable layout.

## Key Gates

- `GATE-DSI-FFC-CONTACT`: do not finalize DSI routing until the real FFC contact side, latch side, cable exit, and pin 1 are confirmed.
- `GATE-MICROSD-FOOTPRINT`: pick the actual internal service socket footprint before final SD routing.
- `GATE-POWER-SLIDE-SLOT`: check switch travel/slot and OFF/ON orientation in the shell.
- `GATE-BATTERY-SAMPLE`: measure protected 403048-class cells before final battery connector placement.
- `GATE-ESP32-P4-REF-CAPTURE`: verify crystal load caps, flash voltage domain, and P4 DC-DC inductor against Espressif reference.

## Contents

- `import/`: KiCad project, JLC BOM, catalog JSON, schematic sheets, netlist.
- `mechanical/`: layout JSON/SVG exported from the blockout tool.
- `reference/`: generated preview HTML/SVG/JSON and routed-reference KiCad PCB.
- `docs/`: gate, DSI, component, and pin-budget notes.

## Fabrication Warning

Do not order from this package without human routing review, DRC/ERC, footprint verification,
JLC/LCSC availability review, and a mechanical check against the case.
