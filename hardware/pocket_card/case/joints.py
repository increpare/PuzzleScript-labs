"""Screw joints: one spec per site drives every add/cut on the back shell.

A joint is land (material) + pocket/bore (voids), all derived together so the
pieces cannot disagree (the old Ø4.4 shoulder under a Ø5.3 pocket, the Ø3.6
rib bore around a Ø2.6 shaft — both were open rings by construction).

Geometry rules (see 2026-08-03 feature-framework spec):
- Seat plane: the selected depth inboard of the shallowest outer-back z over
  the head footprint, so the head gets a flat seat on the compound rear skin
  and the screw tip lands inside the captive-nut blind relief.
- Land: solid cylinder Ø(head + 2·LAND_WALL) from below the skin up to the
  joint's functional top. Pockets are cut into land, never into bare floor.
- Membrane: the land must keep ≥ MIN_MEMBRANE of solid ring above the seat;
  checks.py asserts this on the built solid.

Run through shell_back.py; checks in checks.py.
"""
import math
from dataclasses import dataclass

import cadquery as cq

import params as P
import side_arc

HEAD_D = 5.0
HEAD_CLEAR = 0.15           # radial play on the head pocket
STOCKED_MACHINE_SCREW_LENGTHS = (8.0, 10.0, 12.0, 14.0)
MIN_HEAD_SEAT_DEPTH = 1.5
# The lower-shifted rear form puts H1/H2 between the old 10/12 mm stock
# windows.  A 2.30 mm reinforced-land seat retains the same stocked lengths
# and 0.20..0.60 mm blind-tip engagement without changing the shaft axes.
MAX_HEAD_SEAT_DEPTH = 2.3
MIN_TIP_PROTRUSION = 0.2
MAX_TIP_PROTRUSION = 0.6


@dataclass(frozen=True)
class MachineScrewGeometry:
    length: float
    seat_depth: float
    tip_protrusion: float


def _finite_number(name, value):
    try:
        valid = math.isfinite(value)
    except TypeError as error:
        raise ValueError(f"{name} must be finite") from error
    if not valid:
        raise ValueError(f"{name} must be finite")
    return float(value)


def select_machine_screw(
        outer_back_z: float,
        nut_front_z: float = -P.FACE_T,
        stocked_lengths=STOCKED_MACHINE_SCREW_LENGTHS,
        min_seat_depth: float = MIN_HEAD_SEAT_DEPTH,
        max_seat_depth: float = MAX_HEAD_SEAT_DEPTH,
        min_tip_protrusion: float = MIN_TIP_PROTRUSION,
        max_tip_protrusion: float = MAX_TIP_PROTRUSION) -> MachineScrewGeometry:
    """Choose the shortest M2 screw and its shallowest valid head seat.

    ``outer_back_z`` is the shallowest sampled exterior point beneath the
    whole head footprint. Length is measured under the head at
    ``outer_back_z + seat_depth``. The screw must cross the captive nut's
    front plane and finish within its blind tip relief.
    """
    outer = _finite_number("outer_back_z", outer_back_z)
    nut_front = _finite_number("nut_front_z", nut_front_z)
    min_seat = _finite_number("min_seat_depth", min_seat_depth)
    max_seat = _finite_number("max_seat_depth", max_seat_depth)
    min_tip = _finite_number("min_tip_protrusion", min_tip_protrusion)
    max_tip = _finite_number("max_tip_protrusion", max_tip_protrusion)
    if min_seat < 0.0 or max_seat < min_seat:
        raise ValueError("seat depth range must be finite, nonnegative, and ordered")
    if min_tip < 0.0 or max_tip < min_tip:
        raise ValueError(
            "tip protrusion range must be finite, nonnegative, and ordered")

    try:
        stock = list(stocked_lengths)
    except TypeError as error:
        raise ValueError("stocked screw lengths must be an iterable") from error
    lengths = []
    for value in stock:
        try:
            valid = math.isfinite(value) and value > 0.0
        except TypeError as error:
            raise ValueError(
                "stocked screw lengths must be positive finite numbers") from error
        if not valid:
            raise ValueError(
                "stocked screw lengths must be positive finite numbers")
        lengths.append(float(value))

    for length in sorted(lengths):
        allowed_lo = nut_front + min_tip - outer - length
        allowed_hi = nut_front + max_tip - outer - length
        seat_depth = max(min_seat, allowed_lo)
        if seat_depth <= min(max_seat, allowed_hi):
            raw_tip = outer + seat_depth + length - nut_front
            # The feasibility equations guarantee this range algebraically;
            # clamp only the final floating-point representation so the
            # returned physical contract remains exact at inclusive bounds.
            tip = min(max(raw_tip, min_tip), max_tip)
            return MachineScrewGeometry(length, seat_depth, tip)
    raise ValueError(
        "no stocked machine screw satisfies the head-seat and tip-protrusion "
        f"ranges for outer_back_z={outer:.3f} mm")


@dataclass(frozen=True)
class ScrewSelection:
    x: float
    y: float
    kind: str
    length: float
    seat_depth: float
    seat_z: float
    tip_protrusion: float
    outer_back_z: float


class ScrewJoint:
    """One rear screw site on the back shell (layout coordinates)."""

    def __init__(self, x: float, y: float, kind: str):
        assert kind in ("module", "pcb")
        self.x, self.y, self.kind = float(x), float(y), kind
        self.head_r = HEAD_D / 2 + HEAD_CLEAR
        self.land_r = self.head_r + P.LAND_WALL
        # Coaxial M2 clearance path through the reinforced rear land.
        self.bore_r = P.MACHINE_SCREW_CLEAR_D / 2.0
        # Functional top: plane the supported board's rear rests on.
        if kind == "module":
            self.top_z = -(P.MODULE_Z + P.MOD_FRONT_STACK)       # module PCB back
        else:
            self.top_z = -(P.PCB_FRONT_Z + P.PCB_T)              # controller back

    # -- derived planes ----------------------------------------------------
    def skin_range(self):
        """(z_lo, z_hi) of the outer back over the head footprint.

        Samples the whole disc, not just the x-centreline. That was adequate
        while the back only curved in x; now the roll turns the corners, so a
        joint near the north edge varies in y too and an x-only scan reads a
        seat that is deeper than the shallowest skin over the head.
        """
        r = self.head_r
        pts = [(self.x, self.y)]
        for frac in (0.5, 1.0):
            for i in range(8):
                a = i * math.pi / 4
                pts.append((self.x + frac * r * math.cos(a),
                            self.y + frac * r * math.sin(a)))
        zs = [side_arc.outer_back_z_at(px, py) for px, py in pts]
        return min(zs), max(zs)

    @property
    def outer_back_z(self):
        """Shallowest sampled outer surface beneath the whole head."""
        return self.skin_range()[1]

    @property
    def machine_screw(self):
        return select_machine_screw(self.outer_back_z, -P.FACE_T)

    @property
    def seat_z(self):
        geometry = self.machine_screw
        return self.outer_back_z + geometry.seat_depth

    # -- geometry ----------------------------------------------------------
    def material(self) -> cq.Workplane:
        """Land: wide solid from below the skin to the functional top."""
        z0 = self.skin_range()[0] - 1.0    # clipped to envelope later
        return (cq.Workplane("XY").circle(self.land_r)
                .extrude(self.top_z - z0)
                .translate((self.x, self.y, z0)))

    def voids(self) -> cq.Workplane:
        """Head pocket to the flat seat + bore up through the land."""
        z_lo, _ = self.skin_range()
        seat = self.seat_z
        pocket = (cq.Workplane("XY").circle(self.head_r)
                  .extrude(seat - (z_lo - 2.0))
                  .translate((self.x, self.y, z_lo - 2.0)))
        bore = (cq.Workplane("XY").circle(self.bore_r)
                .extrude((self.top_z + 2.0) - (seat - 0.1))
                .translate((self.x, self.y, seat - 0.1)))
        return pocket.union(bore)


def back_joints():
    """All rear screw joints: four module mounts + the controller sites."""
    xs = (P.MOD_X + P.MOUNT_INSET, P.MOD_X + P.MOD_W - P.MOUNT_INSET)
    ys = (P.MOD_Y + P.MOUNT_INSET, P.MOD_Y + P.MOD_H - P.MOUNT_INSET)
    out = [ScrewJoint(x, y, "module") for x in xs for y in ys]
    out += [ScrewJoint(x, y, "pcb") for x, y in P.EXTRA_BOSSES]
    return out


def selected_screws():
    """Profile-aware stock selection for every rear screw joint."""
    out = []
    for joint in back_joints():
        geometry = joint.machine_screw
        out.append(ScrewSelection(
            x=joint.x,
            y=joint.y,
            kind=joint.kind,
            length=geometry.length,
            seat_depth=geometry.seat_depth,
            seat_z=joint.outer_back_z + geometry.seat_depth,
            tip_protrusion=geometry.tip_protrusion,
            outer_back_z=joint.outer_back_z,
        ))
    return tuple(out)


def screw_length_groups():
    """Selected screws grouped by length, with stable site ordering."""
    groups = {}
    for selection in selected_screws():
        groups.setdefault(selection.length, []).append(selection)
    return {
        length: tuple(sorted(items, key=lambda s: (s.y, s.x, s.kind)))
        for length, items in sorted(groups.items())
    }
