"""Single source of numeric truth for the Pocket Card enclosure.

Every dimension used by the CAD scripts lives here. The design spec at
docs/superpowers/specs/2026-07-31-pocket-card-mechanical-controls-design.md
records the *decisions*; this file records the *numbers*.

Provenance is marked on every value:
  DATASHEET  - ES3C28P & ES3N28P Specification V1.0 (LCDWIKI/QDtech, 2025-06-14)
  MEASURED   - extracted from DMG-01_Front_v54.stl (guighub/DMG-01-Shell, MIT)
               by 0.05 mm rasterisation; carries that model's own trace error
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
WALL   = 1.5           # ASSUMED  shell wall thickness

# ------------------------------------------------------------- module -----
MOD_W, MOD_H   = 86.0, 50.0     # DATASHEET  ES3C28P outline
MOD_DEPTH      = 10.60          # DATASHEET  total, touch surface to tallest rear part
MOD_FRONT_STACK = 5.85          # DATASHEET  touch surface to back of module PCB
MOD_REAR_PARTS  = 4.75          # DATASHEET  max rear component height
MOD_X          = (BODY_W - MOD_W) / 2      # 2.0, centred
MOD_Y          = 2.5            # ASSUMED  top margin

ACTIVE_W, ACTIVE_H = 57.60, 43.20          # DATASHEET  landscape
WINDOW_W, WINDOW_H = 58.05, 43.60          # DATASHEET  visible window (+/-0.15)

MOUNT_PITCH_X, MOUNT_PITCH_Y = 78.0, 42.0  # DATASHEET  hole grid, along 86 and 50
MOUNT_HOLE_D = 3.2                          # DATASHEET
MOUNT_INSET  = 4.0                          # DATASHEET  from each module edge

# ---------------------------------------------- DMG button geometry -------
# All MEASURED. These are shell OPENINGS, not cap sizes: caps are smaller by
# the original's clearance, with the flange behind.

FACE_T = 2.30          # MEASURED  DMG front face wall in the button area

# Every membrane retention feature on the DMG -- d-pad ring, A/B collars and
# the Start/Select ribs -- terminates on ONE common plane 6.25 mm below the
# outer face. That plane is where the PCB sits; the ribs are the standoffs
# that set membrane compression. This is the single most important number here.
RIB_PLANE_Z = 6.25     # MEASURED  from outer face
RIB_PROUD   = RIB_PLANE_Z - FACE_T   # 3.95, height above the inner face

DPAD_SPAN     = 22.00  # MEASURED  tip to tip
DPAD_ARM_W    = 7.75   # MEASURED  through the arm; fillets to ~7.6 at the tips
DPAD_RING_ID  = 27.6   # MEASURED  membrane locating ring, inner diameter
DPAD_RING_OD  = 30.0   # MEASURED

AB_HOLE_D     = 11.00  # MEASURED  fill ratio 0.785 = pi/4, so a true circle
AB_COLLAR_OD  = 13.4   # MEASURED  1.2 mm wall around the bore
AB_PITCH      = 16.34  # MEASURED  A to B, centre to centre
AB_ANGLE      = 25.4   # MEASURED  degrees

PILL_L        = 11.15  # MEASURED
PILL_W        = 3.00   # MEASURED  cross-checked: horizontal chord 7.55 = W/sin(23.4)
PILL_ANGLE    = 23.4   # MEASURED  degrees
PILL_PITCH    = 15.00  # MEASURED  Start to Select
PILL_RIB_OFFSET = 1.64 # MEASURED  racetrack rib, outboard of the opening edge
PILL_RIB_W    = 1.05   # MEASURED

# Confidence: 22.00, 11.00, 15.00 and 3.00 land exactly on round values and
# read as surviving design intent. 7.75, 11.15, 16.34, 25.4 and 23.4 do not,
# so treat those as carrying the reference author's trace error.

# -------------------------------------------- face layout (our device) ----
# X transfers 1:1 from the DMG because both bodies are 90 mm wide. Y is ours:
# the DMG spreads its controls over 83 mm and we have 40, so the gap between
# clusters is compressed from 21.63 to 20.0. Nothing within a cluster changes.

DPAD_X,  DPAD_Y  = 18.22, 66.0     # MEASURED x / DECIDED y
UNDO_X,  UNDO_Y  = 63.22, 71.0     # B cap
ACT_X,   ACT_Y   = 77.98, 63.99    # A cap, holds true 25.4 deg to Undo
RESET_X, RESET_Y = 33.23, 86.0     # Select pill
MENU_X,  MENU_Y  = 48.23, 86.0     # Start pill

CONTROL_BAND_TOP = MOD_Y + MOD_H   # 52.5

# --------------------------------------------------- lower zone stack -----
PCB_T        = 1.6     # ASSUMED  controller PCB
PET_T        = 0.2     # ASSUMED  battery insulator
CELL_T       = 5.0     # DECIDED  503450
CELL_W, CELL_H = 50.0, 34.0        # DECIDED
CELL_SWELL   = 0.5     # ASSUMED

# The PCB front face is NOT a free variable: it is pinned to the rib plane,
# because the ribs are what the board rests on.
PCB_FRONT_Z  = RIB_PLANE_Z         # 6.25 with a DMG-thickness face

# ------------------------------------------------------------- audio ------
DRIVER_D     = 18.0    # ASSUMED  final size set by the bottom-right corner
DRIVER_T     = 4.0     # ASSUMED
GRILLE_X, GRILLE_Y = 78.0, 83.0    # DECIDED  centre, bottom right

# ------------------------------------------------------------ switches ----
POWER_EDGE   = "bottom"            # DECIDED  left of the grille
MUTE_EDGE    = "bottom"            # DECIDED  beneath the grille
VOL_DELETED  = True                # DECIDED  replaced by the mute switch

# ------------------------------------------------------------ coupon ------
COUPON_MARGIN = 6.0                # plate margin around the button clusters
COUPON_BORE_CLEARANCES = (0.0, 0.10, 0.20, 0.30)   # print variants
