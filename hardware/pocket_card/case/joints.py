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
import cadquery as cq

import params as P
import side_arc

SHAFT_CLEAR_D = 2.6         # clearance for the self-tapper shank
HEAD_D = 5.0
HEAD_H = 1.5                # seat depth below the local outer surface
HEAD_CLEAR = 0.15           # radial play on the head pocket


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
        """(z_lo, z_hi) of the outer back over the head footprint."""
        r = self.head_r
        xs = (self.x - r, self.x - r / 2, self.x, self.x + r / 2, self.x + r)
        zs = [side_arc.outer_back_z_at(xi, self.y) for xi in xs]
        return min(zs), max(zs)

    @property
    def seat_z(self):
        return self.skin_range()[1] + HEAD_H

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
