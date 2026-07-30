# Pocket Card Case + Controller PCB Handoff

Date: 2026-07-30  
Purpose: quick context for an agent helping design the moulded enclosure and
controller PCB.

## Current direction

The product is a small, dedicated PuzzleScript handheld built around the
LCDWiki/QDtech **ES3C28P** module:

- ESP32-S3R8, 8 MB PSRAM, 16 MB flash
- integrated 2.8-inch 240 × 320 display, used landscape at 320 × 240
- USB-C, microSD, LiPo charging/monitoring, audio codec/amplifier and touch
- physical controls are the release interface; touch is disabled in normal use

The **newer mechanical direction is a moulded two-part case with separate
buttons**, not the decorative front/rear-PCB sandwich still described in the
July 12 written specification.

Evidence/source of truth:

- `hardware/card/case/case.blend` was updated on July 17–18, after the July 12
  Pocket Card spec.
- It contains ES3C28P geometry and separate front-shell, back-shell and button
  objects (`OBes3c28p_3d`, `OBfront_shell`, `OBback_shell`, `OBab_button`, etc.).
- It currently lives under the legacy `hardware/card/` path even though it has
  been adapted to the ES3C28P. Treat that path as an organizational accident.
- `hardware/card/case/case.blend1` is a Blender backup, not the primary model.

The written spec remains useful for electrical, control and product intent, but
its PCB-sandwich mechanical section is stale:

- `docs/superpowers/specs/2026-07-12-puzzlescript-pocket-card-design.md`

Do not silently redesign the current Blender case from the old PCB-sandwich
description. Inspect and measure the Blender model first.

## Product intent and approximate envelope

- Compact, near-square, button-driven appliance rather than a phone/dev board.
- Screen above controls; fast cold boot; no visible OS or network setup.
- Original target was about 90 × 90–95 × 11.5 mm, with a stated maximum of
  92 × 100 × 12 mm.
- The ES3C28P's quoted stack is already about 10.6 mm, so the old 12 mm limit
  may conflict with a robust moulded shell. Prefer a buildable, strong case to
  preserving an obsolete thickness promise.
- Verify all dimensions against both the Blender model and a physical ES3C28P
  sample before freezing CAD.

## Controls and ergonomics

Required controls:

- four separate direction buttons: Up, Down, Left, Right
- Action
- Undo (a primary control in PuzzleScript)
- Restart
- Back/Menu
- Volume Up and Volume Down
- hard physical power switch

Hierarchy:

1. Directions and Undo are primary.
2. Action is paired near Undo.
3. Restart is nearby but visually/mechanically less prominent.
4. Back/Menu is small and recessive.
5. Volume and power can be edge controls.

Each cap needs case-supported guidance and a mechanical bottom stop. Side and
bottoming loads must go into the enclosure, not through the actuator into an
SMD switch or its solder joints. The old spec described flanges captured by a
front PCB; in the moulded version, the **front shell must provide the equivalent
capture, guide and hard-stop geometry**.

Do not freeze the controller PCB switch footprints until a physical button
coupon has compared at least low-profile tactile switches and PCB snap domes.
The final combination should survive and remain comfortable during a
continuous 30-minute play session.

For prototypes, print the shell and caps. Do not pay for injection tooling
until case fit, button travel, port access, assembly order and screw/boss
strength are proven. At production volume, the two case halves and same-material
button parts may be candidates for family tooling; a silicone membrane would
be a separate process/tool.

## Controller PCB electrical contract

No final Pocket Card controller PCB CAD exists yet. `hardware/pocket_card/`
currently contains only the module pin contract and supporting files.

The intended control circuit is:

- **MCP23017** 16-bit I2C GPIO expander at 3.3 V
- default address `0x20`
- ES3C28P I2C: SDA GPIO 16, SCL GPIO 15
- interrupt-on-change to ES3C28P GPIO 2
- switches active-low to ground, using pull-ups
- firmware reads both ports and debounces in software

Provisional mapping:

| MCP23017 input | Function |
|---|---|
| PA0 | Up |
| PA1 | Down |
| PA2 | Left |
| PA3 | Right |
| PA4 | Action |
| PA5 | Undo |
| PA6 | Back/Menu |
| PA7 | Restart |
| PB0 | Volume Up |
| PB1 | Volume Down |
| PB2–PB7 | Spare/test inputs |

Canonical pin references:

- `hardware/pocket_card/es3c28p_pin_contract.json`
- `firmware/pocket_card/main/board_pins.hpp`
- vendor links in `hardware/pocket_card/README.md`

The I2C bus is shared with the module's touch controller and ES8311 audio
codec, which use other addresses. Confirm pull-ups already present on the
module and avoid accidentally making them too strong by adding another set.

Expose test points for 3V3, GND, SDA, SCL, interrupt and useful MCP inputs.
Design for a simple factory fixture that can verify every button.

## Power, battery and audio constraints

- Baseline battery: protected **503450** 1S LiPo, roughly 50 × 34 × 5 mm.
- Confirm real cell dimensions, protection-board bulge, connector polarity,
  cable bend radius and swelling allowance.
- A physical slide switch in the battery lead provides hard-off behavior.
- It must be rated for at least 1 A DC because it carries operating/charging
  current, not merely a logic signal.
- Battery-to-PCB contact needs an insulating PET layer.
- If the controller PCB overlaps the battery, keep its battery-facing side flat
  and component-free.
- Use the ES3C28P's existing speaker output/connector and leave room for the
  selected speaker, wiring and an actual acoustic path/chamber in the case.

Battery installation and international shipping are likely to be the hardest
production/logistics item. Require a protected, traceable cell with UN 38.3
documentation if a contract manufacturer ships finished units.

## Case/PCB co-design questions still open

- Exact shell dimensions, wall thickness, split line, draft and mould process.
- Material and finish; strength around screen opening and thin walls.
- Screw bosses/inserts versus clips, and intended repair/disassembly method.
- Exact ES3C28P mounting datums and tolerance around the display/touch surface.
- USB-C, microSD, power-switch, volume, speaker and any reset/service openings.
- Antenna keepout and avoidance of metal/PCB/battery immediately around it.
- Button sizes, travel, cap retention, anti-rotation and switch technology.
- Controller PCB outline, mounting holes, cable direction and assembly order.
- Battery and speaker retention without dangerous compression or loose wiring.
- Whether one keyed cable harness can connect the controller to the ES3C28P.
- Factory programming access, functional-test procedure and serial/product
  labels.

Prefer one screw size, keyed connectors, minimal adhesives and an assembly
sequence that does not require trapping or sharply folding wires.

## Manufacturing direction

PCBWay OEM is the stronger one-stop candidate: it advertises PCB assembly,
plastic enclosure production, final mechanical/box-build assembly, sourcing,
functional test, packaging and finished-product shipping.

JLCPCB is suitable for inexpensive PCB/PCBA and can manufacture case parts
through its separate 3D-printing/CNC services, but its current turnkey PCBA
service does not provide complete enclosure integration/box build. JLC also
states that consigned batteries are not processed.

The likely low-hassle production chain is therefore:

1. Freeze case, buttons, controller PCB, cables and assembly instructions.
2. Supply a golden sample, firmware image and functional-test procedure.
3. Have PCBWay source/build/assemble/test/package the finished batch.
4. Send finished inventory in bulk to a retailer/fulfilment partner rather
   than shipping individual orders ourselves.

PCBWay manufacturing does not by itself eliminate merchant-of-record, VAT,
product-compliance, warranty, return or customer-support responsibilities.

## Suggested next-agent sequence

1. Open `hardware/card/case/case.blend` in Blender and inventory every object,
   modifier, material and unresolved boolean.
2. Produce dimensioned screenshots/exports and compare the virtual ES3C28P
   model with the vendor drawing and a physical sample.
3. Perform a mouldability/assembly audit: wall thickness, draft, undercuts,
   split, bosses, button capture, hard stops, ports, antenna and cable paths.
4. Agree the button/switch stack with a printable test coupon.
5. Derive the controller PCB outline and mounting datums from the approved
   enclosure—not from the stale PCB-sandwich spec.
6. Create the MCP23017 schematic, board layout, BOM/CPL/Gerbers and a small
   factory-test fixture/procedure.
7. After the owner approves the revised architecture, update the formal
   Pocket Card spec and move/copy canonical mechanical sources into
   `hardware/pocket_card/`.

Do not edit the older ESP32-P4 PCB in `hardware/card/` into the controller
board. Create a distinct Pocket Card controller project so the old DSI, power
and geometry assumptions cannot leak into the new hardware.
