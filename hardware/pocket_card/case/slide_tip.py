"""Dome tip for bottom-edge PCM12SMTR slides — not a wide T-cap.

Proud dome + stem through the letterbox + small inner retainer (captive, no
glue) + short U-fork on the STEP actuator. The whole tip is centered on the
actuator nub (STEP X mid = SLIDE_ACTUATOR_X_REL), not the footprint origin.

  +Y  outside (dome)
   0  outer wall face
  −Y  into the wall / cavity
"""
import cadquery as cq
import params as P


def tip_site_x(sw_x):
    """Device X of the tip / letterbox centre (= nub centre)."""
    return sw_x + P.SLIDE_ACTUATOR_X_REL


def tip_solid():
    """One tip at the origin; +Y outward. Local X=0 is the PCM12 nub centre."""
    flange_t = P.TIP_RAIL_T
    neck_len = P.WALL - flange_t
    dome_x = P.TIP_FACE_X
    dome_z = P.TIP_FACE_Z
    neck_x = P.TIP_NECK_X
    neck_z = dome_z - 2 * P.TIP_NECK_CLEAR

    r = min(0.35, P.TIP_PROUD * 0.45, dome_x * 0.2, dome_z * 0.2)
    dome = (cq.Workplane("XY")
            .box(dome_x, P.TIP_PROUD, dome_z, centered=(True, False, True)))
    if r > 0.05:
        dome = dome.edges(">Y").fillet(r)

    neck = (cq.Workplane("XY")
            .box(neck_x, neck_len, neck_z, centered=(True, False, True))
            .translate((0, -neck_len, 0)))
    flange = (cq.Workplane("XY")
              .box(P.TIP_FLANGE_X, flange_t, P.TIP_FLANGE_Z,
                   centered=(True, False, True))
              .translate((0, -P.WALL, 0)))

    pocket_w = P.SLIDE_ACTUATOR_W + P.TIP_POCKET_PLAY
    pocket_h = P.SLIDE_ACTUATOR_H + P.TIP_POCKET_PLAY
    wall_t = 0.6
    pcb_front_local = -P.SLIDE_ACTUATOR_Z_ABOVE_PCB
    z_floor = pcb_front_local + 0.20
    z_act0 = -pocket_h / 2
    z_act1 = pocket_h / 2
    z_roof = z_act1 + wall_t
    z_chan0 = max(z_act0, z_floor)

    fork_len = P.TIP_POCKET_CAVITY
    y0 = -P.WALL - fork_len

    def _wall_box(dx, dy, z0, z1, tx, ty):
        return (cq.Workplane("XY")
                .box(dx, dy, z1 - z0, centered=(True, False, False))
                .translate((tx, ty, z0)))

    left = _wall_box(wall_t, fork_len, z_chan0, z_roof,
                     -(pocket_w / 2 + wall_t / 2), y0)
    right = _wall_box(wall_t, fork_len, z_chan0, z_roof,
                      +(pocket_w / 2 + wall_t / 2), y0)
    roof = _wall_box(pocket_w + 2 * wall_t, fork_len, z_act1, z_roof, 0, y0)
    bite = (cq.Workplane("XY")
            .box(pocket_w, 0.35, pocket_h, centered=(True, False, True))
            .translate((0, -P.WALL - 0.05, 0)))

    tip = dome.union(neck).union(flange).union(left).union(right).union(roof)
    return tip.cut(bite)


def tip_cavity_at(sw_x, y_sw):
    """Letterbox + retainer/fork chamber, centred on the nub."""
    del y_sw
    x = tip_site_x(sw_x)
    z_c = -(P.PCB_FRONT_Z - P.SLIDE_ACTUATOR_Z_ABOVE_PCB)
    y_inner = P.BODY_H - P.WALL

    through = (cq.Workplane("XY")
               .box(P.TIP_SLOT_X, P.TIP_SLOT_Y, P.TIP_SLOT_Z,
                    centered=(True, False, True))
               .translate((x, y_inner - 0.5, z_c)))
    chamber_y = P.TIP_RAIL_T + P.TIP_POCKET_CAVITY + 0.4
    chamber = (cq.Workplane("XY")
               .box(P.TIP_CHAMBER_X, chamber_y, P.TIP_CHAMBER_Z,
                    centered=(True, False, True))
               .translate((x, y_inner - P.TIP_POCKET_CAVITY, z_c)))
    return through.union(chamber)


def edge_tip_openings():
    cuts = tip_cavity_at(P.POWER_SW_X, P.POWER_SW_Y)
    cuts = cuts.union(tip_cavity_at(P.MUTE_SW_X, P.MUTE_SW_Y))
    return cuts


def tip_pocket_aabb(sw_x):
    """Device-coord AABB of the seated tip's actuator channel."""
    z_c = -(P.PCB_FRONT_Z - P.SLIDE_ACTUATOR_Z_ABOVE_PCB)
    pw = P.SLIDE_ACTUATOR_W + P.TIP_POCKET_PLAY
    ph = P.SLIDE_ACTUATOR_H + P.TIP_POCKET_PLAY
    cx = tip_site_x(sw_x)
    return {
        "x0": cx - pw / 2, "x1": cx + pw / 2,
        "y0": P.BODY_H + (-P.WALL - P.TIP_POCKET_CAVITY),
        "y1": P.BODY_H + (-P.WALL + 0.3),
        "z0": z_c - ph / 2, "z1": z_c + ph / 2,
    }


def tip_seated(sw_x):
    """Tip with outer face on the south wall, centred on the nub."""
    z_c = -(P.PCB_FRONT_Z - P.SLIDE_ACTUATOR_Z_ABOVE_PCB)
    return tip_solid().translate((tip_site_x(sw_x), P.BODY_H, z_c))
