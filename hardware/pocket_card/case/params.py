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

# Cap: head through the face, flange captured behind it, boss down to the plunger
CAP_PROUD      = 1.0   # DECIDED  head standing above the outer face
CAP_CLEAR      = 0.10  # ASSUMED  head-to-hole radial clearance; TOLERANCE LADDER
CAP_FLANGE_T   = 1.0   # ASSUMED  flange thickness
CAP_FLANGE_OS  = 1.1   # ASSUMED  flange radius beyond the head
COLLAR_CLEAR   = 0.10  # ASSUMED  flange-to-collar radial clearance; TOLERANCE LADDER
COLLAR_DEPTH   = 2.0   # ASSUMED  guide length below the inner face
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
AB_PITCH     = 16.34   # MEASURED  A to B, centre to centre
AB_ANGLE     = 25.4    # MEASURED
PILL_PITCH   = 15.00   # MEASURED  Start to Select

# Confidence on the measured set: 11.00, 15.00 and 3.00 land exactly on round
# values and read as surviving design intent. 11.15, 16.34, 25.4 and 23.4 do
# not, so treat those as carrying the reference author's trace error.

# ============================================================================
# FACE LAYOUT
# ============================================================================
# X positions transfer 1:1 from the DMG because both bodies are 90 mm wide.
# Y is ours: the DMG spreads its controls over 83 mm and we have 40.

DIR_CX, DIR_CY = 18.22, 67.5   # MEASURED x / DECIDED y   cluster centre
DIR_RADIUS     = 9.0           # DECIDED   cap centres from cluster centre
DIR_SPAN       = 2 * DIR_RADIUS + DIR_CAP_D          # 26.0 overall
DIR_GAP        = (2 ** 0.5) * DIR_RADIUS - DIR_CAP_D # 4.73 between adjacent caps

UNDO_X,  UNDO_Y  = 63.22, 71.0     # was DMG "B", inboard
ACT_X,   ACT_Y   = 77.98, 63.99    # was DMG "A", holds true 25.4 deg to Undo
RESET_X, RESET_Y = 33.23, 86.0     # was DMG "Select"
MENU_X,  MENU_Y  = 48.23, 86.0     # was DMG "Start"

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
DRIVER_D = 18.0        # ASSUMED  final size set by the bottom-right corner
DRIVER_T = 4.0         # ASSUMED
GRILLE_X, GRILLE_Y = 78.0, 83.0    # DECIDED  centre, bottom right

# ------------------------------------------------------------ switches ----
POWER_EDGE  = "bottom"             # DECIDED  left of the grille
MUTE_EDGE   = "bottom"             # DECIDED  beneath the grille
VOL_DELETED = True                 # DECIDED  replaced by the mute switch

# ------------------------------------------------------------- coupon -----
COUPON_MARGIN = 6.0
# The tolerance ladder is the whole point of the first print: CAP_CLEAR and
# COLLAR_CLEAR cannot be derived, only found.
COUPON_CLEARANCES = (0.05, 0.10, 0.15, 0.20, 0.25)


if __name__ == "__main__":
    print(f"face                {FACE_T:6.2f}")
    print(f"cap flange          {CAP_FLANGE_T:6.2f}")
    print(f"tact                {TACT_H:6.2f}")
    print(f"PCB front           {PCB_FRONT_Z:6.2f}")
    print(f"direction span      {DIR_SPAN:6.2f}   gap {DIR_GAP:.2f}")
    print(f"upper zone          {UPPER_ZONE_T:6.2f}")
    print(f"lower zone          {LOWER_ZONE_T:6.2f}")
    print(f"BODY                {BODY_T:6.2f}")
