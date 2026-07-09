# EasyEDA Handoff - PuzzleScript Card

This package is for manual PCB routing in EasyEDA Pro or another EDA editor.
It keeps the current outline, footprint placeholders, pad nets, schematic sheets,
mechanical references, and routing notes, but the import board is intentionally
unrouted so the generated trace spaghetti is not treated as layout work.

## Start Here

1. Import `import/card_easyeda_unrouted.kicad_pcb` into EasyEDA Pro.
2. Use `import/card.net` and `import/schematic/connectivity.json` as net references if needed.
3. Keep `mechanical/layout.svg` open while placing final footprints.
4. Use `reference/board_preview.html` only as a visual progress/reference artifact.
5. Route manually in this order: DSI, USB, power, storage, then low-speed controls/audio/haptics/LEDs.

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

## Contents

- `import/`: clean KiCad board/project/schematic/netlist files for import.
- `mechanical/`: layout JSON/SVG exported from the blockout tool.
- `reference/`: generated preview HTML/SVG/JSON and routed-reference KiCad PCB.
- `docs/`: gate, DSI, component, and pin-budget notes.

## Fabrication Warning

Do not order from this package without human routing review, DRC/ERC, footprint verification,
JLC/LCSC availability review, and a mechanical check against the case.
