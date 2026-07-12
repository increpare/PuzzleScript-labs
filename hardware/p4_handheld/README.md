# PuzzleScript P4 Handheld — hardware (parallel track)

Custom single-board ESP32-P4 handheld. Spec:
`docs/superpowers/specs/2026-07-12-p4-handheld-circuit-design.md`.

Parallel exploratory track. The pocket card (`hardware/pocket_card/`,
ES3C28P/ESP32-S3) remains the plan of record. This board salvages circuit
blocks from the retired `hardware/card/` design but copies them — it never
modifies that directory.

## Schematic-as-code

```bash
node hardware/p4_handheld/schematic/generate_kicad.js
node hardware/p4_handheld/schematic/connectivity_test.js
node hardware/p4_handheld/schematic/generate_kicad_test.js
```

Net source of truth: `schematic/connectivity.json`. Edit it, run the tests,
then regenerate. Do not hand-edit generated `.kicad_*` files.

**Infra decision (2026-07-12):** the `hardware/card/schematic/` pipeline is
reused with its PCB-generation path deleted. Audit found geometry coupling
confined to `buildPcb()` + placement/routing helpers + `mechanical/layout.json`;
schematic, netlist, and BOM generation are purely connectivity-driven.
PCB generation returns in the layout phase.

## Docs

- `PANEL_RESEARCH.md` — DSI panel candidates, five checks, decision record
- `BLOCK_DIAGRAM.md` — architecture + power tree
- `PIN_BUDGET.md` — P4 pin map: DSI, SDMMC, USB, I2S, I2C, buttons, straps, spares
- `bom/` — generated BOM + availability record

Phase scope: net-level schematic + JLC-checked BOM only. No PCB layout,
no mechanical, no firmware in this phase.
