# Opening the PuzzleScript Card KiCad project

You do **not** need to draw the schematic yourself. The repo generates a full
KiCad project from `schematic/connectivity.json`.

## One-time setup

1. Download **KiCad 8** (free): https://www.kicad.org/download/
2. Install with defaults.

## Regenerate (after connectivity changes)

```bash
make handheld_card_kicad
```

## Open the project

1. Double-click `hardware/card/card.kicad_pro`  
   (or KiCad → File → Open Project → that file)
2. You should see a **root sheet** with nine blocks: Power, Compute, Display, …
3. Double-click any block to open that sheet — parts and net labels are already placed.

## What is already done

| Artifact | Contents |
|----------|----------|
| `card.kicad_sch` | Root hierarchical sheet |
| `schematic/sheets/*.kicad_sch` | Nine functional sheets with symbols + net labels + LCSC fields |
| `card.kicad_pcb` | Board outline, keep-outs, EasyEDA footprint names, pad nets |
| `schematic/jlc_catalog.json` | LCSC numbers + EasyEDA package names (merged at generation) |
| `bom_jlc.csv` | JLC BOM with LCSC per designator |
| Symbols | **Embedded** in each file — no external library setup required |

## What KiCad still needs (normal for any board)

These steps require the KiCad GUI once footprints are chosen:

1. **Review JLC mapping** — edit `schematic/jlc_catalog.json` (LCSC + EasyEDA footprint names), then `make handheld_card_kicad`.
2. **Assign any remaining footprints** — gated parts may still need manual library confirmation in EasyEDA.
3. **Update PCB from schematic** — transfers netlist to the board.
4. **Route traces** — especially DSI diff pairs (or order JLC with your gerbers + BOM).
5. **DRC / ERC** — catch missing connections.

For EasyEDA Pro, import the full handoff project from `hardware/card/easyeda_handoff/import/card.kicad_pro` (see that package's README). KiCad import gives placement and nets only — you must associate LCSC parts manually in Device Manager / Device Standardization using `bom_jlc.csv`.

For spin 1 you can also hand the **BOM + netlist** (`card.net`) to a layout contractor.

## If something looks wrong

Re-run tests:

```bash
make handheld_card_schematic_tests
make handheld_card_kicad
```

Report the sheet name; connectivity fixes go in `schematic/connectivity.json` then regenerate.
