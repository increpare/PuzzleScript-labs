# PuzzleScript Card — hardware

Custom PCB for the PuzzleScript Card handheld.

## You don't draw schematics — we generate them

```bash
node hardware/card/schematic/generate_kicad.js
# or: make handheld_card_kicad
```

Then install [KiCad 8](https://www.kicad.org/download/) once and open
**`hardware/card/card.kicad_pro`**. See **[OPEN.md](OPEN.md)** for step-by-step.

| Generated | What it is |
|-----------|------------|
| `card.kicad_pro` / `card.kicad_sch` | Full hierarchical project (9 sheets) |
| `schematic/sheets/*.kicad_sch` | Power, compute, display, controls, … |
| `card.kicad_pcb` | Board outline + keep-outs + anchor markers |
| `schematic/connectivity.json` | Net source of truth (edit this, then regenerate) |

```bash
node hardware/card/schematic/connectivity_test.js
node hardware/card/schematic/generate_kicad_test.js
make handheld_pcb_export          # if make available
```

## Docs

- [COMPONENT_SELECTION.md](COMPONENT_SELECTION.md) - spin 1 part choices and sourcing gates
- [OPEN.md](OPEN.md) — install KiCad, open project (for humans)
- [BLOCK_DIAGRAM.md](BLOCK_DIAGRAM.md) — architecture
- [PIN_BUDGET.md](PIN_BUDGET.md) — GPIO / connector pinouts
- [schematic/README.md](schematic/README.md) — connectivity model

MCU: **ESP32-P4-Module-32MB** on the card PCB (not a dev kit).
