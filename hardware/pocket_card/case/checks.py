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
    rib_y = (P.PCB_RIB_Y0 + P.PCB_RIB_Y1) / 2
    worst = 0.0
    for nm, bx, by in (("directions", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY),
                       ("Undo", P.UNDO_X, P.UNDO_Y), ("Action", P.ACT_X, P.ACT_Y),
                       ("Reset", P.RESET_X, P.RESET_Y), ("Menu", P.MENU_X, P.MENU_Y)):
        span = min([abs(bx - s) for s in supports] +
                   ([abs(by - rib_y)] if P.PCB_RIB_X0 <= bx <= P.PCB_RIB_X1 else []))
        d = P.TACT_FORCE_N * span ** 3 / (3 * E * I)
        worst = max(worst, d)
        print(f"      {nm:11} span {span:5.1f} mm   deflection {d:.3f} mm")
    ok = worst < P.TACT_TRAVEL * 0.6
    print(f"   {'PASS' if ok else 'FAIL'}  worst deflection {worst:.3f} mm "
          f"(want < {P.TACT_TRAVEL * 0.6:.3f}, i.e. 60% of switch travel)")
    if not ok:
        FAILURES.append("board too flexible")

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
    check_orientation()
    check_interior_fit()
    check_pcb_mounts()
    check_pcb_support()
    check_pcb_posts_vs_collars()
    check_back_shell()

    print()
    if FAILURES:
        sys.exit(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
    print("all checks passed")


if __name__ == "__main__":
    main()
