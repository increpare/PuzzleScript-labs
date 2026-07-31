"""Re-route the controller PCB against an already-poured board.

Run after the ground zones have been filled in KiCad (open the board, press B,
save). With the plane carrying ground, freerouting only has the signal nets
left, which is the easy case -- the ~25 point-to-point ground connections were
the whole difficulty before.

  FREEROUTING_JAR=/path/to/freerouting-2.1.0.jar \\
  .../Python.framework/Versions/3.9/bin/python3 pcb_reroute.py

Works around the pcbnew crash rather than through it: Save() segfaults whenever
a zone is present, so the DSN is exported from the poured board (export does not
save), and the session is imported into a copy with the zones stripped out as
text. The zones are put back afterwards, unfilled.

You therefore need to press B and save once more at the end. That is not a
workaround artefact -- a fill is stale as soon as routing changes, so it would
need redoing anyway.
"""
import os
import re
import subprocess
import sys

import pcbnew

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HERE = os.path.dirname(os.path.abspath(__file__))
BRD = os.path.join(HERE, "out", "pcb", "pocket_card_controller.kicad_pcb")


def split_zones(text):
    """Return (text without zone blocks, list of zone blocks)."""
    blocks, out, i = [], [], 0
    while True:
        j = text.find("(zone", i)
        if j < 0:
            out.append(text[i:])
            break
        out.append(text[i:j])
        depth, k = 0, j
        while k < len(text):
            if text[k] == "(":
                depth += 1
            elif text[k] == ")":
                depth -= 1
                if depth == 0:
                    k += 1
                    break
            k += 1
        blocks.append(text[j:k])
        i = k
    return "".join(out), blocks


def main():
    jar = os.environ.get("FREEROUTING_JAR", "")
    if not os.path.exists(jar):
        sys.exit("set FREEROUTING_JAR")

    original = open(BRD).read()
    stripped, zones = split_zones(original)
    print("found %d zone block(s) in the board" % len(zones))

    # DSN from the POURED board, so freerouting sees ground as already carried
    board = pcbnew.LoadBoard(BRD)
    dsn = BRD.replace(".kicad_pcb", ".dsn")
    ses = BRD.replace(".kicad_pcb", ".ses")
    pcbnew.ExportSpecctraDSN(board, dsn)
    print("exported dsn from the poured board")

    subprocess.run(["java", "-jar", jar, "--gui.enabled=false", "-dct", "1",
                    "-de", dsn, "-do", ses, "-mp", "30", "-mt", "1"],
                   check=False)
    if not os.path.exists(ses):
        sys.exit("freerouting produced no session")

    # import into a zone-free copy: Save() cannot cope with zones present
    open(BRD, "w").write(stripped)
    board = pcbnew.LoadBoard(BRD)
    pcbnew.ImportSpecctraSES(board, ses)
    board.Save(BRD)

    text = open(BRD).read()
    cut = text.rstrip().rfind("\n)")
    # strip any stale fill: it is invalid the moment copper moves
    zones = [re.sub(r"\s*\(filled_polygon.*?\n\t\t\)", "", z, flags=re.S)
             for z in zones]
    open(BRD, "w").write(text[:cut] + "\n" + "\n".join(zones) + "\n)\n")

    board = pcbnew.LoadBoard(BRD)
    tr = [t for t in board.GetTracks() if t.Type() == pcbnew.PCB_TRACE_T]
    vi = [t for t in board.GetTracks() if t.Type() == pcbnew.PCB_VIA_T]
    print("tracks %d, vias %d, zones %d"
          % (len(tr), len(vi), len(board.Zones())))
    print("\nNow open the board in KiCad, press B, and save.")


if __name__ == "__main__":
    main()
