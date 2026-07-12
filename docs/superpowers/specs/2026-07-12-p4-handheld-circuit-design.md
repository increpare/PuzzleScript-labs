# P4 Handheld: Custom ESP32-P4 Circuit (Parallel Track)

Date: 2026-07-12. Status: approved by owner.

## Relationship to other hardware tracks

`hardware/p4_handheld/` is a **parallel exploratory track**. The pocket card
(`hardware/pocket_card/`, ES3C28P/ESP32-S3) remains the plan of record; this
track may or may not replace it later.

It inherits the pocket card's product philosophy — button-driven appliance,
hard physical power control, fast cold boot, no wifi/Bluetooth, no visible
operating system, `.pscart` cartridges on microSD — but none of its part
contracts: no ES3C28P, no MCP23017, no frozen body envelope.

It salvages circuit blocks from the retired `hardware/card/` design (ESP32-P4
chip-down compute cluster, charger, buck-boost, power-switch topology) but
does not modify `hardware/card/` or `hardware/pocket_card/`; it copies what
it needs into its own directory.

The board is published open hardware: KiCad-openable sources, documented
in-repo, ordinary manufacturer/distributor parts only, JLCPCB-assemblable
except for documented hand-attached lines (panel, battery, speaker).

## Phase scope

This spec covers the **circuit phase only**. It ends at a complete net-level
schematic and a JLC-checked BOM.

Explicitly out of scope for this phase:

- PCB layout, Gerbers, and assembly files
- mechanical/case design and the body envelope (gated on panel research)
- firmware (software follows in a later phase)
- any change to the other two hardware tracks

## Architecture: single board, chip-down P4

One board carries compute, power, display connector, controls, audio, and
storage. The panel attaches by FFC after assembly. This deliberately collapses
the pocket card's module + controller split; the two-board sandwich and
vendor-module alternatives were considered and rejected (module: single-vendor
sourcing, height, partially closed; sandwich: two assemblies and an
interconnect without a compensating benefit).

### Compute block

ESP32-P4NRW32X chip-down — QFN104, 10 x 10 mm, 0.35 mm pitch, 32 MB
in-package PSRAM — copied from the `hardware/card/` compute cluster:

- 32 MB QSPI NOR flash
- 40 MHz crystal
- internal DC-DC inductor and feedback network
- boot straps; EN pull-up with test pad

The **X** (v3.x silicon) revision is mandatory; the plain NRW32 is NRND.
No radio, no antenna, no RF keepout. USB-C wires directly to the P4's USB 2.0
HS PHY for flashing, cartridge transfer, and diagnostics. Debug is test pads
only: UART TX/RX, EN, BOOT, 3V3, GND, optional JTAG.

### Display block

A small MIPI-DSI panel (2.8–4 inch class, target 480 x 640 or 640 x 480) on
an FFC connector, behind a panel load switch so firmware can cut display power
in sleep.

Panel selection is an open sourcing gate resolved by a research step that
**precedes all schematic work**. A candidate must pass five checks before the
connector and rails freeze:

1. controller supported by ESP-IDF `esp_lcd_panel` (ILI9881C / ST7701 /
   JD9365 class) or initable via documented DCS sequences
2. published FFC pinout and a lane count the P4 can drive (1–2 lane DSI)
3. backlight requirements the board can meet — prefer a panel-integrated
   driver; a boost stage on our board is the fallback and must be decided
   before schematic freeze
4. touch: acceptable bonded-touch or touchless variant; if touch is present
   it is wired (I2C) but disabled in release firmware, matching pocket-card
   policy
5. buyable in small quantities from a normal channel (Waveshare or
   distributor), treated as a hand-attached BOM line, not a pick-and-place
   part

If 640 x 480 is achieved, the pocket card's 320 x 240 rendering contract
carries over at exactly 2x integer scale, and the existing corpus rendering
statistics remain valid.

### Power block

Copied from the card reset baseline:

- **Charger/power path:** BQ24075-class 1S linear charger; charge LED from
  the charger CHG pin (works with the device off); USB powers the system
  regardless of switch position via the power path
- **Hard off:** SPDT slide switch gates the buck-boost EN pin — logic-level,
  not battery current. Charging works with the switch off. This supersedes
  the pocket card's 1 A in-line battery switch for this board.
- **3V3 rail:** TPS63070-class buck-boost; current budget re-derived once the
  panel is chosen (measured panel + backlight numbers, not assumed)
- **Fuel gauge:** MAX17048-class on I2C, feeding the critical-battery
  save/sleep path
- **Panel load switch:** TPS22918-class on the display rail
- **Battery:** protected 1S LiPo, selected after mechanical modeling in a
  later phase; the circuit phase fixes only the connector and protection
  assumptions

### Controls

Pocket-card control hierarchy, wired direct to P4 GPIOs; the MCP23017 and its
interrupt plumbing are deleted:

- four-way navigation switch with center contact (center wired,
  diagnostics-only), Undo, Action, Restart, Back/Menu, Volume Up, Volume Down
- all active-low to ground with pull-ups; discrete lines, no matrix, no
  ghosting
- button mechanisms stay gated on the pocket card's button-coupon
  philosophy: the circuit phase reserves GPIOs and footprints follow the
  coupon winner
- spare GPIOs broken out to test points

### Audio

MAX98357A-class I2S mono amplifier driving a small dynamic speaker. One chip;
no codec, no microphone. Volume is firmware-side in the I2S stream, plus the
amplifier shutdown pin for true mute. The speaker is a wired/connectorized
hand-attached BOM line.

### Storage

Push-push microSD socket on the P4 SDMMC pins for the cartridge library.
Internal QSPI flash holds firmware, the fallback library, settings, and
saves.

## Deliverables

```
hardware/p4_handheld/
├── README.md                  # what this is, how to open/regenerate
├── PANEL_RESEARCH.md          # candidate table, five checks, decision record
├── BLOCK_DIAGRAM.md           # architecture + power tree, maintained
├── PIN_BUDGET.md              # P4 GPIO map: DSI, SDMMC, USB, I2S, I2C, buttons, spares
├── schematic or KiCad project # net-level schematic (infra decision below)
└── bom/                       # BOM with JLC part numbers + availability record
```

**Schematic infrastructure decision** (made during implementation planning,
criteria fixed here): reuse the `hardware/card/` connectivity.json → KiCad
generator **if** an audit shows its board-specific assumptions (sheet list,
footprint bindings, card geometry) are cleanly separable — the win is
inheriting its connectivity tests and diffable net source-of-truth. If the
audit finds it entangled with card geometry, hand-draw in KiCad 8 and keep
only its net-naming conventions. Either way, the P4 compute-cluster nets are
lifted from the card project and diffed against the Espressif reference
design as a check.

## Validation gates for this phase

1. **Panel gate:** one primary and one fallback panel pass all five checks,
   sources cited in `PANEL_RESEARCH.md`
2. **Connectivity gate:** every net accounted for in the pin budget; no
   unassigned P4 strap/boot pins; compute cluster diffs clean against the
   card/Espressif reference
3. **BOM gate:** every pick-and-place part has a JLC part number checked
   in-stock (or a documented consignment/alternative); panel, battery, and
   speaker documented as hand-attached lines
4. **Review gate:** schematic ERC clean, plus a written self-review of
   power-tree current budgets once measured panel numbers are in

## Primary references

- `hardware/card/BLOCK_DIAGRAM.md` — salvaged compute/power blocks
- `hardware/card/COMPONENT_SELECTION.md` — prior part choices and sourcing gates
- `docs/superpowers/specs/2026-07-12-puzzlescript-pocket-card-design.md` —
  inherited product philosophy and control hierarchy
- [ESP32-P4 datasheet](https://documentation.espressif.com/esp32-p4-chip-revision-v1.3_datasheet_en.pdf)
- [ESP32-P4 hardware design guidelines](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32p4/schematic-checklist-esp32p4.html)
- [ESP-IDF esp_lcd documentation (ESP32-P4)](https://docs.espressif.com/projects/esp-idf/en/stable/esp32p4/api-reference/peripherals/lcd/index.html)
- [JLCPCB assembly capabilities](https://jlcpcb.com/capabilities/pcb-capabilities/)
