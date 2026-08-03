"""The north rib, and the connector it exists for.

The module carries exactly one vertical part on its back: a Molex PicoBlade
53398-0271 header at the north edge.  The other four are side-entry, stand 3.5
off the board, and the flat tray clears them.  This one did not fit — mated it
came out through the back of the case — so the back is RIB_H deeper from the
north edge down to RIB_Y and eases back to BODY_T over a tangent S-curve.  Full
width, so it reads as a fatter top edge rather than as a wart.

This plots the shell as built, not a proposal: both panels are raycast against
the real solid.

Geometry is off the KiCad footprint for the exact part (Connector_Molex.pretty,
Molex_PicoBlade_53398-0271_1x02-1MP_P1.25mm_Vertical), which agrees with the
module's own outline drawing: that drawing's 5.18 dimension lands on the
footprint's mounting-pad centreline, 2.75 in from the pin row, which is how the
part is located here.

Run:  .venv/bin/python tools/bat_blister.py
"""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import params as P                      # noqa: E402
import shell_back                       # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "out", "bat_blister.png")

REAR = -(P.MODULE_Z + P.MOD_FRONT_STACK)        # -7.50, module PCB rear plane

# --- the part, from the KiCad footprint (mm, footprint frame) --------------
#   pin row      y = -1.25, pitch 1.25
#   body F.Fab   x -3.825..3.825   y -1.100..2.600      7.65 x 3.70
#   courtyard    x -4.720..4.720   y -2.400..3.500      9.44 x 5.90
#   mount pads   y = +1.500  <- the module drawing's 5.18 datum
BODY_L, BODY_W_ = 7.65, 3.70
CRTYD_L, CRTYD_W = 9.44, 5.90
HDR_H   = 4.70          # DATASHEET  module's own "4.70 SMD(MAX)"
MATED_H = 5.70          # DATASHEET  Molex, PCB surface to top of the mated pair
HSG_L, HSG_W, HSG_H = 4.25, 3.20, 3.95   # DATASHEET  51021-0200 crimp housing
CABLE_D = 1.20          # ASSUMED  26 AWG battery lead, insulated

BAT_X = 25.18                                   # pin-row centre, 86-axis chain
BAT_Y_MP = P.MOD_Y + 5.18                       # mount-pad centreline
BAT_Y = BAT_Y_MP - 1.5 + (BODY_W_ / 2 - 1.1)    # body centre, 6.93

CLR = 0.40              # DECIDED  pocket clearance around the part, per side

# the two candidate roof heights: cable pinched flat, or given room to fold
ROOF_TIGHT = REAR - MATED_H - 0.30
ROOF_DRESS = REAR - MATED_H - CABLE_D


def _isec():
    from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
    back = shell_back.to_model_space(shell_back.build_back())
    it = IntCurvesFace_ShapeIntersector()
    it.Load(back.val().wrapped, 1e-6)
    return it


def surfaces(xs, ys, isec):
    """Topmost and bottommost faces of the back shell along -z."""
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    inner = np.full((len(ys), len(xs)), np.nan)
    outer = np.full((len(ys), len(xs)), np.nan)
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            isec.Perform(gp_Lin(gp_Pnt(float(x), float(y), 0.0),
                                gp_Dir(0.0, 0.0, -1.0)), 0.0, 40.0)
            if isec.IsDone() and isec.NbPnt() > 0:
                zz = [isec.Pnt(k).Z() for k in range(1, isec.NbPnt() + 1)]
                inner[j, i] = max(zz)
                outer[j, i] = min(zz)
    return inner, outer


def report(isec):
    xs = np.linspace(BAT_X - 10, BAT_X + 10, 81)
    ys = np.linspace(2.0, 16.0, 57)
    inner, outer = surfaces(xs, ys, isec)
    X, Y = np.meshgrid(xs, ys)
    m = (np.abs(X - BAT_X) <= BODY_L / 2) & (np.abs(Y - BAT_Y) <= BODY_W_ / 2)
    ii, oo = inner[m], outer[m]
    ii, oo = ii[np.isfinite(ii)], oo[np.isfinite(oo)]

    print("BAT connector  Molex 53398-0271 + 51021-0200 housing")
    print(f"   body      {BODY_L:.2f} x {BODY_W_:.2f}  ->  "
          f"x {BAT_X-BODY_L/2:.2f}..{BAT_X+BODY_L/2:.2f}   "
          f"y {BAT_Y-BODY_W_/2:.2f}..{BAT_Y+BODY_W_/2:.2f}")
    print(f"   mated top at z {REAR-MATED_H:.2f};  tray floor inner "
          f"{ii.max():.2f}, back skin {oo.min():.2f}..{oo.max():.2f}")
    head = REAR - ii.max()
    slack = head - MATED_H
    print(f"   headroom {head:.2f}, need {MATED_H:.2f}  ->  "
          + (f"spare {slack:.2f}" if slack >= 0 else f"short {-slack:.2f}"))

    print("\npocket, part + %.2f per side" % CLR)
    px0, px1 = BAT_X - BODY_L / 2 - CLR, BAT_X + BODY_L / 2 + CLR
    py0, py1 = BAT_Y - BODY_W_ / 2 - CLR, BAT_Y + BODY_W_ / 2 + CLR
    print(f"   x {px0:.2f}..{px1:.2f}  ({px1-px0:.2f} long, along the pin row)")
    print(f"   y {py0:.2f}..{py1:.2f}  ({py1-py0:.2f} wide)")

    print(f"\nrib as built: {P.RIB_H:.2f} proud, plateau to y {P.RIB_Y:.1f}, "
          f"blend to y {P.RIB_Y2:.2f} at {P.RIB_BLEND_PHI:.0f} deg max")
    print(f"   case {P.RIB_ZONE_T:.2f} thick there vs {P.BODY_T:.2f} elsewhere; "
          f"pocket roof {P.RIB_FLOOR_Z:.2f}, {slack:.2f} of lead room over the "
          f"mated housing (wanted {P.BAT_CABLE:.2f})")
    return xs, ys, inner, outer


def plan_panel(ax, isec):
    """Depth of the back skin over the whole case — the rib as a band."""
    xs = np.linspace(0.4, P.BODY_W - 0.4, 150)
    ys = np.linspace(0.4, P.BODY_H - 0.4, 155)
    _, outer = surfaces(xs, ys, isec)
    im = ax.imshow(-outer, origin="upper", cmap="viridis_r",
                   vmin=P.BODY_T - 1.0, vmax=P.RIB_ZONE_T,
                   extent=(xs[0], xs[-1], ys[-1], ys[0]), interpolation="bilinear")
    ax.contour(xs, ys, -outer, levels=[P.BODY_T + 0.01], colors=["#f8fafc"],
               linewidths=0.9)
    plt.colorbar(im, ax=ax, shrink=0.85, label="case thickness (mm)")

    ax.add_patch(mpatches.Rectangle(
        (P.BAT_X - BODY_L / 2, P.BAT_Y - BODY_W_ / 2), BODY_L, BODY_W_,
        fc="none", ec="#f87171", lw=1.6))
    ax.annotate(f"BAT header {BODY_L} x {BODY_W_}", xy=(P.BAT_X, P.BAT_Y),
                xytext=(P.BAT_X + 8, 30), fontsize=8, color="#b91c1c",
                arrowprops=dict(arrowstyle="->", lw=1.0, color="#b91c1c"))
    ax.axhline(P.RIB_Y, color="#fbbf24", lw=0.9, ls=(0, (5, 3)))
    ax.axhline(P.RIB_Y2, color="#fbbf24", lw=0.9, ls=(0, (5, 3)))
    ax.text(P.BODY_W - 1.5, P.RIB_Y - 0.8, f"plateau ends {P.RIB_Y:.0f}",
            ha="right", fontsize=7.5, color="#fbbf24")
    ax.text(P.BODY_W - 1.5, P.RIB_Y2 - 0.8, f"back to {P.BODY_T:.2f} at "
            f"{P.RIB_Y2:.1f}", ha="right", fontsize=7.5, color="#fbbf24")

    ax.set_xlim(0, P.BODY_W)
    ax.set_ylim(P.BODY_H, 0)
    ax.set_aspect("equal")
    ax.set_xlabel("x (mm)", fontsize=8)
    ax.set_ylabel("y (mm)", fontsize=8)
    ax.set_title("back skin depth — the rib runs the full width, symmetric "
                 f"about x = {P.BODY_W/2:.0f}", fontsize=9.5)


def section_panel(ax, isec):
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    ys = np.linspace(0.2, 30.0, 300)
    inn, out = [], []
    for y in ys:
        isec.Perform(gp_Lin(gp_Pnt(BAT_X, float(y), 0.0), gp_Dir(0, 0, -1)),
                     0.0, 40.0)
        if isec.IsDone() and isec.NbPnt() > 0:
            zz = [isec.Pnt(k).Z() for k in range(1, isec.NbPnt() + 1)]
            inn.append(max(zz)); out.append(min(zz))
        else:
            inn.append(np.nan); out.append(np.nan)
    inn, out = np.array(inn), np.array(out)
    ok = np.isfinite(out)
    ax.fill_between(ys[ok], out[ok], inn[ok], fc="#e2e8f0", ec="none")
    ax.plot(ys, out, color="#334155", lw=1.8, label="back skin")
    ax.plot(ys, inn, color="#94a3b8", lw=1.2, label="tray floor, inner")
    ax.axhline(-P.BODY_T, color="#cbd5e1", lw=0.8, ls=(0, (6, 4)))
    ax.text(29.5, -P.BODY_T + 0.25, f"nominal back  {-P.BODY_T:.2f}",
            ha="right", fontsize=7.5, color="#64748b")

    ax.add_patch(mpatches.Rectangle((0, REAR), 60, P.MOD_FRONT_STACK,
                                    fc="#dbeafe", ec="#60a5fa", lw=0.8))
    ax.text(19, REAR + 2.6, "display module", fontsize=7.5, color="#1d4ed8")

    y0 = BAT_Y - BODY_W_ / 2
    ax.add_patch(mpatches.Rectangle((y0, REAR - HDR_H), BODY_W_, HDR_H,
                                    fc="#fecaca", ec="#dc2626", lw=1.0))
    ax.add_patch(mpatches.Rectangle((BAT_Y - HSG_W / 2, REAR - MATED_H),
                                    HSG_W, MATED_H - HDR_H,
                                    fc="#fca5a5", ec="#dc2626", lw=1.0))
    ax.add_patch(mpatches.Rectangle((y0, REAR - MATED_H - P.BAT_CABLE),
                                    BODY_W_, P.BAT_CABLE, fc="#ddd6fe",
                                    ec="#7c3aed", lw=0.9, ls=(0, (4, 2))))
    ax.annotate(f"header {HDR_H}, mated {MATED_H}", xy=(y0, REAR - HDR_H / 2),
                xytext=(12.5, REAR - 1.6), fontsize=7.5, color="#b91c1c",
                arrowprops=dict(arrowstyle="->", lw=0.8, color="#b91c1c"))
    ax.annotate(f"{P.BAT_CABLE} for the leads",
                xy=(BAT_Y + BODY_W_ / 2, REAR - MATED_H - P.BAT_CABLE / 2),
                xytext=(12.5, REAR - MATED_H - 1.0), fontsize=7.5,
                color="#6d28d9",
                arrowprops=dict(arrowstyle="->", lw=0.8, color="#6d28d9"))

    for y, txt in ((P.RIB_Y, f"plateau ends {P.RIB_Y:.1f}"),
                   (P.RIB_Y2, f"blend done {P.RIB_Y2:.1f}")):
        ax.plot([y, y], [-P.RIB_ZONE_T - 0.9, -P.BODY_T + 0.6], color="#f59e0b",
                lw=0.9, ls=(0, (4, 3)))
        ax.text(y, -P.RIB_ZONE_T - 1.1, txt, ha="center", fontsize=7.5,
                color="#b45309")

    ax.annotate(f"rib, {P.RIB_H:.2f} proud", xy=(4.0, -P.RIB_ZONE_T),
                xytext=(4.0, -P.RIB_ZONE_T - 1.6), ha="center", fontsize=8,
                color="#0f172a",
                arrowprops=dict(arrowstyle="->", lw=0.9, color="#0f172a"))

    ax.set_xlim(0, 30)
    ax.set_ylim(-18.0, -5.0)
    ax.set_aspect("equal")
    ax.set_xlabel("y (mm), north edge at 0", fontsize=8)
    ax.set_ylabel("z (mm)", fontsize=8)
    ax.set_title(f"section at x = {BAT_X:.2f}, through the connector — as built",
                 fontsize=9.5)
    ax.legend(fontsize=7.5, loc="lower right")


def main():
    isec = _isec()
    report(isec)
    fig, axes = plt.subplots(1, 2, figsize=(13.4, 6.2),
                             gridspec_kw=dict(width_ratios=(1.0, 1.25)))
    plan_panel(axes[0], isec)
    section_panel(axes[1], isec)
    fig.suptitle("North rib for the module's vertical BAT connector "
                 "(PicoBlade 53398-0271)", fontsize=12)
    fig.tight_layout()
    fig.savefig(OUT, dpi=160)
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
