"""Export JLCPCB SMT BOM + CPL from the controller board.

Writes:
  out/pcb/BOM.csv
  out/pcb/CPL.csv
  out/pcb/pocket_card_controller-all-pos.csv   (raw KiCad pos)

LCSC numbers are curated below — re-check stock/library type before ordering.
"""
from __future__ import annotations

import csv
import os
import subprocess
import sys

import params as P

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "pcb")
BRD = os.path.join(OUT, "pocket_card_controller.kicad_pcb")

# ref → (comment/MPN, footprint label for BOM, LCSC C#)
# Mounting holes omitted (not SMT).
PARTS = {
    "U1": (
        "MCP23017-E/SO",
        "SOIC-28W_7.5x17.9mm_P1.27mm",
        "C47023",
    ),
    "SW_UP": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_DOWN": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_LEFT": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_RIGHT": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_UNDO": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_ACTION": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_RESET": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_MENU": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_PWR": ("PCM12SMTR", "SW_SPDT_PCM12", "C221841"),
    "SW_MUTE": ("PCM12SMTR", "SW_SPDT_PCM12", "C221841"),
    # GH R/A headers — land = KiCad JST_GH_*; BOM MPN/LCSC from params.py
    # (XUNPU wafers; genuine JST C189895/C189893 often OOS).
    "J_I2C": (P.CONN_4P_MPN, "JST_GH_SM04B-GHS-TB_1x04", P.CONN_4P_LCSC),
    "J_EXP": (P.CONN_4P_MPN, "JST_GH_SM04B-GHS-TB_1x04", P.CONN_4P_LCSC),
    "J_BAT_IN": (P.CONN_2P_MPN, "JST_GH_SM02B-GHS-TB_1x02", P.CONN_2P_LCSC),
    "J_BAT_OUT": (P.CONN_2P_MPN, "JST_GH_SM02B-GHS-TB_1x02", P.CONN_2P_LCSC),
}


def export_kicad_pos() -> str:
    path = os.path.join(OUT, "pocket_card_controller-all-pos.csv")
    cmd = [
        "kicad-cli", "pcb", "export", "pos",
        "--format", "csv",
        "--units", "mm",
        "--side", "both",
        "--bottom-negate-x",
        "-o", path,
        BRD,
    ]
    subprocess.check_call(cmd)
    return path


def write_cpl(pos_path: str) -> str:
    """JLCPCB pick-and-place: Designator,Mid X,Mid Y,Layer,Rotation."""
    out = os.path.join(OUT, "CPL.csv")
    rows = []
    with open(pos_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ref = row["Ref"].strip('"')
            if ref.startswith("H") or ref not in PARTS:
                continue
            rows.append({
                "Designator": ref,
                "Mid X": float(row["PosX"]),
                "Mid Y": float(row["PosY"]),
                "Layer": "top" if row["Side"].strip('"') == "top" else "bottom",
                "Rotation": float(row["Rot"]),
            })
    rows.sort(key=lambda r: r["Designator"])
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f, fieldnames=["Designator", "Mid X", "Mid Y", "Layer", "Rotation"]
        )
        w.writeheader()
        for r in rows:
            w.writerow({
                "Designator": r["Designator"],
                "Mid X": "%.4f" % r["Mid X"],
                "Mid Y": "%.4f" % r["Mid Y"],
                "Layer": r["Layer"],
                "Rotation": "%.1f" % r["Rotation"],
            })
    return out


def write_bom() -> str:
    """JLCPCB BOM: Comment,Designator,Footprint,LCSC Part #."""
    groups = {}
    for ref, (comment, fp, lcsc) in PARTS.items():
        key = (comment, fp, lcsc)
        groups.setdefault(key, []).append(ref)
    out = os.path.join(OUT, "BOM.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Comment", "Designator", "Footprint", "LCSC Part #"])
        for (comment, fp, lcsc), refs in sorted(
            groups.items(), key=lambda kv: kv[0][2]
        ):
            w.writerow([comment, ",".join(sorted(refs)), fp, lcsc])
    return out


def write_hardware_bom() -> str:
    """Case assembly fasteners — not SMT, not for JLCPCB.

    The north rib deepened two module screw seats, so M2×10 is needed there
    and M2×8 elsewhere. Sourced from params.SCREW_*.
    """
    out = os.path.join(HERE, "out", "hardware_BOM.csv")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    rows = []
    for key, spec in (("SCREW_NORTH", P.SCREW_NORTH),
                      ("SCREW_SOUTH", P.SCREW_SOUTH)):
        sites = ";".join("(%g,%g)" % xy for xy in spec["sites"])
        rows.append([
            spec["mpn"],
            key,
            spec["qty"],
            "%.1f" % spec["length"],
            "M2 pan-head self-tap into Ø1.7 pilot",
            sites,
        ])
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Comment", "Designator", "Qty", "Length_mm",
                    "Notes", "Sites_xy"])
        w.writerows(rows)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    hw = write_hardware_bom()
    print("wrote", hw)
    if not os.path.isfile(BRD):
        sys.exit("missing board: %s" % BRD)
    pos = export_kicad_pos()
    bom = write_bom()
    cpl = write_cpl(pos)
    print("wrote", bom)
    print("wrote", cpl)
    print("wrote", pos)
    print("parts", len(PARTS), "(holes excluded)")
    print("NOTE: confirm LCSC stock + Basic/Extended; JLCPCB may ask to")
    print("      tweak rotations for SKQG / JST / PCM12 on first upload.")


if __name__ == "__main__":
    main()
