# Pocket Card controller schematic

This directory holds the canonical electrical model and deterministic KiCad
schematic generator for the routed Pocket Card controller. The schematic
documents the existing board; it does not by itself qualify the circuit for
manufacture. Read the [electrical audit](../ELECTRICAL_AUDIT.md) before using it
for a production decision.

## Sources, generated output, and tests

- `connectivity.json` is the canonical electrical contract: component identity,
  footprints and schematic symbol UUIDs, pin-to-net connections, no-connects,
  and the one allowed board-only mechanical-pad rule. Make electrical changes
  here.
- `validate_connectivity.js` enforces that contract. Running it directly checks
  the frozen canonical model and reports its component and net counts.
- `generate_kicad.js` deterministically writes
  `../case/out/pcb/pocket_card_controller.kicad_sch` and the project-local
  `../case/out/pcb/fp-lib-table`.
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

The generated references are already fully annotated (`SW_UP1`, `SW_PWR1`,
`J_I2C1`, and `J_BAT_OUT1`); do not run **Annotate Schematic**. The generator
also writes the project-local `fp-lib-table` containing the four required
KiCad 10 standard libraries: `Button_Switch_SMD`, `Connector_JST`,
`MountingHole`, and `Package_SO`. This makes footprint lookup independent of
the user's global footprint-library table; do not repair or replace global
KiCad configuration for this project.

`board_parity_test.js` reads the board in this checkout by default. In an
isolated worktree whose copy is intentionally stale, test against the
authoritative live routed board instead:

```
POCKET_CARD_BOARD=/absolute/path/to/hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb make pocket_card_schematic_tests
```

When board parity passes, every routed-board footprint carries a KiCad `path`
to its generated schematic symbol UUID. This `path`, rather than the
footprint's own UUID, is the association used by **Update PCB from Schematic**
and **Update Schematic from PCB**. Stable component UUIDs and matching
footprint UUIDs are checked model-parity invariants, but matching UUIDs alone
are not the KiCad association: the top-level PCB `path` is authoritative.

## Electrical-change and KiCad workflow

1. Edit `connectivity.json` for electrical changes.
2. Run `make pocket_card_kicad`.
3. Reopen `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pro`
   so KiCad reloads the generated schematic, externally updated board, and
   project-local footprint-library table.
4. Choose **Update PCB from Schematic** with reference-based relinking
   disabled, footprint replacement disabled, and deletion of unmatched
   footprints disabled. The checked-in top-level PCB `path` values provide the
   authoritative symbol-footprint associations.
5. Verify the preview contains no added, deleted, or moved footprints. Apply the
   update and save the project. If it shows any such change, cancel and resolve
   the model/board mismatch first.
6. If any footprint is reported as unassigned, cancel the update and run the
   board-parity test. Do not enable reference-based relinking in the normal
   workflow; first restore or repair the expected checked-in `path` values.
7. Run schematic ERC and PCB DRC before manufacture, and resolve or consciously
   disposition every result alongside the electrical audit.

`make pocket_card_kicad` only regenerates the schematic. The case
`build_pcb.sh` is different: it intentionally and destructively regenerates the
routed board output as well. Commit, stash, or copy reviewed PCB work before
running that script.
