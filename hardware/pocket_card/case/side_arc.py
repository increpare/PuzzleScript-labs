"""Side-arc outer envelope for GBA-like volume reduction.

Builds a *solid* brick, carves continuous left/right cylindrical arcs (full
length, constant R), then shells hollow that shaped solid with WALL preserved.
Never cut the arcs out of an already-hollow wall — that punches side holes.

See docs/superpowers/specs/2026-08-02-pocket-card-side-arc-ergonomics-design.md
"""
from __future__ import annotations

import cadquery as cq

import params as P


def _crescent(side: str, R: float, y0: float, y1: float) -> cq.Workplane | None:
    """One continuous corner: box − cylinder along Y from y0..y1."""
    if R < 0.4 or y1 <= y0:
        return None
    dy = y1 - y0
    eps = 0.5
    z_back = -P.BODY_T
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


def cutters(radius_shrink: float = 0.0) -> cq.Workplane:
    """Left + right continuous arcs. radius_shrink offsets R for the cavity wall."""
    y0 = getattr(P, "SIDE_ARC_Y0", 0.0)
    y1 = getattr(P, "SIDE_ARC_Y1", P.BODY_H)
    acc = None
    for side, r_peak in (("left", P.SIDE_ARC_R_L), ("right", P.SIDE_ARC_R_R)):
        R = r_peak - radius_shrink
        piece = _crescent(side, R, y0, y1)
        if piece is None:
            continue
        acc = piece if acc is None else acc.union(piece)
    if acc is None:
        return (cq.Workplane("XY").box(0.01, 0.01, 0.01)
                .translate((-1000, -1000, -1000)))
    return acc


def _z_band(z0: float, z1: float) -> cq.Workplane:
    if z1 < z0:
        z0, z1 = z1, z0
    pad = 2.0
    return (cq.Workplane("XY")
            .box(P.BODY_W + 2 * pad, P.BODY_H + 2 * pad, z1 - z0, centered=False)
            .translate((-pad, -pad, z0)))


def shaped_brick(corner_r: float = 4.5) -> cq.Workplane:
    """Solid device outer volume with continuous side arcs."""
    body = (cq.Workplane("XY")
            .box(P.BODY_W, P.BODY_H, P.BODY_T, centered=False)
            .translate((0, 0, -P.BODY_T)))
    if corner_r > 0:
        body = body.edges("|Z").fillet(corner_r)
    # Chamfer front/back rims *before* the arcs — after the cut, OCC often
    # refuses a chamfer on the shaped face boundary.
    ch = getattr(P, "EDGE_CHAMFER", 0) or 0
    if ch > 0:
        try:
            body = body.faces(">Z").edges().chamfer(ch)
        except Exception:
            pass
        try:
            body = body.faces("<Z").edges().chamfer(ch)
        except Exception:
            pass
    return body.cut(cutters(0.0))


def shaped_cavity_xy(wall: float, z0: float, z1: float,
                     corner_r: float = 4.5) -> cq.Workplane:
    """Cavity: XY inset + arc at R−wall, spanning Z [z0, z1] (open ends OK)."""
    if z1 < z0:
        z0, z1 = z1, z0
    w = P.BODY_W - 2 * wall
    h = P.BODY_H - 2 * wall
    if w < 1 or h < 1 or (z1 - z0) < 0.5:
        raise ValueError("wall/span too thick for side-arc cavity")
    body = (cq.Workplane("XY")
            .box(w, h, z1 - z0, centered=False)
            .translate((wall, wall, z0)))
    fr = max(corner_r - wall, 0.6)
    body = body.edges("|Z").fillet(fr)
    return body.cut(cutters(radius_shrink=wall))


def shaped_outer_band(z0: float, z1: float, corner_r: float = 4.5) -> cq.Workplane:
    return shaped_brick(corner_r).intersect(_z_band(z0, z1))
