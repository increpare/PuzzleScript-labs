"""Draw the USB-C port: section along the plug axis, and the aperture seen
face-on, both against the plug envelopes the spec defines.

The port is the one opening that lands on the rolled part of the shell, so a
render tells you nothing useful — you need the section to see how far the
receptacle is recessed, and the silhouette to see what the hole admits once
the roll has cut its lower edge obliquely.

Spec numbers (USB Type-C Cable and Connector Spec R2.0, Aug 2019):
  fig 3-11 sec C-C   plug shell 8.25 +/-0.03 wide x 2.40 +/-0.03 tall,
                     6.65 +/-0.10 long; overmold 12.35 max x 6.50 max
  fig 3-80           overmold face must clear the exterior surface, 0.05 min
  fig 3-81           angled exterior walls need relief cut into them; the
                     worked example is a 22 deg wall, which is what we have

Run:  .venv/bin/python tools/plot_usb_port.py
"""
import os
import sys

import cadquery as cq
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Polygon, Rectangle

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import params as P            # noqa: E402
import shell_back             # noqa: E402
import shell_front            # noqa: E402
from plot_split_joint import section_polys   # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "out", "usb_port.png")

# --- the module's receptacle -------------------------------------------------
# Dead centre of the module's 50 mm edge: the outline drawing's bottom chain
# reads 13.44 / 11.56 / 11.57 / 13.43, so the connector is at 25.00 of 50.
USB_Y = P.MOD_Y + P.MOD_H / 2
REC_W, REC_H, REC_D = 8.94, 3.26, 7.35     # 16-pin receptacle shell, outside
REC_X = P.MOD_X                            # mating datum, at the board edge
REC_Z1 = -shell_back.MOD_PCB_BACK          # -7.50, rear-mounted on the module
REC_Z0 = REC_Z1 - REC_H                    # -10.76
REC_ZC = (REC_Z0 + REC_Z1) / 2             # -9.13

PLUG_W, PLUG_H, PLUG_L = 8.25, 2.40, 6.65
MOLD_W, MOLD_H = 12.35, 6.50

# What the port would be if it were sized off the receptacle and centred on it:
# 0.23 all round on the width, top edge landing on the split by construction.
PROP_W = 9.40
PROP_Z1 = shell_back.LID_Z1                # -7.30, the seam is the top edge
PROP_Z0 = -11.00

INK = "#334155"


def aperture_mask(shell, ny=300, nz=240):
    """Where a ray along +x crosses the wall without meeting anything.

    A section cannot answer this: the wall rolls away under the port, so the
    hole's lower edge is an oblique curve that no single slice contains.
    """
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector

    isec = IntCurvesFace_ShapeIntersector()
    isec.Load(shell.val().wrapped, 1e-6)
    ys = np.linspace(USB_Y - 8.5, USB_Y + 8.5, ny)
    zs = np.linspace(-12.2, -5.6, nz)
    open_ = np.zeros((nz, ny), dtype=bool)
    for j, z in enumerate(zs):
        for i, y in enumerate(ys):
            isec.Perform(gp_Lin(gp_Pnt(-4.0, float(y), float(z)),
                                gp_Dir(1.0, 0.0, 0.0)), 0.0, 8.0)
            open_[j, i] = not (isec.IsDone() and isec.NbPnt() > 0)
    return ys, zs, open_


def arrow(ax, p0, p1, text, colour=INK, dy=0.0, fs=7):
    ax.annotate("", xy=p1, xytext=p0,
                arrowprops=dict(arrowstyle="<->", color=colour, lw=0.9))
    ax.text((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + dy, text, fontsize=fs,
            color=colour, ha="center", va="bottom")


def side_panel(ax, back, front):
    for polys, colour, label in ((section_polys(back, USB_Y), "#c2410c", "back tray"),
                                 (section_polys(front, USB_Y), "#1d4ed8", "front shell")):
        for i, p in enumerate(polys):
            ax.add_patch(Polygon(p, closed=True, facecolor=colour, alpha=0.5,
                                 edgecolor=colour, linewidth=1.1,
                                 label=label if i == 0 else None))
    ax.add_patch(Rectangle((P.MOD_X, REC_Z1), 9.5, P.MOD_PCB_T,
                           facecolor="#16a34a", alpha=0.28, edgecolor="#16a34a",
                           lw=1.0, label="module PCB"))
    ax.add_patch(Rectangle((REC_X, REC_Z0), REC_D, REC_H, facecolor="#64748b",
                           alpha=0.5, edgecolor="#334155", lw=1.1,
                           label="USB-C receptacle 8.94 x 3.26"))
    ax.add_patch(Rectangle((REC_X - PLUG_L, REC_ZC - PLUG_H / 2), PLUG_L, PLUG_H,
                           facecolor="none", edgecolor="#7c3aed", lw=1.5,
                           label="plug shell, fully seated"))
    ax.add_patch(Rectangle((REC_X - PLUG_L - 5.5, REC_ZC - MOLD_H / 2), 5.5,
                           MOLD_H, facecolor="#7c3aed", alpha=0.12,
                           edgecolor="#7c3aed", lw=1.0, ls="--",
                           label="overmold, 12.35 x 6.50 max"))

    ax.axhline(shell_back.LID_Z1, color=INK, lw=0.7, ls="--", zorder=0)
    ax.text(6.4, shell_back.LID_Z1 + 0.15, "split", fontsize=7, color=INK)
    arrow(ax, (REC_X - PLUG_L, -4.6), (0.0, -4.6), "4.60 spare", "#7c3aed", 0.12)
    ax.plot([REC_X - PLUG_L, REC_X - PLUG_L], [-5.0, REC_ZC - MOLD_H / 2],
            color="#7c3aed", lw=0.6, ls=":")
    ax.plot([0, 0], [-5.0, -7.3], color="#7c3aed", lw=0.6, ls=":")
    ax.annotate("port's top edge is the seam:\nno ledge of tray wall under it",
                xy=(0.9, -7.36), xytext=(-13.5, -5.7), fontsize=7.5,
                color="#065f46",
                arrowprops=dict(arrowstyle="->", color="#065f46", lw=0.9))
    ax.annotate("cutter outruns the rolled\nwall, so the receptacle is clear",
                xy=(3.3, -10.85), xytext=(-13.5, -13.6), fontsize=7.5,
                color="#065f46",
                arrowprops=dict(arrowstyle="->", color="#065f46", lw=0.9))
    ax.set_xlim(-14.0, 12.0)
    ax.set_ylim(-14.2, -4.0)
    ax.set_aspect("equal")
    ax.set_xlabel("x (mm) — 0 is the left skin at its widest", fontsize=8)
    ax.set_ylabel("z (mm) — 0 is the front face", fontsize=8)
    ax.set_title(f"section along the plug axis (y = {USB_Y})", fontsize=10)
    ax.tick_params(labelsize=7)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.16), ncol=3,
              fontsize=6.8, framealpha=0.93)


def face_panel(ax, ys, zs, open_):
    ax.imshow(open_, origin="lower", cmap="Greys_r", vmin=0, vmax=1.35,
              extent=(ys[0], ys[-1], zs[0], zs[-1]), interpolation="nearest")
    for w, h, zc, colour, ls, label in (
            (REC_W, REC_H, REC_ZC, "#f59e0b", "-", "receptacle 8.94 x 3.26"),
            (PLUG_W, PLUG_H, REC_ZC, "#7c3aed", "-", "plug shell 8.25 x 2.40"),
            (MOLD_W, MOLD_H, REC_ZC, "#ef4444", "--", "overmold 12.35 x 6.50 max"),
            (PROP_W, PROP_Z1 - PROP_Z0, (PROP_Z0 + PROP_Z1) / 2, "#22c55e", "-",
             f"as built {PROP_W:.2f} x {PROP_Z1 - PROP_Z0:.2f}")):
        ax.add_patch(Rectangle((USB_Y - w / 2, zc - h / 2), w, h,
                               facecolor="none", edgecolor=colour, lw=1.5,
                               ls=ls, label=label))
    # the window this replaced, for scale: a round-numbered box, centred low
    ax.add_patch(Rectangle((USB_Y - 5.0, -11.70), 10.0, 4.20, facecolor="none",
                           edgecolor="#94a3b8", lw=1.2, ls=":",
                           label="was 10.00 x 4.20, centred 0.47 low"))
    ax.axhline(shell_back.LID_Z1, color="#38bdf8", lw=0.9, ls="--")
    ax.text(ys[0] + 0.3, shell_back.LID_Z1 + 0.14, "split", fontsize=7,
            color="#38bdf8")
    ax.set_xlim(ys[0], ys[-1])
    ax.set_ylim(zs[0], zs[-1])
    ax.set_aspect("equal")
    ax.set_xlabel("y (mm)", fontsize=8)
    ax.set_title("aperture along the plug axis — white is clear through",
                 fontsize=10)
    ax.tick_params(labelsize=7)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.16), ncol=3,
              fontsize=6.4, framealpha=0.93)


def main():
    back = shell_back.to_model_space(shell_back.build_back())
    front = shell_front.to_model_space(shell_front.build())
    ys, zs, open_ = aperture_mask(back.union(front))

    fig, axes = plt.subplots(1, 2, figsize=(13.0, 6.2))
    side_panel(axes[0], back, front)
    face_panel(axes[1], ys, zs, open_)
    fig.suptitle("USB-C port, sized off the receptacle rather than the overmold",
                 fontsize=12)
    fig.tight_layout(rect=(0, 0.04, 1, 0.96))
    fig.savefig(OUT, dpi=170)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
