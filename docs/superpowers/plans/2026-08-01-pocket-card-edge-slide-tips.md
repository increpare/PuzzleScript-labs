# Pocket Card Edge Slide Tips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PCM12 power/mute slides with JS102011-class right-angle SPDTs, south-edge PCB notches, and shell-captive printed tips so both controls are easy to throw by thumb.

**Architecture:** `params.py` stays numeric truth for switch XY, notch size, tip geometry, and slot Z. `pcb.py` swaps the footprint and emits notched `Edge.Cuts`. A small `slide_tip.py` CadQuery module builds the tip solid and the shell cavity/slot cut; `shell_front.py` and `build_variants.py` consume it. `checks.py` gates pad-to-edge clearance, tip proud, and Z alignment before order STLs ship.

**Tech Stack:** Python 3 + CadQuery (`.venv`), KiCad footprint `Button_Switch_SMD:SW_SPDT_CK_JS102011SAQN`, existing `pcb.py` / `build_pcb.sh` / freerouting path.

**Spec:** `docs/superpowers/specs/2026-08-01-pocket-card-edge-slide-tips-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `hardware/pocket_card/case/params.py` | JS102011 placement, notch dims, tip/slot dims, retire PCM12 slide-cut constants |
| `hardware/pocket_card/case/checks.py` | Pad↔edge clearance, tip proud range, slot Z above PCB front, notch vs pads |
| `hardware/pocket_card/case/pcb.py` | Footprint swap; notched rectangular outline on Edge.Cuts |
| `hardware/pocket_card/case/slide_tip.py` | **Create** — tip solid + cavity/slot cutter in device coords |
| `hardware/pocket_card/case/shell_front.py` | Cut tip cavities/slots instead of PCM12 tunnels; export helpers unchanged |
| `hardware/pocket_card/case/build_variants.py` | Order pack: tip STL(s) + shell with cavities; keep JLC ≤10 files |
| `hardware/pocket_card/case/build_pcb.sh` | Re-run placement → route → DRC after footprint/outline change |
| `hardware/pocket_card/case/README.md` | Tip assembly note (drop in before PCB) |

Do not touch `hardware/card/`. Face SKQG stations and B.Cu JSTs stay as-is.

---

### Task 1: Lock tip / switch params and failing checks

**Files:**
- Modify: `hardware/pocket_card/case/params.py`
- Modify: `hardware/pocket_card/case/checks.py`

- [ ] **Step 1: Add failing checks for the new edge-slide contract**

In `checks.py`, add a pure-params helper (no STL) and call it from `main` early:

```python
def check_edge_slide_tips():
    print("\nedge slide tips (params)")
    # Footprint: KiCad SW_SPDT_CK_JS102011SAQN — pads at y=-2.75, size 1.25×2.5
    # → copper Y ∈ [SW_Y-4.0, SW_Y-1.5] for each site.
    south = P.PCB_Y + P.PCB_H  # 90.0
    for name, x, y in (
        ("POWER", P.POWER_SW_X, P.POWER_SW_Y),
        ("MUTE", P.MUTE_SW_X, P.MUTE_SW_Y),
    ):
        pad_south = y + P.SLIDE_PAD_SOUTH_REL  # -1.5
        clear = south - pad_south
        if clear < 0.5 - 1e-6:
            print(f"   FAIL  {name} pad-edge clear {clear:.2f} < 0.5")
            FAILURES.append(f"{name} pad edge")
        else:
            print(f"   ok    {name} pad-edge clear {clear:.2f}")
        # Paddle tip (fab +Y) must reach into the wall cavity (past south).
        tip_y = y + P.SLIDE_PADDLE_Y_REL
        if tip_y < south - 0.2:
            print(f"   FAIL  {name} paddle tip y={tip_y:.2f} short of edge {south}")
            FAILURES.append(f"{name} paddle short")
        else:
            print(f"   ok    {name} paddle tip y={tip_y:.2f}")

    if not (0.6 - 1e-6 <= P.TIP_PROUD <= 1.0 + 1e-6):
        print(f"   FAIL  TIP_PROUD {P.TIP_PROUD} not in [0.6, 1.0]")
        FAILURES.append("TIP_PROUD")
    else:
        print(f"   ok    TIP_PROUD {P.TIP_PROUD}")

    # Slot/tip Z centered above PCB front (same bug class as old PCM12 cut).
    # Device z: PCB front = -PCB_FRONT_Z; "above" means less negative (toward face).
    z_center = -(P.PCB_FRONT_Z - P.SLIDE_ACTUATOR_Z_ABOVE_PCB)
    pcb_front = -P.PCB_FRONT_Z
    if z_center <= pcb_front + 1e-6:
        print(f"   FAIL  tip Z center {z_center} not above PCB front {pcb_front}")
        FAILURES.append("tip Z")
    else:
        print(f"   ok    tip Z center {z_center:.2f} (PCB front {pcb_front:.2f})")

    check("SLIDE_FP", P.SLIDE_FP_NAME, "SW_SPDT_CK_JS102011SAQN", 0)
```

Adapt `check()` if it only handles floats — for the footprint name, a plain equality is fine.

Run: `.venv/bin/python checks.py` (or the params-only path if `main` still requires STLs — in that case call `check_edge_slide_tips()` before STL loads and exit early on fail).

Expected: **FAIL** on missing `TIP_PROUD` / `SLIDE_PAD_SOUTH_REL` / wrong `POWER_SW_Y` / still-PCM12 names.

- [ ] **Step 2: Replace PCM12 slide constants in `params.py`**

Replace the block from `POWER_SW_X` through `SLIDE_ACTUATOR_Z_ABOVE_PCB` with:

```python
POWER_SW_X = 20.0                  # DECIDED  bottom edge, far left
MUTE_SW_X  = 70.0                  # DECIDED  bottom edge, under grille / clear of Reset
# JS102011SAQN: pads at footprint y=-2.75 size 2.5 → copper to SW_Y-1.5.
# Paddle fab extends to ~+4.25. y=88.0 → pad clear 3.5 mm, paddle tip 92.25
# (into the 1.5 mm wall; tip sled carries the rest proud of BODY_H=93).
POWER_SW_Y = 88.0                  # DECIDED  was 86.5 (PCM12)
MUTE_SW_Y  = 88.0                  # DECIDED

SLIDE_FP_LIB = "Button_Switch_SMD"
SLIDE_FP_NAME = "SW_SPDT_CK_JS102011SAQN"  # DECIDED class; LCSC MPN at import
SLIDE_PAD_SOUTH_REL = -1.5         # DATASHEET/KiCad  pad center -2.75 + half 1.25
SLIDE_PADDLE_Y_REL = 4.25          # ASSUMED  fab/silk +Y extreme of actuator

# Local south-edge notches under each paddle (Edge.Cuts).
SLIDE_NOTCH_W = 10.0               # ASSUMED  along X, clears body courtyard
SLIDE_NOTCH_D = 2.0                # ASSUMED  north from south edge into board

# Shell-captive tip (spec 2026-08-01).
TIP_FACE_X = 6.0                   # ASSUMED  along bottom edge
TIP_FACE_Z = 3.0                   # ASSUMED  aperture / thumb height
TIP_PROUD = 0.8                    # DECIDED  in [0.6, 1.0]
TIP_TRAVEL = 2.0                   # ASSUMED  switch throw class; confirm on MPN
TIP_SLACK = 0.2                    # ASSUMED  each end of slot
TIP_POCKET_PLAY = 0.25             # ASSUMED  fork clearance on paddle
TIP_RAIL_T = 0.8                   # ASSUMED  captive rail thickness in wall
# Slot length along edge = face + travel + 2*slack
TIP_SLOT_X = TIP_FACE_X + TIP_TRAVEL + 2 * TIP_SLACK  # 8.4
TIP_SLOT_Z = TIP_FACE_Z + 0.4      # ASSUMED  vertical clearance in wall
TIP_SLOT_Y = P.WALL + TIP_PROUD + 1.0  # through wall into cavity

# Actuator / tip Z above F.Cu (JS body ~1.5–2 mm class; tune after 3D).
SLIDE_ACTUATOR_Z_ABOVE_PCB = 1.4   # ASSUMED
```

Delete obsolete `SLIDE_CUT_X/Y/Z` (or keep as aliases to `TIP_SLOT_*` for one commit if grep demands — prefer delete and fix call sites in Task 3).

- [ ] **Step 3: Re-run checks — params section passes**

Run: `.venv/bin/python -c "import checks; checks.FAILURES=[]; checks.check_edge_slide_tips(); print(checks.FAILURES)"`

Expected: `FAILURES == []` for the new asserts (STL checks may still run/fail separately if invoked via full `main`).

- [ ] **Step 4: Commit**

```bash
git add hardware/pocket_card/case/params.py hardware/pocket_card/case/checks.py
git commit -m "$(cat <<'EOF'
Lock JS102011 edge-slide and tip params with clearance checks.

EOF
)"
```

---

### Task 2: Swap PCB footprint and emit south-edge notches

**Files:**
- Modify: `hardware/pocket_card/case/pcb.py`
- Test: `python3 pcb.py` headless

- [ ] **Step 1: Point `SLIDE` at JS102011**

In `pcb.py`:

```python
SLIDE = (P.SLIDE_FP_LIB, P.SLIDE_FP_NAME)
```

Remove the hard-coded `SW_SPDT_PCM12` tuple.

- [ ] **Step 2: Replace rectangular `outline_sexpr()` with a notched south edge**

Build the outline as a closed polyline. South edge runs from `(x0,y1)` to `(x1,y1)` except two rectangular notches centered on `POWER_SW_X` and `MUTE_SW_X`:

```python
def _notch_intervals():
    """Return sorted (x0, x1) notch spans on the south edge (device X)."""
    half = P.SLIDE_NOTCH_W / 2
    spans = [
        (P.POWER_SW_X - half, P.POWER_SW_X + half),
        (P.MUTE_SW_X - half, P.MUTE_SW_X + half),
    ]
    return sorted(spans)


def outline_points():
    x0, y0 = P.PCB_X, P.PCB_Y
    x1, y1 = P.PCB_X + P.PCB_W, P.PCB_Y + P.PCB_H
    yn = y1 - P.SLIDE_NOTCH_D
    pts = [(x0, y0), (x1, y0), (x1, y1)]
    # Walk south edge right→left, dropping into notches.
    cursor = x1
    for nx0, nx1 in reversed(_notch_intervals()):
        if cursor > nx1:
            pts.append((cursor, y1))
            pts.append((nx1, y1))
        pts.extend([(nx1, yn), (nx0, yn), (nx0, y1)])
        cursor = nx0
    pts.append((cursor, y1))
    pts.append((x0, y1))
    pts.append((x0, y0))
    return pts


def outline_sexpr():
    pts = outline_points()
    parts = []
    for a, b in zip(pts, pts[1:]):
        parts.append(
            "\t(gr_line\n"
            "\t\t(start %s %s)\n"
            "\t\t(end %s %s)\n"
            "\t\t(stroke\n"
            "\t\t\t(width 0.1)\n"
            "\t\t\t(type default)\n"
            "\t\t)\n"
            "\t\t(layer \"Edge.Cuts\")\n"
            "\t\t(uuid \"%s\")\n"
            "\t)" % (a[0], a[1], b[0], b[1], _uid())
        )
    return "\n".join(parts)
```

Mirror the same polygon into the pcbnew `USE_PCBNEW=1` path if it still draws a plain rectangle (search `Edge_Cuts` / `outline` in `pcb.py`).

- [ ] **Step 3: Regenerate board and confirm footprint names**

Run: `python3 pcb.py`

Expected stdout includes `SW_SPDT_CK_JS102011SAQN` (or library path) and outline still ~80.5×37 with notches. Open `out/pcb/pocket_card_controller.kicad_pcb` (or grep):

```bash
rg -n "JS102011|PCM12|Edge.Cuts" hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb | head -40
```

Expected: JS102011 present; PCM12 absent; more than 4 Edge.Cuts segments.

- [ ] **Step 4: Commit**

```bash
git add hardware/pocket_card/case/pcb.py hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb
git commit -m "$(cat <<'EOF'
Swap power/mute to JS102011 and notch the PCB south edge.

EOF
)"
```

(Include other pcb.py-generated companions only if the script always rewrites them together.)

---

### Task 3: CadQuery tip solid + shell cavities

**Files:**
- Create: `hardware/pocket_card/case/slide_tip.py`
- Modify: `hardware/pocket_card/case/shell_front.py`

- [ ] **Step 1: Create `slide_tip.py`**

```python
"""Shell-captive tip for bottom-edge JS102011-class slides."""
import cadquery as cq
import params as P


def tip_solid():
    """One tip in device coords, centered at origin, thumb face +Y.

    +Y is toward the outside of the bottom wall. Rails extend -Y into the
    wall; a rectangular pocket on the -Y face accepts the switch paddle.
    """
    face = (cq.Workplane("XZ")
            .box(P.TIP_FACE_X, P.TIP_FACE_Z, P.TIP_PROUD + 0.2,
                 centered=(True, True, False))
            .translate((0, 0, 0)))
    # Body through the wall thickness, slightly taller than the face for rails.
    body = (cq.Workplane("XY")
            .box(P.TIP_FACE_X - 0.4, P.WALL + 0.6, P.TIP_FACE_Z - 0.4,
                 centered=(True, False, True))
            .translate((0, -P.WALL, 0)))
    # Paddle pocket: open to -Y (toward PCB), sized with TIP_POCKET_PLAY.
    pocket_w = 2.0 + P.TIP_POCKET_PLAY   # ASSUMED paddle width class
    pocket_h = 1.2 + P.TIP_POCKET_PLAY
    pocket_d = 2.5
    pocket = (cq.Workplane("XY")
              .box(pocket_w, pocket_d, pocket_h, centered=(True, False, True))
              .translate((0, -P.WALL - 0.2, 0)))
    return face.union(body).cut(pocket)


def tip_cavity_at(x, y_sw):
    """Void cut from the front shell: slot + tip travel envelope at switch X.

    y_sw is the switch footprint Y; the slot straddles the bottom wall
    (outer face at BODY_H).
    """
    z_c = -(P.PCB_FRONT_Z - P.SLIDE_ACTUATOR_Z_ABOVE_PCB)
    # Slot box: X = travel envelope, Y through wall + proud, Z = tip height.
    y0 = P.BODY_H - P.WALL - 0.5
    return (cq.Workplane("XY")
            .box(P.TIP_SLOT_X, P.TIP_SLOT_Y, P.TIP_SLOT_Z,
                 centered=(True, False, True))
            .translate((x, y0, z_c)))


def edge_tip_openings():
    cuts = tip_cavity_at(P.POWER_SW_X, P.POWER_SW_Y)
    cuts = cuts.union(tip_cavity_at(P.MUTE_SW_X, P.MUTE_SW_Y))
    return cuts
```

Tune boolean order if CadQuery complains about non-manifold unions — keep one solid tip and one cavity cutter.

- [ ] **Step 2: Wire cavities into `shell_front.edge_openings()`**

Replace the PCM12 `_slide_cut` block with:

```python
import slide_tip

# ...
cuts = cuts.union(slide_tip.edge_tip_openings())
```

Keep the USB-C cut unchanged.

- [ ] **Step 3: Build front shell and eyeball Z**

Run: `.venv/bin/python -c "import shell_front, cq; s=shell_front.build(); cq.exporters.export(s,'out/_tip_shell_check.stl'); print(s.val().BoundingBox())"`

Expected: builds without error; openings near y=93 at z≈−3.1 (PCB front −4.5, actuator +1.4).

- [ ] **Step 4: Commit**

```bash
git add hardware/pocket_card/case/slide_tip.py hardware/pocket_card/case/shell_front.py
git commit -m "$(cat <<'EOF'
Add shell-captive edge-slide tip cavities for power and mute.

EOF
)"
```

---

### Task 4: Order pack — tip STLs + regenerated shells

**Files:**
- Modify: `hardware/pocket_card/case/build_variants.py`

- [ ] **Step 1: Export a sprued pair of tips**

In `build_variants.py` `main()`, after shell exports:

```python
import slide_tip

tips = slide_tip.tip_solid()
tips = tips.union(slide_tip.tip_solid().translate((12.0, 0, 0)))
# Optional 1.5 mm sprue between them at flange height
sprue = (cq.Workplane("XY")
         .box(12.0 - P.TIP_FACE_X, 1.2, 1.2, centered=(False, True, True))
         .translate((P.TIP_FACE_X / 2, 0, 0)))
tips = tips.union(sprue)
cq.exporters.export(tips, os.path.join(OUT, "edge_tips.stl"))
v = vol(tips)
total += v
lines.append(f"edge_tips.stl                   {v:6.2f} cm3   x1   (power+mute sprued)")
```

File count: previous fab set was 6 (2 shells + 4 capsets) + 1 preview. Adding `edge_tips.stl` → 7 fab ≤ 10.

- [ ] **Step 2: Rebuild order pack**

Run: `.venv/bin/python build_variants.py`

Expected: `shell_front.stl`, `edge_tips.stl` listed; total fab volume prints; no exception.

- [ ] **Step 3: Commit**

```bash
git add hardware/pocket_card/case/build_variants.py \
  hardware/pocket_card/case/out/order/shell_front.stl \
  hardware/pocket_card/case/out/order/shell_back.stl \
  hardware/pocket_card/case/out/order/shell_front_with_caps.stl \
  hardware/pocket_card/case/out/order/edge_tips.stl \
  hardware/pocket_card/case/out/order/capset_v*.stl
git commit -m "$(cat <<'EOF'
Ship edge-slide tips in the Pocket Card order pack.

EOF
)"
```

---

### Task 5: Re-route PCB and clear DRC

**Files:**
- Modify: routed artifacts under `hardware/pocket_card/case/out/pcb/` via `build_pcb.sh`
- Possibly: `hardware/pocket_card/case/pcb_reroute.py` if pour/outline helpers assume a rectangle

- [ ] **Step 1: Full PCB rebuild**

Run from `hardware/pocket_card/case`:

```bash
./build_pcb.sh
```

Expected: placement uses JS102011; freerouting completes; DRC **0 errors / 0 unconnected** (same bar as post-Task-3b SKQG board). If notches clip a pour or trace, fix in `pcb_reroute.py` / manual keepout — do not waive notch clearance.

- [ ] **Step 2: Confirm no PCM12 left**

```bash
rg -n "PCM12" hardware/pocket_card/case --glob '!out/pcb/*.ses' --glob '!out/pcb/*.dsn' | head
```

Expected: no hits in `*.py` / `*.kicad_pcb` (comments in old docs OK).

- [ ] **Step 3: Commit routed board**

```bash
git add hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb \
  hardware/pocket_card/case/out/pcb/pocket_card_controller.stl \
  hardware/pocket_card/case/out/pcb/drc.json \
  hardware/pocket_card/case/out/pcb/exported.stl \
  hardware/pocket_card/case/out/pcb/exported.step
git commit -m "$(cat <<'EOF'
Re-route controller after JS102011 edge slides and notches.

EOF
)"
```

---

### Task 6: README + parent-spec pointer + full checks

**Files:**
- Modify: `hardware/pocket_card/case/README.md`
- Modify: `docs/superpowers/specs/2026-07-31-pocket-card-mechanical-controls-design.md` (one-line pointer on bottom-edge slides)
- Test: `.venv/bin/python checks.py`

- [ ] **Step 1: Document tip assembly**

Add a short bullet to the case README assembly section:

```markdown
- Power/mute tips: drop the two resin tips into the front-shell bottom slots
  from the inside before seating the controller PCB. No glue. Paddles of the
  JS102011-class slides engage the tip pockets; the shell takes end-stop.
```

- [ ] **Step 2: Point mechanical-controls edge section at the new spec**

Near the “Bottom | Power switch…” table, add: superseded for part/tips by `2026-08-01-pocket-card-edge-slide-tips-design.md` (XY meaning unchanged).

- [ ] **Step 3: Run full `checks.py`**

Run: `.venv/bin/python checks.py`

Expected: `all checks passed` (regenerate any coupon STLs the suite needs first if it complains about stale exports).

- [ ] **Step 4: Commit**

```bash
git add hardware/pocket_card/case/README.md \
  docs/superpowers/specs/2026-07-31-pocket-card-mechanical-controls-design.md
git commit -m "$(cat <<'EOF'
Document edge-slide tip assembly and link parent controls spec.

EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Drop PCM12 → JS102011 class | 1, 2 |
| Same footprint power + mute | 1, 2 |
| South-edge notches, pad ≥0.5 mm | 1, 2 |
| Shell-captive printed tips | 3, 4 |
| Tip ~6×3, proud 0.6–1.0 | 1, 3 |
| Z on paddle above F.Cu | 1, 3 |
| Shell takes end-stop | 3 (rails/slot) |
| Assembly: tips then PCB | 6 |
| Order STLs include tips | 4 |
| DRC clean | 5 |
| XY meaning unchanged | 1 (X locked) |

## Placeholder / consistency self-check

- No TBD steps; ASSUMED dims are named constants tuned after MPN/3D import.
- `SLIDE_FP_NAME` / `TIP_*` / `SLIDE_NOTCH_*` names are consistent across tasks.
- `edge_openings` no longer references deleted `SLIDE_CUT_*` after Task 1 delete + Task 3 wire-up — do Task 1 aliases **or** Task 3 in the same working tree before running the shell build if splitting commits hurts CI locally.
