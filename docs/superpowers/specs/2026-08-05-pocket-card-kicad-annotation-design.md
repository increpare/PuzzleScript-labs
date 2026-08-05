# Pocket Card KiCad Annotation and Footprint Library Design

**Date:** 2026-08-05
**Status:** Approved

## Goal

Make the generated Pocket Card controller schematic fully annotated according
to KiCad 10 rules and make its assigned footprints resolvable without relying
on the user's broken global footprint-library table. Updating the existing PCB
from the schematic must retain every footprint's identity, placement, routing,
and schematic link.

## Confirmed causes

KiCad considers a normal schematic reference annotated only when it ends in a
number. Semantic references such as `SW_UP` and `J_BAT_OUT` therefore trigger
"Updating PCB requires a fully annotated schematic." Running annotation adds a
trailing `1`, which currently changes fourteen component references.

The subsequent seventeen footprint errors have a separate cause. The user's
global KiCad 10 `fp-lib-table` points at a deleted macOS App Translocation
directory. All six assigned footprint files are present under the installed
KiCad application, but none of the four library nicknames can be resolved
through that stale table.

## Reference migration

Keep the descriptive references and append a stable numeric suffix:

| Existing | New |
|---|---|
| `SW_UP` | `SW_UP1` |
| `SW_DOWN` | `SW_DOWN1` |
| `SW_LEFT` | `SW_LEFT1` |
| `SW_RIGHT` | `SW_RIGHT1` |
| `SW_UNDO` | `SW_UNDO1` |
| `SW_ACTION` | `SW_ACTION1` |
| `SW_RESET` | `SW_RESET1` |
| `SW_MENU` | `SW_MENU1` |
| `SW_PWR` | `SW_PWR1` |
| `SW_MUTE` | `SW_MUTE1` |
| `J_I2C` | `J_I2C1` |
| `J_EXP` | `J_EXP1` |
| `J_BAT_IN` | `J_BAT_IN1` |
| `J_BAT_OUT` | `J_BAT_OUT1` |

`U1`, `H1`, and `H2` are already valid and remain unchanged. The migration is
applied to the canonical connectivity model, generated schematic, generated
PCB, PCB scripts, tests, and workflow documentation.

The existing component UUIDs do not change. Every PCB footprint retains its
top-level UUID and its schematic `path`; only the reference property changes.
The live board is patched in place so geometry, copper, zones, and graphics
are not regenerated or replaced.

## Project-local footprint libraries

Add `hardware/pocket_card/case/out/pcb/fp-lib-table` with project-local entries
for the four library nicknames used by the schematic:

- `Button_Switch_SMD`
- `Connector_JST`
- `MountingHole`
- `Package_SO`

Each entry uses `${KICAD10_FOOTPRINT_DIR}/<library>.pretty`, the standard KiCad
10 installation variable. This makes this project independent of the stale
global table while remaining portable across normal KiCad 10 installations.
The global user configuration is left untouched.

The schematic generator owns this small table and writes it deterministically
beside the project, schematic, and board. It does not copy footprint geometry
into the repository.

## Validation and tests

Before implementation changes, add failing tests that demonstrate both bugs:

1. every ordinary component reference must match KiCad's annotated-reference
   form and the fourteen old references must be rejected;
2. generation must produce a project-local table containing exactly the four
   required library nicknames and standard KiCad 10 variable-based URIs; and
3. all assigned `Library:Footprint` values must resolve through that table
   when the installed KiCad footprint root is available.

Existing connectivity, schematic export, ERC, generator, and board-parity
tests must continue to pass. Board parity must require the migrated references
and the unchanged UUID/path associations for all seventeen footprints.

For the live board, verification compares the file before and after migration
and permits only the fourteen reference-property changes. A forced KiCad
resave of a temporary copy must retain all seventeen schematic paths and pass
board parity.

## User workflow

After the change, reopen the project so KiCad reads the project-local library
table and the externally updated board. The schematic is already fully
annotated; the user should not run annotation. **Update PCB from Schematic**
should run with reference-based relinking, footprint replacement, and deletion
of unmatched footprints disabled.

## Out of scope

- repairing or replacing the user's global KiCad configuration;
- changing component values, footprints, connectivity, placement, or routing;
- adopting generic references such as `SW1` or `J1`; and
- copying KiCad's standard footprint libraries into the repository.
