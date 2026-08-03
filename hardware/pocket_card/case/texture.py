"""Enclosure surface relief — the brick pattern generator.

One 5x5 sprite tile from params.TEX_TILE, at two pitches, standing PROUD of
the nominal envelope. Everything about how bricks are made lives here; the
shells are meant to see only a handful of entry points from this module.

Spec: docs/superpowers/specs/2026-08-03-pocket-card-surface-treatment-design.md

Coordinates match shell_front / shell_back: device space, z = 0 at the outer
face and negative into the body.

TEX_TILE's row 0 is the sprite's TOP: brick_rects walks rows so that row 0
lands at the highest y in any window, matching how the tuple reads on the
page (the first string is the top row of the drawn sprite).

Run:  .venv/bin/python texture.py     (writes a one-tile patch preview to out/)
"""
import math
import os

import cadquery as cq

import params as P
import side_arc  # used by later tasks in this module (proud_skin, etc.)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


def brick_rects(pitch, x0, y0, x1, y1):
    """Brick footprints covering [x0,x1] x [y0,y1], clipped to that window.

    Returns a list of (xmin, ymin, xmax, ymax) tuples, one per '#' pixel of
    P.TEX_TILE that overlaps the window (pixels straddling the window edge
    are clipped, not dropped or included whole).

    Phase-locked to P.TEX_ORIGIN, not to (x0, y0): the tile grid is indexed
    relative to TEX_ORIGIN, so a front-shell field and a back-shell field
    asking for two different, independently-placed windows still produce
    courses that line up across the split. That is the whole reason the
    origin is a module-level parameter rather than each caller's own window
    corner — a window-relative implementation would silently break
    registration the moment the two shells' windows disagree about where
    "local (0, 0)" is.
    """
    rows = P.TEX_TILE
    n = len(rows)
    tile = pitch * n
    ox, oy = P.TEX_ORIGIN

    # index range of tiles overlapping the window, relative to the origin
    i0 = math.floor((x0 - ox) / tile)
    i1 = math.ceil((x1 - ox) / tile)
    j0 = math.floor((y0 - oy) / tile)
    j1 = math.ceil((y1 - oy) / tile)

    out = []
    for j in range(j0, j1):
        for i in range(i0, i1):
            bx = ox + i * tile
            by = oy + j * tile
            for r, row in enumerate(rows):
                # row 0 is the TOP of the sprite, so walk y downward from
                # the tile's top edge
                ry0 = by + (n - 1 - r) * pitch
                for c, ch in enumerate(row):
                    if ch != "#":
                        continue
                    rx0 = bx + c * pitch
                    ax0 = max(rx0, x0)
                    ay0 = max(ry0, y0)
                    ax1 = min(rx0 + pitch, x1)
                    ay1 = min(ry0 + pitch, y1)
                    if ax1 - ax0 > 1e-9 and ay1 - ay0 > 1e-9:
                        out.append((ax0, ay0, ax1, ay1))
    return out


def brick_face(pitch, x0, y0, x1, y1):
    """`brick_rects` as one XY workplane of faces at z = 0."""
    rects = brick_rects(pitch, x0, y0, x1, y1)
    if not rects:
        raise ValueError(f"no bricks in window ({x0}, {y0})-({x1}, {y1})")
    wp = cq.Workplane("XY")
    for ax0, ay0, ax1, ay1 in rects:
        cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
        wp = wp.add(cq.Face.makePlane(
            length=ay1 - ay0, width=ax1 - ax0, basePnt=(cx, cy, 0)))
    return wp


def _validated_root_overlap(root_overlap):
    """Construction-only root depth, capped at the decided bond allowance."""
    root = float(root_overlap)
    if not math.isfinite(root) or root < 0:
        raise ValueError(f"root overlap must be finite and non-negative, got {root}")
    if root > P.TEX_ROOT_OVERLAP:
        raise ValueError(f"root overlap exceeds the decided construction bond, got {root}")
    return root


def _relief_skin(relief, root_overlap=0.0, zone=None):
    """Zone-aware band from inside nominal to `relief` outside.

    `root_overlap=0` is the exact proud skin. A positive value is construction
    overlap that disappears inside an integrated shell union.
    """
    r = float(relief)
    if not math.isfinite(r) or r <= 0:
        raise ValueError(f"relief must be finite and positive, got {r}")
    root = _validated_root_overlap(root_overlap)
    grown = cq.Workplane(side_arc._envelope(-r))
    nominal = cq.Workplane(side_arc._envelope(0.0))
    if root == 0.0:
        return grown.cut(nominal)
    if zone == "front":
        pad = 1.0
        band = (cq.Workplane("XY")
                .box(P.BODY_W + 2 * pad, P.BODY_H + 2 * pad,
                     r + root + 2 * pad, centered=False)
                .translate((-pad, -pad, -root)))
        return grown.intersect(band)
    if zone == "wall":
        inner = cq.Workplane(side_arc._envelope(root))
        return grown.cut(inner)
    raise ValueError(f"positive root overlap requires a known zone, got {zone!r}")


def proud_skin(relief=None):
    """The constant-thickness shell just OUTSIDE the nominal envelope.

    This is the trick that makes relief wrap. Extruded brick prisms have one
    direction; the case surface rolls through ninety degrees from face to
    back. Intersecting the prisms with this skin gives relief measured
    perpendicular to the local surface everywhere, so it neither thins out nor
    fattens as the surface turns away from the extrusion axis.

    Relies on side_arc._envelope(-relief) being a genuine parallel offset of
    _envelope(0.0) in all three axes, including the flat front face. That
    was not true before side_arc._plan_solid grew the front face along with
    the back and the plan outline for negative inset (see its docstring) —
    with the front pinned to z = 0 regardless of inset, this skin was zero
    thickness across the entire flat front face.
    """
    r = P.TEX_RELIEF if relief is None else relief
    return _relief_skin(r, 0.0, zone=None)


# The eight control stations, mirroring shell_front.build()'s own list. Third
# element is the collar OUTER diameter the keep-out is measured from: the cap
# head, plus the flange overshoot, plus the flange-to-collar clearance --
# shell_front.button_station's own "bore_d" (the guide bore the flange rides
# in), not the boss OD one COLLAR_WALL further out. Radial clearance from
# each cap's own physical edge therefore works out to CAP_FLANGE_OS +
# COLLAR_CLEAR + TEX_KEEPOUT for every round station (verified per-station
# in test_texture.py, along with the pill's two different axis clearances).
_COLLAR_OS = P.CAP_FLANGE_OS + P.COLLAR_CLEAR

STATIONS = [
    (P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D + 2 * _COLLAR_OS),
    (P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D + 2 * _COLLAR_OS),
    (P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D + 2 * _COLLAR_OS),
    (P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D + 2 * _COLLAR_OS),
    (P.UNDO_X, P.UNDO_Y, P.AB_CAP_D + 2 * _COLLAR_OS),
    (P.ACT_X, P.ACT_Y, P.AB_CAP_D + 2 * _COLLAR_OS),
    (P.RESET_X, P.RESET_Y, P.RESET_CAP_D + 2 * _COLLAR_OS),
    # The Menu control is a pill (PILL_L x PILL_W), not a circle. A circular
    # island sized off the long axis over-covers the short axis, which is
    # the safe direction to be wrong in -- the island is a keep-out, not a
    # fit (see test_stations_and_islands for the actual short-axis margin).
    #
    # The diameter below must match the real pill BORE shell_front.py cuts,
    # not just the flange + collar clearance the round stations use: the
    # pill bore is additionally widened by PILL_BORE_EXTRA (see its comment
    # in params.py) so the snap-over lip clears the SKQG's square body.
    # This is shell_front.button_station's own pill-bore expression
    # (`bore_l = flange_l + 2*COLLAR_CLEAR + PILL_BORE_EXTRA`, shell_front.py
    # ~line 174-177), restated here rather than imported to avoid a
    # texture-depends-on-shell_front coupling this module otherwise has none
    # of. Dropping the "+ PILL_BORE_EXTRA" term (as an earlier version of
    # this line did) silently starves TEX_KEEPOUT on this one station: the
    # island still fully contains the real bore, so nothing breaks visibly,
    # but the radial margin actually delivered drops from the intended
    # 1.00 mm to 0.70 mm -- caught by test_stations_and_islands measuring
    # against the real bore geometry, not this formula restated a second
    # time.
    (P.MENU_X, P.MENU_Y, P.PILL_L + 2 * _COLLAR_OS + P.PILL_BORE_EXTRA),
]


def button_islands(keepout=None):
    """Smooth islands around every control, where relief is suppressed.

    Caps emerge from an untextured panel still at nominal, so CAP_PROUD stays
    exactly 1.0 rather than being reduced by a raised field around it. This is
    also what stops the left field running into the d-pad's left cap the way
    the old Blender field did (it reached x = 9.2 against a cap spanning
    6.7-14.7).
    """
    k = float(P.TEX_KEEPOUT if keepout is None else keepout)
    tall = P.BODY_T + 4 * P.TEX_RELIEF
    wp = None
    for x, y, d in STATIONS:
        cyl = (cq.Workplane("XY")
               .circle(d / 2 + k)
               .extrude(-tall)
               .translate((x, y, 2 * P.TEX_RELIEF)))
        wp = cyl if wp is None else wp.union(cyl)
    return wp


def bottom_clear_slab(clear=None):
    """Everything within `clear` of the flat bottom face.

    The flat bottom is never textured -- relief fades out before it, as it
    did in the Blender passes (their cutters stopped at z = -13.8 against a
    back face at -15.7, that -15.7 being the north rib band's local depth,
    not the general BODY_T floor). The slab's XY footprint is padded well
    past the body on all sides, so it is not restricted to the flat middle:
    anything at the right depth is covered regardless of (x, y), including
    the rolled sides and the plan corners (verified in test_texture.py).
    """
    c = float(P.TEX_BOTTOM_CLEAR if clear is None else clear)
    pad = 4.0
    h = c + pad
    return (cq.Workplane("XY")
            .box(P.BODY_W + 2 * pad, P.BODY_H + 2 * pad, h, centered=False)
            .translate((-pad, -pad, -P.BODY_T - pad)))


_ZONES = {
    "front": P.TEX_PIXEL_FINE,
    "wall": P.TEX_PIXEL_COARSE,
}


def _brick_runs(pitch, x0, y0, x1, y1):
    """Merge touching pixel rectangles into connected rectangular bricks.

    `brick_rects` deliberately reports one rectangle per sprite pixel so its
    contract mirrors TEX_TILE.  Adjacent pixels have no physical seam,
    though, and making them as one prism avoids sending thousands of needless
    coincident edges through OCC's boolean engine.
    """
    rows = {}
    for rect in brick_rects(pitch, x0, y0, x1, y1):
        rows.setdefault((round(rect[1], 9), round(rect[3], 9)), []).append(rect)

    horizontal = []
    for row in rows.values():
        row.sort()
        current = list(row[0])
        for rect in row[1:]:
            if rect[0] <= current[2] + 1e-9:
                current[2] = max(current[2], rect[2])
            else:
                horizontal.append(tuple(current))
                current = list(rect)
        horizontal.append(tuple(current))

    columns = {}
    for run in horizontal:
        columns.setdefault((round(run[0], 9), round(run[2], 9)), []).append(run)

    runs = []
    for column in columns.values():
        column.sort(key=lambda run: run[1])
        current = list(column[0])
        for run in column[1:]:
            if run[1] <= current[3] + 1e-9:
                current[3] = max(current[3], run[3])
            else:
                runs.append(tuple(current))
                current = list(run)
        runs.append(tuple(current))
    return runs


def _front_prisms(z0, z1):
    """Fine-pitch brick prisms through a padded plan window."""
    pad = P.TEX_RELIEF
    runs = _brick_runs(P.TEX_PIXEL_FINE,
                       -pad, -pad, P.BODY_W + pad, P.BODY_H + pad)
    solids = [cq.Solid.makeBox(x1 - x0, y1 - y0, z1 - z0,
                               cq.Vector(x0, y0, z0))
              for x0, y0, x1, y1 in runs]
    return cq.Workplane(cq.Compound.makeCompound(solids))


def _wall_prisms(z0, z1, root_overlap=0.0):
    """Coarse-pitch brick prisms placed tangent to the nominal plan wire."""
    plan = cq.Workplane(side_arc._plan_solid(0.0))
    wire = plan.faces(">Z").val().outerWire()
    perimeter = wire.Length()
    runs = _brick_runs(P.TEX_PIXEL_COARSE, 0.0, z0, perimeter, z1)
    depth = 2 * (P.TEX_RELIEF + float(root_overlap) + 0.05)
    solids = []
    for s0, rz0, s1, rz1 in runs:
        # CadQuery's length mode is normalized (0..1), despite the name.
        # Sampling the block midpoint matters: placing its *start* at this
        # point shifts every brick by half its own width around the perimeter.
        midpoint = (s0 + s1) / 2
        point = wire.positionAt(midpoint / perimeter, "length")
        tangent = wire.tangentAt(midpoint / perimeter, "length").normalized()
        plane = cq.Plane(origin=cq.Vector(point.x, point.y, (rz0 + rz1) / 2),
                         xDir=cq.Vector(tangent.x, tangent.y, 0),
                         normal=cq.Vector(0, 0, 1))
        solids.append(cq.Workplane(plane).box(
            s1 - s0, depth, rz1 - rz0, centered=(True, True, True)).val())
    return cq.Workplane(cq.Compound.makeCompound(solids))


def _chamfer_candidate_is_safe(candidate, source):
    """Whether OCC's claimed chamfer only removed source material."""
    original = source.BoundingBox()
    result = candidate.BoundingBox()
    tol = 1e-6
    return (candidate.isValid()
            and candidate.Volume() <= source.Volume() + tol
            and result.xmin >= original.xmin - tol
            and result.ymin >= original.ymin - tol
            and result.zmin >= original.zmin - tol
            and result.xmax <= original.xmax + tol
            and result.ymax <= original.ymax + tol
            and result.zmax <= original.zmax + tol)


def _wall_outward_faces(solid):
    """Outward-facing wall candidates, strongest radial face first."""
    cx, cy = P.BODY_W / 2, P.BODY_H / 2
    candidates = []
    for face in solid.Faces():
        point = face.Center()
        normal = face.normalAt(point)
        radial_x, radial_y = point.x - cx, point.y - cy
        radial_len = math.hypot(radial_x, radial_y)
        normal_len = math.hypot(normal.x, normal.y)
        if radial_len <= 1e-9 or normal_len <= 0.5:
            continue
        score = (normal.x * radial_x + normal.y * radial_y) / radial_len
        if score > 1e-6:
            candidates.append((score, face))
    return [face for _score, face in sorted(candidates, reverse=True,
                                             key=lambda item: item[0])]


def _chamfer_proud_tops(relief, zone="front"):
    """Chamfer every disconnected brick independently where OCC permits it.

    A skin-clipped brick can expose a degenerate top edge.  Its chamfer is
    cosmetic, so preserve just that brick on a failure; never bypass the
    chamfer merely because a field contains many otherwise valid solids.
    """
    chamfered = []
    for solid in relief.solids().vals():
        if zone == "front":
            faces = cq.Workplane(solid).faces(">Z").vals()
        else:
            faces = _wall_outward_faces(solid)
        for face in faces:
            try:
                candidate = (cq.Workplane(solid).newObject([face]).edges()
                             .chamfer(P.TEX_TOP_CHAMFER).val())
                if _chamfer_candidate_is_safe(candidate, solid):
                    chamfered.append(candidate)
                    break
            except Exception:
                pass
        else:
            chamfered.append(solid)
    return cq.Workplane(cq.Compound.makeCompound(chamfered))


def relief_for_zone(zone: str, z0: float, z1: float,
                    root_overlap=0.0) -> cq.Workplane:
    """Textured part of the proud skin for one named surface zone.

    Brick prisms establish the pattern; the skin intersection converts them
    into normal-direction relief over the rolls and plan corners.  Button and
    bottom keep-outs are cut only after that intersection, so they suppress
    every surface orientation consistently.
    """
    if zone not in _ZONES:
        raise ValueError(f"unknown texture zone {zone!r}")
    z0, z1 = float(z0), float(z1)
    if not math.isfinite(z0) or not math.isfinite(z1):
        raise ValueError("texture z bounds must be finite")
    z0, z1 = sorted((z0, z1))
    if z1 - z0 <= 1e-9:
        raise ValueError("texture z band must have positive height")
    root = _validated_root_overlap(root_overlap)

    prisms = (_front_prisms(z0, z1) if zone == "front"
              else _wall_prisms(z0, z1, root_overlap=root))
    visible = (prisms.intersect(proud_skin())
               .cut(button_islands())
               .cut(bottom_clear_slab()))
    visible = _chamfer_proud_tops(visible, zone)
    if root == 0.0:
        return visible

    bond = (prisms.intersect(_relief_skin(root, root, zone=zone))
            .cut(button_islands())
            .cut(bottom_clear_slab()))
    # Keep the bonded roots as a compound beside the already-chamfered
    # visible bricks.  Global OCC fusion changes the visible topology around
    # touching root strips; the shell's later union consumes these overlapping
    # roots while this assembly preserves the finished surface exactly.
    return visible.add(bond)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    pitch = P.TEX_PIXEL_FINE
    tile = pitch * len(P.TEX_TILE)
    face = brick_face(pitch, 0.0, 0.0, tile, tile)
    cq.exporters.export(face, os.path.join(OUT, "texture_preview.step"))
    n = len(face.faces().vals())
    area = sum(f.Area() for f in face.faces().vals())
    print(f"one {tile:.1f} x {tile:.1f} mm tile at pitch {pitch:.2f}: "
          f"{n} bricks, {area:.2f} mm^2 -> out/texture_preview.step")
