"""Build a full order: one case, plus cap sets at several clearances.

Rationale: with a two-week turnaround the shipping cycle costs far more than
the parts, so the order should answer as many questions as it can in one go.

Only the CAPS vary. Both clearances are cap-versus-shell, so holding the shell
fixed and printing several cap sizes isolates the same variable at a fraction
of the volume -- and an oversized cap can be sanded down, whereas a too-small
bore cannot be opened.

Each cap crown is engraved with its variant index. The manifest below maps
index -> clearance; keep it with the parts.

Run:  .venv/bin/python build_variants.py
"""
import os

import cadquery as cq

import params as P
import coupon
import shell_front
import shell_back

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "order")
os.makedirs(OUT, exist_ok=True)

# JLC quote about +/-0.2 mm on resin, so steps finer than that are below the
# noise. This span means at least one variant should land in a usable fit even
# if the process runs a long way oversize or undersize.
VARIANTS = (0.10, 0.20, 0.30, 0.40)

# One physical set: four directions, Undo, Action, Reset, Menu.
CAPS = [("dir", P.DIR_CAP_D, False)] * 4 + [
    ("undo", P.AB_CAP_D, False),
    ("action", P.AB_CAP_D, False),
    ("reset", P.RESET_CAP_D, False),
    ("menu", None, True),
]

GRID = 18.0          # centres; the largest flange is Ø13.2
SPRUE_W = 1.5
COLS = 4

# Same stations as shell_front.build() — keep in lockstep with that list.
STATIONS = [
    (P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D, False),   # up
    (P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D, False),   # down
    (P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),   # left
    (P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),   # right
    (P.UNDO_X, P.UNDO_Y, P.AB_CAP_D, False),
    (P.ACT_X, P.ACT_Y, P.AB_CAP_D, False),
    (P.RESET_X, P.RESET_Y, P.RESET_CAP_D, False),
    (P.MENU_X, P.MENU_Y, None, True),
]


def cap_set(clr, vi):
    """All eight caps for one variant, joined by sprues into a single solid.

    JLCPCB caps an order at 10 3D files, so the sets have to be merged. They are
    sprued rather than left as loose bodies in one STL because a file containing
    disjoint solids is at the mercy of how the fab chooses to interpret it, and
    a rejection costs a fortnight.

    Snip the sprues with cutters; they meet the caps at the flange, which is
    hidden inside the shell.
    """
    z0 = -(P.FACE_T + P.CAP_FLANGE_T)
    out = cq.Workplane("XY")
    pos = []
    for i, (name, dia, pill) in enumerate(CAPS):
        cx, cy = (i % COLS) * GRID, (i // COLS) * GRID
        pos.append((cx, cy))
        shape = coupon.cap(dia, clr, pill=pill)
        if not pill:
            mark = (cq.Workplane("XY").text(str(vi), 3.0, 1.0, combine=False)
                    .translate((0, 0, P.CAP_PROUD - 0.5)))
            shape = shape.cut(mark)
        out = out.union(shape.translate((cx, cy, 0)))

    for i, (ax, ay) in enumerate(pos):
        for bx, by in pos[i + 1:]:
            span = abs(ax - bx) + abs(ay - by)
            if abs(span - GRID) > 1e-6:
                continue                     # only join immediate neighbours
            out = out.union(
                cq.Workplane("XY")
                .box(abs(bx - ax) or SPRUE_W, abs(by - ay) or SPRUE_W,
                     P.CAP_FLANGE_T, centered=(True, True, False))
                .translate(((ax + bx) / 2, (ay + by) / 2, z0)))
    return out


def vol(shape):
    return shape.val().Volume() / 1000.0      # mm^3 -> cm^3


def shell_with_caps(clr):
    """Front shell with all eight caps seated at face stations.

    Preview / fit-check only — not a fab part. Uses the same clearance as the
    production FIT_CLEAR (or whatever clr is passed) so the crowns sit in the
    collars the way a built unit would.
    """
    front = shell_front.build()
    asm = front
    for x, y, d, pill in STATIONS:
        shape = coupon.cap(d, clr, pill=pill)
        if pill and P.MENU_ANGLE:
            shape = shape.rotate((0, 0, 0), (0, 0, 1), -P.MENU_ANGLE)
        # Caps are built in device coords; shell_front.build() already returns
        # model space, so each cap needs the same mirror/translate.
        placed = shell_front.to_model_space(shape.translate((x, y, 0)))
        asm = asm.union(placed)
    return asm


def main():
    total = 0.0
    lines = []

    front = shell_front.build()
    cq.exporters.export(front, os.path.join(OUT, "shell_front.stl"))
    v = vol(front)
    total += v
    lines.append(f"shell_front.stl                 {v:6.1f} cm3   x1")

    back = shell_back.build_back()
    cq.exporters.export(back, os.path.join(OUT, "shell_back.stl"))
    v = vol(back)
    total += v
    lines.append(f"shell_back.stl                  {v:6.1f} cm3   x1")

    # Assembled preview at production clearance (not counted in fab volume).
    P.CAP_CLEAR = P.COLLAR_CLEAR = P.FIT_CLEAR
    assembled = shell_with_caps(P.FIT_CLEAR)
    asm_path = os.path.join(OUT, "shell_front_with_caps.stl")
    cq.exporters.export(assembled, asm_path)
    lines.append(
        f"shell_front_with_caps.stl       {vol(assembled):6.1f} cm3   "
        f"preview @ clear {P.FIT_CLEAR:.2f} (not for fab)")

    for vi, clr in enumerate(VARIANTS, start=1):
        P.CAP_CLEAR = clr
        P.COLLAR_CLEAR = clr
        st = cap_set(clr, vi)
        fn = f"capset_v{vi}.stl"
        cq.exporters.export(st, os.path.join(OUT, fn))
        v = vol(st)
        total += v
        lines.append(f"{fn:32}{v:6.2f} cm3   x1   clearance {clr:.2f}  "
                     f"({len(CAPS)} caps, sprued)")

    # restore, so a later import does not inherit the last variant
    P.CAP_CLEAR = P.COLLAR_CLEAR = P.FIT_CLEAR

    print("\n".join(lines))
    print(f"\ntotal fab volume {total:.1f} cm3  (excludes assembly preview)")
    print("\nmanifest — engraved digit on the crown:")
    for vi, clr in enumerate(VARIANTS, start=1):
        print(f"   {vi}  ->  {clr:.2f} mm clearance")
    print(f"\n{2 + len(VARIANTS)} fab files + 1 preview (JLCPCB allows 10). "
          f"Quantity 1 of each fab file.")
    print("Each set holds all eight caps sprued together -- snip at the flanges.")
    print("The menu pill carries no digit; its shape is unique.")
    print("shell_front_with_caps.stl = front shell with caps seated in place.")


if __name__ == "__main__":
    main()
