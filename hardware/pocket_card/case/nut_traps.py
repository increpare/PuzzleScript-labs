"""Isolated side-loading captive-nut geometry for the Pocket Card front."""

import math

import cadquery as cq

import joints
import params as P
try:
    from .nut_trap_sites import NutTrapSite, sites
except ImportError:
    from nut_trap_sites import NutTrapSite, sites


# Preview hardware deliberately omits helical thread geometry.  The 1.6 mm
# axial bore is a faithful visual approximation of the M2 internal minor
# diameter (basic ISO M2 coarse D1 is 1.567 mm), while the shaft remains the
# nominal 2.0 mm major diameter so threaded engagement stays visible.
PREVIEW_NUT_THREAD_D = 1.6
PREVIEW_SCREW_SHAFT_D = 2.0
PREVIEW_SCREW_HEAD_H = 1.5


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


def _translation_sweep(site, across_flats, travel):
    """Return the exact convex nut volume swept over ``travel`` millimetres."""
    _require_across_flats(across_flats)
    _require_positive("travel", travel)
    corner_radius = hex_corner_diameter(across_flats) / 2.0
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


def insertion_sweep(site, across_flats=P.NUT_NOMINAL_AF):
    """Return the exact convex volume swept by the nut's straight translation."""
    travel = math.hypot(*insertion_offsets(site, across_flats)[0])
    return _translation_sweep(site, across_flats, travel)


def _require_controller_site(site):
    if site.kind != "pcb":
        raise ValueError("controller chute geometry requires a pcb site")


def _local_to_site(shape, site):
    return _placed(
        shape.rotate(
            (0.0, 0.0, 0.0),
            (0.0, 0.0, 1.0),
            _mouth_angle(site),
        ),
        site,
    )


def _controller_stage_distance(site):
    _require_controller_site(site)
    # Keep the complete production-clearance opening outside the circular cage
    # roof, not merely the nominal 4.0 mm nut.  This preserves the full roof
    # load section while retaining 0.1 mm of process separation.
    return (
        P.NUT_ENVELOPE_R
        + hex_corner_diameter(P.NUT_AF) / 2.0
        + 0.1
    )


def controller_stage_nut(site, across_flats=P.NUT_NOMINAL_AF):
    """Return the low nut position inside the rigid open-top staging chute."""
    _require_controller_site(site)
    mouth_x, mouth_y = _normalized_mouth(site)
    distance = _controller_stage_distance(site)
    offset_x, offset_y = mouth_x * distance, mouth_y * distance
    return nut_solid(site, across_flats).translate((offset_x, offset_y, 0.0))


def controller_stage_opening(site):
    """Return the complete top opening where the PCB caps the staged nut.

    The thin probe lies just inside the controller FR4 rather than on its
    coincident front face, making actual-board coverage deterministic.
    """
    _require_controller_site(site)
    distance = _controller_stage_distance(site)
    local = (
        cq.Workplane("XY")
        .workplane(offset=-P.PCB_FRONT_Z)
        .polygon(6, hex_corner_diameter(P.NUT_AF))
        .extrude(-0.05)
        .translate((distance, 0.0, 0.0))
    )
    return _local_to_site(local, site)


def _controller_stage_void(site):
    """Open the staging pocket axially so a nut can be dropped before PCB fit."""
    _require_controller_site(site)
    distance = _controller_stage_distance(site)
    cavity_front_z = site.nut_front_z + 0.1
    split_back_z = -(P.BODY_T - P.LID_T) - P.CONTROLLER_DROP_OVERTRAVEL
    local = (
        cq.Workplane("XY")
        .workplane(offset=cavity_front_z)
        .polygon(6, hex_corner_diameter(P.NUT_AF))
        .extrude(split_back_z - cavity_front_z)
        .translate((distance, 0.0, 0.0))
    )
    return _local_to_site(local, site)


def _controller_drop_sweep(site):
    """Exact nominal-nut volume swept from above the rails onto the floor."""
    _require_controller_site(site)
    raised_front_z = site.roof_back_z - P.CONTROLLER_DROP_OVERTRAVEL
    sweep_thickness = (
        P.NUT_MAX_T + site.nut_front_z - raised_front_z
    )
    mouth_x, mouth_y = _normalized_mouth(site)
    distance = _controller_stage_distance(site)
    offset_x, offset_y = mouth_x * distance, mouth_y * distance
    return nut_solid(site, thickness=sweep_thickness).translate(
        (offset_x, offset_y, 0.0)
    )


def controller_loading_sweep(site):
    """Exact pre-PCB drop then low slide from the chute into the nut seat."""
    _require_controller_site(site)
    low_slide = _translation_sweep(
        site,
        P.NUT_NOMINAL_AF,
        _controller_stage_distance(site),
    )
    return _controller_drop_sweep(site).union(low_slide)


def _moving_button_travel_voids():
    """Moving flange envelopes that a nearby chute must never refill."""
    voids = cq.Workplane("XY")
    for x, y, diameter in (
        (P.UNDO_X, P.UNDO_Y, P.AB_CAP_D),
        (P.ACT_X, P.ACT_Y, P.AB_CAP_D),
        (P.RESET_X, P.RESET_Y, P.RESET_CAP_D),
    ):
        radius = diameter / 2.0 + P.CAP_FLANGE_OS
        voids = voids.union(
            cq.Workplane("XY")
            .circle(radius)
            .extrude(-(P.FACE_T + P.COLLAR_DEPTH + P.CAP_PROUD))
            .translate((x, y, P.CAP_PROUD))
        )
    return voids


def controller_chute_material(site):
    """Rigid U-chute whose open top is capped by the installed controller.

    Two full-height rails leave the production 4.6 mm throat between them.
    The outer end wall stops a low nut; the PCB sits 0.2 mm above the wall
    tops, so the 1.6 mm nut cannot lift out after assembly.  Before the board
    is installed, the nut drops into the open stage and slides under the cage
    roof without any flexing or snap fit.
    """
    _require_controller_site(site)
    distance = _controller_stage_distance(site)
    nut_half_along = hex_corner_diameter(P.NUT_NOMINAL_AF) / 2.0
    end_inner = distance + nut_half_along + P.CONTROLLER_CHUTE_END_CLEAR
    end_outer = end_inner + P.CONTROLLER_CHUTE_WALL
    rail_start = P.CONTROLLER_CHUTE_OVERLAP
    rail_length = end_outer - rail_start
    rail_center = (rail_start + end_outer) / 2.0
    rail_offset = P.NUT_THROAT_W / 2.0 + P.CONTROLLER_CHUTE_WALL / 2.0
    z_front = site.nut_front_z + 0.1
    height = z_front - site.roof_back_z

    local = cq.Workplane("XY")
    for across in (-rail_offset, rail_offset):
        local = local.union(
            cq.Workplane("XY")
            .box(
                rail_length,
                P.CONTROLLER_CHUTE_WALL,
                height,
                centered=(True, True, False),
            )
            .translate((rail_center, across, site.roof_back_z))
        )
    local = local.union(
        cq.Workplane("XY")
        .box(
            P.CONTROLLER_CHUTE_WALL,
            P.NUT_THROAT_W + 2.0 * P.CONTROLLER_CHUTE_WALL,
            height,
            centered=(True, True, False),
        )
        .translate((
            (end_inner + end_outer) / 2.0,
            0.0,
            site.roof_back_z,
        ))
    )
    return _local_to_site(local, site).cut(_moving_button_travel_voids())


def controller_loading_voids(site):
    """Clearance needed before the rigid chute walls are fused into the shell."""
    _require_controller_site(site)
    return controller_loading_sweep(site).union(_controller_stage_void(site))
