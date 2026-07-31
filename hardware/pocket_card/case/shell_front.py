"""Front shell.

A deep tray: face, perimeter walls, screen aperture, eight guided button
stations, four posts through the module's own mounting holes, and the edge
openings. The back shell is a shallow lid closing on the same posts, so the
split line sits at the very back and is barely visible from the front or sides.

Coordinates: device coordinates from params.py, with z flipped for modelling.
  x  0 .. BODY_W   left to right, viewed from the front
  y  0 .. BODY_H   top to bottom
  z  0 at the outer face, NEGATIVE into the body

Run:  .venv/bin/python shell_front.py
"""
import math
import os

import cadquery as cq

import params as P

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

CORNER_R = 4.5
SHELL_DEPTH = P.BODY_T - P.WALL        # 12.80; the back lid takes the last 1.5
COLLAR_WALL = 1.2
FLAT_DEPTH = 0.8
POST_D = 3.0                           # through the module's Ø3.2 holes
SHOULDER_D = 5.5                       # module rests its PCB on this
BOSS_D = 4.2                           # corner bosses, nothing to thread through
POST_PILOT_D = 1.7                     # self-tapping screw pilot

# module PCB planes, derived
MOD_PCB_BACK = P.MODULE_Z + P.MOD_FRONT_STACK        # 7.50
MOD_PCB_FRONT = MOD_PCB_BACK - 1.6                   # 5.90


def _dev(shape, x, y):
    """Place a shape built at the origin into device coordinates."""
    return shape.translate((x, y, 0))


def outer_body():
    return (cq.Workplane("XY")
            .box(P.BODY_W, P.BODY_H, SHELL_DEPTH, centered=(False, False, False))
            .translate((0, 0, -SHELL_DEPTH))
            .edges("|Z").fillet(CORNER_R))


def cavity():
    """Everything inside the walls, from behind the face to the open back."""
    w = P.BODY_W - 2 * P.WALL
    h = P.BODY_H - 2 * P.WALL
    d = SHELL_DEPTH - P.FACE_T
    # NB: height is exactly d. An earlier d + 1 put the cavity roof at z = -0.5
    # and left the front face 0.5 mm thick instead of 1.5.
    return (cq.Workplane("XY")
            .box(w, h, d, centered=(False, False, False))
            .translate((P.WALL, P.WALL, -SHELL_DEPTH))
            .edges("|Z").fillet(max(CORNER_R - P.WALL, 0.6)))


def screen_aperture():
    return (cq.Workplane("XY")
            .box(P.APERTURE_W, P.APERTURE_H, P.FACE_T + 2, centered=(False, False, False))
            .translate((P.APERTURE_X, P.APERTURE_Y, -P.FACE_T - 1))
            .edges("|Z").fillet(0.8))


def button_station(hole_d=None, pill=False, keyed=True):
    """Face hole plus guide collar. Returns (solid_to_add, solid_to_cut)."""
    depth = P.FACE_T + P.COLLAR_DEPTH
    if pill:
        flange_l = P.PILL_L + 2 * P.CAP_FLANGE_OS
        flange_w = P.PILL_W + 2 * P.CAP_FLANGE_OS
        bore_l = flange_l + 2 * P.COLLAR_CLEAR
        bore_w = flange_w + 2 * P.COLLAR_CLEAR
        boss = (cq.Workplane("XY")
                .slot2D(bore_l + 2 * COLLAR_WALL, bore_w + 2 * COLLAR_WALL, 0)
                .extrude(-depth))
        bore = cq.Workplane("XY").slot2D(bore_l, bore_w, 0).extrude(-depth - 1)
        hole = (cq.Workplane("XY")
                .slot2D(P.PILL_L + 2 * P.CAP_CLEAR, P.PILL_W + 2 * P.CAP_CLEAR, 0)
                .extrude(-P.FACE_T - 2).translate((0, 0, 1)))
        return boss.cut(bore), hole

    flange_d = hole_d + 2 * P.CAP_FLANGE_OS
    bore_d = flange_d + 2 * P.COLLAR_CLEAR
    boss = cq.Workplane("XY").circle(bore_d / 2 + COLLAR_WALL).extrude(-depth)
    bore = cq.Workplane("XY").circle(bore_d / 2).extrude(-depth - 1)
    if keyed:
        across = bore_d / 2 - FLAT_DEPTH
        for sign in (1, -1):
            bore = bore.cut(
                cq.Workplane("XY").box(4 * bore_d, 4 * bore_d, 100)
                .translate((0, sign * (across + 2 * bore_d), 0)))
    hole = (cq.Workplane("XY").circle(hole_d / 2 + P.CAP_CLEAR)
            .extrude(-P.FACE_T - 2).translate((0, 0, 1)))
    return boss.cut(bore), hole


def module_posts():
    """Six screw bosses.

    Four pass through the module's own Ø3.2 holes, so one feature locates the
    module, retains it and closes the case. Two more sit in the bottom corners,
    because those four are all in the upper 50 mm and the lower half -- the half
    with the cell pressing outward -- would otherwise be held by the rim alone.
    """
    xs = (P.MOD_X + P.MOUNT_INSET, P.MOD_X + P.MOD_W - P.MOUNT_INSET)
    ys = (P.MOD_Y + P.MOUNT_INSET, P.MOD_Y + P.MOD_H - P.MOUNT_INSET)
    add = cq.Workplane("XY")
    cut = cq.Workplane("XY")

    # Module sites: a Ø5.5 shoulder from the face down to the board's front
    # plane, then Ø3.0 through the module's own Ø3.2 hole. The shoulder is what
    # sets the module axially -- without it the board would come to rest against
    # the bezel, which must never touch the touch/LCD stack.
    for x in xs:
        for y in ys:
            add = add.union(
                cq.Workplane("XY").circle(SHOULDER_D / 2)
                .extrude(-(MOD_PCB_FRONT - P.FACE_T))
                .translate((x, y, -P.FACE_T)))
            add = add.union(
                cq.Workplane("XY").circle(POST_D / 2)
                .extrude(-(SHELL_DEPTH - MOD_PCB_FRONT))
                .translate((x, y, -MOD_PCB_FRONT)))
            cut = cut.union(
                cq.Workplane("XY").circle(POST_PILOT_D / 2)
                .extrude(SHELL_DEPTH - MOD_PCB_FRONT - 1.2)
                .translate((x, y, -SHELL_DEPTH)))

    # Corner bosses pass through nothing, so they can be fat.
    for x, y in P.EXTRA_BOSSES:
        add = add.union(
            cq.Workplane("XY").circle(BOSS_D / 2).extrude(-(SHELL_DEPTH - P.FACE_T))
            .translate((x, y, -P.FACE_T)))
        cut = cut.union(
            cq.Workplane("XY").circle(POST_PILOT_D / 2)
            .extrude(SHELL_DEPTH - P.FACE_T - 1.2).translate((x, y, -SHELL_DEPTH)))
    return add, cut


def pcb_posts():
    """Stepped pillars the controller PCB drops onto.

    Same idea as the module posts: narrow through the board's hole, wide
    behind it. The board rests on the step, so a button press drives force
    into the shell instead of flexing the board. Previously the board had
    mounting holes with nothing in the case to meet them.
    """
    pcb_back = P.PCB_FRONT_Z + P.PCB_T
    add = cq.Workplane("XY")
    for x, y in P.PCB_MOUNTS:
        add = add.union(
            cq.Workplane("XY").circle(P.PCB_POST_D / 2)
            .extrude(-(pcb_back - P.FACE_T)).translate((x, y, -P.FACE_T)))
        add = add.union(
            cq.Workplane("XY").circle(P.PCB_SHOULDER_D / 2)
            .extrude(-(SHELL_DEPTH - pcb_back)).translate((x, y, -pcb_back)))
    return add


def edge_openings():
    """USB-C on the left wall; power and mute slides on the bottom edge."""
    cuts = cq.Workplane("XY")

    # USB-C: on the module's rear face, at the module's vertical midpoint
    usb_y = P.MOD_Y + P.MOD_H / 2
    cuts = cuts.union(
        cq.Workplane("XY").box(P.WALL + 3, 10.0, 4.2, centered=(False, True, True))
        .translate((-1.5, usb_y, -(MOD_PCB_BACK + 2.1))))

    # power switch, bottom edge left of the grille
    cuts = cuts.union(
        cq.Workplane("XY").box(12.0, P.WALL + 3, 5.0, centered=(True, False, True))
        .translate((P.POWER_SW_X, P.BODY_H - P.WALL - 1.5, -(P.PCB_FRONT_Z + 1.0))))
    # mute switch, bottom edge beneath the grille
    cuts = cuts.union(
        cq.Workplane("XY").box(10.0, P.WALL + 3, 5.0, centered=(True, False, True))
        .translate((P.MUTE_SW_X, P.BODY_H - P.WALL - 1.5, -(P.PCB_FRONT_Z + 1.0))))
    return cuts


def grille_slots():
    """The PuzzleScript man as horizontal slats.

    Each run of 1s in GRILLE_BITMAP becomes one slot. The bottom row is two
    separate runs, so the five-row figure is cut as six slots.
    """
    cell = P.GRILLE_CELL
    rows = P.GRILLE_BITMAP
    n = len(rows)
    cuts = cq.Workplane("XY")
    for r, row in enumerate(rows):
        c = 0
        while c < len(row):
            if row[c] != "1":
                c += 1
                continue
            c0 = c
            while c < len(row) and row[c] == "1":
                c += 1
            c1 = c - 1
            length = (c1 - c0 + 1) * cell
            dx = ((c0 + c1) / 2.0 - (len(row) - 1) / 2.0) * cell
            dy = (r - (n - 1) / 2.0) * cell
            cuts = cuts.union(
                cq.Workplane("XY").slot2D(length, P.GRILLE_SLOT_H, 0)
                .extrude(-P.FACE_T - 2).translate((0, 0, 1))
                .translate((P.GRILLE_X + dx, P.GRILLE_Y + dy, 0)))
    return cuts


def to_model_space(shape):
    """Layout space (y down from the top) -> model space (y up).

    params.py places controls the way you read a face: y = 0 at the top,
    increasing downward. 3D space viewed from the front has +y UP, so the two
    differ by a reflection. Without this the exported part comes out vertically
    flipped, and rotating it upright mirrors left for right -- which is exactly
    what happened, and my renderer was "corrected" to hide it rather than the
    model being fixed.
    """
    return shape.mirror("XZ").translate((0, P.BODY_H, 0))


def build():
    shell = outer_body().cut(cavity())
    shell = shell.cut(screen_aperture())

    stations = [
        (P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D, False),   # up
        (P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D, False),   # down
        (P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),   # left
        (P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),   # right
        (P.UNDO_X, P.UNDO_Y, P.AB_CAP_D, False),
        (P.ACT_X, P.ACT_Y, P.AB_CAP_D, False),
        (P.RESET_X, P.RESET_Y, P.RESET_CAP_D, False),
        (P.MENU_X, P.MENU_Y, None, True),
    ]
    for x, y, d, pill in stations:
        boss, hole = button_station(hole_d=d, pill=pill)
        if pill:
            boss = boss.rotate((0, 0, 0), (0, 0, 1), -P.MENU_ANGLE)
            hole = hole.rotate((0, 0, 0), (0, 0, 1), -P.MENU_ANGLE)
        shell = shell.union(_dev(boss, x, y)).cut(_dev(hole, x, y))

    add, cut = module_posts()
    shell = shell.union(add).cut(cut)
    shell = shell.union(pcb_posts())
    shell = shell.cut(edge_openings())
    shell = shell.cut(grille_slots())
    return to_model_space(shell)


if __name__ == "__main__":
    s = build()
    cq.exporters.export(s, os.path.join(OUT, "shell_front.stl"))
    cq.exporters.export(s, os.path.join(OUT, "shell_front.step"))
    bb = s.val().BoundingBox()
    print(f"shell_front  {bb.xlen:.2f} x {bb.ylen:.2f} x {bb.zlen:.2f}")
    print(f"  aperture   {P.APERTURE_W:.2f} x {P.APERTURE_H:.2f} at "
          f"({P.APERTURE_X:.2f}, {P.APERTURE_Y:.2f})")
    print(f"  screen off-centre by {P.SCREEN_OFFSET:+.2f} mm (accepted)")
    print(f"  module touch surface at z = -{P.MODULE_Z:.2f}, PCB back at "
          f"-{MOD_PCB_BACK:.2f}")
