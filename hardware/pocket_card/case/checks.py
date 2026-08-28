import math
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
import shell_front

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


def back_shell_stl_path():
    """Canonical shell produced by build_variants.py and shipped for order."""
    return os.path.join(OUT, "order", "shell_back.stl")


def back_shell_vertex_violations(vertices):
    """Vertices deeper than the rear profile permits at their own Y."""
    import side_arc

    flat = np.asarray(vertices, dtype=float).reshape(-1, 3)
    bad = []
    for _, y_model, z in flat:
        y_layout = P.BODY_H - y_model
        allowed_z = -(P.BODY_T + side_arc.rear_deck_extra_at(y_layout)) - 0.02
        if z < allowed_z:
            bad.append((float(y_layout), float(z), float(allowed_z)))
    return bad


def _profile_sample_ys(y0, y1, step=0.1):
    """Inclusive transition samples, maintaining 0.1 mm nominal spacing."""
    count = int(math.floor((y1 - y0) / step + 1e-9))
    ys = [y0 + i * step for i in range(count + 1)]
    if ys[-1] < y1 - 1e-9:
        ys.append(y1)
    else:
        ys[-1] = y1
    return ys


def rear_deck_transition_metrics(y0, y1, *, increasing, step=0.1):
    """Scalar continuity, monotonicity, and steepest slope on one transition."""
    import side_arc

    ys = _profile_sample_ys(float(y0), float(y1), float(step))
    depths = [side_arc.rear_deck_extra_at(y) for y in ys]
    tol = 1e-9
    if increasing:
        monotonic = all(a <= b + tol for a, b in zip(depths, depths[1:]))
    else:
        monotonic = all(a + tol >= b for a, b in zip(depths, depths[1:]))
    slopes = [
        math.degrees(math.atan(abs(b - a) / (yb - ya)))
        for a, b, ya, yb in zip(depths, depths[1:], ys, ys[1:])
    ]
    return {
        "step": float(step),
        "monotonic": monotonic,
        "max_slope_deg": max(slopes, default=0.0),
        "start_depth": depths[0],
        "end_depth": depths[-1],
    }


def rear_deck_surface_transition_metrics(
        y0, y1, *, increasing, slope_limit_deg, step=0.1, x_step=0.5):
    """Actual-envelope transition metrics including the rolled side regions.

    This domain is only valid where the Y interval does not enter a plan
    corner or the independent north/south perimeter roll.  Within that domain
    it deliberately starts at x=0.4 and runs to the opposite side, so a deck
    cliff hidden on either rolled side cannot be masked by a flat-field scan.
    """
    import side_arc

    ys = _profile_sample_ys(float(y0), float(y1), float(step))
    worst_slope, at = 0.0, None
    monotonic = True
    samples = 0
    sampled_x = []
    x = 0.4
    while x < P.BODY_W - 0.3:
        prev = None
        used_x = False
        for y in ys:
            cur = side_arc.outer_back_z_opt(x, y)
            if cur is None:
                prev = None
                continue
            used_x = True
            if prev is not None:
                py, pz = prev
                dz = cur - pz
                if increasing and dz > 0.005:
                    monotonic = False
                if not increasing and dz < -0.005:
                    monotonic = False
                slope = math.degrees(math.atan(abs(dz) / (y - py)))
                if slope > worst_slope:
                    worst_slope, at = slope, (round(x, 1), round(y, 1))
                samples += 1
            prev = (y, cur)
        if used_x:
            sampled_x.append(x)
        x += x_step

    return {
        "start_y": float(y0),
        "end_y": float(y1),
        "step": float(step),
        "sample_count": samples,
        "min_sampled_x": min(sampled_x) if sampled_x else None,
        "max_sampled_x": max(sampled_x) if sampled_x else None,
        "monotonic": monotonic,
        "continuous": samples > 0 and worst_slope <= slope_limit_deg + 1e-9,
        "max_slope_deg": worst_slope,
        "max_slope_at": at,
    }


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
    # Side arcs pull the AABB in slightly at the back; still must not grow.
    check("body width", bb[0], P.BODY_W, 1.0)
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
    # Front face is z≈0; EDGE_CHAMFER pulls the rim below that. A fixed -0.5
    # threshold treated the whole chamfer ring as one opening (false breach).
    face_z = -(getattr(P, "EDGE_CHAMFER", 0.0) + 0.1)
    face = buf > face_z
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
    # NB: MODEL space (y up), not the layout space params.py uses. Chosen to
    # land on solid face: left bezel, right bezel, the strip below the module,
    # and the bottom-left corner.
    probe = [(8.0, 78.0), (84.0, 78.0), (45.0, 36.0), (10.0, 5.0)]
    for pxm, pym in probe:
        c = int((pxm - x0) / PX)
        r = int((y1 - pym) / PX)
        col_z = []
        for tri_z in (buf[r, c],):
            col_z.append(tri_z)
        # front surface must be at z = 0
        check(f"face present at ({pxm:.0f},{pym:.0f})", float(buf[r, c]), 0.0, 0.02)


def check_orientation():
    """The exported part must read correctly when viewed from the front.

    params.py lays the face out with y = 0 at the top, increasing downward.
    3D space viewed from the front has +y UP. Without a reflection at build
    time the part exports vertically flipped, and rotating it upright mirrors
    left for right -- which shipped, and was only caught by someone opening
    the STL. Nothing else in this file would have found it.
    """
    path = os.path.join(OUT, "shell_front.stl")
    if not os.path.exists(path):
        return
    print("\norientation (as exported, viewed from the front)")
    tri = load_tris(path)
    buf, x0, y1 = raster_depth(tri)
    material = buf > -1e8
    face = buf > -0.5
    PAD = 20
    buf2 = np.pad(buf, PAD, constant_values=-1e9)
    material = buf2 > -1e8
    face = buf2 > -0.5
    x0 -= PAD * PX
    y1 += PAD * PX
    rows, agg2, find2 = label(~material)
    ext = find2(rows[0][0][2])
    inside = np.ones_like(material)
    for r, cur in enumerate(rows):
        for s0, e0, l in cur:
            if find2(l) == ext:
                inside[r, s0:e0] = False
    _, agg3, _ = label(inside & ~face)

    best = max(agg3.items(), key=lambda kv: kv[1][0])[1]      # screen aperture
    sy = y1 - (best[3] + best[4]) / 2 * PX
    sx = x0 + (best[1] + best[2]) / 2 * PX
    ok = sy > P.BODY_H / 2
    print(f"   {'PASS' if ok else 'FAIL'}  screen in the UPPER half   "
          f"(centre y = {sy:.1f}, want > {P.BODY_H / 2:.1f})")
    if not ok:
        FAILURES.append("screen not in upper half")

    small = [a for a in agg3.values() if 40 < a[0] * PX * PX < 70]
    if small:
        cx = np.mean([x0 + (a[1] + a[2]) / 2 * PX for a in small])
        cy = np.mean([y1 - (a[3] + a[4]) / 2 * PX for a in small])
        ok = cx < P.BODY_W / 2 and cy < P.BODY_H / 2
        print(f"   {'PASS' if ok else 'FAIL'}  d-pad in the LOWER-LEFT    "
              f"(centre {cx:.1f}, {cy:.1f})")
        if not ok:
            FAILURES.append("d-pad not lower-left")


def check_driver_bond():
    """The driver is held by adhesive on its front, so measure what it can stick
    to, and confirm nothing intrudes into the space it occupies.

    There is no seat by design -- a lip was tried and removed, because standoff
    under the rim is exactly where the adhesive needs contact. The adhesive is a
    perimeter RING, so the figure that matters is solid face under the rim, not
    over the whole footprint: the middle of the face can be as open as the grille
    likes. Also confirms the driver's full 3.5 mm depth is clear.
    """
    print("\ndriver bond area and clearance")
    import cadquery as cq
    shell = shell_front.build()
    cy = P.BODY_H - P.GRILLE_Y

    def solid_at(z):
        slab = (cq.Workplane("XY").slot2D(P.DRIVER_H, P.DRIVER_W, 90)
                .extrude(0.05).translate((P.GRILLE_X, cy, -z)))
        try:
            return shell.intersect(slab).val().Volume() / 0.05
        except Exception:
            return 0.0

    t = P.DRIVER_BOND_RING
    ring = (cq.Workplane("XY").slot2D(P.DRIVER_H, P.DRIVER_W, 90).extrude(0.05)
            .cut(cq.Workplane("XY")
                 .slot2D(P.DRIVER_H - 2 * t, P.DRIVER_W - 2 * t, 90)
                 .extrude(0.05))
            .translate((P.GRILLE_X, cy, -(P.FACE_T - 0.3))))
    full = ring.val().Volume() / 0.05
    try:
        bond = shell.intersect(ring).val().Volume() / 0.05
    except Exception:
        bond = 0.0
    frac = bond / full
    ok = frac >= 0.85
    print("   %s  %.1f mm adhesive ring: %.1f of %.1f mm2 solid (%.0f%%)"
          % ("PASS" if ok else "FAIL", t, bond, full, 100 * frac))
    if not ok:
        FAILURES.append("too little face under the driver's adhesive ring")

    z0, z1 = P.FACE_T, P.FACE_T + P.DRIVER_T
    worst = max(solid_at(z) for z in
                (z0 + 0.1, z0 + 1.0, z0 + 2.0, z1 - 0.1))
    ok = worst <= 0.01
    print("   %s  driver volume z %.1f-%.1f clear (worst intrusion %.2f mm2)"
          % ("PASS" if ok else "FAIL", z0, z1, worst))
    if not ok:
        FAILURES.append("something intrudes into the driver volume")


def check_cap_fits_collar():
    """Every round cap flange must actually pass its own collar bore.

    This existed as two independent tables. button_station() keyed every round
    collar; a CAPS table in build_variants.py keyed only the directions and
    reset, so the undo and action flanges -- full Ø13.2 circles -- were being
    asked through bores with 0.8 mm flats cut into them. Nothing caught it
    because each file was self-consistent. Measures the built solids now.
    """
    print("\ncap flange vs collar bore")
    import coupon
    worst, which = 1e9, ""
    for nm, d in (("dir", P.DIR_CAP_D), ("undo", P.AB_CAP_D),
                  ("action", P.AB_CAP_D), ("reset", P.RESET_CAP_D)):
        c = coupon.cap(d, P.FIT_CLEAR)
        bb = c.val().BoundingBox()
        flange_d = d + 2 * P.CAP_FLANGE_OS
        bore_d = flange_d + 2 * P.COLLAR_CLEAR
        across = 2 * (bore_d / 2 - shell_front.FLAT_DEPTH)   # bore across flats
        gap = across - bb.ylen                               # cap across flats
        if gap < worst:
            worst, which = gap, nm
    ok = worst >= 0
    print("   %s  tightest %s: bore across flats leads cap by %+.2f mm"
          % ("PASS" if ok else "FAIL", which, worst))
    if not ok:
        FAILURES.append("cap flange cannot enter its collar")


def check_grille_vs_driver():
    """Every grille slot must open onto the driver, not past its edge.

    The driver is a stadium, so near its ends it is narrower than its bounding
    box; a slot that clears the box can still overhang the real part. Half-width
    at a given y is the straight section's, or the semicircle's beyond it.

    Measured against the pocket BORE, not the driver. The arm slot is 14.306
    wide against a 14.0 driver -- it overhangs by 0.153 each side, and it does so
    in the blend too, so that is the drawn design rather than a fault. What must
    not happen is a slot reaching past the bore, where it would look at the
    locating wall instead of at the driver. Driver overhang is reported as INFO.
    """
    print("\ngrille slots vs driver face")
    bore_w, bore_h = P.DRIVER_W + 0.6, P.DRIVER_H + 0.6
    r = bore_w / 2.0
    straight = bore_h / 2.0 - r              # semicircle centres at +/- this
    rows = len(P.GRILLE_BITMAP)
    cols = max(len(row) for row in P.GRILLE_BITMAP)
    worst, where = 1e9, ""
    for ri, row in enumerate(P.GRILLE_BITMAP):
        cy = P.GRILLE_Y + (rows - 1 - ri - (rows - 1) / 2.0) * P.GRILLE_CELL
        for edge in (cy - P.GRILLE_SLOT_H / 2, cy + P.GRILLE_SLOT_H / 2):
            dy = abs(edge - P.GRILLE_Y)
            if dy <= straight:
                half = r
            elif dy - straight >= r:
                half = -1.0
            else:
                half = math.sqrt(r * r - (dy - straight) ** 2)
            for ci, ch in enumerate(row):
                if ch != "1":
                    continue
                cx = P.GRILLE_X + (ci - (cols - 1) / 2.0) * P.GRILLE_CELL
                over = (half - abs(cx - P.GRILLE_X)
                        - P.GRILLE_CELL / 2 + P.GRILLE_RUN_INSET)
                if over < worst:
                    worst, where = over, "row %d col %d" % (ri, ci)
    ok = worst >= 0
    print("   %s  tightest slot corner %s at %+.2f mm inside the bore"
          % ("PASS" if ok else "FAIL", where, worst))
    if not ok:
        FAILURES.append("grille slot reaches past the pocket bore")
    over = (5 * P.GRILLE_CELL - 2 * P.GRILLE_RUN_INSET - P.DRIVER_W) / 2
    print("   INFO  widest slot overhangs the driver itself by %.3f mm each "
          "side (as drawn in the blend)" % over)


def check_driver_vs_collars():
    """The driver body must miss every collar; only its wall may be relieved."""
    print("\ndriver vs button collars")
    dx0, dx1 = P.GRILLE_X - P.DRIVER_W / 2, P.GRILLE_X + P.DRIVER_W / 2
    dy0, dy1 = P.GRILLE_Y - P.DRIVER_H / 2, P.GRILLE_Y + P.DRIVER_H / 2
    worst, which = 99.0, ""
    for nm, cx, cy, d in (("Action", P.ACT_X, P.ACT_Y, P.AB_CAP_D),
                          ("Undo", P.UNDO_X, P.UNDO_Y, P.AB_CAP_D),
                          ("Reset", P.RESET_X, P.RESET_Y, P.RESET_CAP_D)):
        r = d / 2 + P.CAP_FLANGE_OS + P.COLLAR_CLEAR + 1.2
        nx, ny = max(dx0, min(cx, dx1)), max(dy0, min(cy, dy1))
        gap = ((cx - nx) ** 2 + (cy - ny) ** 2) ** 0.5 - r
        if gap < worst:
            worst, which = gap, nm
    ok = worst >= 0
    print(f"   {'PASS' if ok else 'FAIL'}  tightest is {which} at {worst:+.2f} mm")
    if not ok:
        FAILURES.append("driver fouls a collar")


def check_pcb_posts_vs_collars():
    """Controller M2 axes must miss the button collars.

    The complete H1 cage intentionally fuses into the fixed Undo collar; that
    is not a component collision. The exact moving nut/sweep clearance through
    the finished solid is measured by check_captive_nut_traps immediately
    below this legacy axis-placement check.
    """
    print("\nPCB M2 axes vs button collars")
    collars = [("dir up", P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D),
               ("dir down", P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D),
               ("dir left", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D),
               ("dir right", P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D),
               ("Undo", P.UNDO_X, P.UNDO_Y, P.AB_CAP_D),
               ("Action", P.ACT_X, P.ACT_Y, P.AB_CAP_D),
               ("Reset", P.RESET_X, P.RESET_Y, P.RESET_CAP_D)]
    worst = 99.0
    which = "?"
    for px, py in P.PCB_MOUNTS:
        for nm, cx, cy, d in collars:
            r = (d / 2 + P.CAP_FLANGE_OS + P.COLLAR_CLEAR
                 + shell_front.COLLAR_WALL)
            gap = (((px - cx) ** 2 + (py - cy) ** 2) ** 0.5
                   - r - P.MACHINE_SCREW_CLEAR_D / 2)
            if gap < worst:
                worst, which = gap, "(%.1f,%.1f) vs %s" % (px, py, nm)
    ok = worst >= 0
    print(f"   {'PASS' if ok else 'FAIL'}  tightest {which} {worst:+.2f} mm")
    if not ok:
        FAILURES.append("PCB M2 axis fouls a collar")
    print("   ok    controller front locating pins removed; M2 axes locate H1/H2")


def _workplane_volume(shape):
    return sum(solid.Volume() for solid in shape.solids().vals())


def check_captive_nut_traps(front_model=None):
    """Inspect all six captive-nut traps in the assembled front solid.

    ``front_model`` is injectable so the unit test can reuse its one expensive
    front build. Normal checks intentionally build the production solid here.
    Geometry is converted back to layout space, where params, nut_traps and
    the existing component/envelope helpers are authored.
    """
    import cadquery as cq

    import joints
    import nut_traps
    import shell_back

    print("\ncaptive-nut traps (built front)")
    if front_model is None:
        front_model = shell_front.build()
    solids = front_model.solids().vals()
    valid = bool(solids) and front_model.val().isValid()
    one = len(solids) == 1
    print(f"   {'PASS' if valid and one else 'FAIL'}  front valid and one solid "
          f"(valid={valid}, solids={len(solids)})")
    if not valid or not one:
        FAILURES.append(
            f"captive nuts: invalid/multiple front solid ({len(solids)})")

    front = shell_front.to_model_space(front_model)
    outer = shell_front.outer_body()
    sites = nut_traps.sites()
    metrics = {}

    actual_traps = []
    for index, site in enumerate(sites, start=1):
        label = f"{site.kind} {index} ({site.x:.1f},{site.y:.1f})"
        nut_overlap = _workplane_volume(
            front.intersect(nut_traps.nut_solid(site)))
        sweep_overlap = _workplane_volume(
            front.intersect(nut_traps.insertion_sweep(site)))
        screw_overlap = _workplane_volume(
            front.intersect(nut_traps.screw_path(
                site, -shell_front.SHELL_DEPTH - 0.1)))
        metrics[(site.x, site.y)] = {
            "nut_overlap": nut_overlap,
            "sweep_overlap": sweep_overlap,
            "screw_overlap": screw_overlap,
        }
        print(f"   {'PASS' if max(nut_overlap, sweep_overlap, screw_overlap) < 1e-5 else 'FAIL'}  "
              f"{label}: nut {nut_overlap:.6f}, sweep {sweep_overlap:.6f}, "
              f"M2 path {screw_overlap:.6f} mm^3")
        if nut_overlap >= 1e-5:
            FAILURES.append(f"captive nut collision at ({site.x},{site.y})")
        if sweep_overlap >= 1e-5:
            FAILURES.append(
                f"captive nut insertion sweep collision at ({site.x},{site.y})")
        if screw_overlap >= 1e-5:
            FAILURES.append(
                f"captive nut M2 screw path blocked at ({site.x},{site.y})")

        material = nut_traps.front_material(site)
        actual = front.intersect(material)
        actual_traps.append(actual)
        outside = _workplane_volume(material.cut(outer))
        required = material.cut(nut_traps.front_voids(site))
        missing = _workplane_volume(required.cut(front))

        skin = (cq.Workplane("XY").circle(P.NUT_ENVELOPE_R)
                .extrude(0.05).translate((site.x, site.y, -0.50)))
        required_skin = skin.intersect(outer)
        skin_missing = _workplane_volume(required_skin.cut(front))
        retained_ok = missing < 1e-5
        envelope_ok = outside < 1e-8 and skin_missing < 1e-5
        print(f"   {'PASS' if envelope_ok else 'FAIL'}  {label}: compound-envelope "
              f"outside {outside:.6f}, outer-skin missing "
              f"{skin_missing:.6f} mm^3")
        print(f"   {'PASS' if retained_ok else 'FAIL'}  {label}: retained "
              f"roof/taper/load missing {missing:.6f} mm^3")
        if outside >= 1e-8:
            FAILURES.append(
                f"captive nut cage outside compound envelope at ({site.x},{site.y})")
        if skin_missing >= 1e-5:
            FAILURES.append(
                f"captive nut exterior skin breach at ({site.x},{site.y})")
        if not retained_ok:
            FAILURES.append(
                f"captive nut roof/taper/load clipped at ({site.x},{site.y})")

    # Physical component envelopes. The purchased display's mounting datum is
    # its real PCB, not a fictitious solid block filling the glass-to-PCB gap.
    display_pcb = (cq.Workplane("XY")
                   .box(P.MOD_W, P.MOD_H, P.MOD_PCB_T, centered=False)
                   .translate((P.MOD_X, P.MOD_Y,
                               -(P.MODULE_Z + P.MOD_FRONT_STACK)))
                   .edges("|Z").fillet(P.MOD_CORNER_R))
    controller_pcb = shell_front.to_model_space(
        shell_back.pcb_outline_wire()).translate(
            (0, 0, -(P.PCB_FRONT_Z + P.PCB_T)))
    battery_front = -(P.PCB_FRONT_Z + P.PCB_T + P.PET_T)
    battery_depth = P.CELL_T + P.CELL_SWELL
    battery = (cq.Workplane("XY")
               .box(P.CELL_W, P.CELL_H, battery_depth, centered=False)
               .translate((P.BATT_X, P.BATT_Y,
                           battery_front - battery_depth)))
    speaker = (cq.Workplane("XY")
               .slot2D(P.DRIVER_H, P.DRIVER_W, 90)
               .extrude(-P.DRIVER_T)
               .translate((P.GRILLE_X, P.GRILLE_Y, -P.FACE_T)))
    reset_guide, _ = shell_front.button_station(
        hole_d=P.RESET_CAP_D, pill=False)
    reset_guide = shell_front._dev(reset_guide, P.RESET_X, P.RESET_Y)
    reset_flange_r = P.RESET_CAP_D / 2 + P.CAP_FLANGE_OS
    reset_travel = (cq.Workplane("XY").circle(reset_flange_r)
                    .extrude(-(P.FACE_T + P.COLLAR_DEPTH + P.CAP_PROUD))
                    .translate((P.RESET_X, P.RESET_Y, P.CAP_PROUD)))

    components = (
        ("display module PCB", display_pcb),
        ("controller PCB", controller_pcb),
        ("battery", battery),
        ("Reset guide", reset_guide),
        ("Reset cap travel", reset_travel),
        ("vertical-stadium speaker", speaker),
    )
    for name, component in components:
        overlap = sum(
            _workplane_volume(trap.intersect(component))
            for trap in actual_traps
        )
        ok = overlap < 1e-5
        print(f"   {'PASS' if ok else 'FAIL'}  traps vs {name}: "
              f"{overlap:.6f} mm^3")
        if not ok:
            FAILURES.append(f"captive nut trap collides with {name}")

    trap_envelopes = [nut_traps.front_material(site) for site in sites]
    wires = dict(zip(
        ("north", "south"), shell_front.speaker_wire_envelopes()
    ))
    for exit_name, wire in wires.items():
        envelope_overlap = sum(
            _workplane_volume(trap.intersect(wire))
            for trap in trap_envelopes
        )
        actual_overlap = sum(
            _workplane_volume(trap.intersect(wire))
            for trap in actual_traps
        )
        clearance = min(
            trap.val().distance(wire.val())
            for trap in trap_envelopes
        )
        metrics[f"speaker_wire_{exit_name}_overlap"] = max(
            envelope_overlap,
            actual_overlap,
        )
        metrics[f"speaker_wire_{exit_name}_clearance"] = clearance
        ok = max(envelope_overlap, actual_overlap) < 1e-5
        print(f"   {'PASS' if ok else 'FAIL'}  traps vs speaker lead "
              f"{exit_name}: envelope {envelope_overlap:.6f}, actual "
              f"{actual_overlap:.6f} mm^3; minimum {clearance:.3f} mm")
        if not ok:
            FAILURES.append(
                f"captive nut trap collides with speaker lead {exit_name}")

        front_overlap = _workplane_volume(front.intersect(wire))
        metrics[f"speaker_wire_{exit_name}_front_overlap"] = front_overlap
        if exit_name == P.DRIVER_LEAD_EXIT:
            route_ok = front_overlap < 1e-5
            print(f"   {'PASS' if route_ok else 'FAIL'}  approved speaker lead "
                  f"{exit_name} route vs finished front: "
                  f"{front_overlap:.6f} mm^3")
            if not route_ok:
                FAILURES.append(
                    f"approved speaker lead {exit_name} route blocked by front")
        else:
            print(f"   INFO  speaker lead {exit_name} candidate unavailable: "
                  f"finished-front overlap {front_overlap:.6f} mm^3 "
                  "(Action collar/pinch risk)")

    relief = shell_front.speaker_wire_service_relief()
    relief_bounds = relief.val().BoundingBox()
    base = outer.cut(shell_front.cavity())
    cut_material = base.intersect(relief)
    cut_bounds = cut_material.val().BoundingBox()
    relief_cut = _workplane_volume(cut_material)
    radial_skin = P.BODY_H - cut_bounds.ymax
    face_skin = -relief_bounds.zmax
    rebate_top = -shell_front.SHELL_DEPTH + P.LAP_H + P.LAP_OVER
    split_gap = cut_bounds.zmin - rebate_top
    metrics.update({
        "speaker_wire_relief_volume": relief_cut,
        "speaker_wire_radial_skin": radial_skin,
        "speaker_wire_face_skin": face_skin,
        "speaker_wire_split_gap": split_gap,
    })
    print("   INFO  approved south relief route extent: "
          f"{relief_bounds.xlen:.2f} x {relief_bounds.ylen:.2f} x "
          f"{relief_bounds.zlen:.2f} mm; perimeter cut "
          f"{cut_bounds.xlen:.2f} x {cut_bounds.ylen:.2f} x "
          f"{cut_bounds.zlen:.2f} mm, {relief_cut:.6f} mm^3")

    skin_probe = (cq.Workplane("XY")
                  .box(cut_bounds.xlen, radial_skin, cut_bounds.zlen,
                       centered=(True, True, False))
                  .translate((
                      (cut_bounds.xmin + cut_bounds.xmax) / 2.0,
                      cut_bounds.ymax + radial_skin / 2.0,
                      cut_bounds.zmin,
                  )))
    required_skin = base.intersect(skin_probe)
    skin_missing = _workplane_volume(required_skin.cut(front))
    skin_ok = (
        radial_skin >= P.NUT_ROOF_T - 1e-9
        and face_skin >= P.FACE_T - 1e-9
        and skin_missing < 1e-5
    )
    print(f"   {'PASS' if skin_ok else 'FAIL'}  speaker relief retains "
          f"{radial_skin:.3f} mm rounded perimeter skin and "
          f"{face_skin:.3f} mm face-side skin; missing "
          f"{skin_missing:.6f} mm^3")
    if not skin_ok:
        FAILURES.append("speaker lead relief breaches exterior skin")

    lip_probe = (cq.Workplane("XY")
                 .box(cut_bounds.xlen, P.WALL,
                      P.LAP_H + P.LAP_OVER,
                      centered=(True, True, False))
                 .translate((
                     (cut_bounds.xmin + cut_bounds.xmax) / 2.0,
                     P.BODY_H - P.WALL / 2.0,
                     -shell_front.SHELL_DEPTH,
                 )))
    required_lip = base.intersect(lip_probe)
    lip_missing = _workplane_volume(required_lip.cut(front))
    lip_ok = split_gap >= P.LAP_FRONT_T - 1e-9 and lip_missing < 1e-5
    print(f"   {'PASS' if lip_ok else 'FAIL'}  speaker relief remains "
          f"{split_gap:.3f} mm above split rebate; retained-lip missing "
          f"{lip_missing:.6f} mm^3")
    if not lip_ok:
        FAILURES.append("speaker lead relief weakens split lip")

    # Rear joint material is authored by the shared joint helper. Side walls,
    # collars and the front split lip are already included in the built-front
    # nut/sweep/path intersection above, so those clearances are measured on
    # the real finished solid rather than on separate analytic surrogates.
    joint_overlap = 0.0
    for joint in joints.back_joints():
        joint_solid = joint.material().cut(joint.voids())
        joint_overlap += sum(
            _workplane_volume(trap.intersect(joint_solid))
            for trap in actual_traps
        )
    ok = joint_overlap < 1e-5
    print(f"   {'PASS' if ok else 'FAIL'}  traps vs matching rear joint "
          f"material: {joint_overlap:.6f} mm^3")
    if not ok:
        FAILURES.append("captive nut trap collides with matching joint volume")
    moving_clear = all(
        max(site_metrics[name] for name in (
            "nut_overlap", "sweep_overlap", "screw_overlap")) < 1e-5
        for site_key, site_metrics in metrics.items()
        if isinstance(site_key, tuple)
    )
    print(f"   {'PASS' if moving_clear else 'FAIL'}  nut/sweep/M2 probes include "
          "real side walls, collars and split lip")

    h2_x, h2_y = P.PCB_MOUNTS[1]
    radius = P.NUT_ENVELOPE_R
    battery_gap = h2_x - (P.BATT_X + P.CELL_W) - radius
    cap_offset = (P.DRIVER_H - P.DRIVER_W) / 2.0
    closest_cap_y = max(
        P.GRILLE_Y - cap_offset,
        min(h2_y, P.GRILLE_Y + cap_offset),
    )
    speaker_gap = (
        math.hypot(h2_x - P.GRILLE_X, h2_y - closest_cap_y)
        - P.DRIVER_W / 2.0
        - radius
    )
    reset_outer_r = (
        P.RESET_CAP_D / 2.0
        + P.CAP_FLANGE_OS
        + P.COLLAR_CLEAR
        + shell_front.COLLAR_WALL
    )
    reset_gap = (
        math.hypot(h2_x - P.RESET_X, h2_y - P.RESET_Y)
        - radius
        - reset_outer_r
    )
    metrics.update({
        "h2_battery_gap": battery_gap,
        "h2_speaker_gap": speaker_gap,
        "h2_reset_gap": reset_gap,
    })
    for name, gap, minimum in (
        ("battery right edge", battery_gap, 1.8),
        ("vertical-stadium speaker left arc", speaker_gap, 0.9),
        ("Reset guide/cap outer envelope", reset_gap, 0.6),
    ):
        ok = gap >= minimum - 1e-9
        print(f"   {'PASS' if ok else 'FAIL'}  H2 to {name}: "
              f"{gap:.3f} mm (minimum {minimum:.1f})")
        if not ok:
            FAILURES.append(
                f"captive nut H2 {name} gap {gap:.3f} < {minimum:.1f} mm")
    return metrics


def check_pcb_support():
    """Deflection at each button, and that the support rib clears the cell."""
    print("\nPCB stiffness")
    E, t, w = 20000.0, P.PCB_T, P.PCB_H
    I = w * t ** 3 / 12.0
    supports = [m[0] for m in P.PCB_MOUNTS]
    pads = list(P.PCB_SUPPORT_PADS)
    # the cell fence is now a ledge the board rests on, so its rails count
    fx0, fx1 = P.BATT_X - P.BATT_CLEAR, P.BATT_X + P.CELL_W + P.BATT_CLEAR
    fy0, fy1 = P.BATT_Y - P.BATT_CLEAR, P.BATT_Y + P.CELL_H + P.BATT_CLEAR

    def to_fence(bx, by):
        """Distance to the nearest fence rail (the border, not the interior)."""
        if fx0 <= bx <= fx1 and fy0 <= by <= fy1:
            return min(bx - fx0, fx1 - bx, by - fy0, fy1 - by)
        return max(abs(bx - (fx0 + fx1) / 2) - (fx1 - fx0) / 2,
                   abs(by - (fy0 + fy1) / 2) - (fy1 - fy0) / 2)
    rib_y = (P.PCB_RIB_Y0 + P.PCB_RIB_Y1) / 2
    worst = 0.0
    for nm, bx, by in (("directions", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY),
                       ("Undo", P.UNDO_X, P.UNDO_Y), ("Action", P.ACT_X, P.ACT_Y),
                       ("Reset", P.RESET_X, P.RESET_Y), ("Menu", P.MENU_X, P.MENU_Y)):
        span = min([abs(bx - s) for s in supports] +
                   [((bx - px) ** 2 + (by - py) ** 2) ** 0.5 for px, py in pads] +
                   [to_fence(bx, by)] +
                   ([abs(by - rib_y)] if P.PCB_RIB_X0 <= bx <= P.PCB_RIB_X1 else []))
        d = P.TACT_FORCE_N * span ** 3 / (3 * E * I)
        worst = max(worst, d)
        print(f"      {nm:11} span {span:5.1f} mm   deflection {d:.3f} mm")
    ok = worst < P.TACT_TRAVEL * 0.6
    print(f"   {'PASS' if ok else 'FAIL'}  worst deflection {worst:.3f} mm "
          f"(want < {P.TACT_TRAVEL * 0.6:.3f}, i.e. 60% of switch travel)")
    if not ok:
        FAILURES.append("board too flexible")

    for px, py in P.PCB_SUPPORT_PADS:
        r = P.PCB_PAD_D / 2
        clashes = []
        if (px + r > P.BATT_X - 1.8 and px - r < P.BATT_X + P.CELL_W + 1.8
                and py + r > P.BATT_Y - 1.8 and py - r < P.BATT_Y + P.CELL_H + 1.8):
            clashes.append("cell")
        if (px + r > P.GRILLE_X - P.DRIVER_W / 2 - 1.5
                and px - r < P.GRILLE_X + P.DRIVER_W / 2 + 1.5
                and py + r > P.GRILLE_Y - P.DRIVER_H / 2 - 1.5
                and py - r < P.GRILLE_Y + P.DRIVER_H / 2 + 1.5):
            clashes.append("driver")
        on_board = (P.PCB_X <= px <= P.PCB_X + P.PCB_W
                    and P.PCB_Y <= py <= P.PCB_Y + P.PCB_H)
        ok = not clashes and on_board
        print(f"   {'PASS' if ok else 'FAIL'}  support pad ({px}, {py}) "
              f"{'clear' if ok else 'fouls ' + ', '.join(clashes or ['off board'])}")
        if not ok:
            FAILURES.append("support pad")

    # The fence is open at the top, so the rib is checked against the CELL
    # itself -- it doubles as the cell's top retainer.
    gap = P.BATT_Y - P.PCB_RIB_Y1
    ok = gap >= 0.3
    print(f"   {'PASS' if ok else 'FAIL'}  rib to cell {gap:+.2f} mm "
          f"(rib also retains the cell from above)")
    if not ok:
        FAILURES.append("rib fouls cell")


def check_pcb_mounts():
    """Mounting holes must sit on board material and clear of the cell.

    Guards a bug the owner found: when the driver became rectangular the notch
    grew, and H2 at (80, 72) ended up inside it -- a mounting hole floating in
    empty space where the board had been cut away. Nothing else looked at it.
    """
    print("\nPCB mounting holes")
    nx0 = P.GRILLE_X - P.DRIVER_W / 2 - 0.8
    ny0 = P.GRILLE_Y - P.DRIVER_H / 2 - 0.8
    r = P.PCB_MOUNT_D / 2 + 0.5
    fence_x0 = P.BATT_X - P.BATT_CLEAR - 1.2
    fence_x1 = P.BATT_X + P.CELL_W + P.BATT_CLEAR + 1.2
    for i, (hx, hy) in enumerate(P.PCB_MOUNTS, start=1):
        on_board = (P.PCB_X + r <= hx <= P.PCB_X + P.PCB_W - r
                    and P.PCB_Y + r <= hy <= P.PCB_Y + P.PCB_H - r)
        in_notch = (hx + r >= nx0 and hy + r >= ny0)
        # either side of the cell is fine; the check previously assumed only
        # the right-hand strip existed, and rejected the new left-hand pillars
        off_cell = (hx - r >= fence_x1) or (hx + r <= fence_x0)
        ok = on_board and not in_notch and off_cell
        why = ("in the driver notch" if in_notch else
               "off the board" if not on_board else
               "over the cell" if not off_cell else "ok")
        print(f"   {'PASS' if ok else 'FAIL'}  H{i} at ({hx}, {hy}){'':4} {why}")
        if not ok:
            FAILURES.append(f"PCB mount H{i}")


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
         P.GRILLE_X - P.DRIVER_W / 2 - 1.5, P.GRILLE_X + P.DRIVER_W / 2 + 1.5,
         P.GRILLE_Y - P.DRIVER_H / 2 - 1.5, P.GRILLE_Y + P.DRIVER_H / 2 + 1.5),
        ("controller PCB",
         P.PCB_X, P.PCB_X + P.PCB_W, P.PCB_Y, P.PCB_Y + P.PCB_H),
    ]
    for name, x0, x1, y0, y1 in items:
        m = min(x0 - rim, hi_x - x1, y0 - rim, hi_y - y1)
        ok = m >= 0
        print(f"   {'PASS' if ok else 'FAIL'}  {name:18} clearance {m:+.2f} mm")
        if not ok:
            FAILURES.append(name)

    # Compare the driver BODY, not its back-shell retaining ring: the ring lives
    # at z -10.8..-12.8 on the lid while the Reset collar is at 0..-3.5 on the
    # front shell, so they never meet. The driver body does span the collar's
    # depth, so that is the pair that matters.
    gap = (P.GRILLE_X - P.DRIVER_W / 2) - (P.RESET_X + P.RESET_CAP_D / 2 +
                                           P.CAP_FLANGE_OS + P.COLLAR_CLEAR + 1.2)
    ok = gap >= 0
    print(f"   {'PASS' if ok else 'FAIL'}  {'driver vs Reset cap':18} clearance {gap:+.2f} mm")
    if not ok:
        FAILURES.append("driver vs Reset")

    # Fixings coverage. Guards the gap the owner found: all four original
    # bosses borrow the module's holes and sit in the upper 50 mm, leaving the
    # half with the cell in it fastened by nothing. A collision check cannot
    # see a missing feature, so this asserts presence, not absence of clash.
    # Side-arc ergonomics defer EXTRA_BOSSES until the outer carve settles
    # (2026-08-02-pocket-card-side-arc-ergonomics-design.md) — empty is INFO.
    lower = [b for b in P.EXTRA_BOSSES if b[1] > P.CONTROL_BAND_TOP]
    if not P.EXTRA_BOSSES:
        print(f"   INFO  {'lower-half fixings':18} deferred (EXTRA_BOSSES empty; "
              f"re-place after side-arc tune)")
    else:
        ok = len(lower) >= 2
        print(f"   {'PASS' if ok else 'FAIL'}  {'lower-half fixings':18} "
              f"{len(lower)} boss(es) below y={P.CONTROL_BAND_TOP}")
        if not ok:
            FAILURES.append("lower half unfastened")

    boss_r = 2.1
    obstacles = [
        ("PCB", P.PCB_X, P.PCB_X + P.PCB_W, P.PCB_Y, P.PCB_Y + P.PCB_H),
        ("cell fence", P.BATT_X - P.BATT_CLEAR - 1.2, P.BATT_X + P.CELL_W + P.BATT_CLEAR + 1.2,
         P.BATT_Y - P.BATT_CLEAR - 1.2, P.BATT_Y + P.CELL_H + P.BATT_CLEAR + 1.2),
        # The driver BODY, not its retaining ring: the ring is relieved around
        # any boss that encroaches (see shell_back.driver_housing), so only the
        # driver itself is a hard obstacle here.
        ("driver", P.GRILLE_X - P.DRIVER_W / 2, P.GRILLE_X + P.DRIVER_W / 2,
         P.GRILLE_Y - P.DRIVER_H / 2, P.GRILLE_Y + P.DRIVER_H / 2),
    ]
    for bi, (bx, by) in enumerate(P.EXTRA_BOSSES):
        if (bx, by) in P.PCB_MOUNTS:
            print(f"   INFO  boss {bi + 1} at ({bx}, {by}) is also a PCB mount; "
                  f"passing through the board is intended")
            continue
        m = min(bx - boss_r - P.WALL, P.BODY_W - P.WALL - bx - boss_r,
                by - boss_r - P.WALL, P.BODY_H - P.WALL - by - boss_r)
        worst_name = "wall"
        for name, x0, x1, y0, y1 in obstacles:
            ox = min(bx + boss_r, x1) - max(bx - boss_r, x0)
            oy = min(by + boss_r, y1) - max(by - boss_r, y0)
            sep = -min(ox, oy) if (ox > 0 and oy > 0) else min(
                abs(bx - boss_r - x1), abs(x0 - bx - boss_r),
                abs(by - boss_r - y1), abs(y0 - by - boss_r))
            if ox > 0 and oy > 0 and sep < m:
                m, worst_name = sep, name
        ok = m >= 0
        print(f"   {'PASS' if ok else 'FAIL'}  boss {bi + 1} at "
              f"({bx}, {by}){'':4} clearance {m:+.2f} mm (vs {worst_name})")
        if not ok:
            FAILURES.append(f"boss {bi + 1}")

    menu_half = (P.PILL_L + 2 * P.CAP_FLANGE_OS + 2 * P.COLLAR_CLEAR) / 2 + 1.2
    reset_half = P.RESET_CAP_D / 2 + P.CAP_FLANGE_OS + P.COLLAR_CLEAR + 1.2
    gap = (P.RESET_X - reset_half) - (P.MENU_X + menu_half)
    ok = gap >= 0
    print(f"   {'PASS' if ok else 'FAIL'}  {'Reset vs Menu':18} clearance {gap:+.2f} mm")
    if not ok:
        FAILURES.append("Reset vs Menu")


def check_back_shell():
    """Nothing on the lid may protrude out of the back, and the module must be
    clamped rather than left floating on plain posts.

    Both guard bugs this file previously had. The battery fence and driver ring
    were extruded the wrong way and stood 0.5 mm proud of the outer surface; and
    the posts were widened to Ø4.2 for the corner bosses, which cannot pass
    through the module's Ø3.2 holes at all. A render shows neither.
    """
    path = back_shell_stl_path()
    if not os.path.exists(path):
        return
    print("\nback shell")
    tri = load_tris(path)
    bad = back_shell_vertex_violations(tri)
    ok = not bad
    worst = min((z - allowed for _, z, allowed in bad), default=0.0)
    print(f"   {'PASS' if ok else 'FAIL'}  every vertex stays inside its local "
          f"rear-deck allowance ({len(bad)} violations, worst {worst:.3f} mm)")
    for y, z, allowed in bad[:5]:
        print(f"          layout y={y:.2f}: z={z:.3f}, allowed >= {allowed:.3f}")
    if not ok:
        FAILURES.append("feature proud of local rear profile")

    ok = 3.0 < P.MOUNT_HOLE_D
    print(f"   {'PASS' if ok else 'FAIL'}  post fits the module hole   "
          f"Ø3.0 through Ø{P.MOUNT_HOLE_D}")
    if not ok:
        FAILURES.append("post too fat for module hole")

    pcb_front = P.MODULE_Z + P.MOD_FRONT_STACK - 1.6
    pcb_back = P.MODULE_Z + P.MOD_FRONT_STACK
    print(f"   INFO  module clamped between {pcb_front:.2f} (front-shell shoulder) "
          f"and {pcb_back:.2f} (rear joint land)")


_BUILT_BACK = None


def _back_solid_probe():
    """Build the back shell once; return a layout-space point classifier."""
    global _BUILT_BACK
    import shell_back
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.TopAbs import TopAbs_IN, TopAbs_ON
    from OCP.gp import gp_Pnt

    if _BUILT_BACK is None:
        _BUILT_BACK = shell_back.build_back().val()
    shape = _BUILT_BACK

    def solid(x, y_layout, z):
        y = P.BODY_H - y_layout   # undo to_model_space mirror
        clf = BRepClass3d_SolidClassifier(shape.wrapped, gp_Pnt(x, y, z), 1e-6)
        return clf.State() in (TopAbs_IN, TopAbs_ON)

    return solid


def check_battery_keepout():
    """Nothing solid may reach the cell volume (+0.3 mm of its clearance).

    Found live: the rim band at the bottom-left corner round swept ~1 mm into
    the pouch cell's front corner. Probes the built solid, dense at the edges.
    """
    print("\nbattery keepout (built solid)")
    solid = _back_solid_probe()
    pcb_back = P.PCB_FRONT_Z + P.PCB_T
    z0 = -(pcb_back + P.PET_T)                              # cell front
    z1 = -(pcb_back + P.PET_T + P.CELL_T + P.CELL_SWELL)    # cell back
    m = 0.3                     # strictly inside BATT_CLEAR: no face-contact
    x0, x1 = P.BATT_X - m, P.BATT_X + P.CELL_W + m
    y0, y1 = P.BATT_Y - m, P.BATT_Y + P.CELL_H + m
    zs = (z1 + 0.15, (z0 + z1) / 2, z0 - 0.15)
    bad = []
    n = 0
    step = 1.0
    x = x0
    while x <= x1 + 1e-6:
        y = y0
        while y <= y1 + 1e-6:
            edge = (x < x0 + 2.1 or x > x1 - 2.1 or
                    y < y0 + 2.1 or y > y1 - 2.1)
            if edge or (int(x) % 4 == 0 and int(y) % 4 == 0):
                for z in zs:
                    n += 1
                    if solid(x, y, z):
                        bad.append((x, y, z))
            y += step
        x += step
    ok = not bad
    print(f"   {'PASS' if ok else 'FAIL'}  cell + {m} mm margin clear "
          f"({n} probes)")
    for b in bad[:6]:
        print(f"          solid at ({b[0]:.1f}, {b[1]:.1f}, {b[2]:.2f})")
    if not ok:
        FAILURES.append("battery keepout")


def check_back_roll():
    """The back perimeter must be rolled, symmetric, and never flare.

    Three ways this used to go wrong: the north edge got no roll at all (flat
    back straight out to y=0 at full BODY_T), left and right ran at different
    radii so the right side read wavy, and the plan corners were prismatic so
    the roll died at every corner.
    """
    print("\nback roll (envelope)")
    import side_arc
    z = side_arc.outer_back_z_at

    # 1. mirror symmetry about x = BODY_W/2
    worst, at = 0.0, None
    for y in (1.0, 5.0, 12.0, 25.0, 46.5, 65.0, 80.0, 88.0, 92.0):
        for x in (0.5, 2.0, 5.0, 9.0, 16.0, 30.0, 44.0):
            d = abs(z(x, y) - z(P.BODY_W - x, y))
            if d > worst:
                worst, at = d, (x, y)
    ok = worst <= 0.01
    print(f"   {'PASS' if ok else 'FAIL'}  mirror symmetric about x={P.BODY_W/2}"
          f" (worst {worst:.3f} mm at {at})")
    if not ok:
        FAILURES.append("back roll symmetry")

    # 2. every edge midpoint is rolled — none left square at full depth
    for lbl, x, y in (("north", P.BODY_W / 2, 0.3), ("south", P.BODY_W / 2, P.BODY_H - 0.3),
                      ("west", 0.3, P.BODY_H / 2), ("east", P.BODY_W - 0.3, P.BODY_H / 2)):
        lift = P.BODY_T + z(x, y)      # how far the skin sits off full depth
        ok = lift >= 0.5
        print(f"   {'PASS' if ok else 'FAIL'}  {lbl:5s} edge rolled: skin "
              f"{lift:.2f} mm off the full-depth back")
        if not ok:
            FAILURES.append(f"{lbl} edge not rolled")

    # 3. no flare: the skin may only get shallower toward the perimeter, so
    #    walking outward must never find MORE depth (an overhang would trap
    #    the part in a mould and read as the old crease).
    bad = []
    for y in (3.0, 20.0, 46.5, 70.0, 90.0):
        prev = None
        for i in range(40):
            x = 0.4 + i * 0.4
            cur = side_arc.outer_back_z_opt(x, y)
            if cur is None:      # column is outside the plan outline
                prev = None
                continue
            if prev is not None and cur > prev + 0.02:
                bad.append((round(x, 1), y))
                break
            prev = cur
    ok = not bad
    print(f"   {'PASS' if ok else 'FAIL'}  monotonic inward (no flare/overhang)"
          + (f" — reverses at {bad[:3]}" if bad else ""))
    if not ok:
        FAILURES.append("back roll flare")

    # 4. Both deck transitions must stay continuous and monotonic across the
    #    real rolled surface, not merely in the analytic centreline profile.
    #    Applying the profile after the perimeter roll once left a full-height
    #    cliff at the sides while the centreline looked correct.
    def scan_transition(label, y0, y1, *, increasing, designed_slope):
        scalar = rear_deck_transition_metrics(
            y0, y1, increasing=increasing, step=0.1)
        limit = designed_slope + 0.5
        expected_start = 0.0 if increasing else P.DECK_H
        expected_end = P.DECK_H if increasing else 0.0
        scalar_ok = (
            scalar["monotonic"]
            and scalar["max_slope_deg"] <= limit + 1e-9
            and abs(scalar["start_depth"] - expected_start) <= 1e-7
            and abs(scalar["end_depth"] - expected_end) <= 1e-7
        )

        # The deck's scalar contract runs all the way to BODY_H.  The finished
        # surface check stops where the independent south perimeter roll starts:
        # that pre-existing roll deliberately turns the surface toward vertical
        # over its last BACK_ROLL_S millimetres, so its slope is not the deck
        # taper's slope.  The separate edge-roll checks above own that region.
        surface_y1 = min(y1, P.BODY_H - P.BACK_ROLL_S)
        ys = _profile_sample_ys(y0, surface_y1, 0.1)
        # Stay on the back field rather than measuring the side torus.  The
        # lower transition enters the R12 plan corners, whose perimeter roll
        # also changes Z with Y; inset by that plan radius to keep the sampled
        # width on the deck surface itself.
        x_margin = P.BACK_ROLL_SIDE + 0.4
        if surface_y1 > P.BODY_H - P.CASE_BOTTOM_R:
            x_margin = max(x_margin, P.CASE_BOTTOM_R + 0.4)
        worst_slope, at = 0.0, None
        surface_monotonic = True
        samples = 0
        x = x_margin
        while x < P.BODY_W - x_margin + 0.1:
            prev = None
            for y in ys:
                cur = side_arc.outer_back_z_opt(x, y)
                if cur is None:
                    prev = None
                    continue
                if prev is not None:
                    py, pz = prev
                    dz = cur - pz
                    if increasing and dz > 0.005:
                        surface_monotonic = False
                    if not increasing and dz < -0.005:
                        surface_monotonic = False
                    slope = math.degrees(math.atan(abs(dz) / (y - py)))
                    if slope > worst_slope:
                        worst_slope, at = slope, (round(x, 1), round(y, 1))
                    samples += 1
                prev = (y, cur)
            x += 0.5
        surface_ok = (surface_monotonic and worst_slope <= limit + 1e-9
                      and samples > 0)
        ok = scalar_ok and surface_ok
        print(f"   {'PASS' if ok else 'FAIL'}  deck {label} continuous and "
              f"{'deepens' if increasing else 'returns'} every 0.1 mm; scalar "
              f"{scalar['max_slope_deg']:.2f} deg through y={y1:.2f}, "
              f"surface {worst_slope:.2f} deg at {at} through "
              f"y={surface_y1:.2f}, x={x_margin:.1f}.."
              f"{P.BODY_W-x_margin:.1f} (limit {limit:.2f})")
        if not ok:
            FAILURES.append(f"rear deck {label} transition")

    if P.DECK_H > 1e-6:
        scan_transition(
            "rise", P.DECK_RISE_Y0, P.DECK_PLATEAU_Y0,
            increasing=True, designed_slope=P.DECK_RISE_PHI)
        scan_transition(
            "taper", P.DECK_PLATEAU_Y1, P.DECK_TAPER_Y1,
            increasing=False, designed_slope=P.DECK_TAPER_PHI)

        # The central scans above can follow the taper farther south, but their
        # x inset intentionally excludes the rolled sides. Add a second,
        # full-width regression over Y domains where side columns are defined
        # without entering a plan corner: the complete rise, and the taper only
        # through the R12 bottom-corner tangent at BODY_H-CASE_BOTTOM_R.
        def check_full_width(label, y0, y1, *, increasing, designed_slope):
            limit = designed_slope + 0.5
            metrics = rear_deck_surface_transition_metrics(
                y0, y1, increasing=increasing, slope_limit_deg=limit)
            covers_sides = (
                metrics["min_sampled_x"] is not None
                and metrics["min_sampled_x"] < P.BACK_ROLL_SIDE
                and metrics["max_sampled_x"] > P.BODY_W - P.BACK_ROLL_SIDE
            )
            ok = (metrics["monotonic"] and metrics["continuous"]
                  and covers_sides)
            print(f"   {'PASS' if ok else 'FAIL'}  deck {label} has no side "
                  f"cliff across x={metrics['min_sampled_x']:.1f}.."
                  f"{metrics['max_sampled_x']:.1f}, y={y0:.2f}..{y1:.2f} "
                  f"(steepest {metrics['max_slope_deg']:.2f} deg at "
                  f"{metrics['max_slope_at']}, limit {limit:.2f})")
            if not ok:
                FAILURES.append(f"rear deck {label} side transition")

        check_full_width(
            "rise", P.DECK_RISE_Y0, P.DECK_PLATEAU_Y0,
            increasing=True, designed_slope=P.DECK_RISE_PHI)
        check_full_width(
            "taper", P.DECK_PLATEAU_Y1, P.BODY_H - P.CASE_BOTTOM_R,
            increasing=False, designed_slope=P.DECK_TAPER_PHI)

    # 5. torus sanity: a roll wider than its plan corner self-intersects
    for lbl, plan, roll in (("top", P.CASE_TOP_R, max(P.BACK_ROLL_N, P.BACK_ROLL_SIDE)),
                            ("bottom", P.CASE_BOTTOM_R, max(P.BACK_ROLL_S, P.BACK_ROLL_SIDE))):
        ok = roll <= plan - P.BACK_ROLL_MARGIN + 1e-9
        print(f"   {'PASS' if ok else 'FAIL'}  {lbl} corner: roll {roll} <= plan "
              f"{plan} - {P.BACK_ROLL_MARGIN}")
        if not ok:
            FAILURES.append(f"{lbl} torus margin")


def check_module_outline():
    """The display module's PCB must fit inside the interior, corners included.

    Nothing checked this, and nothing in the layout is free enough to absorb it
    if it drifts: the module is 86.0 wide in an interior of ~86.1, it can move
    at most 0.5 mm south before it reaches the controller board, and it is a
    bought part so its outline is fixed. CASE_TOP_R of 10.0 had its top corners
    1.61 mm inside the wall.
    """
    print("\ndisplay module outline vs interior")
    import cadquery as cq

    import side_arc

    z0 = -(P.MODULE_Z + P.MOD_FRONT_STACK)
    board = (cq.Workplane("XY")
             .box(P.MOD_W, P.MOD_H, P.MOD_PCB_T, centered=False)
             .translate((P.MOD_X, P.MOD_Y, z0))
             .edges("|Z").fillet(P.MOD_CORNER_R))
    stray = board.cut(cq.Workplane(side_arc._envelope(P.WALL)))
    lumps = stray.solids().vals()
    v = sum(s.Volume() for s in lumps) if lumps else 0.0
    ok = v < 1e-3
    print(f"   {'PASS' if ok else 'FAIL'}  {P.MOD_W}x{P.MOD_H} R{P.MOD_CORNER_R} "
          f"board inside the wall ({v:.3f} mm^3 outside)")
    if not ok:
        for s in lumps[:4]:
            b = s.BoundingBox()
            print(f"         lump {s.Volume():7.3f} mm^3 at x "
                  f"{b.xmin:.2f}..{b.xmax:.2f} y {b.ymin:.2f}..{b.ymax:.2f}")
        FAILURES.append("module outline outside the interior")

    # The southward escape route, so a future MOD_Y nudge cannot silently
    # drive the module into the controller board (they overlap 0.2 mm in z).
    gap = P.PCB_Y - (P.MOD_Y + P.MOD_H)
    ok = gap >= 0.0
    print(f"   {'PASS' if ok else 'FAIL'}  module clears the controller board "
          f"by {gap:.2f} mm")
    if not ok:
        FAILURES.append("module overlaps the controller board")


def check_display_plug():
    """The outward-facing display plug and the lower deck behind it.

    The old clearance was correctly budgeted but placed at the module's top
    edge.  Probe the real shell at the assembled plug coordinates so a future
    move in either direction cannot silently separate the cavity from the
    connector it exists to clear.
    """
    print("\ndisplay plug and cable vs the lower rear deck")
    import cadquery as cq

    import shell_back

    back = shell_back.to_model_space(shell_back.build_back())
    rear = -(P.MODULE_Z + P.MOD_FRONT_STACK)

    def lump(l, w, h, dx=0.0, dy=0.0):
        part = (cq.Workplane("XY").box(l, w, h, centered=(True, True, False))
                .translate((P.DISPLAY_PLUG_X + dx,
                            P.DISPLAY_PLUG_Y + dy, rear - h)))
        s = back.intersect(part)
        return sum(x.Volume() for x in s.solids().vals()) if s.solids().vals() else 0.0

    # 1. the mated pair, at the module's placement extremes. The body is the
    #    envelope: the crimp housing is 4.25 x 3.20 and sits inside it.
    worst, at = 0.0, None
    for dx in (-0.3, 0.0, 0.3):
        for dy in (-0.3, 0.0, 0.3):
            v = lump(P.DISPLAY_PLUG_BODY_L, P.DISPLAY_PLUG_BODY_W,
                     P.DISPLAY_PLUG_MATED_H, dx, dy)
            if v > worst:
                worst, at = v, (dx, dy)
    ok = worst < 1e-3
    print(f"   {'PASS' if ok else 'FAIL'}  mated {P.DISPLAY_PLUG_BODY_L} x "
          f"{P.DISPLAY_PLUG_BODY_W} x {P.DISPLAY_PLUG_MATED_H} clear at "
          f"+/-0.3 module drift "
          f"({worst:.4f} mm^3" + (f" at {at}" if at else "") + ")")
    if not ok:
        FAILURES.append("tray fouls the display plug")

    # 2. The leads leave the outward-facing plug body and need the established
    #    extra 0.80 mm before turning away from the shell.
    v = lump(P.DISPLAY_PLUG_BODY_L, P.DISPLAY_PLUG_BODY_W,
             P.DISPLAY_PLUG_MATED_H + P.DISPLAY_PLUG_CABLE)
    ok = v < 1e-3
    print(f"   {'PASS' if ok else 'FAIL'}  plus {P.DISPLAY_PLUG_CABLE} of cable "
          f"exit room "
          f"over the housing ({v:.4f} mm^3)")
    if not ok:
        FAILURES.append("no room for the display-plug cable exit")

    # 3. Both footprint ends, including clearance and the wall, must land on
    #    the full-depth plateau rather than either transition.
    north = (P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2
             - P.DISPLAY_PLUG_CLEAR - P.WALL)
    south = (P.DISPLAY_PLUG_Y + P.DISPLAY_PLUG_BODY_W / 2
             + P.DISPLAY_PLUG_CLEAR + P.WALL)
    ok = P.DECK_PLATEAU_Y0 <= north and south <= P.DECK_PLATEAU_Y1
    print(f"   {'PASS' if ok else 'FAIL'}  pocket y {north:.2f}..{south:.2f} "
          f"inside plateau {P.DECK_PLATEAU_Y0:.2f}..{P.DECK_PLATEAU_Y1:.2f}")
    if not ok:
        FAILURES.append("display-plug pocket runs into a deck transition")

    # 4. Nothing else on the module needs the added depth, which is why the
    #    upper screen region can return to the normal rear plane.
    flat = P.BODY_T - P.WALL - (P.MODULE_Z + P.MOD_FRONT_STACK)
    ok = P.MOD_REAR_TYPICAL <= flat
    print(f"   {'PASS' if ok else 'FAIL'}  the other rear parts "
          f"({P.MOD_REAR_TYPICAL}) still fit the flat tray ({flat:.2f})")
    if not ok:
        FAILURES.append("flat tray too shallow for the module's side-entry parts")


def check_split_lap():
    """The two shells must be single solids that can actually be slid shut.

    Every one of these fired on the rim this replaced. It was built by
    insetting the rolled envelope, so (a) it stood inboard of the tray wall
    with nothing under it — lid() was two solids, the lip a free-floating
    ring; (b) it followed the roll, so it grew 0.354 mm per side over its
    1.2 mm and its top was 0.085 mm wider than the mouth it had to enter; and
    (c) it crossed the module PCB, which is 86.0 wide in an ~86.1 interior.
    """
    print("\nsplit-line lap")
    import cadquery as cq

    import shell_back
    import shell_front
    import side_arc

    t_sum = P.LAP_T + P.LAP_CLEAR + P.LAP_FRONT_T
    ok = abs(t_sum - P.WALL) < 1e-9 and min(P.LAP_T, P.LAP_FRONT_T) >= 0.6
    print(f"   {'PASS' if ok else 'FAIL'}  laps partition the wall: tongue "
          f"{P.LAP_T} + slip {P.LAP_CLEAR} + skirt {P.LAP_FRONT_T} = {t_sum}")
    if not ok:
        FAILURES.append("lap thickness budget")

    # 1. no draft on the mating faces. Slice each one across the engagement
    #    and compare widths: the rim this replaced opened 0.354 mm per side.
    split = -(P.BODY_T - P.LID_T)

    def width_at(shape, z):
        slab = (cq.Workplane("XY")
                .box(P.BODY_W + 8, P.BODY_H + 8, 0.04, centered=False)
                .translate((-4.0, -4.0, z)))
        cut = shape.intersect(slab)
        return cut.val().BoundingBox().xmax if cut.solids().vals() else None

    for lbl, shape in (("tongue", shell_back.split_tongue()),
                       ("front rebate", shell_front.split_rebate())):
        ws = [w for w in (width_at(shape, split + f * P.LAP_H)
                          for f in (0.05, 0.35, 0.65, 0.95)) if w is not None]
        draft = max(ws) - min(ws)
        ok = draft <= 0.005
        print(f"   {'PASS' if ok else 'FAIL'}  {lbl} has no draft over the "
              f"engagement (opens {draft:.4f} mm, x_max {max(ws):.3f})")
        if not ok:
            FAILURES.append(f"{lbl} flares")

    # 2. the tongue is over the tray wall, not over the cavity — the old rim
    #    hung RIM_CLEAR inboard of the wall's inner face and touched nothing.
    lid = shell_back.lid()
    n = len(lid.solids().vals())
    ok = n == 1
    print(f"   {'PASS' if ok else 'FAIL'}  tray + tongue fuse into one solid "
          f"(got {n})")
    if not ok:
        FAILURES.append("tongue not fused to the tray")

    # 3. nothing of the tongue reaches inboard of the inner wall, so the
    #    module PCB sees exactly the wall it saw before.
    inner = side_arc.section_prism(P.WALL, split, split, split + P.LAP_H)
    stray = shell_back.split_tongue().intersect(inner)
    v = sum(s.Volume() for s in stray.solids().vals()) if stray.solids().vals() else 0.0
    ok = v < 1e-3
    print(f"   {'PASS' if ok else 'FAIL'}  tongue stays in the wall "
          f"({v:.4f} mm^3 inboard of the inner face)")
    if not ok:
        FAILURES.append("tongue intrudes past the inner wall")

    # 4. the shells close, and stay clear the whole way in. A lip that flares
    #    passes this at lift 0 and fails partway — so sweep, do not spot-check.
    front, back = shell_front.build(), shell_back.build_back()
    for lbl, n2 in (("front", len(front.solids().vals())),
                    ("back", len(back.solids().vals()))):
        ok = n2 == 1
        print(f"   {'PASS' if ok else 'FAIL'}  {lbl} shell is one solid (got {n2})")
        if not ok:
            FAILURES.append(f"{lbl} shell is {n2} solids")

    worst, at = 0.0, None
    for lift in (0.0, 0.1, 0.3, 0.6, 0.9, P.LAP_H, P.LAP_H + 0.4, 2.5):
        o = front.translate((0, 0, lift)).intersect(back)
        v = sum(s.Volume() for s in o.solids().vals()) if o.solids().vals() else 0.0
        if v > worst:
            worst, at = v, lift
    ok = worst < 1e-3
    print(f"   {'PASS' if ok else 'FAIL'}  shells clear each other at every "
          f"insertion depth (worst {worst:.4f} mm^3"
          + (f" at lift {at}" if at else "") + ")")
    if not ok:
        FAILURES.append("shells interfere on assembly")


def check_usb_port():
    """The module's USB-C port: the case must stay out of the plug's way.

    Nothing checked this. The window it replaces was a round-numbered 10.0 x
    4.2 box centred 0.47 mm low, which (a) left a 0.21 mm knife edge of tray
    wall between the port and the split seam, and (b) still clipped the
    receptacle's bottom corner by 0.11 because its cutter stopped at x 3.0
    while the rolled wall reaches 3.25 down there.

    The overmold check is the one that says how big the hole has to be, and it
    is the one people get wrong in the expensive direction: sized for a
    12.35 x 6.50 overmold the port would be taller than the wall has room for.
    It only needs that if the skin sits further than a plug shell's length
    behind the receptacle, and ours sits 2.00 mm behind it.
    """
    print("\nUSB-C port")
    import cadquery as cq

    import shell_back
    import shell_front

    back = shell_back.to_model_space(shell_back.build_back())
    shell = back.union(shell_front.to_model_space(shell_front.build()))
    zc = (P.USB_REC_Z0 + P.USB_REC_Z1) / 2

    def prism(w, h, x0, dx, dy=0.0, dz=0.0):
        return (cq.Workplane("XY").box(dx, w, h, centered=(False, True, True))
                .translate((x0, P.USB_Y + dy, zc + dz)))

    def volume(shape):
        s = shell.intersect(shape)
        return sum(x.Volume() for x in s.solids().vals()) if s.solids().vals() else 0.0

    # 1. the plug's shell, all the way to the mating datum, at the module's
    #    placement extremes — a hole sized to nominal is not sized at all.
    worst, at = 0.0, None
    for dy in (-0.3, 0.0, 0.3):
        for dz in (-0.2, 0.0, 0.2):
            v = volume(prism(P.USB_PLUG_W, P.USB_PLUG_H,
                             P.MOD_X - P.USB_PLUG_L, P.USB_PLUG_L, dy, dz))
            if v > worst:
                worst, at = v, (dy, dz)
    ok = worst < 1e-3
    print(f"   {'PASS' if ok else 'FAIL'}  plug shell "
          f"{P.USB_PLUG_W} x {P.USB_PLUG_H} travels clear at +/-0.3 module "
          f"drift ({worst:.4f} mm^3" + (f" at {at}" if at else "") + ")")
    if not ok:
        FAILURES.append("case fouls the USB-C plug")

    # 2. and the receptacle itself, which the old cutter clipped.
    v = volume(prism(P.USB_REC_W, P.USB_REC_H, P.MOD_X, 7.35))
    ok = v < 1e-3
    print(f"   {'PASS' if ok else 'FAIL'}  receptacle body "
          f"{P.USB_REC_W} x {P.USB_REC_H} clear ({v:.4f} mm^3)")
    if not ok:
        FAILURES.append("case fouls the USB-C receptacle")

    # 3. no rib of tray wall left between the receptacle and the seam. The band
    #    is measured from the seam down, not from the port's own top edge — the
    #    two coincide by design, and keying off the port would make the check
    #    vacuous exactly when the port is drawn wrong.
    split = -(P.BODY_T - P.LID_T)
    band = (cq.Workplane("XY")
            .box(P.USB_CUT_X + 2.0, P.USB_W, split - P.USB_REC_Z1,
                 centered=(False, True, False))
            .translate((-2.0, P.USB_Y, P.USB_REC_Z1)))
    s = back.intersect(band)
    v = sum(x.Volume() for x in s.solids().vals()) if s.solids().vals() else 0.0
    ok = v < 1e-3
    print(f"   {'PASS' if ok else 'FAIL'}  no tray ledge between the port and "
          f"the split ({v:.4f} mm^3 in the {split - P.USB_REC_Z1:.2f} mm band)")
    if not ok:
        FAILURES.append("knife-edge ledge over the USB port")

    # 4. the overmold has to seat outside the case, over its whole 12.35 x 6.50.
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
    isec = IntCurvesFace_ShapeIntersector()
    isec.Load(shell.val().wrapped, 1e-6)
    reach = 0.0
    for iy in range(25):
        y = P.USB_Y + P.USB_MOLD_W * (iy / 24 - 0.5)
        for iz in range(25):
            z = zc + P.USB_MOLD_H * (iz / 24 - 0.5)
            isec.Perform(gp_Lin(gp_Pnt(-8.0, y, z), gp_Dir(1, 0, 0)), 0.0, 12.0)
            if isec.IsDone() and isec.NbPnt() > 0:
                x = min(isec.Pnt(i).X() for i in range(1, isec.NbPnt() + 1))
                reach = max(reach, P.MOD_X - x)
    ok = reach <= P.USB_SKIN_MAX
    print(f"   {'PASS' if ok else 'FAIL'}  skin sits {reach:.2f} mm behind the "
          f"mating datum (<= {P.USB_SKIN_MAX}, so the overmold seats clear)")
    if not ok:
        FAILURES.append("USB-C overmold cannot seat")


def check_driver_stack():
    """Driver vs board: the 3.5 mm driver in a 3.0 mm face->board gap.

    Only legal because the board outline is notched under it. Assert the
    notch actually covers the driver footprint, nothing lives in the notch,
    and the pocket walls stop above the board plane.
    """
    print("\ndriver stack (board notch)")
    gap = P.PCB_FRONT_Z - P.FACE_T
    dip = P.DRIVER_T - gap
    print(f"   INFO  face->board {gap:.1f} mm, driver {P.DRIVER_T} mm "
          f"-> dips {dip:.1f} through the board plane")
    nx, ny = P.PCB_DRIVER_NOTCH_X, P.PCB_DRIVER_NOTCH_Y
    dx0 = P.GRILLE_X - P.DRIVER_W / 2
    dy0 = P.GRILLE_Y - P.DRIVER_H / 2
    m = min(dx0 - nx, dy0 - ny)
    ok = m >= 0.5
    print(f"   {'PASS' if ok else 'FAIL'}  notch clears driver footprint by "
          f"{m:.2f} mm (want >= 0.5)")
    if not ok:
        FAILURES.append("driver notch coverage")
    # Nothing may live in the notched-away corner (with 1 mm margin).
    parts = [
        ("SW_UNDO", P.UNDO_X, P.UNDO_Y), ("SW_ACT", P.ACT_X, P.ACT_Y),
        ("SW_RESET", P.RESET_X, P.RESET_Y), ("SW_MENU", P.MENU_X, P.MENU_Y),
        ("J_BAT_IN", *P.CONN_BAT_IN), ("J_BAT_OUT", *P.CONN_BAT_OUT),
        ("mute slide", P.MUTE_SW_X, P.PCB_Y + P.PCB_H),
        ("power slide", P.POWER_SW_X, P.PCB_Y + P.PCB_H),
        ("boss 1", *P.EXTRA_BOSSES[0]), ("boss 2", *P.EXTRA_BOSSES[1]),
    ]
    bad = [n for n, x, y in parts if x > nx - 1.0 and y > ny - 1.0]
    ok = not bad
    print(f"   {'PASS' if ok else 'FAIL'}  notch corner free of parts"
          + (f" (in notch: {', '.join(bad)})" if bad else ""))
    if not ok:
        FAILURES.append("parts in driver notch")
    # Pocket walls must end above the board front, with real engagement left.
    wall_end = P.PCB_FRONT_Z - 0.2
    engage = wall_end - P.FACE_T
    ok = wall_end < P.PCB_FRONT_Z and engage >= 2.0
    print(f"   {'PASS' if ok else 'FAIL'}  pocket walls end at {wall_end:.1f} "
          f"(board {P.PCB_FRONT_Z}), engagement {engage:.1f} mm")
    if not ok:
        FAILURES.append("driver pocket walls")
    # Backstop: pedestal present behind the driver, but with an air gap so it
    # cannot preload the face bond. Probe the built back solid.
    solid = _back_solid_probe()
    drv_back = -(P.FACE_T + P.DRIVER_T)
    top = drv_back - P.DRIVER_BACKSTOP_CLR
    gx, gy = P.GRILLE_X, P.GRILLE_Y
    present = all(solid(gx + dx, gy + dy, top - 0.2)
                  for dx, dy in ((0, 0), (2, 0), (-2, 0), (0, 2), (0, -2)))
    gap = not any(solid(gx + dx, gy + dy, (top + drv_back) / 2)
                  for dx, dy in ((0, 0), (2, 0), (-2, 0), (0, 2), (0, -2)))
    ok = present and gap
    print(f"   {'PASS' if ok else 'FAIL'}  backstop under driver: "
          f"solid to z={-top:.1f}, {P.DRIVER_BACKSTOP_CLR} mm air gap "
          f"(present={present}, gap={gap})")
    if not ok:
        FAILURES.append("driver backstop")
    # Board must still seat past the pedestal: footprint inside the notch.
    r = P.DRIVER_BACKSTOP_D / 2
    m = min(gx - r - nx, gy - r - ny)
    ok = m >= 0.5
    print(f"   {'PASS' if ok else 'FAIL'}  backstop {m:.1f} mm inside the "
          f"notch (want >= 0.5)")
    if not ok:
        FAILURES.append("backstop vs notch")


def check_screw_joints():
    """Structural invariants on the BUILT back solid, per screw joint.

    The old checks probed named clearances and printed 'all checks passed'
    while six counterbores had daylight rings (WALL == SCREW_HEAD_H meant the
    pocket depth equalled the floor). These classify actual points:
      - pocket open from the skin to the seat,
      - seat ring solid for >= MIN_MEMBRANE behind the seat,
      - bore open through the land,
      - land material present around the pocket.
    """
    import joints
    import side_arc

    print("\nscrew joints (built solid)")
    solid = _back_solid_probe()
    selections = {
        (s.x, s.y, s.kind): s for s in joints.selected_screws()
    }

    for j in joints.back_joints():
        seat = j.seat_z
        errs = []
        selection = selections[(j.x, j.y, j.kind)]
        nut_front_z = -P.FACE_T
        nut_back_z = nut_front_z - P.NUT_MAX_T
        tip_z = selection.seat_z + selection.length
        outer_back_z = j.skin_range()[1]
        if selection.length not in joints.STOCKED_MACHINE_SCREW_LENGTHS:
            errs.append(f"M2x{selection.length:g} is not an approved stock length")
        if not (joints.MIN_HEAD_SEAT_DEPTH - 1e-9
                <= selection.seat_depth
                <= joints.MAX_HEAD_SEAT_DEPTH + 1e-9):
            errs.append(f"seat depth {selection.seat_depth:.3f} outside range")
        if abs(selection.outer_back_z - outer_back_z) > 1e-9:
            errs.append("selected outer-back profile datum is inconsistent")
        if abs(selection.seat_z
               - (selection.outer_back_z + selection.seat_depth)) > 1e-9:
            errs.append("selected seat/profile arithmetic is inconsistent")
        if abs(selection.seat_z - seat) > 1e-9:
            errs.append("selected seat does not match rear joint geometry")
        if seat > nut_back_z + 1e-9:
            errs.append("screw does not cross the complete 1.6 mm nut")
        if not (joints.MIN_TIP_PROTRUSION - 1e-9
                <= selection.tip_protrusion
                <= joints.MAX_TIP_PROTRUSION + 1e-9):
            errs.append(
                f"tip protrusion {selection.tip_protrusion:.3f} outside range")
        if abs(selection.tip_protrusion - (tip_z - nut_front_z)) > 1e-9:
            errs.append("selected tip/seat arithmetic is inconsistent")
        if tip_z > nut_front_z + P.MACHINE_SCREW_TIP_RELIEF + 1e-9:
            errs.append("screw tip exceeds the blind front relief")
        if P.FACE_T - P.MACHINE_SCREW_TIP_RELIEF < 0.9 - 1e-9:
            errs.append("less than 0.9 mm exterior front skin remains")
        # 1. pocket open: skin -> seat across the footprint
        for dx in (-0.7 * j.head_r, 0.0, 0.7 * j.head_r):
            xx = j.x + dx
            z_skin = side_arc.outer_back_z_at(xx, j.y)
            for f in (0.25, 0.6, 0.9):
                z = z_skin + f * max(seat - z_skin - 0.1, 0.1)
                if z < seat - 0.05 and solid(xx, j.y, z):
                    errs.append(f"pocket blocked at dx={dx:+.1f} z={z:.2f}")
        # 2. seat + membrane: ring between bore and head stays solid
        for r in (j.bore_r + 0.25, (j.bore_r + j.head_r) / 2, j.head_r - 0.15):
            for ax, ay in ((r, 0), (-r, 0), (0, r), (0, -r)):
                xx, yy = j.x + ax, j.y + ay
                for z in (seat + 0.1, seat + P.MIN_MEMBRANE - 0.05):
                    if z <= side_arc.outer_back_z_at(xx, yy) + 0.2:
                        continue   # outside the skin (open pocket entrance)
                    if not solid(xx, yy, z):
                        errs.append(f"membrane void at r={r:.2f} z={z:.2f}")
        # 3. bore open through the land
        z_mid = (seat + j.top_z) / 2
        if solid(j.x, j.y, z_mid):
            errs.append(f"bore blocked at z={z_mid:.2f}")
        # 4. land material present around the pocket (inboard side)
        toward = -1.0 if j.x > P.BODY_W / 2 else 1.0
        xx = j.x + toward * (j.land_r - 0.25)
        if not solid(xx, j.y, z_mid):
            errs.append(f"land missing inboard at z={z_mid:.2f}")
        ok = not errs
        print(f"   {'PASS' if ok else 'FAIL'}  {j.kind:6} ({j.x:5.1f},{j.y:5.1f}) "
              f"seat z={seat:6.2f} depth={selection.seat_depth:.3f}, "
              f"M2x{selection.length:g} tip={selection.tip_protrusion:.3f}, "
              f"membrane>={P.MIN_MEMBRANE}")
        for e in errs:
            print(f"          {e}")
        if not ok:
            FAILURES.append(f"screw joint ({j.x},{j.y})")


def check(name, got, want, tol):
    if isinstance(got, str) or isinstance(want, str):
        ok = got == want
        print(f"   {'PASS' if ok else 'FAIL'}  {name:34} {got!r:8}  (want {want!r})")
    else:
        ok = abs(got - want) <= tol
        print(f"   {'PASS' if ok else 'FAIL'}  {name:34} {got:8.3f}  (want {want:.3f} +/- {tol})")
    if not ok:
        FAILURES.append(name)


def check_edge_slide_tips():
    print("\nedge slide tips (params)")
    # Footprint: KiCad SW_SPDT_PCM12 — signal pads at y=-1.43, size 0.7×1.5
    # → copper south = SW_Y + SLIDE_PAD_SOUTH_REL. Pegs NPTH at y=+0.33.
    south = P.PCB_Y + P.PCB_H  # 90.0
    for name, y in (
        ("POWER", P.POWER_SW_Y),
        ("MUTE", P.MUTE_SW_Y),
    ):
        pad_south = y + P.SLIDE_PAD_SOUTH_REL
        clear = south - pad_south
        if clear < 0.5 - 1e-6:
            print(f"   FAIL  {name} pad-edge clear {clear:.2f} < 0.5")
            FAILURES.append(f"{name} pad edge")
        else:
            print(f"   ok    {name} pad-edge clear {clear:.2f}")
        # Paddle tip (device +Y after KiCad 3D Y-mirror) into the wall cavity.
        tip_y = y + P.SLIDE_PADDLE_Y_REL
        if tip_y < south - 0.2:
            print(f"   FAIL  {name} paddle tip y={tip_y:.2f} short of edge {south}")
            FAILURES.append(f"{name} paddle short")
        else:
            print(f"   ok    {name} paddle tip y={tip_y:.2f}")
        # Locating pegs at footprint (±1.5, SLIDE_PEG_Y_REL). Need FR4 under
        # them (drill r=0.45, ≥0.5 mm to Edge.Cuts); no south-edge notch.
        peg_y = y + P.SLIDE_PEG_Y_REL
        hole_south = peg_y + 0.45
        peg_clear = south - hole_south
        if peg_clear < 0.5 - 1e-6:
            print(f"   FAIL  {name} peg land clear {peg_clear:.2f} < 0.5 "
                  f"(peg at y={peg_y}, edge {south})")
            FAILURES.append(f"{name} peg land")
        else:
            print(f"   ok    {name} peg land clear {peg_clear:.2f}")
        if P.SLIDE_NOTCH_D > 1e-6 and peg_y > south - P.SLIDE_NOTCH_D - 1e-6:
            print(f"   FAIL  {name} peg y={peg_y} falls inside notch "
                  f"(edge-{P.SLIDE_NOTCH_D}={south - P.SLIDE_NOTCH_D})")
            FAILURES.append(f"{name} peg in notch")

    # Seated tip: fork pocket (into the cavity) must cover the STEP actuator.
    import slide_tip
    need_y = P.SLIDE_ACTUATOR_LEN - 0.05
    for name, sx, sy in (
        ("POWER", P.POWER_SW_X, P.POWER_SW_Y),
        ("MUTE", P.MUTE_SW_X, P.MUTE_SW_Y),
    ):
        pk = slide_tip.tip_pocket_aabb(sx)
        p_south = sy + P.SLIDE_PADDLE_Y_REL
        p_north = p_south - P.SLIDE_ACTUATOR_LEN
        overlap = max(0.0, min(p_south, pk["y1"]) - max(p_north, pk["y0"]))
        if overlap < need_y:
            print(f"   FAIL  {name} pocket∩paddle Y overlap {overlap:.2f} < {need_y} "
                  f"(pocket [{pk['y0']:.2f},{pk['y1']:.2f}] "
                  f"paddle [{p_north:.2f},{p_south:.2f}])")
            FAILURES.append(f"{name} pocket Y")
        else:
            print(f"   ok    {name} pocket∩paddle Y overlap {overlap:.2f} mm")

    if not (0.6 - 1e-6 <= P.TIP_PROUD <= 1.0 + 1e-6):
        print(f"   FAIL  TIP_PROUD {P.TIP_PROUD} not in [0.6, 1.0]")
        FAILURES.append("TIP_PROUD")
    else:
        print(f"   ok    TIP_PROUD {P.TIP_PROUD}")

    # Slot/tip Z centered above PCB front.
    # Device z: PCB front = -PCB_FRONT_Z; "above" means less negative (toward face).
    z_center = -(P.PCB_FRONT_Z - P.SLIDE_ACTUATOR_Z_ABOVE_PCB)
    pcb_front = -P.PCB_FRONT_Z
    if z_center <= pcb_front + 1e-6:
        print(f"   FAIL  tip Z center {z_center} not above PCB front {pcb_front}")
        FAILURES.append("tip Z")
    else:
        print(f"   ok    tip Z center {z_center:.2f} (PCB front {pcb_front:.2f})")
    # Tip pocket vs PCM12 actuator Z (STEP band mid/h from params).
    act_h = P.SLIDE_ACTUATOR_H
    pad_lo = pcb_front + (P.SLIDE_ACTUATOR_Z_ABOVE_PCB - act_h / 2)
    pad_hi = pcb_front + (P.SLIDE_ACTUATOR_Z_ABOVE_PCB + act_h / 2)
    pocket_h = P.SLIDE_ACTUATOR_H + P.TIP_POCKET_PLAY
    pk_lo, pk_hi = z_center - pocket_h / 2, z_center + pocket_h / 2
    overlap = max(0.0, min(pk_hi, pad_hi) - max(pk_lo, pad_lo))
    if overlap + 1e-6 < act_h - 0.05:
        print(f"   FAIL  tip pocket vs paddle Z overlap {overlap:.2f} "
              f"(want ~{act_h:.2f}; act_z={P.SLIDE_ACTUATOR_Z_ABOVE_PCB})")
        FAILURES.append("tip pocket Z")
    else:
        print(f"   ok    tip pocket vs paddle Z overlap {overlap:.2f} mm")
    if abs(P.SLIDE_ACTUATOR_Z_ABOVE_PCB - 0.80) > 0.05:
        print(f"   FAIL  SLIDE_ACTUATOR_Z_ABOVE_PCB "
              f"{P.SLIDE_ACTUATOR_Z_ABOVE_PCB} != PCM12 STEP mid 0.80")
        FAILURES.append("actuator Z sync")
    else:
        print(f"   ok    actuator Z sync {P.SLIDE_ACTUATOR_Z_ABOVE_PCB:.2f}")
    if abs(P.SLIDE_PADDLE_Y_REL - 3.13) > 0.05:
        print(f"   FAIL  SLIDE_PADDLE_Y_REL {P.SLIDE_PADDLE_Y_REL} "
              f"!= PCM12 STEP tip 3.13")
        FAILURES.append("paddle Y sync")
    else:
        print(f"   ok    paddle Y sync {P.SLIDE_PADDLE_Y_REL:.2f}")
    if abs(P.SLIDE_ACTUATOR_X_REL - (-0.58)) > 0.05:
        print(f"   FAIL  SLIDE_ACTUATOR_X_REL {P.SLIDE_ACTUATOR_X_REL} "
              f"!= PCM12 STEP mid -0.58")
        FAILURES.append("actuator X sync")
    else:
        print(f"   ok    actuator X offset {P.SLIDE_ACTUATOR_X_REL:.2f}")
    # Tip (dome + fork) and letterbox share the nub centre, not SW_X.
    for name, sx, sy in (
        ("POWER", P.POWER_SW_X, P.POWER_SW_Y),
        ("MUTE", P.MUTE_SW_X, P.MUTE_SW_Y),
    ):
        site = slide_tip.tip_site_x(sx)
        nub = sx + P.SLIDE_ACTUATOR_X_REL
        if abs(site - nub) > 1e-6:
            print(f"   FAIL  {name} tip site {site} != nub {nub}")
            FAILURES.append(f"{name} tip site")
        else:
            print(f"   ok    {name} tip/dome centred on nub x={site:.2f}")
        pk = slide_tip.tip_pocket_aabb(sx)
        ax0 = nub - P.SLIDE_ACTUATOR_W / 2
        ax1 = nub + P.SLIDE_ACTUATOR_W / 2
        ay1 = sy + P.SLIDE_PADDLE_Y_REL
        ay0 = ay1 - P.SLIDE_ACTUATOR_LEN
        az0 = pcb_front + (P.SLIDE_ACTUATOR_Z_ABOVE_PCB - P.SLIDE_ACTUATOR_H / 2)
        az1 = pcb_front + (P.SLIDE_ACTUATOR_Z_ABOVE_PCB + P.SLIDE_ACTUATOR_H / 2)

        def _ov(a0, a1, b0, b1):
            return max(0.0, min(a1, b1) - max(a0, b0))

        ox = _ov(ax0, ax1, pk["x0"], pk["x1"])
        oy = _ov(ay0, ay1, pk["y0"], pk["y1"])
        oz = _ov(az0, az1, pk["z0"], pk["z1"])
        need_x = P.SLIDE_ACTUATOR_W - 0.05
        need_y = P.SLIDE_ACTUATOR_LEN - 0.05
        need_z = P.SLIDE_ACTUATOR_H - 0.05
        if ox < need_x or oy < need_y or oz < need_z:
            print(f"   FAIL  {name} STEP∩pocket "
                  f"X={ox:.2f}/{need_x:.2f} Y={oy:.2f}/{need_y:.2f} "
                  f"Z={oz:.2f}/{need_z:.2f}")
            FAILURES.append(f"{name} STEP pocket")
        else:
            print(f"   ok    {name} STEP∩pocket "
                  f"X={ox:.2f} Y={oy:.2f} Z={oz:.2f}")

    # Inside install: face must pass through the letterbox; flange stays in.
    face_need_x = P.TIP_SLOT_X - 2 * P.TIP_NECK_CLEAR
    face_need_z = P.TIP_SLOT_Z - 2 * P.TIP_NECK_CLEAR
    if P.TIP_FACE_X > face_need_x + 1e-6:
        print(f"   FAIL  TIP_FACE_X {P.TIP_FACE_X} > insertable {face_need_x} "
              f"(slot {P.TIP_SLOT_X})")
        FAILURES.append("tip face insert X")
    else:
        print(f"   ok    face fits slot in X "
              f"({P.TIP_FACE_X:.2f} <= {face_need_x:.2f})")
    if P.TIP_FACE_Z > face_need_z + 1e-6:
        print(f"   FAIL  TIP_FACE_Z {P.TIP_FACE_Z} > insertable {face_need_z} "
              f"(slot {P.TIP_SLOT_Z})")
        FAILURES.append("tip face insert Z")
    else:
        print(f"   ok    face fits slot in Z "
              f"({P.TIP_FACE_Z:.2f} <= {face_need_z:.2f})")
    # Dome tip: retainer flange only needs to be wider than the slot (captive),
    # not to cover slot+travel like the old T-cap.
    if P.TIP_FACE_X > P.TIP_NECK_X + 0.05:
        print(f"   FAIL  dome/face {P.TIP_FACE_X} >> neck {P.TIP_NECK_X} "
              f"(want dome tip, not wide T-face)")
        FAILURES.append("tip dome not T")
    else:
        print(f"   ok    dome width {P.TIP_FACE_X:.2f} ≈ neck {P.TIP_NECK_X:.2f}")
    if P.TIP_NECK_X + P.TIP_TRAVEL + 2 * P.TIP_SLACK > P.TIP_SLOT_X + 1e-6:
        print(f"   FAIL  neck+travel does not fit TIP_SLOT_X {P.TIP_SLOT_X}")
        FAILURES.append("tip neck travel")
    else:
        print(f"   ok    neck {P.TIP_NECK_X:.2f} + travel fits slot {P.TIP_SLOT_X:.2f}")
    # T-slot captivity: flange wider than outer neck slot in Z (no travel axis).
    if P.TIP_FLANGE_Z <= P.TIP_SLOT_Z + 1e-6:
        print(f"   FAIL  flange Z {P.TIP_FLANGE_Z} not > slot Z {P.TIP_SLOT_Z}")
        FAILURES.append("tip flange Z")
    else:
        print(f"   ok    flange Z {P.TIP_FLANGE_Z:.2f} > slot Z {P.TIP_SLOT_Z:.2f}")
    if P.TIP_CHAMBER_Z <= P.TIP_FLANGE_Z + 1e-6:
        print(f"   FAIL  chamber Z {P.TIP_CHAMBER_Z} not > flange Z {P.TIP_FLANGE_Z}")
        FAILURES.append("tip chamber Z")
    else:
        print(f"   ok    chamber Z {P.TIP_CHAMBER_Z:.2f} > flange Z {P.TIP_FLANGE_Z:.2f}")
    if P.TIP_FLANGE_X <= P.TIP_SLOT_X + 1e-6:
        print(f"   FAIL  flange X {P.TIP_FLANGE_X} not > slot X {P.TIP_SLOT_X}")
        FAILURES.append("tip flange X")
    else:
        print(f"   ok    flange X {P.TIP_FLANGE_X:.2f} > slot X {P.TIP_SLOT_X:.2f}")
    if P.TIP_RAIL_T >= P.WALL - 1e-6:
        print(f"   FAIL  TIP_RAIL_T {P.TIP_RAIL_T} leaves no neck in WALL {P.WALL}")
        FAILURES.append("tip rail vs wall")
    else:
        print(f"   ok    neck length {P.WALL - P.TIP_RAIL_T:.2f} in WALL {P.WALL}")

    check("SLIDE_FP", P.SLIDE_FP_NAME, "SW_SPDT_PCM12", 0)


def check_skqg_stack():
    print("\nskqg stack (params)")
    check("TACT_H", P.TACT_H, 1.5, 0.001)
    check("TACT_TRAVEL", P.TACT_TRAVEL, 0.25, 0.001)
    check("TACT_FORCE_N", P.TACT_FORCE_N, 1.57, 0.001)
    check("PCB_FRONT_Z", P.PCB_FRONT_Z, 4.5, 0.001)
    check("PCB_T", P.PCB_T, 1.6, 0.001)
    check("LOWER_ZONE_T", P.LOWER_ZONE_T, 13.3, 0.02)
    check("BODY_T", P.BODY_T, 13.3, 0.02)
    check("LID_T", P.LID_T, 6.0, 0.02)
    check("HARD_STOP_AT", P.HARD_STOP_AT, 0.35, 0.001)
    if P.HARD_STOP_AT <= P.TACT_TRAVEL:
        print("   FAIL  HARD_STOP_AT must be > TACT_TRAVEL")
        FAILURES.append("HARD_STOP_AT <= travel")
    else:
        print(f"   PASS  hard-stop overtravel "
              f"{P.HARD_STOP_AT - P.TACT_TRAVEL:.3f} mm")


def check_connector_pocket():
    """B.Cu JST anchors: clear cell fence and board outline. No driver XY keepout."""
    print("\nB.Cu connector pocket (params)")
    ok_side = getattr(P, "CONN_SIDE", None) == "B.Cu"
    print(f"   {'PASS' if ok_side else 'FAIL'}  CONN_SIDE == B.Cu "
          f"(got {getattr(P, 'CONN_SIDE', None)!r})")
    if not ok_side:
        FAILURES.append("CONN_SIDE")
    cell_x = P.BATT_X + P.CELL_W + P.BATT_CLEAR + 1.0
    x_lo, x_hi = P.PCB_X + 1.0, P.PCB_X + P.PCB_W - 1.0
    y_lo, y_hi = P.PCB_Y + 1.0, P.PCB_Y + P.PCB_H - 1.0
    sites = (
        ("CONN_I2C", P.CONN_I2C),
        ("CONN_EXP", P.CONN_EXP),
        ("CONN_BAT_IN", P.CONN_BAT_IN),
        ("CONN_BAT_OUT", P.CONN_BAT_OUT),
    )
    for name, (x, y) in sites:
        ok = (x > cell_x and x_lo <= x <= x_hi and y_lo <= y <= y_hi)
        print(f"   {'PASS' if ok else 'FAIL'}  {name} ({x:.1f}, {y:.1f}) "
              f"cell_x>{cell_x:.1f} board [{x_lo:.1f}..{x_hi:.1f}]×"
              f"[{y_lo:.1f}..{y_hi:.1f}]")
        if not ok:
            FAILURES.append(name)
    # The display module carries sockets flush with its edge just north of
    # the board, so courtyards keep CONN_NORTH_CLEAR off the north edge.
    import joints
    halfs = {"CONN_I2C": 4.95, "CONN_EXP": 4.95,
             "CONN_BAT_IN": 3.7, "CONN_BAT_OUT": 3.7}  # GH courtyard half-w
    for name, (x, y) in sites:
        clr = (y - 2.4) - P.PCB_Y
        ok = clr + 1e-9 >= P.CONN_NORTH_CLEAR
        print(f"   {'PASS' if ok else 'FAIL'}  {name} courtyard {clr:.1f} mm "
              f"off north edge (module sockets; want >= {P.CONN_NORTH_CLEAR})")
        if not ok:
            FAILURES.append(f"{name} north edge")
    # Screw lands are solid from the floor to the board back — same z-space
    # as the B.Cu connector bodies. Courtyards must clear every land.
    land_r = max(j.land_r for j in joints.back_joints() if j.kind == "pcb")
    for name, (x, y) in sites:
        hw, hh = halfs[name], 2.4
        worst = None
        for bx, by in P.EXTRA_BOSSES:
            gx = max(abs(x - bx) - hw - land_r, 0)
            gy = max(abs(y - by) - hh - land_r, 0)
            g = max(gx, gy)
            worst = g if worst is None else min(worst, g)
        ok = worst > 0
        print(f"   {'PASS' if ok else 'FAIL'}  {name} courtyard clears screw "
              f"lands by {worst:.2f} mm")
        if not ok:
            FAILURES.append(f"{name} vs screw land")
    # Plug clearance: GH courtyard is 6.4 mm in the cable axis; need ≥9 mm
    # centre pitch so a housing can engage. Same-row X neighbours likewise.
    min_pitch = 9.0
    for i in range(len(sites)):
        for j in range(i + 1, len(sites)):
            n1, (x1, y1) = sites[i]
            n2, (x2, y2) = sites[j]
            d = ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5
            ok = d + 1e-9 >= min_pitch
            print(f"   {'PASS' if ok else 'FAIL'}  {n1}–{n2} pitch {d:.1f} "
                  f"(want >= {min_pitch:.1f})")
            if not ok:
                FAILURES.append(f"pitch {n1}-{n2}")


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
            boxes.append((name, f"KO{i}",
                          _local_box_to_board(cx, cy, rot, x0, x1, y0, y1)))
        for i, (px, py, w, h) in enumerate(SKQG_PADS):
            boxes.append((name, f"PAD{i}", _local_box_to_board(
                cx, cy, rot, px - w / 2, px + w / 2, py - h / 2, py + h / 2)))
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


def check_shoulder_params():
    """Inequalities that can fail — not identities of PCB_FRONT_Z."""
    print("\nshoulder params")
    need = (P.CAP_FLANGE_T + P.HARD_STOP_AT + P.SHOULDER_FLAT_T
            + P.SHOULDER_RAMP_T)
    ok = P.COLLAR_DEPTH + 1e-9 >= need
    print(f"   {'PASS' if ok else 'FAIL'}  COLLAR_DEPTH {P.COLLAR_DEPTH:.2f} "
          f">= shoulder stack {need:.2f}")
    if not ok:
        FAILURES.append("COLLAR_DEPTH")
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
    """Square SKQG body must clear every collar — measured on built solids.

    Same class of bug as EVQ-P0 vs the menu pill (−0.40 mm): a comment saying
    the bore clears is worthless. Build each collar via button_station, place a
    □TACT_OUTLINE × TACT_H body on the PCB plane, and require zero intersection
    with collar material (volumes match before/after cut).
    """
    import cadquery as cq
    print("\nskqg body vs collar bore (measured solids)")
    stations = [
        ("dir", dict(hole_d=P.DIR_CAP_D, keyed=True)),
        ("ab", dict(hole_d=P.AB_CAP_D, keyed=False)),
        ("reset", dict(hole_d=P.RESET_CAP_D, keyed=True)),
        ("menu", dict(pill=True)),
    ]
    body = (cq.Workplane("XY")
            .box(P.TACT_OUTLINE, P.TACT_OUTLINE, P.TACT_H, centered=(True, True, False))
            .translate((0, 0, -P.PCB_FRONT_Z)))
    v0 = body.val().Volume()
    for name, kwargs in stations:
        add, _ = shell_front.button_station(**kwargs)
        left = body.cut(add)
        lost = v0 - left.val().Volume()
        ok = lost < 1e-3
        print(f"   {'PASS' if ok else 'FAIL'}  {name}: body∩collar volume "
              f"{lost:.4f} mm³ (want ~0)")
        if not ok:
            FAILURES.append(f"bore {name}")


def check_shoulder_in_coupon_stl(tri):
    """Shoulder flat present in exported coupon — measured, not assumed."""
    print("\nshoulder in coupon_plate.stl")
    z_want = -(P.FACE_T + P.CAP_FLANGE_T + P.HARD_STOP_AT)
    # coupon.LADDER_X[2], ROW1_Y (plate is centered on origin in coupon.py)
    cx, cy = 0.0, 11.0
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


def main():
    check_edge_slide_tips()
    check_skqg_stack()
    check_connector_pocket()
    check_skqg_keepouts()
    check_shoulder_params()
    check_skqg_fits_bore()
    path = os.path.join(OUT, "coupon_plate.stl")
    if not os.path.exists(path):
        sys.exit("coupon_plate.stl missing -- run coupon.py first")

    tri = load_tris(path)
    check_shoulder_in_coupon_stl(tri)
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
    check_orientation()
    check_interior_fit()
    check_pcb_mounts()
    check_pcb_support()
    check_pcb_posts_vs_collars()
    check_captive_nut_traps()
    check_driver_vs_collars()
    check_grille_vs_driver()
    check_cap_fits_collar()
    check_driver_bond()
    check_back_roll()
    check_module_outline()
    check_display_plug()
    check_split_lap()
    check_usb_port()
    check_driver_stack()
    check_back_shell()
    check_screw_joints()
    check_battery_keepout()

    print()
    if FAILURES:
        sys.exit(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    print("all checks passed")


if __name__ == "__main__":
    main()
