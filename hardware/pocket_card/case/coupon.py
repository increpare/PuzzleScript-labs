"""Button clearance-ladder coupon.

The first print. Its job is to find two numbers that cannot be derived, only
measured on a real print:

  CAP_CLEAR     head-to-hole radial clearance
  COLLAR_CLEAR  flange-to-collar radial clearance

Five direction stations sweep both together across COUPON_CLEARANCES; you keep
the one that slides freely with no perceptible slop. Two further stations carry
the Undo/Action and Reset/Menu cap sizes at the middle value, so the feel of
all three sizes can be compared in the hand.

Coordinates: z = 0 is the OUTER face, +z points out of the device (so the cap
crown is at positive z and the collars run negative). This is the params.py
convention with the sign flipped for modelling convenience.

Run:  .venv/bin/python coupon.py
"""
import os
import cadquery as cq

import params as P

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

PLATE_W, PLATE_H = 88.0, 44.0
ROW1_Y, ROW2_Y = 11.0, -13.0
LADDER_X = (-32.0, -16.0, 0.0, 16.0, 32.0)

COLLAR_WALL = 1.2
FLAT_DEPTH = 0.8          # anti-rotation flats, so arrow legends stay upright


def _shoulder_planes():
    z_flat_top = -(P.FACE_T + P.CAP_FLANGE_T + P.HARD_STOP_AT)
    z_flat_bot = z_flat_top - P.SHOULDER_FLAT_T
    z_ramp_bot = z_flat_bot - P.SHOULDER_RAMP_T
    return z_flat_top, z_flat_bot, z_ramp_bot


def _shoulder_bore_round(bore, bore_d, depth):
    """Snap-over shoulder: guide bore, flat lip, insertion ramp."""
    z_flat_top, z_flat_bot, z_ramp_bot = _shoulder_planes()
    r = bore_d / 2
    sr = (bore_d - 2 * P.SHOULDER_RADIAL) / 2

    bore = bore.cut(cq.Workplane("XY").circle(r).extrude(z_flat_top))
    bore = bore.cut(
        cq.Workplane("XY").workplane(offset=z_flat_top).circle(sr).extrude(z_flat_bot - z_flat_top))
    try:
        ramp = (cq.Workplane("XY").workplane(offset=z_flat_bot).circle(sr)
                .workplane(offset=z_ramp_bot - z_flat_bot).circle(r).loft(combine=True))
        bore = bore.cut(ramp)
    except Exception:
        bore = bore.cut(cq.Workplane("XY").workplane(offset=z_flat_bot).circle(r)
                         .extrude(-(depth + 1) - z_flat_bot))
        bore = bore.edges("<Z").chamfer(0.15)
    bore = bore.cut(cq.Workplane("XY").workplane(offset=z_ramp_bot).circle(r)
                     .extrude(-(depth + 1) - z_ramp_bot))
    return bore


def _shoulder_bore_slot(bore, bore_l, bore_w, depth):
    """Snap-over shoulder for a pill station."""
    z_flat_top, z_flat_bot, z_ramp_bot = _shoulder_planes()
    shoulder_l = bore_l - 2 * P.SHOULDER_RADIAL
    shoulder_w = bore_w - 2 * P.SHOULDER_RADIAL

    bore = bore.cut(cq.Workplane("XY").slot2D(bore_l, bore_w, 0).extrude(z_flat_top))
    bore = bore.cut(
        cq.Workplane("XY").workplane(offset=z_flat_top)
        .slot2D(shoulder_l, shoulder_w, 0).extrude(z_flat_bot - z_flat_top))
    try:
        ramp = (cq.Workplane("XY").workplane(offset=z_flat_bot)
                .slot2D(shoulder_l, shoulder_w, 0)
                .workplane(offset=z_ramp_bot - z_flat_bot)
                .slot2D(bore_l, bore_w, 0).loft(combine=True))
        bore = bore.cut(ramp)
    except Exception:
        bore = bore.cut(cq.Workplane("XY").workplane(offset=z_flat_bot)
                         .slot2D(bore_l, bore_w, 0).extrude(-(depth + 1) - z_flat_bot))
        bore = bore.edges("<Z").chamfer(0.15)
    bore = bore.cut(cq.Workplane("XY").workplane(offset=z_ramp_bot)
                     .slot2D(bore_l, bore_w, 0).extrude(-(depth + 1) - z_ramp_bot))
    return bore


def _flats(wp, radius, depth):
    """Cut two opposed flats, leaving `radius - depth` across the flat faces."""
    across = radius - depth
    for sign in (1, -1):
        wp = wp.cut(
            cq.Workplane("XY")
            .box(4 * radius, 4 * radius, 100, centered=(True, True, True))
            .translate((0, sign * (across + 2 * radius), 0))
        )
    return wp


def collar(hole_d, clear_collar, keyed):
    """One station's collar boss, to be unioned onto the plate underside."""
    depth = P.FACE_T + P.COLLAR_DEPTH
    flange_d = hole_d + 2 * P.CAP_FLANGE_OS
    bore_d = flange_d + 2 * clear_collar
    outer_d = bore_d + 2 * COLLAR_WALL

    boss = (
        cq.Workplane("XY")
        .circle(outer_d / 2)
        .extrude(-depth)
    )
    bore = cq.Workplane("XY").circle(bore_d / 2).extrude(-depth - 1)
    if keyed:
        bore = _flats(bore, bore_d / 2, FLAT_DEPTH)
    bore = _shoulder_bore_round(bore, bore_d, depth)
    return boss.cut(bore)


def cap(hole_d, clear_cap, pill=False):
    """A single button cap: crown, head, flange, boss.

    Every round cap is keyed, because every round collar is: button_station()
    keys unconditionally. This used to be a caller-supplied flag, and a second
    table in build_variants.py had it False for undo and action -- whose Ø13.2
    flanges then could not pass the 0.8 mm flats in their own bores. There is no
    flag now, so the two cannot disagree again. The pill is keyed by its shape.
    """
    if pill:
        head = (
            cq.Workplane("XY")
            .slot2D(P.PILL_L - 2 * clear_cap, P.PILL_W - 2 * clear_cap, 0)
            .extrude(P.CAP_PROUD)
            .faces("<Z").workplane()
            .slot2D(P.PILL_L - 2 * clear_cap, P.PILL_W - 2 * clear_cap, 0)
            .extrude(P.FACE_T)
        )
        flange = (
            cq.Workplane("XY").workplane(offset=-P.FACE_T)
            .slot2D(P.PILL_L + 2 * P.CAP_FLANGE_OS, P.PILL_W + 2 * P.CAP_FLANGE_OS, 0)
            .extrude(-P.CAP_FLANGE_T)
        )
        return head.union(flange)

    head_d = hole_d - 2 * clear_cap
    flange_d = hole_d + 2 * P.CAP_FLANGE_OS
    head = cq.Workplane("XY").circle(head_d / 2).extrude(P.CAP_PROUD)
    head = head.union(
        cq.Workplane("XY").circle(head_d / 2).extrude(-P.FACE_T)
    )
    # dished crown: subtract a large sphere tangent to the top face
    dish_r = head_d * 1.6
    head = head.cut(
        cq.Workplane("XY")
        .sphere(dish_r)
        .translate((0, 0, P.CAP_PROUD + dish_r - 0.35))
    )

    flange = (
        cq.Workplane("XY").workplane(offset=-P.FACE_T)
        .circle(flange_d / 2).extrude(-P.CAP_FLANGE_T)
    )
    flange = _flats(flange, flange_d / 2, FLAT_DEPTH + 0.05)

    # boss down to the plunger; hard stop is the collar shoulder, not a skirt
    boss_top = -(P.FACE_T + P.CAP_FLANGE_T)
    boss = (
        cq.Workplane("XY").workplane(offset=boss_top)
        .circle(1.5).extrude(-P.CAP_BOSS_GAP)
    )
    return head.union(flange).union(boss)


def build_plate():
    plate = cq.Workplane("XY").box(PLATE_W, PLATE_H, P.FACE_T,
                                   centered=(True, True, False)).translate((0, 0, -P.FACE_T))

    stations = []
    for x, clr in zip(LADDER_X, P.COUPON_CLEARANCES):
        stations.append((x, ROW1_Y, P.DIR_CAP_D, clr, True, False))
    mid = P.COUPON_CLEARANCES[len(P.COUPON_CLEARANCES) // 2]
    stations.append((-20.0, ROW2_Y, P.AB_CAP_D, mid, False, False))
    stations.append((15.0, ROW2_Y, None, mid, False, True))

    for x, y, hole_d, clr, keyed, pill in stations:
        if pill:
            cutter = (cq.Workplane("XY")
                      .slot2D(P.PILL_L + 2 * clr, P.PILL_W + 2 * clr, 0)
                      .extrude(-10).translate((x, y, 1)))
            bore_l = P.PILL_L + 2 * P.CAP_FLANGE_OS + 2 * mid
            bore_w = P.PILL_W + 2 * P.CAP_FLANGE_OS + 2 * mid
            depth = P.FACE_T + P.COLLAR_DEPTH
            boss = (cq.Workplane("XY")
                    .slot2D(bore_l + 2 * COLLAR_WALL, bore_w + 2 * COLLAR_WALL, 0)
                    .extrude(-depth))
            bore = cq.Workplane("XY").slot2D(bore_l, bore_w, 0).extrude(-depth - 1)
            bore = _shoulder_bore_slot(bore, bore_l, bore_w, depth)
            plate = plate.union(boss.cut(bore).translate((x, y, 0))).cut(cutter)
        else:
            plate = plate.union(collar(hole_d, clr, keyed).translate((x, y, 0)))
            plate = plate.cut(
                cq.Workplane("XY").circle(hole_d / 2).extrude(-10).translate((x, y, 1))
            )

    # engrave the clearance value beside each ladder station, 0.4 mm deep
    for x, clr in zip(LADDER_X, P.COUPON_CLEARANCES):
        label = (cq.Workplane("XY")
                 .text(f"{clr:.2f}", 4.0, 0.5, combine=False)
                 .translate((x, ROW1_Y + 9.5, -0.25)))
        plate = plate.cut(label)
    return plate


if __name__ == "__main__":
    plate = build_plate()
    cq.exporters.export(plate, os.path.join(OUT, "coupon_plate.stl"))
    cq.exporters.export(plate, os.path.join(OUT, "coupon_plate.step"))
    print(f"plate  {PLATE_W} x {PLATE_H} x {P.FACE_T + P.COLLAR_DEPTH:.2f}")

    # One file per cap. Print services quote and nest per part, and several
    # will reject a single STL containing disjoint solids. Each cap is exported
    # at the origin, and the ladder index is engraved on the crown so the parts
    # stay identifiable no matter how they come back.
    def marked(shape, idx):
        mark = (cq.Workplane("XY").text(str(idx), 3.0, 1.0, combine=False)
                .translate((0, 0, P.CAP_PROUD - 0.5)))
        return shape.cut(mark)

    mid = P.COUPON_CLEARANCES[len(P.COUPON_CLEARANCES) // 2]
    parts = []
    for i, clr in enumerate(P.COUPON_CLEARANCES):
        parts.append((f"cap_{i + 1}_dir_{clr:.2f}".replace(".", "p"),
                      marked(cap(P.DIR_CAP_D, clr), i + 1), clr))
    parts.append((f"cap_6_undo-action_{mid:.2f}".replace(".", "p"),
                  marked(cap(P.AB_CAP_D, mid), 6), mid))
    parts.append((f"cap_7_menu-pill_{mid:.2f}".replace(".", "p"),
                  cap(None, mid, pill=True), mid))

    for name, shape, clr in parts:
        cq.exporters.export(shape, os.path.join(OUT, name + ".stl"))
        cq.exporters.export(shape, os.path.join(OUT, name + ".step"))
    print(f"caps   {len(parts)} separate files, one per part:")
    for name, _, clr in parts:
        print(f"         {name}.stl        clearance {clr:.2f} mm")

    backing = (cq.Workplane("XY")
               .box(PLATE_W, PLATE_H, 1.6, centered=(True, True, False))
               .translate((0, 0, -P.PCB_FRONT_Z - 1.6)))
    cq.exporters.export(backing, os.path.join(OUT, "coupon_backing.stl"))
    print(f"backing plate at z = -{P.PCB_FRONT_Z:.2f} (the PCB front plane)")
