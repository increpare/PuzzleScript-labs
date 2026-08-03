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
