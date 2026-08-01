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
# Usage:
#   FREEROUTING_JAR=tools/freerouting-2.1.0.jar ./build_pcb.sh
#   # or rely on the default path below
set -e
cd "$(dirname "$0")"

KPY=/Users/stephenlavelle/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3
BRD=out/pcb/pocket_card_controller.kicad_pcb
KICAD_APP="${KICAD_APP:-/Users/stephenlavelle/Applications/KiCad/KiCad.app}"

# Placement is headless (stdlib sexpr). Routing still needs KiCad's pcbnew.
export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/jdk-23.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
# Footprint 3D models use ${KICAD10_3DMODEL_DIR}/... — CLI does not inherit the
# GUI path, so set it explicitly for STL/STEP export.
export KICAD10_3DMODEL_DIR="${KICAD10_3DMODEL_DIR:-$KICAD_APP/Contents/SharedSupport/3dmodels}"
export FREEROUTING_JAR="${FREEROUTING_JAR:-$PWD/tools/freerouting-2.1.0.jar}"
if [[ ! -f "$FREEROUTING_JAR" ]]; then
  echo "missing FREEROUTING_JAR=$FREEROUTING_JAR" >&2
  echo "download: https://github.com/freerouting/freerouting/releases/download/v2.1.0/freerouting-2.1.0.jar" >&2
  exit 1
fi

echo "== 1. placement and outline, from params.py"
python3 pcb.py | grep -E "outline|footprints|saved"

echo "== 2. netlist, first routing pass, zones injected"
"$KPY" pcb_route.py 2>/dev/null | grep -E "tracks|zones|injected|reused|expander|allocation|->"

echo "== 3. fill the pour"
if ! kicad-cli pcb drc --refill-zones --save-board --format json \
    --output out/pcb/drc.json "$BRD" 2>out/pcb/drc_cli.log; then
  echo "kicad-cli DRC failed; see out/pcb/drc_cli.log" >&2
  tail -20 out/pcb/drc_cli.log >&2 || true
  exit 1
fi
if grep -q 'Fehler beim Laden\|Error loading\|failed to load' out/pcb/drc_cli.log 2>/dev/null; then
  echo "board failed to load in kicad-cli; see out/pcb/drc_cli.log" >&2
  cat out/pcb/drc_cli.log >&2
  exit 1
fi

echo "== 4. second routing pass, now that ground is carried"
"$KPY" pcb_reroute.py 2>/dev/null | grep -E "tracks|zones|found"

echo "== 5. fill again -- a fill is stale the moment copper moves"
if ! kicad-cli pcb drc --refill-zones --save-board --format json \
    --output out/pcb/drc.json "$BRD" 2>out/pcb/drc_cli.log; then
  echo "kicad-cli DRC failed; see out/pcb/drc_cli.log" >&2
  exit 1
fi
if grep -q 'Fehler beim Laden\|Error loading\|failed to load' out/pcb/drc_cli.log 2>/dev/null; then
  echo "board failed to load in kicad-cli; see out/pcb/drc_cli.log" >&2
  cat out/pcb/drc_cli.log >&2
  exit 1
fi

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
if errs:
    for i in errs[:12]:
        print("   ERR %-28s %s" % (i.get("type"), (i.get("description") or "")[:100]))
PY

echo "== 7. 3D mesh (board + components) via kicad-cli"
STL=out/pcb/pocket_card_controller.stl
STEP=out/pcb/pocket_card_controller.step
# --subst-models: prefer STEP companions when a footprint only lists VRML.
kicad-cli pcb export stl --force --subst-models -o "$STL" "$BRD" >/dev/null
kicad-cli pcb export step --force --subst-models -o "$STEP" "$BRD" >/dev/null
# Keep legacy names some viewers/scripts already point at (KiCad native frame).
cp -f "$STL" out/pcb/exported.stl
cp -f "$STEP" out/pcb/exported.step
ls -la "$STL" "$STEP" | awk '{printf "   %s  %s\n", $5, $9}'

echo "== 8. place PCB into shell model space (exported_placed.*)"
if [[ -x .venv/bin/python ]]; then
  .venv/bin/python -c "import place_preview; place_preview.place_pcb()"
else
  python3 -c "import place_preview; place_preview.place_pcb()"
fi
