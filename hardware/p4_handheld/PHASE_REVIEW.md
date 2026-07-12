# Circuit-phase gate review

Date: 2026-07-12.
Spec: `docs/superpowers/specs/2026-07-12-p4-handheld-circuit-design.md`

Check suite on this revision: connectivity tests (15), pipeline tests (8),
JLC tests (4), `validate_connectivity` (65 nets, 46 components), and
`kicad-cli sch erc` — all exit 0.

## 1. Panel gate: PASS

Primary **Waveshare 2.8inch DSI LCD** (480×640, GT911, 2-lane DSI) and
fallback **Waveshare 4inch DSI LCD** both pass all five spec checks with
citations — `PANEL_RESEARCH.md` §Decision. The fallback shares the exact
electrical contract, so a swap does not touch the schematic.

## 2. Connectivity gate: PASS

- Every assigned `PIN_BUDGET.md` row is netted in `connectivity.json`
  (buttons, I2S, SDMMC, I2C, DSI, USB, panel, straps as test pads); spare
  GPIOs 16–19 have test pads, remaining spares are documented as unassigned.
- Strap safety is enforced in code: `connectivity_test.js` asserts no button
  net lands on GPIO34–38 (`strapPins` transcribed from the datasheet/esptool
  docs). This deliberately deviates from the card map, which had buttons on
  GPIO34/37 — recorded in `PIN_BUDGET.md`.
- Compute-cluster diff vs `hardware/card`: **MATCHES** on all support nets
  (ESP_EN, XTAL, FLASH_*, DCDC_*, BOOT, BOOT_EN, USB_DP/DM) and power/ground
  membership (Task 6 output). Intentional deviations (I2C on GPIO7/8, SDMMC
  instead of SPI SD, button map) are documented in `PIN_BUDGET.md`.

## 3. BOM gate: PASS

`bom/bom_jlc.csv` (generated, 38 PnP lines) + `bom/AVAILABILITY.md`:
every PnP line carries an LCSC id; gated parts carry placeholder ids and
their gate; panel, battery, and speaker are documented hand-attached lines.
One flagged contingency: **U1 silicon revision** — JLC's C22387510 listing
is titled NRW32 while the design requires NRW32X; confirm revision with JLC
or consign the chip before ordering. This is documented, not waived.

## 4. Review gate: PASS

- `kicad-cli sch erc p4_handheld.kicad_sch --exit-code-violations` → exit 0,
  0 violations (2026-07-12). Reaching this required rewriting the inherited
  generator's drawing engine: per-component symbols with one pin per netlist
  pin, labels placed exactly on pin endpoints, global labels only for
  cross-sheet nets, all geometry on the 1.27 mm grid, and a generated
  project symbol library (`PSP4H.kicad_sym` + `sym-lib-table`). The card's
  generator output scored ~369 ERC violations; this one scores 0.
- Power-tree current budget self-review below.

## Power-tree current budget self-review

Walking the tree with PANEL_RESEARCH numbers:

- **VBUS in:** USB-C default 5 V/500 mA minimum, up to 1.5 A with charger
  detection; BQ24075 input limit configurable (EN1/EN2), power-path shares
  input between system and charge.
- **SYS → TPS63070:** rated 2 A+ continuous at V_IN ≥ 2.5 V.
- **3V3 concurrent worst case:** panel ≤400 mA peak (card baseline ceiling;
  the 2.8" panel with integrated backlight is expected well below — measure
  at bring-up) + P4 bursts ~500 mA + MAX98357A up to ~300 mA at full drive
  + <50 mA rest ≈ **1.25 A worst-case burst**, inside the TPS63070 envelope
  with ≥35% margin. Average draw is far lower (P4 ~250 mA, panel steady,
  amp at game-sfx duty).
- **Conclusion:** rail sizing holds on paper; the layout phase re-walks this
  with the measured panel and a decoupling plan, per spec.

## Deviations from the implementation plan (all recorded in commits)

1. `blocks.json` and a `requirements` block were needed by the copied
   validator — the plan's copy list missed them; created for this board.
2. `jlc_parts_test.js` was rewritten model-agnostic (was card-specific) and
   BOM tests align with the CSV's PnP-only contract.
3. Board-policy validator checks are presence-conditional so the model could
   grow task-by-task while staying green.
4. ERC-clean required the generator drawing-engine rewrite described above —
   the plan had assumed connectivity-level fixes would suffice.

## HANDOFF — state and next actions (updated 2026-07-12, post owner review)

This section is the single pickup point for the next session/phase.

### What changed after the gate review

The owner review reopened the panel decision on mechanics and cost:

- Added **check 6 / `GATE-PANEL-STACK`** (mechanical stack was never measured)
  and the **dual-footprint hedge**: J3 (15-pin FFC, proven) + J3B (DNP bare-
  panel FPC + DNP backlight boost). See `PANEL_RESEARCH.md` §Dual-footprint.
- Bare-panel candidate found and pinout-confirmed: **D280FPC930C-B** 2.8"
  480×640 ST7701S, 2-lane MIPI, 40-pin FPC, ~€6.49 — order the **MIPI
  variant** only. Pinout table in `PANEL_RESEARCH.md`.
- The Waveshare 2.8" assembly is demoted to bring-up vehicle / stack-
  measurement sample; buy direct (~$27), never EU resellers (~€65).
- **Kill criterion agreed:** if no bare panel passes all six checks, a custom
  board + thick display assembly is strictly worse than the ES3C28P pocket
  card — this track then closes as a documented negative result.

### Immediate actions (no dependencies)

1. Place the `bom/ORDER_LIST.md` basket: P4-NANO devkit, 1× Waveshare 2.8"
   DSI (direct), 2–3× D280FPC930C-B **MIPI variant**, button-coupon switches,
   FFC connectors + both cable parities, audio dev parts.
2. Open the JLC ticket on U1: does C22387510 ship NRW32**X** (v3.x) silicon?
   (`bom/AVAILABILITY.md`.)

### On parts arrival (parallel tracks)

- **Firmware (starts first, on devkit):** DSI bring-up — try the on-hand
  Waveshare **4.3"** touch display first via a custom timing entry in
  `waveshare/esp_lcd_dsi` (timings from its RPi dtoverlay; not in the tested
  table, cheap experiment). Then renderer, SD cartridge flow, input, I2S.
- **Panels:** calipers on the 2.8" assembly (closes `GATE-PANEL-STACK` for
  the assembly path); D280 sample → thickness, FPC pitch, backlight Vf/If,
  init via `esp_lcd_st7701`. Fill the candidate table in `PANEL_RESEARCH.md`.
  If backlight Vf ≤ ~3.2 V, the DNP boost becomes FET + PWM.
- **Buttons:** coupon feel-test (`GATE-BUTTON-COUPON`); FFC cable parity
  measurement closes `GATE-PANEL-FFC-CONTACT`.

### Layout phase (after panel verdict)

- Re-add PCB generation to the pipeline (deleted this phase by design;
  the card's `buildPcb`/`board_preview` code is the reference).
- Both display footprints on one board per the hedge; panel verdict decides
  stuffing, not the spin.
- Measured panel current → final power budget (re-walk the table above).
- Freeze switch footprints from the coupon winner.

### Key files

- `schematic/connectivity.json` — net source of truth (edit → test → regen)
- `PANEL_RESEARCH.md` — panel gate, candidates, dual-footprint decision
- `bom/ORDER_LIST.md` — the week-1 basket
- `bom/AVAILABILITY.md` — per-line sourcing incl. the U1 revision contingency
- `PIN_BUDGET.md` — GPIO map (buttons deliberately off strap pins GPIO34–38)
