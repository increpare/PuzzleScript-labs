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


def main():
    test_tile_shape()
    test_pitches()
    test_relief_budget()
    test_origin()
    test_outward_envelope()
    print()
    if FAILURES:
        sys.exit(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    print("all texture tests passed")


if __name__ == "__main__":
    main()
