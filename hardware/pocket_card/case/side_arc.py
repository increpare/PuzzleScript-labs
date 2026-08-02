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


def _bottom_xy_cutters(w: float, h: float, r_l: float, r_r: float, *,
                      x0: float = 0.0, y0: float = 0.0,
                      z0: float = -P.BODY_T - 2.0, z1: float = 2.0):
    """Corner-box minus cylinder cutters for plan-view bottom L/R rounds."""
    if z1 < z0:
        z0, z1 = z1, z0
    depth = (z1 - z0) + 0.02
    z_lo = z0 - 0.01
    cuts = None
    for r, side in ((float(r_l), "L"), (float(r_r), "R")):
        if r < 0.5:
            continue
        cy = y0 + h - r
        if side == "L":
            cx = x0 + r
            box = (cq.Workplane("XY")
                   .box(r + 0.05, r + 0.05, depth, centered=False)
                   .translate((x0 - 0.02, cy, z_lo)))
        else:
            cx = x0 + w - r
            box = (cq.Workplane("XY")
                   .box(r + 0.05, r + 0.05, depth, centered=False)
                   .translate((cx, cy, z_lo)))
        cyl = (cq.Workplane("XY").circle(r).extrude(depth)
               .translate((cx, cy, z_lo)))
        piece = box.cut(cyl)
        cuts = piece if cuts is None else cuts.union(piece)
    return cuts


def apply_pcb_bottom_fit(body: cq.Workplane, *, wall: float = 0.0) -> cq.Workplane:
    """Round plan-view bottom corners to hug the controller PCB outline.

    Outer radii are ``CASE_BOTTOM_R_*`` (PCB_BOTTOM_R + board-to-shell gap).
    For the cavity, pass ``wall`` so radii shrink and the solid is inset.
    """
    r_l = float(getattr(P, "CASE_BOTTOM_R_L", 0.0)) - wall
    r_r = float(getattr(P, "CASE_BOTTOM_R_R", 0.0)) - wall
    if r_l < 0.5 and r_r < 0.5:
        return body
    x0 = wall
    y0 = float(getattr(P, "SIDE_ARC_Y0", 0.0)) + wall
    w = P.BODY_W - 2 * wall
    h = (float(getattr(P, "SIDE_ARC_Y1", P.BODY_H))
         - float(getattr(P, "SIDE_ARC_Y0", 0.0)) - 2 * wall)
    bb = body.val().BoundingBox()
    cutters = _bottom_xy_cutters(
        w, h, r_l, r_r, x0=x0, y0=y0, z0=bb.zmin, z1=bb.zmax)
    if cutters is None:
        return body
    return body.cut(cutters)


def _seam_edges(solid, *, wall: float = 0.0):
    """Space-curve edges where the side-arc meets the plan-view bottom round."""
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    r_l = float(getattr(P, "CASE_BOTTOM_R_L", 0.0)) - wall
    r_r = float(getattr(P, "CASE_BOTTOM_R_R", 0.0)) - wall
    y1 = float(getattr(P, "SIDE_ARC_Y1", P.BODY_H)) - wall
    out = []
    seen = set()
    exp = TopExp_Explorer(solid.wrapped, TopAbs_EDGE)
    while exp.More():
        edge = TopoDS.Edge_s(exp.Current())
        ce = cq.Edge(edge)
        bb = ce.BoundingBox()
        key = (round(ce.Length(), 3), round(bb.xmin, 2), round(bb.ymin, 2),
               round(bb.zmin, 2))
        if key in seen:
            exp.Next()
            continue
        seen.add(key)
        dy, dz = bb.ymax - bb.ymin, bb.zmax - bb.zmin
        if dy > 2.0 and dz > 2.0 and bb.zmin < -2.0:
            near_l = bb.xmin < r_l and bb.ymin > y1 - r_l - 2.0
            near_r = bb.xmax > (P.BODY_W - wall) - r_r and bb.ymin > y1 - r_r - 2.0
            if near_l or near_r:
                out.append(ce)
        exp.Next()
    return out


def blend_bottom_seams(body: cq.Workplane, *, wall: float = 0.0) -> cq.Workplane:
    """Fillet the diagonal join between side-arc and plan-view bottom rounds.

    Tries ``SIDE_ARC_BOTTOM_BLEND`` then backs off until OCC accepts it (left
    scoop is the limiter, typically ≤ ~2.6 mm).
    """
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet

    target = float(getattr(P, "SIDE_ARC_BOTTOM_BLEND", 0.0) or 0.0)
    if target < 0.5:
        return body
    solid = body.val()
    edges = _seam_edges(solid, wall=wall)
    if not edges:
        return body
    # Prefer the requested radius; step down if the kernel refuses.
    trial = []
    r = target
    while r >= 1.0:
        trial.append(r)
        r = round(r - 0.2, 2)
    for radius in trial:
        try:
            mk = BRepFilletAPI_MakeFillet(solid.wrapped)
            for edge in edges:
                mk.Add(radius, edge.wrapped)
            mk.Build()
            if mk.IsDone():
                return cq.Workplane(cq.Shape.cast(mk.Shape()))
        except Exception:
            continue
    return body


def shaped_brick(corner_r: float = 4.5, *, blend_seams: bool = True) -> cq.Workplane:
    """Solid outer envelope: profile extruded full length.

    ``blend_seams`` fillets the side-arc × bottom-round join. Must run *after*
    perimeter fillet/chamfer — blending first then chamfering the face leaves a
    corrupt solid whose back half fails boolean intersects (empty lid band →
    shell_back collapses to posts). Leave blend off for ``clip_to_envelope``.
    """
    rl = float(P.SIDE_ARC_R_L)
    rr = float(P.SIDE_ARC_R_R)
    y0 = float(getattr(P, "SIDE_ARC_Y0", 0.0))
    y1 = float(getattr(P, "SIDE_ARC_Y1", P.BODY_H))
    body = profile_solid(P.BODY_W, P.BODY_T, rl, rr, y0, y1)
    body = apply_pcb_bottom_fit(body, wall=0.0)
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
    # Seam blend last — see docstring.
    if blend_seams:
        body = blend_bottom_seams(body, wall=0.0)
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
    body = apply_pcb_bottom_fit(body, wall=wall)
    body = blend_bottom_seams(body, wall=wall)
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
    return shaped_brick(corner_r, blend_seams=True).intersect(band)


def clip_to_envelope(shape, corner_r: float = 4.5) -> cq.Workplane:
    """Trim any rectangular internals that stick into the side scoops.

    Rim, module ribs, shoulders, etc. were still axis-aligned boxes; after the
    outer profile curves in they poke through the 'base' of the case.
    Uses an unfilleted envelope so the intersect stays fast/robust.
    """
    return shape.intersect(shaped_brick(corner_r, blend_seams=False))
