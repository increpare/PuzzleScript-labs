# Schematic-as-code (spin 1)

Connectivity is the **source of truth** for nets and block wiring. KiCad
symbols/footprints are drawn manually (or imported from `card.net`) on top of
this model.

## Files

| File | Role |
|------|------|
| `connectivity.json` | Every component ref, sheet, and net connection |
| `blocks.json` | Block inventory (BOM-level) |
| `validate_connectivity.js` | Validator + KiCad netlist exporter |
| `connectivity_test.js` | Regression tests |

## Commands

```bash
make handheld_card_schematic_tests   # connectivity.json rules
make handheld_card_kicad               # generate .kicad_sch + .kicad_pcb
node hardware/card/schematic/generate_kicad.js   # same without make
```

## KiCad workflow

1. Edit `connectivity.json` when the design changes.
2. Run `generate_kicad.js` — **do not hand-draw** from scratch.
3. Open `../card.kicad_pro` in KiCad 8 (see `../OPEN.md`).
4. Assign footprints → Update PCB → route (DSI first) → DRC.

## Why this instead of SKiDL or hand-drawn KiCad?

- **SKiDL** needs Python packages + symbol libraries on every machine.
- **Hand KiCad** doesn't scale in git; you shouldn't have to learn it to get spin 1.
- **JSON + generator** matches the blockout tool: tested in CI, KiCad is only the viewer/exporter for gerbers.

Symbols are **embedded** in each generated sheet — no library path setup.

## Decisions locked in connectivity

- **microSD:** SPI on GPIO46–49 (not 4-bit SDIO) for spin 1 simplicity.
- **I2C:** MAX17048 + DRV2605 on GPIO26/27.
- **DSI:** Module pins → FFC Pi pinout (see `../PIN_BUDGET.md`).
