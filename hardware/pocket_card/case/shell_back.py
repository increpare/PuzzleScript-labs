"""Back shell and controller PCB outline.

The back shell is a lid closing on the same four posts the module hangs from,
so the split line sits at the very back. It carries the battery fence, the
driver housing and the screw countersinks.

The PCB outline is generated here rather than drawn in KiCad, so it derives
from the enclosure instead of the other way round. It exports DXF for import
as a board outline.

Run:  .venv/bin/python shell_back.py
"""
import os

import cadquery as cq

import params as P

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

CORNER_R = 4.5
SHELL_DEPTH = P.BODY_T - P.WALL        # front shell runs to here
LID_Z0 = -P.BODY_T                     # outer back surface
LID_Z1 = -SHELL_DEPTH                  # meets the front shell's wall ends
RIM_H = 1.2                            # alignment lip into the front cavity
RIM_CLEAR = 0.25
SCREW_CLEAR_D = 2.6
SCREW_HEAD_D = 5.0
FENCE_H = 2.0
FENCE_T = 1.2


def lid():
    body = (cq.Workplane("XY")
            .box(P.BODY_W, P.BODY_H, P.WALL, centered=(False, False, False))
            .translate((0, 0, LID_Z0))
            .edges("|Z").fillet(CORNER_R))

    # alignment rim, sitting inside the front shell's cavity
    w = P.BODY_W - 2 * P.WALL - 2 * RIM_CLEAR
    h = P.BODY_H - 2 * P.WALL - 2 * RIM_CLEAR
    rim = (cq.Workplane("XY")
           .box(w, h, RIM_H, centered=(False, False, False))
           .translate((P.WALL + RIM_CLEAR, P.WALL + RIM_CLEAR, LID_Z1))
           .edges("|Z").fillet(max(CORNER_R - P.WALL, 0.6)))
    inner = (cq.Workplane("XY")
             .box(w - 2 * FENCE_T, h - 2 * FENCE_T, RIM_H + 1, centered=(False, False, False))
             .translate((P.WALL + RIM_CLEAR + FENCE_T, P.WALL + RIM_CLEAR + FENCE_T,
                         LID_Z1 - 0.5))
             .edges("|Z").fillet(0.6))
    return body.union(rim.cut(inner))


def battery_fence():
    """Ribs that stop the cell sliding. Open on one side for the lead."""
    x = P.BATT_X - P.BATT_CLEAR
    y = P.BATT_Y - P.BATT_CLEAR
    w = P.CELL_W + 2 * P.BATT_CLEAR
    h = P.CELL_H + 2 * P.BATT_CLEAR
    outer = (cq.Workplane("XY")
             .box(w + 2 * FENCE_T, h + 2 * FENCE_T, FENCE_H, centered=(False, False, False))
             .translate((x - FENCE_T, y - FENCE_T, LID_Z1)))   # inward, not out the back
    pocket = (cq.Workplane("XY")
              .box(w, h, FENCE_H + 1, centered=(False, False, False))
              .translate((x, y, LID_Z1 - 0.5)))
    fence = outer.cut(pocket)
    # open at the top: the PCB support rib sits in that strip and retains the
    # cell from above, so a fence rib there would be a second feature competing
    # for space that does not exist
    fence = fence.cut(
        cq.Workplane("XY")
        .box(w + 2 * FENCE_T + 2, FENCE_T + 1, FENCE_H + 1,
             centered=(False, False, False))
        .translate((x - FENCE_T - 1, y - FENCE_T - 0.5, LID_Z1 - 0.5)))
    # gap on the left wall for the battery lead to exit upward
    gap = (cq.Workplane("XY")
           .box(FENCE_T + 1, 10.0, FENCE_H + 1, centered=(False, True, False))
           .translate((x - FENCE_T - 0.5, y + h / 2, LID_Z1 - 0.5)))
    return fence.cut(gap)


def driver_housing():
    """Ring behind the driver, pressing it forward against the grille chamber.

    Relieved wherever a screw boss encroaches. The ring only has to hold the
    driver against the chamber, so it does not need to be continuous -- which
    saves moving the grille every time the bottom-right corner gets crowded.
    """
    w, h = P.DRIVER_W + 0.6, P.DRIVER_H + 0.6
    outer = (cq.Workplane("XY")
             .box(w + 2 * FENCE_T, h + 2 * FENCE_T, FENCE_H,
                  centered=(True, True, False))
             .translate((P.GRILLE_X, P.GRILLE_Y, LID_Z1)))
    pocket = (cq.Workplane("XY")
              .box(w, h, FENCE_H + 1, centered=(True, True, False))
              .translate((P.GRILLE_X, P.GRILLE_Y, LID_Z1 - 0.5)))
    ring = outer.cut(pocket)
    for bx, by in P.EXTRA_BOSSES:
        ring = ring.cut(
            cq.Workplane("XY").circle(3.0).extrude(FENCE_H + 1)
            .translate((bx, by, LID_Z1 - 0.5)))
    return ring


MOD_PCB_BACK = P.MODULE_Z + P.MOD_FRONT_STACK       # 7.50


def module_support():
    """Ribs bearing on the module's rear, around each screw position.

    Without these the module hangs on four plain posts with nothing setting it
    axially -- so it would end up resting on the front face, which the July 12
    spec forbids ("the bezel must not press on the touch/LCD stack"), and any
    pull on the module's connectors would work it back and forth.

    With the front shell's shoulders in front and these behind, the board is
    properly sandwiched at all four corners.
    """
    h = SHELL_DEPTH - MOD_PCB_BACK                  # 5.30
    xs = (P.MOD_X + P.MOUNT_INSET, P.MOD_X + P.MOD_W - P.MOUNT_INSET)
    ys = (P.MOD_Y + P.MOUNT_INSET, P.MOD_Y + P.MOD_H - P.MOUNT_INSET)
    ribs = cq.Workplane("XY")
    for x in xs:
        for y in ys:
            ribs = ribs.union(
                cq.Workplane("XY").circle(3.5).circle(1.8)   # bore clears the Ø3.0 post
                .extrude(h).translate((x, y, LID_Z1)))
    return ribs


def pcb_support_rib():
    """Bears on the controller PCB's rear, above the cell.

    The direction cluster is 54 mm from the nearest mounting screw and the cell
    sits directly behind it, so nothing can support it there. This rib runs
    along the strip between the board's top edge and the cell, putting support
    within 6 mm of the up button and 24 mm of the rest.
    """
    pcb_back = P.PCB_FRONT_Z + P.PCB_T
    h = SHELL_DEPTH - pcb_back
    return (cq.Workplane("XY")
            .box(P.PCB_RIB_X1 - P.PCB_RIB_X0, P.PCB_RIB_Y1 - P.PCB_RIB_Y0, h,
                 centered=(False, False, False))
            .translate((P.PCB_RIB_X0, P.PCB_RIB_Y0, LID_Z1)))


def pcb_support_pads():
    """Pads bearing on the board's rear where a through-pillar cannot go.

    The top-right corner is inside Action's collar footprint, so nothing can
    come up through the board there. A pad from behind has no such problem: the
    collars are in front of the board and the press force is toward the back.
    """
    pcb_back = P.PCB_FRONT_Z + P.PCB_T
    h = SHELL_DEPTH - pcb_back
    pads = cq.Workplane("XY")
    for x, y in P.PCB_SUPPORT_PADS:
        pads = pads.union(
            cq.Workplane("XY").circle(P.PCB_PAD_D / 2).extrude(h)
            .translate((x, y, LID_Z1)))
    return pads


def screw_holes():
    xs = (P.MOD_X + P.MOUNT_INSET, P.MOD_X + P.MOD_W - P.MOUNT_INSET)
    ys = (P.MOD_Y + P.MOUNT_INSET, P.MOD_Y + P.MOD_H - P.MOUNT_INSET)
    sites = [(x, y) for x in xs for y in ys] + list(P.EXTRA_BOSSES)
    cuts = cq.Workplane("XY")
    if True:
        for x, y in sites:
            cuts = cuts.union(
                cq.Workplane("XY").circle(SCREW_CLEAR_D / 2).extrude(P.WALL + 4)
                .translate((x, y, LID_Z0 - 1)))
            cuts = cuts.union(
                cq.Workplane("XY")
                .circle(SCREW_HEAD_D / 2).workplane(offset=1.4).circle(SCREW_CLEAR_D / 2)
                .loft()
                .translate((x, y, LID_Z0 - 0.01)))
    return cuts


def to_model_space(shape):
    """See shell_front.to_model_space -- layout y is down, model y is up."""
    return shape.mirror("XZ").translate((0, P.BODY_H, 0))


def build_back():
    s = lid()
    s = s.union(battery_fence())
    s = s.union(driver_housing())
    s = s.union(module_support())
    s = s.union(pcb_support_rib())
    s = s.union(pcb_support_pads())
    s = s.cut(screw_holes())
    return to_model_space(s)


def pcb_outline_wire():
    """Board outline with the driver notch taken out of the bottom-right."""
    board = (cq.Workplane("XY")
             .box(P.PCB_W, P.PCB_H, 1.6, centered=(False, False, False))
             .translate((P.PCB_X, P.PCB_Y, 0))
             .edges("|Z").fillet(2.0))
    notch = (cq.Workplane("XY")
             .box(P.DRIVER_W + 1.6, P.DRIVER_H + 1.6, 4, centered=(True, True, False))
             .translate((P.GRILLE_X, P.GRILLE_Y, -1)))
    return to_model_space(board.cut(notch))


if __name__ == "__main__":
    back = build_back()
    cq.exporters.export(back, os.path.join(OUT, "shell_back.stl"))
    cq.exporters.export(back, os.path.join(OUT, "shell_back.step"))
    bb = back.val().BoundingBox()
    print(f"shell_back   {bb.xlen:.2f} x {bb.ylen:.2f} x {bb.zlen:.2f}")
    print(f"  battery fence  {P.CELL_W} x {P.CELL_H} cell at "
          f"({P.BATT_X}, {P.BATT_Y}), {P.BATT_CLEAR} clearance")
    print(f"  driver fence   {P.DRIVER_W} x {P.DRIVER_H} at ({P.GRILLE_X}, {P.GRILLE_Y})")

    pcb = pcb_outline_wire()
    cq.exporters.export(pcb, os.path.join(OUT, "pcb_outline.stl"))
    cq.exporters.export(pcb, os.path.join(OUT, "pcb_outline.step"))
    cq.exporters.export(pcb.faces("<Z").wires(), os.path.join(OUT, "pcb_outline.dxf"))
    pb = pcb.val().BoundingBox()
    print(f"pcb_outline  {pb.xlen:.2f} x {pb.ylen:.2f}  "
          f"at ({P.PCB_X}, {P.PCB_Y})  -> DXF for KiCad")
