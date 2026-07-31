"""Single source of numeric truth for the Pocket Card enclosure.

Every dimension used by the CAD scripts lives here. The design spec at
docs/superpowers/specs/2026-07-31-pocket-card-mechanical-controls-design.md
records the *decisions*; this file records the *numbers*.

Provenance is marked on every value:
  DATASHEET  - ES3C28P & ES3N28P Specification V1.0 (LCDWIKI/QDtech, 2025-06-14)
  MEASURED   - extracted from DMG-01_Front_v54.stl (guighub/DMG-01-Shell, MIT)
               by 0.05 mm rasterisation, or measured off physical DMG parts
  ASSUMED    - engineering estimate, must be replaced before tooling
  DECIDED    - chosen in the design session

Coordinate convention for the assembled device, viewed from the front:
  x  0 .. BODY_W   left to right
  y  0 .. BODY_H   top to bottom
  z  0 at the front outer surface, increasing into the body
"""

# ---------------------------------------------------------------- body -----
BODY_W = 90.0          # DECIDED
BODY_H = 93.0          # DECIDED
WALL   = 1.5           # ASSUMED  shell wall thickness, sides and back
FACE_T = 1.5           # DECIDED  front face thickness in the button area

# ------------------------------------------------------------- module -----
MOD_W, MOD_H    = 86.0, 50.0    # DATASHEET  ES3C28P outline
MOD_DEPTH       = 10.60         # DATASHEET  total, touch surface to tallest rear part
MOD_FRONT_STACK = 5.85          # DATASHEET  touch surface to back of module PCB
MOD_REAR_PARTS  = 4.75          # DATASHEET  max rear component height
MOD_X           = (BODY_W - MOD_W) / 2      # 2.0, centred
MOD_Y           = 2.5           # ASSUMED  top margin

ACTIVE_W, ACTIVE_H = 57.60, 43.20          # DATASHEET  landscape
WINDOW_W, WINDOW_H = 58.05, 43.60          # DATASHEET  visible window (+/-0.15)

MOUNT_PITCH_X, MOUNT_PITCH_Y = 78.0, 42.0  # DATASHEET  hole grid, along 86 and 50
MOUNT_HOLE_D = 3.2                          # DATASHEET
MOUNT_INSET  = 4.0                          # DATASHEET  from each module edge

CONTROL_BAND_TOP = MOD_Y + MOD_H            # 52.5

# --------------------------------------------------- screen aperture ------
# The active area is NOT centred on the module. MEASURED off the §5.1 outline
# drawing at 12.23 px/mm: 17.28 mm from the USB-C end, 11.12 mm from the antenna
# end. Corroborated by the same scan returning the mounting holes at 4.01/81.99
# (datasheet 4.00 inset, 78.00 pitch) and the touch panel at 8.58-77.66 against
# a stated 69.20 span; and 11.12 appears verbatim in the drawing's text.
#
# Consequence: in a 90 mm body the screen sits 3.08 mm right of centre and
# cannot be centred without widening to ~95.2 mm. Accepted; the wide left bezel
# carries a wordmark so the asymmetry reads as composition, which is what the
# DMG did with its battery LED and lettering.
ACTIVE_OFF_USB = 17.28     # MEASURED  active area from the USB-C end
ACTIVE_OFF_ANT = 11.12     # MEASURED  active area from the antenna end
TP_L, TP_W     = 69.20, 50.00              # DATASHEET  touch panel, landscape
TP_BLACK_WIDE  = 8.51      # MEASURED  black print, wide side
TP_BLACK_TIGHT = 2.78      # MEASURED  black print, tight side -- the binding limit

# Visible black border inside the aperture, uniform on all four sides. Capped by
# TP_BLACK_TIGHT less module placement tolerance: at 2.0 a +/-0.3 drift still
# leaves 0.48 mm of print before bare PCB would show.
SCREEN_BORDER = 2.0        # DECIDED

ACTIVE_X = MOD_X + ACTIVE_OFF_USB                    # 19.28  (USB-C end is left)
ACTIVE_Y = MOD_Y + (MOD_H - ACTIVE_H) / 2            # 5.90   vertically centred
APERTURE_X = ACTIVE_X - SCREEN_BORDER                # 17.28
APERTURE_Y = ACTIVE_Y - SCREEN_BORDER                # 3.90
APERTURE_W = ACTIVE_W + 2 * SCREEN_BORDER            # 61.60
APERTURE_H = ACTIVE_H + 2 * SCREEN_BORDER            # 47.20
SCREEN_OFFSET = (APERTURE_X + APERTURE_W / 2) - BODY_W / 2   # +3.08, the residue

# The module sits behind the face, touch surface just clear of it. The July 12
# spec requires the bezel not to press on the touch/LCD stack.
MODULE_FRONT_GAP = 0.15    # ASSUMED
MODULE_Z         = FACE_T + MODULE_FRONT_GAP         # 1.65 touch surface depth

# ============================================================================
# BUTTON MECHANISM -- guided cap over an SMD tact switch
# ============================================================================
# Game Boy silicone membranes were evaluated and rejected: measured on physical
# DMG parts, the gasket heights are 4 mm (d-pad), 5 mm (A/B) and 9 mm
# (Start/Select), which forces the PCB 11.1 mm below the outer face and the body
# to ~19.9 mm. Tact switches bring that to 5.5 mm and ~14.3 mm.
#
# Consequence: we own the whole load path again -- return, guide, hard stop and
# retention -- which the membrane had been providing for free.

TACT_H       = 2.5     # DECIDED   SMD tact body height above the PCB
TACT_TRAVEL  = 0.25    # ASSUMED   actuation travel; confirm against the chosen part
TACT_FORCE_N = 1.6     # ASSUMED   target actuation force

# --- fit clearances, by manufacturing process -------------------------------
# Radial clearance for a free-sliding fit. These are genuinely different numbers
# per process and must not be conflated: an FDM prototype needs roughly double
# what an injection-moulded part does, so a shell that feels right printed will
# be sloppy moulded, and vice versa.
#
# All ASSUMED, and deliberately loose-ish: too tight is a scrapped print, too
# loose is a wobbly button you can still measure. Revise from a real print.
PROCESS = "jlc_resin"  # "fdm" | "resin" | "jlc_resin" | "mould"
_FIT = {
    "fdm":       0.20,  # 0.4 mm nozzle, allowing for elephant's foot and hole shrink
    "resin":     0.12,  # a good in-house SLA machine, +/-0.05 class
    "jlc_resin": 0.20,  # JLC3DP standard resin quotes about +/-0.2 mm. Biased
                        # generous deliberately: at 0.12 the tight end of that
                        # tolerance is interference and the caps simply will not
                        # go in, which is a scrapped order. A loose cap can still
                        # be measured and the number corrected.
    "mould":     0.08,  # tooling holds far better; the fit is the limit, not the tool
}
FIT_CLEAR = _FIT[PROCESS]

# Cap: head through the face, flange captured behind it, boss down to the plunger
CAP_PROUD      = 1.0        # DECIDED  head standing above the outer face
CAP_CLEAR      = FIT_CLEAR  # head-to-hole radial clearance
CAP_FLANGE_T   = 1.0        # ASSUMED  flange thickness
CAP_FLANGE_OS  = 1.1        # ASSUMED  flange radius beyond the head
COLLAR_CLEAR   = FIT_CLEAR  # flange-to-collar radial clearance
COLLAR_DEPTH   = 2.0        # ASSUMED  guide length below the inner face
HARD_STOP_AT   = 0.35  # DECIDED  flange lands here: past 0.25 actuation,
                       #          before the switch bottoms
CAP_BOSS_GAP   = 0.5   # ASSUMED  boss end to plunger at rest

# Anti-rotation for the non-round caps (pills). Two flats on the flange running
# in matching collar slots -- the DMG's own trick, measured off the reference:
# its A/B collars carry two opposed 24-degree slots starting 3.9 mm down.
ANTIROT_SLOT_DEG = 24.0   # MEASURED

# The PCB front face is set by the button stack, not chosen freely.
PCB_FRONT_Z = FACE_T + CAP_FLANGE_T + CAP_BOSS_GAP + TACT_H   # 5.5

# --------------------------------------------- cap sizes (DMG-derived) ----
# The DMG cap footprint is kept as the visual language even though the
# mechanism underneath is now ours. All MEASURED off the reference shell.
DIR_CAP_D    = 8.0     # DECIDED   direction buttons
AB_CAP_D     = 11.00   # MEASURED  Undo / Action, from the DMG A/B openings
PILL_L       = 11.15   # MEASURED  Reset / Menu
PILL_W       = 3.00    # MEASURED  cross-checked: horizontal chord 7.55 = W/sin(23.4)
PILL_ANGLE   = 23.4    # MEASURED
AB_PITCH     = 17.35   # DERIVED   from the placed positions (DMG was 16.34)
AB_ANGLE     = 15.7    # DERIVED   (DMG was 25.4)
PILL_PITCH   = 15.00   # MEASURED  Start to Select

# Confidence on the measured set: 11.00, 15.00 and 3.00 land exactly on round
# values and read as surviving design intent. 11.15, 16.34, 25.4 and 23.4 do
# not, so treat those as carrying the reference author's trace error.

# ============================================================================
# FACE LAYOUT
# ============================================================================
# X positions transfer 1:1 from the DMG because both bodies are 90 mm wide.
# Y is ours: the DMG spreads its controls over 83 mm and we have 40.

DIR_CX, DIR_CY = 19.70, 68.80  # DECIDED  positioned in the layout editor
DIR_RADIUS     = 9.0           # DECIDED   cap centres from cluster centre
DIR_SPAN       = 2 * DIR_RADIUS + DIR_CAP_D          # 26.0 overall
DIR_GAP        = (2 ** 0.5) * DIR_RADIUS - DIR_CAP_D # 4.73 between adjacent caps

UNDO_X,  UNDO_Y  = 60.40, 65.80    # was DMG "B", inboard
ACT_X,   ACT_Y   = 77.10, 61.10    # was DMG "A"
# Reset joins the right-hand cluster as a small round cap -- subordinate to
# Undo/Action by size, which is the hierarchy the July 12 spec asked for.
# Menu stays a slit: it is the most recessive control on the device.
RESET_X, RESET_Y = 56.50, 81.60
                                   # the driver retaining ring by 0.10 mm
RESET_CAP_D      = DIR_CAP_D       # 8.0, same as a direction button
MENU_X,  MENU_Y  = 39.60, 85.40    # was DMG "Start", still a pill
MENU_ANGLE       = 0.0             # DECIDED  straight, not slanted like the DMG

# Cap legends are not modelled yet: arrows on the four directions, and text or
# glyphs for Undo / Action / Reset / Menu. Recessed engraving on the crown, or
# pad print. Note the direction caps are already keyed with anti-rotation flats
# so an arrow stays upright.

# ------------------------------------------------- lower zone layout ------
# Battery pushed hard left so the bottom-right corner is free for the driver.
BATT_X, BATT_Y = 9.0, 55.0         # DECIDED  cell origin
                                   # 4.0 not 3.0: at 3.0 the retaining
                                   # fence fouled the front shell wall
BATT_CLEAR     = 0.6               # ASSUMED  fence clearance around the cell

# Controller PCB. Outline derived from the enclosure, not the other way round.
PCB_X, PCB_Y   = 8.0, 53.0
PCB_W, PCB_H   = 75.0, 37.0

# Edge switches, on the bottom rail of the controller PCB
POWER_SW_X = 20.0                  # DECIDED  bottom edge, far left
MUTE_SW_X  = 66.0                  # DECIDED  bottom edge, left of the driver notch
                                   # NB: no longer directly under the grille --
                                   # the driver notch takes that board area.

# Two extra screw bosses so the lower half is actually fastened. Without them
# the only fixings are the four that borrow the module's mounting holes, all in
# the upper 50 mm -- leaving the lid over a 5 mm cell held by its rim alone.
#
# The bottom-right corner is why the driver shrank from Ø14 to Ø12 and the
# grille moved inboard: its retaining ring has to clear the boss on one side and
# the Reset collar on the other, and there is only about 1.4 mm of slack between
# those two constraints.
EXTRA_BOSSES = ((4.5, 88.0), (86.0, 89.0))    # DECIDED  layout coords

# ---------------------------------------------------- lower zone stack ----
PCB_T          = 1.6     # ASSUMED  controller PCB
PET_T          = 0.2     # ASSUMED  battery insulator
CELL_T         = 5.0     # DECIDED  503450
CELL_W, CELL_H = 50.0, 34.0        # DECIDED
CELL_SWELL     = 0.5     # ASSUMED

LOWER_ZONE_T = PCB_FRONT_Z + PCB_T + PET_T + CELL_T + CELL_SWELL + WALL
UPPER_ZONE_T = MOD_DEPTH + 0.3 + WALL     # module sits flush in the front window
BODY_T       = max(LOWER_ZONE_T, UPPER_ZONE_T)

# Switch height is now a direct thickness lever: every millimetre of TACT_H is
# a millimetre of device. A 1.5 mm low-profile part would give ~13.3 mm, at some
# cost in tactile snap.

# ------------------------------------------------------------- audio ------
# The actual speaker, measured: rectangular, not the disc previously assumed.
DRIVER_W, DRIVER_H = 14.0, 20.0    # MEASURED
DRIVER_T = 3.5                     # MEASURED
GRILLE_X, GRILLE_Y = 76.0, 80.0    # DECIDED  centre, bottom right. At the old
                                   # (77.5, 81.2) a 14 x 20 driver overlapped
                                   # the corner boss; here the tightest
                                   # neighbour is the Undo collar at +0.6 mm.

# The grille is the PuzzleScript man, drawn as horizontal slats. Runs of 1 are
# cut; the gaps between rows are the webs that hold the face together. The
# bottom row is two separate runs, so this is six slots rather than five.
GRILLE_BITMAP = ("01110",
                 "01110",
                 "11111",
                 "01110",
                 "01010")
GRILLE_CELL   = 2.6    # DECIDED  square pixels; 5 cells = 13 mm across
GRILLE_SLOT_H = 1.6    # DECIDED  leaves a 1.0 mm web between rows

# Placeholder slot run, DMG-ish. Replace wholesale when the real pattern exists.
# Sized so the run stays clear of the bottom and right walls: at (78, 83) with
# 5 x 13.0 mm slots it breached the bottom wall by 0.65 mm.
GRILLE_SLOTS  = 4
GRILLE_PITCH  = 3.0
GRILLE_SLOT_L = 11.0
GRILLE_SLOT_W = 1.4
GRILLE_ANGLE  = 30.0

# ------------------------------------------------------------ switches ----
POWER_EDGE  = "bottom"             # DECIDED  left of the grille
MUTE_EDGE   = "bottom"             # DECIDED  beneath the grille
VOL_DELETED = True                 # DECIDED  replaced by the mute switch

# ------------------------------------------------------------- coupon -----
COUPON_MARGIN = 6.0
# The tolerance ladder is the whole point of the first print: CAP_CLEAR and
# COLLAR_CLEAR cannot be derived, only found.
COUPON_CLEARANCES = (0.10, 0.15, 0.20, 0.25, 0.30)   # FDM-appropriate steps


if __name__ == "__main__":
    print(f"face                {FACE_T:6.2f}")
    print(f"cap flange          {CAP_FLANGE_T:6.2f}")
    print(f"tact                {TACT_H:6.2f}")
    print(f"PCB front           {PCB_FRONT_Z:6.2f}")
    print(f"direction span      {DIR_SPAN:6.2f}   gap {DIR_GAP:.2f}")
    print(f"upper zone          {UPPER_ZONE_T:6.2f}")
    print(f"lower zone          {LOWER_ZONE_T:6.2f}")
    print(f"BODY                {BODY_T:6.2f}")
