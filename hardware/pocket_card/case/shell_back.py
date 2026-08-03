"""Back shell and controller PCB outline.

Deeper back tray (LID_T) with a shaped full-perimeter lip into the front
cavity. Owns the USB-C aperture. Closes on the module posts / PCB shoulders.

The PCB outline is generated here rather than drawn in KiCad, so it derives
from the enclosure instead of the other way round. It exports DXF for import
as a board outline.

Run:  .venv/bin/python shell_back.py
"""
import os

import cadquery as cq

import joints
import params as P
import side_arc

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

CORNER_R = 4.5
SHELL_DEPTH = P.BODY_T - P.LID_T       # front shell ends here
LID_Z0 = -P.BODY_T                     # outer back surface
LID_Z1 = -SHELL_DEPTH                  # meets the front shell
RIB_Z0 = -P.RIB_ZONE_T                 # outer back inside the north rib
# Inner face of the back floor (WALL thick). Internal ribs rise from here.
# The rib's own floor is P.RIB_FLOOR_Z, RIB_H lower; nothing but the module's
# battery header lives down there, so internals still rise from FLOOR_Z.
FLOOR_Z = LID_Z0 + P.WALL
# Split-line lap geometry (LAP_*) lives in params.py — the front shell cuts
# the matching rebate from the same numbers.
# Screw shaft/head/land geometry lives in joints.py (single spec per site).
FENCE_T = 1.2
FENCE_H = 2.0                          # driver fence: the driver is only 3.5 thick
# Cell fence from the floor up to the board's rear (doubles as a ledge).
_PCB_BACK = P.PCB_FRONT_Z + P.PCB_T
CELL_FENCE_H = max((-FLOOR_Z) - _PCB_BACK, 0.8)  # FLOOR_Z→PCB in +Z


def cell_keepout(margin: float = 0.0):
    """Volume the battery may occupy (cell + BATT_CLEAR + margin), to floor."""
    pcb_back = P.PCB_FRONT_Z + P.PCB_T
    z_top = -(pcb_back + P.PET_T) + 0.5          # a hair past the cell front
    m = P.BATT_CLEAR + margin
    return (cq.Workplane("XY")
            .box(P.CELL_W + 2 * m, P.CELL_H + 2 * m, z_top - (FLOOR_Z - 0.5),
                 centered=False)
            .translate((P.BATT_X - m, P.BATT_Y - m, FLOOR_Z - 0.5)))


def split_tongue():
    """The tray's half of the lap: the inner LAP_T of the wall, run up past
    the split into the front shell's rebate.

    This is wall, not a lip inboard of it. The predecessor stood proud of the
    inner wall by RIM_CLEAR, which put it over the cavity rather than over the
    tray wall — it was a free-floating ring (lid() came out as two solids) and
    it ran straight through the module PCB. Living in the wall thickness costs
    no interior at all, and the tongue's inner face is the inner wall itself.

    Both faces are straight prisms at the split section, so the tongue has no
    draft: see side_arc.section_prism.
    """
    outer = side_arc.section_prism(P.WALL - P.LAP_T, LID_Z1,
                                   LID_Z1, LID_Z1 + P.LAP_H)
    inner = side_arc.section_prism(P.WALL, LID_Z1,
                                   LID_Z1 - 0.5, LID_Z1 + P.LAP_H + 0.5)
    return outer.cut(inner).cut(cell_keepout())


def lid():
    """Hollow tray: shaped outer band, WALL floor/sides, open at the split.

    Both the band and the void run to the rib's depth rather than BODY_T. The
    envelope already carries the rib, so a void taken from RIB_FLOOR_Z is the
    flat tray everywhere the rib is absent and the connector pocket where it is
    not — the pocket needs no separate feature, and cannot drift from the skin.
    """
    body = side_arc.shaped_outer_band(RIB_Z0, LID_Z1, CORNER_R)
    # Void from above the floor through the open face (into the front a hair).
    cav = side_arc.shaped_cavity_xy(P.WALL, P.RIB_FLOOR_Z, LID_Z1 + 0.5, CORNER_R)
    body = body.cut(cav)
    return body.union(split_tongue())


def battery_fence():
    """Ribs that stop the cell sliding. Open on one side for the lead."""
    x = P.BATT_X - P.BATT_CLEAR
    y = P.BATT_Y - P.BATT_CLEAR
    w = P.CELL_W + 2 * P.BATT_CLEAR
    h = P.CELL_H + 2 * P.BATT_CLEAR
    outer = (cq.Workplane("XY")
             .box(w + 2 * FENCE_T, h + 2 * FENCE_T, CELL_FENCE_H,
                  centered=(False, False, False))
             .translate((x - FENCE_T, y - FENCE_T, FLOOR_Z)))
    pocket = (cq.Workplane("XY")
              .box(w, h, CELL_FENCE_H + 1, centered=(False, False, False))
              .translate((x, y, FLOOR_Z - 0.5)))
    fence = outer.cut(pocket)
    # open at the top: the PCB support rib sits in that strip and retains the
    # cell from above, so a fence rib there would be a second feature competing
    # for space that does not exist
    fence = fence.cut(
        cq.Workplane("XY")
        .box(w + 2 * FENCE_T + 2, FENCE_T + 1, CELL_FENCE_H + 1,
             centered=(False, False, False))
        .translate((x - FENCE_T - 1, y - FENCE_T - 0.5, FLOOR_Z - 0.5)))
    # Gap on the RIGHT wall: cell → J_BAT_IN on the controller (B.Cu right-rear
    # pocket). J_BAT_OUT then runs to the module BAT — the lead does not go
    # left/direct to the module.
    gap_y = P.CONN_BAT_IN[1]   # dress toward the header
    gap = (cq.Workplane("XY")
           .box(FENCE_T + 1, 10.0, CELL_FENCE_H + 1, centered=(False, True, False))
           .translate((x + w - 0.5, gap_y, FLOOR_Z - 0.5)))
    return fence.cut(gap)


def driver_housing():   # NO LONGER USED -- the driver lives in the front shell
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


def usb_opening():
    """USB-C window in the left wall, cut as a prism along the plug axis.

    Sized off the module's receptacle, not off a plug overmold — see the USB-C
    block in params.py for why the overmold never reaches the case, and why
    sizing for it would cut a hole taller than the wall has room for.

    Two things the shape has to respect. The top edge is the split seam: the
    receptacle's top is 0.20 under it, so a window that stops short leaves a
    knife-edge ledge of tray wall beneath the joint. The cutter's top therefore
    runs a hair PAST the seam, both to avoid a coincident-plane sliver and
    because the front shell's skirt is what forms the port's upper edge; it
    costs 0.1 off the tongue's bottom over the port's span and nothing else.

    And it is a prism along +x rather than a hole normal to the skin, because
    the wall sweeps 1 deg to 40 deg across the port — the port sits wholly
    inside the back roll. It has to outrun the wall's inner face at the bottom
    of that sweep, which is what P.USB_CUT_X is for.
    """
    return (cq.Workplane("XY")
            .box(P.USB_CUT_X + 1.5, P.USB_W, (P.USB_Z1 + 0.1) - P.USB_Z0,
                 centered=(False, True, False))
            .translate((-1.5, P.USB_Y, P.USB_Z0)))


def pcb_support_rib():
    """Bears on the controller PCB's rear, above the cell.

    The direction cluster is 54 mm from the nearest mounting screw and the cell
    sits directly behind it, so nothing can support it there. This rib runs
    along the strip between the board's top edge and the cell, putting support
    within 6 mm of the up button and 24 mm of the rest.
    """
    pcb_back = P.PCB_FRONT_Z + P.PCB_T
    h = max((-FLOOR_Z) - pcb_back, 0.8)
    return (cq.Workplane("XY")
            .box(P.PCB_RIB_X1 - P.PCB_RIB_X0, P.PCB_RIB_Y1 - P.PCB_RIB_Y0, h,
                 centered=(False, False, False))
            .translate((P.PCB_RIB_X0, P.PCB_RIB_Y0, FLOOR_Z)))


def pcb_support_pads():
    """Pads bearing on the board's rear where a through-pillar cannot go.

    The top-right corner is inside Action's collar footprint, so nothing can
    come up through the board there. A pad from behind has no such problem: the
    collars are in front of the board and the press force is toward the back.
    """
    pcb_back = P.PCB_FRONT_Z + P.PCB_T
    h = max((-FLOOR_Z) - pcb_back, 0.8)
    pads = cq.Workplane("XY")
    for x, y in P.PCB_SUPPORT_PADS:
        pads = pads.union(
            cq.Workplane("XY").circle(P.PCB_PAD_D / 2).extrude(h)
            .translate((x, y, FLOOR_Z)))
    return pads


def to_model_space(shape):
    """See shell_front.to_model_space -- layout y is down, model y is up."""
    return shape.mirror("XZ").translate((0, P.BODY_H, 0))


def interior_crop():
    """Where back-shell internals are allowed to exist.

    Below the split: anywhere inside the envelope (fusing into the tray wall
    is fine — it is solid). Above the split: inboard of the tongue's inner
    face, so nothing pokes into the front wall's landing zone — the battery
    fence corner used to cross it at the bottom-left round and jam the case
    shut. Straight, not rolled: the roll only opens the front wall away from
    this line as z rises, so the split section bounds the whole climb.
    """
    below = side_arc.shaped_cavity_xy(0.0, RIB_Z0 - 1.0, LID_Z1, CORNER_R)
    above = side_arc.section_prism(P.WALL, LID_Z1, LID_Z1 - 0.1, -P.FACE_T)
    return below.union(above)


def build_back():
    """Fixed pipeline: tray → union ALL material → cut ALL voids → clip.

    Screw geometry (lands, seats, pockets, bores) comes entirely from
    joints.back_joints(); lands are sized against the pockets by construction
    so boolean order within each group cannot open holes. The old
    module_support / pcb_shoulders / screw_* functions are absorbed there.
    """
    js = joints.back_joints()
    crop = interior_crop()
    s = lid()
    materials = [battery_fence(), pcb_support_rib(), pcb_support_pads()]
    materials.extend(j.material() for j in js)
    for m in materials:
        s = s.union(m.intersect(crop))
    for v in (usb_opening(), *[j.voids() for j in js]):
        s = s.cut(v)
    # Internals must not poke through the curved side scoops.
    s = side_arc.clip_to_envelope(s)
    return to_model_space(s)


def pcb_outline_wire():
    """Controller outline; larger bottom radii free lower side-wall carve.

    Keep in sync with pcb.outline_edges (fab Edge.Cuts). The current centered
    driver mounts above the intact board under the front-shell blister.
    """
    board = (cq.Workplane("XY")
             .box(P.PCB_W, P.PCB_H, 1.6, centered=(False, False, False))
             .translate((P.PCB_X, P.PCB_Y, 0)))
    # Top corners (min Y in layout): small fillet. Bottom (max Y): larger.
    top_r = getattr(P, "PCB_CORNER_R", 2.0)
    bot_r = getattr(P, "PCB_BOTTOM_R", top_r)
    if top_r > 0:
        board = board.edges("|Z and <Y").fillet(top_r)
    if bot_r > 0:
        board = board.edges("|Z and >Y").fillet(bot_r)
    nx = getattr(P, "PCB_DRIVER_NOTCH_X", None)
    ny = getattr(P, "PCB_DRIVER_NOTCH_Y", None)
    if nx is not None and ny is not None:
        board = board.cut(
            cq.Workplane("XY")
            .box(P.PCB_X + P.PCB_W - nx + 1, P.PCB_Y + P.PCB_H - ny + 1, 4,
                 centered=False)
            .translate((nx, ny, -1)))
        r = getattr(P, "PCB_NOTCH_R", 2.0)
        if r > 0:
            try:
                board = (board.edges(cq.selectors.BoxSelector(
                    (nx - 0.4, ny - 0.4, -1), (nx + 0.4, ny + 0.4, 3)))
                    .fillet(r))
            except Exception:
                pass   # sharp inner corner still exports; fab adds mill radius
    return to_model_space(board)


if __name__ == "__main__":
    back = build_back()
    order = os.path.join(OUT, "order")
    os.makedirs(order, exist_ok=True)
    for folder in (OUT, order):
        cq.exporters.export(back, os.path.join(folder, "shell_back.stl"))
        cq.exporters.export(back, os.path.join(folder, "shell_back.step"))
    bb = back.val().BoundingBox()
    print(f"shell_back   {bb.xlen:.2f} x {bb.ylen:.2f} x {bb.zlen:.2f}")
    print(f"  wrote out/shell_back.stl and out/order/shell_back.stl")
    print(f"  battery fence  {P.CELL_W} x {P.CELL_H} cell at "
          f"({P.BATT_X}, {P.BATT_Y}), {P.BATT_CLEAR} clearance")

    pcb = pcb_outline_wire()
    cq.exporters.export(pcb, os.path.join(OUT, "pcb_outline.stl"))
    cq.exporters.export(pcb, os.path.join(OUT, "pcb_outline.step"))
    cq.exporters.export(pcb.faces("<Z").wires(), os.path.join(OUT, "pcb_outline.dxf"))
    pb = pcb.val().BoundingBox()
    print(f"pcb_outline  {pb.xlen:.2f} x {pb.ylen:.2f}  "
          f"at ({P.PCB_X}, {P.PCB_Y})  -> DXF for KiCad")
