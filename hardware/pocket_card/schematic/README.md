# Pocket Card controller schematic

This directory holds the canonical electrical model and deterministic KiCad
schematic generator for the routed Pocket Card controller. The schematic
documents the existing board; it does not by itself qualify the circuit for
manufacture. Read the [electrical audit](../ELECTRICAL_AUDIT.md) before using it
for a production decision.

## Sources, generated output, and tests

- `connectivity.json` is the canonical electrical contract: component identity,
  footprints and UUIDs, pin-to-net connections, no-connects, and the one allowed
  board-only mechanical-pad rule. Make electrical changes here.
- `validate_connectivity.js` enforces that contract. Running it directly checks
  the frozen canonical model and reports its component and net counts.
- `generate_kicad.js` deterministically writes
  `../case/out/pcb/pocket_card_controller.kicad_sch`.
- `connectivity_test.js` exercises the electrical contract,
  `generate_kicad_test.js` checks deterministic generation and KiCad/ERC/netlist
  behavior, and `board_parity_test.js` compares the model with the routed board.
- `../case/out/pcb/pocket_card_controller.kicad_pro` is the KiCad project to
  open for review.

Do not edit `pocket_card_controller.kicad_sch` by hand: it is generated and the
next regeneration replaces it. The drawing uses short wires with local labels
to join canonical net names. Its `PWR_FLAG` symbols identify +3V3 and GND as
externally supplied through the connectors; they are annotations, not BOM or
PCB components.

## Commands

From the repository root:

```
make pocket_card_schematic_tests   # test only; does not regenerate
make pocket_card_kicad             # validate, regenerate, then run all tests
```

The individual entry points are also useful:

```
node hardware/pocket_card/schematic/validate_connectivity.js
node hardware/pocket_card/schematic/generate_kicad.js
node hardware/pocket_card/schematic/connectivity_test.js
node hardware/pocket_card/schematic/generate_kicad_test.js
```

Direct KiCad netlist annotation may emit a known nonfatal warning because the
preserved legacy descriptive references, such as `SW_UP` and `J_I2C`, do not end
in numbers. These references are deliberately retained for exact schematic/PCB
reference reconciliation. Do not auto-annotate them unless coordinating a PCB
reference migration. Strict ERC, exact netlist checks, and board-parity tests
remain required gates.

`board_parity_test.js` reads the board in this checkout by default. In an
isolated worktree whose copy is intentionally stale, test against the
authoritative live routed board instead:

```
POCKET_CARD_BOARD=/absolute/path/to/hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb make pocket_card_schematic_tests
```

When board parity passes, generated model symbols and the existing routed-board
footprints share UUIDs. KiCad should therefore retain their links directly;
reference-based reconciliation in the GUI is a first-legacy-link fallback and
sanity check, not a routine regeneration step.

## Electrical-change and KiCad workflow

1. Edit `connectivity.json` for electrical changes.
2. Run `make pocket_card_kicad`.
3. Open `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pro`.
4. For the first legacy reconciliation only, choose **Update PCB from
   Schematic**, enable reference-based relinking, disable footprint replacement,
   and disable deletion of unmatched footprints.
5. Verify the preview contains no added, deleted, or moved footprints. Apply the
   update and save the project. If it shows any such change, cancel and resolve
   the model/board mismatch first.
6. On every later update, leave reference-based relinking **off**.
7. Run schematic ERC and PCB DRC before manufacture, and resolve or consciously
   disposition every result alongside the electrical audit.

`make pocket_card_kicad` only regenerates the schematic. The case
`build_pcb.sh` is different: it intentionally and destructively regenerates the
routed board output as well. Commit, stash, or copy reviewed PCB work before
running that script.
