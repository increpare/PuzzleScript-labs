"""Shell-captive tip for bottom-edge JS102011-class slides."""
import cadquery as cq
import params as P


def tip_solid():
    """One tip in device coords, centered at origin, thumb face +Y.

    +Y is toward the outside of the bottom wall. Rails extend -Y into the
    wall; a rectangular pocket on the -Y face accepts the switch paddle.
    """
    # y=0 is the outer wall face; +Y is outward. Use XY so Y is the in-plane
    # height — Workplane("XZ") extruded the thumb slab the wrong way.
    face = (cq.Workplane("XY")
            .box(P.TIP_FACE_X, P.TIP_PROUD, P.TIP_FACE_Z,
                 centered=(True, False, True)))
    body = (cq.Workplane("XY")
            .box(P.TIP_FACE_X - 0.4, P.WALL, P.TIP_FACE_Z - 0.4,
                 centered=(True, False, True))
            .translate((0, -P.WALL, 0)))
    pocket_w = 2.0 + P.TIP_POCKET_PLAY
    pocket_h = 1.2 + P.TIP_POCKET_PLAY
    pocket_d = 2.5
    pocket = (cq.Workplane("XY")
              .box(pocket_w, pocket_d, pocket_h, centered=(True, False, True))
              .translate((0, -P.WALL - 0.2, 0)))
    return face.union(body).cut(pocket)


def tip_cavity_at(x, y_sw):
    z_c = -(P.PCB_FRONT_Z - P.SLIDE_ACTUATOR_Z_ABOVE_PCB)
    y0 = P.BODY_H - P.WALL - 0.5
    return (cq.Workplane("XY")
            .box(P.TIP_SLOT_X, P.TIP_SLOT_Y, P.TIP_SLOT_Z,
                 centered=(True, False, True))
            .translate((x, y0, z_c)))


def edge_tip_openings():
    cuts = tip_cavity_at(P.POWER_SW_X, P.POWER_SW_Y)
    cuts = cuts.union(tip_cavity_at(P.MUTE_SW_X, P.MUTE_SW_Y))
    return cuts
