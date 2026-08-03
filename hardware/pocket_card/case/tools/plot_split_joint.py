"""Draw the split joint in section, old construction beside new.

The feature is a third of a millimetre inside a 1.5 mm wall, so a 3D render
shows nothing. Slice both shells in the x-z plane and plot the outlines.

Run:  .venv/bin/python tools/plot_split_joint.py
"""
import os
import sys

import cadquery as cq
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import params as P            # noqa: E402
import shell_back             # noqa: E402
import shell_front            # noqa: E402
import side_arc               # noqa: E402

Y_CUT = 46.5                  # clear of the module's y-band, on a straight run
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "out", "split_joint.png")


def section_polys(shape, y=Y_CUT):
    """Closed (x, z) polygons where ``shape`` crosses the plane y = ``y``."""
    slab = (cq.Workplane("XY")
            .box(P.BODY_W + 8, 0.04, P.BODY_T + 8, centered=False)
            .translate((-4.0, y, -P.BODY_T - 4)))
    cut = shape.intersect(slab)
    if not cut.solids().vals():
        return []
    from OCP.BRepTools import BRepTools_WireExplorer
    from OCP.TopAbs import TopAbs_REVERSED

    polys = []
    for face in cut.faces("<Y").vals():
        for wire in [face.outerWire()] + list(face.innerWires()):
            # Edges come out of Wire.Edges() unordered and sometimes reversed,
            # which plots as a bowtie. Walk the wire instead.
            pts = []
            exp = BRepTools_WireExplorer(wire.wrapped)
            while exp.More():
                topo = exp.Current()
                edge = cq.Edge(topo)
                n = 2 if edge.geomType() == "LINE" else 32
                ts = [i / n for i in range(n)]
                if topo.Orientation() == TopAbs_REVERSED:
                    ts = [1.0 - t for t in ts]
                pts += [(edge.positionAt(t).x, edge.positionAt(t).z) for t in ts]
                exp.Next()
            if len(pts) > 2:
                polys.append(pts)
    return polys


OLD_ENV = dict(CASE_TOP_R=10.0, BACK_ROLL_SIDE=8.5, BACK_ROLL_N=8.5)


class old_envelope:
    """Restore the pre-fix envelope, so 'before' shows what was really there.

    The roll used to start 2.5 mm above the split, which is what made the lip
    flare. It now starts ON the split, so drawing the old lip against today's
    envelope would show a straight lip and quietly misrepresent the bug.
    """

    def __enter__(self):
        self.saved = {k: getattr(P, k) for k in OLD_ENV}
        for k, v in OLD_ENV.items():
            setattr(P, k, v)
        side_arc._envelope.cache_clear()
        side_arc._section_face.cache_clear()

    def __exit__(self, *exc):
        for k, v in self.saved.items():
            setattr(P, k, v)
        side_arc._envelope.cache_clear()
        side_arc._section_face.cache_clear()


def old_back():
    """The rim as it was: an inset of the ROLLED envelope, inboard of the wall."""
    clear, fence = 0.25, 1.2
    z0, z1 = shell_back.LID_Z1, shell_back.LID_Z1 + 1.2
    outer = side_arc.shaped_cavity_xy(P.WALL + clear, z0, z1, 4.5)
    inner = side_arc.shaped_cavity_xy(P.WALL + clear + fence, z0 - 0.5, z1 + 0.5, 4.5)
    rim = outer.cut(inner)
    tray = (side_arc.shaped_outer_band(shell_back.LID_Z0, shell_back.LID_Z1, 4.5)
            .cut(side_arc.shaped_cavity_xy(P.WALL, shell_back.FLOOR_Z,
                                           shell_back.LID_Z1 + 0.5, 4.5)))
    return tray.union(rim)


def old_front():
    """The front before the rebate: a plain wall end at the split."""
    return (side_arc.shaped_outer_band(-shell_front.SHELL_DEPTH, 0.0, 4.5)
            .cut(side_arc.shaped_cavity_xy(P.WALL, -shell_front.SHELL_DEPTH - 0.5,
                                           -P.FACE_T, 4.5)))


def new_back():
    return (side_arc.shaped_outer_band(shell_back.LID_Z0, shell_back.LID_Z1, 4.5)
            .cut(side_arc.shaped_cavity_xy(P.WALL, shell_back.FLOOR_Z,
                                           shell_back.LID_Z1 + 0.5, 4.5))
            .union(shell_back.split_tongue()))


def new_front():
    return (side_arc.shaped_outer_band(-shell_front.SHELL_DEPTH, 0.0, 4.5)
            .cut(shell_front.cavity()))


def panel(ax, front, back, title, note):
    for polys, colour, label in ((section_polys(back), "#c2410c", "back tray"),
                                 (section_polys(front), "#1d4ed8", "front shell")):
        for i, p in enumerate(polys):
            ax.add_patch(Polygon(p, closed=True, facecolor=colour, alpha=0.55,
                                 edgecolor=colour, linewidth=1.2,
                                 label=label if i == 0 else None))
    split = shell_back.LID_Z1
    ax.axhline(split, color="#334155", lw=0.7, ls="--", zorder=0)
    ax.text(85.4, split + 0.06, "split", fontsize=7, color="#334155")
    ax.set_xlim(85.3, 90.2)
    ax.set_ylim(-9.6, -4.6)
    ax.set_aspect("equal")
    ax.set_title(title, fontsize=10, pad=8)
    ax.set_xlabel("x (mm) — right-hand wall", fontsize=8)
    ax.tick_params(labelsize=7)
    ax.text(0.5, -0.22, note, transform=ax.transAxes, fontsize=7.5,
            ha="center", va="top", color="#334155")


def main():
    fig, axes = plt.subplots(1, 2, figsize=(10.5, 5.4))
    with old_envelope():
        panel(axes[0], old_front(), old_back(),
              f"before  (CASE_TOP_R {OLD_ENV['CASE_TOP_R']}, "
              f"roll {OLD_ENV['BACK_ROLL_SIDE']})",
              "lip stands inboard of the tray wall — nothing under it —\n"
              "and follows the roll, so it widens 0.354 mm on the way up")
    panel(axes[1], new_front(), new_back(),
          f"after  (CASE_TOP_R {P.CASE_TOP_R}, roll {P.BACK_ROLL_SIDE})",
          f"lap inside the wall: tongue {P.LAP_T} / slip {P.LAP_CLEAR} / "
          f"skirt {P.LAP_FRONT_T}\nboth mating faces straight, tongue fused to the tray")
    axes[0].set_ylabel("z (mm) — 0 is the front face", fontsize=8)
    axes[1].legend(loc="lower right", fontsize=8, framealpha=0.9)
    fig.suptitle(f"split joint in section at y = {Y_CUT} mm", fontsize=12)
    fig.tight_layout(rect=(0, 0.02, 1, 0.98))
    fig.savefig(OUT, dpi=170)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
