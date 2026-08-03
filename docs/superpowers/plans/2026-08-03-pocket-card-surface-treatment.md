# Pocket Card Wrapped Brick Surface Treatment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the pocket_card enclosure's brick relief out of Blender boolean cutters and into the CadQuery build, as proud relief that wraps continuously across the side arc and the shell split.

**Architecture:** A new `texture.py` module owns the pattern: it turns a 5×5 sprite tile from `params.py` into a 2D face, tiles it phase-locked to a shared origin, and intersects the extruded result with a constant-thickness *outward* skin so relief depth stays constant measured perpendicular to the surface. `side_arc._envelope` gains negative-inset (outward offset) support to produce that skin. `shell_front.py` and `shell_back.py` each union their zone's relief in before the final `clip_to_envelope`. Verification lives in `checks.py` against the exported STL, matching how everything else in this directory is verified.

**Tech Stack:** Python 3.12, CadQuery (OCP/OCC kernel), NumPy. All commands run from `hardware/pocket_card/case/` using its own `.venv`.

## Global Constraints

- **Numeric truth lives in `params.py`.** Never hardcode a dimension in `texture.py`, `shell_front.py`, `shell_back.py`, or `checks.py` that belongs in `params.py`.
- `TEX_PIXEL_FINE = 1.0` (front face), `TEX_PIXEL_COARSE = 0.5` (walls, back roll) — mm per sprite pixel.
- `TEX_RELIEF = 0.40` — proud height, mm. This is an ASSUMED value the coupon settles.
- `TEX_TOP_CHAMFER = 0.2` — chamfer on brick tops.
- `TEX_KEEPOUT = 1.0` — radial clearance from every button station collar OD.
- `TEX_BOTTOM_CLEAR = 1.9` — untextured band before the flat bottom face.
- Relief is **proud** (added outside the nominal envelope), never cut. `WALL = 1.5`, `FACE_T = 1.5` and `LAP_FRONT_T = 0.70` must be unchanged by anything in this plan.
- The flat bottom face is **never** textured.
- Both shells generate their pattern from `TEX_ORIGIN` so courses register across the split.
- **No pytest in this venv.** Tests are plain-assert scripts run with `.venv/bin/python`, following the `checks.py` idiom (a `FAILURES` list, `sys.exit` on failure). Do not add pytest as a dependency.
- **No `cd`.** Use `python -C`-style absolute paths or `make` targets; every `cd` costs the user a permission prompt. Run scripts as `hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/<script>.py` from the repo root.
- Commit after every task.

### 2026-08-04 execution amendment

Tasks 1–6 have landed through commit `4ab6498f`. The implementation groups
adjacent sprite pixels into the intended staggered `4 × 2` bricks and chamfers
connected bricks per solid. Do not restore the older Task 6 sample's one-pixel
strip construction.

Front integration proved that an exact outside-only skin is not a boolean bond:
ordinary union produced 136 solids and fuzzy union still produced 48. The
approved design amendment adds a 0.05 mm surface-normal root overlap, trims all
hard openings before union, and requires each exported shell to be one solid.
Resume at Task 6A, then redo Task 7. Where older Task 6/7 sample code conflicts
with Tasks 6A/7 below, the amended tasks are authoritative.

## File Structure

| File | Responsibility |
|---|---|
| `hardware/pocket_card/case/params.py` | **Modify.** Add the `TEX_*` block. Numeric truth only — no geometry. |
| `hardware/pocket_card/case/side_arc.py` | **Modify.** `_envelope` / `_plan_solid` accept negative inset (outward offset); relax the bbox guard by the offset. |
| `hardware/pocket_card/case/texture.py` | **Create.** The whole pattern generator: tile → 2D face → prisms → proud skin → zone masking → chamfered relief solid. Nothing else knows how bricks are made. |
| `hardware/pocket_card/case/test_texture.py` | **Create.** Unit tests for `texture.py` that do not need a full shell build. |
| `hardware/pocket_card/case/shell_front.py` | **Modify.** `build()` unions front-face relief before `clip_to_envelope`. |
| `hardware/pocket_card/case/shell_back.py` | **Modify.** `build_back()` unions wall/back-roll relief before `clip_to_envelope`. |
| `hardware/pocket_card/case/checks.py` | **Modify.** Six new checks against the exported STL. |
| `hardware/pocket_card/case/coupon.py` | **Modify.** Add the texture relief ladder plate. |
| `hardware/card/case/case_updated.blend` | **Modify.** Strip the six boolean cutters; shells import already textured. |

`texture.py` is deliberately the only file that knows the pattern's construction. `shell_front.py` and `shell_back.py` see one function each.

---

### Task 1: Texture parameters

**Files:**
- Modify: `hardware/pocket_card/case/params.py`
- Test: `hardware/pocket_card/case/test_texture.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `P.TEX_TILE: tuple[str, ...]` (5 strings of 5 chars, `#` = brick, `.` = mortar), `P.TEX_PIXEL_FINE: float`, `P.TEX_PIXEL_COARSE: float`, `P.TEX_RELIEF: float`, `P.TEX_TOP_CHAMFER: float`, `P.TEX_KEEPOUT: float`, `P.TEX_BOTTOM_CLEAR: float`, `P.TEX_ORIGIN: tuple[float, float]`.

- [ ] **Step 1: Write the failing test**

Create `hardware/pocket_card/case/test_texture.py`:

```python
"""Unit tests for texture.py and its parameters.

No pytest in this venv by design — plain asserts, same idiom as checks.py.

Run:  .venv/bin/python test_texture.py
"""
import sys

import params as P

FAILURES = []


def check(name, cond, detail=""):
    ok = bool(cond)
    print(f"   {'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail else ''}")
    if not ok:
        FAILURES.append(name)


def test_tile_shape():
    print("tile shape")
    check("tile has 5 rows", len(P.TEX_TILE) == 5, f"got {len(P.TEX_TILE)}")
    check("every row has 5 columns",
          all(len(r) == 5 for r in P.TEX_TILE),
          f"got {[len(r) for r in P.TEX_TILE]}")
    check("tile uses only '#' and '.'",
          set("".join(P.TEX_TILE)) <= {"#", "."},
          f"got {sorted(set(''.join(P.TEX_TILE)))}")
    check("tile is not all brick and not all mortar",
          0 < "".join(P.TEX_TILE).count("#") < 25)


def test_pitches():
    print("pitches")
    check("fine pixel is 1.0 mm", abs(P.TEX_PIXEL_FINE - 1.0) < 1e-9)
    check("coarse pixel is 0.5 mm", abs(P.TEX_PIXEL_COARSE - 0.5) < 1e-9)
    check("coarse is exactly half of fine",
          abs(P.TEX_PIXEL_COARSE * 2 - P.TEX_PIXEL_FINE) < 1e-9)
    check("fine tile is 5 mm", abs(P.TEX_PIXEL_FINE * 5 - 5.0) < 1e-9)
    check("coarse tile is 2.5 mm", abs(P.TEX_PIXEL_COARSE * 5 - 2.5) < 1e-9)


def test_relief_budget():
    print("relief budget")
    check("relief is 0.40 mm", abs(P.TEX_RELIEF - 0.40) < 1e-9)
    check("relief does not thin the wall — it is additive",
          P.WALL == 1.5 and P.FACE_T == 1.5)
    check("coarse pixel clears the resin floor",
          P.TEX_PIXEL_COARSE >= 0.5)
    check("chamfer fits inside the relief",
          0 < P.TEX_TOP_CHAMFER < P.TEX_RELIEF)
    check("bottom clear band is positive", P.TEX_BOTTOM_CLEAR > 0)
    check("keepout is positive", P.TEX_KEEPOUT > 0)


def test_origin():
    print("origin")
    check("origin is an (x, y) pair",
          isinstance(P.TEX_ORIGIN, tuple) and len(P.TEX_ORIGIN) == 2)
    check("origin is inside the body",
          0 <= P.TEX_ORIGIN[0] <= P.BODY_W and 0 <= P.TEX_ORIGIN[1] <= P.BODY_H)


def main():
    test_tile_shape()
    test_pitches()
    test_relief_budget()
    test_origin()
    print()
    if FAILURES:
        sys.exit(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    print("all texture tests passed")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `AttributeError: module 'params' has no attribute 'TEX_TILE'`.

- [ ] **Step 3: Add the parameters**

Append to `hardware/pocket_card/case/params.py`, after the existing cap/collar block:

```python
# ---------------------------------------------------------------- texture
# Enclosure surface relief. See
# docs/superpowers/specs/2026-08-03-pocket-card-surface-treatment-design.md
#
# Relief is PROUD -- added outside the nominal envelope, never cut into it.
# Cutting 0.40 would take WALL and FACE_T from 1.50 to 1.10, and the 0.70
# LAP_FRONT_T skirt to 0.30. Adding leaves all three untouched, which is what
# lets the pattern cross the split line at all.
#
# One tile, two pitches. '#' is brick (proud), '.' is mortar (at nominal).
# Running bond: each course offset half a brick from the one above.
TEX_TILE = (
    "####.",
    "####.",
    ".....",
    ".####",
    ".####",
)

TEX_PIXEL_FINE   = 1.0     # DECIDED  front face -- 5 mm tile, graphic read
TEX_PIXEL_COARSE = 0.5     # DECIDED  walls / back roll -- 2.5 mm tile, grip
TEX_RELIEF       = 0.40    # ASSUMED  proud height; coupon.py settles this
TEX_TOP_CHAMFER  = 0.2     # DECIDED  matches the logo bevel; kills sharp tops
TEX_KEEPOUT      = 1.0     # ASSUMED  radial, from each button station collar
TEX_BOTTOM_CLEAR = 1.9     # MEASURED fade-out band before the flat bottom
TEX_ORIGIN       = (0.0, 0.0)   # DECIDED  shared phase, both shells
```

- [ ] **Step 4: Run test to verify it passes**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `all texture tests passed`.

- [ ] **Step 5: Confirm nothing else broke**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/params.py
```

Expected: the stack-up prints as before, no traceback.

- [ ] **Step 6: Commit**

```bash
git add hardware/pocket_card/case/params.py hardware/pocket_card/case/test_texture.py
git commit -m "params: add TEX_* surface texture constants"
```

---

### Task 2: Outward envelope offset

`_envelope(inset)` currently only offsets inward. Proud relief needs the envelope grown *outward* by `TEX_RELIEF`, so `_envelope(-0.40)` must work. Two things block it today: the bbox guard raises `envelope exploded` above `BODY_W + 0.5`, and `_plan_solid` has a `min(rt, rb) < 0.2` guard that is fine for negatives but whose intent should be documented.

**Files:**
- Modify: `hardware/pocket_card/case/side_arc.py:35-58` (`_plan_solid`), `hardware/pocket_card/case/side_arc.py:165-205` (`_envelope`)
- Test: `hardware/pocket_card/case/test_texture.py`

**Interfaces:**
- Consumes: `P.TEX_RELIEF` from Task 1.
- Produces: `side_arc._envelope(inset: float) -> cq.Shape` now accepts negative `inset`, returning the envelope offset **outward** by `abs(inset)`. `shaped_brick()` behaviour at `inset=0` is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `hardware/pocket_card/case/test_texture.py`, above `main()`:

```python
def test_outward_envelope():
    print("outward envelope offset")
    import side_arc

    nominal = side_arc._envelope(0.0)
    grown = side_arc._envelope(-P.TEX_RELIEF)

    nb = nominal.BoundingBox()
    gb = grown.BoundingBox()
    r = P.TEX_RELIEF

    check("grown envelope is wider by 2x relief",
          abs(gb.xlen - (nb.xlen + 2 * r)) < 0.05,
          f"{gb.xlen:.3f} vs {nb.xlen + 2 * r:.3f}")
    check("grown envelope is taller by 2x relief",
          abs(gb.ylen - (nb.ylen + 2 * r)) < 0.05,
          f"{gb.ylen:.3f} vs {nb.ylen + 2 * r:.3f}")
    check("grown envelope has more volume",
          grown.Volume() > nominal.Volume(),
          f"{grown.Volume():.0f} vs {nominal.Volume():.0f}")
    check("inward offset still works",
          side_arc._envelope(P.WALL).Volume() < nominal.Volume())
```

and add `test_outward_envelope()` to `main()` before the `print()`.

- [ ] **Step 2: Run test to verify it fails**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: FAIL with `RuntimeError: envelope exploded: 90.8x93.8x...`.

- [ ] **Step 3: Relax the guard**

In `hardware/pocket_card/case/side_arc.py`, inside `_envelope`, replace the bbox guard:

```python
    bb = solid.BoundingBox()
    if bb.zlen > P.BODY_T + P.RIB_H + 0.5 or bb.xlen > P.BODY_W + 0.5:
        raise RuntimeError(
            f"envelope exploded: bbox {bb.xlen:.1f}x{bb.ylen:.1f}x{bb.zlen:.1f}")
```

with:

```python
    # A NEGATIVE inset grows the envelope outward -- that is how proud surface
    # relief gets its constant-thickness skin (texture.proud_skin). The guards
    # below must allow for that growth, or the skin build trips "exploded".
    grow = max(0.0, -inset)
    bb = solid.BoundingBox()
    if (bb.zlen > P.BODY_T + P.RIB_H + grow + 0.5
            or bb.xlen > P.BODY_W + 2 * grow + 0.5):
        raise RuntimeError(
            f"envelope exploded: bbox {bb.xlen:.1f}x{bb.ylen:.1f}x{bb.zlen:.1f}")
```

- [ ] **Step 4: Fix the volume guard for negative inset**

Still in `_envelope`, replace:

```python
    brick = (P.BODY_W - 2 * inset) * (P.BODY_H - 2 * inset) * (P.BODY_T - inset)
```

with:

```python
    # Same formula reads correctly for negative inset: every term grows.
    brick = (P.BODY_W - 2 * inset) * (P.BODY_H - 2 * inset) * (P.BODY_T - inset)
```

(the expression is already correct — add only the comment, so a later reader does not "fix" it.)

- [ ] **Step 5: Document the negative branch in `_plan_solid`**

In `hardware/pocket_card/case/side_arc.py`, in `_plan_solid`, replace the docstring:

```python
    """Box with the four vertical corners rounded (plan-view outline).

    ``extra`` deepens the back only, for the north rib's envelope.
    """
```

with:

```python
    """Box with the four vertical corners rounded (plan-view outline).

    ``extra`` deepens the back only, for the north rib's envelope.

    ``inset`` may be NEGATIVE, which grows the outline outward and enlarges
    both plan radii to match — a true parallel offset. texture.proud_skin uses
    that to build the outer skin the surface relief lives in.
    """
```

- [ ] **Step 6: Run test to verify it passes**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `all texture tests passed`.

- [ ] **Step 7: Confirm both shells still build unchanged**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/shell_front.py
```

Expected: prints `shell_front  90.00 x 93.00 x 7.30` (or whatever it printed before this task — it must be **identical**, since no caller passes a negative inset yet).

- [ ] **Step 8: Commit**

```bash
git add hardware/pocket_card/case/side_arc.py hardware/pocket_card/case/test_texture.py
git commit -m "side_arc: allow negative inset to offset the envelope outward"
```

---

### Task 3: The brick tile as a 2D face

**Files:**
- Create: `hardware/pocket_card/case/texture.py`
- Test: `hardware/pocket_card/case/test_texture.py`

**Interfaces:**
- Consumes: `P.TEX_TILE`, `P.TEX_ORIGIN` from Task 1.
- Produces:
  - `texture.brick_rects(pitch: float, x0: float, y0: float, x1: float, y1: float) -> list[tuple[float, float, float, float]]` — axis-aligned `(xmin, ymin, xmax, ymax)` rectangles covering `[x0,x1] × [y0,y1]`, phase-locked to `P.TEX_ORIGIN`.
  - `texture.brick_face(pitch, x0, y0, x1, y1) -> cq.Workplane` — those rectangles as one 2D workplane of faces on `XY` at z=0.

- [ ] **Step 1: Write the failing test**

Add to `hardware/pocket_card/case/test_texture.py`:

```python
def test_brick_rects():
    print("brick rectangles")
    import texture

    pitch = P.TEX_PIXEL_FINE
    tile = pitch * 5
    on = "".join(P.TEX_TILE).count("#")

    # exactly one tile
    r = texture.brick_rects(pitch, 0.0, 0.0, tile, tile)
    area = sum((b[2] - b[0]) * (b[3] - b[1]) for b in r)
    check("one tile has the sprite's brick area",
          abs(area - on * pitch * pitch) < 1e-6,
          f"{area:.4f} vs {on * pitch * pitch:.4f}")

    # four tiles -> four times the area
    r4 = texture.brick_rects(pitch, 0.0, 0.0, 2 * tile, 2 * tile)
    area4 = sum((b[2] - b[0]) * (b[3] - b[1]) for b in r4)
    check("2x2 tiles have 4x the area",
          abs(area4 - 4 * on * pitch * pitch) < 1e-6,
          f"{area4:.4f} vs {4 * on * pitch * pitch:.4f}")

    # phase lock: shifting the window by a whole tile reproduces the pattern
    a = sorted((round(b[0] % tile, 6), round(b[1] % tile, 6)) for b in r)
    shifted = texture.brick_rects(pitch, tile, tile, 2 * tile, 2 * tile)
    b = sorted((round(x[0] % tile, 6), round(x[1] % tile, 6)) for x in shifted)
    check("pattern is phase-locked to TEX_ORIGIN", a == b, f"{a} vs {b}")

    # coarse pitch is the same sprite at half scale
    rc = texture.brick_rects(P.TEX_PIXEL_COARSE, 0.0, 0.0,
                             P.TEX_PIXEL_COARSE * 5, P.TEX_PIXEL_COARSE * 5)
    areac = sum((x[2] - x[0]) * (x[3] - x[1]) for x in rc)
    check("coarse tile is a quarter of the fine tile's area",
          abs(areac - area / 4) < 1e-6, f"{areac:.4f} vs {area / 4:.4f}")

    # everything stays inside the requested window
    check("no rectangle escapes the window",
          all(b[0] >= -1e-9 and b[1] >= -1e-9
              and b[2] <= tile + 1e-9 and b[3] <= tile + 1e-9 for b in r))


def test_brick_face():
    print("brick face")
    import texture

    pitch = P.TEX_PIXEL_FINE
    tile = pitch * 5
    on = "".join(P.TEX_TILE).count("#")
    f = texture.brick_face(pitch, 0.0, 0.0, tile, tile)
    total = sum(x.Area() for x in f.faces().vals())
    check("face area matches the rectangle area",
          abs(total - on * pitch * pitch) < 1e-4,
          f"{total:.4f} vs {on * pitch * pitch:.4f}")
```

and add both to `main()`.

- [ ] **Step 2: Run test to verify it fails**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `ModuleNotFoundError: No module named 'texture'`.

- [ ] **Step 3: Create `texture.py` with the tiling**

Create `hardware/pocket_card/case/texture.py`:

```python
"""Enclosure surface relief — the brick pattern generator.

One 5x5 sprite tile from params.TEX_TILE, at two pitches, standing PROUD of
the nominal envelope. Everything about how bricks are made lives here; the
shells see only `relief_for_zone`.

Spec: docs/superpowers/specs/2026-08-03-pocket-card-surface-treatment-design.md

Coordinates match shell_front / shell_back: device space, z = 0 at the outer
face and negative into the body.

Run:  .venv/bin/python texture.py     (writes a patch preview to out/)
"""
import math
import os

import cadquery as cq

import params as P
import side_arc

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


def brick_rects(pitch, x0, y0, x1, y1):
    """Brick footprints covering [x0,x1] x [y0,y1], clipped to that window.

    Phase-locked to P.TEX_ORIGIN, so a front-shell field and a back-shell
    field asking for adjacent windows produce courses that line up. That is
    the whole reason the origin is a parameter rather than each caller's own
    corner.
    """
    rows = P.TEX_TILE
    n = len(rows)
    tile = pitch * n
    ox, oy = P.TEX_ORIGIN

    # index range of tiles overlapping the window, relative to the origin
    i0 = math.floor((x0 - ox) / tile)
    i1 = math.ceil((x1 - ox) / tile)
    j0 = math.floor((y0 - oy) / tile)
    j1 = math.ceil((y1 - oy) / tile)

    out = []
    for j in range(j0, j1):
        for i in range(i0, i1):
            bx = ox + i * tile
            by = oy + j * tile
            for r, row in enumerate(rows):
                # row 0 is the TOP of the sprite, so walk y downward
                ry0 = by + (n - 1 - r) * pitch
                for c, ch in enumerate(row):
                    if ch != "#":
                        continue
                    rx0 = bx + c * pitch
                    ax0 = max(rx0, x0)
                    ay0 = max(ry0, y0)
                    ax1 = min(rx0 + pitch, x1)
                    ay1 = min(ry0 + pitch, y1)
                    if ax1 - ax0 > 1e-9 and ay1 - ay0 > 1e-9:
                        out.append((ax0, ay0, ax1, ay1))
    return out


def brick_face(pitch, x0, y0, x1, y1):
    """`brick_rects` as one XY workplane of faces at z = 0."""
    rects = brick_rects(pitch, x0, y0, x1, y1)
    if not rects:
        raise ValueError(f"no bricks in window ({x0}, {y0})-({x1}, {y1})")
    wp = cq.Workplane("XY")
    for ax0, ay0, ax1, ay1 in rects:
        wp = wp.add(
            cq.Workplane("XY")
            .box(ax1 - ax0, ay1 - ay0, 1.0, centered=False)
            .translate((ax0, ay0, -0.5))
            .faces("<Z")
            .vals()[0]
        )
    return wp
```

- [ ] **Step 4: Run test to verify it passes**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `all texture tests passed`.

- [ ] **Step 5: Commit**

```bash
git add hardware/pocket_card/case/texture.py hardware/pocket_card/case/test_texture.py
git commit -m "texture: brick tile as phase-locked 2D rectangles"
```

---

### Task 4: The proud skin

The skin is the shell between the nominal envelope and the envelope grown outward by `TEX_RELIEF`. Intersecting brick prisms with it gives constant-thickness relief regardless of which way the prisms were extruded — which is what makes the pattern survive the side-arc roll.

**Files:**
- Modify: `hardware/pocket_card/case/texture.py`
- Test: `hardware/pocket_card/case/test_texture.py`

**Interfaces:**
- Consumes: `side_arc._envelope` negative inset from Task 2.
- Produces: `texture.proud_skin(relief: float | None = None) -> cq.Workplane` — the closed shell of thickness `relief` sitting entirely **outside** the nominal envelope. Defaults to `P.TEX_RELIEF`.

- [ ] **Step 1: Write the failing test**

Add to `hardware/pocket_card/case/test_texture.py`:

```python
def test_proud_skin():
    print("proud skin")
    import side_arc
    import texture

    r = P.TEX_RELIEF
    skin = texture.proud_skin(r)
    nominal = side_arc._envelope(0.0)
    grown = side_arc._envelope(-r)

    v = skin.val().Volume()
    expected = grown.Volume() - nominal.Volume()
    check("skin volume is the shell between the two envelopes",
          abs(v - expected) < 1.0, f"{v:.1f} vs {expected:.1f}")

    # nothing of the skin may lie inside the nominal solid
    overlap = skin.intersect(cq.Workplane(nominal)).val().Volume()
    check("skin does not intrude into the nominal envelope",
          overlap < 0.5, f"overlap {overlap:.3f} mm^3")

    # thickness sanity: the skin's bbox is the grown one
    sb = skin.val().BoundingBox()
    gb = grown.BoundingBox()
    check("skin bbox matches the grown envelope",
          abs(sb.xlen - gb.xlen) < 0.05 and abs(sb.ylen - gb.ylen) < 0.05)
```

and add `test_proud_skin()` to `main()`. Add `import cadquery as cq` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `AttributeError: module 'texture' has no attribute 'proud_skin'`.

- [ ] **Step 3: Implement `proud_skin`**

Append to `hardware/pocket_card/case/texture.py`:

```python
def proud_skin(relief=None):
    """The constant-thickness shell just OUTSIDE the nominal envelope.

    This is the trick that makes relief wrap. Extruded brick prisms have one
    direction; the case surface rolls through ninety degrees from face to
    back. Intersecting the prisms with this skin gives relief measured
    perpendicular to the local surface everywhere, so it neither thins out nor
    fattens as the surface turns away from the extrusion axis.
    """
    r = float(P.TEX_RELIEF if relief is None else relief)
    if r <= 0:
        raise ValueError(f"relief must be positive, got {r}")
    grown = cq.Workplane(side_arc._envelope(-r))
    nominal = cq.Workplane(side_arc._envelope(0.0))
    return grown.cut(nominal)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `all texture tests passed`. This task's test does real OCC boolean work — expect it to take a minute or two.

- [ ] **Step 5: Commit**

```bash
git add hardware/pocket_card/case/texture.py hardware/pocket_card/case/test_texture.py
git commit -m "texture: constant-thickness proud skin from the outward envelope"
```

---

### Task 5: Zone masks and keep-outs

**Files:**
- Modify: `hardware/pocket_card/case/texture.py`
- Test: `hardware/pocket_card/case/test_texture.py`

**Interfaces:**
- Consumes: `P.TEX_KEEPOUT`, `P.TEX_BOTTOM_CLEAR` from Task 1.
- Produces:
  - `texture.button_islands() -> cq.Workplane` — the union of smooth keep-out cylinders around every button station, radius = collar OD/2 + `TEX_KEEPOUT`, running through the full relief depth.
  - `texture.bottom_clear_slab() -> cq.Workplane` — a slab covering everything within `TEX_BOTTOM_CLEAR` of the flat bottom face.
  - `texture.STATIONS: list[tuple[float, float, float]]` — `(x, y, collar_outer_d)` for each of the eight stations, in device coordinates.

- [ ] **Step 1: Write the failing test**

Add to `hardware/pocket_card/case/test_texture.py`:

```python
def test_stations_and_islands():
    print("keep-out islands")
    import texture

    check("eight button stations", len(texture.STATIONS) == 8,
          f"got {len(texture.STATIONS)}")
    check("every station is inside the body",
          all(0 <= x <= P.BODY_W and 0 <= y <= P.BODY_H
              for x, y, _ in texture.STATIONS))

    islands = texture.button_islands()
    ib = islands.val().BoundingBox()
    check("islands have real volume", islands.val().Volume() > 1.0)

    # the d-pad's left cap is the one the old blend field collided with
    left_x = P.DIR_CX - P.DIR_RADIUS
    hit = [s for s in texture.STATIONS if abs(s[0] - left_x) < 1e-6
           and abs(s[1] - P.DIR_CY) < 1e-6]
    check("d-pad left cap is a station", len(hit) == 1)
    if hit:
        _, _, d = hit[0]
        check("its island clears the cap by TEX_KEEPOUT",
              d / 2 + P.TEX_KEEPOUT > P.DIR_CAP_D / 2 + P.TEX_KEEPOUT - 1e-9)


def test_bottom_clear():
    print("bottom clear band")
    import texture

    slab = texture.bottom_clear_slab()
    sb = slab.val().BoundingBox()
    check("slab is TEX_BOTTOM_CLEAR thick (plus margin for the roll)",
          sb.zlen >= P.TEX_BOTTOM_CLEAR,
          f"{sb.zlen:.2f} vs {P.TEX_BOTTOM_CLEAR:.2f}")
    check("slab sits at the bottom of the body",
          sb.zmin <= -P.BODY_T + 1e-6, f"zmin {sb.zmin:.2f}")
```

and add both to `main()`.

- [ ] **Step 2: Run test to verify it fails**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `AttributeError: module 'texture' has no attribute 'STATIONS'`.

- [ ] **Step 3: Implement stations, islands and the bottom slab**

Append to `hardware/pocket_card/case/texture.py`:

```python
# The eight control stations, mirroring shell_front.build()'s own list. Third
# element is the collar OUTER diameter the keep-out is measured from: the cap
# head, plus the flange overshoot, plus the collar wall.
_COLLAR_OS = P.CAP_FLANGE_OS + P.COLLAR_CLEAR

STATIONS = [
    (P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D + 2 * _COLLAR_OS),
    (P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D + 2 * _COLLAR_OS),
    (P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D + 2 * _COLLAR_OS),
    (P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D + 2 * _COLLAR_OS),
    (P.UNDO_X, P.UNDO_Y, P.AB_CAP_D + 2 * _COLLAR_OS),
    (P.ACT_X, P.ACT_Y, P.AB_CAP_D + 2 * _COLLAR_OS),
    (P.RESET_X, P.RESET_Y, P.RESET_CAP_D + 2 * _COLLAR_OS),
    # The Menu control is a pill (PILL_L x PILL_W), not a circle. A circular
    # island on its long axis over-covers the short axis, which is the safe
    # direction to be wrong in — the island is a keep-out, not a fit.
    (P.MENU_X, P.MENU_Y, P.PILL_L + 2 * _COLLAR_OS),
]


def button_islands(keepout=None):
    """Smooth islands around every control, where relief is suppressed.

    Caps emerge from an untextured panel still at nominal, so CAP_PROUD stays
    exactly 1.0 rather than being halved by a raised field around it. This is
    also what stops the left field running into the d-pad's left cap the way
    the old Blender field did (it reached x = 9.2 against a cap spanning
    6.7-14.7).
    """
    k = float(P.TEX_KEEPOUT if keepout is None else keepout)
    tall = P.BODY_T + 4 * P.TEX_RELIEF
    wp = None
    for x, y, d in STATIONS:
        cyl = (cq.Workplane("XY")
               .circle(d / 2 + k)
               .extrude(-tall)
               .translate((x, y, 2 * P.TEX_RELIEF)))
        wp = cyl if wp is None else wp.union(cyl)
    return wp


def bottom_clear_slab(clear=None):
    """Everything within `clear` of the flat bottom face.

    The flat bottom is never textured — relief fades out before it, as it did
    in the Blender passes (their cutters stopped at z = -13.8 against a back
    face at -15.7).
    """
    c = float(P.TEX_BOTTOM_CLEAR if clear is None else clear)
    pad = 4.0
    h = c + pad
    return (cq.Workplane("XY")
            .box(P.BODY_W + 2 * pad, P.BODY_H + 2 * pad, h, centered=False)
            .translate((-pad, -pad, -P.BODY_T - pad)))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `all texture tests passed`.

- [ ] **Step 5: Commit**

```bash
git add hardware/pocket_card/case/texture.py hardware/pocket_card/case/test_texture.py
git commit -m "texture: button keep-out islands and bottom clear band"
```

---

### Task 6: The relief solid

Assemble it: prisms from the tile, intersected with the proud skin, minus the keep-outs, chamfered on top.

**Files:**
- Modify: `hardware/pocket_card/case/texture.py`
- Test: `hardware/pocket_card/case/test_texture.py`

**Interfaces:**
- Consumes: everything from Tasks 3-5.
- Produces: `texture.relief_for_zone(zone: str, z0: float, z1: float) -> cq.Workplane`. `zone` is `"front"` (pitch `TEX_PIXEL_FINE`, prisms extruded along -z) or `"wall"` (pitch `TEX_PIXEL_COARSE`, prisms extruded radially in plan). `z0`/`z1` bound the band the relief is clipped to.

- [ ] **Step 1: Write the failing test**

Add to `hardware/pocket_card/case/test_texture.py`:

```python
def test_relief_for_zone():
    print("relief solid")
    import texture

    front = texture.relief_for_zone("front", -P.TEX_RELIEF, P.TEX_RELIEF * 2)
    v = front.val().Volume()
    check("front relief has volume", v > 10.0, f"{v:.1f} mm^3")

    fb = front.val().BoundingBox()
    check("front relief does not reach past the relief height",
          fb.zmax <= P.TEX_RELIEF + 1e-3, f"zmax {fb.zmax:.4f}")
    check("front relief sits outside the nominal face",
          fb.zmax > 0, f"zmax {fb.zmax:.4f}")

    # keep-outs really are empty
    islands = texture.button_islands()
    intruding = front.intersect(islands).val()
    vol = intruding.Volume() if intruding is not None else 0.0
    check("no relief inside a button island", vol < 0.01,
          f"{vol:.4f} mm^3")

    # the flat bottom stays clear
    bottom = front.intersect(texture.bottom_clear_slab()).val()
    bvol = bottom.Volume() if bottom is not None else 0.0
    check("no relief in the bottom clear band", bvol < 0.01,
          f"{bvol:.4f} mm^3")

    check("unknown zone is rejected",
          _raises(lambda: texture.relief_for_zone("nope", -1.0, 1.0)))


def _raises(fn):
    try:
        fn()
    except Exception:
        return True
    return False
```

and add `test_relief_for_zone()` to `main()`.

- [ ] **Step 2: Run test to verify it fails**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `AttributeError: module 'texture' has no attribute 'relief_for_zone'`.

- [ ] **Step 3: Implement `relief_for_zone`**

Append to `hardware/pocket_card/case/texture.py`:

```python
_ZONES = {
    "front": P.TEX_PIXEL_FINE,
    "wall": P.TEX_PIXEL_COARSE,
}


def _front_prisms(pitch, z0, z1):
    """Brick columns extruded along -z, covering the whole plan footprint."""
    pad = 2.0
    face = brick_face(pitch, -pad, -pad, P.BODY_W + pad, P.BODY_H + pad)
    height = (z1 - z0) + 2.0
    solid = None
    for f in face.faces().vals():
        col = cq.Workplane(
            cq.Solid.extrudeLinear(f.outerWire(), [],
                                   cq.Vector(0, 0, height)))
        solid = col if solid is None else solid.union(col)
    return solid.translate((0, 0, z0 - 1.0))


def _wall_prisms(pitch, z0, z1):
    """Brick blocks laid out in (perimeter arc length, z) and swept inward.

    Laying the tile out along arc length is what makes the pattern wrap the
    plan corners continuously instead of restarting on each straight run.
    Courses compress slightly through CASE_TOP_R / CASE_BOTTOM_R; that is
    accepted (see the spec), and is what real brickwork does round a curve.
    """
    perimeter = 2 * (P.BODY_W + P.BODY_H)
    rects = brick_rects(pitch, 0.0, z0, perimeter, z1)
    depth = 4 * P.TEX_RELIEF + 1.0
    solid = None
    for s0, zz0, s1, zz1 in rects:
        for (px, py, nx, ny) in _perimeter_segments(s0, s1):
            blk = (cq.Workplane("XY")
                   .box(abs(s1 - s0), depth, zz1 - zz0, centered=False)
                   .translate((0, -depth / 2, zz0)))
            ang = math.degrees(math.atan2(ny, nx))
            blk = (blk.rotate((0, 0, 0), (0, 0, 1), ang - 90.0)
                      .translate((px, py, 0)))
            solid = blk if solid is None else solid.union(blk)
    return solid


def _perimeter_segments(s0, s1):
    """Sample points and outward normals along the plan perimeter.

    Returns one (x, y, nx, ny) per brick, at the brick's arc-length midpoint.
    Uses the nominal envelope's mid-height section so the walk follows the
    real rolled outline, plan corners included.
    """
    face = side_arc._section_face(0.0, -P.BODY_T / 2)
    wire = face.outerWire()
    total = wire.Length()
    mid = ((s0 + s1) / 2) % total
    t = mid / total
    pt = wire.positionAt(t)
    tan = wire.tangentAt(t)
    # outward normal in plan is the tangent rotated -90 degrees
    return [(pt.x, pt.y, tan.y, -tan.x)]


def relief_for_zone(zone, z0, z1):
    """Chamfered proud brick relief for one zone, clipped to [z0, z1].

    Order matters: prisms first, THEN intersect with the skin (so relief is
    constant-depth over the roll), THEN subtract the keep-outs.
    """
    if zone not in _ZONES:
        raise ValueError(f"unknown zone {zone!r}, expected one of {sorted(_ZONES)}")
    pitch = _ZONES[zone]
    if z1 < z0:
        z0, z1 = z1, z0

    prisms = (_front_prisms(pitch, z0, z1) if zone == "front"
              else _wall_prisms(pitch, z0, z1))

    solid = prisms.intersect(proud_skin())
    solid = solid.cut(button_islands())
    solid = solid.cut(bottom_clear_slab())

    if P.TEX_TOP_CHAMFER > 0:
        try:
            solid = solid.edges(">Z").chamfer(P.TEX_TOP_CHAMFER)
        except Exception:
            # A chamfer that cannot close on every brick top is cosmetic, not
            # structural. Losing it must not fail the build.
            pass
    return solid
```

- [ ] **Step 4: Run test to verify it passes**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: `all texture tests passed`. **This is the slow one.** If it runs past ten minutes, stop and go to Step 5 before continuing.

- [ ] **Step 5: If the boolean is too slow, union the faces before extruding**

`_front_prisms` unions one solid per brick, which is `O(bricks)` OCC booleans. If Step 4 is slow, replace the loop body with a single fused extrusion:

```python
def _front_prisms(pitch, z0, z1):
    """Brick columns extruded along -z, covering the whole plan footprint."""
    pad = 2.0
    rects = brick_rects(pitch, -pad, -pad, P.BODY_W + pad, P.BODY_H + pad)
    height = (z1 - z0) + 2.0
    wp = cq.Workplane("XY").workplane(offset=z0 - 1.0)
    for ax0, ay0, ax1, ay1 in rects:
        wp = wp.moveTo(ax0, ay0).rect(ax1 - ax0, ay1 - ay0,
                                      centered=False)
    return wp.extrude(height)
```

Re-run Step 4. Record the timing in the commit message either way.

- [ ] **Step 6: Commit**

```bash
git add hardware/pocket_card/case/texture.py hardware/pocket_card/case/test_texture.py
git commit -m "texture: assemble chamfered proud relief per zone"
```

---

### Task 6A: Construction-only root overlap

The exact `proud_skin()` remains outside-only for measurement. Shell callers
request a second skin whose brick roots extend 0.05 mm inside material the
nominal shell already owns, giving OCC real shared volume without changing the
visible exterior. The bond is zone-aware: the front uses a z-normal slab below
the flat face, while the wall/back zone uses the inset cavity envelope.

Do not use `_envelope(root_overlap)` as a global front-depth oracle. Positive
`side_arc._envelope()` values describe the enclosure cavity: they keep the
front at z=0 and omit the nominal exterior's front chamfer. Consequently that
shape legitimately intersects some visible proud skin around the chamfer and
cannot represent a parallel inward offset there.

**Files:**
- Modify: `hardware/pocket_card/case/params.py`
- Modify: `hardware/pocket_card/case/texture.py`
- Test: `hardware/pocket_card/case/test_texture.py`

**Interfaces:**
- Produces: `P.TEX_ROOT_OVERLAP = 0.05` mm.
- Produces: `texture.relief_for_zone(zone, z0, z1, root_overlap=0.0)`.
- Keeps: `texture.proud_skin()` exact and outside-only.

- [ ] **Step 1: Write the failing parameter and skin tests**

Add to `test_relief_budget()`:

```python
    check("root overlap is the decided 0.05 mm construction bond",
          abs(P.TEX_ROOT_OVERLAP - 0.05) < 1e-9)
```

Add above `main()`:

```python
def test_root_overlap_skin():
    print("texture root overlap")
    import side_arc
    import texture

    nominal = cq.Workplane(side_arc._envelope(0.0))
    pure = texture.proud_skin()
    bonded = texture._relief_skin(
        P.TEX_RELIEF, P.TEX_ROOT_OVERLAP, zone="front")

    pad = 1.0
    front_band = (cq.Workplane("XY")
                  .box(P.BODY_W + 2 * pad, P.BODY_H + 2 * pad,
                       P.TEX_RELIEF + P.TEX_ROOT_OVERLAP + 2 * pad,
                       centered=False)
                  .translate((-pad, -pad, -P.TEX_ROOT_OVERLAP)))

    overlap = bonded.intersect(nominal).val().Volume()
    visible = bonded.cut(nominal).val().Volume()
    pure_front = pure.intersect(front_band).val().Volume()
    check("bond skin has real shared volume inside nominal",
          overlap > 1.0, f"{overlap:.3f} mm^3")
    check("front bond root stops at the z-normal 0.05 mm allowance",
          abs(bonded.val().BoundingBox().zmin + P.TEX_ROOT_OVERLAP) < 0.01,
          f"zmin {bonded.val().BoundingBox().zmin:.3f}")
    check("root overlap leaves the visible proud skin unchanged",
          abs(visible - pure_front) < 1.0,
          f"{visible:.3f} vs {pure_front:.3f}")

    wall = texture._relief_skin(
        P.TEX_RELIEF, P.TEX_ROOT_OVERLAP, zone="wall")
    check("wall bond skin has real shared volume inside nominal",
          wall.intersect(nominal).val().Volume() > 1.0)

    check("negative root overlap is rejected with ValueError",
          _raises_value_error(
              lambda: texture.relief_for_zone(
                  "front", -P.TEX_RELIEF, 2 * P.TEX_RELIEF,
                  root_overlap=-0.01)))
```

Call `test_root_overlap_skin()` immediately after `test_proud_skin()` in
`main()`.

Also add a final-pipeline regression after the zone-assembly tests. Construct
both `relief_for_zone(..., root_overlap=0)` and
`relief_for_zone(..., root_overlap=P.TEX_ROOT_OVERLAP)` for front and wall.
For each zone, cut the bonded result by the nominal envelope and assert both
mutual-difference volumes against the pure result are below 0.5 mm³. Assert
the complete bonded result intersects nominal by more than 1.0 mm³. This is
essential: helper-level skin equality is insufficient because chamfering a
rooted compound can change its topology and therefore change the visible
pattern.

Add a wall-prism reach regression using a larger valid root (for example
0.60 mm) so a hard-coded 0.05 mm prism depth cannot pass. The prism band must
reach far enough inward to intersect the corresponding inset wall envelope.

- [ ] **Step 2: Run RED**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/test_texture.py
```

Expected: missing `P.TEX_ROOT_OVERLAP`, `_relief_skin`, and `root_overlap`
support. Stop any OCC run at ten minutes.

- [ ] **Step 3: Add the parameter**

In the texture block in `params.py`, after `TEX_RELIEF`:

```python
TEX_ROOT_OVERLAP = 0.05  # DECIDED construction-only boolean bond; invisible
```

- [ ] **Step 4: Add the offset-band helper without changing `proud_skin()`**

In `texture.py`, replace the body-level envelope construction inside
`proud_skin()` with:

```python
def _relief_skin(relief, root_overlap=0.0, zone=None):
    """Zone-aware band from inside nominal to `relief` outside.

    `root_overlap=0` is the exact proud skin. A positive value is construction
    overlap that disappears inside an integrated shell union.
    """
    r = float(relief)
    root = float(root_overlap)
    if not math.isfinite(r) or r <= 0:
        raise ValueError(f"relief must be finite and positive, got {r}")
    if not math.isfinite(root) or root < 0:
        raise ValueError(
            f"root_overlap must be finite and non-negative, got {root}")
    if root >= min(P.WALL, P.FACE_T):
        raise ValueError(
            f"root_overlap {root} must stay below shell thickness")
    grown = cq.Workplane(side_arc._envelope(-r))
    nominal = cq.Workplane(side_arc._envelope(0.0))
    if root == 0.0:
        return grown.cut(nominal)
    if zone == "front":
        pad = 1.0
        band = (cq.Workplane("XY")
                .box(P.BODY_W + 2 * pad, P.BODY_H + 2 * pad,
                     r + root + 2 * pad, centered=False)
                .translate((-pad, -pad, -root)))
        return grown.intersect(band)
    if zone == "wall":
        inner = cq.Workplane(side_arc._envelope(root))
        return grown.cut(inner)
    raise ValueError(f"positive root overlap requires a known zone, got {zone!r}")


def proud_skin(relief=None):
    """The exact constant-thickness shell OUTSIDE the nominal envelope."""
    r = float(P.TEX_RELIEF if relief is None else relief)
    return _relief_skin(r, 0.0, zone=None)
```

Preserve the existing detailed `proud_skin` documentation around this code.

- [ ] **Step 5: Thread the optional root through `relief_for_zone`**

Change `_wall_prisms` to accept the validated `root_overlap`. Its tangential
box depth must be derived from `P.TEX_RELIEF + root_overlap` plus the existing
small boolean pad; do not hard-code the decided 0.05 mm root in this generic
helper.

Assemble visible relief and its construction root separately. Chamfer the
exact zero-root visible bricks first. Then create a shallow bond band with
outside reach equal to `root_overlap` and cut it by the same keepouts. Return
the visible and bond solids as one additive compound. The bond band overlaps
both the shell and the unchamfered lower portion of every visible brick, so the
shell caller's final union joins them without allowing root-induced topology
changes to alter the top chamfer:

```python
def relief_for_zone(zone: str, z0: float, z1: float,
                    root_overlap: float = 0.0) -> cq.Workplane:
    # existing zone and bound validation remains
    root = float(root_overlap)
    if not math.isfinite(root) or root < 0:
        raise ValueError(
            f"root_overlap must be finite and non-negative, got {root}")
    if root >= min(P.WALL, P.FACE_T):
        raise ValueError(
            f"root_overlap {root} must stay below shell thickness")
    prisms = (_front_prisms(z0, z1) if zone == "front"
              else _wall_prisms(z0, z1, root_overlap=root))
    visible = (prisms.intersect(proud_skin())
               .cut(button_islands())
               .cut(bottom_clear_slab()))
    visible = _chamfer_proud_tops(visible, zone)
    if root == 0.0:
        return visible

    bond = (prisms.intersect(_relief_skin(root, root, zone=zone))
            .cut(button_islands())
            .cut(bottom_clear_slab()))
    return visible.add(bond)
```

Do not pre-fuse the complete relief compound. OCC global fusion of these many
overlapping roots has been measured to create 35.695 mm³ of false visible
material during a later cut, despite each bond being wholly contained by the
raw brick near its base. The additive compound has zero mutual visible
difference and 219.498 mm³ of real front-shell overlap. Task 7's one-solid
integration assertion is the required proof that the shell consumes it.

Do not translate individual bricks and do not use fuzzy union here. The front
band supplies a true z-normal root through the flat face; the cavity-envelope
band supplies the wall/back root. Keep `proud_skin()` on the exact outside-only
path and chamfer it before adding the bond band so existing relief measurements
and brick topology remain unchanged.

- [ ] **Step 6: Run GREEN and commit**

```bash
/usr/bin/time -p hardware/pocket_card/case/.venv/bin/python \
  hardware/pocket_card/case/test_texture.py
git add hardware/pocket_card/case/params.py \
        hardware/pocket_card/case/texture.py \
        hardware/pocket_card/case/test_texture.py
git commit -m "texture: add invisible root overlap for shell unions"
```

Expected: all texture checks pass in under ten minutes; pure-skin deviation
measurements remain unchanged.

---

### Task 7: Wire and fuse the front shell

**Files:**
- Modify: `hardware/pocket_card/case/shell_front.py` (`build()`, near the end)

**Interfaces:**
- Consumes: `texture.relief_for_zone(..., root_overlap=...)` from Task 6A.
- Produces: `shell_front.build()` returns exactly one valid shell solid with
  front-face relief, clear openings and unchanged nominal interior geometry.

- [ ] **Step 1: Add the import**

In `hardware/pocket_card/case/shell_front.py`, after `import side_arc`:

```python
import texture
```

- [ ] **Step 2: Add the front hard-opening keepout**

Add above `to_model_space()`:

```python
def _front_relief_keepout():
    """Openings where front relief is forbidden, including aperture chamfer."""
    pad = P.APERTURE_CHAMFER + 0.05
    screen = (cq.Workplane("XY")
              .box(P.APERTURE_W + 2 * pad, P.APERTURE_H + 2 * pad,
                   P.FACE_T + 2, centered=(False, False, False))
              .translate((P.APERTURE_X - pad, P.APERTURE_Y - pad,
                          -P.FACE_T - 1))
              .edges("|Z").fillet(0.8 + pad))
    return screen.union(grille_slots()).union(edge_openings())
```

The extra 0.05 mm is a keepout margin, not the root-overlap dimension; it keeps
the chamfer boundary from landing on a coincident relief edge.

- [ ] **Step 3: Verify the current integration is RED**

Run this real-geometry assertion before changing `build()` further:

```bash
hardware/pocket_card/case/.venv/bin/python -c '
import sys
sys.path.insert(0, "hardware/pocket_card/case")
import shell_front
s = shell_front.build()
solids = s.solids().vals()
print("solids", len(solids), "valid", s.val().isValid())
assert len(solids) == 1 and s.val().isValid()
'
```

Expected in the current worktree: FAIL with `solids 48`; fuzzy union is not a
physical bond.

- [ ] **Step 4: Union trimmed, bonded relief in `build()`**

In `build()`, replace:

```python
    # Keep posts/collars from ever sitting outside the curved envelope.
    shell = side_arc.clip_to_envelope(shell)
    return to_model_space(shell)
```

with:

```python
    # Keep posts/collars from ever sitting outside the curved envelope. This
    # must happen BEFORE the relief goes on, because the relief deliberately
    # lives outside that envelope.
    shell = side_arc.clip_to_envelope(shell)
    relief = texture.relief_for_zone(
        "front", -P.TEX_RELIEF, 2 * P.TEX_RELIEF,
        root_overlap=P.TEX_ROOT_OVERLAP)
    relief = relief.cut(_front_relief_keepout())
    shell = shell.union(relief)
    return to_model_space(shell)
```

Remove any `glue=True` or fuzzy `tol=` arguments left by the rejected probe.
The 0.05 mm root overlap must make ordinary union succeed.

- [ ] **Step 5: Run the one-solid and opening regressions**

```bash
hardware/pocket_card/case/.venv/bin/python -c '
import sys
sys.path.insert(0, "hardware/pocket_card/case")
import shell_front
s = shell_front.build()
solids = s.solids().vals()
assert len(solids) == 1, len(solids)
assert s.val().isValid()
for name, cutter in (
    ("screen", shell_front.screen_aperture()),
    ("grille", shell_front.grille_slots()),
    ("edge", shell_front.edge_openings()),
):
    model_cutter = shell_front.to_model_space(cutter)
    hit = s.intersect(model_cutter).val()
    volume = 0.0 if hit is None else hit.Volume()
    print(name, volume)
    assert volume < 0.01, (name, volume)
bb = s.val().BoundingBox()
assert abs(bb.zmax - 0.40) < 0.01, bb.zmax
assert abs(bb.zmin + 7.30) < 0.01, bb.zmin
assert bb.xmin < 0 and bb.xmax > 90
assert bb.ymin < 0 and bb.ymax > 93
print("one valid solid", bb.xlen, bb.ylen, bb.zlen)
'
```

Expected: one valid solid; all three opening volumes below 0.01 mm³; zmax
0.40 mm. Sparse brick occupancy need not reach the continuous grown-envelope
size of 90.8 × 93.8 mm.

- [ ] **Step 6: Export the persistent visual proof**

```bash
mkdir -p hardware/pocket_card/case/out/preview
hardware/pocket_card/case/.venv/bin/python -c '
import sys
sys.path.insert(0, "hardware/pocket_card/case")
import cadquery as cq
import shell_front
s = shell_front.build()
path = ("hardware/pocket_card/case/out/preview/"
        "shell_front_textured_root_overlap.stl")
cq.exporters.export(s, path)
print(path, len(s.solids().vals()), "solid")
'
```

Expected: writes the named preview as exactly one solid. Keep it untracked so
the user can inspect it without replacing the tracked order outputs.

- [ ] **Step 7: Verify the normal export and existing checks**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/shell_front.py
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/checks.py
```

Expected: `front shell is one solid` and cap/collar checks pass. Task 9 may
still need to amend nominal-envelope surface probes, but no opening or topology
failure may be deferred.

- [ ] **Step 8: Commit**

```bash
git add hardware/pocket_card/case/shell_front.py
git commit -m "shell_front: bond texture around clear front openings"
```

---

### Task 8: Wire the back shell

**Files:**
- Modify: `hardware/pocket_card/case/shell_back.py` (`build_back()`)

**Interfaces:**
- Consumes: `texture.relief_for_zone(..., root_overlap=...)` from Task 6A.
- Produces: `shell_back.build_back()` returns exactly one valid shell solid with
  wall/back-roll relief, a clear USB-C opening, and phase registration with the
  front.

- [ ] **Step 1: Add the import**

In `hardware/pocket_card/case/shell_back.py`, after its `import side_arc`:

```python
import texture
```

- [ ] **Step 2: Union the relief in `build_back()`**

Replace:

```python
    # Internals must not poke through the curved side scoops.
    s = side_arc.clip_to_envelope(s)
    return to_model_space(s)
```

with:

```python
    # Internals must not poke through the curved side scoops. Relief goes on
    # AFTER, since it deliberately lives outside that envelope.
    s = side_arc.clip_to_envelope(s)
    # LID_Z0 is the outer back surface, LID_Z1 the split. bottom_clear_slab
    # does the actual fade-out, so this band may safely run the full depth.
    relief = texture.relief_for_zone(
        "wall", LID_Z0, LID_Z1,
        root_overlap=P.TEX_ROOT_OVERLAP)
    relief = relief.cut(usb_opening())
    s = s.union(relief)
    return to_model_space(s)
```

Cut the USB opening from relief *after* relief generation because the nominal
tray cut happened before the relief union. Ordinary union must succeed from the
physical root overlap; do not add fuzzy tolerance.

- [ ] **Step 3: Confirm the band constants**

`shell_back.py:24-27` already defines `SHELL_DEPTH`, `LID_Z0 = -P.BODY_T` and `LID_Z1 = -SHELL_DEPTH`. Confirm they are still there and unmodified:

```bash
grep -n "^LID_Z0\|^LID_Z1\|^SHELL_DEPTH" hardware/pocket_card/case/shell_back.py
```

Expected: three lines. Use those names — do not import `shell_front` for the split depth.

- [ ] **Step 4: Run one-solid and USB-clear integration assertions**

```bash
hardware/pocket_card/case/.venv/bin/python -c '
import sys
sys.path.insert(0, "hardware/pocket_card/case")
import shell_back
s = shell_back.build_back()
assert len(s.solids().vals()) == 1, len(s.solids().vals())
assert s.val().isValid()
usb = shell_back.to_model_space(shell_back.usb_opening())
hit = s.intersect(usb).val()
volume = 0.0 if hit is None else hit.Volume()
print("one valid solid; USB overlap", volume)
assert volume < 0.01, volume
'
```

Expected: one valid solid and USB overlap below 0.01 mm³.

- [ ] **Step 5: Build**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/shell_back.py
```

Expected: builds without error, plan dimensions grown by `2 * TEX_RELIEF`, z unchanged at the bottom.

- [ ] **Step 6: Eyeball the registration across the split**

```bash
hardware/pocket_card/case/.venv/bin/python -c "
import sys; sys.path.insert(0, 'hardware/pocket_card/case')
import params as P, texture
z = -(P.BODY_T - P.LID_T)
r = texture.brick_rects(P.TEX_PIXEL_COARSE, 0.0, z - 2, 2 * (P.BODY_W + P.BODY_H), z + 2)
edges = sorted({round(b[1], 4) for b in r} | {round(b[3], 4) for b in r})
near = [e for e in edges if abs(e - z) < P.TEX_PIXEL_COARSE]
print('split z =', z)
print('course edges near the split:', near)
print('on a course boundary:', any(abs(e - z) < 1e-6 for e in near))
"
```

Expected: `on a course boundary: True`. If False, adjust `TEX_ORIGIN[1]` in `params.py` so the split lands on a course edge, then re-run.

- [ ] **Step 7: Commit**

```bash
git add hardware/pocket_card/case/shell_back.py hardware/pocket_card/case/params.py
git commit -m "shell_back: bond wall texture around the USB opening"
```

---

### Task 9: Verification in checks.py

**Files:**
- Modify: `hardware/pocket_card/case/checks.py`

**Interfaces:**
- Consumes: the exported `out/shell_front.stl` and `out/shell_back.stl`.
- Produces: `check_texture_relief()`, `check_texture_keepout()`, `check_texture_bottom_clear()`, `check_texture_wall_preserved()`, `check_texture_registration()`, called from `main()`.

- [ ] **Step 1: Write the checks**

Add to `hardware/pocket_card/case/checks.py`, above `main()`:

```python
def check_texture_relief():
    """Relief stands TEX_RELIEF proud of nominal, no more and no less."""
    print("texture relief height")
    tri = load_tris(os.path.join(OUT, "shell_front.stl"))
    zmax = tri[:, :, 2].max()
    # to_model_space mirrors in Y; z is untouched, so the outer face is still
    # the max. Nominal face is at 0, relief adds TEX_RELIEF.
    check("front face relief height", zmax, P.TEX_RELIEF, 0.05)


def check_texture_wall_preserved():
    """Proud relief must not have thinned anything."""
    print("texture wall preservation")
    check("WALL unchanged", P.WALL, 1.5, 1e-9)
    check("FACE_T unchanged", P.FACE_T, 1.5, 1e-9)
    check("LAP_FRONT_T unchanged", P.LAP_FRONT_T, 0.70, 1e-9)


def check_texture_keepout():
    """No relief within TEX_KEEPOUT of any control."""
    print("texture keep-out")
    import texture
    tri = load_tris(os.path.join(OUT, "shell_front.stl"))
    proud = tri[(tri[:, :, 2] > 0.02).any(axis=1)]
    if len(proud) == 0:
        FAILURES.append("no proud geometry found at all")
        print("   FAIL  no proud geometry found at all")
        return
    cx = proud[:, :, 0].reshape(-1)
    cy = proud[:, :, 1].reshape(-1)
    worst = None
    for x, y, d in texture.STATIONS:
        # device -> model space is a mirror in Y
        my = P.BODY_H - y
        dist = np.sqrt((cx - x) ** 2 + (cy - my) ** 2) - d / 2
        m = dist.min()
        if worst is None or m < worst:
            worst = m
    check("closest proud vertex to a collar", worst, P.TEX_KEEPOUT, 0.15)


def check_texture_bottom_clear():
    """The flat bottom face carries no relief."""
    print("texture bottom clear")
    tri = load_tris(os.path.join(OUT, "shell_back.stl"))
    zmin = tri[:, :, 2].min()
    check("back reaches nominal body depth, not past it",
          abs(zmin), P.BODY_T, 0.05)


def check_texture_registration():
    """Courses line up across the split."""
    print("texture registration")
    import texture
    z = -(P.BODY_T - P.LID_T)
    r = texture.brick_rects(P.TEX_PIXEL_COARSE, 0.0, z - 2.0,
                            2 * (P.BODY_W + P.BODY_H), z + 2.0)
    edges = {round(b[1], 6) for b in r} | {round(b[3], 6) for b in r}
    off = min(abs(e - z) for e in edges)
    check("split line sits on a course boundary", off, 0.0, 1e-4)
```

- [ ] **Step 2: Add `numpy` import if it is not already there**

```bash
grep -n "^import numpy" hardware/pocket_card/case/checks.py
```

It is imported as `np` at the top already — confirm, and do nothing if so.

- [ ] **Step 3: Call them from `main()`**

In `main()`, after `check_battery_keepout()`:

```python
    check_texture_relief()
    check_texture_wall_preserved()
    check_texture_keepout()
    check_texture_bottom_clear()
    check_texture_registration()
```

- [ ] **Step 4: Relax the envelope assertions for proud relief**

Any existing check that asserts the part fits inside the nominal envelope will now fail. Find them:

```bash
grep -n "BODY_W\|BODY_H\|xlen\|ylen" hardware/pocket_card/case/checks.py | grep -i "check\|assert"
```

For each, allow `+ 2 * P.TEX_RELIEF` in plan and `+ P.TEX_RELIEF` in z, with a comment saying why. Do not simply widen the tolerance — state the allowance explicitly.

- [ ] **Step 5: Run the full check suite**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/checks.py
```

Expected: `all checks passed`.

- [ ] **Step 6: Commit**

```bash
git add hardware/pocket_card/case/checks.py
git commit -m "checks: verify texture relief, keep-out, bottom clear, registration"
```

---

### Task 10: Texture coupon

`TEX_RELIEF = 0.40` is ASSUMED. This is the plate that turns it into a measured number.

**Files:**
- Modify: `hardware/pocket_card/case/coupon.py`

**Interfaces:**
- Consumes: `texture.brick_rects` from Task 3.
- Produces: `coupon.texture_plate() -> cq.Workplane`, exported to `out/coupon_texture.stl`.

- [ ] **Step 1: Read the existing coupon idiom**

```bash
grep -n "^def \|COUPON_CLEARANCES\|exporters.export" hardware/pocket_card/case/coupon.py
```

Match how the existing plate engraves its station indices.

- [ ] **Step 2: Add the ladder constant to params.py**

```python
TEX_COUPON_RELIEFS = (0.20, 0.30, 0.40, 0.50, 0.60)  # DECIDED  ladder, mm
```

- [ ] **Step 3: Add `texture_plate()` to coupon.py**

```python
def texture_plate():
    """Relief ladder: the tile at five heights, at both pitches.

    TEX_RELIEF cannot be derived, only found — the same reason
    COUPON_CLEARANCES exists. Print this beside the next clearance coupon,
    judge it in the hand, and feed the winner back into params.TEX_RELIEF.
    """
    import texture

    pad = 3.0
    cell = 16.0
    base_t = 2.0
    pitches = (P.TEX_PIXEL_FINE, P.TEX_PIXEL_COARSE)
    n = len(P.TEX_COUPON_RELIEFS)

    w = pad * 2 + cell * n
    h = pad * 2 + cell * len(pitches)
    plate = (cq.Workplane("XY")
             .box(w, h, base_t, centered=False))

    for row, pitch in enumerate(pitches):
        for col, relief in enumerate(P.TEX_COUPON_RELIEFS):
            x0 = pad + col * cell
            y0 = pad + row * cell
            rects = texture.brick_rects(pitch, x0, y0, x0 + cell, y0 + cell)
            for ax0, ay0, ax1, ay1 in rects:
                plate = plate.union(
                    cq.Workplane("XY")
                    .box(ax1 - ax0, ay1 - ay0, relief, centered=False)
                    .translate((ax0, ay0, base_t)))
    return plate
```

- [ ] **Step 4: Export it**

In `coupon.py`'s `__main__` block, alongside the existing exports:

```python
    tp = texture_plate()
    cq.exporters.export(tp, os.path.join(OUT, "coupon_texture.stl"))
    print(f"  wrote out/coupon_texture.stl  "
          f"({len(P.TEX_COUPON_RELIEFS)} reliefs x 2 pitches)")
```

- [ ] **Step 5: Build it**

```bash
hardware/pocket_card/case/.venv/bin/python hardware/pocket_card/case/coupon.py
```

Expected: `wrote out/coupon_texture.stl (5 reliefs x 2 pitches)`.

- [ ] **Step 6: Commit**

```bash
git add hardware/pocket_card/case/coupon.py hardware/pocket_card/case/params.py
git commit -m "coupon: texture relief ladder plate"
```

---

### Task 11: Retire the Blender cutters

The blend becomes a consumer of the CAD, not a source.

**Files:**
- Modify: `hardware/card/case/case_updated.blend`
- Delete: `hardware/pocket_card/case/out/order/shell_front_embossed.stl`

- [ ] **Step 1: Rebuild everything first**

```bash
make pocket_card_case_shells
```

Expected: shells, caps, tips and the order pack rebuild with relief included.

- [ ] **Step 2: Strip the cutters from the blend**

Write `hardware/pocket_card/case/tools/strip_blend_cutters.py`:

```python
"""Remove the retired emboss boolean stack from case_updated.blend.

The relief now comes from the CadQuery build, so the shells import already
textured. Run headless:

  /Applications/Blender.app/Contents/MacOS/Blender -b \
      hardware/card/case/case_updated.blend \
      --python hardware/pocket_card/case/tools/strip_blend_cutters.py \
      -- --save
"""
import sys

import bpy

CUTTERS = ("bricktexture", "bricktexture.001", "bricktexture.002",
           "bricktexture.003", "texts.001", "logo")
ORPHANS = ("texts", "ring_surface_flair")

shell = bpy.data.objects["shell_front"]
for md in list(shell.modifiers):
    if md.type == "BOOLEAN" and md.object and md.object.name in CUTTERS:
        print("removing modifier", md.name, "->", md.object.name)
        shell.modifiers.remove(md)

for name in CUTTERS + ORPHANS:
    o = bpy.data.objects.get(name)
    if o:
        print("removing object", name)
        bpy.data.objects.remove(o, do_unlink=True)

print("remaining modifiers on shell_front:",
      [m.name for m in shell.modifiers])

if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
    print("saved")
```

- [ ] **Step 3: Dry run it**

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b hardware/card/case/case_updated.blend --python hardware/pocket_card/case/tools/strip_blend_cutters.py
```

Expected: lists six modifiers and eight objects removed, then `remaining modifiers on shell_front: []`. **Nothing is saved** without `-- --save`.

- [ ] **Step 4: Confirm with the user before saving**

The blend is 19 MB of hand-authored work and is not reconstructible from code. Show the dry-run output and get an explicit go-ahead before running with `-- --save`.

- [ ] **Step 5: Remove the stale embossed STL**

```bash
git rm hardware/pocket_card/case/out/order/shell_front_embossed.stl
```

- [ ] **Step 6: Commit**

```bash
git add hardware/pocket_card/case/tools/strip_blend_cutters.py hardware/card/case/case_updated.blend
git commit -m "blend: retire the emboss boolean stack; relief comes from CAD now"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: proud relief direction → Tasks 2, 4; tile → Tasks 1, 3; two pitches → Tasks 1, 6; wrapping → Task 4; registration → Tasks 1, 8, 9; button keep-out → Task 5; silhouette clipping → Tasks 7, 8 (via the existing `clip_to_envelope` calls); construction/single-face → Task 6 Step 5; parameters → Tasks 1, 10; keepouts → Tasks 5, 9; coupon → Task 10; verification → Task 9; Blender cleanup → Task 11.

**Known risks, called out rather than hidden.**

1. **`_wall_prisms` is the weakest part of this plan.** `_perimeter_segments` returns one sample per brick, which places each brick at its arc-length midpoint with a flat footprint — an approximation of a curved wall. It will look right on the straight runs and may show faceting through `CASE_TOP_R` / `CASE_BOTTOM_R`. Treat Task 6 Step 4 as the point where this gets judged on a real preview, not assumed. If it looks wrong, the fallback in the spec (radial extrusion for the perimeter zone) is the next thing to try.
2. **Build time is unmeasured.** The coarse pitch over a 366 mm perimeter is roughly 700 tiles worth of brick. Task 6 Step 5 exists specifically to catch this. Do not let a slow build run unattended for an hour — kill it and take the fused-extrusion path.
3. **Parameter names are resolved, not guessed.** The Menu pill is `PILL_L` / `PILL_W` (there is no `MENU_CAP_L`), and `shell_back.py` already defines `LID_Z0` / `LID_Z1` / `SHELL_DEPTH` at lines 24-27. Both are used directly.
4. Task 11 Step 4 is a hard stop for user confirmation — the blend cannot be regenerated from source.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-03-pocket-card-surface-treatment.md`.
