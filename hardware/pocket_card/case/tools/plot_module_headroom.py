"""Headroom between the display module's rear face and the back tray.

Everything the module carries on its back — connectors, the TF slot, the
shielding can — has to live in the gap between the module PCB's rear plane and
whatever the tray puts underneath. That gap is not one number: the back roll
lifts the tray's inner surface near the perimeter, which is exactly where the
module's wire-to-board connectors sit.

Run:  .venv/bin/python tools/plot_module_headroom.py
"""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import params as P            # noqa: E402
import shell_back             # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "out", "module_headroom.png")

REAR = -(P.MODULE_Z + P.MOD_FRONT_STACK)      # -7.50, module PCB rear plane

# Rear connectors, read off the §5.1 outline drawing's back view. That view is
# MIRRORED against the front (the MIC sits top-right on the front and top-left
# on the back), so its left-hand edge is the module's y-max side here.
#   along the 86 axis:  x = 88 - v, v measured from the drawing's top edge
#   dimension chains :  left 18.25 / 17.85 / 13.55, right 35.03 / 15.97 / 11.82
#
# Only BAT is a vertical part. The rest are side-entry: they stand 3.5 off the
# board (MEASURED on the module) and their wires leave horizontally, so they
# never wanted the mated height a vertical connector does.
CONNECTORS = [
    #  name        x       y     stack height, mm
    ("BAT",      25.18,   5.1,   5.70),   # PicoBlade 53398-0271 + 51021 housing
    ("UART",     37.00,   5.1,   3.50),   # side-entry
    ("SPEAKER",  38.35,  49.9,   3.50),
    ("I2C",      51.90,  49.9,   3.50),
    ("IO hdr",   69.75,  49.9,   3.50),
]


def headroom(nx=180, ny=110):
    """Depth from the module's rear plane to the first thing below it."""
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector

    back = shell_back.to_model_space(shell_back.build_back())
    isec = IntCurvesFace_ShapeIntersector()
    isec.Load(back.val().wrapped, 1e-6)

    xs = np.linspace(P.MOD_X, P.MOD_X + P.MOD_W, nx)
    ys = np.linspace(P.MOD_Y, P.MOD_Y + P.MOD_H, ny)
    room = np.full((ny, nx), np.nan)
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            isec.Perform(gp_Lin(gp_Pnt(float(x), float(y), REAR),
                                gp_Dir(0.0, 0.0, -1.0)), 0.0, 20.0)
            if isec.IsDone() and isec.NbPnt() > 0:
                top = max(isec.Pnt(k).Z() for k in range(1, isec.NbPnt() + 1))
                room[j, i] = REAR - top
    return xs, ys, room


def main():
    xs, ys, room = headroom()
    need = 5.70

    fig, ax = plt.subplots(figsize=(11.5, 7.4))
    im = ax.imshow(room, origin="upper", cmap="RdYlGn", vmin=0.0, vmax=6.0,
                   extent=(xs[0], xs[-1], ys[-1], ys[0]),
                   interpolation="bilinear")
    cs = ax.contour(xs, ys, room, levels=[4.70, need], colors=["#7c2d12", "#000"],
                    linewidths=[1.0, 1.6])
    ax.clabel(cs, fmt={4.70: "4.70 bare header", need: "5.70 mated"}, fontsize=7)
    fig.colorbar(im, ax=ax, shrink=0.8, label="headroom below the module PCB (mm)")

    for name, x, y, h in CONNECTORS:
        i = int(np.clip(np.searchsorted(xs, x), 0, len(xs) - 1))
        j = int(np.clip(np.searchsorted(ys, y), 0, len(ys) - 1))
        r = room[j, i]
        short = h - r
        ok = short <= 0
        ax.plot(x, y, "o", ms=8, mfc="none", mew=1.8,
                mec="#065f46" if ok else "#7f1d1d")
        ax.annotate(f"{name}\n{r:.2f} have / {h:.2f} need"
                    + ("" if ok else f"\nshort {short:.2f}"),
                    xy=(x, y), xytext=(x, y + (12 if y < 25 else -14)),
                    ha="center", fontsize=7.5,
                    color="#065f46" if ok else "#7f1d1d",
                    arrowprops=dict(arrowstyle="->", lw=0.9,
                                    color="#065f46" if ok else "#7f1d1d"))

    ax.set_xlim(xs[0], xs[-1])
    ax.set_ylim(ys[-1], ys[0])
    ax.set_aspect("equal")
    ax.set_xlabel("x (mm)", fontsize=9)
    ax.set_ylabel("y (mm)", fontsize=9)
    ax.set_title("headroom behind the display module\n"
                 f"module PCB rear at z = {REAR:.2f}, tray floor inner at "
                 f"z = {shell_back.FLOOR_Z:.2f}", fontsize=11)
    fig.tight_layout()
    fig.savefig(OUT, dpi=160)
    print(f"wrote {OUT}")

    finite = room[np.isfinite(room)]
    print(f"headroom over the module footprint: {finite.min():.2f} .. "
          f"{finite.max():.2f} mm  (flat-floor value "
          f"{REAR - shell_back.FLOOR_Z:.2f})")
    for name, x, y, h in CONNECTORS:
        i = int(np.clip(np.searchsorted(xs, x), 0, len(xs) - 1))
        j = int(np.clip(np.searchsorted(ys, y), 0, len(ys) - 1))
        print(f"   {name:8s} at ({x:5.2f}, {y:4.1f})  have {room[j, i]:.2f}  "
              f"need {h:.2f}  -> short {h - room[j, i]:+.2f}")


if __name__ == "__main__":
    main()
