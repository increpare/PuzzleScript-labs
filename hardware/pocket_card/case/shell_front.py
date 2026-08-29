"""Front shell.

A deep tray: face, perimeter walls, screen aperture, eight guided button
stations, four posts through the module's own mounting holes, and the tip
openings. The back shell is a deeper tray (LID_T) with a shaped perimeter lip;
USB-C lives in the back. Split is planar at z = -(BODY_T - LID_T).

Coordinates: device coordinates from params.py, with z flipped for modelling.
  x  0 .. BODY_W   left to right, viewed from the front
  y  0 .. BODY_H   top to bottom
  z  0 at the outer face, NEGATIVE into the body

Run:  .venv/bin/python shell_front.py
"""
import math
import os

import cadquery as cq

import nut_traps
import params as P
import side_arc
import slide_tip

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

CORNER_R = 4.5
SHELL_DEPTH = P.BODY_T - P.LID_T       # front ends where the back tray begins
COLLAR_WALL = 1.2
FLAT_DEPTH = 0.8
POST_D = 3.0                           # through the module's Ø3.2 holes
SHOULDER_D = 5.5                       # module rests its PCB on this
BOSS_D = 4.2                           # corner bosses, nothing to thread through
DRIVER_POCKET_WALL = 1.2
DRIVER_POCKET_CLEAR = 0.6
SPEAKER_WIRE_SERVICE = 0.4             # local bend pocket beyond locator wall
SPEAKER_WIRE_RELIEF_CLEAR = 0.05       # boolean/process clearance around route
# Bosses start this far INSIDE the face rather than on it. Landing a column
# exactly on the cavity roof is a coincident-plane union, which OCC leaves
# unfused: build() came out as seven solids, six of them loose pillars.
FACE_FUSE = 0.3

# module PCB planes, derived
MOD_PCB_BACK = P.MODULE_Z + P.MOD_FRONT_STACK        # 7.50
MOD_PCB_FRONT = MOD_PCB_BACK - 1.6                   # 5.90


def _dev(shape, x, y):
    """Place a shape built at the origin into device coordinates."""
    return shape.translate((x, y, 0))


def outer_body():
    """Shaped brick band (side arcs) for the front shell Z range."""
    # Carve the solid envelope first; hollowing is cavity() — never cut arcs
    # out of an already-hollow wall (that punches side holes).
    # Edge chamfer is applied inside shaped_brick before the arcs.
    return side_arc.shaped_outer_band(-SHELL_DEPTH, 0.0, CORNER_R)


def cavity():
    """Interior void: XY follows the side-arc offset; open at the back."""
    # Roof under the face at -FACE_T; slightly past -SHELL_DEPTH so the back
    # stays open. Arc cutters use R−WALL so side walls keep thickness.
    return side_arc.shaped_cavity_xy(
        P.WALL, -SHELL_DEPTH - 0.5, -P.FACE_T, CORNER_R).union(split_rebate())


def split_rebate():
    """The front's half of the lap: thin the wall to its outer LAP_FRONT_T
    over the engagement band, so the tray's tongue slides up inside it.

    Runs LAP_OVER past the tongue's top, so closing lands the skirt's bottom
    face on the tray's shoulder — the joint the user sees — rather than
    stopping early on the tongue's top face.

    Straight-sided at the split section: the skirt's outer face still follows
    the roll and thickens as it climbs, but the face that has to slide over
    the tongue must have no draft or the shells jam LAP_CLEAR short of shut.
    """
    return side_arc.section_prism(
        P.LAP_FRONT_T, -SHELL_DEPTH,
        -SHELL_DEPTH - 0.5, -SHELL_DEPTH + P.LAP_H + P.LAP_OVER)


def screen_aperture():
    return (cq.Workplane("XY")
            .box(P.APERTURE_W, P.APERTURE_H, P.FACE_T + 2, centered=(False, False, False))
            .translate((P.APERTURE_X, P.APERTURE_Y, -P.FACE_T - 1))
            .edges("|Z").fillet(0.8))


def _chamfer_aperture_lip(shell):
    """45°-ish bevel on the screen opening at the outer face (FOV).

    Applied after the aperture cut and before button holes so the selector only
    sees the screen rim, not collar bores. Box is padded just outside the
    aperture; APERTURE_Y ≈ 3.9 keeps it clear of the outer top edge.
    """
    ch = P.APERTURE_CHAMFER
    if ch <= 0:
        return shell
    pad = 0.4
    x0 = P.APERTURE_X - pad
    y0 = P.APERTURE_Y - pad
    x1 = P.APERTURE_X + P.APERTURE_W + pad
    y1 = P.APERTURE_Y + P.APERTURE_H + pad
    try:
        return (shell.edges(cq.selectors.BoxSelector((x0, y0, -0.5), (x1, y1, 0.5)))
                .chamfer(ch))
    except Exception:
        try:
            # Filleted aperture rims sometimes refuse a chamfer; fillet is close.
            return (shell.edges(cq.selectors.BoxSelector((x0, y0, -0.5), (x1, y1, 0.5)))
                    .fillet(ch))
        except Exception:
            # Side-arc envelope can leave a rim OCC won't blend — leave sharp.
            return shell

def _shoulder_planes():
    z_flat_top = -(P.FACE_T + P.CAP_FLANGE_T + P.HARD_STOP_AT)
    z_flat_bot = z_flat_top - P.SHOULDER_FLAT_T
    z_ramp_bot = z_flat_bot - P.SHOULDER_RAMP_T
    return z_flat_top, z_flat_bot, z_ramp_bot


def _shoulder_void_round(bore_d, depth):
    """Void to cut from the collar: guide, narrow lip pass, ramp, full bore below.

    Returns the cutter solid (union of void segments). Do NOT carve a full
    cylinder then hollow it — that inverted the lip and left the centre solid.
    """
    z_flat_top, z_flat_bot, z_ramp_bot = _shoulder_planes()
    r = bore_d / 2
    sr = (bore_d - 2 * P.SHOULDER_RADIAL) / 2

    guide = cq.Workplane("XY").circle(r).extrude(z_flat_top)
    lip = (cq.Workplane("XY").workplane(offset=z_flat_top)
           .circle(sr).extrude(z_flat_bot - z_flat_top))
    try:
        ramp = (cq.Workplane("XY").workplane(offset=z_flat_bot).circle(sr)
                .workplane(offset=z_ramp_bot - z_flat_bot).circle(r).loft(combine=True))
    except Exception:
        ramp = (cq.Workplane("XY").workplane(offset=z_flat_bot).circle(r)
                .extrude(z_ramp_bot - z_flat_bot))
    below = (cq.Workplane("XY").workplane(offset=z_ramp_bot).circle(r)
             .extrude(-(depth + 1) - z_ramp_bot))
    return guide.union(lip).union(ramp).union(below)


def _shoulder_void_slot(bore_l, bore_w, depth):
    """Pill-station void with snap-over shoulder (same construction as round)."""
    z_flat_top, z_flat_bot, z_ramp_bot = _shoulder_planes()
    shoulder_l = bore_l - 2 * P.SHOULDER_RADIAL
    shoulder_w = bore_w - 2 * P.SHOULDER_RADIAL

    guide = cq.Workplane("XY").slot2D(bore_l, bore_w, 0).extrude(z_flat_top)
    lip = (cq.Workplane("XY").workplane(offset=z_flat_top)
           .slot2D(shoulder_l, shoulder_w, 0).extrude(z_flat_bot - z_flat_top))
    try:
        ramp = (cq.Workplane("XY").workplane(offset=z_flat_bot)
                .slot2D(shoulder_l, shoulder_w, 0)
                .workplane(offset=z_ramp_bot - z_flat_bot)
                .slot2D(bore_l, bore_w, 0).loft(combine=True))
    except Exception:
        ramp = (cq.Workplane("XY").workplane(offset=z_flat_bot)
                .slot2D(bore_l, bore_w, 0).extrude(z_ramp_bot - z_flat_bot))
    below = (cq.Workplane("XY").workplane(offset=z_ramp_bot)
             .slot2D(bore_l, bore_w, 0).extrude(-(depth + 1) - z_ramp_bot))
    return guide.union(lip).union(ramp).union(below)


def button_station(hole_d=None, pill=False, keyed=True):
    """Face hole plus guide collar. Returns (solid_to_add, solid_to_cut)."""
    depth = P.FACE_T + P.COLLAR_DEPTH
    if pill:
        flange_l = P.PILL_L + 2 * P.CAP_FLANGE_OS
        flange_w = P.PILL_W + 2 * P.CAP_FLANGE_OS
        bore_l = flange_l + 2 * P.COLLAR_CLEAR + P.PILL_BORE_EXTRA
        bore_w = flange_w + 2 * P.COLLAR_CLEAR + P.PILL_BORE_EXTRA
        boss = (cq.Workplane("XY")
                .slot2D(bore_l + 2 * COLLAR_WALL, bore_w + 2 * COLLAR_WALL, 0)
                .extrude(-depth))
        bore = _shoulder_void_slot(bore_l, bore_w, depth)
        hole = (cq.Workplane("XY")
                .slot2D(P.PILL_L + 2 * P.CAP_CLEAR, P.PILL_W + 2 * P.CAP_CLEAR, 0)
                .extrude(-P.FACE_T - 2).translate((0, 0, 1)))
        return boss.cut(bore), hole

    flange_d = hole_d + 2 * P.CAP_FLANGE_OS
    bore_d = flange_d + 2 * P.COLLAR_CLEAR
    boss = cq.Workplane("XY").circle(bore_d / 2 + COLLAR_WALL).extrude(-depth)
    bore = _shoulder_void_round(bore_d, depth)
    if keyed:
        across = bore_d / 2 - FLAT_DEPTH
        for sign in (1, -1):
            bore = bore.cut(
                cq.Workplane("XY").box(4 * bore_d, 4 * bore_d, 100)
                .translate((0, sign * (across + 2 * bore_d), 0)))
    hole = (cq.Workplane("XY").circle(hole_d / 2 + P.CAP_CLEAR)
            .extrude(-P.FACE_T - 2).translate((0, 0, 1)))
    return boss.cut(bore), hole


def module_posts():
    """Four locating sleeves plus any independent corner bosses.

    Four pass through the module's own Ø3.2 holes, so one feature locates the
    module, retains it and closes the case. Their Ø2.4 machine-screw bore runs
    through the complete sleeve while the captive-nut void supplies the blind
    tip relief behind the outer face. Independent corner bosses, when present,
    are unthreaded lands rather than legacy self-tapper pilots.
    """
    add = cq.Workplane("XY")
    cut = cq.Workplane("XY")

    # Module sites: a Ø5.5 shoulder from the face down to the board's front
    # plane, then Ø3.0 through the module's own Ø3.2 hole. The shoulder is what
    # sets the module axially -- without it the board would come to rest against
    # the bezel, which must never touch the touch/LCD stack.
    for site in nut_traps.sites()[:4]:
        add = add.union(
            cq.Workplane("XY").circle(SHOULDER_D / 2)
            .extrude(-(MOD_PCB_FRONT - P.FACE_T + FACE_FUSE))
            .translate((site.x, site.y, -P.FACE_T + FACE_FUSE)))
        add = add.union(
            cq.Workplane("XY").circle(POST_D / 2)
            .extrude(-(SHELL_DEPTH - MOD_PCB_FRONT))
            .translate((site.x, site.y, -MOD_PCB_FRONT)))
        cut = cut.union(
            nut_traps.screw_path(site, -SHELL_DEPTH - 0.1))

    # Corner bosses that do NOT coincide with a PCB mount can be fat (they
    # pass through nothing). Sites that are also PCB_MOUNTS are now wholly
    # supplied by their captive-nut cages — a Ø4.2 column cannot go through
    # the controller board's Ø2.6 hole.
    pcb_mounts = set(P.PCB_MOUNTS)
    for x, y in P.EXTRA_BOSSES:
        if (x, y) in pcb_mounts:
            continue
        add = add.union(
            cq.Workplane("XY").circle(BOSS_D / 2)
            .extrude(-(SHELL_DEPTH - P.FACE_T + FACE_FUSE))
            .translate((x, y, -P.FACE_T + FACE_FUSE)))
    return add, cut


def _speaker_lead_notch(sign):
    """Return the existing rear lead-notch cutter for one driver end."""
    if sign not in (-1, 1):
        raise ValueError("speaker lead notch sign must be -1 or 1")
    driver_h = P.DRIVER_H + DRIVER_POCKET_CLEAR
    driver_back_z = -P.FACE_T - P.DRIVER_T
    return (
        cq.Workplane("XY")
        .box(
            P.DRIVER_CABLE_W,
            2.0 * (DRIVER_POCKET_WALL + SPEAKER_WIRE_SERVICE),
            P.DRIVER_CABLE_CLR + SPEAKER_WIRE_SERVICE,
            centered=(True, True, False),
        )
        .translate((
            P.GRILLE_X,
            P.GRILLE_Y + sign * driver_h / 2.0,
            driver_back_z - SPEAKER_WIRE_SERVICE,
        ))
    )


def _south_speaker_wire_route_specs():
    """Box specs for the exit, strain-relief drop, and interior return."""
    driver_back_z = -P.FACE_T - P.DRIVER_T
    driver_end_y = P.GRILLE_Y + P.DRIVER_H / 2.0
    locator_crossing = (
        (P.DRIVER_H + DRIVER_POCKET_CLEAR
         + 2.0 * DRIVER_POCKET_WALL) / 2.0
        - P.DRIVER_H / 2.0
    )
    lead_length = locator_crossing + SPEAKER_WIRE_SERVICE
    drop_length = 2.0 * SPEAKER_WIRE_SERVICE
    # Keep the deeper bend wholly inboard of the perimeter wall; only the
    # shallow exit leg needs the intentional perimeter service pocket.
    drop_outer_y = (
        driver_end_y + locator_crossing - SPEAKER_WIRE_SERVICE / 4.0
    )
    drop_center_y = drop_outer_y - drop_length / 2.0
    return_length = P.DRIVER_CABLE_CLR + 2.0 * SPEAKER_WIRE_SERVICE
    return_center_y = drop_center_y - return_length / 2.0
    return (
        (P.DRIVER_CABLE_W, lead_length, P.DRIVER_CABLE_CLR,
         P.GRILLE_X, driver_end_y + lead_length / 2.0, driver_back_z),
        (P.DRIVER_CABLE_W, drop_length, 2.0 * P.DRIVER_CABLE_CLR,
         P.GRILLE_X, drop_center_y,
         driver_back_z - P.DRIVER_CABLE_CLR),
        (P.DRIVER_CABLE_W, return_length, P.DRIVER_CABLE_CLR,
         P.GRILLE_X, return_center_y,
         driver_back_z - P.DRIVER_CABLE_CLR),
    )


def _speaker_wire_route_box(spec, clear=0.0):
    width, length, height, x, y, z = spec
    return (
        cq.Workplane("XY")
        .box(width + 2.0 * clear, length + 2.0 * clear,
             height + 2.0 * clear, centered=(True, True, False))
        .translate((x, y, z - clear))
    )


def speaker_wire_envelopes():
    """Return the north candidate and approved south local lead envelopes.

    Both start at the measured driver body and cross the complete locator-wall
    thickness near the driver's rear.  North retains the original analytical
    candidate through its notch, but is explicitly unapproved because it runs
    into the Action collar.  The symmetric driver is installed rotated 180
    degrees so its tabs face south; that route continues into a small internal
    bend/service pocket relieved in the perimeter wall.  Neither envelope
    claims to model the remote harness route.
    """
    driver_back_z = -P.FACE_T - P.DRIVER_T
    locator_outer_half_h = (
        P.DRIVER_H + DRIVER_POCKET_CLEAR
        + 2.0 * DRIVER_POCKET_WALL
    ) / 2.0
    locator_crossing = locator_outer_half_h - P.DRIVER_H / 2.0
    pcb_front_z = -P.PCB_FRONT_Z
    z_back = min(driver_back_z, pcb_front_z)
    z_front = max(driver_back_z + P.DRIVER_CABLE_CLR, pcb_front_z)
    north_length = locator_crossing + 1.0
    north = (cq.Workplane("XY")
             .box(P.DRIVER_CABLE_W, north_length, z_front - z_back,
                  centered=(True, True, False))
             .translate((
                 P.GRILLE_X,
                 P.GRILLE_Y - (P.DRIVER_H / 2.0 + north_length / 2.0),
                 z_back,
             )))

    # Give the installed leads a truthful local path: after crossing the south
    # locator wall they turn behind the driver, then return north underneath
    # its measured rear plane into the open PCB notch.  This is only the
    # strain-relief bend, not a connector route.
    south = cq.Workplane("XY")
    for spec in _south_speaker_wire_route_specs():
        south = south.union(_speaker_wire_route_box(spec))
    return north, south


def speaker_wire_service_relief():
    """Exact production cutter for the approved south local service route.

    A 0.05 mm boolean/process margin prevents coincident faces.  The route
    crosses the south locator wall and opens a 0.4 mm bend pocket into the
    internal face of the bottom perimeter.  That shallow perimeter cut stops
    behind a 1.0+ mm exterior skin and above the split-lap engagement band;
    the deeper return leg remains wholly in the ordinary interior void.
    """
    if P.DRIVER_LEAD_EXIT != "south":
        raise ValueError("front-shell speaker relief is authored for south exit")
    clear = SPEAKER_WIRE_RELIEF_CLEAR
    # Offset the three orthogonal legs separately rather than expanding the
    # route's overall bounding box: a bounding box would needlessly cut the
    # split skirt beneath the perimeter bend.
    relief = cq.Workplane("XY")
    for spec in _south_speaker_wire_route_specs():
        relief = relief.union(_speaker_wire_route_box(spec, clear))
    return relief


def driver_pocket():
    """Locating walls and lead notches for the driver, flush behind the face.

    The driver bonds to the inside of the front face with its own adhesive, so
    it sits flush at z 1.5-5.0 and the bond carries it. There is deliberately no
    lip or shelf: anything under the rim would hold the driver off the very
    surface it needs to stick to, and break the seal to the grille chamber.

    Since the board front moved to 4.5 (low-profile switch), the driver's back
    (5.0) dips 0.5 through the board plane — the board outline is notched
    around it (PCB_DRIVER_NOTCH_*). The walls, however, stop just above the
    board plane: the west wall crosses the notch edge onto board material, and
    2.8 mm of engagement squares the driver up fine while the adhesive sets.

    These walls only square the driver up, which is why they can be freely
    interrupted for the collars and the lead notches.
    """
    wall = DRIVER_POCKET_WALL
    w = P.DRIVER_W + DRIVER_POCKET_CLEAR
    h = P.DRIVER_H + DRIVER_POCKET_CLEAR
    z_face = -P.FACE_T                      # driver's front, on the face
    z_back = z_face - P.DRIVER_T            # driver's back
    z_stop = -(P.PCB_FRONT_Z - 0.2)         # walls end above the board front
    # Stadium, not a box: the part has semicircular ends. A rectangular pocket
    # would locate it on four corners it does not have.
    outer = (cq.Workplane("XY")
             .slot2D(h + 2 * wall, w + 2 * wall, 90)
             .extrude(z_stop)
             .translate((P.GRILLE_X, P.GRILLE_Y, 0))
             .cut(cq.Workplane("XY").box(200, 200, 200)
                  .translate((0, 0, 100 + z_face))))
    bore = (cq.Workplane("XY").slot2D(h, w, 90)
            .extrude(z_back - 1).translate((P.GRILLE_X, P.GRILLE_Y, z_face + 0.5)))
    walls = outer.cut(bore)

    # Lead notches through BOTH end walls. North is -y in layout space, which
    # to_model_space() turns into the top of the finished part. The symmetric
    # driver is installed with its physical tabs facing the approved south
    # exit. North remains an unapproved analytical candidate because it passes
    # under the Action collar, where a moving cap could pinch or chafe a lead.
    # The unused notch costs nothing: these walls only locate the driver and
    # are already discontinuous where collars relieve them.
    for sign in (-1, 1):
        walls = walls.cut(_speaker_lead_notch(sign))

    # Relieve the wall wherever a button collar encroaches. Action's collar
    # reaches y=69.1 and the pocket wall starts at 68.5, so a full box would
    # foul it. The wall only has to locate the driver, so it need not be
    # continuous -- the same trick the back-shell ring used for the bosses.
    for cx, cy, d in ((P.ACT_X, P.ACT_Y, P.AB_CAP_D),
                      (P.UNDO_X, P.UNDO_Y, P.AB_CAP_D),
                      (P.RESET_X, P.RESET_Y, P.RESET_CAP_D)):
        r = d / 2 + P.CAP_FLANGE_OS + P.COLLAR_CLEAR + COLLAR_WALL
        walls = walls.cut(
            cq.Workplane("XY").circle(r).extrude(-(P.FACE_T + P.DRIVER_T + 2))
            .translate((cx, cy, 0)))
    return walls


def edge_openings():
    """Power and mute tip slots on the bottom edge (USB-C is in the back tray)."""
    return slide_tip.edge_tip_openings()


def grille_slots():
    """The PuzzleScript man as horizontal slats.

    Each run of 1s in GRILLE_BITMAP becomes one slot. The bottom row is two
    separate runs, so the five-row figure is cut as six slots.
    """
    cell = P.GRILLE_CELL
    rows = P.GRILLE_BITMAP
    n = len(rows)
    cuts = cq.Workplane("XY")
    for r, row in enumerate(rows):
        c = 0
        while c < len(row):
            if row[c] != "1":
                c += 1
                continue
            c0 = c
            while c < len(row) and row[c] == "1":
                c += 1
            c1 = c - 1
            length = (c1 - c0 + 1) * cell - 2 * P.GRILLE_RUN_INSET
            dx = ((c0 + c1) / 2.0 - (len(row) - 1) / 2.0) * cell
            dy = (r - (n - 1) / 2.0) * cell
            cuts = cuts.union(
                cq.Workplane("XY").slot2D(length, P.GRILLE_SLOT_H, 0)
                .extrude(-P.FACE_T - 2).translate((0, 0, 1))
                .translate((P.GRILLE_X + dx, P.GRILLE_Y + dy, 0)))
    return cuts


def to_model_space(shape):
    """Layout space (y down from the top) -> model space (y up).

    params.py places controls the way you read a face: y = 0 at the top,
    increasing downward. 3D space viewed from the front has +y UP, so the two
    differ by a reflection. Without this the exported part comes out vertically
    flipped, and rotating it upright mirrors left for right -- which is exactly
    what happened, and my renderer was "corrected" to hide it rather than the
    model being fixed.
    """
    return shape.mirror("XZ").translate((0, P.BODY_H, 0))


def build(*, apply_speaker_wire_relief=True):
    shell = outer_body().cut(cavity())
    shell = shell.cut(screen_aperture())
    shell = _chamfer_aperture_lip(shell)

    stations = [
        (P.DIR_CX, P.DIR_CY - P.DIR_RADIUS, P.DIR_CAP_D, False),   # up
        (P.DIR_CX, P.DIR_CY + P.DIR_RADIUS, P.DIR_CAP_D, False),   # down
        (P.DIR_CX - P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),   # left
        (P.DIR_CX + P.DIR_RADIUS, P.DIR_CY, P.DIR_CAP_D, False),   # right
        (P.UNDO_X, P.UNDO_Y, P.AB_CAP_D, False),
        (P.ACT_X, P.ACT_Y, P.AB_CAP_D, False),
        (P.RESET_X, P.RESET_Y, P.RESET_CAP_D, False),
        (P.MENU_X, P.MENU_Y, None, True),
    ]
    for x, y, d, pill in stations:
        boss, hole = button_station(hole_d=d, pill=pill)
        if pill:
            boss = boss.rotate((0, 0, 0), (0, 0, 1), -P.MENU_ANGLE)
            hole = hole.rotate((0, 0, 0), (0, 0, 1), -P.MENU_ANGLE)
        shell = shell.union(_dev(boss, x, y)).cut(_dev(hole, x, y))

    add, cut = module_posts()
    shell = shell.union(add).cut(cut)
    shell = shell.union(driver_pocket())

    # Fuse every fixed cage before cutting any cavity. This preserves overlap
    # for robust booleans at the module sleeves and button-collar neighbours.
    for site in nut_traps.sites():
        shell = shell.union(nut_traps.front_material(site))
    for site in nut_traps.sites():
        shell = shell.cut(nut_traps.front_voids(site))
    # Module nuts slide directly in from the open interior. Controller nuts
    # instead drop into rigid open-top staging chutes, then slide under the
    # cage roof. The installed PCB caps those chutes without carrying clamp
    # load. Cut all loading motion first, then add the fixed rails/end walls so
    # the path stays open but cannot be reversed after board installation.
    for site in nut_traps.sites():
        loading = (
            nut_traps.insertion_sweep(site)
            if site.kind == "module"
            else nut_traps.controller_loading_voids(site)
        )
        shell = shell.cut(loading)
    for site in nut_traps.sites():
        if site.kind == "pcb":
            shell = shell.union(nut_traps.controller_chute_material(site))

    # All fixed internal material is present before opening the approved local
    # speaker-lead route, so no later collar/cage union can refill it.  Envelope
    # clipping remains last and preserves the compound-rounded exterior.
    if apply_speaker_wire_relief:
        shell = shell.cut(speaker_wire_service_relief())

    shell = shell.cut(edge_openings())
    shell = shell.cut(grille_slots())
    # Keep posts/collars from ever sitting outside the curved envelope.
    shell = side_arc.clip_to_envelope(shell)
    return to_model_space(shell)


if __name__ == "__main__":
    s = build()
    order = os.path.join(OUT, "order")
    os.makedirs(order, exist_ok=True)
    for folder in (OUT, order):
        cq.exporters.export(s, os.path.join(folder, "shell_front.stl"))
        cq.exporters.export(s, os.path.join(folder, "shell_front.step"))
    bb = s.val().BoundingBox()
    print(f"shell_front  {bb.xlen:.2f} x {bb.ylen:.2f} x {bb.zlen:.2f}")
    print(f"  wrote out/shell_front.stl and out/order/shell_front.stl")
    print(f"  aperture   {P.APERTURE_W:.2f} x {P.APERTURE_H:.2f} at "
          f"({P.APERTURE_X:.2f}, {P.APERTURE_Y:.2f})")
    print(f"  screen off-centre by {P.SCREEN_OFFSET:+.2f} mm (accepted)")
    print(f"  module touch surface at z = -{P.MODULE_Z:.2f}, PCB back at "
          f"-{MOD_PCB_BACK:.2f}")
