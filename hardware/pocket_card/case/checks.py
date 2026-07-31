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
    """The pillars rise through the button cavity, so they must miss the collars."""
    print("\nPCB pillars vs button collars")
    collars = [("dir up", P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D),
               ("dir down", P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D),
               ("dir left", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D),
               ("dir right", P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D),
               ("Undo", P.UNDO_X, P.UNDO_Y, P.AB_CAP_D),
               ("Action", P.ACT_X, P.ACT_Y, P.AB_CAP_D),
               ("Reset", P.RESET_X, P.RESET_Y, P.RESET_CAP_D)]
    worst = 99.0
    for px, py in P.PCB_MOUNTS:
        for nm, cx, cy, d in collars:
            r = d / 2 + P.CAP_FLANGE_OS + P.COLLAR_CLEAR + 1.2
            gap = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5 - r - P.PCB_SHOULDER_D / 2
            if gap < worst:
                worst, which = gap, "(%.1f,%.1f) vs %s" % (px, py, nm)
    ok = worst >= 0
    print(f"   {'PASS' if ok else 'FAIL'}  tightest {which} {worst:+.2f} mm")
    if not ok:
        FAILURES.append("PCB pillar fouls a collar")


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
    lower = [b for b in P.EXTRA_BOSSES if b[1] > P.CONTROL_BAND_TOP]
    ok = len(lower) >= 2
    print(f"   {'PASS' if ok else 'FAIL'}  {'lower-half fixings':18} {len(lower)} boss(es) below y={P.CONTROL_BAND_TOP}")
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
    path = os.path.join(OUT, "shell_back.stl")
    if not os.path.exists(path):
        return
    print("\nback shell")
    tri = load_tris(path)
    zmin = float(tri[:, :, 2].min())
    ok = zmin >= -P.BODY_T - 0.02
    print(f"   {'PASS' if ok else 'FAIL'}  nothing proud of the back    "
          f"min z = {zmin:.2f} (outer surface {-P.BODY_T:.2f})")
    if not ok:
        FAILURES.append("feature proud of back")

    ok = 3.0 < P.MOUNT_HOLE_D
    print(f"   {'PASS' if ok else 'FAIL'}  post fits the module hole   "
          f"Ø3.0 through Ø{P.MOUNT_HOLE_D}")
    if not ok:
        FAILURES.append("post too fat for module hole")

    pcb_front = P.MODULE_Z + P.MOD_FRONT_STACK - 1.6
    pcb_back = P.MODULE_Z + P.MOD_FRONT_STACK
    print(f"   INFO  module clamped between {pcb_front:.2f} (front-shell shoulder) "
          f"and {pcb_back:.2f} (lid rib)")


def check(name, got, want, tol):
    ok = abs(got - want) <= tol
    print(f"   {'PASS' if ok else 'FAIL'}  {name:34} {got:8.3f}  (want {want:.3f} +/- {tol})")
    if not ok:
        FAILURES.append(name)


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
    check_driver_vs_collars()
    check_grille_vs_driver()
    check_cap_fits_collar()
    check_driver_bond()
    check_back_shell()

    print()
    if FAILURES:
        sys.exit(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    print("all checks passed")


if __name__ == "__main__":
    main()
