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
    r = float(P.TEX_RELIEF if relief is None else relief)
    if r <= 0:
        raise ValueError(f"relief must be positive, got {r}")
    grown = cq.Workplane(side_arc._envelope(-r))
    nominal = cq.Workplane(side_arc._envelope(0.0))
    return grown.cut(nominal)


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
