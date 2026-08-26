"""Screw joints: one spec per site drives every add/cut on the back shell.

A joint is land (material) + pocket/bore (voids), all derived together so the
pieces cannot disagree (the old Ø4.4 shoulder under a Ø5.3 pocket, the Ø3.6
rib bore around a Ø2.6 shaft — both were open rings by construction).

Geometry rules (see 2026-08-03 feature-framework spec):
- Seat plane: highest outer-back z over the head footprint + SCREW_HEAD_H,
  so the head always gets a flat seat even on the curved side arcs.
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

SHAFT_CLEAR_D = 2.6         # clearance for the self-tapper shank
HEAD_D = 5.0
HEAD_H = 1.5                # seat depth below the local outer surface
HEAD_CLEAR = 0.15           # radial play on the head pocket
STOCKED_SCREW_LENGTHS = (8.0, 10.0, 12.0)
MIN_THREAD_ENGAGEMENT = 2.5


def select_screw_length(shank_span: float,
                        stocked_lengths=STOCKED_SCREW_LENGTHS,
                        min_engagement: float = MIN_THREAD_ENGAGEMENT) -> float:
    """Shortest stock screw that bridges ``shank_span`` and still bites.

    Length is measured under the head, so the span starts at the rear seat and
    ends at the entrance to the front-shell pilot.  Keeping this arithmetic
    independent of the CAD objects makes the stock decision directly testable.
    """
    span = float(shank_span)
    engagement = float(min_engagement)
    if not math.isfinite(span) or span < 0:
        raise ValueError(f"invalid screw shank span {shank_span!r}")
    for length in sorted(float(v) for v in stocked_lengths):
        if length - span >= engagement - 1e-9:
            return length
    raise ValueError(
        f"no stocked screw reaches across {span:.2f} mm with "
        f"{engagement:.2f} mm thread engagement")


@dataclass(frozen=True)
class ScrewSelection:
    x: float
    y: float
    kind: str
    shank_span: float
    length: float

    @property
    def engagement(self) -> float:
        return self.length - self.shank_span


class ScrewJoint:
    """One rear screw site on the back shell (layout coordinates)."""

    def __init__(self, x: float, y: float, kind: str):
        assert kind in ("module", "pcb")
        self.x, self.y, self.kind = float(x), float(y), kind
        self.head_r = HEAD_D / 2 + HEAD_CLEAR
        self.land_r = self.head_r + P.LAND_WALL
        # Bore through the land above the seat: shaft, and on PCB sites also
        # the front pin tip (Ø PCB_POST_D + play) which enters the same bore.
        bore_d = SHAFT_CLEAR_D + 0.3
        if kind == "pcb":
            bore_d = max(bore_d, P.PCB_POST_D + 0.35)
        self.bore_r = bore_d / 2
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
    def seat_z(self):
        return self.skin_range()[1] + HEAD_H

    @property
    def pilot_entry_z(self):
        """Rear entrance of the matching pilot in the front-shell post."""
        if self.kind == "module":
            return -(P.BODY_T - P.LID_T)
        return -(P.PCB_FRONT_Z + P.PCB_T + P.PCB_PIN_TIP)

    @property
    def shank_span(self):
        """Distance from the rear head seat to the front-pilot entrance."""
        return self.pilot_entry_z - self.seat_z

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
        span = joint.shank_span
        out.append(ScrewSelection(
            joint.x,
            joint.y,
            joint.kind,
            span,
            select_screw_length(span),
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
