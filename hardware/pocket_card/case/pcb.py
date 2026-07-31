"""Generate the controller PCB from params.py.

Every switch sits at the coordinate the shell drills its collar at, because both
come from the same file. The board and the enclosure cannot disagree.

KiCad's PCB coordinates are Y-down, the same convention params.py uses for the
face layout, so positions transfer with no transform. Component side is F.Cu
(buttons / expander / slides). Module IO JSTs live on B.Cu in the right-rear
wiring pocket per the SKQG amendatory spec.

Default path is a headless S-expression writer (stdlib only) that inlines
`.kicad_mod` footprints. Optional pcbnew path when a real GUI session is
available:

  USE_PCBNEW=1 /Users/<you>/Applications/KiCad/KiCad.app/Contents/Frameworks/\\
      Python.framework/Versions/3.9/bin/python3 pcb.py

Headless (any Python 3):

  python3 pcb.py
"""
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import params as P

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "pcb")
os.makedirs(OUT, exist_ok=True)

FP_ROOT = ("/Users/stephenlavelle/Applications/KiCad/KiCad.app/Contents/"
           "SharedSupport/footprints")

# Alps SKQGABE010 — □5.2 × 1.5 mm with stem. KiCad land pattern embeds the
# F.Cu keepouts beside the stem; see checks.check_skqg_keepouts.
TACT = ("Button_Switch_SMD", "SW_SPST_SKQG_WithStem")
SLIDE = ("Button_Switch_SMD", "SW_SPDT_PCM12")
EXPANDER = ("Package_SO", "SOIC-28W_7.5x17.9mm_P1.27mm")    # MCP23017
JST4 = ("Connector_JST", "JST_GH_SM04B-GHS-TB_1x04-1MP_P1.25mm_Horizontal")
JST2 = ("Connector_JST", "JST_GH_SM02B-GHS-TB_1x02-1MP_P1.25mm_Horizontal")
MHOLE = ("MountingHole", "MountingHole_2.7mm_M2.5")   # clears the Ø2.4 post

PCB_MOUNTS = P.PCB_MOUNTS

# Module interconnects: anchors on B.Cu (P.CONN_*).
CONNECTORS = [
    ("J_I2C", 4, *P.CONN_I2C, "3V3/GND/SCL/SDA -- to module I2C"),
    ("J_EXP", 4, *P.CONN_EXP, "IO2 interrupt -- to module expansion"),
    ("J_BAT_IN", 2, *P.CONN_BAT_IN, "from cell"),
    ("J_BAT_OUT", 2, *P.CONN_BAT_OUT, "to module BAT"),
]

_LAYER_PAIRS = (
    ("F.Cu", "B.Cu"),
    ("F.SilkS", "B.SilkS"),
    ("F.Mask", "B.Mask"),
    ("F.Paste", "B.Paste"),
    ("F.Fab", "B.Fab"),
    ("F.CrtYd", "B.CrtYd"),
    ("F.Adhes", "B.Adhes"),
)


def _uid():
    return str(uuid.uuid4())


def _mod_path(lib, name):
    return os.path.join(FP_ROOT, lib + ".pretty", name + ".kicad_mod")


def _flip_layers(text):
    """Swap front/back layer tokens the way pcbnew Flip() does for SMD parts."""
    for a, b in _LAYER_PAIRS:
        text = text.replace('"%s"' % a, '"__TMP_%s__"' % a)
    for a, b in _LAYER_PAIRS:
        text = text.replace('"%s"' % b, '"%s"' % a)
    for a, b in _LAYER_PAIRS:
        text = text.replace('"__TMP_%s__"' % a, '"%s"' % b)
    return text


def _set_property_ref(body, ref, rot):
    """Replace Reference property value and stamp rotation on text ats."""
    body = re.sub(
        r'(\(property "Reference" ")[^"]*(")',
        r'\g<1>%s\2' % ref,
        body,
        count=1,
    )
    # Library property/fp_text ats are `(at x y 0)`. Pad ats have no angle.
    body = re.sub(
        r'\(at ([-\d.]+) ([-\d.]+) (?:[-\d.]+)?\)(\s*\n\s*\(layer)',
        lambda m: "(at %s %s %s)%s" % (
            m.group(1), m.group(2), rot if rot else 0, m.group(3)),
        body,
    )
    return body


def footprint_sexpr(lib, name, x, y, ref, rot=0, back=False):
    path = _mod_path(lib, name)
    if not os.path.exists(path):
        raise RuntimeError("missing footprint: %s" % path)
    raw = open(path, encoding="utf-8").read().strip()
    if not raw.startswith("(footprint "):
        raise RuntimeError("bad mod: %s" % path)

    # Drop library metadata KiCad omits when embedding on a board.
    raw = re.sub(r'\n\t\(version [^\n]+', '', raw, count=1)
    raw = re.sub(r'\n\t\(generator [^\n]+', '', raw, count=1)
    raw = re.sub(r'\n\t\(generator_version [^\n]+', '', raw, count=1)
    raw = re.sub(r'\n\t\(layer "[FB]\.Cu"\)', '', raw, count=1)

    if back:
        raw = _flip_layers(raw)

    raw = re.sub(r'\(uuid "[^"]+"\)', lambda _m: '(uuid "%s")' % _uid(), raw)
    raw = _set_property_ref(raw, ref, rot)

    layer = "B.Cu" if back else "F.Cu"
    at = "(at %s %s)" % (x, y) if not rot else "(at %s %s %s)" % (x, y, rot)

    # Library mod body lines are indented with one tab. Board instances use
    # two tabs for the footprint body and one tab on the opening line.
    lines = raw.splitlines()
    body = lines[1:]  # skip "(footprint ..."
    out = [
        '\t(footprint "%s"' % name,
        '\t\t(layer "%s")' % layer,
        '\t\t(uuid "%s")' % _uid(),
        '\t\t%s' % at,
    ]
    for ln in body:
        out.append("\t" + ln if ln else ln)
    return "\n".join(out)


def outline_sexpr():
    x0, y0 = P.PCB_X, P.PCB_Y
    x1, y1 = P.PCB_X + P.PCB_W, P.PCB_Y + P.PCB_H
    segs = [
        ((x0, y0), (x1, y0)),
        ((x1, y0), (x1, y1)),
        ((x1, y1), (x0, y1)),
        ((x0, y1), (x0, y0)),
    ]
    parts = []
    for (a, b) in segs:
        parts.append(
            "\t(gr_line\n"
            "\t\t(start %s %s)\n"
            "\t\t(end %s %s)\n"
            "\t\t(stroke\n"
            "\t\t\t(width 0.1)\n"
            "\t\t\t(type default)\n"
            "\t\t)\n"
            "\t\t(layer \"Edge.Cuts\")\n"
            "\t\t(uuid \"%s\")\n"
            "\t)" % (a[0], a[1], b[0], b[1], _uid())
        )
    return "\n".join(parts)


def board_header():
    # Keep layer stack compatible with the existing routed board / KiCad 10.
    return """(kicad_pcb
\t(version 20260206)
\t(generator "pcb.py")
\t(generator_version "1.0")
\t(general
\t\t(thickness {th})
\t\t(legacy_teardrops no)
\t)
\t(paper "A4")
\t(layers
\t\t(0 "F.Cu" signal)
\t\t(2 "B.Cu" signal)
\t\t(9 "F.Adhes" user "F.Adhesive")
\t\t(11 "B.Adhes" user "B.Adhesive")
\t\t(13 "F.Paste" user)
\t\t(15 "B.Paste" user)
\t\t(5 "F.SilkS" user "F.Silkscreen")
\t\t(7 "B.SilkS" user "B.Silkscreen")
\t\t(1 "F.Mask" user)
\t\t(3 "B.Mask" user)
\t\t(17 "Dwgs.User" user "User.Drawings")
\t\t(19 "Cmts.User" user "User.Comments")
\t\t(21 "Eco1.User" user "User.Eco1")
\t\t(23 "Eco2.User" user "User.Eco2")
\t\t(25 "Edge.Cuts" user)
\t\t(27 "Margin" user)
\t\t(31 "F.CrtYd" user "F.Courtyard")
\t\t(29 "B.CrtYd" user "B.Courtyard")
\t\t(35 "F.Fab" user)
\t\t(33 "B.Fab" user)
\t)
\t(setup
\t\t(pad_to_mask_clearance 0)
\t\t(allow_soldermask_bridges_in_footprints no)
\t\t(pcbplotparams
\t\t\t(layerselection 0x00000000_00000000_55555555_5755f5ff)
\t\t\t(plot_on_all_layers_selection 0x00000000_00000000_00000000_00000000)
\t\t\t(disableapertmacros no)
\t\t\t(usegerberextensions no)
\t\t\t(usegerberattributes yes)
\t\t\t(usegerberadvancedattributes yes)
\t\t\t(creategerberjobfile yes)
\t\t\t(svgprecision 4)
\t\t\t(outputformat 1)
\t\t\t(mirror no)
\t\t\t(drillshape 1)
\t\t\t(scaleselection 1)
\t\t\t(outputdirectory "")
\t\t)
\t)
""".format(th=P.PCB_T)


def build_sexpr():
    """Placement-only board: footprints + edge. Routing is Task 3b."""
    parts = [board_header().rstrip()]
    placed = []

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
        parts.append(footprint_sexpr(TACT[0], TACT[1], x, y, ref))
        placed.append((ref, TACT[1], x, y, "F.Cu"))

    parts.append(footprint_sexpr(EXPANDER[0], EXPANDER[1], 45.0, 72.0, "U1"))
    placed.append(("U1", EXPANDER[1], 45.0, 72.0, "F.Cu"))
    parts.append(footprint_sexpr(
        SLIDE[0], SLIDE[1], P.POWER_SW_X, P.POWER_SW_Y, "SW_PWR"))
    placed.append(("SW_PWR", SLIDE[1], P.POWER_SW_X, P.POWER_SW_Y, "F.Cu"))
    parts.append(footprint_sexpr(
        SLIDE[0], SLIDE[1], P.MUTE_SW_X, P.MUTE_SW_Y, "SW_MUTE"))
    placed.append(("SW_MUTE", SLIDE[1], P.MUTE_SW_X, P.MUTE_SW_Y, "F.Cu"))

    for ref, ways, x, y, _note in CONNECTORS:
        lib, name = (JST4 if ways == 4 else JST2)
        parts.append(footprint_sexpr(lib, name, x, y, ref, rot=180, back=True))
        placed.append((ref, name, x, y, "B.Cu"))

    for i, (x, y) in enumerate(PCB_MOUNTS):
        ref = "H%d" % (i + 1)
        parts.append(footprint_sexpr(MHOLE[0], MHOLE[1], x, y, ref))
        placed.append((ref, MHOLE[1], x, y, "F.Cu"))

    parts.append(outline_sexpr())
    parts.append("\t(embedded_fonts no)")
    parts.append(")")
    return "\n".join(parts) + "\n", placed


def build_pcbnew():
    """Optional path: requires KiCad's Python + a live wx.App (GUI session)."""
    import wx
    _app = wx.App(False)  # noqa: F841
    import pcbnew

    def mm(v):
        return pcbnew.FromMM(v)

    def at(x, y):
        return pcbnew.VECTOR2I(mm(x), mm(y))

    def place(board, lib, name, x, y, ref, rot=0, back=False):
        fp = pcbnew.FootprintLoad(os.path.join(FP_ROOT, lib + ".pretty"), name)
        if fp is None:
            raise RuntimeError("missing footprint: %s / %s" % (lib, name))
        fp.SetPosition(at(x, y))
        if rot:
            fp.SetOrientationDegrees(rot)
        if back:
            fp.Flip(fp.GetPosition(), False)
        fp.SetReference(ref)
        board.Add(fp)
        return fp

    board = pcbnew.CreateEmptyBoard()
    for a, b in (
        ((P.PCB_X, P.PCB_Y), (P.PCB_X + P.PCB_W, P.PCB_Y)),
        ((P.PCB_X + P.PCB_W, P.PCB_Y), (P.PCB_X + P.PCB_W, P.PCB_Y + P.PCB_H)),
        ((P.PCB_X + P.PCB_W, P.PCB_Y + P.PCB_H), (P.PCB_X, P.PCB_Y + P.PCB_H)),
        ((P.PCB_X, P.PCB_Y + P.PCB_H), (P.PCB_X, P.PCB_Y)),
    ):
        seg = pcbnew.PCB_SHAPE(board)
        seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
        seg.SetStart(at(*a))
        seg.SetEnd(at(*b))
        seg.SetLayer(pcbnew.Edge_Cuts)
        seg.SetWidth(mm(0.1))
        board.Add(seg)

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
    place(board, EXPANDER[0], EXPANDER[1], 45.0, 72.0, "U1")
    place(board, SLIDE[0], SLIDE[1], P.POWER_SW_X, P.POWER_SW_Y, "SW_PWR")
    place(board, SLIDE[0], SLIDE[1], P.MUTE_SW_X, P.MUTE_SW_Y, "SW_MUTE")
    for ref, ways, x, y, _note in CONNECTORS:
        lib, name = (JST4 if ways == 4 else JST2)
        place(board, lib, name, x, y, ref, 180, back=True)
    for i, (x, y) in enumerate(PCB_MOUNTS):
        place(board, MHOLE[0], MHOLE[1], x, y, "H%d" % (i + 1))
    return board


if __name__ == "__main__":
    path = os.path.join(OUT, "pocket_card_controller.kicad_pcb")
    if os.environ.get("USE_PCBNEW") == "1":
        b = build_pcbnew()
        b.Save(path)
        import pcbnew
        print("saved %s (pcbnew)" % path)
        for f in b.GetFootprints():
            p = f.GetPosition()
            side = "B.Cu" if f.IsFlipped() else "F.Cu"
            print("   %-10s %-46s (%6.2f, %6.2f)  %s" % (
                f.GetReference(), str(f.GetFPID().GetLibItemName()),
                pcbnew.ToMM(p.x), pcbnew.ToMM(p.y), side))
    else:
        text, placed = build_sexpr()
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print("saved %s (sexpr headless)" % path)
        print("outline %.2f x %.2f mm at (%.2f, %.2f)" % (
            P.PCB_W, P.PCB_H, P.PCB_X, P.PCB_Y))
        print("footprints placed: %d" % len(placed))
        for ref, name, x, y, side in placed:
            print("   %-10s %-46s (%6.2f, %6.2f)  %s" % (ref, name, x, y, side))
