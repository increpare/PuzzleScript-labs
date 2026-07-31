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

CAPS = [
    ("dir", P.DIR_CAP_D, False, True),
    ("undo", P.AB_CAP_D, False, False),
    ("action", P.AB_CAP_D, False, False),
    ("reset", P.RESET_CAP_D, False, True),
    ("menu", None, True, False),
]


def vol(shape):
    return shape.val().Volume() / 1000.0      # mm^3 -> cm^3


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

    for vi, clr in enumerate(VARIANTS, start=1):
        P.CAP_CLEAR = clr
        P.COLLAR_CLEAR = clr
        for name, dia, pill, keyed in CAPS:
            shape = coupon.cap(dia, clr, keyed, pill=pill)
            if not pill:
                mark = (cq.Workplane("XY").text(str(vi), 3.0, 1.0, combine=False)
                        .translate((0, 0, P.CAP_PROUD - 0.5)))
                shape = shape.cut(mark)
            qty = 4 if name == "dir" else 1
            fn = f"cap_{name}_v{vi}.stl"
            cq.exporters.export(shape, os.path.join(OUT, fn))
            v = vol(shape)
            total += v * qty
            lines.append(f"{fn:32}{v:6.2f} cm3   x{qty}   clearance {clr:.2f}")

    # restore, so a later import does not inherit the last variant
    P.CAP_CLEAR = P.COLLAR_CLEAR = P.FIT_CLEAR

    print("\n".join(lines))
    print(f"\ntotal volume {total:.1f} cm3")
    print("\nmanifest — engraved digit on the crown:")
    for vi, clr in enumerate(VARIANTS, start=1):
        print(f"   {vi}  ->  {clr:.2f} mm clearance")
    print("\nQuantities: order 4 of each cap_dir_v*, 1 of everything else.")
    print("The menu pill carries no digit -- its shape is unique.")


if __name__ == "__main__":
    main()
