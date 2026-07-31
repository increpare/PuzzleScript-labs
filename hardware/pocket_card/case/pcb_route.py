"""Netlist and ground pour for the controller PCB; routing via freerouting.

Run after pcb.py, under KiCad's bundled Python 3.9.

This script assigns nets and pours ground. It does NOT route: an earlier
hand-rolled router produced 83 DRC violations and 26 unconnected nets, and
the failure mode was that its output looked entirely plausible. Routing is
handed to freerouting through Specctra DSN/SES, which is the standard KiCad
workflow and produces output DRC can actually vouch for.

The expander GPIO assignment is chosen by geometry rather than fixed in
advance: which bit a button lands on is a firmware constant, so letting the
layout pick it costs nothing and shortens the traces. The July 12 allocation
was explicitly provisional; the mapping printed here supersedes it.
"""
import subprocess
import math
import os
import sys

import pcbnew

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import params as P

HERE = os.path.dirname(os.path.abspath(__file__))
BRD = os.path.join(HERE, "out", "pcb", "pocket_card_controller.kicad_pcb")

TRACK_W = 0.25
VIA_D, VIA_DRILL = 0.6, 0.3
CLEAR = 0.2

# MCP23017 SOIC-28: GPA0..7 are pins 21..28, GPB0 is pin 1.
GPIO_PINS = ["21", "22", "23", "24", "25", "26", "27", "28", "1"]
GPIO_NAMES = ["GPA0", "GPA1", "GPA2", "GPA3", "GPA4", "GPA5", "GPA6", "GPA7", "GPB0"]


def mm(v):
    return pcbnew.FromMM(v)


def pad_of(fp, name):
    for p in fp.Pads():
        if p.GetPadName() == name:
            return p
    raise KeyError("%s has no pad %s" % (fp.GetReference(), name))


def xy(pad):
    p = pad.GetPosition()
    return pcbnew.ToMM(p.x), pcbnew.ToMM(p.y)


def add_net(board, name):
    ni = board.FindNet(name)
    if ni is None:
        ni = pcbnew.NETINFO_ITEM(board, name)
        board.Add(ni)
    return ni


def track(board, a, b, net, layer=pcbnew.F_Cu):
    t = pcbnew.PCB_TRACK(board)
    t.SetStart(pcbnew.VECTOR2I(mm(a[0]), mm(a[1])))
    t.SetEnd(pcbnew.VECTOR2I(mm(b[0]), mm(b[1])))
    t.SetWidth(mm(TRACK_W))
    t.SetLayer(layer)
    t.SetNet(net)
    board.Add(t)


def via(board, pt, net):
    v = pcbnew.PCB_VIA(board)
    v.SetPosition(pcbnew.VECTOR2I(mm(pt[0]), mm(pt[1])))
    v.SetWidth(mm(VIA_D))
    v.SetDrill(mm(VIA_DRILL))
    v.SetNet(net)
    board.Add(v)


def seg_hit(a, b, c, d):
    """Do segments ab and cd properly intersect?"""
    def s(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    d1, d2 = s(c, d, a), s(c, d, b)
    d3, d4 = s(a, b, c), s(a, b, d)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def main():
    board = pcbnew.LoadBoard(BRD)
    fps = {f.GetReference(): f for f in board.GetFootprints()}

    u1 = fps["U1"]
    u1.SetPosition(pcbnew.VECTOR2I(mm(45.0), mm(72.0)))
    u1.SetOrientationDegrees(0)

    gnd = add_net(board, "GND")
    v3 = add_net(board, "+3V3")
    nets = {n: add_net(board, n) for n in
            ("SDA", "SCL", "INT", "BAT_P", "BAT_SW")}

    switches = [("SW_UP", "UP"), ("SW_DOWN", "DOWN"), ("SW_LEFT", "LEFT"),
                ("SW_RIGHT", "RIGHT"), ("SW_UNDO", "UNDO"), ("SW_ACTION", "ACTION"),
                ("SW_RESET", "RESET"), ("SW_MENU", "MENU"), ("SW_MUTE", "MUTE")]

    # assign each switch to whichever free GPIO pad is nearest -- geometry
    # chooses the bit allocation, not the other way round
    free = [(n, pad_of(u1, p)) for n, p in zip(GPIO_NAMES, GPIO_PINS)]
    mapping = []
    for ref, sig in switches:
        fp = fps[ref]
        sx, sy = pcbnew.ToMM(fp.GetPosition().x), pcbnew.ToMM(fp.GetPosition().y)
        best = min(free, key=lambda g: math.hypot(*(a - b for a, b in
                                                    zip(xy(g[1]), (sx, sy)))))
        free.remove(best)
        mapping.append((ref, sig, best[0], best[1]))

    for ref, sig, gpio, gpad in mapping:
        fp = fps[ref]
        net = add_net(board, "SIG_" + sig)
        pads = list(fp.Pads())
        pads[0].SetNet(net)
        for p in pads[1:]:
            p.SetNet(gnd)      # common side; the pour picks these up
        gpad.SetNet(net)

    # power and bus
    for pin, net in (("9", v3), ("10", gnd), ("12", nets["SCL"]),
                     ("13", nets["SDA"]), ("15", gnd), ("16", gnd),
                     ("17", gnd), ("18", v3), ("20", nets["INT"])):
        pad_of(u1, pin).SetNet(net)

    j = fps["J_I2C"]
    for pin, net in (("1", v3), ("2", gnd), ("3", nets["SCL"]), ("4", nets["SDA"])):
        pad_of(j, pin).SetNet(net)
    pad_of(fps["J_EXP"], "1").SetNet(nets["INT"])
    for pin, net in (("1", nets["BAT_P"]), ("2", gnd)):
        pad_of(fps["J_BAT_IN"], pin).SetNet(net)
    for pin, net in (("1", nets["BAT_SW"]), ("2", gnd)):
        pad_of(fps["J_BAT_OUT"], pin).SetNet(net)
    sw = fps["SW_PWR"]
    pad_of(sw, "2").SetNet(nets["BAT_P"])
    pad_of(sw, "1").SetNet(nets["BAT_SW"])

    # Explicit design rules. A board from CreateEmptyBoard carries defaults that
    # are too coarse for this fanout, and freerouting honours whatever the DSN
    # declares -- with the defaults it left 24 nets unrouted.
    ds = board.GetDesignSettings()
    nc = ds.m_NetSettings.GetDefaultNetclass()
    nc.SetClearance(mm(0.15))
    nc.SetTrackWidth(mm(0.2))
    nc.SetViaDiameter(mm(0.6))
    nc.SetViaDrill(mm(0.3))
    ds.SetCopperLayerCount(2)
    board.Save(BRD)

    # hand the routing to freerouting via Specctra
    dsn = BRD.replace(".kicad_pcb", ".dsn")
    ses = BRD.replace(".kicad_pcb", ".ses")
    pcbnew.ExportSpecctraDSN(board, dsn)
    print("exported %s" % os.path.basename(dsn))
    jar = os.environ.get("FREEROUTING_JAR")
    if not jar or not os.path.exists(jar):
        print("set FREEROUTING_JAR to the freerouting 2.1.0 jar and re-run")
        return
    # -mt 1: freerouting's own log warns multi-threaded optimisation is broken
    # and generates clearance violations.
    subprocess.run(["java", "-jar", jar, "-de", dsn, "-do", ses,
                    "-mp", "100", "-mt", "1"], check=False)
    if os.path.exists(ses):
        board = pcbnew.LoadBoard(BRD)
        pcbnew.ImportSpecctraSES(board, ses)
        print("imported routed session")
    else:
        print("freerouting produced no session file")
        return

    gnd = board.FindNet("GND")

    # Ground pour on BOTH layers. A back-only pour cannot reach front-side SMD
    # pads, which left every switch common unconnected -- 38 of the 28 reported
    # unconnected items were GND.
    for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
        zone = pcbnew.ZONE(board)
        zone.SetLayer(layer)
        zone.SetNet(gnd)
        zone.SetLocalClearance(mm(CLEAR))
        out = pcbnew.SHAPE_POLY_SET()
        out.NewOutline()
        x0, y0 = P.PCB_X + 0.4, P.PCB_Y + 0.4
        x1, y1 = P.PCB_X + P.PCB_W - 0.4, P.PCB_Y + P.PCB_H - 0.4
        for px, py in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            out.Append(mm(px), mm(py))
        zone.SetOutline(out)
        board.Add(zone)
    pcbnew.ZONE_FILLER(board).Fill(board.Zones())

    board.Save(BRD)
    print("\nexpander allocation chosen by geometry:")
    for ref, sig, gpio, _ in mapping:
        print("   %-6s -> %s" % (sig, gpio))
    print("\nnets: %d" % board.GetNetCount())


if __name__ == "__main__":
    main()
