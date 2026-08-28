"""Isolated side-loading captive-nut geometry for the Pocket Card front."""

import math
from dataclasses import dataclass

import cadquery as cq

import joints
import params as P


# Preview hardware deliberately omits helical thread geometry.  The 1.6 mm
# axial bore is a faithful visual approximation of the M2 internal minor
# diameter (basic ISO M2 coarse D1 is 1.567 mm), while the shaft remains the
# nominal 2.0 mm major diameter so threaded engagement stays visible.
PREVIEW_NUT_THREAD_D = 1.6
PREVIEW_SCREW_SHAFT_D = 2.0
PREVIEW_SCREW_HEAD_H = 1.5


@dataclass(frozen=True)
class NutTrapSite:
    x: float
    y: float
    kind: str
    mouth: tuple[int, int]

    def __post_init__(self):
        try:
            mouth_x, mouth_y = self.mouth
        except (TypeError, ValueError) as error:
            raise ValueError("mouth must be a two-component vector") from error
        try:
            finite = all(
                math.isfinite(component) for component in (mouth_x, mouth_y)
            )
        except TypeError as error:
            raise ValueError("mouth components must be finite numbers") from error
        if not finite:
            raise ValueError("mouth components must be finite")
        if math.hypot(mouth_x, mouth_y) == 0.0:
            raise ValueError("mouth vector must be nonzero")

    @property
    def nut_front_z(self):
        return -P.FACE_T

    @property
    def cavity_back_z(self):
        return self.nut_front_z - P.NUT_CAVITY_T

    @property
    def roof_back_z(self):
        return self.cavity_back_z - P.NUT_ROOF_T


def sites():
    """Return the six closure sites in their stable assembly order."""
    module_x = (
        P.MOD_X + P.MOUNT_INSET,
        P.MOD_X + P.MOD_W - P.MOUNT_INSET,
    )
    module_y = (
        P.MOD_Y + P.MOUNT_INSET,
        P.MOD_Y + P.MOD_H - P.MOUNT_INSET,
    )
    return (
        NutTrapSite(module_x[0], module_y[0], "module", (1, 1)),
        NutTrapSite(module_x[0], module_y[1], "module", (1, -1)),
        NutTrapSite(module_x[1], module_y[0], "module", (-1, 1)),
        NutTrapSite(module_x[1], module_y[1], "module", (-1, -1)),
        NutTrapSite(*P.PCB_MOUNTS[0], "pcb", (0, 1)),
        NutTrapSite(*P.PCB_MOUNTS[1], "pcb", (0, -1)),
    )


def cage_radius(across_flats=P.NUT_AF):
    """Minimum radial envelope for a hex cavity and its printable wall."""
    _require_across_flats(across_flats)
    return across_flats / math.sqrt(3.0) + P.NUT_WALL


def hex_corner_diameter(across_flats):
    """Return a regular hexagon's corner diameter from its across-flats size."""
    _require_across_flats(across_flats)
    return 2.0 * across_flats / math.sqrt(3.0)


def _require_positive(name, value):
    try:
        valid = math.isfinite(value) and value > 0.0
    except TypeError as error:
        raise ValueError(f"{name} must be a positive finite number") from error
    if not valid:
        raise ValueError(f"{name} must be a positive finite number")


def _require_across_flats(across_flats):
    """Reject dimensions below the empirically verified OCC safety margin."""
    _require_positive("across_flats", across_flats)
    if across_flats < P.NUT_KERNEL_MIN_AF:
        raise ValueError(
            "across_flats must be at least "
            f"{P.NUT_KERNEL_MIN_AF:g} mm for reliable CadQuery geometry"
        )


def _normalized_mouth(site):
    mouth_x, mouth_y = site.mouth
    length = math.hypot(mouth_x, mouth_y)
    if not math.isfinite(length) or length == 0.0:
        raise ValueError("mouth vector must be finite and nonzero")
    return mouth_x / length, mouth_y / length


def _mouth_angle(site):
    mouth_x, mouth_y = _normalized_mouth(site)
    return math.degrees(math.atan2(mouth_y, mouth_x))


def _placed(shape, site):
    return shape.translate((site.x, site.y, 0.0))


def _hex_prism(site, across_flats, z_front, thickness):
    _require_across_flats(across_flats)
    _require_positive("thickness", thickness)
    return _placed(
        (
            cq.Workplane("XY")
            .polygon(6, hex_corner_diameter(across_flats))
            .extrude(-thickness)
            .translate((0.0, 0.0, z_front))
            .rotate((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), _mouth_angle(site))
        ),
        site,
    )


def nut_solid(
    site,
    across_flats=P.NUT_NOMINAL_AF,
    thickness=P.NUT_MAX_T,
):
    """Return a physical preview nut seated against the front-side floor."""
    return _hex_prism(site, across_flats, site.nut_front_z, thickness)


def _preview_nut(site):
    """DIN 934 M2 envelope with a simplified, non-helical thread bore."""
    thread_bore = (
        cq.Workplane("XY")
        .circle(PREVIEW_NUT_THREAD_D / 2.0)
        .extrude(-P.NUT_MAX_T)
        .translate((site.x, site.y, site.nut_front_z))
    )
    return nut_solid(site).cut(thread_bore)


def _preview_screw(selection):
    """Selected M2 pan-head envelope, measured under the seated head."""
    shaft = (
        cq.Workplane("XY")
        .circle(PREVIEW_SCREW_SHAFT_D / 2.0)
        .extrude(selection.length)
        .translate((selection.x, selection.y, selection.seat_z))
    )
    head = (
        cq.Workplane("XY")
        .circle(joints.HEAD_D / 2.0)
        .extrude(PREVIEW_SCREW_HEAD_H)
        .translate(
            (
                selection.x,
                selection.y,
                selection.seat_z - PREVIEW_SCREW_HEAD_H,
            )
        )
    )
    return head.union(shaft)


def preview_fasteners():
    """Return six nuts and selected screws in stable layout-space order.

    Names alternate by authoritative site order: ``nut_1``, ``screw_1``, ...,
    ``nut_6``, ``screw_6``.  Callers that export the complete assembly apply
    ``shell_front.to_model_space`` exactly once.
    """
    site_list = sites()
    selections = joints.selected_screws()
    if tuple((site.x, site.y, site.kind) for site in site_list) != tuple(
        (selection.x, selection.y, selection.kind) for selection in selections
    ):
        raise ValueError("nut-trap and selected-screw site order differs")
    return tuple(
        entry
        for index, (site, selection) in enumerate(
            zip(site_list, selections), 1
        )
        for entry in (
            (f"nut_{index}", _preview_nut(site)),
            (f"screw_{index}", _preview_screw(selection)),
        )
    )


def _mouth_prism(site, width, z0, z1):
    _require_positive("width", width)
    if not all(math.isfinite(z) for z in (z0, z1)) or z1 <= z0:
        raise ValueError("mouth prism requires finite z1 greater than z0")
    length = P.NUT_ENVELOPE_R + 2.0
    local = (
        cq.Workplane("XY")
        .box(length, width, z1 - z0, centered=(True, True, False))
        .translate((length / 2.0, 0.0, z0))
        .rotate((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), _mouth_angle(site))
    )
    return _placed(local, site)


def front_material(site):
    """Return the fixed-envelope cage fused 0.1 mm into the front face."""
    front_z = site.nut_front_z + 0.1
    return _placed(
        (
            cq.Workplane("XY")
            .workplane(offset=site.roof_back_z)
            .circle(P.NUT_ENVELOPE_R)
            .extrude(front_z - site.roof_back_z)
        ),
        site,
    )


def screw_path(site, z_back):
    """Return the coaxial M2 clearance path through roof and tip relief."""
    z_front = site.nut_front_z + P.MACHINE_SCREW_TIP_RELIEF
    try:
        valid_z_back = math.isfinite(z_back) and z_back < z_front
    except TypeError as error:
        raise ValueError(
            "z_back must be finite and behind the screw-path front"
        ) from error
    if not valid_z_back:
        raise ValueError("z_back must be finite and behind the screw-path front")
    return _placed(
        (
            cq.Workplane("XY")
            .workplane(offset=z_back)
            .circle(P.MACHINE_SCREW_CLEAR_D / 2.0)
            .extrude(z_front - z_back)
        ),
        site,
    )


def _roof_transition(site, across_flats):
    """Return the 45-degree cavity-to-roof chamfer, or None inside the bore."""
    end_af = max(
        P.MACHINE_SCREW_CLEAR_D,
        across_flats - 2.0 * P.NUT_ROOF_TAPER,
    )
    if end_af >= across_flats:
        return None
    local = (
        cq.Workplane("XY")
        .workplane(offset=site.cavity_back_z)
        .polygon(6, hex_corner_diameter(across_flats))
        .workplane(offset=-P.NUT_ROOF_TAPER)
        .polygon(6, hex_corner_diameter(end_af))
        .loft(combine=True)
        .rotate((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), _mouth_angle(site))
    )
    return _placed(local, site)


def front_voids(site, across_flats=P.NUT_AF):
    """Return the hex cavity, side throat, and coaxial screw bore union."""
    _require_across_flats(across_flats)
    cavity_front_z = site.nut_front_z + 0.1
    cavity = _hex_prism(
        site,
        across_flats,
        cavity_front_z,
        cavity_front_z - site.cavity_back_z,
    )
    throat = _mouth_prism(
        site,
        P.NUT_THROAT_W,
        site.cavity_back_z,
        cavity_front_z,
    )
    bore = screw_path(site, site.roof_back_z - 0.1)
    voids = cavity.union(throat).union(bore)
    transition = _roof_transition(site, across_flats)
    return voids if transition is None else voids.union(transition)


def insertion_offsets(site, across_flats=P.NUT_NOMINAL_AF):
    """Return stable outside-to-seated XY translation offsets for a nut."""
    _require_across_flats(across_flats)
    nut_corner_radius = hex_corner_diameter(across_flats) / 2.0
    distance = P.NUT_ENVELOPE_R + nut_corner_radius + 0.1
    step_count = math.ceil(distance / 0.20)
    mouth_x, mouth_y = _normalized_mouth(site)
    offsets = tuple(
        (
            mouth_x * distance * (step_count - step) / step_count,
            mouth_y * distance * (step_count - step) / step_count,
        )
        for step in range(step_count)
    )
    return offsets + ((0.0, 0.0),)


def _convex_hull_2d(points):
    """Return a counter-clockwise monotonic-chain hull of XY point tuples."""
    ordered = sorted(set(points))

    def cross(origin, first, second):
        return (
            (first[0] - origin[0]) * (second[1] - origin[1])
            - (first[1] - origin[1]) * (second[0] - origin[0])
        )

    lower = []
    for point in ordered:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0.0:
            lower.pop()
        lower.append(point)

    upper = []
    for point in reversed(ordered):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0.0:
            upper.pop()
        upper.append(point)
    return tuple(lower[:-1] + upper[:-1])


def insertion_sweep(site, across_flats=P.NUT_NOMINAL_AF):
    """Return the exact convex volume swept by the nut's straight translation."""
    _require_across_flats(across_flats)
    corner_radius = hex_corner_diameter(across_flats) / 2.0
    travel = math.hypot(*insertion_offsets(site, across_flats)[0])
    seated_profile = tuple(
        (
            corner_radius * math.cos(math.radians(60.0 * vertex)),
            corner_radius * math.sin(math.radians(60.0 * vertex)),
        )
        for vertex in range(6)
    )
    hull = _convex_hull_2d(
        seated_profile
        + tuple((x + travel, y) for x, y in seated_profile)
    )
    local = (
        cq.Workplane("XY")
        .polyline(hull)
        .close()
        .extrude(-P.NUT_MAX_T)
        .translate((0.0, 0.0, site.nut_front_z))
        .rotate((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), _mouth_angle(site))
    )
    return _placed(local, site)
