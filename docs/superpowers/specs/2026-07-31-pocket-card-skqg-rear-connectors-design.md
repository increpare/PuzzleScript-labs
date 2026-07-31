# Pocket Card — SKQG Controls and Rear Connector Pocket

Date: 2026-07-31
Status: agreed in design session.

## What this amends

This document is authoritative for four topics that previously lived in
`2026-07-31-pocket-card-mechanical-controls-design.md`. Where the two
disagree, this document wins. All other July 31 decisions (face XY layout,
mute/power semantics, storage/USB-MSC, speaker path, grille art, module
orientation) stand unless noted below.

| July 31 topic | Status |
|---|---|
| Tact part / height / body thickness | **Replaced** — Alps SKQGABE010, 1.5 mm |
| Hard-stop / cap assembly | **Replaced** — snap-over ramped collar shoulder |
| Controller PCB rear keep-out | **Replaced** — module IO moves to B.Cu wiring pocket |
| Face XY, edge switches, audio, storage, power model | **Unchanged** |

Numeric truth continues to live in `hardware/pocket_card/case/params.py`.
When this spec and that file disagree after implementation, fix the file to
match this document, then re-derive dependent CAD.

## Switch selection

All eight front controls use the same part:

| Property | Value |
|---|---|
| Part | Alps Alpine **SKQGABE010** |
| Outline / height | □5.2 × **1.5 mm** (stem included) |
| Actuation | Top-push stem, **1.57 N**, **0.25 mm** travel |
| Life | 1,000,000 cycles |
| Sites | Up, Down, Left, Right, Undo, Action, Reset, Menu |

This replaces the July 31 placeholder Panasonic EVQ-P2 / EVQ-P0 H2.5 class
(~2.5 mm). Edge mute and power remain slide switches; they are out of scope
here.

The July 31 note that “a 1.5 mm low-profile part would give ~13.3 mm, at some
cost in tactile snap” is closed by this choice. SKQG is that part; Alps rates
the series as sharp-feeling.

### Footprint and copper keepouts

Use KiCad `Button_Switch_SMD:SW_SPST_SKQG_WithStem` (or an identical land
pattern from the Alps drawing). The part is not a plain 5.2 mm courtyard:

- Body □5.2 mm; four gull-wing pads at (±3.1, ±1.85), each 1.8 × 1.1 mm.
- Two **F.Cu keepouts** beside the stem (library zones): approximately
  `x ∈ [±1 … ±4]`, `y ∈ [−1.3 … 1.3]` in footprint coordinates — no tracks,
  vias, pads, or pours. Marked “KEEP-OUT ZONE / No F.Cu tracks” in the
  footprint.

Neighboring switch sites must keep those keepouts and pad copper from
overlapping. Automated AABB checks in `checks.py` gate the face pitches.

## Thickness stack

Only the tact body height changes in the lower-zone stack:

| Layer | July 31 | This amendment |
|---|---|---|
| front face | 1.50 | 1.50 |
| cap flange | 1.00 | 1.00 |
| boss gap | 0.50 | 0.50 |
| tact body | **2.50** | **1.50** |
| → PCB front | **5.50** | **4.50** |
| controller PCB | 2.00 | 2.00 |
| PET insulator | 0.20 | 0.20 |
| 503450 cell | 5.00 | 5.00 |
| swell allowance | 0.50 | 0.50 |
| back shell | 1.50 | 1.50 |
| **lower-zone total** | **~14.70** | **~13.70** |

Honest delta is **−1.0 mm** on body thickness. The earlier “~13.3 mm”
handwave assumed shaving only the tact without restating the full stack; do
not reintroduce that number.

Upper (module) zone is unchanged at ~12.40 mm. Lower zone still sets body
thickness.

## Cap mechanism — contact and hard stop

Guided plastic caps over SMD tacts remain. DMG-derived head sizes, flange in
a collar bore, boss on the stem only, and pill anti-rotation flats are
unchanged.

### Hard stop and assembly

**Production hard stop:** flange lands on a **snap-over ramped collar
shoulder** after **~0.35 mm** of travel (past 0.25 mm SKQG actuation, about
0.10 mm overtravel).

- Caps install from the **inside** of the front shell (head out through the
  face hole, flange retained behind the face).
- The shoulder has a **ramp on the insertion face** so the flange can click
  past it, and a **flat stop face** toward the flange for the hard stop.
- Excess finger force stays in shell plastic. It must not dump into the SKQG
  metal body or solder joints.
- Alps constraints still apply: the boss hits the **stem centre only**; no
  side load on the stem.

**Withdrawn as the production hard stop:** the coupon’s skirt → PCB stop.
That path made assembly easy but required PCB/switch exclusion geometry and
put overload near the part we are trying to protect.

### Contact reliability

- At rest, the tact spring preloads the flange against the underside of the
  face (no rattle).
- The 0.50 mm “boss gap” is the **boss length** through the cavity to the
  stem tip, not an intentional dead band before contact.
- First printed coupons use the **real snap-over**; clearances are tuned on
  the ladder until: click-in without cracking, free slide, reliable electrical
  make at ≤0.25 mm travel, and stop before stem abuse.

## Module IO — rear wiring pocket

### Problem

The controller PCB currently places keyed JST GH headers (`J_I2C`, `J_EXP`,
`J_BAT_IN`, `J_BAT_OUT`) on the **front** (button) side. Those housings are
about **4 mm** tall and compete with the button cavity. The ES3C28P’s I2C,
expansion, and BAT sockets sit on the **module underside / lower edge**, so
the cables already want to live under the board plane.

### Decision

| Side | Contents |
|---|---|
| **Front (F.Cu)** | Eight SKQGABE010, MCP23017, passives, power slide, mute slide |
| **Back (B.Cu)** | All keyed module interconnects (`J_I2C`, `J_EXP`, `J_BAT_IN`, `J_BAT_OUT`) |

- Place the back-side connector cluster in the **lower-right rear pocket**,
  opposite the cell (cell stays hard left), clearing the cell fence, driver
  housing, and mounting bosses. Exact XY is free inside that pocket.
- Cables drop from the module’s lower-edge sockets and dress under/around the
  board into that pocket. Messy routing is acceptable; the case remains
  openable for service.
- Speaker wiring still does **not** land on this board unless a later decision
  adds a pass-through. Mute remains a logic line to the module amp-enable.

### Keep-out rule change

July 31 said the battery-facing rear stays flat and component-free. That
global rule is withdrawn.

**New rule:** rear is flat **under the cell**; connectors are allowed in the
**right-rear wiring pocket**. Outer body thickness is unchanged if that local
~4 mm bump fits inside the existing lower-zone budget.

## Validation gates

These gate freezing CAD and BOM for the amended topics:

1. **Clearance + snap coupon** — `CAP_CLEAR` / `COLLAR_CLEAR` ladder with a
   real ramped shoulder; caps click in, slide freely, no crack on the chosen
   resin process.
2. **Electrical make** — SKQGABE010 under the boss closes before the shoulder
   stop; no stem side-load.
3. **Module cable dress** — I2C / EXP / BAT leads reach the back-right
   connector pocket without pinching the cell or fouling the driver.
4. Unchanged from July 31: clockwise module rotation on a sample; driver
   corner fit; cell envelope including PCM bulge and polarity.

## Implementation touch list

| Artifact | Change |
|---|---|
| `docs/superpowers/specs/2026-07-31-pocket-card-mechanical-controls-design.md` | Point superseded subsections at this document; update tact/stack/stop/rear text when convenient |
| `hardware/pocket_card/case/params.py` | `TACT_H = 1.5`, force/travel for SKQGABE010, recompute `PCB_FRONT_Z` / body thickness, hard-stop notes |
| `hardware/pocket_card/case/coupon.py`, `shell_front.py` | Ramped collar shoulder; remove skirt-as-production-stop |
| `hardware/pocket_card/case/pcb.py` | SKQG footprints on all eight sites; move JSTs to **B.Cu** in the right-rear pocket |

## Out of scope

Face XY layout and the known Menu/Undo overlap fix; mute/power semantics;
storage and USB-MSC; speaker acoustic path; decorative grille pattern;
`hardware/card/` (Waveshare Card) and `case.blend` as a source of truth.
