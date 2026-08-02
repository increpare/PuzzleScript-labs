"""GBA-like side curves via an extruded XZ profile.

Cross-section: flat front, vertical sides, back corners as quarter-circles
sampled into a B-spline (CadQuery ``spline``). Extrude along Y, hollow with a
matching inset profile so walls stay closed.

Do NOT use radiusArc/tangentArc here — OCC often takes the long arc and
scoops giant holes out of the sides. Do NOT boolean-crescent a rectangular
cavity — the void must follow the same profile.

See docs/superpowers/specs/2026-08-02-pocket-card-side-arc-ergonomics-design.md
"""
from __future__ import annotations

import math

import cadquery as cq

import params as P

_ARC_SAMPLES = 20  # points per quarter-circle (spline)


def _quarter(cx: float, cz: float, r: float, a0: float, a1: float):
    """Points on a circle from angle a0→a1 (radians, CCW from +X)."""
    pts = []
    for i in range(1, _ARC_SAMPLES + 1):
        a = a0 + (a1 - a0) * (i / _ARC_SAMPLES)
        pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def _xz_profile(w: float, t: float, rl: float, rr: float):
    """Closed XZ wire: front z=0, back z=−t. Local (x,y) == device (x,z).

    Straight edges stay as lines. Each back corner is a B-spline through
    quarter-circle samples (splining the whole silhouette overshoots wildly).
    """
    rl = min(max(float(rl), 0.0), w * 0.45, max(t - 0.2, 0.0))
    rr = min(max(float(rr), 0.0), w * 0.45, max(t - 0.2, 0.0))

    wp = cq.Workplane("XZ").moveTo(0.0, 0.0).lineTo(w, 0.0)

    if rr > 0.05:
        wp = wp.lineTo(w, -(t - rr))
        right = _quarter(w - rr, -(t - rr), rr, 0.0, -math.pi / 2)
        wp = wp.spline(right, includeCurrent=True)
    else:
        wp = wp.lineTo(w, -t)

    if rl > 0.05:
        # Current point should be (w−rr, −t); line across the flat back if needed.
        wp = wp.lineTo(rl, -t)
        left = _quarter(rl, -(t - rl), rl, -math.pi / 2, -math.pi)
        wp = wp.spline(left, includeCurrent=True)
    else:
        wp = wp.lineTo(0.0, -t)

    return wp.lineTo(0.0, 0.0).close()


def profile_solid(w: float, t: float, rl: float, rr: float,
                  y0: float, y1: float, *,
                  x0: float = 0.0, z_front: float = 0.0) -> cq.Workplane:
    """Extrude an XZ profile along Y from y0 to y1."""
    if y1 < y0:
        y0, y1 = y1, y0
    dy = y1 - y0
    # XZ normal is −Y; extrude then normalize to y ∈ [0, dy].
    body = _xz_profile(w, t, rl, rr).extrude(dy)
    bb = body.val().BoundingBox()
    body = body.translate((0.0, -bb.ymin, 0.0))
    return body.translate((x0, y0, z_front))


def shaped_brick(corner_r: float = 4.5) -> cq.Workplane:
    """Solid outer envelope: profile extruded full length."""
    rl = float(P.SIDE_ARC_R_L)
    rr = float(P.SIDE_ARC_R_R)
    y0 = float(getattr(P, "SIDE_ARC_Y0", 0.0))
    y1 = float(getattr(P, "SIDE_ARC_Y1", P.BODY_H))
    body = profile_solid(P.BODY_W, P.BODY_T, rl, rr, y0, y1)
    bb = body.val().BoundingBox()
    if bb.zlen > P.BODY_T + 2 or bb.xlen > P.BODY_W + 2:
        raise RuntimeError(
            f"side-arc profile exploded: bbox {bb.xlen:.1f}x{bb.ylen:.1f}x{bb.zlen:.1f}"
        )
    # Volume must stay close to the brick (shallow corner scoops only).
    brick_vol = P.BODY_W * (y1 - y0) * P.BODY_T
    vol = body.val().Volume()
    if vol < 0.85 * brick_vol:
        raise RuntimeError(
            f"side-arc scooped too deep: vol {vol:.0f} vs brick {brick_vol:.0f}"
        )
    if corner_r > 0:
        try:
            body = body.edges("|Z").fillet(min(corner_r, 2.0))
        except Exception:
            pass
    ch = getattr(P, "EDGE_CHAMFER", 0) or 0
    if ch > 0:
        for sel in (">Z", "<Z"):
            try:
                body = body.faces(sel).edges().chamfer(ch)
            except Exception:
                pass
    return body


def shaped_cavity_xy(wall: float, z0: float, z1: float,
                     corner_r: float = 4.5) -> cq.Workplane:
    """Inner void: same profile inset by wall (radii and XY)."""
    if z1 < z0:
        z0, z1 = z1, z0
    t = z1 - z0
    w = P.BODY_W - 2 * wall
    rl = max(float(P.SIDE_ARC_R_L) - wall, 0.0)
    rr = max(float(P.SIDE_ARC_R_R) - wall, 0.0)
    y0 = float(getattr(P, "SIDE_ARC_Y0", 0.0)) + wall
    y1 = float(getattr(P, "SIDE_ARC_Y1", P.BODY_H)) - wall
    if w < 1 or t < 0.5 or y1 <= y0:
        raise ValueError("wall/span too thick for side-arc cavity")
    body = profile_solid(w, t, rl, rr, y0, y1, x0=wall, z_front=z1)
    if corner_r > 0:
        try:
            body = body.edges("|Z").fillet(min(max(corner_r - wall, 0.5), 2.0))
        except Exception:
            pass
    return body


def shaped_outer_band(z0: float, z1: float, corner_r: float = 4.5) -> cq.Workplane:
    if z1 < z0:
        z0, z1 = z1, z0
    pad = 2.0
    band = (cq.Workplane("XY")
            .box(P.BODY_W + 2 * pad, P.BODY_H + 2 * pad, z1 - z0, centered=False)
            .translate((-pad, -pad, z0)))
    return shaped_brick(corner_r).intersect(band)


def clip_to_envelope(shape, corner_r: float = 4.5) -> cq.Workplane:
    """Trim any rectangular internals that stick into the side scoops.

    Rim, module ribs, shoulders, etc. were still axis-aligned boxes; after the
    outer profile curves in they poke through the 'base' of the case.
    """
    return shape.intersect(shaped_brick(corner_r))
