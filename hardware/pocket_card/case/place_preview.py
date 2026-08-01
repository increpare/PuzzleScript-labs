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
  out/pcb/exported_placed.stl   (+ .step) — same PCB, after board build

Run:  .venv/bin/python place_preview.py
"""
import os

import cadquery as cq

import params as P
import coupon
import shell_front
import slide_tip

HERE = os.path.dirname(os.path.abspath(__file__))
PCB_DIR = os.path.join(HERE, "out", "pcb")
ORDER = os.path.join(HERE, "out", "order")
PREV = os.path.join(ORDER, "preview")
os.makedirs(PREV, exist_ok=True)

STATIONS = [
    ("cap_up", P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D, False),
    ("cap_down", P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D, False),
    ("cap_left", P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),
    ("cap_right", P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),
    ("cap_undo", P.UNDO_X, P.UNDO_Y, P.AB_CAP_D, False),
    ("cap_action", P.ACT_X, P.ACT_Y, P.AB_CAP_D, False),
    ("cap_reset", P.RESET_X, P.RESET_Y, P.RESET_CAP_D, False),
    ("cap_menu", P.MENU_X, P.MENU_Y, None, True),
]


def _as_shape(obj):
    return obj.val() if hasattr(obj, "val") else obj


def _export(shape, path):
    cq.exporters.export(shape, path)
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
    shape = _as_shape(shape)
    board = max(shape.Solids(), key=lambda s: s.Volume())
    board_top = board.BoundingBox().zmax
    # F.Cu → device z=-PCB_FRONT_Z; flip Y into device; then shell model space.
    device = shape.translate((0, 0, -board_top - P.PCB_FRONT_Z)).mirror("XZ")
    return shell_front.to_model_space(device)


def place_pcb():
    step_in = os.path.join(PCB_DIR, "pocket_card_controller.step")
    if not os.path.isfile(step_in):
        step_in = os.path.join(PCB_DIR, "exported.step")
    if not os.path.isfile(step_in):
        raise RuntimeError("missing board STEP — run ./build_pcb.sh first")

    raw = cq.importers.importStep(step_in)
    placed = kicad_pcb_to_model_space(raw)

    for folder, name in (
        (PREV, "pcb.stl"),
        (PREV, "pcb.step"),
        (ORDER, "pcb_placed.stl"),
        (ORDER, "pcb_placed.step"),
        (PCB_DIR, "exported_placed.stl"),
        (PCB_DIR, "exported_placed.step"),
        (PCB_DIR, "pocket_card_controller_placed.stl"),
        (PCB_DIR, "pocket_card_controller_placed.step"),
    ):
        _export(placed, os.path.join(folder, name))

    bb = _bbox(placed)
    print(f"pcb placed  X[{bb.xmin:.2f},{bb.xmax:.2f}] "
          f"Y[{bb.ymin:.2f},{bb.ymax:.2f}] Z[{bb.zmin:.2f},{bb.zmax:.2f}]")


def place_tips():
    solids = []
    for name, x in (("tip_power", P.POWER_SW_X), ("tip_mute", P.MUTE_SW_X)):
        tip = shell_front.to_model_space(slide_tip.tip_seated(x))
        solids.append(_as_shape(tip))
        _export(tip, os.path.join(PREV, name + ".stl"))
        _export(tip, os.path.join(PREV, name + ".step"))
    compound = cq.Compound.makeCompound(solids)
    _export(compound, os.path.join(PREV, "tips_placed.step"))
    _export(compound, os.path.join(ORDER, "tips_placed.step"))
    print(f"tips placed  {len(solids)} separate STL + tips_placed.step")


def place_caps():
    solids = []
    clr = P.FIT_CLEAR
    for name, x, y, d, pill in STATIONS:
        shape = coupon.cap(d, clr, pill=pill)
        if pill and P.MENU_ANGLE:
            shape = shape.rotate((0, 0, 0), (0, 0, 1), -P.MENU_ANGLE)
        placed = shell_front.to_model_space(shape.translate((x, y, 0)))
        solids.append(_as_shape(placed))
        _export(placed, os.path.join(PREV, name + ".stl"))
        _export(placed, os.path.join(PREV, name + ".step"))
    compound = cq.Compound.makeCompound(solids)
    _export(compound, os.path.join(PREV, "caps_placed.step"))
    _export(compound, os.path.join(ORDER, "caps_placed.step"))
    print(f"caps placed  {len(solids)} separate STL + caps_placed.step "
          f"(clear {clr:.2f})")


def main():
    print(f"preview dir {PREV}")
    place_pcb()
    place_tips()
    place_caps()
    print("drag from out/order/preview/ — already in shell model space")
    print("PCB also at out/pcb/exported_placed.stl (and out/order/pcb_placed.stl)")


if __name__ == "__main__":
    main()
