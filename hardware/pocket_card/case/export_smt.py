"""Export curated JLCPCB SMT BOM + CPL from the canonical controller board.

Writes:
  out/pcb/BOM_JLCPCB.csv
  out/pcb/CPL.csv
  out/pcb/pocket_card_controller-all-pos.csv   (raw KiCad pos)

The generic KiCad schematic BOM is a separate ``BOM.csv`` produced by the
electronics export pipeline.  It intentionally includes parts not present in
the curated, present-board-specific JLC mapping below.

LCSC numbers are curated below — re-check stock/library type before ordering.
"""
from __future__ import annotations

import csv
import math
import os
import subprocess
import sys
from pathlib import Path

if __package__:
    from . import params as P
    from hardware.pocket_card.electronics_pipeline.paths import BOARD, PCB_OUTPUT_DIR
else:  # Direct ``python3 export_smt.py`` execution.
    REPO_ROOT = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(REPO_ROOT))
    import params as P
    from hardware.pocket_card.electronics_pipeline.paths import BOARD, PCB_OUTPUT_DIR

HERE = Path(__file__).resolve().parent
OUT = PCB_OUTPUT_DIR
BRD = BOARD
JLC_BOM_NAME = "BOM_JLCPCB.csv"

# ref → (comment/MPN, footprint label for BOM, LCSC C#)
# Mounting holes omitted (not SMT).
PARTS = {
    "U1": (
        "MCP23017-E/SO",
        "SOIC-28W_7.5x17.9mm_P1.27mm",
        "C47023",
    ),
    "SW_UP1": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_DOWN1": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_LEFT1": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_RIGHT1": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_UNDO1": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_ACTION1": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_RESET1": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_MENU1": ("SKQGABE010", "SW_SPST_SKQG_WithStem", "C115351"),
    "SW_PWR1": ("PCM12SMTR", "SW_SPDT_PCM12", "C221841"),
    "SW_MUTE1": ("PCM12SMTR", "SW_SPDT_PCM12", "C221841"),
    # GH R/A headers — land = KiCad JST_GH_*; BOM MPN/LCSC from params.py
    # (XUNPU wafers; genuine JST C189895/C189893 often OOS).
    "J_I2C1": (P.CONN_4P_MPN, "JST_GH_SM04B-GHS-TB_1x04", P.CONN_4P_LCSC),
    "J_EXP1": (P.CONN_4P_MPN, "JST_GH_SM04B-GHS-TB_1x04", P.CONN_4P_LCSC),
    "J_BAT_IN1": (P.CONN_2P_MPN, "JST_GH_SM02B-GHS-TB_1x02", P.CONN_2P_LCSC),
    "J_BAT_OUT1": (P.CONN_2P_MPN, "JST_GH_SM02B-GHS-TB_1x02", P.CONN_2P_LCSC),
}


def export_kicad_pos(
    board_path: str | Path = BRD,
    output_dir: str | Path = OUT,
    *,
    runner=subprocess.run,
) -> str:
    """Export raw positions from the explicit board into the explicit output."""

    board = Path(board_path)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    path = output / "pocket_card_controller-all-pos.csv"
    cmd = [
        "kicad-cli", "pcb", "export", "pos",
        "--format", "csv",
        "--units", "mm",
        "--side", "both",
        "--bottom-negate-x",
        "-o", str(path),
        str(board),
    ]
    environment = dict(os.environ)
    environment["LANG"] = "C"
    environment["LC_ALL"] = "C"
    result = runner(
        cmd,
        cwd=board.parent,
        text=True,
        capture_output=True,
        check=False,
        timeout=120,
        env=environment,
    )
    if getattr(result, "returncode", None) != 0:
        diagnostic = str(getattr(result, "stderr", "") or getattr(result, "stdout", ""))
        raise RuntimeError(f"KiCad position export failed: {diagnostic[:8192]}")
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"KiCad position export did not produce {path}")
    return str(path)


def write_cpl(
    pos_path: str | Path,
    output_dir: str | Path = OUT,
) -> str:
    """JLCPCB pick-and-place: Designator,Mid X,Mid Y,Layer,Rotation."""
    output = Path(output_dir)
    out = output / "CPL.csv"
    rows = []
    seen = set()
    expected_fields = ("Ref", "Val", "Package", "PosX", "PosY", "Rot", "Side")
    with Path(pos_path).open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if tuple(reader.fieldnames or ()) != expected_fields:
            raise ValueError(
                "position CSV columns must be exactly " + ",".join(expected_fields)
            )
        for line_number, row in enumerate(reader, start=2):
            ref = row["Ref"].strip('"')
            if not ref:
                raise ValueError(f"position CSV row {line_number} has an empty Ref")
            side = row["Side"].strip('"')
            if side not in ("top", "bottom"):
                raise ValueError(
                    f"position CSV row {line_number} has invalid Side {side!r}"
                )
            numbers = {}
            for field in ("PosX", "PosY", "Rot"):
                try:
                    number = float(row[field])
                except (TypeError, ValueError) as error:
                    raise ValueError(
                        f"position CSV row {line_number} {field} must be numeric"
                    ) from error
                if not math.isfinite(number):
                    raise ValueError(
                        f"position CSV row {line_number} {field} must be finite"
                    )
                numbers[field] = number
            if ref not in PARTS:
                continue
            if ref in seen:
                raise ValueError(f"duplicate curated placement for {ref}")
            seen.add(ref)
            rows.append({
                "Designator": ref,
                "Mid X": numbers["PosX"],
                "Mid Y": numbers["PosY"],
                "Layer": side,
                "Rotation": numbers["Rot"],
            })
    missing = sorted(set(PARTS) - seen)
    if missing:
        raise ValueError("missing curated placement rows: " + ", ".join(missing))
    rows.sort(key=lambda r: r["Designator"])
    output.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
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
    return str(out)


def write_bom(output_dir: str | Path = OUT) -> str:
    """JLCPCB BOM: Comment,Designator,Footprint,LCSC Part #."""
    groups = {}
    for ref, (comment, fp, lcsc) in PARTS.items():
        key = (comment, fp, lcsc)
        groups.setdefault(key, []).append(ref)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    out = output / JLC_BOM_NAME
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Comment", "Designator", "Footprint", "LCSC Part #"])
        for (comment, fp, lcsc), refs in sorted(
            groups.items(), key=lambda kv: kv[0][2]
        ):
            w.writerow([comment, ",".join(sorted(refs)), fp, lcsc])
    return str(out)


def write_hardware_bom(output_dir: str | Path | None = None) -> str:
    """Case assembly fasteners — not SMT, not for JLCPCB.

    Rear-seat depths vary with the lower deck.  Group the per-joint selections
    by actual stocked length rather than assuming a north/south split.
    """
    output = Path(output_dir) if output_dir is not None else HERE / "out"
    output.mkdir(parents=True, exist_ok=True)
    out = output / "hardware_BOM.csv"
    # The electronics exporter imports this module under system Python, where
    # CadQuery is intentionally absent. Screw and nut geometry need the case
    # environment, so defer those imports until this case-only BOM is actually
    # requested (normally from the case venv).
    if __package__:
        from . import joints, nut_traps
    else:
        import joints, nut_traps
    rows = []
    for length, selections in joints.screw_length_groups().items():
        key = "SCREW_M2X%g" % length
        sites = ";".join("(%g,%g)" % (s.x, s.y) for s in selections)
        rows.append([
            "M2x%g pan-head machine screw" % length,
            key,
            len(selections),
            "%.1f" % length,
            "Rear machine screw into captive DIN 934 M2 nut",
            sites,
        ])
    nut_sites = nut_traps.sites()
    rows.append([
        "M2 DIN 934 hex nut",
        "NUT_M2",
        len(nut_sites),
        "%.1f" % P.NUT_MAX_T,
        "%.1f mm AF nominal; verify against SLA fit coupon" % P.NUT_NOMINAL_AF,
        ";".join("(%g,%g)" % (site.x, site.y) for site in nut_sites),
    ])
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["Comment", "Designator", "Qty", "Length_mm",
                    "Notes", "Sites_xy"])
        w.writerows(rows)
    return str(out)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    hw = write_hardware_bom()
    print("wrote", hw)
    if not BRD.is_file():
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
