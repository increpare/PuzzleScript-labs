"""Diagnostic for the display-plug lower rear deck.

The upper screen zone stays at the normal rear plane. A rounded rise reaches
the established 2.40 mm clearance at the display PCB's outward-facing plug,
then a long, gentle lower taper returns to zero at the bottom edge.

Run:  .venv/bin/python tools/rear_deck.py
"""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import params as P  # noqa: E402
import side_arc  # noqa: E402

CASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(CASE, "out", "rear_deck.png")


def report():
    plug_y0 = P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2
    plug_y1 = P.DISPLAY_PLUG_Y + P.DISPLAY_PLUG_BODY_W / 2
    ys = np.linspace(0.0, P.BODY_H, 2001)
    extra = np.array([side_arc.rear_deck_extra_at(y) for y in ys])
    print("display plug lower rear deck")
    print(f"   plug body x {P.DISPLAY_PLUG_X-P.DISPLAY_PLUG_BODY_L/2:.2f}.."
          f"{P.DISPLAY_PLUG_X+P.DISPLAY_PLUG_BODY_L/2:.2f}, "
          f"y {plug_y0:.2f}..{plug_y1:.2f}")
    print(f"   rise starts y {P.DECK_RISE_Y0:.2f}; plateau "
          f"{P.DECK_PLATEAU_Y0:.2f}..{P.DECK_PLATEAU_Y1:.2f}")
    print(f"   maximum extra depth {extra.max():.2f} mm at the display plug "
          f"(target {P.DECK_H:.2f})")
    print(f"   lower taper {P.DECK_TAPER_PHI:.2f} deg max, returns to "
          f"{side_arc.rear_deck_extra_at(P.BODY_H):.2f} mm at "
          f"BODY_H {P.BODY_H:.2f}")


def plan_panel(ax):
    xs = np.linspace(0.0, P.BODY_W, 181)
    ys = np.linspace(0.0, P.BODY_H, 187)
    depth = np.array([
        P.BODY_T + side_arc.rear_deck_extra_at(y) for y in ys
    ])
    field = np.repeat(depth[:, None], len(xs), axis=1)
    im = ax.imshow(
        field,
        origin="upper",
        extent=(0, P.BODY_W, P.BODY_H, 0),
        cmap="viridis_r",
        vmin=P.BODY_T,
        vmax=P.DECK_ZONE_T,
        interpolation="bilinear",
        aspect="equal",
    )
    plt.colorbar(im, ax=ax, shrink=0.82, label="designed back depth (mm)")

    plug_x0 = P.DISPLAY_PLUG_X - P.DISPLAY_PLUG_BODY_L / 2
    plug_y0 = P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2
    ax.add_patch(mpatches.Rectangle(
        (plug_x0, plug_y0),
        P.DISPLAY_PLUG_BODY_L,
        P.DISPLAY_PLUG_BODY_W,
        fc="none",
        ec="#ef4444",
        lw=1.8,
    ))
    ax.annotate(
        "outward-facing display plug",
        xy=(P.DISPLAY_PLUG_X, P.DISPLAY_PLUG_Y),
        xytext=(P.DISPLAY_PLUG_X + 10, P.DISPLAY_PLUG_Y - 13),
        fontsize=8,
        color="#991b1b",
        arrowprops=dict(arrowstyle="->", lw=0.9, color="#991b1b"),
    )
    for y, label in (
        (P.DECK_RISE_Y0, "rise starts"),
        (P.DECK_PLATEAU_Y0, "plateau starts"),
        (P.DECK_PLATEAU_Y1, "lower taper starts"),
    ):
        ax.axhline(y, color="#f8fafc", lw=0.9, ls=(0, (5, 3)))
        ax.text(P.BODY_W - 1.5, y - 0.7, f"{label}  {y:.1f}",
                ha="right", va="bottom", fontsize=7.3, color="#f8fafc")
    ax.set_xlim(0, P.BODY_W)
    ax.set_ylim(P.BODY_H, 0)
    ax.set_xlabel("x (mm)")
    ax.set_ylabel("layout y (mm), screen/top at 0")
    ax.set_title("full-width deck placement")


def profile_panel(ax):
    ys = np.linspace(0.0, P.BODY_H, 1001)
    extra = np.array([side_arc.rear_deck_extra_at(y) for y in ys])
    ax.fill_between(ys, 0.0, extra, color="#bfdbfe", alpha=0.8)
    ax.plot(ys, extra, color="#1d4ed8", lw=2.0, label="rear extra depth")
    ax.axhline(P.DECK_H, color="#64748b", lw=0.8, ls=(0, (5, 3)))
    ax.text(P.BODY_H - 1.0, P.DECK_H + 0.05,
            f"maximum {P.DECK_H:.2f} mm", ha="right", fontsize=8,
            color="#334155")

    plug_y0 = P.DISPLAY_PLUG_Y - P.DISPLAY_PLUG_BODY_W / 2
    ax.axvspan(plug_y0, plug_y0 + P.DISPLAY_PLUG_BODY_W,
               color="#fecaca", alpha=0.65, label="display plug body")
    for y, label, offset in (
        (P.DECK_RISE_Y0, "rounded rise", (0, 12)),
        (P.DECK_PLATEAU_Y0, "full depth", (-28, 18)),
        (P.DECK_PLATEAU_Y1, "gentle lower taper", (40, 18)),
        (P.BODY_H, "zero at bottom", (-18, 20)),
    ):
        ax.axvline(y, color="#94a3b8", lw=0.8, ls=(0, (4, 3)))
        ax.annotate(label, xy=(y, side_arc.rear_deck_extra_at(y)),
                    xytext=offset,
                    textcoords="offset points", ha="center", fontsize=7.5,
                    color="#334155")
    ax.set_xlim(0, P.BODY_H)
    ax.set_ylim(-0.12, P.DECK_H + 0.35)
    ax.set_xlabel("layout y (mm)")
    ax.set_ylabel("extra depth beyond normal rear plane (mm)")
    ax.set_title("rounded step, short plateau, monotonic return")
    ax.legend(loc="upper right", fontsize=8)
    ax.grid(color="#e2e8f0", lw=0.6)


def main():
    report()
    fig, axes = plt.subplots(1, 2, figsize=(13.4, 6.2),
                             gridspec_kw=dict(width_ratios=(0.95, 1.35)))
    plan_panel(axes[0])
    profile_panel(axes[1])
    fig.suptitle("Pocket Card lower rear deck for display-plug clearance",
                 fontsize=12)
    fig.patch.set_facecolor("#f8fafc")
    fig.tight_layout()
    fig.savefig(OUT, dpi=160)
    plt.close(fig)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
