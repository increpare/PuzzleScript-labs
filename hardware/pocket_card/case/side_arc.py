"""Side-arc outer cutters for GBA-like volume reduction.

Carves the left/right back corners of the brick (layout space) so the mid
back stays at BODY_T and the gripped edges get thinner. Applied to both
shell_front and shell_back outer solids before to_model_space().

See docs/superpowers/specs/2026-08-02-pocket-card-side-arc-ergonomics-design.md
"""
from __future__ import annotations

import math

import cadquery as cq

import params as P


def _radius_at(y: float, r_peak: float) -> float:
    """Cosine fade from SIDE_ARC_Y0/Y1; plateau in the middle."""
    y0, y1, fade = P.SIDE_ARC_Y0, P.SIDE_ARC_Y1, P.SIDE_ARC_FADE
    if y < y0 or y > y1 or r_peak <= 0:
        return 0.0
    if fade > 0 and y < y0 + fade:
        t = (y - y0) / fade
        return r_peak * (0.5 - 0.5 * math.cos(math.pi * t))
    if fade > 0 and y > y1 - fade:
        t = (y1 - y) / fade
        return r_peak * (0.5 - 0.5 * math.cos(math.pi * t))
    return r_peak


def _crescent_slice(side: str, R: float, y0: float, dy: float) -> cq.Workplane | None:
    """Corner box minus cylinder along Y — one thin slice of the squat arc."""
    if R < 0.4 or dy <= 0:
        return None
    eps = 0.35
    z_back = -P.BODY_T
    # Cylinder axis along +Y; centre at the arc centre in XZ.
    if side == "left":
        cx = R
        box = (cq.Workplane("XY")
               .box(R + eps, dy, R + eps, centered=False)
               .translate((-eps * 0.5, y0, z_back - eps * 0.5)))
    else:
        cx = P.BODY_W - R
        box = (cq.Workplane("XY")
               .box(R + eps, dy, R + eps, centered=False)
               .translate((P.BODY_W - R - eps * 0.5, y0, z_back - eps * 0.5)))
    cyl = (cq.Workplane("XZ")
           .workplane(offset=y0)
           .center(cx, z_back + R)
           .circle(R)
           .extrude(dy))
    return box.cut(cyl)


def cutters() -> cq.Workplane:
    """Union of left/right faded crescents in layout coordinates."""
    step = max(P.SIDE_ARC_SLICE, 1.0)
    y = P.SIDE_ARC_Y0
    y_end = P.SIDE_ARC_Y1
    acc = None
    while y < y_end - 1e-6:
        dy = min(step, y_end - y)
        y_mid = y + 0.5 * dy
        for side, r_peak in (("left", P.SIDE_ARC_R_L), ("right", P.SIDE_ARC_R_R)):
            R = _radius_at(y_mid, r_peak)
            piece = _crescent_slice(side, R, y, dy)
            if piece is None:
                continue
            acc = piece if acc is None else acc.union(piece)
        y += dy
    if acc is None:
        # Empty Workplane isn't a valid cut solid — tiny no-op far away.
        return (cq.Workplane("XY").box(0.01, 0.01, 0.01)
                .translate((-1000, -1000, -1000)))
    return acc
