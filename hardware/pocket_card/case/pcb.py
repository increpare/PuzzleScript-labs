"""Generate the controller PCB from params.py.

Every switch sits at the coordinate the shell drills its collar at, because both
come from the same file. The board and the enclosure cannot disagree.

KiCad's PCB coordinates are Y-down, the same convention params.py uses for the
face layout, so positions transfer with no transform. Component side is F.Cu,
which faces the front of the device.

Must run under KiCad's bundled interpreter, which is the only one with pcbnew:

  /Users/<you>/Applications/KiCad/KiCad.app/Contents/Frameworks/\\
      Python.framework/Versions/3.9/bin/python3 pcb.py
"""
import math
import os
import sys

import pcbnew

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import params as P

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "pcb")
os.makedirs(OUT, exist_ok=True)

FP = ("/Users/stephenlavelle/Applications/KiCad/KiCad.app/Contents/"
      "SharedSupport/footprints")

TACT = ("Button_Switch_SMD", "Panasonic_EVQPUJ_EVQPUA")     # 6 x 6 mm SMD tact
SLIDE = ("Button_Switch_SMD", "SW_SPDT_PCM12")
EXPANDER = ("Package_SO", "SOIC-28W_7.5x17.9mm_P1.27mm")    # MCP23017
JST4 = ("Connector_JST", "JST_GH_SM04B-GHS-TB_1x04-1MP_P1.25mm_Horizontal")
JST2 = ("Connector_JST", "JST_GH_SM02B-GHS-TB_1x02-1MP_P1.25mm_Horizontal")
TP = ("TestPoint", "TestPoint_Pad_D1.5mm")
MHOLE = ("MountingHole", "MountingHole_2.2mm_M2")

# Screws can only go where the cell is not behind the board -- the cell fence
# reaches x = 60.8 -- so both land on the right. The left edge is retained by a
# moulded lip on the front shell instead, which the board slides under.
PCB_MOUNTS = ((65.0, 56.0), (80.0, 72.0))

# The module presents five 1.25 mm JST sockets. We need matching ones for:
#   I2C  4P  3V3 / GND / SCL(IO15) / SDA(IO16)   -- powers the expander and the bus
#   EXP  4P  IO2 / IO3 / IO14 / IO21             -- IO2 is the expander interrupt
#   BAT  2P in, 2P out                           -- the power switch sits IN the
#                                                   cell lead, so it must break
#                                                   the circuit: cell -> board ->
#                                                   switch -> module BAT socket
# The speaker does NOT pass through this board: mute is a logic signal to the
# module's amp-enable pin, not a break in the speaker wires.
CONNECTORS = [
    ("J_I2C", 4, 12.0, 54.5, "3V3/GND/SCL/SDA -- to module I2C"),
    ("J_EXP", 4, 26.0, 54.5, "IO2 interrupt -- to module expansion"),
    ("J_BAT_IN", 2, 40.0, 54.5, "from cell"),
    ("J_BAT_OUT", 2, 50.0, 54.5, "to module BAT"),
]


def mm(v):
    return pcbnew.FromMM(v)


def at(x, y):
    return pcbnew.VECTOR2I(mm(x), mm(y))


def place(board, lib, name, x, y, ref, rot=0):
    fp = pcbnew.FootprintLoad(os.path.join(FP, lib + ".pretty"), name)
    if fp is None:
        raise RuntimeError("missing footprint: %s / %s" % (lib, name))
    fp.SetPosition(at(x, y))
    if rot:
        fp.SetOrientationDegrees(rot)
    fp.SetReference(ref)
    board.Add(fp)
    return fp


def outline_points():
    """Board outline: rectangle with a bite taken out for the driver."""
    x0, y0 = P.PCB_X, P.PCB_Y
    x1, y1 = P.PCB_X + P.PCB_W, P.PCB_Y + P.PCB_H
    cx, cy = P.GRILLE_X, P.GRILLE_Y
    r = P.DRIVER_D / 2 + 0.8

    dx = x1 - cx
    if abs(dx) >= r:
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    dy = math.sqrt(r * r - dx * dx)
    ya, yb = cy - dy, cy + dy

    pts = [(x0, y0), (x1, y0), (x1, ya)]
    a0 = math.atan2(ya - cy, x1 - cx)
    a1 = math.atan2(yb - cy, x1 - cx)
    steps = 24
    for i in range(1, steps):
        t = a0 + (a1 - a0 - 2 * math.pi) * i / steps    # the short way, inward
        pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    pts += [(x1, yb), (x1, y1), (x0, y1)]
    return pts


def build():
    board = pcbnew.CreateEmptyBoard()

    pts = outline_points()
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        seg = pcbnew.PCB_SHAPE(board)
        seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
        seg.SetStart(at(*a))
        seg.SetEnd(at(*b))
        seg.SetLayer(pcbnew.Edge_Cuts)
        seg.SetWidth(mm(0.1))
        board.Add(seg)

    # eight switches, at exactly the coordinates the shell uses
    switches = [
        ("SW_UP", P.DIR_CX, P.DIR_CY - P.DIR_RADIUS),
        ("SW_DOWN", P.DIR_CX, P.DIR_CY + P.DIR_RADIUS),
        ("SW_LEFT", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY),
        ("SW_RIGHT", P.DIR_CX + P.DIR_RADIUS, P.DIR_CY),
        ("SW_UNDO", P.UNDO_X, P.UNDO_Y),
        ("SW_ACTION", P.ACT_X, P.ACT_Y),
        ("SW_RESET", P.RESET_X, P.RESET_Y),
        ("SW_MENU", P.MENU_X, P.MENU_Y),
    ]
    for ref, x, y in switches:
        place(board, TACT[0], TACT[1], x, y, ref)

    # (45, 72) unrotated: at (30, 62) rot90 the package overlapped the "up"
    # and "right" direction collars. Components sit at z 3.75-5.5 and collars
    # end at 3.5, so plan overlap really is a collision.
    place(board, EXPANDER[0], EXPANDER[1], 45.0, 72.0, "U1")
    place(board, SLIDE[0], SLIDE[1], P.POWER_SW_X, 88.5, "SW_PWR")
    place(board, SLIDE[0], SLIDE[1], P.MUTE_SW_X, 88.5, "SW_MUTE")
    for ref, ways, x, y, _note in CONNECTORS:
        lib, name = (JST4 if ways == 4 else JST2)
        place(board, lib, name, x, y, ref, 180)

    for i, (nm, x) in enumerate([("3V3", 0), ("GND", 1), ("SDA", 2),
                                 ("SCL", 3), ("INT", 4)]):
        place(board, TP[0], TP[1], 64.0 + x * 3.0, 58.5, "TP_" + nm)

    for i, (x, y) in enumerate(PCB_MOUNTS):
        place(board, MHOLE[0], MHOLE[1], x, y, "H%d" % (i + 1))

    return board


if __name__ == "__main__":
    b = build()
    path = os.path.join(OUT, "pocket_card_controller.kicad_pcb")
    b.Save(path)
    box = b.GetBoardEdgesBoundingBox()
    print("saved %s" % path)
    print("outline %.2f x %.2f mm at (%.2f, %.2f)" % (
        pcbnew.ToMM(box.GetWidth()), pcbnew.ToMM(box.GetHeight()),
        pcbnew.ToMM(box.GetLeft()), pcbnew.ToMM(box.GetTop())))
    print("footprints placed: %d" % len(b.GetFootprints()))
    for f in b.GetFootprints():
        p = f.GetPosition()
        print("   %-10s %-46s (%6.2f, %6.2f)" % (
            f.GetReference(), str(f.GetFPID().GetLibItemName()),
            pcbnew.ToMM(p.x), pcbnew.ToMM(p.y)))
