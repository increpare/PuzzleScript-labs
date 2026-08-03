"""Netlist, ground pour and autorouting for the controller PCB.

Run after pcb.py, under KiCad's bundled Python 3.9:

  FREEROUTING_JAR=/path/to/freerouting-2.1.0.jar \\
  .../KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3 \\
      pcb_route.py

Order matters, and three things here were learned the hard way:

  * wx.App() must exist before ZONE_FILLER, or pcbnew segfaults with no
    traceback. The assert text says so; it is easy to scroll past.
  * The pour must be filled BEFORE the DSN is exported. Freerouting cannot see
    a zone that does not exist yet, so otherwise it tries to wire ~25 ground
    connections point-to-point on two layers and gives up.
  * The pour must be on BOTH layers. A back-only pour cannot reach front-side
    SMD pads, which leaves every switch common floating.

Routing itself is freerouting's job. A hand-rolled router produced 83 DRC
violations including shorted nets, and looked entirely plausible doing it.
"""
import math
import os
import subprocess
import sys

# Do NOT create wx.App() here. In this environment (and some headless runs)
# wx.App() hangs forever; LoadBoard / SetNet / ExportSpecctraDSN / Save work
# without it (KiCad may print a traits assert — ignore it). ZONE_FILLER is
# unused; zones are injected as text and filled by kicad-cli.
# pcbnew is imported lazily in main() so inject_zones() can run under stdlib
# Python when repairing board text.

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import params as P

HERE = os.path.dirname(os.path.abspath(__file__))
BRD = os.path.join(HERE, "out", "pcb", "pocket_card_controller.kicad_pcb")

TRACK_W, CLEAR = 0.2, 0.15
VIA_D, VIA_DRILL = 0.6, 0.3

# MCP23017 SOIC-28: GPA0..7 are pins 21..28, GPB0 is pin 1.
GPIO = list(zip(["GPA0", "GPA1", "GPA2", "GPA3", "GPA4", "GPA5", "GPA6",
                 "GPA7", "GPB0"],
                ["21", "22", "23", "24", "25", "26", "27", "28", "1"]))

SWITCHES = [("SW_UP", "UP"), ("SW_DOWN", "DOWN"), ("SW_LEFT", "LEFT"),
            ("SW_RIGHT", "RIGHT"), ("SW_UNDO", "UNDO"), ("SW_ACTION", "ACTION"),
            ("SW_RESET", "RESET"), ("SW_MENU", "MENU"), ("SW_MUTE", "MUTE")]


def mm(v):
    import pcbnew
    return pcbnew.FromMM(v)


def pad_of(fp, name):
    for p in fp.Pads():
        if p.GetPadName() == name:
            return p
    raise KeyError("%s has no pad %s" % (fp.GetReference(), name))


def net(board, name):
    import pcbnew
    n = board.FindNet(name)
    if n is None:
        n = pcbnew.NETINFO_ITEM(board, name)
        board.Add(n)
    return n


ZONE_TEMPLATE = """	(zone
		(net "GND")
		(layer "%s")
		(uuid "%s")
		(hatch edge 0.5)
		(connect_pads
			(clearance 0.5)
		)
		(min_thickness 0.25)
		(fill yes
			(thermal_gap 0.5)
			(thermal_bridge_width 0.5)
			(island_removal_mode 0)
		)
		(polygon
			(pts
				%s
			)
		)
	)
"""

# Stitch F.Cu ↔ B.Cu GND pours. Keep clear of U1 (P.U1_X,P.U1_Y), JST cluster (~74,*),
# mounting holes, and the B.Cu BAT_P run near y≈77.5 (a via at 32,78 nearly
# shorted it). Freerouting often leaves the two fills as islands.
GND_STITCH = (
    (10.0, 58.0), (20.0, 65.0), (52.0, 58.0),
    (10.0, 78.0), (18.0, 72.0), (60.0, 70.0),
    (10.0, 86.0), (32.0, 86.0), (50.0, 86.0),
)


def inject_zones(path):
    """Write the ground pour straight into the .kicad_pcb as text.

    pcbnew segfaults on Save() whenever a zone is present -- not because of the
    zone settings (an identical one saves fine from a minimal script) and not
    because of the destination path. Rather than keep chasing it, the file is
    s-expression text and the exact syntax came from KiCad's own writer, so the
    zones go in directly. KiCad fills them on open; kicad-cli fills when
    plotting.
    """
    import uuid as _uuid
    txt0 = open(path).read()
    # Footprint keepouts (SKQG) also use "(zone"; only skip if a board GND pour
    # is already present.
    if '(zone\n\t\t(net "GND")' in txt0 or '(zone\n\t(net "GND")' in txt0:
        return 0          # already present; never duplicate or clobber a fill

    # Reuse a previously filled pour if one was saved. The zone outline and
    # board edge do not change between runs, so a stale fill is geometrically
    # imperfect but tells freerouting the plane exists -- which is the whole
    # point. Without it the router wastes its effort on ~25 ground connections
    # and the owner has to fill twice per cycle.
    frag = os.path.join(os.path.dirname(path), "zones_filled.kicad_frag")
    if os.path.exists(frag):
        txt = open(path).read()
        cut = txt.rstrip().rfind("\n)")
        open(path, "w").write(txt[:cut] + "\n" + open(frag).read() + "\n)\n")
        return -1         # signals "reused a filled pour"
    # Inset INSIDE the board. Outline is a plain rectangle (no driver notch —
    # driver is front-shell only). Both layers: B.Cu now carries JST GND pads.
    g = 0.5
    x0, y0 = P.PCB_X + g, P.PCB_Y + g
    x1, y1 = P.PCB_X + P.PCB_W - g, P.PCB_Y + P.PCB_H - g
    corners = ((x0, y0), (x1, y0), (x1, y1), (x0, y1))
    pts = " ".join("(xy %g %g)" % pt for pt in corners)
    blocks = "".join(ZONE_TEMPLATE % (layer, _uuid.uuid4(), pts)
                     for layer in ("F.Cu", "B.Cu"))
    txt = open(path).read()
    vias = []
    for x, y in GND_STITCH:
        vias.append(
            '\t(via\n'
            '\t\t(at %g %g)\n'
            '\t\t(size %g)\n'
            '\t\t(drill %g)\n'
            '\t\t(layers "F.Cu" "B.Cu")\n'
            '\t\t(net "GND")\n'
            '\t\t(uuid "%s")\n'
            '\t)' % (x, y, VIA_D, VIA_DRILL, _uuid.uuid4())
        )
    cut = txt.rstrip().rfind("\n)")          # before the file's final paren
    open(path, "w").write(
        txt[:cut] + "\n" + "\n".join(vias) + "\n" + blocks + ")\n")
    return 2


def main():
    import pcbnew
    board = pcbnew.LoadBoard(BRD)
    fps = {f.GetReference(): f for f in board.GetFootprints()}
    u1 = fps["U1"]

    gnd, v3 = net(board, "GND"), net(board, "+3V3")
    sig = {n: net(board, n) for n in ("SDA", "SCL", "INT", "BAT_P", "BAT_SW")}

    # Let geometry pick the GPIO allocation: which bit a button lands on is a
    # firmware constant, so choosing it here shortens every trace for free.
    free = [(nm, pad_of(u1, pin)) for nm, pin in GPIO]
    mapping = []
    for ref, name in SWITCHES:
        fp = fps[ref]
        fx = pcbnew.ToMM(fp.GetPosition().x)
        fy = pcbnew.ToMM(fp.GetPosition().y)
        best = min(free, key=lambda g: math.hypot(
            pcbnew.ToMM(g[1].GetPosition().x) - fx,
            pcbnew.ToMM(g[1].GetPosition().y) - fy))
        free.remove(best)
        mapping.append((ref, name, best[0], best[1]))

    for ref, name, gpio, gpad in mapping:
        n = net(board, "SIG_" + name)
        # By pad NAME, not index: this footprint has TWO pads called "1" and
        # TWO called "2" -- the tact's two internal contacts, each broken out
        # to a pair of lands. Indexing put one "1" land on GND, shorting the
        # signal to ground through the switch itself.
        for pd in fps[ref].Pads():
            pd.SetNet(n if pd.GetPadName() == "1" else gnd)
        gpad.SetNet(n)

    for pin, n in (("9", v3), ("10", gnd), ("12", sig["SCL"]),
                   ("13", sig["SDA"]), ("15", gnd), ("16", gnd), ("17", gnd),
                   ("18", v3), ("20", sig["INT"])):
        pad_of(u1, pin).SetNet(n)

    for pin, n in (("1", v3), ("2", gnd), ("3", sig["SCL"]), ("4", sig["SDA"])):
        pad_of(fps["J_I2C"], pin).SetNet(n)
    pad_of(fps["J_EXP"], "1").SetNet(sig["INT"])
    for pin, n in (("1", sig["BAT_P"]), ("2", gnd)):
        pad_of(fps["J_BAT_IN"], pin).SetNet(n)
    for pin, n in (("1", sig["BAT_SW"]), ("2", gnd)):
        pad_of(fps["J_BAT_OUT"], pin).SetNet(n)
    # GH mounting pads are copper pour anchors — tie them to GND.
    for ref in ("J_I2C", "J_EXP", "J_BAT_IN", "J_BAT_OUT"):
        for pd in fps[ref].Pads():
            if pd.GetPadName() == "MP":
                pd.SetNet(gnd)
    pad_of(fps["SW_PWR"], "2").SetNet(sig["BAT_P"])
    pad_of(fps["SW_PWR"], "1").SetNet(sig["BAT_SW"])

    nc = board.GetDesignSettings().m_NetSettings.GetDefaultNetclass()
    nc.SetClearance(mm(CLEAR))
    nc.SetTrackWidth(mm(TRACK_W))
    nc.SetViaDiameter(mm(VIA_D))
    nc.SetViaDrill(mm(VIA_DRILL))

    # ZONE_FILLER segfaults in this headless build even with a wx context, and
    # takes the process with it -- no traceback. Guarded so the rest completes;
    # the pour is added unfilled and KiCad fills it when the board is opened.
    # pour() is NOT called; see inject_zones below.
    #
    # board.Save() segfaults whenever a zone is present -- reproducibly, with no
    # traceback, and uncatchable since a segfault takes the interpreter with it.
    # A minimal standalone script with the same zone settings saves fine, so the
    # trigger is something about this board's state that I did not isolate.
    #
    # Consequence: ground is left for freerouting to wire point-to-point, and it
    # cannot. ~25 GND connections on two layers is what the remaining 40
    # unrouted nets are. The board is NOT finished.
    board.Save(BRD)

    dsn = BRD.replace(".kicad_pcb", ".dsn")
    ses = BRD.replace(".kicad_pcb", ".ses")
    pcbnew.ExportSpecctraDSN(board, dsn)
    jar = os.environ.get("FREEROUTING_JAR", "")
    if not os.path.exists(jar):
        sys.exit("set FREEROUTING_JAR to the freerouting 2.1.0 jar")
    # --gui.enabled=false is essential. Without it freerouting opens a window
    # and waits for a human to save, so every run routed for a different length
    # of time and the results looked like router variance when they were not.
    # -dct 1 stops dialogs blocking on the default action.
    if os.path.exists(ses):
        os.remove(ses)
    subprocess.run(["java", "-jar", jar,
                    "--gui.enabled=false", "-dct", "1",
                    "-de", dsn, "-do", ses,
                    "-mp", "12", "-mt", "1"], check=False)
    if not os.path.exists(ses):
        sys.exit("freerouting produced no session file")

    board = pcbnew.LoadBoard(BRD)
    pcbnew.ImportSpecctraSES(board, ses)
    board.Save(BRD)
    n = inject_zones(BRD)
    print({0: "zones already present, left alone",
           -1: "reused the saved filled pour"}.get(n,
          "injected %d ground zones as text" % n))

    board = pcbnew.LoadBoard(BRD)
    tr = [t for t in board.GetTracks() if t.Type() == pcbnew.PCB_TRACE_T]
    vi = [t for t in board.GetTracks() if t.Type() == pcbnew.PCB_VIA_T]
    print("tracks %d, vias %d, zones %d, nets %d"
          % (len(tr), len(vi), len(board.Zones()), board.GetNetCount()))
    print("\nexpander allocation, chosen by geometry:")
    for _ref, name, gpio, _ in mapping:
        print("   %-6s -> %s" % (name, gpio))


if __name__ == "__main__":
    main()
