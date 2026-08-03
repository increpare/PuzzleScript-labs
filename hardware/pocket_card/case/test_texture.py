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
    check("root overlap is 0.05 mm", P.TEX_ROOT_OVERLAP == 0.05)
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


def test_brick_runs_coalesce_connected_pixels():
    print("brick runs")
    import texture

    pitch = P.TEX_PIXEL_FINE
    tile = pitch * len(P.TEX_TILE)
    runs = sorted(texture._brick_runs(pitch, 0.0, 0.0, tile, tile),
                  key=lambda run: run[1])

    check("one tile has exactly two connected brick components",
          len(runs) == 2, f"got {runs}")
    check("each connected brick is 4 pixels by 2 pixels",
          all(abs((x1 - x0) - 4 * pitch) < 1e-9
              and abs((y1 - y0) - 2 * pitch) < 1e-9
              and abs((x1 - x0) * (y1 - y0) - 8 * pitch * pitch) < 1e-9
              for x0, y0, x1, y1 in runs),
          f"got {runs}")
    expected = [(pitch, 0.0, 5 * pitch, 2 * pitch),
                (0.0, 3 * pitch, 4 * pitch, 5 * pitch)]
    check("bottom brick is offset right and row 0 stays at the tile top",
          runs == expected, f"{runs} vs {expected}")


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


def test_root_overlap_skin():
    print("root overlap skin")
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
    check("front bond skin has real shared volume inside nominal",
          overlap > 1.0, f"{overlap:.3f} mm^3")

    check("front bond root stops at the z-normal 0.05 mm allowance",
          abs(bonded.val().BoundingBox().zmin + P.TEX_ROOT_OVERLAP) < 0.01,
          f"zmin {bonded.val().BoundingBox().zmin:.3f}")

    visible = bonded.cut(nominal).val().Volume()
    pure_front = pure.intersect(front_band).val().Volume()
    check("root overlap leaves the visible proud skin unchanged",
          abs(visible - pure_front) < 1.0,
          f"{visible:.3f} vs {pure_front:.3f} mm^3")

    wall = texture._relief_skin(
        P.TEX_RELIEF, P.TEX_ROOT_OVERLAP, zone="wall")
    check("wall bond skin has real shared volume inside nominal",
          wall.intersect(nominal).val().Volume() > 1.0)

    # Root validity must be established before prism/OCC construction, just
    # like z-bound validity.  This keeps bad construction-only inputs from
    # reaching a heavyweight boolean with nonsensical dimensions.
    original = texture._front_prisms

    def construction_reached(*_args):
        raise RuntimeError("invalid root overlap reached OCC construction")

    def raises_exact_value_error(fn):
        try:
            fn()
        except Exception as error:
            return type(error) is ValueError
        return False

    texture._front_prisms = construction_reached
    try:
        for value, name in ((-0.01, "negative"),
                            (P.TEX_ROOT_OVERLAP + 0.01, "above designed root"),
                            (float("nan"), "NaN"),
                            (float("inf"), "+inf"),
                            (min(P.WALL, P.FACE_T), "shell thickness")):
            check(f"{name} root overlap is rejected before construction",
                  raises_exact_value_error(
                      lambda value=value: texture.relief_for_zone(
                          "front", -1.0, 1.0, value)))
    finally:
        texture._front_prisms = original


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
    """Perpendicular-thickness probe at named, well-understood locations.

    Each point below sits in a region the surrounding geometry (chamfer,
    rib blend) is known NOT to touch, so this test asserts an exact
    TEX_RELIEF reading everywhere it samples. It is deliberately narrow: it
    proves the mechanism works at representative points on every kind of
    surface (flat front, flat wall, three separate roll fillets, plan
    corner), not that the WHOLE skin is uniform -- two real, localized
    deviations exist elsewhere (the front-perimeter chamfer band, now fixed
    and locked by test_edge_chamfer_band_thickness; and the rib-blend band
    on the back/wall, NOT fixed and characterised instead by
    test_proud_skin_deviation_map's grid sweep, which is what actually
    verifies "no deviation anywhere unaccounted for").
    """
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
    # chamfer band, the back roll, and the rib-blend y-band (RIB_Y..RIB_Y2).
    t = _skin_thickness_at(nominal, grown,
                            (-100, P.BODY_H / 2, -5), (1, 0, 0))
    check("skin is TEX_RELIEF thick on a side wall",
          t is not None and abs(t - r) < tol, f"{t}")

    # Three separate probes, one per branch of side_arc._roll_radius_at
    # (carry-forward item 2). side_arc._envelope(-r) is the first caller
    # ever to invoke that function with a negative inset, and it has no
    # other radius-sensitive coverage. A single mutation dropping all three
    # "- inset" terms at once is not enough evidence that each BRANCH is
    # individually exercised, so each was verified separately by hand:
    # copy side_arc.py, drop "- inset" from exactly one branch, rebuild
    # nominal/grown from that copy, and confirm ONLY the matching probe
    # below moves outside `tol` while the other two stay at 0.4000:
    #
    #   branch dropped   north probe   south probe   side probe
    #   BACK_ROLL_N       0.5636 <--     0.4000        0.4000
    #   BACK_ROLL_S       0.4000         0.5427 <--     0.4000
    #   BACK_ROLL_SIDE    0.4000         0.4000        0.4829 <--
    #
    # Each deviation is 8-14x this test's 0.01 mm tolerance and lands only
    # on its own branch's probe, so a dropped term in any one branch alone
    # does not slip through.

    # North roll (BACK_ROLL_N), mid-width, well into the rib's full-depth
    # plateau (x = 45, north of RIB_Y) so the fillet being probed is
    # unambiguously the back-perimeter roll, not the rib blend.
    t = _skin_thickness_at(nominal, grown, (45.0, -100.0, -115.0), (0, 1, 1))
    check("skin is TEX_RELIEF thick on the north back roll (BACK_ROLL_N)",
          t is not None and abs(t - r) < tol, f"{t}")

    # South roll (BACK_ROLL_S), mid-width, south of the rib blend entirely.
    t = _skin_thickness_at(nominal, grown, (45.0, 193.0, -112.0), (0, -1, 1))
    check("skin is TEX_RELIEF thick on the south back roll (BACK_ROLL_S)",
          t is not None and abs(t - r) < tol, f"{t}")

    # Side roll (BACK_ROLL_SIDE), west wall mid-height, partway round the
    # fillet. The local normal there measures ~15 degrees off the flat
    # wall's normal (not "45 degrees into the fillet" as an earlier draft
    # of this report claimed) -- still squarely on the curved roll surface,
    # just close to the wall-tangent end of it rather than the middle.
    t = _skin_thickness_at(nominal, grown,
                            (-100, P.BODY_H / 2, -9.05 - 100), (1, 0, 1))
    check("skin is TEX_RELIEF thick on the side back roll (BACK_ROLL_SIDE)",
          t is not None and abs(t - r) < tol, f"{t}")

    # Near a plan corner (south-west, CASE_BOTTOM_R), mid-depth -- clear of
    # the front chamfer, the back roll, and the rib-blend y-band, so this
    # isolates the plan corner radius growth on its own.
    rb = P.CASE_BOTTOM_R
    cx, cy = rb, P.BODY_H - rb
    ox, oy = cx - 70.7, cy + 70.7
    t = _skin_thickness_at(nominal, grown, (ox, oy, -5), (1, -1, 0))
    check("skin is TEX_RELIEF thick near a plan corner",
          t is not None and abs(t - r) < tol, f"{t}")


def test_edge_chamfer_band_thickness():
    """Carry-forward item 1: what grown.cut(nominal) does at EDGE_CHAMFER.

    side_arc._envelope's EDGE_CHAMFER branch (`if inset <= 1e-9`) fires for
    BOTH inset = 0.0 (nominal) and inset = -TEX_RELIEF (grown). Reusing the
    same 0.8 mm chamfer leg for both was wrong: the two un-chamfered corners
    are already offset from each other by (dx, dz) = (-r, +r), a vector that
    points exactly along the chamfer bevel's own 45-degree normal, so a
    shared leg length left the two bevel PLANES r*sqrt(2) apart instead of r
    (measured 0.5657 mm against a plain TEX_RELIEF of 0.40 mm before the fix
    below -- a 41% overshoot).

    Fixed in _envelope: the grown copy's leg grows by
    (-inset) * (2 - sqrt(2)), which puts its bevel plane exactly (-inset) mm
    outside the nominal one, measured perpendicular to the bevel. This is a
    one-line change entirely inside _envelope's existing chamfer branch, on
    a path only negative-inset callers reach (today: only proud_skin), so it
    carries no risk to the shells (verified in the task report: both shells'
    build volumes are unchanged to 6 decimal places after this change, same
    as after the front-face fix, since neither ever calls _envelope with a
    negative inset).
    """
    print("edge chamfer band thickness (carry-forward item 1)")
    import side_arc
    import texture

    r = P.TEX_RELIEF
    tol = 0.01
    nominal = side_arc._envelope(0.0)
    grown = side_arc._envelope(-r)

    t = _skin_thickness_at(nominal, grown,
                            (0.2, P.BODY_H / 2, 100), (0, 0, -1))
    check("chamfer band is TEX_RELIEF thick after the leg-length fix",
          t is not None and abs(t - r) < tol, f"{t}")

    check("skin stays a valid manifold solid through the chamfer band",
          texture.proud_skin(r).val().isValid())


def test_proud_skin_deviation_map():
    """Coarse grid sweep of perpendicular thickness across the whole skin.

    The four hand-picked points in test_proud_skin_thickness_probe all landed
    on exact regions and caught neither of this task's two real deviations
    (the chamfer band, now fixed; the rib-blend band, not fixed). A handful
    of named points cannot make a uniformity claim -- only a sweep can. This
    scans several hundred points each across the front face, the back face,
    and both side walls, using the same true-local-normal method as the
    named probes, and asserts that nothing outside a known, characterised
    region deviates from TEX_RELIEF by more than `tol`.

    Carry-forward item 1 (chamfer): the front sweep confirms the fix holds
    everywhere along the perimeter, not just at the one sampled x -- every
    front-face point (992 of them, spanning x = 0..90, including the whole
    chamfer band at every edge) reads exactly TEX_RELIEF.

    The rib-blend band (side_arc._rib_region, ~side_arc.py:143-151, NOT
    fixed per the design-decision instruction that came with this finding):
    for negative inset it shifts its profile by (dy, dz) = (+r, -r), a
    diagonal translation of the whole blend profile rather than a true
    normal offset -- the exact failure mode _envelope's own docstring
    already documents for the INWARD case ("slightly over-offset through
    the blend ... in a band where nothing lives"). Except here something
    DOES live there: it's a texture zone. Measured (this sweep, back face,
    x = 45, mid-width):

        y       thickness   deviation
        11.0    0.4000      +0%       <- RIB_Y, blend start
        15.0    0.4826      +21%
        17.3    0.5175      +29%      <- peak
        19.0    0.4937      +23%
        21.0    0.4564      +14%
        23.35   0.4048      +1%       <- RIB_Y2, blend end
        25.0    0.4000      +0%

    The deviation is confined almost exactly to y in [RIB_Y, RIB_Y2] =
    [11.0, 23.3] -- the blend's own y-extent -- and is present across nearly
    the full 90 mm width (x = 8..82 all read the same peak; it tapers off
    smoothly only within about 8 mm of the plan corners, where the roll
    takes over). It also bleeds a smaller amount onto the WEST/EAST walls in
    the same y-band, near their back edge (z close to -BODY_T): peak
    measured 0.488 mm (+22%) at (y=17, z=-13), fading to exact TEX_RELIEF by
    z = -9 or so. Same root cause, same y-band, smaller magnitude because
    the wall surface is closer to the blend's rotation axis than the back
    face is.

    None of this touches wall thickness (WALL is unrelated geometry, never
    reduced) or manifoldness (`texture.proud_skin(r).val().isValid()` stays
    True with the full grid built in, checked in
    test_edge_chamfer_band_thickness). Left alone per instruction: whether a
    ~29% overshoot in a ~12 mm-tall band is acceptable, or whether
    _rib_region needs a true normal offset, is a design call outside this
    task's scope.
    """
    print("proud skin deviation map (grid sweep)")
    import side_arc
    import texture

    r = P.TEX_RELIEF
    tol = 0.02
    nominal = side_arc._envelope(0.0)
    grown = side_arc._envelope(-r)

    # The one region this task found and deliberately left un-fixed: the
    # rib blend's y-extent, with a small margin.
    band_y0, band_y1 = P.RIB_Y - 1.0, P.RIB_Y2 + 1.0
    band_hi = 0.56  # comfortably above the measured 0.5175 back / 0.488 wall peaks

    # Back face, from below -- the region carrying the known deviation.
    # Keys are (x, y).
    back = {}
    for x in range(2, 89, 3):
        for y in range(0, 94, 2):
            back[(x, y)] = _skin_thickness_at(
                nominal, grown, (float(x), float(y), -100.0), (0, 0, 1))

    # Front face, from above -- must be exact everywhere, including the
    # whole EDGE_CHAMFER band at every edge (this is the chamfer-fix
    # regression coverage, broadened past the single sampled point in
    # test_edge_chamfer_band_thickness). Keys are (x, y).
    front = {}
    for x in range(0, 91, 3):
        for y in range(0, 94, 3):
            front[(x, y)] = _skin_thickness_at(
                nominal, grown, (float(x), float(y), 100.0), (0, 0, -1))

    # West / east walls, horizontal rays -- picks up the rib-blend band's
    # smaller bleed-through near the back edge of the wall. Keys are (y, z).
    west, east = {}, {}
    for y in range(10, 90, 3):
        for z in range(-13, 0, 1):
            west[(y, z)] = _skin_thickness_at(
                nominal, grown, (-100.0, float(y), float(z)), (1, 0, 0))
            east[(y, z)] = _skin_thickness_at(
                nominal, grown, (190.0, float(y), float(z)), (-1, 0, 0))

    def offenders(region, y_index):
        """Points whose thickness falls outside the tight tolerance."""
        bad = []
        for k, t in region.items():
            if t is None:
                continue
            if abs(t - r) > tol:
                bad.append((k, t, k[y_index]))
        return bad

    bad_front = offenders(front, y_index=1)
    bad_back = offenders(back, y_index=1)
    bad_west = offenders(west, y_index=0)
    bad_east = offenders(east, y_index=0)

    n_pts = len(front) + len(back) + len(west) + len(east)
    bad_wall = bad_west + bad_east
    n_bad = len(bad_front) + len(bad_back) + len(bad_wall)
    print(f"   swept {n_pts} points: front {len(front)}, back {len(back)}, "
          f"west {len(west)}, east {len(east)} -- {n_bad} outside +/-{tol} mm")
    if bad_back:
        _, pt, py = max(bad_back, key=lambda e: abs(e[1] - r))
        print(f"   back band peak: y={py} thickness={pt:.4f}")
    if bad_wall:
        _, pt, py = max(bad_wall, key=lambda e: abs(e[1] - r))
        print(f"   wall band peak: y={py} thickness={pt:.4f}")

    check("front face has zero out-of-tolerance points anywhere in the sweep "
          "(chamfer-fix regression coverage, full perimeter)",
          len(bad_front) == 0,
          f"{len(bad_front)} bad of {len(front)}: {bad_front[:5]}")

    check("back face has no out-of-tolerance points OUTSIDE the "
          "characterised rib-blend band",
          all(band_y0 <= y <= band_y1 for _, _, y in bad_back),
          f"{len(bad_back)} bad; y outside band: "
          f"{sorted(y for _, _, y in bad_back if not (band_y0 <= y <= band_y1))}")

    check("back-band deviation stays within the characterised bound "
          f"(<= {band_hi} mm)",
          all(t <= band_hi for _, t, _ in bad_back),
          f"max {max((t for _, t, _ in bad_back), default=r):.4f}")

    check("west/east wall sweeps have no out-of-tolerance points OUTSIDE "
          "the characterised rib-blend band",
          all(band_y0 <= y <= band_y1 for _, _, y in bad_wall),
          f"{len(bad_wall)} bad; y outside band: "
          f"{sorted(y for _, _, y in bad_wall if not (band_y0 <= y <= band_y1))}")

    check("wall-band deviation stays within the characterised bound "
          f"(<= {band_hi} mm)",
          all(t <= band_hi for _, t, _ in bad_wall),
          f"max {max((t for _, t, _ in bad_wall), default=r):.4f}")


def test_stations_and_islands():
    print("keep-out islands")
    import texture

    check("eight button stations", len(texture.STATIONS) == 8,
          f"got {len(texture.STATIONS)}")
    check("every station is inside the body",
          all(0 <= x <= P.BODY_W and 0 <= y <= P.BODY_H
              for x, y, _ in texture.STATIONS))

    islands = texture.button_islands()
    check("islands have real volume", islands.val().Volume() > 1.0)

    # the d-pad's left cap is the one the old blend field collided with.
    # (The brief's own follow-on check here -- comparing
    # `d/2 + TEX_KEEPOUT > DIR_CAP_D/2 + TEX_KEEPOUT - 1e-9` -- is algebraically
    # vacuous: TEX_KEEPOUT appears on both sides and cancels, so it reduces to
    # `d/2 > DIR_CAP_D/2 - 1e-9`, true regardless of TEX_KEEPOUT's value.
    # Dropped in favor of the real per-station clearance checks below, which
    # do move when TEX_KEEPOUT changes.)
    left_x = P.DIR_CX - P.DIR_RADIUS
    hit = [s for s in texture.STATIONS if abs(s[0] - left_x) < 1e-6
           and abs(s[1] - P.DIR_CY) < 1e-6]
    check("d-pad left cap is a station", len(hit) == 1)

    # Per-station radial clearance, measured from each cap's OWN physical
    # edge (island_radius - cap_radius), using the real per-station diameter
    # rather than assuming one value for all eight. For every round station
    # this works out to the same constant -- CAP_FLANGE_OS + COLLAR_CLEAR +
    # TEX_KEEPOUT -- because that fit clearance is identical for every
    # button regardless of its own diameter.
    collar_os = P.CAP_FLANGE_OS + P.COLLAR_CLEAR
    round_specs = [
        ("d-pad up", P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D),
        ("d-pad down", P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D),
        ("d-pad left", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D),
        ("d-pad right", P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D),
        ("undo", P.UNDO_X, P.UNDO_Y, P.AB_CAP_D),
        ("action", P.ACT_X, P.ACT_Y, P.AB_CAP_D),
        ("reset", P.RESET_X, P.RESET_Y, P.RESET_CAP_D),
    ]
    for name, x, y, cap_d in round_specs:
        matches = [s for s in texture.STATIONS
                   if abs(s[0] - x) < 1e-6 and abs(s[1] - y) < 1e-6]
        check(f"{name} is a station", len(matches) == 1, name)
        if not matches:
            continue
        _, _, station_d = matches[0]
        island_r = station_d / 2 + P.TEX_KEEPOUT
        clearance = island_r - cap_d / 2
        check(f"{name} clears its own cap edge by COLLAR_OS + TEX_KEEPOUT",
              abs(clearance - (collar_os + P.TEX_KEEPOUT)) < 1e-9,
              f"{clearance:.3f} mm")

    # Menu pill: measured against the REAL bore geometry shell_front.py
    # actually cuts, not against PILL_L plus a constant that merely happens
    # to match the round stations. Round-station "collar OD" (cap + flange +
    # collar clearance) is the whole bore for a round station, but the pill
    # bore is wider still by PILL_BORE_EXTRA (params.py) so its snap-over lip
    # clears the SKQG's square body -- a term the island's own diameter must
    # include too, or TEX_KEEPOUT quietly shrinks on this one station alone.
    #
    # This was exactly the Task 5 review's Important finding: an earlier
    # version of STATIONS' Menu entry omitted "+ PILL_BORE_EXTRA" (copied
    # verbatim from the plan's sample code, which never carried it), and
    # measuring against PILL_L (the cap, not the bore) hid the shortfall --
    # PILL_L alone gave a clean-looking 2.300 mm "clearance" that was
    # comparing the wrong two surfaces. Measuring against the real bore
    # shows what that bug actually delivered: 0.70 mm of the intended
    # 1.00 mm TEX_KEEPOUT, a 30% shortfall (worked below).
    import shell_front

    menu = [s for s in texture.STATIONS
            if abs(s[0] - P.MENU_X) < 1e-6 and abs(s[1] - P.MENU_Y) < 1e-6]
    check("menu pill is a station", len(menu) == 1)
    if menu:
        _, _, menu_d = menu[0]
        island_r = menu_d / 2 + P.TEX_KEEPOUT

        # The real bore, built by shell_front.button_station's own private
        # helper (not reimplemented) -- same expression that function itself
        # uses for a pill (shell_front.py, button_station's `pill` branch):
        # flange grows by CAP_FLANGE_OS, the collar clears the flange by
        # COLLAR_CLEAR, and PILL_BORE_EXTRA widens the bore further still.
        # Restated here (per the review's own sanctioned path) rather than
        # imported as a function, since shell_front.button_station only
        # returns finished solids, not the raw bore_l/bore_w it computes
        # internally.
        flange_l = P.PILL_L + 2 * P.CAP_FLANGE_OS
        flange_w = P.PILL_W + 2 * P.CAP_FLANGE_OS
        bore_l = flange_l + 2 * P.COLLAR_CLEAR + P.PILL_BORE_EXTRA
        bore_w = flange_w + 2 * P.COLLAR_CLEAR + P.PILL_BORE_EXTRA

        # Build the ACTUAL void solid with shell_front's own construction
        # function (real geometry, not just the formula restated a second
        # time) and measure it, so a mismatch between this test's bore_l/w
        # and what slot2D actually produces would itself be caught.
        depth = P.FACE_T + P.COLLAR_DEPTH
        void = shell_front._shoulder_void_slot(bore_l, bore_w, depth)
        vb = void.val().BoundingBox()
        check("real Menu bore matches the bore_l/bore_w formula (long axis)",
              abs(vb.xlen - bore_l) < 1e-6, f"{vb.xlen:.3f} vs {bore_l:.3f}")
        check("real Menu bore matches the bore_l/bore_w formula (short axis)",
              abs(vb.ylen - bore_w) < 1e-6, f"{vb.ylen:.3f} vs {bore_w:.3f}")

        clear_long = island_r - vb.xlen / 2
        clear_short = island_r - vb.ylen / 2
        print(f"   menu pill clearance vs the REAL bore: long axis "
              f"{clear_long:.3f} mm, short axis {clear_short:.3f} mm "
              f"(bore {vb.xlen:.2f} x {vb.ylen:.2f} mm)")
        check("menu pill delivers TEX_KEEPOUT against the real bore "
              "(long axis, the binding one)",
              abs(clear_long - P.TEX_KEEPOUT) < 1e-6,
              f"{clear_long:.3f} mm vs TEX_KEEPOUT={P.TEX_KEEPOUT}")
        check("menu pill delivers at least TEX_KEEPOUT against the real "
              "bore (short axis, safe over-cover)",
              clear_short >= P.TEX_KEEPOUT - 1e-9,
              f"{clear_short:.3f} mm vs TEX_KEEPOUT={P.TEX_KEEPOUT}")

        # Regression lock for the actual bug: if PILL_BORE_EXTRA is dropped
        # from STATIONS' Menu diameter again, the long-axis clearance falls
        # to island_r_without_extra - bore_l/2 = collar_os + TEX_KEEPOUT -
        # PILL_BORE_EXTRA/2 = 0.70 mm -- well outside the check above's
        # tolerance, so that regression fails loudly instead of silently
        # under-delivering keepout on one station.
        broken_island_r = (P.PILL_L + 2 * collar_os) / 2 + P.TEX_KEEPOUT
        broken_clear_long = broken_island_r - vb.xlen / 2
        check("sanity: the pre-fix formula really did under-deliver by 30%",
              abs(broken_clear_long - 0.70) < 1e-6,
              f"{broken_clear_long:.3f} mm (documents the bug this guards)")

    # Against real geometry: every station's island must actually reach the
    # proud skin -- an island that floats above or below the surface it is
    # meant to mask would pass every check above and silently mask nothing.
    # For each station, isolate the skin material directly over that (x, y)
    # with a thin probe rod and confirm the island removes ALL of it
    # (residue ~ 0). A control point far from any station confirms the
    # technique can actually tell "covered" from "not covered": the residue
    # there should be (approximately) the whole probed skin volume.
    skin = texture.proud_skin()

    def _residue_at(x, y):
        rod = (cq.Workplane("XY").circle(0.3).extrude(-200)
               .translate((x, y, 100)))
        skin_col = rod.intersect(skin)
        col_vals = skin_col.vals()
        col_vol = sum(v.Volume() for v in col_vals) if col_vals else 0.0
        residue = skin_col.cut(islands)
        res_vals = residue.vals()
        res_vol = sum(v.Volume() for v in res_vals) if res_vals else 0.0
        return col_vol, res_vol

    for i, (x, y, d) in enumerate(texture.STATIONS):
        col_vol, res_vol = _residue_at(x, y)
        check(f"station {i} at ({x:.1f}, {y:.1f}) has skin material there",
              col_vol > 1e-6, f"{col_vol:.4f} mm^3")
        check(f"station {i} island fully swallows the local skin",
              res_vol < 1e-6, f"residue {res_vol:.4f} mm^3")

    ctrl_col, ctrl_res = _residue_at(70.0, 20.0)
    check("control point far from any station is NOT swallowed "
          "(proves the residue check can tell covered from uncovered)",
          ctrl_res > 0.5 * ctrl_col, f"{ctrl_res:.4f} of {ctrl_col:.4f}")


def test_bottom_clear():
    print("bottom clear band")
    import side_arc
    import texture

    slab = texture.bottom_clear_slab()
    sb = slab.val().BoundingBox()
    check("slab is TEX_BOTTOM_CLEAR thick (plus margin for the roll)",
          sb.zlen >= P.TEX_BOTTOM_CLEAR,
          f"{sb.zlen:.2f} vs {P.TEX_BOTTOM_CLEAR:.2f}")
    check("slab sits at the bottom of the body",
          sb.zmin <= -P.BODY_T + 1e-6, f"zmin {sb.zmin:.2f}")

    # Against real geometry: intersect with the nominal envelope and confirm
    # the covered band spans nearly the full plan footprint, not just a
    # patch in the flat middle. A slab restricted in XY would still pass
    # both Z-only checks above and silently miss the rolled sides.
    nominal = side_arc._envelope(0.0)
    mask = cq.Workplane(nominal).intersect(slab)
    mb = mask.val().BoundingBox()
    check("clear band covers nearly the full width",
          mb.xlen > P.BODY_W - 5.0, f"{mb.xlen:.2f} vs {P.BODY_W:.2f}")
    check("clear band covers nearly the full height",
          mb.ylen > P.BODY_H - 5.0, f"{mb.ylen:.2f} vs {P.BODY_H:.2f}")

    # Explicit probes on the ROLLED surface itself, not the flat middle:
    # near both side walls, near two rounded plan corners. Each ray-casts
    # the nominal envelope from directly below, reusing the module's own
    # real-OCC intersector (_raycast, already exercised by the proud-skin
    # probes above); the first hit is the outward back-facing surface at
    # that (x, y), flat or rolled.
    def _back_z_at(x, y):
        hit = _raycast(nominal, (x, y, -200.0), (0, 0, 1))
        return hit[0][2] if hit else None

    probes = [
        ("near west wall, on the roll", 2.0, P.BODY_H / 2),
        ("near east wall, on the roll", P.BODY_W - 2.0, P.BODY_H / 2),
        ("near a rounded plan corner", 5.0, 5.0),
        ("near the opposite plan corner", P.BODY_W - 5.0, P.BODY_H - 5.0),
    ]
    for name, x, y in probes:
        z = _back_z_at(x, y)
        check(f"{name}: back surface point falls inside the clear slab",
              z is not None and sb.zmin - 1e-6 <= z <= sb.zmax + 1e-6,
              f"z={z}")


def _raises_value_error(fn):
    try:
        fn()
    except ValueError:
        return True
    except Exception:
        return False
    return False


def test_relief_for_zone():
    print("relief solid")
    import side_arc
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

    # A wall band accepts reversed limits, normalises them, and uses the
    # coarse pattern around the complete nominal plan perimeter.
    wall = texture.relief_for_zone("wall", -1.0, -2.0)
    wv = wall.val().Volume()
    wb = wall.val().BoundingBox()
    check("reversed wall band has relief", wv > 1.0,
          f"{wv:.1f} mm^3")
    check("wall relief stays inside its normalized z band",
          wb.zmin >= -2.0 - 1e-3 and wb.zmax <= -1.0 + 1e-3,
          f"z={wb.zmin:.4f}..{wb.zmax:.4f}")

    # Rooted relief is a construction aid, never a surface-treatment change.
    # Compare final (keep-out-cut and chamfered) geometry in BOTH directions:
    # a one-way volume check would miss either added nubs or lost brick tops.
    nominal = cq.Workplane(side_arc._envelope(0.0))
    root = P.TEX_ROOT_OVERLAP
    front_rooted = texture.relief_for_zone(
        "front", -P.TEX_RELIEF, P.TEX_RELIEF * 2, root)
    front_visible = front_rooted.cut(nominal)
    front_added = front_visible.cut(front).val().Volume()
    front_lost = front.cut(front_visible).val().Volume()
    check("front root keeps final visible relief unchanged (no additions)",
          front_added < 0.5, f"{front_added:.3f} mm^3")
    check("front root keeps final visible relief unchanged (no losses)",
          front_lost < 0.5, f"{front_lost:.3f} mm^3")
    check("front rooted relief overlaps the nominal shell",
          front_rooted.intersect(nominal).val().Volume() > 1.0)

    wall_rooted = texture.relief_for_zone("wall", -2.0, -1.0, root)
    wall_visible = wall_rooted.cut(nominal)
    wall_added = wall_visible.cut(wall).val().Volume()
    wall_lost = wall.cut(wall_visible).val().Volume()
    check("wall root keeps final visible relief unchanged (no additions)",
          wall_added < 0.5, f"{wall_added:.3f} mm^3")
    check("wall root keeps final visible relief unchanged (no losses)",
          wall_lost < 0.5, f"{wall_lost:.3f} mm^3")
    check("wall rooted relief overlaps the nominal shell",
          wall_rooted.intersect(nominal).val().Volume() > 1.0)

    check("unknown zone is rejected",
          _raises_value_error(lambda: texture.relief_for_zone("nope", -1.0, 1.0)))


def test_relief_bounds_validation():
    print("relief bounds validation")
    import texture

    # A finite check belongs before prism/OCC construction. Replacing the
    # front builder makes that ordering observable without asking OCC to
    # process NaN or infinity.
    original = texture._front_prisms

    def construction_reached(*_args):
        raise RuntimeError("non-finite bounds reached OCC construction")

    texture._front_prisms = construction_reached
    try:
        for value, name in ((float("nan"), "NaN"),
                            (float("inf"), "+inf"),
                            (-float("inf"), "-inf")):
            check(f"{name} bound is rejected before construction",
                  _raises_value_error(
                      lambda value=value: texture.relief_for_zone("front", value, 1.0)))
    finally:
        texture._front_prisms = original

    check("zero-height band is rejected",
          _raises_value_error(lambda: texture.relief_for_zone("front", 1.0, 1.0)))


def test_large_relief_chamfer_attempt():
    print("large relief chamfer")
    import texture

    # More than the old 128-solid bypass: all disconnected boxes have simple,
    # valid top edges, so a per-solid chamfer must visibly reduce volume.
    solids = [cq.Solid.makeBox(1.0, 1.0, P.TEX_RELIEF,
                               cq.Vector(i * 2.0, 0, 0))
              for i in range(129)]
    relief = cq.Workplane(cq.Compound.makeCompound(solids))
    chamfered = texture._chamfer_proud_tops(relief)
    before = relief.solids().vals()
    after = chamfered.solids().vals()
    check("every large disconnected relief brick gets a top chamfer",
          len(before) == len(after)
          and all(b.Volume() > a.Volume() + 1e-6 for b, a in zip(before, after)),
          f"{chamfered.val().Volume():.4f} vs {relief.val().Volume():.4f}")
    check("large chamfered relief remains valid", chamfered.val().isValid())


def _wall_relief_source(texture, z0=-2.0, z1=-1.0):
    return (texture._wall_prisms(z0, z1).intersect(texture.proud_skin())
            .cut(texture.button_islands()).cut(texture.bottom_clear_slab()))


def _inside_bounds(shape, source, tol=1e-6):
    a, b = shape.BoundingBox(), source.BoundingBox()
    return (a.xmin >= b.xmin - tol and a.ymin >= b.ymin - tol
            and a.zmin >= b.zmin - tol and a.xmax <= b.xmax + tol
            and a.ymax <= b.ymax + tol and a.zmax <= b.zmax + tol)


def test_wall_relief_chamfer():
    print("wall relief chamfer")
    import texture

    source = _wall_relief_source(texture)
    wall = texture.relief_for_zone("wall", -2.0, -1.0)
    before, after = source.solids().vals(), wall.solids().vals()
    pairs = list(zip(before, after))

    check("wall relief chamfer removes material",
          wall.val().Volume() < source.val().Volume() - 0.1,
          f"{wall.val().Volume():.4f} vs {source.val().Volume():.4f}")
    check("wall chamfered solids are valid and inside source bounds",
          len(before) == len(after) and all(a.isValid() and _inside_bounds(a, b)
                                              for b, a in pairs))

    def reduced(predicate):
        return any(predicate(b.Center()) and a.Volume() < b.Volume() - 1e-6
                   for b, a in pairs)

    check("wall chamfer reaches a straight west-wall brick",
          reduced(lambda c: c.x < 0.1 and 15.0 < c.y < 75.0))
    check("wall chamfer reaches a rounded north-west corner brick",
          reduced(lambda c: c.x < 8.0 and c.y < 8.0))


def main():
    test_tile_shape()
    test_pitches()
    test_relief_budget()
    test_origin()
    test_outward_envelope()
    test_brick_rects()
    test_brick_runs_coalesce_connected_pixels()
    test_brick_face()
    test_proud_skin()
    test_root_overlap_skin()
    test_proud_skin_thickness_probe()
    test_edge_chamfer_band_thickness()
    test_proud_skin_deviation_map()
    test_stations_and_islands()
    test_bottom_clear()
    test_relief_for_zone()
    test_relief_bounds_validation()
    test_large_relief_chamfer_attempt()
    test_wall_relief_chamfer()
    print()
    if FAILURES:
        sys.exit(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    print("all texture tests passed")


if __name__ == "__main__":
    main()
