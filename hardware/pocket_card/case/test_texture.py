"""Unit tests for texture.py and its parameters.

No pytest in this venv by design — plain asserts, same idiom as checks.py.

Run:  .venv/bin/python test_texture.py
"""
import math
import sys

import cadquery as cq

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

    # Bbox and volume alone cannot tell a true parallel offset from a bug
    # that grows w/h but leaves the corner radii (P.CASE_TOP_R / _BOTTOM_R)
    # fixed: a rounded rectangle's bbox is always w x h regardless of corner
    # radius, and a radius-frozen "offset" still gains volume (just less
    # than a true one would). Steiner's formula for offsetting a CONVEX
    # planar region outward by r is shape-independent —
    #   Area(offset) == Area + Perimeter*r + pi*r^2
    # — and holds for _plan_solid's rounded-rectangle cross-section (any
    # corner radii, north/south differ) precisely BECAUSE the construction
    # grows every radius by r in step with w/h. This checks the actual
    # invariant by measuring real OCC geometry, not by restating the
    # CASE_TOP_R/CASE_BOTTOM_R arithmetic under a different name — dropping
    # either "- inset" term in _plan_solid makes the corner geometry diverge
    # from a true offset and this check fails (verified by hand: temporarily
    # hardcoding rt/rb to skip the inset term moved the area ~7 mm^2 off the
    # Steiner prediction, well past the tolerance below; reverted).
    plan_nominal = side_arc._plan_solid(0.0)
    plan_grown = side_arc._plan_solid(-r)
    z_ref = -1.0  # inside both solids' z-range, clear of the front/back ends
    slab = (cq.Workplane("XY")
            .box(P.BODY_W + 4, P.BODY_H + 4, 0.02, centered=False)
            .translate((-2.0, -2.0, z_ref)))
    face_n = cq.Workplane(plan_nominal).intersect(slab).faces("<Z").val()
    face_g = cq.Workplane(plan_grown).intersect(slab).faces("<Z").val()
    area_n, perim_n = face_n.Area(), face_n.outerWire().Length()
    area_g = face_g.Area()
    expected_g = area_n + perim_n * r + math.pi * r * r
    check("plan-view corners are a true parallel offset (Steiner check)",
          abs(area_g - expected_g) < 0.5,
          f"{area_g:.2f} vs {expected_g:.2f} "
          f"(nominal area {area_n:.2f}, perimeter {perim_n:.2f})")


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

    # phase lock, proven against a window-relative implementation: the check
    # above alone is too weak, because BOTH windows it compares (corners at
    # 0 and at `tile`) start on a tile boundary. A buggy implementation that
    # re-derives the tile grid from each window's own corner — instead of
    # from P.TEX_ORIGIN — would place "phase 0" at each window's corner and
    # pass that check too, since a tile-boundary-aligned corner looks the
    # same either way. Using a corner that is NOT a tile-boundary multiple
    # (but is still pitch-aligned, so no cell is clipped mid-brick) forces
    # the two conventions apart: a phase-locked implementation reproduces
    # the exact same ABSOLUTE (mod-tile) brick positions regardless of where
    # the window sits, while a window-relative one would shift the pattern
    # by the window corner instead of holding it fixed to TEX_ORIGIN.
    off_corner = pitch * 2  # 2 whole pixels, not a multiple of `tile`
    off = texture.brick_rects(pitch, off_corner, off_corner,
                               off_corner + tile, off_corner + tile)
    off_abs = sorted((round(x[0] % tile, 6), round(x[1] % tile, 6))
                      for x in off)
    check("off-boundary window still lands on the TEX_ORIGIN phase",
          a == off_abs, f"{a} vs {off_abs}")

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

    # row 0 of TEX_TILE is the sprite's TOP: the top pitch-row of a tile
    # window must show the same on/off pattern as P.TEX_TILE[0], not [-1].
    top_row = [b for b in r if b[3] >= tile - 1e-9]
    top_cols = sorted(round(b[0] / pitch) for b in top_row)
    expected_cols = [c for c, ch in enumerate(P.TEX_TILE[0]) if ch == "#"]
    check("row 0 of TEX_TILE renders at the top (max y) of the tile",
          top_cols == expected_cols, f"{top_cols} vs {expected_cols}")


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

    n_rects = len(texture.brick_rects(pitch, 0.0, 0.0, tile, tile))
    check("one face per brick rectangle",
          len(f.faces().vals()) == n_rects,
          f"{len(f.faces().vals())} vs {n_rects}")

    check("faces sit on the XY plane at z = 0",
          all(abs(x.Center().z) < 1e-9 for x in f.faces().vals()))


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


def _raycast(shape, origin, direction, tol=1e-6):
    """First hit of `shape` along `direction` from `origin`.

    Returns (point (x, y, z), face, u, v, w), where w is the ray parameter
    (distance from origin, since `direction` is normalized) -- or None on a
    miss. Uses the real OCC face intersector, the same technique
    side_arc.py's own `_envelope_intersector` uses for `outer_back_z_at`.
    """
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector

    isec = IntCurvesFace_ShapeIntersector()
    isec.Load(shape.wrapped, tol)
    dx, dy, dz = direction
    n = math.sqrt(dx * dx + dy * dy + dz * dz)
    d = (dx / n, dy / n, dz / n)
    isec.Perform(gp_Lin(gp_Pnt(*origin), gp_Dir(*d)), 0.0, 1e6)
    if not isec.IsDone() or isec.NbPnt() == 0:
        return None
    i = min(range(1, isec.NbPnt() + 1), key=lambda k: isec.WParameter(k))
    p = isec.Pnt(i)
    return (p.X(), p.Y(), p.Z()), isec.Face(i), isec.UParameter(i), isec.VParameter(i), isec.WParameter(i)


def _normal_at(face, u, v):
    """Exact local outward normal of `face` at surface parameters (u, v)."""
    from OCP.BRep import BRep_Tool
    from OCP.GeomLProp import GeomLProp_SLProps
    from OCP.TopAbs import TopAbs_Orientation

    surf = BRep_Tool.Surface_s(face)
    props = GeomLProp_SLProps(surf, u, v, 1, 1e-6)
    n = props.Normal()
    vec = (n.X(), n.Y(), n.Z())
    if face.Orientation() == TopAbs_Orientation.TopAbs_REVERSED:
        vec = (-vec[0], -vec[1], -vec[2])
    return vec


def _skin_thickness_at(nominal, grown, probe_origin, probe_dir):
    """Perpendicular skin thickness where `probe_dir` from `probe_origin`
    first meets the NOMINAL envelope's surface.

    `probe_dir` only locates a point -- the actual measurement direction is
    the real local surface normal at that point (queried from OCC, not
    assumed), re-cast as a fresh ray. That is what "thickness measured
    perpendicular to the local surface" means on a rolled/curved surface: a
    plain vertical or horizontal probe over- or under-reports thickness
    anywhere the surface is not axis-aligned, which is most of the back roll
    and every plan corner.
    """
    hit = _raycast(nominal, probe_origin, probe_dir)
    if hit is None:
        return None
    p0, face, u, v, _ = hit
    nx, ny, nz = _normal_at(face, u, v)
    far = (p0[0] + nx * 50, p0[1] + ny * 50, p0[2] + nz * 50)
    back = (-nx, -ny, -nz)
    hit_n = _raycast(nominal, far, back)
    hit_g = _raycast(grown, far, back)
    if hit_n is None or hit_g is None:
        return None
    return hit_n[4] - hit_g[4]


def test_proud_skin_thickness_probe():
    print("proud skin thickness probe (perpendicular to local surface)")
    import side_arc

    r = P.TEX_RELIEF
    tol = 0.01
    nominal = side_arc._envelope(0.0)
    grown = side_arc._envelope(-r)

    # Flat front face, dead centre -- clear of the EDGE_CHAMFER band and any
    # plan corner. This is the point that was 0.0 mm (not TEX_RELIEF) before
    # _plan_solid grew the front face along with the back and the outline:
    # with the front pinned to z = 0 for every inset, nominal and grown
    # shared the exact same front plane and grown.cut(nominal) removed
    # everything there.
    t = _skin_thickness_at(nominal, grown,
                            (P.BODY_W / 2, P.BODY_H / 2, 100), (0, 0, -1))
    check("skin is TEX_RELIEF thick on the flat front face",
          t is not None and abs(t - r) < tol, f"{t}")

    # A straight side-wall run (west wall), mid-height -- clear of the front
    # chamfer band and the back roll.
    t = _skin_thickness_at(nominal, grown,
                            (-100, P.BODY_H / 2, -5), (1, 0, 0))
    check("skin is TEX_RELIEF thick on a side wall",
          t is not None and abs(t - r) < tol, f"{t}")

    # Partway round the side-arc back roll (the BACK_ROLL_SIDE band, west
    # wall near the back). This is the coverage for carry-forward item 2:
    # side_arc._roll_radius_at's "P.BACK_ROLL_* - inset" terms have no
    # radius-sensitive test elsewhere, and _envelope(-r) is the first caller
    # to ever invoke them with a negative inset. Verified by hand: dropping
    # the "- inset" term from all three branches (so the grown envelope's
    # roll fillet uses the un-grown BACK_ROLL_SIDE radius) moves this exact
    # reading from 0.4000 to 0.4829 mm -- 0.083 mm off, 8x this test's
    # tolerance, so a dropped term here does not slip through silently.
    t = _skin_thickness_at(nominal, grown,
                            (-100, P.BODY_H / 2, -9.05 - 100), (1, 0, 1))
    check("skin is TEX_RELIEF thick on the side-arc back roll",
          t is not None and abs(t - r) < tol, f"{t}")

    # Near a plan corner (south-west, CASE_BOTTOM_R), mid-depth -- clear of
    # both the front chamfer and the back roll, so this isolates the plan
    # corner radius growth on its own.
    rb = P.CASE_BOTTOM_R
    cx, cy = rb, P.BODY_H - rb
    ox, oy = cx - 70.7, cy + 70.7
    t = _skin_thickness_at(nominal, grown, (ox, oy, -5), (1, -1, 0))
    check("skin is TEX_RELIEF thick near a plan corner",
          t is not None and abs(t - r) < tol, f"{t}")


def test_edge_chamfer_band_thickness():
    """Carry-forward item 1: what grown.cut(nominal) does at EDGE_CHAMFER.

    side_arc._envelope's EDGE_CHAMFER branch (`if inset <= 1e-9`) fires for
    BOTH inset = 0.0 (nominal) and inset = -TEX_RELIEF (grown), applying the
    same 0.8 mm 45-degree chamfer leg to each. The two chamfered corners
    themselves are offset from each other by (dx, dz) = (-r, +r) before any
    chamfering happens -- a vector that points exactly along the chamfer
    bevel's own 45-degree normal. Chamfering both corners with the same leg
    length clips material near each corner symmetrically but does not change
    the gap between the two (now parallel) bevel PLANES, so the skin in that
    0.8 mm perimeter band is r*sqrt(2) thick, not r: measured 0.5657 mm
    against a plain TEX_RELIEF of 0.40 mm, a 41% overshoot.

    This is a real, non-benign deviation from "constant thickness perpendicular
    to the local surface" -- but it is NOT fixed here. A correct fix needs a
    chamfer leg computed specifically for the grown copy (something like
    EDGE_CHAMFER - TEX_RELIEF * (2 - sqrt(2)) for this bevel geometry), which
    can only be correct for one specific TEX_RELIEF/EDGE_CHAMFER pairing and
    means proud_skin can no longer just consume side_arc._envelope's shared,
    cached construction -- the plan's own sanctioned interface for this task.
    That is a genuine design decision (redesign the chamfer as a true offset,
    or exclude the chamfer band from brick zones in whichever later task
    places bricks), not a local fix belonging to this task. It does not
    violate any of this task's hard invariants: the skin stays outside the
    nominal envelope (checked in test_proud_skin), stays manifold (`skin.val()
    .isValid()` is True), and does not touch wall thickness anywhere. Locked
    in here as a regression guard and a flag for whoever places bricks in the
    front-face zone next.
    """
    print("edge chamfer band thickness (carry-forward item 1)")
    import side_arc
    import texture

    r = P.TEX_RELIEF
    nominal = side_arc._envelope(0.0)
    grown = side_arc._envelope(-r)

    t = _skin_thickness_at(nominal, grown,
                            (0.2, P.BODY_H / 2, 100), (0, 0, -1))
    expected = r * math.sqrt(2)
    check("chamfer band is r*sqrt(2) thick, not r -- known, documented, "
          "does not affect wall thickness or manifoldness",
          t is not None and abs(t - expected) < 0.01,
          f"{t} vs r*sqrt(2)={expected:.4f} (plain TEX_RELIEF would be {r})")

    check("skin stays a valid manifold solid despite the chamfer-band overlap",
          texture.proud_skin(r).val().isValid())


def main():
    test_tile_shape()
    test_pitches()
    test_relief_budget()
    test_origin()
    test_outward_envelope()
    test_brick_rects()
    test_brick_face()
    test_proud_skin()
    test_proud_skin_thickness_probe()
    test_edge_chamfer_band_thickness()
    print()
    if FAILURES:
        sys.exit(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    print("all texture tests passed")


if __name__ == "__main__":
    main()
