"""Free-space (occupancy) report for the closed enclosure.

Answers "is there empty interior here that a boss/rib/fill could use" before
layout changes. Column raycasts against the real solids (envelope, front
shell, back shell), then subtract analytic component keepouts.

Everything is computed in MODEL space (the space of the exported STLs):
x right, y up (layout y mirrored), z 0 at the face going negative into the
body. Layout-space component boxes are mirrored here.

Outputs:
  out/free_space_depth.pgm   max contiguous free depth per column (16-bit-ish)
  console summary            largest connected free pockets with bboxes

Run:  .venv/bin/python free_space.py            (~1 min: builds both shells)
"""
import os

import params as P
import shell_back
import shell_front
import side_arc

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

STEP = 1.5          # column grid pitch (mm)
MIN_DEPTH = 2.0     # a column counts as 'free' if a contiguous span >= this


def _intersector(shape):
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
    isec = IntCurvesFace_ShapeIntersector()
    isec.Load(shape.val().wrapped, 1e-6)
    return isec


def _column_intervals(isec, x, y):
    """Sorted (z0, z1) inside-intervals of a solid along the +Z ray at (x,y)."""
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    isec.Perform(gp_Lin(gp_Pnt(x, y, -P.BODY_T - 10.0), gp_Dir(0, 0, 1)),
                 0.0, 1e6)
    if not isec.IsDone():
        return []
    zs = sorted(isec.Pnt(i).Z() for i in range(1, isec.NbPnt() + 1))
    # collapse tangent double-hits
    dedup = []
    for z in zs:
        if not dedup or z - dedup[-1] > 1e-4:
            dedup.append(z)
    if len(dedup) % 2:      # grazing hit; drop the column rather than guess
        return None
    return [(dedup[i], dedup[i + 1]) for i in range(0, len(dedup), 2)]


def _subtract(intervals, cut0, cut1):
    """Remove [cut0, cut1] from a list of (z0, z1) intervals."""
    out = []
    for z0, z1 in intervals:
        if cut1 <= z0 or cut0 >= z1:
            out.append((z0, z1))
            continue
        if cut0 > z0:
            out.append((z0, cut0))
        if cut1 < z1:
            out.append((cut1, z1))
    return out


def _keepouts_model():
    """Component boxes in model space: (name, x0, x1, ym0, ym1, z0, z1)."""
    def mirror(y0, y1):
        return P.BODY_H - y1, P.BODY_H - y0

    boxes = []
    ym0, ym1 = mirror(P.MOD_Y, P.MOD_Y + P.MOD_H)
    boxes.append(("module", P.MOD_X, P.MOD_X + P.MOD_W, ym0, ym1,
                  -(P.MODULE_Z + P.MOD_DEPTH), -P.MODULE_Z))
    ym0, ym1 = mirror(P.PCB_Y, P.PCB_Y + P.PCB_H)
    boxes.append(("controller", P.PCB_X, P.PCB_X + P.PCB_W, ym0, ym1,
                  -(P.PCB_FRONT_Z + P.PCB_T), -P.PCB_FRONT_Z))
    ym0, ym1 = mirror(P.BATT_Y - P.BATT_CLEAR,
                      P.BATT_Y + P.CELL_H + P.BATT_CLEAR)
    z1 = -(P.PCB_FRONT_Z + P.PCB_T + P.PET_T)
    boxes.append(("cell", P.BATT_X - P.BATT_CLEAR,
                  P.BATT_X + P.CELL_W + P.BATT_CLEAR, ym0, ym1,
                  z1 - (P.CELL_T + P.CELL_SWELL), z1))
    ym0, ym1 = mirror(P.GRILLE_Y - P.DRIVER_H / 2, P.GRILLE_Y + P.DRIVER_H / 2)
    boxes.append(("driver", P.GRILLE_X - P.DRIVER_W / 2,
                  P.GRILLE_X + P.DRIVER_W / 2, ym0, ym1,
                  -(1.5 + P.DRIVER_T), -1.5))
    # Button mechanics: caps/flanges/tact between face and controller front,
    # over the control band (below the module).
    ym0, ym1 = mirror(P.CONTROL_BAND_TOP, P.BODY_H)
    boxes.append(("button stack", P.WALL, P.BODY_W - P.WALL, ym0, ym1,
                  -P.PCB_FRONT_Z, -P.FACE_T))
    return boxes


def main():
    print("building solids (envelope, front, back) ...")
    env = _intersector(shell_back.to_model_space(
        side_arc.shaped_brick(4.5, blend_seams=False)))
    front = _intersector(shell_front.build())
    back = _intersector(shell_back.build_back())
    keeps = _keepouts_model()

    nx = int(P.BODY_W / STEP) + 1
    ny = int(P.BODY_H / STEP) + 1
    depth = [[0.0] * nx for _ in range(ny)]
    free_cols = {}
    skipped = 0
    vol = 0.0

    for iy in range(ny):
        y = iy * STEP
        for ix in range(nx):
            x = ix * STEP
            inside = _column_intervals(env, x, y)
            if inside is None or not inside:
                if inside is None:
                    skipped += 1
                continue
            for solid in (front, back):
                cuts = _column_intervals(solid, x, y)
                if cuts is None:
                    inside = []
                    skipped += 1
                    break
                for c0, c1 in cuts:
                    inside = _subtract(inside, c0, c1)
            for name, bx0, bx1, by0, by1, bz0, bz1 in keeps:
                if bx0 <= x <= bx1 and by0 <= y <= by1:
                    inside = _subtract(inside, bz0, bz1)
            if not inside:
                continue
            best = max(z1 - z0 for z0, z1 in inside)
            total = sum(z1 - z0 for z0, z1 in inside)
            vol += total * STEP * STEP
            depth[iy][ix] = best
            if best >= MIN_DEPTH:
                free_cols[(ix, iy)] = inside

    # Connected components of usable columns (4-neighbour).
    seen = set()
    pockets = []
    for start in free_cols:
        if start in seen:
            continue
        stack, comp = [start], []
        seen.add(start)
        while stack:
            c = stack.pop()
            comp.append(c)
            cx, cy = c
            for n in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if n in free_cols and n not in seen:
                    seen.add(n)
                    stack.append(n)
        xs = [c[0] * STEP for c in comp]
        ys = [c[1] * STEP for c in comp]
        v = sum(sum(z1 - z0 for z0, z1 in free_cols[c]) for c in comp)
        v *= STEP * STEP
        zs0 = min(z0 for c in comp for z0, _ in free_cols[c])
        zs1 = max(z1 for c in comp for _, z1 in free_cols[c])
        pockets.append((v, min(xs), max(xs), min(ys), max(ys), zs0, zs1,
                        len(comp)))
    pockets.sort(reverse=True)

    print(f"\nfree interior volume ~{vol / 1000:.1f} cm3 "
          f"(grid {STEP} mm, {skipped} grazing columns skipped)")
    print(f"pockets with contiguous depth >= {MIN_DEPTH} mm "
          f"(model space, y up):")
    for v, x0, x1, y0, y1, z0, z1, n in pockets[:8]:
        print(f"   {v / 1000:6.2f} cm3  x[{x0:5.1f},{x1:5.1f}] "
              f"y[{y0:5.1f},{y1:5.1f}] z[{z0:6.2f},{z1:6.2f}]  ({n} cols)")

    # Depth map PGM (0..max scaled to 0..255), y flipped for image convention.
    path = os.path.join(OUT, "free_space_depth.pgm")
    dmax = max((max(row) for row in depth), default=1.0) or 1.0
    with open(path, "w") as f:
        f.write(f"P2\n{nx} {ny}\n255\n")
        for row in reversed(depth):
            f.write(" ".join(str(int(255 * d / dmax)) for d in row) + "\n")
    print(f"depth map -> {path} (white = {dmax:.1f} mm free)")


if __name__ == "__main__":
    main()
