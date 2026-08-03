# Center-gap speaker / IO-chip swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On branch `explore/center-speaker-swap`, relocate the speaker grille and driver into the face gap between the d-pad and Undo/Action under a ~1 mm blister, move MCP23017 into the freed bottom-right, and regenerate shell/PCB previews so the look can be judged — without a production re-route.

**Architecture:** Params remain the single source of truth. Front-shell blister + grille/driver seat follow `GRILLE_*` / `FACE_BUMP_*`. PCB outline drops the BR notch when `PCB_DRIVER_NOTCH_*` are `None`; U1 XY moves to the old speaker corner. New checks enforce blister↔button clearance and the on-board driver stack before geometry is trusted.

**Tech Stack:** CadQuery / OCP, Python params + `checks.py`, headless `pcb.py` KiCad sexpr writer, existing `build_variants.py` / `place_preview.py`.

**Spec:** `docs/superpowers/specs/2026-08-03-pocket-card-center-speaker-swap-design.md`

---

## File map

| File | Role |
|---|---|
| `hardware/pocket_card/case/params.py` | Grille centre, bump height/plan, U1 seat, disable notch |
| `hardware/pocket_card/case/checks.py` | Blister↔button invariant; rewrite driver-stack for on-board seat |
| `hardware/pocket_card/case/shell_front.py` | Face blister solid; driver pocket / grille through bump |
| `hardware/pocket_card/case/shell_back.py` | Idle/remove notch-era `driver_backstop()` |
| `hardware/pocket_card/case/pcb.py` | Outline without notch; place U1 at new XY |
| `hardware/pocket_card/case/pcb_route.py` | Update any hard-coded U1=(45,72) comments / via keepouts if they block |
| `hardware/pocket_card/case/free_space.py` | Follows `GRILLE_*` automatically if it only reads params |

Work from repo root or `hardware/pocket_card/case/` as noted. Use the case venv: `.venv/bin/python`.

---

### Task 1: Params — centre grille, bump, U1, retire notch

**Files:**
- Modify: `hardware/pocket_card/case/params.py` (audio / PCB notch / add U1 constants)

- [ ] **Step 1: Add / rewrite the layout constants**

Near the existing `GRILLE_X, GRILLE_Y` and `PCB_DRIVER_NOTCH_*` block, replace/add:

```python
# Center-gap experiment (2026-08-03-pocket-card-center-speaker-swap-design).
# Gap between dir cluster and Undo is ~19.8 mm; vertical 14×20 pill fits with
# ~2.9 mm per side to the driver body. Exact XY may nudge after blister checks.
GRILLE_X, GRILLE_Y = 42.6, 68.8

# Face blister: outer skin locally FACE_BUMP_H proud of z=0. Caps already use
# CAP_PROUD=1.0 — same visual budget. Mechanically need >= 0.5 (DRIVER_T - cavity).
FACE_BUMP_H = 1.0          # DECIDED
FACE_BUMP_MARGIN = 1.0     # DECIDED  blister plan beyond driver body, per side
FACE_BUMP_BTN_CLR = 0.5    # DECIDED  min plan gap blister→cap outer

# MCP23017 seat after the swap (was 45, 72 under the gap).
U1_X, U1_Y = 76.0, 80.0    # DECIDED  seed = old grille centre; tune vs Reset/mute

# Driver no longer dips through the board — disable the BR notch.
PCB_DRIVER_NOTCH_X = None
PCB_DRIVER_NOTCH_Y = None
```

Keep `DRIVER_W/H/T`, `GRILLE_BITMAP`, and mute/power XY unchanged. Leave old notch numeric comments in a short note that the experiment retired them.

- [ ] **Step 2: Sanity-print the gap**

Run:

```bash
cd hardware/pocket_card/case && .venv/bin/python -c "
import params as P
dir_right = P.DIR_CX + P.DIR_RADIUS + P.DIR_CAP_D/2
undo_left = P.UNDO_X - P.AB_CAP_D/2
print('gap', undo_left - dir_right)
print('blister half-W', P.DRIVER_W/2 + P.FACE_BUMP_MARGIN)
print('U1', P.U1_X, P.U1_Y, 'notch', P.PCB_DRIVER_NOTCH_X)
"
```

Expected: gap ≈ 19.8; blister half-W = 8.0; notch `None`.

- [ ] **Step 3: Commit**

```bash
git add hardware/pocket_card/case/params.py
git commit -m "params: centre grille, face bump, U1 BR seat; retire driver notch"
```

---

### Task 2: Failing checks — blister vs buttons + on-board driver stack

**Files:**
- Modify: `hardware/pocket_card/case/checks.py`
- Test: run `checks.py` (expects FAIL until shell/PCB catch up)

- [ ] **Step 1: Add `check_face_bump_vs_buttons()`**

Plan-only clearance first (z collision needs the built blister; add once shell exists). Insert near other driver checks:

```python
def check_face_bump_vs_buttons():
    """No part of the speaker blister may impinge on front controls.

    Spec: 2026-08-03-pocket-card-center-speaker-swap-design.md
    """
    print("\nface blister vs front buttons")
    if getattr(P, "FACE_BUMP_H", 0) <= 1e-9:
        print("   INFO  no face bump; skip")
        return
    bw = P.DRIVER_W / 2 + P.FACE_BUMP_MARGIN
    bh = P.DRIVER_H / 2 + P.FACE_BUMP_MARGIN
    # Axis-aligned blister box vs each cap's outer circle (flange OD).
    caps = [
        ("UP", P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D),
        ("DOWN", P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D),
        ("LEFT", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D),
        ("RIGHT", P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D),
        ("UNDO", P.UNDO_X, P.UNDO_Y, P.AB_CAP_D),
        ("ACT", P.ACT_X, P.ACT_Y, P.AB_CAP_D),
        ("RESET", P.RESET_X, P.RESET_Y, P.RESET_CAP_D),
    ]
    # Menu is a pill: treat as AABB of the pill outline used in shell_front.
    worst, at = 1e9, None
    bx0, bx1 = P.GRILLE_X - bw, P.GRILLE_X + bw
    by0, by1 = P.GRILLE_Y - bh, P.GRILLE_Y + bh
    for name, cx, cy, d in caps:
        r = d / 2 + P.CAP_FLANGE_OS + P.COLLAR_CLEAR
        # Distance from circle centre to blister AABB, then subtract r.
        dx = max(bx0 - cx, 0, cx - bx1)
        dy = max(by0 - cy, 0, cy - by1)
        if bx0 <= cx <= bx1 and by0 <= cy <= by1:
            gap = -r  # centre inside blister
        else:
            gap = (dx * dx + dy * dy) ** 0.5 - r
        if gap < worst:
            worst, at = gap, name
    # Menu pill (horizontal): centre MENU_X/Y, use existing MENU size constants.
    import shell_front as SF
    mw = getattr(P, "MENU_LEN", 12.0) / 2 + P.CAP_FLANGE_OS
    mh = getattr(P, "MENU_W", 3.0) / 2 + P.CAP_FLANGE_OS
    # If MENU_LEN not in params, read from shell_front or hardcode 11.15/3.00
    # from CAP docs — prefer existing constants in params/shell_front.
    ok = worst >= P.FACE_BUMP_BTN_CLR
    print(f"   {'PASS' if ok else 'FAIL'}  blister plan clears buttons "
          f"(tightest {at}: {worst:+.2f} mm, want >= {P.FACE_BUMP_BTN_CLR})")
    if not ok:
        FAILURES.append("face blister impinges on buttons")
```

Wire real Menu dimensions from whatever `shell_front` / `params` already use for the pill (do not invent a second size). Call from `main()`.

- [ ] **Step 2: Rewrite `check_driver_stack()` for on-board seat**

Replace notch/backstop assertions with:

```python
def check_driver_stack():
    """Driver sits on the PCB front under the face blister (no board notch)."""
    print("\ndriver stack (on-board under blister)")
    cavity = P.PCB_FRONT_Z - P.FACE_T
    room = cavity + getattr(P, "FACE_BUMP_H", 0.0)
    ok = room + 1e-9 >= P.DRIVER_T
    print(f"   {'PASS' if ok else 'FAIL'}  room {room:.2f} >= driver {P.DRIVER_T} "
          f"(cavity {cavity:.2f} + bump {getattr(P, 'FACE_BUMP_H', 0):.2f})")
    if not ok:
        FAILURES.append("driver does not fit under blister")
    ok = P.PCB_DRIVER_NOTCH_X is None and P.PCB_DRIVER_NOTCH_Y is None
    print(f"   {'PASS' if ok else 'FAIL'}  board notch retired "
          f"(got {P.PCB_DRIVER_NOTCH_X}, {P.PCB_DRIVER_NOTCH_Y})")
    if not ok:
        FAILURES.append("driver notch still enabled")
    # Driver footprint must lie on board material (inside PCB outline AABB for now).
    dx0 = P.GRILLE_X - P.DRIVER_W / 2
    dy0 = P.GRILLE_Y - P.DRIVER_H / 2
    dx1, dy1 = dx0 + P.DRIVER_W, dy0 + P.DRIVER_H
    ok = (dx0 >= P.PCB_X and dy0 >= P.PCB_Y
          and dx1 <= P.PCB_X + P.PCB_W and dy1 <= P.PCB_Y + P.PCB_H)
    print(f"   {'PASS' if ok else 'FAIL'}  driver footprint on PCB outline AABB")
    if not ok:
        FAILURES.append("driver off the board")
```

- [ ] **Step 3: Run checks — expect blister and/or geometry failures**

```bash
cd hardware/pocket_card/case && .venv/bin/python checks.py 2>&1 | tee /tmp/checks_swap_t2.txt | tail -40
```

Expected: `face blister vs front buttons` and/or driver-related failures until Tasks 3–5 land. Do not “fix” by weakening `FACE_BUMP_BTN_CLR`.

- [ ] **Step 4: Commit**

```bash
git add hardware/pocket_card/case/checks.py
git commit -m "checks: blister vs buttons; on-board driver stack (expect fail until CAD)"
```

---

### Task 3: Front shell — blister, grille, shallow pocket

**Files:**
- Modify: `hardware/pocket_card/case/shell_front.py` (`driver_pocket`, `grille_slots`, `build` path)

- [ ] **Step 1: Add `face_blister()` material**

Stadium (slot) matching the driver, expanded by `FACE_BUMP_MARGIN`, extruded **+z** by `FACE_BUMP_H` from z=0:

```python
def face_blister():
    """Local face rise over the centre grille; outer skin at +FACE_BUMP_H."""
    if getattr(P, "FACE_BUMP_H", 0) <= 1e-9:
        return cq.Workplane("XY")
    w = P.DRIVER_W + 2 * P.FACE_BUMP_MARGIN
    h = P.DRIVER_H + 2 * P.FACE_BUMP_MARGIN
    return (cq.Workplane("XY")
            .slot2D(h, w, 90)
            .extrude(P.FACE_BUMP_H)
            .translate((P.GRILLE_X, P.GRILLE_Y, 0)))
```

Union into the shell **before** cutting grille slots and collar bores.

- [ ] **Step 2: Retarget `driver_pocket()` for blister seating**

Driver front bonds under the blister crown. Effective front plane:

```python
z_face = -(P.FACE_T - P.FACE_BUMP_H)   # was -FACE_T; bump buys depth
z_back = z_face - P.DRIVER_T
z_stop = -(P.PCB_FRONT_Z - 0.05)       # walls stop at board front (on-board)
```

Update the docstring: no board notch; walls locate only; lead notches still OK. Keep collar reliefs for Undo/Action/Reset — more important now that the pocket sits between clusters.

- [ ] **Step 3: Grille cuts through blister + face**

Ensure `grille_slots()` extrude deep enough to pierce `FACE_BUMP_H + FACE_T + 0.5` (cut from `+FACE_BUMP_H` downward). If slots currently start at z=0 only, move the cutter origin to `P.FACE_BUMP_H`.

- [ ] **Step 4: Build front shell**

```bash
cd hardware/pocket_card/case && .venv/bin/python shell_front.py
```

Expected: writes `out/shell_front.stl` / `.step` without error; blister visible at centre gap.

- [ ] **Step 5: Re-run blister check**

```bash
.venv/bin/python checks.py 2>&1 | sed -n '/face blister/,/driver stack/p'
```

Expected: `face blister vs front buttons` **PASS**. If FAIL, shrink `FACE_BUMP_MARGIN` or nudge `GRILLE_X/Y` — never move buttons.

- [ ] **Step 6: Commit**

```bash
git add hardware/pocket_card/case/shell_front.py hardware/pocket_card/case/params.py
git commit -m "shell_front: centre face blister and on-board driver pocket"
```

---

### Task 4: PCB — drop notch, move U1

**Files:**
- Modify: `hardware/pocket_card/case/pcb.py` (U1 placement ~383 and ~469)
- Modify: `hardware/pocket_card/case/pcb_route.py` if U1 coords are hard-coded
- Modify: `hardware/pocket_card/case/silk.py` if U1 keepout is hard-coded at (45,72)

- [ ] **Step 1: Confirm outline ignores notch when `None`**

`outline_edges()` / `outline_points()` already branch on `PCB_DRIVER_NOTCH_X is None`. No outline rewrite needed if Task 1 set both to `None`. Quick check:

```bash
.venv/bin/python -c "
import pcb
e = pcb.outline_edges()
print(len(e), 'edges; notch disabled => full BR arc present')
print(e[3] if len(e)>3 else e)
"
```

- [ ] **Step 2: Place U1 from params**

Replace both hard-coded `(45.0, 72.0)` sites with `(P.U1_X, P.U1_Y)`. Same for any silk/route helpers.

- [ ] **Step 3: Regenerate board**

```bash
.venv/bin/python pcb.py
```

Expected: `out/pcb/pocket_card_controller.kicad_pcb` updates; U1 at ~76,80; Edge.Cuts has bottom-right arc again (no notch polyline).

- [ ] **Step 4: Commit**

```bash
git add hardware/pocket_card/case/pcb.py hardware/pocket_card/case/pcb_route.py hardware/pocket_card/case/silk.py hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb
git commit -m "pcb: retire driver notch; move U1 into freed bottom-right"
```

---

### Task 5: Back shell — retire notch-era backstop

**Files:**
- Modify: `hardware/pocket_card/case/shell_back.py` (`driver_backstop`, `build_back`)

- [ ] **Step 1: Stop adding the backstop**

In `build_back()`, remove `driver_backstop()` from the material union (or guard with `if P.PCB_DRIVER_NOTCH_X is not None`). Leave the function stub with a one-line “retired — driver on PCB under face blister” docstring so git history stays searchable.

- [ ] **Step 2: Rebuild back**

```bash
.venv/bin/python shell_back.py
```

- [ ] **Step 3: Commit**

```bash
git add hardware/pocket_card/case/shell_back.py
git commit -m "shell_back: drop driver backstop (driver no longer notched through PCB)"
```

---

### Task 6: Sweep remaining notch / BR-driver assumptions

**Files:**
- Modify: `hardware/pocket_card/case/checks.py` (any Reset-vs-driver gap that assumed BR grille; mount-in-notch guards)
- Modify: `hardware/pocket_card/case/free_space.py` only if it special-cases the notch

- [ ] **Step 1: Grep for stale assumptions**

```bash
cd hardware/pocket_card/case && rg -n "PCB_DRIVER_NOTCH|backstop|GRILLE_X|76\.0.*80|45\.0.*72" checks.py free_space.py shell_*.py pcb.py
```

Update each hit: Reset-vs-driver clearance should now be vs U1 courtyard or simply unused; “parts in notch” checks deleted; bond/grille tests keep using `GRILLE_*` (they auto-follow the new centre).

- [ ] **Step 2: Full check suite**

```bash
.venv/bin/python checks.py 2>&1 | tee /tmp/checks_swap_full.txt | tail -60
```

Expected: `all checks passed`. If blister plan is tight, tune `FACE_BUMP_MARGIN` / `GRILLE_*` and re-run — do not lower `FACE_BUMP_BTN_CLR` below 0.5 without an explicit note in the spec.

- [ ] **Step 3: Commit**

```bash
git add hardware/pocket_card/case/checks.py hardware/pocket_card/case/free_space.py
git commit -m "checks: clear notch-era driver assumptions for centre swap"
```

---

### Task 7: Previews + visual sign-off pack

**Files:**
- Regenerate: `out/shell_front.*`, `out/order/*`, `out/pcb/*_placed.*` via existing scripts
- Optional: `tools/render_shell.py` on `shell_front.stl` for a face-on PNG

- [ ] **Step 1: Rebuild order / preview meshes**

```bash
cd hardware/pocket_card/case && .venv/bin/python build_variants.py
```

- [ ] **Step 2: Face-on render of the front shell**

```bash
MPLCONFIGDIR=/tmp/mpl .venv/bin/python tools/render_shell.py out/order/shell_front.stl
# or out/shell_front.stl — write to out/render_shell.png / a dedicated name if the tool overwrites
```

Confirm visually: grille in the centre gap; no blister eating Undo/dir caps; BR corner no longer has the speaker chamber.

- [ ] **Step 3: Commit outputs the branch needs for eyeballing**

```bash
git add hardware/pocket_card/case/out/shell_front.stl hardware/pocket_card/case/out/shell_front.step \
        hardware/pocket_card/case/out/shell_back.stl hardware/pocket_card/case/out/order \
        hardware/pocket_card/case/out/render_shell.png
git commit -m "out: centre-speaker-swap preview meshes"
```

- [ ] **Step 4: Stop — human review**

Do **not** merge to `master`. Paste the render path / STL locations for the owner. Success = owner can keep, tweak, or revert from visuals.

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Centre-gap grille | Task 1, 3 |
| On-PCB driver + ~1 mm blister | Task 1, 3, 2 (`check_driver_stack`) |
| Blister must not impinge buttons | Task 2 (`check_face_bump_vs_buttons`), Task 3 step 5 |
| U1 → freed BR | Task 4 |
| Retire BR notch / backstop | Task 1, 4, 5, 6 |
| Mute/power stay | No task (params untouched) |
| Experimental branch, no prod re-route | Branch already; Task 4 skips route cleanup beyond U1 XY |
| Checks + STL sign-off | Task 6, 7 |
