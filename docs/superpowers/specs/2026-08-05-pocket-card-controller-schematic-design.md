# Pocket Card Controller Schematic Design

**Date:** 2026-08-05
**Status:** Approved design; implementation not started

## Goal

Create a real KiCad schematic for the existing Pocket Card controller PCB,
retroactively associate its symbols with the already placed and routed board,
and eliminate the duplicated connectivity currently embedded in
`case/pcb_route.py`.

The first schematic is an exact electrical reconstruction of the current
board. It must expose existing omissions without silently correcting them or
changing component placement, routing, zones, or enclosure-derived geometry.

## Current state

`hardware/pocket_card/case/pcb.py` creates the board outline and footprints
from the enclosure parameters. `case/pcb_route.py` then assigns nets directly
to footprint pads and invokes freerouting. The KiCad project has no
`pocket_card_controller.kicad_sch`, so the board file is currently the only
complete record of the implemented circuit.

KiCad normally associates a schematic symbol and PCB footprint by UUID. KiCad
10 can also re-link an existing board to a newly created schematic by matching
reference designators once, after which the UUID association is authoritative:

<https://docs.kicad.org/master/en/pcbnew/pcbnew.html#forward-and-back-annotation>

## Chosen architecture

Add a small schematic-as-code package at:

```text
hardware/pocket_card/schematic/
  connectivity.json
  generate_kicad.js
  generate_kicad_test.js
  validate_connectivity.js
  connectivity_test.js
  README.md
```

Generation produces the schematic next to the existing board and project:

```text
hardware/pocket_card/case/out/pcb/
  pocket_card_controller.kicad_pro
  pocket_card_controller.kicad_sch
  pocket_card_controller.kicad_pcb
```

`connectivity.json` becomes the electrical source of truth. It records each
component's reference, value, footprint, stable UUID, pin names/numbers, and
net membership. The schematic generator reads it to emit a deterministic,
self-contained KiCad 10 schematic with embedded custom symbols where standard
symbols do not describe the real connector or footprint pins.

`pcb_route.py` also reads the same connectivity model when assigning PCB-pad
nets. Its geometry-based GPIO allocation is replaced by the explicit mapping
captured from the current routed board. `pcb.py` uses the component UUIDs from
the model as the top-level footprint UUIDs. Thus schematic generation and PCB
generation cannot silently choose different references, pin mappings, or
symbol-footprint identities.

Mechanical placement and outline data remain in `case/params.py` and
`case/pcb.py`. Connectivity does not move into the enclosure model, and the
schematic does not become a source for mechanical coordinates.

## Retroactive symbol-footprint association

The model initially captures the top-level UUID of every current PCB
footprint. The generated schematic symbol for a component uses that same UUID.
The existing board is therefore linked without replacing footprints, moving
parts, or rerouting copper.

The implementation verifies the association in two ways:

1. a test requires every schematic component UUID to equal the UUID of the PCB
   footprint with the same reference; and
2. the documented KiCad reconciliation procedure uses **Update PCB from
   Schematic**, with reference-based re-linking enabled only if KiCad reports
   an unmatched legacy footprint. Footprint replacement and deletion of
   unmatched footprints remain disabled during that reconciliation.

Subsequent updates use normal UUID-based forward annotation. The generator
must never mint a new component UUID merely because it was rerun.

## Exact reconstructed circuit

The first schematic captures these current PCB nets and no speculative
additions:

| Net | Nodes |
|---|---|
| `+3V3` | U1 pins 9 and 18; J_I2C pin 1 |
| `GND` | U1 pins 10 and 15-17; all button common pins; connector grounds; connector mounting pads; address straps; mute ground contacts |
| `SCL` | U1 pin 12; J_I2C pin 3 |
| `SDA` | U1 pin 13; J_I2C pin 4 |
| `INT` | U1 pin 20; J_EXP pin 1 |
| `SIG_UP` | U1 pin 1; SW_UP pin 1 |
| `SIG_DOWN` | U1 pin 21; SW_DOWN pin 1 |
| `SIG_RESET` | U1 pin 22; SW_RESET pin 1 |
| `SIG_MENU` | U1 pin 23; SW_MENU pin 1 |
| `SIG_LEFT` | U1 pin 24; SW_LEFT pin 1 |
| `SIG_RIGHT` | U1 pin 25; SW_RIGHT pin 1 |
| `SIG_UNDO` | U1 pin 26; SW_UNDO pin 1 |
| `SIG_MUTE` | U1 pin 27; SW_MUTE pin 1 |
| `SIG_ACTION` | U1 pin 28; SW_ACTION pin 1 |
| `BAT_P` | J_BAT_IN pin 1; SW_PWR pin 2 |
| `BAT_SW` | SW_PWR pin 1; J_BAT_OUT pin 1 |

J_I2C pin 2, J_BAT_IN pin 2, and J_BAT_OUT pin 2 are grounded. J_EXP pins
2-4, SW_PWR pin 3, MCP23017 pins 2-8, 11, 14, and 19 are explicitly marked
unconnected. U1 is an MCP23017-E/SO at address `0x20`: A0-A2 are grounded,
RESET is tied to `+3V3`, and INTA carries `INT`.

The eight front buttons use duplicated footprint pad numbers: every pad named
`1` is its signal and every pad named `2` is ground. The mute slide retains
the current behavior: pin 2/common and pin 3 are grounded, so one position
grounds `SIG_MUTE` through pin 1 and the other leaves it open. The power slide
switches `BAT_P` to `BAT_SW` through pins 2 and 1.

The existing mute footprint also has unnumbered mechanical pads assigned to
ground by the PCB script. KiCad cannot represent an empty pad number as a
schematic pin. The connectivity model therefore records this as an explicit
board-only pad rule, and parity tests require that rule to remain present. No
footprint geometry or pad type changes in this reconstruction.

H1 and H2 appear in a mechanical section of the schematic, excluded from the
BOM and simulation, so every referenced board footprint has a stable
association.

## Schematic presentation

Use one A4 landscape sheet because the circuit is small. The sheet has four
left-to-right functional regions:

1. module-facing I2C and interrupt connectors;
2. MCP23017 with visible address, reset, power, interrupt, and unused pins;
3. directional and face-button inputs, plus the mute input; and
4. battery input, hard power slide, and battery output.

Use short wires and named net labels rather than a single dense wiring bundle.
Labels attach to actual pin endpoints; decorative or floating labels are not
accepted. Power symbols, explicit no-connect markers, connector pin names, and
footprint fields must remain readable in KiCad and in an exported PDF.

## Data flow

```text
connectivity.json
   |-- validate + tests
   |-- generate_kicad.js --> pocket_card_controller.kicad_sch
   `-- pcb_route.py ------> PCB pad nets and routing input

params.py --> pcb.py -----> board geometry, placement, and footprint instances
                              (component UUIDs come from connectivity.json)
```

The normal workflow becomes:

1. edit `connectivity.json` for electrical changes;
2. run validation and schematic generation;
3. run the existing PCB generation/routing pipeline when a board rebuild is
   intended;
4. use KiCad forward annotation for reviewed schematic changes; and
5. run ERC, connectivity parity checks, and PCB DRC.

## Validation and failure behavior

Validation fails before writing generated artifacts when:

- references or component UUIDs are duplicated;
- a connection names an unknown component or pin;
- one component pin belongs to more than one net;
- required MCP23017 power, address, reset, I2C, or interrupt pins differ from
  the captured board;
- a switch or connector pin mapping differs from the captured board;
- a footprint reference in the current board has no model component, except
  explicitly allowed board-only items; or
- the board contains a modeled numbered pad whose net differs from the model.

Generation writes deterministically so an unchanged input produces no diff.
It must not partially rewrite the board if validation fails.

## Verification

Implementation is complete only when all of the following pass:

- connectivity unit tests;
- deterministic schematic-generation test;
- a parser-level comparison of schematic model nets against current PCB pad
  nets, including duplicated pad numbers and board-only pad rules;
- symbol UUID to footprint UUID association test;
- `kicad-cli sch erc` on the generated schematic, with only reviewed and
  documented exclusions;
- `kicad-cli sch export netlist`, compared against the canonical model;
- `kicad-cli sch export pdf`, visually checked for legibility; and
- the existing Pocket Card PCB tests and DRC, without new violations.

Because the current board file has uncommitted user changes, implementation
must snapshot and compare it before any generation step. No command may
overwrite that board until the work can prove that placement, tracks, vias,
zones, and graphics are preserved or the user explicitly approves a rebuild.

## Electrical audit boundary

The exact reconstruction intentionally does not add parts. After the schematic
exists, produce a short audit that calls out discrepancies between the board
and the earlier controller contract, including at minimum:

- no local MCP23017 decoupling capacitor;
- no controller-board test points despite the handoff requirement;
- reliance on the ES3C28P module's I2C pull-ups;
- the implemented nine-input mapping versus the earlier provisional mapping;
- interrupt/reset/address-strap assumptions; and
- the board-only grounding of mute and connector mechanical pads.

Any correction from that audit is a separate reviewed schematic revision and
PCB change. It is not folded into the as-routed reconstruction.

## Out of scope

- changing component selection, connector pinout, or GPIO allocation;
- adding decoupling, pull-ups, test points, protection, or filtering;
- changing the PCB outline, placement, routing, pours, or silkscreen;
- changing firmware mappings; and
- redesigning the ES3C28P module or the enclosure.
