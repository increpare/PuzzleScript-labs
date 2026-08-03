# Pocket Card enclosure CAD

Code-driven. `params.py` is the single source of numeric truth. Design decisions
live in:

- `docs/superpowers/specs/2026-07-31-pocket-card-mechanical-controls-design.md`
- `docs/superpowers/specs/2026-07-31-pocket-card-skqg-rear-connectors-design.md`
  (amendment: SKQGABE010 tact stack, snap-over shoulder, module JSTs on PCB back)

Where those two disagree, the SKQG/rear-connectors document wins.

## Setup

```
python3.12 -m venv .venv          # OCP wheels do not cover 3.14
.venv/bin/pip install cadquery
```

## Build

From the repo root, rebuild shells + PCB (including footprint 3D meshes):

```
make pocket_card_case
```

Shells / order pack only (reuse the existing PCB mesh):

```
make pocket_card_case_shells
```

Or from this directory:

```
.venv/bin/python params.py        # print the derived stack-up
.venv/bin/python coupon.py        # build the clearance-ladder coupon
.venv/bin/python checks.py        # verify the exported STL
./build_pcb.sh                    # PCB + kicad-cli STL/STEP + placed
.venv/bin/python build_variants.py  # shells, caps, tips, assembly
```

Outputs land in `out/`.

## What to print first

**`out/coupon_plate.stl` + `out/coupon_caps.stl`.**

The coupon exists to find two numbers that cannot be derived, only measured on a
real print: the cap-to-hole and flange-to-collar clearances. Five direction
stations sweep both together across `COUPON_CLEARANCES` (0.05–0.25 mm), and the
crown of each cap is engraved 1–5 to match the value engraved beside its station
on the plate.

Print both **as exported, without rearranging** if your slicer allows it, so
station and cap indices stay aligned. Resin is preferable — these are
clearance-fit parts and FDM will not resolve 0.05 mm steps.

Then:

1. Fit each cap into its matching station. Keep the tightest one that still
   slides freely under its own weight.
2. Check lateral play. Target is under ~0.15 mm at the crown.
3. Compare the three cap sizes in the hand — Ø8 direction, Ø11 Undo/Action, and
   the 11.15 × 3.00 pill — and judge whether the dished crown at 1.0 mm proud
   feels right. That is the one question no amount of CAD settles.
4. Feed the winning value back into `CAP_CLEAR` and `COLLAR_CLEAR`.

Note that the direction stations are keyed (two anti-rotation flats, so arrow
legends stay upright) and the Ø11 station is not. Comparing them tells you
whether the flats add noticeable friction.

`out/coupon_backing.stl` is a flat plate sitting at the PCB front plane
(z = 4.50 mm, `PCB_FRONT_Z`). The coupon collars include the **snap-over
shoulder** hard stop. Tack real **SKQGABE010** (or any SKQG-with-stem) parts to
the backing to prove make-before-stop: the stem actuates before the flange hits
the lip.

Controller PCB thickness is **1.6 mm** (`PCB_T`) — JLCPCB standard. Order the
board at 1.6 mm to match the shell.

Module interconnect GH headers live on the **board back** (B.Cu) in the
right-rear wiring pocket — regenerate with `python3 pcb.py` then
`./build_pcb.sh`. That script also writes `out/pcb/pocket_card_controller.stl`
(and `.step`) with board body + footprint 3D models via `kicad-cli` — no
manual STEP→STL conversion. `exported.stl` is KiCad’s native frame;
**`exported_placed.stl`** is the same mesh already transformed into shell
model space (also written by `place_preview.py`).

### JLCPCB SMT package

```
python3 export_smt.py
```

Writes `out/pcb/BOM.csv` + `out/pcb/CPL.csv`, and the case-assembly fastener
list `out/hardware_BOM.csv`. Upload the SMT pair with
`out/pcb/pocket_card_controller_gerbers.zip`.

Case screws (self-tap into the Ø1.7 pilots; the north rib needs a longer pair):

| Qty | Part | Sites |
|---|---|---|
| 2 | M2×10 pan self-tap | north module mounts `(6, 6.5)`, `(84, 6.5)` |
| 4 | M2×8 pan self-tap | south module + both PCB mounts |

Constants: `params.SCREW_NORTH` / `SCREW_SOUTH`.

Connector populate (land stays KiCad JST GH; parts are GH-compatible XUNPU
wafers — genuine JST often OOS):

| Ref | MPN | LCSC |
|---|---|---|
| `J_I2C`, `J_EXP` | `WAFER-GH1.25-4PWB` | C3029379 |
| `J_BAT_IN`, `J_BAT_OUT` | `WAFER-GH1.25-2PWB` | C3029377 |

Constants: `params.CONN_4P_*` / `CONN_2P_*`. Spec:
`docs/superpowers/specs/2026-07-31-pocket-card-skqg-rear-connectors-design.md`.

Silk is punched clear of every pad/NPTH (+0.25 mm) so JLCPCB previews don’t
show ink on contacts. After a silk tweak on a routed board:

```
python3 -c "import silk; print(silk.refresh_board_silk())"
# then re-export gerbers (subtract-soldermask is on in pcbplotparams)
```

### Overlay previews (no manual reposition)

```
.venv/bin/python place_preview.py
```

Writes **separate** meshes (not unioned) into `out/order/preview/`:

- `pcb.stl` / `pcb.step`
- `tip_power.stl`, `tip_mute.stl` (+ `tips_placed.step` multi-body)
- `cap_*.stl` (+ `caps_placed.step` multi-body)

All share the same frame as `shell_front.stl` / `shell_back.stl` — drag them in
together. Prefer the `.step` compounds when you want selectable bodies in one
file; STLs are one body per file so nothing gets fused.

**Showable assembly** (front + back + PCB, one file):

`out/order/assembly.step` (also `out/order/preview/assembly.step`)

Power/mute slides are C&K **PCM12SMTR** (`SW_SPDT_PCM12`) with the official
KiCad packages3D STEP — low profile (~1.5 mm body), no project stand-in needed.
([PCM series datasheet](https://datasheet.octopart.com/PCM12SMTR-ITT-datasheet-7274995.pdf))

## Assembly

- Power/mute tips: small proud dome (not a wide T-cap). Drop in from inside —
  thin retainer flange keeps it captive; short U-fork catches the PCM12 nub.

## Also here

`out/reference_button_coupon.stl` is the button region booleaned out of the
MIT-licensed [guighub/DMG-01-Shell](https://github.com/guighub/DMG-01-Shell)
reference (vendored at `hardware/DMG-01-Shell-Coffee/`), regenerated by
`cut_reference_coupon.py`. No dimension in it passed through our hands. It is no
longer a design input — the silicone-membrane approach it belongs to was
rejected on depth — but holding real Game Boy caps in real Game Boy geometry is
still the fastest way to calibrate what "nice" should feel like.
