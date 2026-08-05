"""Export overlay meshes already in shell model space — no manual reposition.

KiCad's board STL/STEP uses Y-down board coords with Z up from the board
bottom. Shell / tip / cap exports use shell_front.to_model_space(). This script
writes placed parts into that same frame so you can drag them into a viewer
together.

Parts are separate files (not unioned) so they stay selectable.

  out/order/preview/pcb.stl
  out/order/preview/tip_power.stl
  out/order/preview/tip_mute.stl
  out/order/preview/cap_*.stl
  out/order/pcb_placed.stl      (+ .step) — same PCB in shell model space

Run:  .venv/bin/python place_preview.py
"""
import importlib
import sys
from pathlib import Path

if __package__:
    from hardware.pocket_card.electronics_pipeline.exports import require_current_exports
    from hardware.pocket_card.electronics_pipeline.paths import (
        ELECTRONICS_DIR,
        PCB_OUTPUT_DIR,
    )
else:  # Direct execution from the case directory.
    REPO_ROOT = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(REPO_ROOT))
    from hardware.pocket_card.electronics_pipeline.exports import require_current_exports
    from hardware.pocket_card.electronics_pipeline.paths import (
        ELECTRONICS_DIR,
        PCB_OUTPUT_DIR,
    )

HERE = Path(__file__).resolve().parent
PCB_DIR = PCB_OUTPUT_DIR
ORDER = HERE / "out" / "order"
PREV = ORDER / "preview"


def _load_modules():
    """Delay CadQuery and model imports until current exports are confirmed."""

    cq = importlib.import_module("cadquery")
    package = __package__
    prefix = "." if package else ""
    coupon = importlib.import_module(prefix + "coupon", package)
    P = importlib.import_module(prefix + "params", package)
    shell_front = importlib.import_module(prefix + "shell_front", package)
    slide_tip = importlib.import_module(prefix + "slide_tip", package)
    return cq, P, coupon, shell_front, slide_tip


def _require_exports():
    require_current_exports(ELECTRONICS_DIR, PCB_OUTPUT_DIR)


def _ensure_output_dirs():
    PREV.mkdir(parents=True, exist_ok=True)
    ORDER.mkdir(parents=True, exist_ok=True)


def _stations(P):
    return (
        ("cap_up", P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D, False),
        ("cap_down", P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D, False),
        ("cap_left", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),
        ("cap_right", P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),
        ("cap_undo", P.UNDO_X, P.UNDO_Y, P.AB_CAP_D, False),
        ("cap_action", P.ACT_X, P.ACT_Y, P.AB_CAP_D, False),
        ("cap_reset", P.RESET_X, P.RESET_Y, P.RESET_CAP_D, False),
        ("cap_menu", P.MENU_X, P.MENU_Y, None, True),
    )


def _as_shape(obj):
    return obj.val() if hasattr(obj, "val") else obj


def _export(shape, path):
    cq, _, _, _, _ = _load_modules()
    cq.exporters.export(shape, str(path))
    return path


def _bbox(shape):
    s = _as_shape(shape)
    return s.BoundingBox()


def kicad_pcb_to_model_space(shape):
    """KiCad board export → same frame as shell_front.build().

    KiCad: X right, Y south-negative, Z up from board bottom, F.Cu ≈ zmax of
    the FR4 solid. Device: Y south-positive, F.Cu at z=-PCB_FRONT_Z. Then the
    usual to_model_space mirror.
    """
    _, P, _, shell_front, _ = _load_modules()
    shape = _as_shape(shape)
    board = max(shape.Solids(), key=lambda s: s.Volume())
    board_top = board.BoundingBox().zmax
    # F.Cu → device z=-PCB_FRONT_Z; flip Y into device; then shell model space.
    device = shape.translate((0, 0, -board_top - P.PCB_FRONT_Z)).mirror("XZ")
    return shell_front.to_model_space(device)


def place_pcb():
    _require_exports()
    _ensure_output_dirs()
    cq, _, _, _, _ = _load_modules()
    step_in = PCB_DIR / "pocket_card_controller.step"

    raw = cq.importers.importStep(str(step_in))
    placed = kicad_pcb_to_model_space(raw)

    for folder, name in (
        (PREV, "pcb.stl"),
        (PREV, "pcb.step"),
        (ORDER, "pcb_placed.stl"),
        (ORDER, "pcb_placed.step"),
    ):
        _export(placed, folder / name)

    bb = _bbox(placed)
    print(f"pcb placed  X[{bb.xmin:.2f},{bb.xmax:.2f}] "
          f"Y[{bb.ymin:.2f},{bb.ymax:.2f}] Z[{bb.zmin:.2f},{bb.zmax:.2f}]")


def place_tips():
    _require_exports()
    _ensure_output_dirs()
    cq, P, _, shell_front, slide_tip = _load_modules()
    solids = []
    for name, x in (("tip_power", P.POWER_SW_X), ("tip_mute", P.MUTE_SW_X)):
        tip = shell_front.to_model_space(slide_tip.tip_seated(x))
        solids.append(_as_shape(tip))
        _export(tip, PREV / (name + ".stl"))
        _export(tip, PREV / (name + ".step"))
    compound = cq.Compound.makeCompound(solids)
    _export(compound, PREV / "tips_placed.step")
    _export(compound, ORDER / "tips_placed.step")
    print(f"tips placed  {len(solids)} separate STL + tips_placed.step")


def place_caps():
    _require_exports()
    _ensure_output_dirs()
    cq, P, coupon, shell_front, _ = _load_modules()
    solids = []
    clr = P.FIT_CLEAR
    for name, x, y, d, pill in _stations(P):
        shape = coupon.cap(d, clr, pill=pill)
        if pill and P.MENU_ANGLE:
            shape = shape.rotate((0, 0, 0), (0, 0, 1), -P.MENU_ANGLE)
        placed = shell_front.to_model_space(shape.translate((x, y, 0)))
        solids.append(_as_shape(placed))
        _export(placed, PREV / (name + ".stl"))
        _export(placed, PREV / (name + ".step"))
    compound = cq.Compound.makeCompound(solids)
    _export(compound, PREV / "caps_placed.step")
    _export(compound, ORDER / "caps_placed.step")
    print(f"caps placed  {len(solids)} separate STL + caps_placed.step "
          f"(clear {clr:.2f})")


def assemble():
    """One STEP/STL with front + back + PCB in shell model space (showable)."""
    _require_exports()
    _ensure_output_dirs()
    cq, _, _, shell_front, _ = _load_modules()
    package = __package__
    shell_back = importlib.import_module(".shell_back" if package else "shell_back", package)

    parts = []
    front = shell_front.build()
    back = shell_back.build_back()
    parts.append(_as_shape(front))
    parts.append(_as_shape(back))
    _export(front, PREV / "shell_front.stl")
    _export(back, PREV / "shell_back.stl")

    step_in = PCB_DIR / "pocket_card_controller.step"
    placed = kicad_pcb_to_model_space(cq.importers.importStep(str(step_in)))
    parts.append(_as_shape(placed))
    _export(placed, PREV / "pcb.stl")
    _export(placed, PREV / "pcb.step")

    compound = cq.Compound.makeCompound(parts)
    for folder, name in (
        (PREV, "assembly.step"),
        (PREV, "assembly.stl"),
        (ORDER, "assembly.step"),
        (ORDER, "assembly.stl"),
    ):
        _export(compound, folder / name)
    bb = _bbox(compound)
    print(f"assembly    {len(parts)} solids  "
          f"X[{bb.xmin:.2f},{bb.xmax:.2f}] "
          f"Y[{bb.ymin:.2f},{bb.ymax:.2f}] "
          f"Z[{bb.zmin:.2f},{bb.zmax:.2f}]")
    print(f"  -> {ORDER / 'assembly.step'}")


def main():
    _require_exports()
    print(f"preview dir {PREV}")
    place_pcb()
    place_tips()
    place_caps()
    assemble()
    print("drag from out/order/preview/ — already in shell model space")
    print("PCB also at out/order/pcb_placed.stl")
    print("full pack: out/order/assembly.step")


if __name__ == "__main__":
    main()
