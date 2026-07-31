"""Verify the exported coupon geometry.

Measures the exported STL rather than the in-memory model, so it also catches
export faults. Same rasterisation technique used to measure the DMG reference
shell, which keeps one measurement method across the whole project.

Run:  .venv/bin/python checks.py
"""
import os
import struct
import sys

import numpy as np

import params as P

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
PX = 0.05
FAILURES = []


def load_tris(path):
    d = open(path, "rb").read()
    if d[:5] == b"solid" and b"facet" in d[:2000]:
        import re
        v = np.array([[float(x) for x in m]
                      for m in re.findall(rb"vertex\s+(\S+)\s+(\S+)\s+(\S+)", d)], dtype=float)
        return v.reshape(-1, 3, 3)
    n = struct.unpack("<I", d[80:84])[0]
    return np.array([struct.unpack_from("<12f", d, 84 + i * 50)[3:12]
                     for i in range(n)]).reshape(n, 3, 3)


def raster_xy(tri):
    """Top-down occupancy: which (x, y) cells have any material at all."""
    x0, x1 = tri[:, :, 0].min(), tri[:, :, 0].max()
    y0, y1 = tri[:, :, 1].min(), tri[:, :, 1].max()
    W = int((x1 - x0) / PX) + 1
    H = int((y1 - y0) / PX) + 1
    occ = np.zeros((H, W), dtype=bool)
    px = (tri[:, :, 0] - x0) / PX
    py = (y1 - tri[:, :, 1]) / PX
    for i in range(len(tri)):
        ax, ay = px[i, 0], py[i, 0]
        bx, by = px[i, 1], py[i, 1]
        cx, cy = px[i, 2], py[i, 2]
        mnx, mxx = int(max(0, np.floor(min(ax, bx, cx)))), int(min(W - 1, np.ceil(max(ax, bx, cx))))
        mny, mxy = int(max(0, np.floor(min(ay, by, cy)))), int(min(H - 1, np.ceil(max(ay, by, cy))))
        if mxx < mnx or mxy < mny:
            continue
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        gx, gy = np.meshgrid(np.arange(mnx, mxx + 1) + .5, np.arange(mny, mxy + 1) + .5)
        w0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
        w1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
        m = (w0 >= 0) & (w1 >= 0) & (1 - w0 - w1 >= 0)
        occ[mny:mxy + 1, mnx:mxx + 1] |= m
    return occ, x0, y1, W, H


def label(mask):
    """Run-based connected components. Returns list of (px, x0, x1, y0, y1)."""
    H, W = mask.shape
    parent = {}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    nxt = 1
    prev = []
    rows = []
    for r in range(H):
        row = mask[r]
        cur = []
        idx = np.flatnonzero(np.diff(np.concatenate(([0], row.view(np.int8), [0]))))
        for s, e in zip(idx[0::2], idx[1::2]):
            lbl = None
            for ps, pe, pl in prev:
                if ps < e and s < pe:
                    if lbl is None:
                        lbl = find(pl)
                    else:
                        union(lbl, pl)
            if lbl is None:
                lbl = nxt
                parent[lbl] = lbl
                nxt += 1
            cur.append((s, e, lbl))
        rows.append(cur)
        prev = cur

    from collections import defaultdict
    agg = defaultdict(lambda: [0, 10 ** 9, -1, 10 ** 9, -1])
    for r, cur in enumerate(rows):
        for s, e, l in cur:
            a = agg[find(l)]
            a[0] += e - s
            a[1] = min(a[1], s)
            a[2] = max(a[2], e - 1)
            a[3] = min(a[3], r)
            a[4] = max(a[4], r)
    return rows, agg, find


def raster_depth(tri):
    """Top-down map of the front-most surface z. -1e9 where there is no material."""
    x0, x1 = tri[:, :, 0].min(), tri[:, :, 0].max()
    y0, y1 = tri[:, :, 1].min(), tri[:, :, 1].max()
    W = int((x1 - x0) / PX) + 1
    H = int((y1 - y0) / PX) + 1
    buf = np.full((H, W), -1e9)
    px = (tri[:, :, 0] - x0) / PX
    py = (y1 - tri[:, :, 1]) / PX
    pz = tri[:, :, 2]
    for i in range(len(tri)):
        ax, ay = px[i, 0], py[i, 0]
        bx, by = px[i, 1], py[i, 1]
        cx, cy = px[i, 2], py[i, 2]
        mnx, mxx = int(max(0, np.floor(min(ax, bx, cx)))), int(min(W - 1, np.ceil(max(ax, bx, cx))))
        mny, mxy = int(max(0, np.floor(min(ay, by, cy)))), int(min(H - 1, np.ceil(max(ay, by, cy))))
        if mxx < mnx or mxy < mny:
            continue
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        gx, gy = np.meshgrid(np.arange(mnx, mxx + 1) + .5, np.arange(mny, mxy + 1) + .5)
        w0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
        w1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
        w2 = 1 - w0 - w1
        m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not m.any():
            continue
        zv = w0 * pz[i, 0] + w1 * pz[i, 1] + w2 * pz[i, 2]
        sub = buf[mny:mxy + 1, mnx:mxx + 1]
        np.maximum(sub, np.where(m, zv, -1e9), out=sub)
    return buf, x0, y1


def check_shell():
    """Every opening in the front face must stay inside the walls.

    This is the guard for a real bug: the placeholder grille originally ran
    0.65 mm into the bottom wall, which is invisible in a render and fatal in
    a mould.
    """
    path = os.path.join(OUT, "shell_front.stl")
    if not os.path.exists(path):
        print("shell_front.stl missing -- skipping")
        return
    print("\nshell_front.stl")
    tri = load_tris(path)
    bb = [float(np.ptp(tri[:, :, i])) for i in range(3)]
    check("body width", bb[0], P.BODY_W, 0.02)
    check("body height", bb[1], P.BODY_H, 0.02)

    buf, x0, y1 = raster_depth(tri)
    # Pad by a margin so the exterior is a single connected region. Without it
    # the raster is exactly the body's bounding box, the four rounded corners
    # become four separate "exterior" regions, and three of them get counted
    # as face openings.
    PAD = 20
    buf = np.pad(buf, PAD, constant_values=-1e9)
    x0 -= PAD * PX
    y1 += PAD * PX

    material = buf > -1e8
    face = buf > -0.5                       # front face present at this cell
    rows, agg2, find2 = label(~material)
    ext = find2(rows[0][0][2])              # component containing pixel (0, 0)
    inside = np.ones_like(material)
    for r, cur in enumerate(rows):
        for s0, e0, l in cur:
            if find2(l) == ext:
                inside[r, s0:e0] = False
    openings = inside & ~face

    rows3, agg3, find3 = label(openings)
    lo_x, hi_x = P.WALL, P.BODY_W - P.WALL
    lo_y, hi_y = P.WALL, P.BODY_H - P.WALL
    found = 0
    worst = None
    for k, a in agg3.items():
        area = a[0] * PX * PX
        if area < 0.8:
            continue
        found += 1
        ox0 = x0 + a[1] * PX
        ox1 = x0 + (a[2] + 1) * PX
        oy0 = y1 - (a[4] + 1) * PX
        oy1 = y1 - a[3] * PX
        over = max(lo_x - ox0, ox1 - hi_x, lo_y - oy0, oy1 - hi_y)
        if worst is None or over > worst[0]:
            worst = (over, ox0, ox1, oy0, oy1, area)
    print(f"   face openings found: {found}")
    o, ox0, ox1, oy0, oy1, area = worst
    print(f"   tightest opening to wall: {-o:+.2f} mm clearance "
          f"(bbox {ox0:.2f}..{ox1:.2f} x {oy0:.2f}..{oy1:.2f})")
    ok = o < 0
    print(f"   {'PASS' if ok else 'FAIL'}  no face opening breaches a wall")
    if not ok:
        FAILURES.append("opening breaches wall")

    # Face thickness. Guards a real bug: the cavity was built 1 mm too tall and
    # left the front face 0.5 mm instead of 1.5, which no render would show.
    probe = [(8.0, 30.0), (45.0, 57.0), (84.0, 30.0)]
    for pxm, pym in probe:
        c = int((pxm - x0) / PX)
        r = int((y1 - pym) / PX)
        col_z = []
        for tri_z in (buf[r, c],):
            col_z.append(tri_z)
        # front surface must be at z = 0
        check(f"face present at ({pxm:.0f},{pym:.0f})", float(buf[r, c]), 0.0, 0.02)


def check_interior_fit():
    """Lower-zone features must fit inside the walls.

    Analytic rather than measured, because these are back-shell features whose
    clash is with the *other* half of the case -- nothing in either STL alone
    would show it. Both of the numbers guarded here started out wrong.
    """
    print("\ninterior fit (lower zone)")
    lo, hi_x, hi_y = P.WALL, P.BODY_W - P.WALL, P.BODY_H - P.WALL
    fence_t, rim = 1.2, P.WALL + 0.25

    items = [
        ("battery fence",
         P.BATT_X - P.BATT_CLEAR - fence_t, P.BATT_X + P.CELL_W + P.BATT_CLEAR + fence_t,
         P.BATT_Y - P.BATT_CLEAR - fence_t, P.BATT_Y + P.CELL_H + P.BATT_CLEAR + fence_t),
        ("driver ring",
         P.GRILLE_X - P.DRIVER_D / 2 - 1.6, P.GRILLE_X + P.DRIVER_D / 2 + 1.6,
         P.GRILLE_Y - P.DRIVER_D / 2 - 1.6, P.GRILLE_Y + P.DRIVER_D / 2 + 1.6),
        ("controller PCB",
         P.PCB_X, P.PCB_X + P.PCB_W, P.PCB_Y, P.PCB_Y + P.PCB_H),
    ]
    for name, x0, x1, y0, y1 in items:
        m = min(x0 - rim, hi_x - x1, y0 - rim, hi_y - y1)
        ok = m >= 0
        print(f"   {'PASS' if ok else 'FAIL'}  {name:18} clearance {m:+.2f} mm")
        if not ok:
            FAILURES.append(name)

    gap = (P.GRILLE_X - P.DRIVER_D / 2 - 1.6) - (P.RESET_X + P.RESET_CAP_D / 2 +
                                                 P.CAP_FLANGE_OS + P.COLLAR_CLEAR + 1.2)
    ok = gap >= 0
    print(f"   {'PASS' if ok else 'FAIL'}  {'driver vs Reset cap':18} clearance {gap:+.2f} mm")
    if not ok:
        FAILURES.append("driver vs Reset")

    menu_half = (P.PILL_L + 2 * P.CAP_FLANGE_OS + 2 * P.COLLAR_CLEAR) / 2 + 1.2
    reset_half = P.RESET_CAP_D / 2 + P.CAP_FLANGE_OS + P.COLLAR_CLEAR + 1.2
    gap = (P.RESET_X - reset_half) - (P.MENU_X + menu_half)
    ok = gap >= 0
    print(f"   {'PASS' if ok else 'FAIL'}  {'Reset vs Menu':18} clearance {gap:+.2f} mm")
    if not ok:
        FAILURES.append("Reset vs Menu")


def check(name, got, want, tol):
    ok = abs(got - want) <= tol
    print(f"   {'PASS' if ok else 'FAIL'}  {name:34} {got:8.3f}  (want {want:.3f} +/- {tol})")
    if not ok:
        FAILURES.append(name)


def main():
    path = os.path.join(OUT, "coupon_plate.stl")
    if not os.path.exists(path):
        sys.exit("coupon_plate.stl missing -- run coupon.py first")

    tri = load_tris(path)
    bb = [float(np.ptp(tri[:, :, i])) for i in range(3)]
    print("coupon_plate.stl")
    check("plate width", bb[0], 88.0, 0.02)
    check("plate height", bb[1], 44.0, 0.02)
    check("plate total depth", bb[2], P.FACE_T + P.COLLAR_DEPTH, 0.02)

    occ, x0, y1, W, H = raster_xy(tri)
    body = np.zeros_like(occ)
    body[:] = occ
    _, agg, find = label(~occ)
    ext = None
    for k, a in agg.items():
        if a[1] == 0 and a[3] == 0:
            ext = k
            break

    holes = []
    for k, a in agg.items():
        if k == ext:
            continue
        area = a[0] * PX * PX
        if area < 2:
            continue
        w = (a[2] - a[1] + 1) * PX
        h = (a[4] - a[3] + 1) * PX
        holes.append((area, w, h))

    print(f"\n   through-holes found: {len(holes)}")
    round_holes = sorted([w for _, w, h in holes if abs(w - h) < 0.15])
    print(f"   round-hole diameters: {[round(v, 3) for v in round_holes]}")

    check("station count", float(len(holes)), 7.0, 0.0)
    for i, d in enumerate(round_holes[:5]):
        check(f"direction hole {i + 1} diameter", d, P.DIR_CAP_D, 0.06)
    if len(round_holes) >= 6:
        check("Undo/Action hole diameter", round_holes[5], P.AB_CAP_D, 0.06)

    pill = [(w, h) for _, w, h in holes if abs(w - h) >= 0.15]
    if pill:
        w, h = pill[0]
        print(f"   pill opening bbox: {w:.3f} x {h:.3f}")

    check_shell()
    check_interior_fit()

    print()
    if FAILURES:
        sys.exit(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    print("all checks passed")


if __name__ == "__main__":
    main()
