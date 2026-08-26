"""Outer envelope: flat front, plan-rounded outline, one rolled back perimeter.

The whole shape is two fillet passes on a box:

  1. vertical (plan-view) corners  — CASE_TOP_R / CASE_BOTTOM_R
  2. the back-face perimeter       — BACK_ROLL_R, uniform, all the way round

Pass 2 is what makes the corners proper. Rounding the back edge at one radius
turns each plan corner into a torus patch that is continuous with the straight
side runs, so there is no seam: the corner is not the intersection of two
independent features, it is one fillet surface.

This replaced an extruded XZ side profile plus PRISMATIC plan-corner cuts,
which met in a space curve that read as a crease, and left the north edge
square at the full BODY_T. Along a straight run the two constructions are the
same surface, so the side ergonomics are unchanged.

Inner surfaces are a true parallel offset: same construction with every radius
and the thickness reduced by ``inset``, which keeps every centre of curvature
in place. Do NOT build a cavity as a rectangular boolean — the void has to
follow the same profile or it punches out through the roll.

See docs/superpowers/specs/2026-08-02-pocket-card-side-arc-ergonomics-design.md
"""
from __future__ import annotations

import functools
import math

import cadquery as cq

import params as P


def _s_curve_depth(x: float, run: float, height: float, *, rising: bool) -> float:
    x = min(max(float(x), 0.0), run)
    phi = 2 * math.atan(height / run)
    radius = height / (2 * (1 - math.cos(phi)))
    half = run / 2
    if x <= half:
        theta = math.asin(min(x / radius, 1.0))
        taper_depth = height - radius * (1 - math.cos(theta))
    else:
        remaining = run - x
        theta = math.asin(min(remaining / radius, 1.0))
        taper_depth = radius * (1 - math.cos(theta))
    return height - taper_depth if rising else taper_depth


def rear_deck_extra_at(y: float) -> float:
    if y <= P.DECK_RISE_Y0 or y >= P.BODY_H:
        return 0.0
    if y < P.DECK_PLATEAU_Y0:
        return _s_curve_depth(
            y - P.DECK_RISE_Y0,
            P.DECK_RISE_RUN,
            P.DECK_H,
            rising=True,
        )
    if y <= P.DECK_PLATEAU_Y1:
        return P.DECK_H
    return _s_curve_depth(
        y - P.DECK_PLATEAU_Y1,
        P.DECK_TAPER_RUN,
        P.DECK_H,
        rising=False,
    )


def _plan_solid(inset: float, extra: float = 0.0) -> cq.Shape:
    """Box with the four vertical corners rounded (plan-view outline).

    ``extra`` deepens the back only, for the deck profile's envelope.
    """
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet

    w = P.BODY_W - 2 * inset
    h = P.BODY_H - 2 * inset
    t = P.BODY_T + extra - inset
    rt = P.CASE_TOP_R - inset
    rb = P.CASE_BOTTOM_R - inset
    if w < 1 or h < 1 or t < 1 or min(rt, rb) < 0.2:
        raise ValueError(f"inset {inset} too large for the envelope")

    box = (cq.Workplane("XY").box(w, h, t, centered=False)
           .translate((inset, inset, -t)).val())
    mk = BRepFilletAPI_MakeFillet(box.wrapped)
    for edge in cq.Workplane(box).edges("|Z").vals():
        bb = edge.BoundingBox()
        north = (bb.ymin + bb.ymax) / 2 < P.BODY_H / 2
        mk.Add(rt if north else rb, edge.wrapped)
    mk.Build()
    if not mk.IsDone():
        raise RuntimeError(f"plan corner fillet failed at inset {inset}")
    return cq.Shape.cast(mk.Shape())


def _roll_radius_at(x: float, y: float, inset: float) -> float:
    """Roll radius at a perimeter vertex, by which straight run it sits on.

    Every back-perimeter vertex is the junction of one straight run and one
    plan-corner arc, so exactly one of these matches. Feeding the two endpoint
    radii to the fillet makes the arcs interpolate, which keeps the radius
    continuous around the loop — OCC rejects the chain otherwise.
    """
    tol = 1e-3
    if abs(y - inset) < tol:
        return P.BACK_ROLL_N - inset
    if abs(y - (P.BODY_H - inset)) < tol:
        return P.BACK_ROLL_S - inset
    return P.BACK_ROLL_SIDE - inset


def _back_perimeter(solid: cq.Shape):
    """Edges where the back surface meets the sides.

    Not ``faces("<Z").edges()``: once the deck profile is in the solid the back
    has several faces (plateau, blend strips, nominal), and that selector
    returns the deepest one only. Take every face whose outward normal points
    back, then keep the edges used by exactly one of them — an edge shared by
    two back faces is an internal seam (the blend's own tangent lines), which
    is already smooth and must not be filleted.
    """
    back = [f for f in cq.Workplane(solid).faces().vals()
            if f.normalAt(f.Center()).z < -0.5]
    used = {}
    for face in back:
        for edge in face.Edges():
            mid = edge.Center()
            key = (round(mid.x, 4), round(mid.y, 4), round(mid.z, 4),
                   round(edge.Length(), 4))
            used.setdefault(key, []).append(edge)
    return [es[0] for es in used.values()
            if len(es) == 1 and es[0].Length() > 1e-6]


def _roll_back(solid: cq.Shape, inset: float) -> cq.Shape:
    """Fillet the whole back-face perimeter, radius varying north to south."""
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet

    edges = _back_perimeter(solid)
    if not edges:
        return solid
    mk = BRepFilletAPI_MakeFillet(solid.wrapped)
    for edge in edges:
        p0, p1 = edge.startPoint(), edge.endPoint()
        r0 = _roll_radius_at(p0.x, p0.y, inset)
        r1 = _roll_radius_at(p1.x, p1.y, inset)
        if min(r0, r1) < 0.05:
            continue
        if abs(r0 - r1) < 1e-6:
            mk.Add(r0, edge.wrapped)
        else:
            mk.Add(r0, r1, edge.wrapped)
    mk.Build()
    if not mk.IsDone():
        raise RuntimeError(f"back roll fillet failed at inset {inset}")
    return cq.Shape.cast(mk.Shape())


def _deck_region(inset: float) -> cq.Workplane:
    """Deck rise, plateau, and lower return as one cutter swept in x.

    Each transition is a pair of tangent arcs, so the maximum-depth deck meets
    the nominal back without a crease. Being a prism in x, this is only a valid
    trim while the back is flat. That is the whole back before the perimeter is
    rolled, which is why the profile goes into the plan solid first.
    """
    zn = -(P.BODY_T - inset)
    zd = -(P.BODY_T + P.DECK_H - inset)
    rise_y0 = P.DECK_RISE_Y0 - inset
    plateau_y0 = P.DECK_PLATEAU_Y0 - inset
    plateau_y1 = P.DECK_PLATEAU_Y1 - inset
    bottom_y = P.BODY_H - inset
    rise_r = P.DECK_RISE_R
    rise_phi = math.radians(P.DECK_RISE_PHI)
    taper_r = P.DECK_TAPER_R
    taper_phi = math.radians(P.DECK_TAPER_PHI)
    pad = 4.0
    return (cq.Workplane("YZ")
            .moveTo(-pad, zn).lineTo(rise_y0, zn)
            .threePointArc(
                (rise_y0 + rise_r * math.sin(rise_phi / 2),
                 zn - rise_r * (1 - math.cos(rise_phi / 2))),
                (rise_y0 + rise_r * math.sin(rise_phi),
                 zn - rise_r * (1 - math.cos(rise_phi))))
            .threePointArc(
                (plateau_y0 - rise_r * math.sin(rise_phi / 2),
                 zd + rise_r * (1 - math.cos(rise_phi / 2))),
                (plateau_y0, zd))
            .lineTo(plateau_y1, zd)
            .threePointArc(
                (plateau_y1 + taper_r * math.sin(taper_phi / 2),
                 zd + taper_r * (1 - math.cos(taper_phi / 2))),
                (plateau_y1 + taper_r * math.sin(taper_phi),
                 zd + taper_r * (1 - math.cos(taper_phi))))
            .threePointArc(
                (bottom_y - taper_r * math.sin(taper_phi / 2),
                 zn - taper_r * (1 - math.cos(taper_phi / 2))),
                (bottom_y, zn))
            .lineTo(bottom_y, pad).lineTo(-pad, pad).close()
            .extrude(P.BODY_W + 2 * pad).translate((-pad, 0, 0)))


def _profiled_plan(inset: float) -> cq.Shape:
    """Plan solid deepened by the deck's rise, plateau, and lower return."""
    base = _plan_solid(inset, 0.0)
    if P.DECK_H <= 1e-6:
        return base
    deep = (cq.Workplane(_plan_solid(inset, P.DECK_H))
            .intersect(_deck_region(inset)))
    return cq.Workplane(base).union(deep).val()


@functools.lru_cache(maxsize=16)
def _envelope(inset: float = 0.0) -> cq.Shape:
    """Rolled envelope, offset inward by ``inset`` (0.0 = the outer skin).

    Cached: the back shell alone asks for this a dozen times per build.

    The deck profile is built into the PLAN solid, then rolled with everything
    else, so the perimeter is still one fillet and the profile's silhouette is
    part of it. Rolling the depths separately and unioning them looked
    equivalent and was not: the blend is a prism in x, so on the flat middle of
    the back it did the right thing, while at the rolled sides it trimmed
    nothing and left a cliff in the side wall, tapering out about 5 mm inboard.
    The order matters because a height field can describe the back but not the
    roll, where the surface turns under and becomes the wall.

    Note the inner surfaces are an exact parallel offset on the flats but
    slightly over-offset through the blend — the whole profile is shifted
    (-inset, +inset) rather than along its own normal, which leaves up to 1.95
    of wall there instead of 1.50. Thicker, in a band where nothing lives.
    """
    solid = _roll_back(_profiled_plan(inset), inset)

    if inset <= 1e-9:
        # Front perimeter only — the back has no sharp edge left to chamfer.
        ch = getattr(P, "EDGE_CHAMFER", 0) or 0
        if ch > 0:
            try:
                solid = (cq.Workplane(solid).faces(">Z").edges()
                         .chamfer(ch).val())
            except Exception:
                pass

    bb = solid.BoundingBox()
    if bb.zlen > P.BODY_T + P.DECK_H + 0.5 or bb.xlen > P.BODY_W + 0.5:
        raise RuntimeError(
            f"envelope exploded: bbox {bb.xlen:.1f}x{bb.ylen:.1f}x{bb.zlen:.1f}")
    brick = (P.BODY_W - 2 * inset) * (P.BODY_H - 2 * inset) * (P.BODY_T - inset)
    if solid.Volume() < 0.85 * brick:
        raise RuntimeError(
            f"envelope scooped too deep: {solid.Volume():.0f} vs {brick:.0f}")
    return solid


def shaped_brick(corner_r: float = 4.5, *, blend_seams: bool = True):
    """The solid outer envelope.

    ``corner_r`` / ``blend_seams`` are vestigial: plan corners now come from
    CASE_TOP_R / CASE_BOTTOM_R, and there is no seam left to blend. Kept so the
    call sites in shell_front / shell_back / free_space stay untouched.
    """
    return cq.Workplane(_envelope(0.0))


def shaped_cavity_xy(wall: float, z0: float, z1: float,
                     corner_r: float = 4.5) -> cq.Workplane:
    """Inner void: the envelope inset by ``wall``, clipped to ``[z0, z1]``.

    The inset is a parallel offset of the whole shape, so wall thickness is
    ``wall`` everywhere including through the roll — not just on the flats.
    """
    if z1 < z0:
        z0, z1 = z1, z0
    if (z1 - z0) < 0.5:
        raise ValueError("cavity z-span too thin")
    body = cq.Workplane(_envelope(float(wall)))
    pad = 0.05
    slab = (cq.Workplane("XY")
            .box(P.BODY_W + 4, P.BODY_H + 4, (z1 - z0) + 2 * pad,
                 centered=False)
            .translate((-2.0, -2.0, z0 - pad)))
    return body.intersect(slab)


@functools.lru_cache(maxsize=16)
def _section_face(inset: float, z_ref: float) -> cq.Shape:
    """Planar cross-section of the inset envelope at ``z_ref``."""
    slab = (cq.Workplane("XY")
            .box(P.BODY_W + 4, P.BODY_H + 4, 0.05, centered=False)
            .translate((-2.0, -2.0, z_ref)))
    faces = cq.Workplane(_envelope(inset)).intersect(slab).faces("<Z").vals()
    if len(faces) != 1:
        raise RuntimeError(
            f"section at inset {inset}, z {z_ref} gave {len(faces)} faces")
    return faces[0]


def section_prism(inset: float, z_ref: float, z0: float, z1: float) -> cq.Workplane:
    """The inset envelope's section at ``z_ref``, run straight up ``[z0, z1]``.

    For mating faces at the split. The roll widens every cross-section as z
    rises, so a face that follows the envelope is wider at the top of its
    engagement than at the bottom — i.e. wider than the slot it enters. Taking
    one section and extruding it removes that draft entirely; the two shells
    then slide on parallel walls with LAP_CLEAR all the way in.
    """
    if z1 < z0:
        z0, z1 = z1, z0
    face = _section_face(float(inset), float(z_ref))
    prism = cq.Solid.extrudeLinear(face.outerWire(), face.innerWires(),
                                   cq.Vector(0, 0, z1 - z0))
    return cq.Workplane(prism).translate((0, 0, z0 - z_ref))


def shaped_outer_band(z0: float, z1: float, corner_r: float = 4.5) -> cq.Workplane:
    if z1 < z0:
        z0, z1 = z1, z0
    pad = 2.0
    band = (cq.Workplane("XY")
            .box(P.BODY_W + 2 * pad, P.BODY_H + 2 * pad, z1 - z0,
                 centered=False)
            .translate((-pad, -pad, z0)))
    return shaped_brick().intersect(band)


def clip_to_envelope(shape, corner_r: float = 4.5) -> cq.Workplane:
    """Trim internals that stick out through the roll.

    Ribs, shoulders and the rim are still axis-aligned boxes; the back roll
    curves in under them.
    """
    return shape.intersect(shaped_brick())


def side_arc_back_z(x: float) -> float:
    """Analytic back z on the mid-height cross-section — fallback only.

    Exact away from the north/south ends, where the roll turns the corner and
    only the raycast in ``outer_back_z_at`` is right.
    """
    r = float(P.BACK_ROLL_SIDE)
    t = float(P.BODY_T)
    for cx in (r, P.BODY_W - r):
        dx = float(x) - cx
        inboard = (x < r) if cx == r else (x > P.BODY_W - r)
        if inboard and abs(dx) <= r:
            return -(t - r) - math.sqrt(max(r * r - dx * dx, 0.0))
    return -t


_ENVELOPE_RAY = None      # cached IntCurvesFace intersector on the envelope
_RAY_MEMO: dict = {}


def _envelope_intersector():
    """Line↔face intersector on the real outer envelope (built once)."""
    global _ENVELOPE_RAY
    if _ENVELOPE_RAY is None:
        from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
        isec = IntCurvesFace_ShapeIntersector()
        isec.Load(_envelope(0.0).wrapped, 1e-6)
        _ENVELOPE_RAY = isec
    return _ENVELOPE_RAY


def outer_back_z_opt(x: float, y: float):
    """Outer back z at ``(x, y)``, or None if the column misses the envelope.

    Callers that scan near the perimeter want the miss, not a substitute: the
    plan corners cut whole columns away, and the analytic fallback keeps
    answering there with a curve that does not exist.
    """
    key = (round(float(x), 3), round(float(y), 3))
    if key in _RAY_MEMO:
        return _RAY_MEMO[key]
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
    isec = _envelope_intersector()
    isec.Perform(gp_Lin(gp_Pnt(float(x), float(y), -P.BODY_T - 10.0),
                        gp_Dir(0.0, 0.0, 1.0)), 0.0, 1e6)
    z = None
    if isec.IsDone() and isec.NbPnt() > 0:
        z = min(isec.Pnt(i).Z() for i in range(1, isec.NbPnt() + 1))
    _RAY_MEMO[key] = z
    return z


def outer_back_z_at(x: float, y: float) -> float:
    """Local outer back z at ``(x, y)``, raycast against the actual envelope.

    Single source of truth: anything that changes the envelope is reflected
    here automatically. ``side_arc_back_z`` is only the fallback on a miss.
    """
    z = outer_back_z_opt(x, y)
    if z is None:
        z = max(side_arc_back_z(x), -P.BODY_T)
    return z
