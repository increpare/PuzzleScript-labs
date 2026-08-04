"""Role-specific Pocket Card button crowns on the existing guided-cap base.

This is deliberately separate from ``coupon.py``.  The coupon remains a neutral
fit gauge; this module changes only the material above the outer face (z >= 0)
and preserves its flange, anti-rotation flats and switch boss.
"""
import math
import os
from dataclasses import dataclass

import cadquery as cq

import coupon
import params as P
import shell_front


DIRECTION_ROLES = ("up", "down", "left", "right")
ROLES = (*DIRECTION_ROLES, "undo", "action", "reset", "menu")
OUTWARD = {
    "up": (0.0, -1.0),
    "down": (0.0, 1.0),
    "left": (-1.0, 0.0),
    "right": (1.0, 0.0),
}


@dataclass(frozen=True)
class Station:
    role: str
    x: float
    y: float


STATIONS = (
    Station("up", P.DIR_CX, P.DIR_CY - P.DIR_RADIUS),
    Station("down", P.DIR_CX, P.DIR_CY + P.DIR_RADIUS),
    Station("left", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY),
    Station("right", P.DIR_CX + P.DIR_RADIUS, P.DIR_CY),
    Station("undo", P.UNDO_X, P.UNDO_Y),
    Station("action", P.ACT_X, P.ACT_Y),
    Station("reset", P.RESET_X, P.RESET_Y),
    Station("menu", P.MENU_X, P.MENU_Y),
)

# Crown dimensions above the existing outer face, in millimetres.
DIRECTION_SHOULDER_H = 0.90
DIRECTION_APEX_H = 1.40
DIRECTION_APEX_SHIFT = 0.78
UNDO_RIM_H = 1.20
UNDO_DISH_DEPTH = 0.58
ACTION_EDGE_H = 0.78
ACTION_APEX_H = 1.28
RESET_RIM_H = 0.55
RESET_DISH_DEPTH = 0.25
MENU_TOP_H = 0.62
MENU_GROOVE_DEPTH = 0.18
TOP_EDGE_FILLET = {
    "up": 0.18,
    "down": 0.18,
    "left": 0.18,
    "right": 0.18,
    "undo": 0.18,
    "reset": 0.12,
    "menu": 0.08,
}


def _round_mechanical_base(hole_d, clear_cap):
    """Shared through-face head, keyed flange and SKQG plunger boss."""
    head_d = hole_d - 2 * clear_cap
    flange_d = hole_d + 2 * P.CAP_FLANGE_OS

    head = (
        cq.Workplane("XY").workplane(offset=-P.FACE_T)
        .circle(head_d / 2).extrude(P.FACE_T)
    )
    flange = (
        cq.Workplane("XY").workplane(offset=-P.FACE_T)
        .circle(flange_d / 2).extrude(-P.CAP_FLANGE_T)
    )
    flange = coupon._flats(
        flange, flange_d / 2, coupon.FLAT_DEPTH + 0.05
    )
    boss_top = -(P.FACE_T + P.CAP_FLANGE_T)
    boss = (
        cq.Workplane("XY").workplane(offset=boss_top)
        .circle(1.5).extrude(-P.CAP_BOSS_GAP)
    )
    return head.union(flange).union(boss), head_d


def _pill_mechanical_base(clear_cap):
    """Shared through-face Menu head and captured pill flange."""
    head_l = P.PILL_L - 2 * clear_cap
    head_w = P.PILL_W - 2 * clear_cap
    head = (
        cq.Workplane("XY").workplane(offset=-P.FACE_T)
        .slot2D(head_l, head_w, 0).extrude(P.FACE_T)
    )
    flange = (
        cq.Workplane("XY").workplane(offset=-P.FACE_T)
        .slot2D(
            P.PILL_L + 2 * P.CAP_FLANGE_OS,
            P.PILL_W + 2 * P.CAP_FLANGE_OS,
            0,
        )
        .extrude(-P.CAP_FLANGE_T)
    )
    return head.union(flange), head_l, head_w


def _direction_crown(head_d, outward):
    """Smooth offset loft whose high point leans toward ``outward``."""
    dx, dy = outward
    length = math.hypot(dx, dy)
    if length == 0:
        raise ValueError("direction crown requires a non-zero outward vector")
    dx, dy = dx / length, dy / length
    r = head_d / 2

    return (
        cq.Workplane("XY")
        .circle(r)
        .workplane(offset=DIRECTION_SHOULDER_H)
        .center(dx * 0.46, dy * 0.46)
        .circle(r * 0.62)
        .workplane(offset=DIRECTION_APEX_H - DIRECTION_SHOULDER_H)
        .center(
            dx * (DIRECTION_APEX_SHIFT - 0.46),
            dy * (DIRECTION_APEX_SHIFT - 0.46),
        )
        .circle(r * 0.27)
        .loft(combine=True, ruled=False)
    )


def _dished_crown(head_d, rim_h, depth):
    r = head_d / 2
    crown = cq.Workplane("XY").circle(r).extrude(rim_h)
    dish_r = head_d * 1.30
    dish = (
        cq.Workplane("XY").sphere(dish_r)
        .translate((0, 0, rim_h + dish_r - depth))
    )
    return crown.cut(dish)


def _action_crown(head_d):
    """Spherical cap meeting a short cylindrical shoulder at ACTION_EDGE_H."""
    r = head_d / 2
    sag = ACTION_APEX_H - ACTION_EDGE_H
    sphere_r = (r * r + sag * sag) / (2 * sag)
    sphere_z = ACTION_APEX_H - sphere_r
    # Overlap the sphere and shoulder very slightly.  A merely tangent union is
    # mathematically closed but OpenCascade correctly reports it as invalid.
    join_overlap = 0.06
    shoulder = (
        cq.Workplane("XY").circle(r).extrude(ACTION_EDGE_H + join_overlap)
    )
    dome_clip = (
        cq.Workplane("XY").workplane(offset=ACTION_EDGE_H - join_overlap)
        .circle(r).extrude(sag + 2 * join_overlap)
    )
    dome = (
        cq.Workplane("XY").sphere(sphere_r)
        .translate((0, 0, sphere_z))
        .intersect(dome_clip)
    )
    return shoulder.union(dome)


def _menu_crown(head_l, head_w, grooves):
    crown = cq.Workplane("XY").slot2D(head_l, head_w, 0).extrude(MENU_TOP_H)
    if not grooves:
        return crown
    for x in (-2.25, 0.0, 2.25):
        cutter = (
            cq.Workplane("XY")
            .box(0.55, head_w + 1.0, MENU_GROOVE_DEPTH + 0.10,
                 centered=(True, True, False))
            .translate((x, 0, MENU_TOP_H - MENU_GROOVE_DEPTH))
        )
        crown = crown.cut(cutter)
    return crown


def cap(role, clear_cap=P.FIT_CLEAR, outward=None, menu_grooves=True):
    """Build one printable cap at the origin for a semantic button ``role``."""
    if role not in ROLES:
        raise ValueError(f"unknown button role {role!r}; expected one of {ROLES}")

    if role == "menu":
        base, head_l, head_w = _pill_mechanical_base(clear_cap)
        crown = _menu_crown(head_l, head_w, menu_grooves)
        result = base.union(crown).clean()
        return result.edges(">Z").fillet(TOP_EDGE_FILLET[role]).clean()

    hole_d = P.AB_CAP_D if role in ("undo", "action") else P.DIR_CAP_D
    base, head_d = _round_mechanical_base(hole_d, clear_cap)
    if role in DIRECTION_ROLES:
        crown = _direction_crown(head_d, outward or OUTWARD[role])
    elif role == "undo":
        crown = _dished_crown(head_d, UNDO_RIM_H, UNDO_DISH_DEPTH)
    elif role == "action":
        crown = _action_crown(head_d)
    else:
        crown = _dished_crown(head_d, RESET_RIM_H, RESET_DISH_DEPTH)
    result = base.union(crown).clean()
    if role in TOP_EDGE_FILLET:
        result = result.edges(">Z").fillet(TOP_EDGE_FILLET[role])
    return result.clean()


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "sculpted_buttons")
PRINT_GRID = 18.0
SPRUE_W = 1.4


def _shape(obj):
    return obj.val() if hasattr(obj, "val") else obj


def placed_cap(station, clear_cap=P.FIT_CLEAR):
    """Place a role cap into the same model frame as the exported shell."""
    shape = cap(station.role, clear_cap)
    if station.role == "menu" and P.MENU_ANGLE:
        shape = shape.rotate((0, 0, 0), (0, 0, 1), -P.MENU_ANGLE)
    return shell_front.to_model_space(shape.translate((station.x, station.y, 0)))


def printable_set(clear_cap=P.FIT_CLEAR):
    """All eight caps joined by removable sprues at hidden flange height."""
    result = cq.Workplane("XY")
    positions = []
    for index, role in enumerate(ROLES):
        x = (index % 4) * PRINT_GRID
        y = (index // 4) * PRINT_GRID
        positions.append((x, y))
        result = result.union(cap(role, clear_cap).translate((x, y, 0)))

    z0 = -(P.FACE_T + P.CAP_FLANGE_T)
    for index, (ax, ay) in enumerate(positions):
        for bx, by in positions[index + 1:]:
            if abs(abs(ax - bx) + abs(ay - by) - PRINT_GRID) > 1e-6:
                continue
            sprue = (
                cq.Workplane("XY")
                .box(
                    abs(bx - ax) or SPRUE_W,
                    abs(by - ay) or SPRUE_W,
                    P.CAP_FLANGE_T,
                    centered=(True, True, False),
                )
                .translate(((ax + bx) / 2, (ay + by) / 2, z0))
            )
            result = result.union(sprue)
    return result.clean()


def export_prototype(out_dir=OUT):
    """Export printable parts and assembled comparison previews."""
    os.makedirs(out_dir, exist_ok=True)
    placed = []
    written = []

    for station in STATIONS:
        loose = cap(station.role)
        for ext in ("stl", "step"):
            path = os.path.join(out_dir, f"cap_{station.role}.{ext}")
            cq.exporters.export(loose, path)
            written.append(path)
        seated = placed_cap(station)
        placed.append(_shape(seated))

    caps_compound = cq.Compound.makeCompound(placed)
    for name in ("caps_placed.step", "caps_placed.stl"):
        path = os.path.join(out_dir, name)
        cq.exporters.export(caps_compound, path)
        written.append(path)

    sprued = printable_set()
    for name in ("sculpted_cap_set.step", "sculpted_cap_set.stl"):
        path = os.path.join(out_dir, name)
        cq.exporters.export(sprued, path)
        written.append(path)

    front = _shape(shell_front.build())
    preview = cq.Compound.makeCompound([front, *placed])
    for name in ("front_preview.step", "front_preview.stl"):
        path = os.path.join(out_dir, name)
        cq.exporters.export(preview, path)
        written.append(path)
    return tuple(written)


def main():
    written = export_prototype()
    print(f"sculpted buttons: {len(ROLES)} roles, clearance {P.FIT_CLEAR:.2f} mm")
    print(f"wrote {len(written)} files to {OUT}")
    for role in ROLES:
        bb = cap(role).val().BoundingBox()
        print(f"  {role:6} crown {bb.zmax:.2f} mm above face")


if __name__ == "__main__":
    main()
