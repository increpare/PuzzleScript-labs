"""Isolated side-loading captive-nut geometry for the Pocket Card front."""

import math
from dataclasses import dataclass

import cadquery as cq

import params as P


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
    _require_positive("across_flats", across_flats)
    return across_flats / math.sqrt(3.0) + P.NUT_WALL


def hex_corner_diameter(across_flats):
    """Return a regular hexagon's corner diameter from its across-flats size."""
    _require_positive("across_flats", across_flats)
    return 2.0 * across_flats / math.sqrt(3.0)


def _require_positive(name, value):
    try:
        valid = math.isfinite(value) and value > 0.0
    except TypeError as error:
        raise ValueError(f"{name} must be a positive finite number") from error
    if not valid:
        raise ValueError(f"{name} must be a positive finite number")


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
    _require_positive("across_flats", across_flats)
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


def front_voids(site, across_flats=P.NUT_AF):
    """Return the hex cavity, side throat, and coaxial screw bore union."""
    _require_positive("across_flats", across_flats)
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
    return cavity.union(throat).union(bore)


def insertion_sweep(site, across_flats=P.NUT_NOMINAL_AF):
    """Return the continuous collision volume of a nut sliding into its seat."""
    _require_positive("across_flats", across_flats)
    nut_corner_radius = hex_corner_diameter(across_flats) / 2.0
    distance = P.NUT_ENVELOPE_R + nut_corner_radius + 0.1
    # At <=0.20 mm pitch successive 4.0 mm nominal hex prisms overlap deeply,
    # so their fused union is a conservative continuous translation volume.
    step_count = math.ceil(distance / 0.20)
    mouth_x, mouth_y = _normalized_mouth(site)
    sweep = None
    for step in range(step_count + 1):
        offset = distance * step / step_count
        nut = nut_solid(site, across_flats).translate(
            (mouth_x * offset, mouth_y * offset, 0.0)
        )
        sweep = nut if sweep is None else sweep.union(nut)
    return sweep
