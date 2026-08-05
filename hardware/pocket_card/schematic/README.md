# Pocket Card controller schematic (legacy)

> **Not the production electrical source.** Open and edit
> `hardware/pocket_card/electronics/pocket_card_controller.kicad_pro`. This
> directory's JSON connectivity model, generator, and the `case/out/pcb` KiCad
> project are historical legacy compatibility artifacts. They cannot accept
> production electrical edits and must not overwrite `electronics/`.

This directory holds the legacy compatibility electrical model and
deterministic KiCad schematic generator for the routed Pocket Card controller.
The generated schematic documents the board that existed when the generator was
written; it does not by itself qualify the circuit for manufacture. Read the
[electrical audit](../ELECTRICAL_AUDIT.md) before using it for a production
decision.

## Legacy compatibility sources, generated output, and tests

- `connectivity.json` is the legacy compatibility electrical contract:
  component identity, footprints and schematic symbol UUIDs, pin-to-net
  connections, no-connects, and the one allowed board-only mechanical-pad rule.
  Legacy-model electrical changes go here only when maintaining generator parity.
- `validate_connectivity.js` enforces that contract.
- `generate_kicad.js` deterministically writes
  `../case/out/pcb/pocket_card_controller.kicad_sch` and the project-local
  `../case/out/pcb/fp-lib-table`.
- `connectivity_test.js`, `generate_kicad_test.js`, and `board_parity_test.js`
  exercise the legacy model against the routed board copy in `case/out/pcb/`.
- `../case/out/pcb/pocket_card_controller.kicad_pro` is the legacy generated
  KiCad project retained for compatibility tests, not the project to edit.

The instructions below describe the temporary legacy workflow. Do not edit its
`pocket_card_controller.kicad_sch` by hand: it is generated and the next
regeneration replaces it.

## Commands

From the repository root:

```
make pocket_card_legacy_schematic_tests   # legacy generator + board parity tests
```

Individual entry points:

```
node hardware/pocket_card/schematic/validate_connectivity.js
node hardware/pocket_card/schematic/generate_kicad.js
node hardware/pocket_card/schematic/connectivity_test.js
node hardware/pocket_card/schematic/generate_kicad_test.js
```

`board_parity_test.js` reads the board in this checkout by default. In an
isolated worktree whose copy is intentionally stale, test against the
authoritative live routed board instead:

```
POCKET_CARD_BOARD=/absolute/path/to/hardware/pocket_card/electronics/pocket_card_controller.kicad_pcb \
  make pocket_card_legacy_schematic_tests
```

## Legacy electrical-change and KiCad workflow

1. Edit `connectivity.json` for legacy-model electrical changes.
2. Run `make pocket_card_legacy_pcb_rebuild` with
   `POCKET_CARD_ALLOW_LEGACY_REBUILD=1` (destructive — regenerates routing).
3. Reopen the legacy project under `case/out/pcb/` if you must inspect generator
   output.
4. Run schematic ERC and PCB DRC before manufacture.

For normal production work, edit `electronics/` and use `make pocket_card_kicad`
(read-only validation) instead of this generator.

Destructive legacy board regeneration lives in `case/build_pcb.sh`, invoked
only through `make pocket_card_legacy_pcb_rebuild`. It intentionally regenerates
the routed board output. Commit, stash, or copy reviewed PCB work before
running it.
