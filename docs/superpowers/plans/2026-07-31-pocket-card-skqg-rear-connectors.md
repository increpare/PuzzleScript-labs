# Pocket Card SKQG + Rear Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Alps SKQGABE010 under all eight Pocket Card front buttons with snap-over collar hard stops, thin the stack by 1.0 mm, and move module JST IO to the PCB back in the right-rear wiring pocket.

**Architecture:** `params.py` remains numeric truth. Shell/coupon geometry derives the ramped shoulder from new shoulder parameters; the old skirt→PCB stop is removed. The controller PCB keeps front-side controls/expander and flips the four JST GH footprints to B.Cu in the cell-free right pocket. `checks.py` and `params.py --main` are the automated gates before any print or fab.

**Tech Stack:** Python 3.12 + CadQuery (existing `.venv`), KiCad 8/`pcbnew` for `pcb.py`, Alps SKQG footprint already in KiCad (`Button_Switch_SMD:SW_SPST_SKQG_WithStem`).

**Spec:** `docs/superpowers/specs/2026-07-31-pocket-card-skqg-rear-connectors-design.md`

---

## Plan defects (fixed 2026-08-01)

Owner review caught real bugs in the original task text. Treat this section as
binding over any contradictory wording left below until those paragraphs are
edited inline.

1. **B.Cu connectors vs driver XY keepout — wrong constraint.** The driver sits
   in the front shell at device z ≈ 1.5–5.0. The PCB front is at 4.5; the back
   face is at 4.5 + `PCB_T` = 6.5. B.Cu parts hang further rear. A back-side
   JST **cannot collide with the driver at any XY**. Task 3 must **not** use a
   2D driver keepout for `CONN_*`. Real constraints: **cell fence**, **board
   outline**, and **back-shell interior**. The drafted `(68, 70)` / `(68, 74.5)`
   BAT sites only “failed” the bogus driver test; keep them (or re-tune only
   for cell/shell).

2. **Task 2 Step 5 tautologies — withdrawn.** Comparing
   `FACE_T+CAP_FLANGE_T+HARD_STOP_AT` to itself, or `boss_tip` to
   `PCB_FRONT_Z - TACT_H` when `PCB_FRONT_Z` is defined from those terms, can
   never fail. Replace with: (a) parametric inequalities that can fail
   (`COLLAR_DEPTH` covers shoulder stack; `shoulder_id` positive and less than
   bore), (b) **STL-measured** shoulder flat near
   `z = -(FACE_T+CAP_FLANGE_T+HARD_STOP_AT)` on `coupon_plate.stl`, same spirit
   as driver/bond checks.

3. **Switch body vs collar bore — required check.** EVQ-P0 already failed the
   menu pill bore by −0.40 mm. Assert for every station class:
   `min_bore_width - TACT_OUTLINE > 0` (prefer ≥ 0.2 mm). Measure from the same
   formulas `button_station` uses; do not hand-wave “5.60 clears 5.2” in a
   comment alone.

4. **DATASHEET marks for force/travel.** Alps Alpine product page for
   SKQGABE010 lists Operating force **1.57 N**, Travel **0.25 mm**, Product
   height **1.5 mm**, □5.2 — confirm before treating as locked
   (https://tech.alpsalpine.com/e/products/detail/SKQGABE010/). Formal delivery
   drawing still preferred for land pattern; KiCad keepouts stand until then.

5. **Task 1 “currently EVQ-P2” premise was stale.** `params.py` said H2.5;
   `pcb.py` already had EVQ-P0 on rounds and EVQ-P2 on the pill. Ignore that
   sentence; Task 3 replaces all eight with SKQG.

6. **`pcb_route.py` is in-plan.** Moving four connectors to B.Cu is not a
   footnote. Add **Task 6** to re-route and drive DRC to a known clean (or
   explicitly waived) state; the board is not orderable at ~34 DRC errors.

---

## File structure

| File | Responsibility |
|---|---|
| `hardware/pocket_card/case/params.py` | Tact part numbers, `TACT_H`/`FORCE`/`TRAVEL`, shoulder params, derived `PCB_FRONT_Z` / `BODY_T`, connector XY on the back |
| `hardware/pocket_card/case/checks.py` | Assert stack thickness, hard-stop travel math, connector pocket clearances |
| `hardware/pocket_card/case/coupon.py` | Clearance ladder + real snap shoulder; caps without production skirt-stop |
| `hardware/pocket_card/case/shell_front.py` | Production collars with the same snap shoulder |
| `hardware/pocket_card/case/pcb.py` | SKQG footprints on F.Cu; JSTs on B.Cu at wiring-pocket coords |
| `hardware/pocket_card/case/README.md` | Print notes: snap coupon, backing at z=4.50, SKQG |
| `docs/superpowers/specs/2026-07-31-pocket-card-mechanical-controls-design.md` | Pointer: tact/stop/rear subsections superseded by the SKQG amendatory spec |

No new top-level packages. Do not touch `hardware/card/`.

---

### Task 1: Lock SKQG numbers in `params.py` and fail thickness checks

**Files:**
- Modify: `hardware/pocket_card/case/params.py`
- Modify: `hardware/pocket_card/case/checks.py`
- Test: `hardware/pocket_card/case/.venv/bin/python params.py` and a new assert in `checks.py`

- [ ] **Step 1: Add a failing thickness assertion**

In `checks.py`, near the other numeric `check()` helpers (or at the start of `main` before STL work if easier), add a pure-params gate that does not need STLs:

```python
def check_skqg_stack():
    print("\nskqg stack (params)")
    check("TACT_H", P.TACT_H, 1.5, 0.001)
    check("TACT_TRAVEL", P.TACT_TRAVEL, 0.25, 0.001)
    check("TACT_FORCE_N", P.TACT_FORCE_N, 1.57, 0.001)
    check("PCB_FRONT_Z", P.PCB_FRONT_Z, 4.5, 0.001)
    check("LOWER_ZONE_T", P.LOWER_ZONE_T, 13.7, 0.02)
    check("BODY_T", P.BODY_T, 13.7, 0.02)
    check("HARD_STOP_AT", P.HARD_STOP_AT, 0.35, 0.001)
    if P.HARD_STOP_AT <= P.TACT_TRAVEL:
        print("   FAIL  HARD_STOP_AT must be > TACT_TRAVEL")
        FAILURES.append("HARD_STOP_AT <= travel")
    else:
        print(f"   PASS  hard-stop overtravel "
              f"{P.HARD_STOP_AT - P.TACT_TRAVEL:.3f} mm")
```

Call `check_skqg_stack()` from `main()` before any STL load (so it always runs).

- [ ] **Step 2: Run checks and confirm stack fails on current 2.5 mm tact**

```bash
cd hardware/pocket_card/case
.venv/bin/python -c "import checks; checks.check_skqg_stack(); import sys; sys.exit(1 if checks.FAILURES else 0)"
```

Expected: FAIL on `TACT_H` (got 2.5, want 1.5) and `PCB_FRONT_Z` / zone totals.

- [ ] **Step 3: Update tact constants in `params.py`**

Replace the tact block in `params.py` (H2.5 placeholder; `pcb.py` meanwhile
had EVQ-P0 on rounds and EVQ-P2 on the pill — both go away in Task 3) with:

```python
TACT_PART    = "SKQGABE010"   # DATASHEET Alps SKQG series, with stem
TACT_H       = 1.5            # DATASHEET product height incl. stem
TACT_TRAVEL  = 0.25           # DATASHEET
TACT_FORCE_N = 1.57           # DATASHEET SKQGABE010
TACT_OUTLINE = 5.2            # DATASHEET square body
```

Leave `HARD_STOP_AT = 0.35` and `CAP_BOSS_GAP = 0.5` as-is. Confirm derived line still reads:

```python
PCB_FRONT_Z = FACE_T + CAP_FLANGE_T + CAP_BOSS_GAP + TACT_H   # 4.5
```

Update the comment above the tact block that still says “5.5 mm and ~14.3 mm” so it states 4.5 mm / ~13.7 mm and points at the SKQG amendatory spec.

- [ ] **Step 4: Re-run the stack check**

```bash
.venv/bin/python -c "import checks; checks.check_skqg_stack(); import sys; sys.exit(1 if checks.FAILURES else 0)"
```

Expected: all PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add hardware/pocket_card/case/params.py hardware/pocket_card/case/checks.py
git commit -m "Set Pocket Card tact stack to SKQGABE010 (1.5 mm)."
```

---

### Task 2: Snap-over shoulder parameters + collar geometry

**Files:**
- Modify: `hardware/pocket_card/case/params.py`
- Modify: `hardware/pocket_card/case/shell_front.py` (`button_station`)
- Modify: `hardware/pocket_card/case/coupon.py` (`collar`, `cap`)
- Test: regenerate coupon STL; extend `checks.py` travel math

- [ ] **Step 1: Add shoulder parameters to `params.py`**

Immediately under `HARD_STOP_AT` / `CAP_BOSS_GAP`:

```python
# Snap-over collar shoulder (production hard stop). Flange clicks in from the
# PCB side over a ramp; the flat top of the lip stops travel at HARD_STOP_AT.
SHOULDER_RADIAL = 0.35   # ASSUMED  how far the lip intrudes past the flange OD
SHOULDER_FLAT_T = 0.40   # ASSUMED  axial thickness of the flat stop face
SHOULDER_RAMP_T = 0.35   # ASSUMED  axial length of the insertion ramp below
```

Document in a one-line comment that these three are coupon-tuned ASSUMED values.

- [ ] **Step 2: Implement shoulder solid helper (shared pattern)**

In `shell_front.py`, after `button_station`’s bore is created and before `return`, subtract a shoulder from the collar add-solid… actually the shoulder is part of the collar **wall** (material kept), so build it as an annular lip **unioned into** the collar boss after the bore cut, OR cut a smaller bore only down to the shoulder plane and a larger bore below.

Preferred construction for a round station (mirror for pills with `slot2D`):

```python
# z=0 is face outer; collar extends to -depth.
# At rest, flange top is at z=-FACE_T.
# After HARD_STOP_AT travel, flange bottom meets the shoulder flat at:
#   z_flat_top = -(FACE_T + CAP_FLANGE_T + HARD_STOP_AT)
flange_d = hole_d + 2 * P.CAP_FLANGE_OS
bore_d = flange_d + 2 * P.COLLAR_CLEAR
shoulder_id = flange_d - 2 * P.SHOULDER_RADIAL
z_flat_top = -(P.FACE_T + P.CAP_FLANGE_T + P.HARD_STOP_AT)
z_flat_bot = z_flat_top - P.SHOULDER_FLAT_T
z_ramp_bot = z_flat_bot - P.SHOULDER_RAMP_T
```

Build the collar with coaxial cuts:

1. Cut `bore_d` from `z=0` down to `z_flat_top` (flange guide).
2. Cut `shoulder_id` from `z_flat_top` down to `z_flat_bot` (flat stop lip).
3. Cut a truncated cone from `shoulder_id` at `z_flat_bot` to `bore_d` at `z_ramp_bot` for the insertion ramp (`circle` → `workplane(offset=...)` → `circle` → `loft`, then cut from collar). If loft fails in the local CadQuery build, cut `bore_d` from `z_flat_bot` to `-depth-1` and chamfer the lip’s lower inner edge instead.
4. Ensure `COLLAR_DEPTH` is deep enough that `-depth <= z_ramp_bot`.

Pill stations use the same planes with `slot2D`: flange slot = pill + 2×`CAP_FLANGE_OS`, bore = flange + 2×`COLLAR_CLEAR`, shoulder slot shrunk by `SHOULDER_RADIAL` per side.

- [ ] **Step 3: Update `coupon.py` collar the same way**

`coupon.collar()` must call the same geometry rules (copy helper into a small shared function in a new `collar_geo.py` **only if** duplication exceeds ~40 lines; otherwise duplicate once with matching comments — YAGNI on a third file until the second copy lands).

- [ ] **Step 4: Remove production skirt-stop from `coupon.cap`**

In `coupon.py` `cap()`:

- Keep head, flange, flats, and boss (`circle(1.5).extrude(-P.CAP_BOSS_GAP)`).
- **Delete** the skirt union (`skirt_len` / `circle(3.0)` ring). Hard stop is the collar shoulder now.
- Optionally keep a very short ≤0.2 mm coaxial tip on the boss only if needed for print adhesion — not a stop.

- [ ] **Step 5: Replace tautological hard-stop checks with real gates**

**Do not** compare an expression to itself. Implement:

```python
def check_shoulder_params():
    print("\nshoulder params (can fail)")
    need = P.CAP_FLANGE_T + P.HARD_STOP_AT + P.SHOULDER_FLAT_T + P.SHOULDER_RAMP_T
    check("COLLAR_DEPTH covers shoulder", P.COLLAR_DEPTH, need, 0.0)
    # allow COLLAR_DEPTH >= need (check() is abs tol — use explicit inequality)
    if P.COLLAR_DEPTH + 1e-9 < need:
        print(f"   FAIL  COLLAR_DEPTH {P.COLLAR_DEPTH} < shoulder stack {need}")
        FAILURES.append("COLLAR_DEPTH")
    else:
        print(f"   PASS  COLLAR_DEPTH {P.COLLAR_DEPTH:.2f} >= {need:.2f}")
    for label, hole_d in (("dir", P.DIR_CAP_D), ("ab", P.AB_CAP_D),
                          ("reset", P.RESET_CAP_D)):
        flange_d = hole_d + 2 * P.CAP_FLANGE_OS
        bore_d = flange_d + 2 * P.COLLAR_CLEAR
        sid = flange_d - 2 * P.SHOULDER_RADIAL
        ok = 0 < sid < bore_d
        print(f"   {'PASS' if ok else 'FAIL'}  {label} shoulder_id {sid:.2f} "
              f"in (0, {bore_d:.2f})")
        if not ok:
            FAILURES.append(f"shoulder_id {label}")

def check_skqg_fits_bore():
    print("\nskqg body vs collar bore")
    stations = [
        ("dir", P.DIR_CAP_D + 2 * P.CAP_FLANGE_OS + 2 * P.COLLAR_CLEAR),
        ("ab", P.AB_CAP_D + 2 * P.CAP_FLANGE_OS + 2 * P.COLLAR_CLEAR),
        ("reset", P.RESET_CAP_D + 2 * P.CAP_FLANGE_OS + 2 * P.COLLAR_CLEAR),
        ("menu_narrow", P.PILL_W + 2 * P.CAP_FLANGE_OS + 2 * P.COLLAR_CLEAR),
    ]
    for name, bore in stations:
        gap = bore - P.TACT_OUTLINE
        ok = gap >= 0.2
        print(f"   {'PASS' if ok else 'FAIL'}  {name}: bore {bore:.2f} - "
              f"body {P.TACT_OUTLINE:.2f} = {gap:+.2f} mm (want >= +0.20)")
        if not ok:
            FAILURES.append(f"bore {name}")

def check_shoulder_in_coupon_stl(tri):
    """Shoulder flat present in exported coupon (not a params identity)."""
    print("\nshoulder in coupon_plate.stl")
    z_want = -(P.FACE_T + P.CAP_FLANGE_T + P.HARD_STOP_AT)
    cx, cy = 0.0, 11.0   # coupon.LADDER_X[2], ROW1_Y — confirm against export
    flange_d = P.DIR_CAP_D + 2 * P.CAP_FLANGE_OS
    bore_d = flange_d + 2 * P.COLLAR_CLEAR
    sid = flange_d - 2 * P.SHOULDER_RADIAL
    verts = tri.reshape(-1, 3)
    d = np.hypot(verts[:, 0] - cx, verts[:, 1] - cy)
    ann = (d >= sid / 2 - 0.05) & (d <= bore_d / 2 + 0.05)
    zs = verts[ann, 2]
    near = zs[(zs > z_want - 0.15) & (zs < z_want + 0.15)]
    ok = len(near) >= 20
    print(f"   {'PASS' if ok else 'FAIL'}  annulus verts near z={z_want:.2f}: "
          f"{len(near)} (want >= 20)")
    if not ok:
        FAILURES.append("shoulder missing in STL")
```

Call `check_shoulder_params` and `check_skqg_fits_bore` from `main()` before STL
load; call `check_shoulder_in_coupon_stl(tri)` after `load_tris`.

**Delete** any tautological `check_hard_stop_stack` that only mirrors identities.

- [ ] **Step 6: Rebuild coupon and run checks**

```bash
.venv/bin/python coupon.py
.venv/bin/python checks.py
```

Expected: coupon exports; existing plate checks still pass; new stack/stop checks PASS. If collar depth is too shallow for shoulder+ramp, increase `COLLAR_DEPTH` until `FACE_T + COLLAR_DEPTH` reaches past `z_ramp_bot` and re-run.

- [ ] **Step 7: Commit**

```bash
git add hardware/pocket_card/case/params.py hardware/pocket_card/case/shell_front.py \
        hardware/pocket_card/case/coupon.py hardware/pocket_card/case/checks.py
git commit -m "Add snap-over collar hard stops; drop skirt-to-PCB stop."
```

---

### Task 3: Controller PCB — SKQG on front, JSTs on back

**Files:**
- Modify: `hardware/pocket_card/case/params.py` (connector coordinates)
- Modify: `hardware/pocket_card/case/pcb.py`
- Modify: `hardware/pocket_card/case/checks.py` (pocket clearance)
- Test: regenerate `out/pcb/pocket_card_controller.kicad_pcb` under KiCad’s Python

- [ ] **Step 1: Define back-side connector anchors in `params.py`**

Cell fence ends near `BATT_X + CELL_W + BATT_CLEAR` ≈ 59.6 mm. Driver centre is `(GRILLE_X, GRILLE_Y)` = (76, 80). Place the cluster in the open band left of the driver and right of the cell:

```python
# Module interconnects live on the PCB BACK (B.Cu), right-rear wiring pocket.
# y is still device/face coordinates (KiCad Y-down matches params).
CONN_I2C     = (74.0, 58.0)   # ASSUMED  4P GH — tune after cable dress
CONN_EXP     = (74.0, 65.0)   # ASSUMED  4P GH
CONN_BAT_IN  = (74.0, 72.0)   # ASSUMED  2P GH from cell
CONN_BAT_OUT = (74.0, 79.0)   # ASSUMED  2P GH to module BAT
CONN_SIDE    = "B.Cu"         # DECIDED
```

GH courtyard is 6.4 mm tall / up to 9.46 mm wide: use **Δy ≥ 7** and
**x ≈ 74** so the stack clears itself and mounting hole H3 at (65, 56). The
earlier (68, 6 mm pitch) sketch overlapped courtyards and H3.


- [ ] **Step 2: Add B.Cu pocket clearance + SKQG keepout neighbor checks**

**B.Cu pocket (no driver XY keepout):** each `CONN_*` must satisfy:

- `x > BATT_X + CELL_W + BATT_CLEAR + 1.0` (cell fence)
- inside board: `PCB_X+1 … PCB_X+PCB_W-1`, `PCB_Y+1 … PCB_Y+PCB_H-1`
- `CONN_SIDE == "B.Cu"`

Do **not** test against the driver bounding box.

KiCad’s `SW_SPST_SKQG_WithStem` embeds two F.Cu keepouts (from the library
footprint), each a 3×2.6 mm rectangle beside the stem:

- left:  `x ∈ [-4, -1]`, `y ∈ [-1.3, 1.3]` (footprint local, 0° rotation)
- right: `x ∈ [+1, +4]`, `y ∈ [-1.3, 1.3]`

Pads sit at (±3.1, ±1.85), size 1.8×1.1. No tracks/vias/pads/pours in those
zones. Neighboring SKQGs must not have overlapping keepouts (or overlapping
pad copper) at the face pitches.

```python
# From Button_Switch_SMD:SW_SPST_SKQG_WithStem (0° local coords)
SKQG_KEEPOUTS = ((-4.0, -1.0, -1.3, 1.3), (1.0, 4.0, -1.3, 1.3))  # x0,x1,y0,y1
SKQG_PADS = (  # centre x,y, w, h — both nets, four pads
    (-3.1, -1.85, 1.8, 1.1), (3.1, -1.85, 1.8, 1.1),
    (-3.1, 1.85, 1.8, 1.1), (3.1, 1.85, 1.8, 1.1),
)

def _aabb_overlap(a, b):
    return not (a[1] <= b[0] or b[1] <= a[0] or a[3] <= b[2] or b[3] <= a[2])

def _local_box_to_board(cx, cy, rot_deg, x0, x1, y0, y1):
    """Axis-aligned board AABB of a local rect after rotation about (cx,cy)."""
    import math
    r = math.radians(rot_deg)
    c, s = math.cos(r), math.sin(r)
    xs, ys = [], []
    for x, y in ((x0, y0), (x0, y1), (x1, y0), (x1, y1)):
        xs.append(cx + x * c - y * s)
        ys.append(cy + x * s + y * c)
    return (min(xs), max(xs), min(ys), max(ys))

def check_skqg_keepouts():
    print("\nskqg keepouts vs neighbours (params)")
    # rot=0 for all eight in pcb.py unless a later task rotates pills.
    sites = [
        ("UP", P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, 0),
        ("DOWN", P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, 0),
        ("LEFT", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, 0),
        ("RIGHT", P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, 0),
        ("UNDO", P.UNDO_X, P.UNDO_Y, 0),
        ("ACTION", P.ACT_X, P.ACT_Y, 0),
        ("RESET", P.RESET_X, P.RESET_Y, 0),
        ("MENU", P.MENU_X, P.MENU_Y, 0),
    ]
    boxes = []  # (name, kind, aabb)
    for name, cx, cy, rot in sites:
        for i, (x0, x1, y0, y1) in enumerate(SKQG_KEEPOUTS):
            boxes.append((name, f"KO{i}", _local_box_to_board(cx, cy, rot, x0, x1, y0, y1)))
        for i, (px, py, w, h) in enumerate(SKQG_PADS):
            boxes.append((name, f"PAD{i}", _local_box_to_board(
                cx, cy, rot, px - w/2, px + w/2, py - h/2, py + h/2)))
    n_fail = 0
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            n1, k1, a = boxes[i]
            n2, k2, b = boxes[j]
            if n1 == n2:
                continue
            if _aabb_overlap(a, b):
                print(f"   FAIL  {n1}.{k1} overlaps {n2}.{k2}")
                FAILURES.append(f"{n1}.{k1} vs {n2}.{k2}")
                n_fail += 1
    if n_fail == 0:
        print("   PASS  no SKQG keepout/pad AABB overlaps between sites")
```

Implement `check_connector_pocket()` with **only** cell fence, board outline, and
`CONN_SIDE` (see defect #1). Call it and `check_skqg_keepouts` from `main()`
after `check_skqg_stack()`.

If `check_skqg_keepouts` fails at current face pitches, **stop and report** —
do not silence the check. Fix is either a small site move, a footprint rotation
that separates keepouts, or (last resort) a documented pitch change in params
with owner approval.

- [ ] **Step 3: Run the new checks**

```bash
.venv/bin/python -c "import checks; checks.check_connector_pocket(); checks.check_skqg_keepouts(); import sys; sys.exit(1 if checks.FAILURES else 0)"
```

Expected after params/connectors exist: both PASS. If a keepout pair fails, fix pitch or rotate one footprint before committing the PCB — do not weaken the check.

- [ ] **Step 4: Rework `pcb.py` footprints and layers**

Replace tact footprint selection:

```python
TACT = ("Button_Switch_SMD", "SW_SPST_SKQG_WithStem")
# Menu pill bore is narrow; SKQG 5.2 mm square still clears a 5.60 bore with
# margin if the collar is rebuilt for SKQG. Use the same footprint on all eight.
```

In the switch loop, always use `TACT` (delete `TACT_PILL` special case).

Update `CONNECTORS` to read positions from params:

```python
CONNECTORS = [
    ("J_I2C", 4, *P.CONN_I2C, "3V3/GND/SCL/SDA -- to module I2C"),
    ("J_EXP", 4, *P.CONN_EXP, "IO2 interrupt -- to module expansion"),
    ("J_BAT_IN", 2, *P.CONN_BAT_IN, "from cell"),
    ("J_BAT_OUT", 2, *P.CONN_BAT_OUT, "to module BAT"),
]
```

Extend `place()`:

```python
def place(board, lib, name, x, y, ref, rot=0, back=False):
    fp = pcbnew.FootprintLoad(os.path.join(FP, lib + ".pretty"), name)
    if fp is None:
        raise RuntimeError("missing footprint: %s / %s" % (lib, name))
    fp.SetPosition(at(x, y))
    if rot:
        fp.SetOrientationDegrees(rot)
    if back:
        # Flip around the footprint anchor onto B.Cu.
        fp.Flip(fp.GetPosition(), False)
    fp.SetReference(ref)
    board.Add(fp)
    return fp
```

Place connectors with `back=True`. Keep switches/expander/slides on the front (`back=False`).

Update the file header comment: component side F.Cu faces buttons; module IO is on B.Cu in the right-rear pocket per the SKQG amendatory spec.

- [ ] **Step 5: Regenerate the PCB**

```bash
/Users/stephenlavelle/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3 pcb.py
```

Expected: saves `out/pcb/pocket_card_controller.kicad_pcb`; printout shows eight `SW_SPST_SKQG_WithStem` and four JST refs at the new XY. Open in KiCad and confirm JSTs are on **B.Cu** (hang into the rear cavity / wiring pocket, not the button cavity).

- [ ] **Step 6: Re-run `checks.py` (params gates + STL gates)**

```bash
.venv/bin/python coupon.py
.venv/bin/python checks.py
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add hardware/pocket_card/case/params.py hardware/pocket_card/case/pcb.py \
        hardware/pocket_card/case/checks.py \
        hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb
git commit -m "Place SKQG on front and module JSTs on PCB back."
```

(If the generated `.kicad_pcb` is gitignored, omit it and commit only the generators.)

---

### Task 3b: Re-route controller PCB and clear DRC

**Files:**
- Modify: `hardware/pocket_card/case/pcb_route.py` (and/or manual KiCad session)
- Modify: `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb`
- Test: KiCad DRC report

Moving four GH connectors to B.Cu invalidates much of the existing front copper.
The board currently sits around **~34 DRC errors** and is not orderable; this
task is load-bearing, not optional cleanup.

- [ ] **Step 1: Baseline DRC** — open the regenerated board, run DRC, save the
  count and a short list of classes (unconnected, clearance, keepout, edge).

- [ ] **Step 2: Re-route** — update `pcb_route.py` for new connector anchors and
  B.Cu fanout, or route in KiCad. Preserve expander↔switch intent. Respect
  SKQG F.Cu keepout zones (no pour/track through them).

- [ ] **Step 3: DRC clean** — drive to **0 errors**, or a written waive list
  committed next to the board (each waiver one line: code, ref, reason).
  Open connections are not waivable.

- [ ] **Step 4: Commit** with message
  `Route Pocket Card controller after SKQG and rear JST move.`

---

### Task 4: Docs pointers and README print notes

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-pocket-card-mechanical-controls-design.md`
- Modify: `hardware/pocket_card/case/README.md`

- [ ] **Step 1: Add supersession banner to the July 31 mechanical spec**

At the top of `2026-07-31-pocket-card-mechanical-controls-design.md`, immediately under the status line, insert:

```markdown
**Amendment (same day):** tact part/height, hard-stop/assembly, and controller
PCB rear keep-out are superseded by
`2026-07-31-pocket-card-skqg-rear-connectors-design.md`. Where the two
disagree, the SKQG/rear-connectors document wins.
```

Do **not** rewrite the whole July 31 body in this task.

- [ ] **Step 2: Update `hardware/pocket_card/case/README.md`**

- Point the design-spec sentence at **both** July 31 docs (mechanical + SKQG amendment).
- Change backing-plane note from `z = 5.50 mm` to `z = 4.50 mm` (`PCB_FRONT_Z`).
- Say the coupon now includes the **snap-over shoulder**; tack **SKQGABE010** (or any SKQG-with-stem) to the backing to prove make-before-stop.
- Note module JSTs are on the **board back** in the right-rear pocket.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-31-pocket-card-mechanical-controls-design.md \
        hardware/pocket_card/case/README.md
git commit -m "Point Pocket Card docs at SKQG and rear-connector amendment."
```

---

### Task 5: Smoke verification before handoff

**Files:** none new — run existing tools

- [ ] **Step 1: Print derived stack**

```bash
cd hardware/pocket_card/case
.venv/bin/python params.py
```

Expected lines include `tact 1.50`, `PCB front 4.50`, `lower zone ~13.70`, `BODY ~13.70`.

- [ ] **Step 2: Full check suite**

```bash
.venv/bin/python coupon.py && .venv/bin/python checks.py
```

Expected: `PASS` throughout; process exit 0.

- [ ] **Step 3: PCB regenerate + visual confirm**

Regenerate with KiCad Python (Task 3 command). In KiCad: eight SKQG on F.Cu at collar centres; four GH connectors on B.Cu around x≈68, clear of **cell fence** (driver XY overlap is allowed on B.Cu).

- [ ] **Step 4: Confirm Task 3b DRC gate is green (or waived in writing)**

- [ ] **Step 5: Final commit only if Step 1–4 left dirty files; otherwise done**

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| SKQGABE010 on all eight, 1.5 mm / 1.57 N / 0.25 mm | Task 1, Task 3 |
| Body ~13.7 mm, PCB front 4.5 mm | Task 1 |
| Snap-over ramped collar shoulder @ ~0.35 mm | Task 2 (+ STL measure) |
| Withdraw skirt→PCB production stop | Task 2 |
| Boss centres stem; no side load (geometry + notes) | Task 2, README |
| SKQG fits every collar bore (≥0.2 mm) | Task 2 / checks |
| JSTs on B.Cu, right-rear pocket, cell flat | Task 3 |
| SKQG land pattern keepouts; no neighbor overlap | Task 3 |
| Board routable / DRC clean after move | Task 3b |
| Speaker still not on this board | unchanged (pcb.py comment already) |
| Coupon prints real snap; clearance ladder kept | Task 2 |
| Parent July 31 pointer | Task 4 |
| Validation gates 1–3 automated where possible; gate 4 (module sample) remains manual | Tasks 1–3 + README |

## Out of plan (manual / later)

- Physical resin coupon feel and clearance pick
- Cable length dress on a real ES3C28P
- Menu/Undo XY overlap fix (still open on July 31 face layout)
