# Pocket Card Controller Electrical Audit

The generated schematic is an exact reconstruction of the routed Pocket Card controller. It documents the board that exists; it is not an endorsement that the circuit is production-ready.

## Verification scope

The deterministic generator and its tests verify the schematic on temporary copies with KiCad 10. The checks upgrade the copy, run error-severity ERC with violation exit codes, export and parse the netlist, and export both PDF and SVG. The netlist check covers all 16 canonical nets and their exact 52 physical component endpoints, as well as all 14 declared no-connect pins. The two PWR_FLAG annotations on +3V3 and GND declare that those rails are supplied externally through the connectors; they are excluded from simulation, the BOM, and board transfer.

A zero-error ERC result establishes that the file is syntactically consistent with its declared electrical pin types. It does not resolve or approve the electrical audit findings below. The automated test requires a valid, nonempty PDF export. For final presentation QA, the PDF is rendered to PNG and manually inspected for overlap, clipping, label placement, no-connect marker clarity, and glyph rendering. This manual visual review is not an electrical qualification.

## Findings

| Finding | Current | Disposition |
| --- | --- | --- |
| MCP23017 decoupling | There is no local bypass capacitor at the MCP23017 supply pins. | Add a 100 nF capacitor near pins 9/10 in the next reviewed revision. |
| Factory access | There are no dedicated test points. | Add 3V3, GND, SDA, SCL, INT, and a representative input as accessible test pads. |
| I2C pull-ups | The controller relies on pull-ups provided by the ES3C28P module. | Measure and confirm the module pull-ups before adding any parallel pull-ups. |
| Input map | The circuit has nine inputs. The legacy geometry-derived allocation is now frozen in `schematic/connectivity.json`. | Update or verify firmware against that connectivity contract. |
| Interrupt/reset/address | INTA is routed to module IO2, RESET is held high, and A0-A2 are held low. | Verify GPIO2 suitability, including power-up behavior. |
| Mechanical copper | JST MP pads and the mute switch mechanical pads are tied to GND. | Confirm the footprints and vendor guidance before production. |
