# PuzzleScript Card — Two-Sided / Stepped Body (Spin 1.5)

Date: 2026-07-08. Status: **superseded / archival** — replaced by
`2026-07-08-handheld-card-reset-design.md` for the next PCB pass. Keep this
only as history for why two-sided placement was introduced.

Original status: **proposed** — replaces the single-sided
"everything on front" constraint from spin 1 for the next prototype iteration.
Parent spec: `2026-07-07-handheld-compact-card-design.md`.

## Motivation

Spin 1 single-sided layout cannot place the **25 × 25 mm ESP32-P4 module** in
the control band without overlapping fixed case anchors (Action / Undo / Restart)
and the battery pouch. The band is ~35 mm wide; the module alone needs 25 mm.

**Decision:** move compute + power to the **PCB back** and free the **front band**
for controls, center piezo grille, and a more central Menu. Accept a **stepped
body profile** (slimmer display zone, thicker grip/base) for the first hardware
prototype; tighten thickness after fit-check.

## Goals (prototype)

- Eliminate front-face XY collisions between ESP, battery, and buttons.
- Restore **piezo grille in band center** (~X 53, Y ~99).
- Move **Menu** to a more central front position (not bottom-left corner).
- Keep one rigid PCB, one display, one case family — no two-board stack.
- Preserve ~2.5 Wh / ~2.5–3 h play target (split 1S parallel acceptable).

## Non-goals (this spin)

- Chip-down ESP32-P4 (remains spin 2 slimming option).
- Uniform 9 mm depth (deferred; may return if stepped prototype fits under budget).
- Final industrial design / ballast — prototype tolerances are loose.

## Architecture

### PCB

One **116 × 106 mm**, **4-layer** rigid PCB. Components on **both** sides.

| Side | Contents |
|------|----------|
| **Top (front)** | Tact switches (D-pad, Action, Undo, Restart, Menu), piezo driver + wire pads, DSI FFC (J3), USB-C mid-mount (J1), power pill + volume edge switches, LRA + DRV2605, RGB side LEDs, microSD, passives local to connectors |
| **Bottom (back)** | ESP32-P4-Module-32MB (U1) **centered in band**, BQ24075 charger, MAX17048 gauge, TPS62135 buck, bulk caps, split battery pads / pouch retention |

Debug pads (UART, EN, BOOT, 3V3, GND) stay on **back** silk — visible through
rear shell window or service slot.

### Enclosure (stepped profile)

Prototype thickness targets (loose; caliper-verify on first print):

| Zone | Y range (body) | Target thickness | Notes |
|------|----------------|------------------|-------|
| **Display zone** | 0 – 72 | **7.5 – 8.5 mm** | Lens + panel + thin front shell; PCB carries FFC/USB only |
| **Band / base** | 72 – 110 | **11 – 12.5 mm** | Rear pocket for ESP (~3.5 mm) + pouch cells (~4 mm) + shells |

Start at **8 mm / 11.5 mm** (conservative step). Allow growth toward **7 mm /
12.5 mm** if stack-up requires it. Do not exceed **13 mm** band without explicit
re-approval.

```text
SIDE VIEW (conceptual)

  display zone          band zone
  |<--- ~72 mm --->|    |<--- ~38 mm --->|
  _______________        ___________________
 |               |      |                   |
 |  thin face    |      |  thicker base       |
 |_______________|      |___________________|
        8 mm                   11.5 mm
```

Rear shell: **sculpted pocket** (not a flat 1 mm sheet) to cradle split cells +
module. Front shell: largely unchanged above the band; piezo disc still glued to
inner face at grille.

### Battery (split 1S parallel)

Replace single **32 × 30 × 4 mm** pouch with **two** pouches flanking U1 on the
back:

| Cell | Approx. size | Position (body center, mm) | Wh (each) |
|------|--------------|----------------------------|-----------|
| BAT_L | 14 × 28 × 4 | (40.5, 88) | ~1.25 |
| BAT_R | 14 × 28 × 4 | (79.5, 88) | ~1.25 |

- **1S2P** (parallel): same voltage as spin 1; charger and gauge unchanged in
  concept.
- Tabs: separate JST or pad pairs joining at charger `BAT+` / `BAT-`.
- Mechanical: rear-shell pockets or adhesive + PCB outline keep-out on **bottom**
  layer only.

### Compute placement (back)

| Ref | Part | Body center (X, Y) | Layer |
|-----|------|-------------------|-------|
| U1 | ESP32-P4-Module-32MB | **(60, 88)** | bottom |

- Clears front tact anchors (Action 89,83; Undo 75,96; Restart 92,102).
- Between split cells; DSI/USB routed via vias to front-edge connectors.
- WiFi antenna keep-out: back center — keep copper pour and cell tabs clear of
  module antenna edge per Waveshare drawing (verify on spin 1.5 layout).

### Front band (revised controls)

**Unchanged** (case caps already tuned):

| Control | Center (X, Y) |
|---------|---------------|
| D-pad | (22, 87) |
| Action | (89, 83) |
| Undo | (75, 96) |
| Restart | (92, 102) |

**Changed:**

| Item | Spin 1 | Spin 1.5 |
|------|--------|----------|
| Menu pill | (30.5, 106) bottom-left | **(58, 101)** — band center, above piezo |
| Piezo grille | (53, 99) — blocked by battery on front | **(53, 99)** — front center, clear |
| Battery zone (front) | keep-out 37–69 × 73–103 | **removed** — cells on back only |

Menu at **(58, 101)** sits between D-pad and action cluster, ~7 mm+ from cap
edges (re-run `blockout_test.js` after preset update).

### Power / connectors

Unchanged electrically from `hardware/card/PIN_BUDGET.md` and
`connectivity.json`. Placement moves:

- **J3 DSI FFC** — front, top edge (60, 3.5).
- **J1 USB-C** — front, top edge (25, 2).
- **J4 microSD** — front, right band (102, 90) or back if Z allows (prefer front
  for service access).
- **PMIC cluster** — back, near U1 or along bottom edge of module (72–90, 98).

### Routing priorities

1. DSI diff pairs: back U1 → vias → front J3 (short, matched).
2. USB D+/D−: back U1 → vias → front J1.
3. 3V3 high current: buck on back → pour / vias → FFC pin 14 + front loads.
4. I2C, GPIO switches: top layer preferred (short to tacts).

## Z-stack budget (band, 11.5 mm target)

| Layer | mm |
|-------|-----|
| Front shell + cap recess | 1.0 – 1.5 |
| Tact switch + top components | 2.5 |
| PCB | 1.2 |
| ESP module (bottom) | 3.5 |
| Pouch cell | 4.0 |
| Rear shell floor | 1.0 – 1.5 |
| Clearances | 0.5 |
| **Total** | **~11.7** |

Display zone omits cell + module height → **~8 mm** achievable.

## Software / firmware

Archival note: this proposal assumed no GPIO map changes. The later reset
design intentionally moves Power, D-pad Down, Action, and panel enable into
the LP-capable GPIO bank; use `PIN_BUDGET.md` and `board_card_pins.hpp` as
the current source of truth.

## Validation

1. Update `tools/handheld_blockout/blockout.js` preset `card` with stepped depth
   metadata, split battery zones (back), new Menu anchor, remove front battery
   keep-out.
2. Regenerate `hardware/card/mechanical/layout.json`.
3. Historical implementation note: this was originally intended to update the
   retired generated PCB experiment. Do not use that path for the reset board.
4. `blockout_test.js` + `export_pcb_layout_test.js` green.
5. Export STEP / 1:1 SVG; print case blockout; verify cap gaps and band thickness.
6. First PCB: DRC + DSI length check; assemble; measure backlight + runtime.

## Risks

| Risk | Mitigation |
|------|------------|
| DSI length / via stubs | Keep U1 mid-back; J3 top-front; 4-layer ground reference |
| Band thicker than card identity | Prototype-only; document measured Z for spin 2 |
| Split cell tolerance / balance | Same vendor lot; parallel tabs same length |
| Menu accidental press | Playtest; shoulder fallback from parent spec |
| JLC assembly (bottom module) | Standard two-side SMT; weight heavy parts on back |

## Related files to update (implementation phase)

- `docs/superpowers/specs/2026-07-07-handheld-compact-card-design.md` — add
  amendment pointer (do not silently delete single-sided history).
- `tools/handheld_blockout/blockout.js`
- `hardware/card/mechanical/layout.json` (generated)
- `hardware/card/BLOCK_DIAGRAM.md`
- `docs/superpowers/notes/2026-07-08-handheld-card-pcb-handoff.md`

## Open for fit-check (not blocking prototype)

- Exact pouch vendor dimensions for 15 × 28 × 4 mm pair.
- microSD on front vs back final choice.
- Whether rear shell stays translucent over batteries or opaque plastic pocket.
