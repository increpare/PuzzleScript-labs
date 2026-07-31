#!/bin/bash
# Build the controller PCB end to end, with no manual steps.
#
# The zone fill is done by `kicad-cli pcb drc --refill-zones --save-board`,
# which is exactly what pressing B in the GUI does. pcbnew's own ZONE_FILLER
# segfaults headless, and board.Save() segfaults whenever a zone is present, so
# zones are written into the .kicad_pcb as text and filled by the CLI instead.
#
# Two routing passes, and the order matters: freerouting cannot see a pour that
# does not exist, so the first pass has no plane and routes badly. Once the
# plane is filled, the second pass only has signals left, which is the easy
# case -- ~25 point-to-point ground connections were the whole difficulty.
#
# Usage:  FREEROUTING_JAR=/path/to/freerouting-2.1.0.jar ./build_pcb.sh
set -e
cd "$(dirname "$0")"

KPY=/Users/stephenlavelle/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3
BRD=out/pcb/pocket_card_controller.kicad_pcb

echo "== 1. placement and outline, from params.py"
"$KPY" pcb.py 2>/dev/null | grep -E "outline|footprints"

echo "== 2. netlist, first routing pass, zones injected"
"$KPY" pcb_route.py 2>/dev/null | grep -E "tracks|zones|injected|reused"

echo "== 3. fill the pour"
kicad-cli pcb drc --refill-zones --save-board --format json \
    --output out/pcb/drc.json "$BRD" >/dev/null 2>&1

echo "== 4. second routing pass, now that ground is carried"
"$KPY" pcb_reroute.py 2>/dev/null | grep -E "tracks|zones|found"

echo "== 5. fill again -- a fill is stale the moment copper moves"
kicad-cli pcb drc --refill-zones --save-board --format json \
    --output out/pcb/drc.json "$BRD" >/dev/null 2>&1

echo "== 6. verdict"
python3 - <<'PY'
import json, collections, re
d = json.load(open("out/pcb/drc.json"))
un = d.get("unconnected_items", [])
nets = collections.Counter()
for i in un:
    for it in i.get("items", []):
        m = re.search(r"\[([\w+.]+)\]", it.get("description", ""))
        if m:
            nets[m.group(1)] += 1
errs = [i for i in d["violations"] if i.get("severity") == "error"]
print("   unconnected %d  %s" % (len(un), dict(nets) if nets else ""))
print("   violations  %d, of which errors %d" % (len(d["violations"]), len(errs)))
print("   %s" % dict(collections.Counter(i["type"] for i in d["violations"])))
PY
