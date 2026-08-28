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
import math as _math

# ---------------------------------------------------------------- body -----
BODY_W = 90.0          # DECIDED
BODY_H = 93.0          # DECIDED
WALL   = 1.5           # ASSUMED  shell wall thickness, sides and back
# Back tray depth (outer). Was WALL (1.5): that slab sat inside the side-arc
# scoop and left holes / no continuous lip. ~6 mm parks USB wholly in the tray
# and leaves stock for a shaped rim (split-lip design 2026-08-02).
LID_T  = 6.0           # DECIDED  back tray; front SHELL_DEPTH = BODY_T - LID_T
FACE_T = 1.5           # DECIDED  front face thickness in the button area

# Captive DIN 934 M2 nut closure, all dimensions in mm. The production cavity
# is coupon-tuned for JLC SLA 8001; the complete cage envelope remains fixed so
# every coupon variant is covered by the same shell-clearance contract.
NUT_NOMINAL_AF = 4.0           # NOMINAL  stocked nut width across flats
NUT_AF = 4.4                   # DECIDED  production cavity across flats
NUT_AF_VARIANTS = (4.3, 4.4, 4.5)  # DECIDED  SLA fit-coupon cavities
NUT_KERNEL_MIN_AF = 0.0001     # KERNEL  minimum reliable across-flats size;
                               # 50x the smallest verified-valid OCC sweep
NUT_MAX_T = 1.6                # DIN 934  maximum physical nut thickness
NUT_CAVITY_T = 1.8             # DECIDED  axial cavity depth
NUT_ROOF_T = 1.0               # DECIDED  printed load-bearing roof
NUT_ROOF_TAPER = 0.5           # DECIDED  mm axial/radial, 45-degree inside
                               # chamfer; leaves 0.5 mm flat exterior-side roof
NUT_THROAT_W = 4.6             # DECIDED  side-loading throat width
NUT_WALL = 1.0                 # DECIDED  minimum radial cage wall
MACHINE_SCREW_CLEAR_D = 2.4    # DECIDED  M2 screw clearance bore diameter
MACHINE_SCREW_TIP_RELIEF = 0.6  # DECIDED  bore depth into front-face floor
NUT_ENVELOPE_R = 3.6           # DECIDED  conservative complete cage radius
# Outer "brick" belt (face↔side, back↔side) and screen lip. Keep ≤~0.8 so the
# 1.5 mm wall/face is not knifed down at the rim.
EDGE_CHAMFER = 0.8        # DECIDED  softer perimeter (was 0.6)
APERTURE_CHAMFER = 0.7    # DECIDED  screen opening, viewing angle

# ------------------------------------------------------- split-line lap -----
# The shells overlap INSIDE the wall thickness, not inboard of it. A lip that
# stands proud of the inner wall has nowhere to go here: the module PCB is
# 86.0 wide and the interior at the split is ~86.1, and such a lip is not over
# the tray wall either, so it floats free of the tray (it did: lid() built as
# two solids). The tray keeps the inner LAP_T of the wall and runs it up past
# the split; the front keeps the outer remainder and runs it down to meet it.
# The tongue's inner face IS the inner wall, so nothing intrudes at all.
#
# Both mating faces are straight prisms taken at the split section — see
# side_arc.section_prism. The back roll widens every cross-section with
# height, so a lap that followed the envelope would be wider at its top than
# the slot it has to enter and the case simply would not close.
LAP_T     = 0.65   # DECIDED  tongue: inner slice of the wall, on the back tray
LAP_CLEAR = 0.15   # DECIDED  radial slip fit between the two laps
LAP_H     = 1.2    # DECIDED  engagement height above the split
LAP_OVER  = 0.2    # DECIDED  front rebate outruns the tongue, so the shells
                   #          close on the outer shoulder, not the tongue top
LAP_FRONT_T = WALL - LAP_T - LAP_CLEAR   # 0.70  front skirt at the split

# ------------------------------------------------------------- module -----
MOD_W, MOD_H    = 86.0, 50.0    # DATASHEET  ES3C28P outline
# The corners are NOT square, and it matters: the board is 86.0 wide in an
# interior of ~86.1, so the plan-corner rounding is the whole ballgame. R3.50
# is what lets CASE_TOP_R be 7.5 instead of 4.0.
MOD_CORNER_R    = 3.50          # DATASHEET  "R3.50*4", outline drawing 5.1
MOD_PCB_T       = 1.60          # DATASHEET  "1.60 PCB"
MOD_DEPTH       = 10.60         # DATASHEET  total, touch surface to tallest rear part
MOD_FRONT_STACK = 5.85          # DATASHEET  touch surface to back of module PCB
# Side-entry rear components are measured at 3.5 mm, so they set the ordinary
# upper tray. The assembled outward-facing plug is owned by the measured
# DISPLAY_PLUG_* envelope and local rear deck below.
MOD_REAR_TYPICAL = 3.50         # MEASURED  ordinary rear components
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
# to ~19.9 mm. Tact switches bring that to 4.5 mm and ~13.7 mm (SKQGABE010;
# see docs/superpowers/specs/2026-07-31-pocket-card-skqg-rear-connectors-design.md).
#
# Consequence: we own the whole load path again -- return, guide, hard stop and
# retention -- which the membrane had been providing for free.

# Alps Alpine SKQGABE010 product page (catalog, not formal delivery drawing):
# https://tech.alpsalpine.com/e/products/detail/SKQGABE010/
#   Operating force 1.57 N, Travel 0.25 mm, Product height 1.5 mm, □5.2×1.5
# Land pattern / keepouts: use KiCad SW_SPST_SKQG_WithStem until the formal
# drawing is in-repo.
TACT_PART    = "SKQGABE010"   # ALPS catalog page above
TACT_H       = 1.5            # ALPS catalog — product height incl. stem
TACT_TRAVEL  = 0.25           # ALPS catalog
TACT_FORCE_N = 1.57           # ALPS catalog SKQGABE010
TACT_OUTLINE = 5.2            # ALPS catalog square body

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
COLLAR_DEPTH   = 2.2        # ASSUMED  guide length below the inner face
HARD_STOP_AT   = 0.35  # DECIDED  flange lands here: past 0.25 actuation,
                       #          before the switch bottoms
CAP_BOSS_GAP   = 0.5   # ASSUMED  boss end to plunger at rest

# Snap-over collar shoulder (production hard stop). Flange clicks in from the
# PCB side over a ramp; the flat top of the lip stops travel at HARD_STOP_AT.
# These three are coupon-tuned ASSUMED values.
SHOULDER_RADIAL = 0.35   # ASSUMED  how far the lip intrudes past the flange OD
SHOULDER_FLAT_T = 0.40   # ASSUMED  axial thickness of the flat stop face
SHOULDER_RAMP_T = 0.35   # ASSUMED  axial length of the insertion ramp below
# Menu pill bore is only ~5.6 mm on the narrow axis; a 0.35 mm lip each side
# leaves shoulder_id 4.9 mm — smaller than the □5.2 SKQG. Widen the pill collar
# bore only (face hole / flange unchanged) so the lip clears the body by ≥0.2 mm.
PILL_BORE_EXTRA = 0.60   # ASSUMED  added to pill bore_l and bore_w

# Anti-rotation for the non-round caps (pills). Two flats on the flange running
# in matching collar slots -- the DMG's own trick, measured off the reference:
# its A/B collars carry two opposed 24-degree slots starting 3.9 mm down.
ANTIROT_SLOT_DEG = 24.0   # MEASURED

# The PCB front face is set by the button stack, not chosen freely.
PCB_FRONT_Z = FACE_T + CAP_FLANGE_T + CAP_BOSS_GAP + TACT_H   # 4.5

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
# Undo/Action by size. It moves left to free the complete lower-right H2
# captive-nut envelope.
# Menu stays a slit: it is the most recessive control on the device.
RESET_X, RESET_Y = 54.50, 80.00
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
# Widened left from x=8 to x=2.5 so the board reaches the bottom-left case
# boss and can be supported there. It also fixes SW_LEFT1, whose pads reached
# x=7.2 and overhung the old edge.
PCB_X, PCB_Y   = 2.5, 53.0
PCB_W, PCB_H   = 80.5, 37.0
# False = readable silk (UI legends + KiCad refs). True restores brick/rules/logo.
DECORATIVE_SILK = False

# Edge switches, on the bottom rail of the controller PCB
# PCB mounting screws. Both must land on actual board material -- the driver
# notch removes the whole bottom-right corner -- and off the cell, since a screw
# head protruding into a lithium pouch is a puncture risk. That leaves a narrow
# strip between the cell fence (x <= 60.8) and the notch (x >= 68.2).
# PCB mounts (approach A): thin pins from the FRONT through the board holes;
# wide shoulders on the BACK shell that the PCB rests on (with a bore for the
# pin tip). A rear flare on the front shell made the board impossible to seat.
# Left mount (4.5,56) dropped: side-arc back land cannot host a shoulder/head
# left of the cell. Right-strip mounts get rear screws via EXTRA_BOSSES.
# H1 nudged west so J_BAT_OUT1's courtyard clears its Ø7.7 land. H2 aligns
# vertically with H1 and its complete captive-nut envelope is clear of Reset.
PCB_MOUNTS = ((64.5, 56.0), (64.5, 84.0))
PCB_MOUNT_D    = 2.6   # clearance hole in the board
PCB_POST_D     = 2.4   # front pin through the hole
PCB_SHOULDER_D = 4.4   # back-shell column the board rests on
PCB_PIN_TIP    = 1.2   # DECIDED  pin past PCB back into the shoulder bore
# Legacy name: shoulder height is now “back column up to PCB back” (derived).
PCB_SHOULDER_H = 1.5   # unused for geometry; kept so old checks don’t ImportError

# Both screws sit at x ~= 65, which supports Undo, Action and Reset well but
# leaves the direction cluster 54 mm from the nearest fixing. The cell is
# directly behind it, so neither a screw nor a boss can go there. This rib on
# the back shell bears on the board's rear instead, above the cell.
# Plain support pads on the back shell that the board simply rests on. They
# need no hole and no clearance from the button collars, because they sit
# BEHIND the board -- and the press force is that direction anyway. Cheaper
# than a pillar wherever locating the board is not also required.
PCB_SUPPORT_PADS = ((76.0, 60.0),)
PCB_PAD_D = 5.0

PCB_RIB_X0, PCB_RIB_X1 = 9.0, 62.0
PCB_RIB_Y0, PCB_RIB_Y1 = 53.0, 54.4
# The rib and the cell fence wanted the same 1.5 mm strip, and the band is only
# 39 mm for a 34 mm cell plus fence -- there is no room for both. The fence is
# only a locating rib, so it is left open at the top and this rib retains the
# cell as well as supporting the board. One feature, two jobs.

POWER_SW_X = 20.0                  # DECIDED  bottom edge, far left
# Mute must sit left of the driver bore (~x 68.7–83.3) and clear Reset/H4
# courtyards. Pure X at y=88 between Reset@81.6 and the driver is too tight;
# Reset north to y=80 frees mute at x=58 (clears H4 by dx, Reset by dy).
MUTE_SW_X  = 58.0                  # DECIDED  left of speaker enclosure
# C&K PCM12SMTR (KiCad SW_SPDT_PCM12) — official STEP in packages3D, ~1.5 mm
# above F.Cu. JS102011SAQN retired (no official 3D, ~3.5 mm body ate the face).
# Pegs at footprint y=+0.33 must sit on FR4; no south-edge notch under them.
# Mechanical SMD tabs at y=+1.43 (size 0.8) set the edge budget — need
# SW_Y+1.83 ≤ south−0.5 → SW_Y ≤ 87.67. Tip pocket reaches deeper into the
# cavity so Y engagement still hits SLIDE_ACTUATOR_LEN at this Y.
# Max SW_Y ≈ 87.67 for 0.5 mm mech-pad clear to Edge.Cuts (tabs at +1.83).
POWER_SW_Y = 87.65                 # DECIDED  flush as pad clear allows
MUTE_SW_Y  = 87.65                 # DECIDED

SLIDE_FP_LIB = "Button_Switch_SMD"
SLIDE_FP_NAME = "SW_SPDT_PCM12"    # DECIDED  LCSC C221841 / PCM12SMTR
# Southernmost copper: mech tabs cy +1.43, half 0.4 → +1.83 (not signal pads).
SLIDE_PAD_SOUTH_REL = 1.83         # DATASHEET/KiCad  mech tab copper south
# Official STEP actuator (KiCad 3D Y-mirror → device south). Nub is NOT on
# footprint X=0 — tip + letterbox centre at SW_X + SLIDE_ACTUATOR_X_REL.
SLIDE_PADDLE_Y_REL = 3.13          # DECIDED  STEP |Ymin|
SLIDE_PEG_Y_REL = 0.33             # DATASHEET/KiCad  NPTH at (±1.5, 0.33)
SLIDE_ACTUATOR_X_REL = -0.58       # DECIDED  STEP actuator X mid (whole tip)
SLIDE_ACTUATOR_LEN = 1.30          # DECIDED  STEP actuator Y span
SLIDE_ACTUATOR_W = 1.30            # DECIDED  STEP actuator X span
SLIDE_ACTUATOR_H = 0.80            # DECIDED  STEP actuator Z span
SLIDE_ACTUATOR_Z_ABOVE_PCB = 0.80  # DECIDED  STEP actuator Z mid
# U-fork into cavity (−Y). 2.0 = was 2.5; −0.5 clears the PCM12 body.
TIP_POCKET_CAVITY = 2.0            # DECIDED  was 2.5 (fork hit switch body)

# Retired: notches under the slides removed the peg land. Keep W for reference;
# D=0 → rectangular outline (actuator overhangs the unbroken south edge).
SLIDE_NOTCH_W = 10.0               # unused while D=0
SLIDE_NOTCH_D = 0.0                # DECIDED  no cutout under pegs

# Dome tip (not a wide T-cap): proud bump + stem through the letterbox + small
# inner retainer flange (captive, no glue) + short U-fork on the PCM12 nub.
# Throw: Littelfuse PCM12SMTR travel min/nom/max = 1.3 / 1.5 / 1.7 mm
# (was ASSUMED 2.0 → letterbox ~1 mm too wide).
TIP_NECK_X = 3.2                   # ASSUMED  stem / dome width
TIP_DOME_Z = 2.6                   # ASSUMED  dome height through slot
TIP_PROUD = 0.7                    # DECIDED  slight bump outside the wall
TIP_TRAVEL = 1.5                   # DATASHEET  PCM12SMTR nominal throw
TIP_SLACK = 0.2                    # ASSUMED  each end (covers max 1.7 with margin)
TIP_POCKET_PLAY = 0.30             # ASSUMED  fork clearance on STEP actuator
TIP_RAIL_T = 0.6                   # DECIDED  thin inner retainer (not a cover plate)
TIP_NECK_CLEAR = 0.15              # ASSUMED  dome/neck vs slot clearance each side
TIP_SLOT_X = TIP_NECK_X + TIP_TRAVEL + 2 * TIP_SLACK   # 5.1
TIP_SLOT_Z = TIP_DOME_Z + 0.4      # 3.0
TIP_SLOT_Y = WALL + TIP_PROUD + 1.0
TIP_FACE_X = TIP_NECK_X            # alias — dome width
TIP_FACE_Z = TIP_DOME_Z            # alias — dome height
# Retainer: just wider than the slot (~0.5 mm lip each side). Not a cover plate.
TIP_FLANGE_OVER = 1.0              # DECIDED  total X beyond slot
TIP_FLANGE_X = TIP_SLOT_X + TIP_FLANGE_OVER            # 6.1
TIP_FLANGE_Z = TIP_SLOT_Z + TIP_FLANGE_OVER            # 4.0
TIP_CHAMBER_X = TIP_FLANGE_X + TIP_TRAVEL + 2 * TIP_SLACK  # 8.0
TIP_CHAMBER_Z = TIP_FLANGE_Z + 0.6                     # 4.6

# Legacy aliases (outer neck slot)
SLIDE_CUT_X = TIP_SLOT_X
SLIDE_CUT_Y = TIP_SLOT_Y
SLIDE_CUT_Z = TIP_SLOT_Z

# Module interconnects live on the PCB BACK (B.Cu), right-rear wiring pocket.
# y is still device/face coordinates (KiCad Y-down matches params).
# Cell fence ends near BATT_X + CELL_W + BATT_CLEAR ≈ 59.6; cluster sits in the
# open band left of the driver and right of the cell.
#
# "Driver XY overlap on B.Cu is fine" stopped being true when the low-profile
# switch pulled the board to 4.5: the driver now dips through the board plane
# and the bottom-right corner is notched away (PCB_DRIVER_NOTCH_*), so nothing
# may live at x>=68.2, y>=69. BAT_OUT (was 78,76 — inside the notch) moved to
# the north band. All pairwise pitches >= 9 (checks). Connectors are plugged
# before the board is seated, so on-stack runway is rework-only.
# rot=180 pointed mouths at the bottom edge (away from the module); 0 flips them.
#
# The module carries sockets flush with its own edge at the board's north
# side, so B.Cu courtyards keep CONN_NORTH_CLEAR off that edge. BAT_OUT is
# wedged between that rule, H1's land, I2C's courtyard, the 9 mm pitch to
# EXP, and the notch — EXP sits at its south limit (1.0 mm off the notch
# line) to make the pitch work.
CONN_NORTH_CLEAR = 3.0        # ASSUMED  courtyard to board north edge
CONN_I2C     = (63.0, 63.0)   # ASSUMED  4P GH
CONN_EXP     = (78.0, 65.6)   # ASSUMED  4P GH, at south limit vs notch
CONN_BAT_IN  = (63.0, 76.0)   # ASSUMED  2P GH from cell
CONN_BAT_OUT = (72.3, 58.5)   # ASSUMED  2P GH to module BAT; north band
CONN_ROT     = 0              # DECIDED  was 180 (faced away from module)
CONN_SIDE    = "B.Cu"         # DECIDED
#
# Land pattern stays KiCad JST_GH_SM0*B-GHS-TB (genuine JST geometry).
# JLCPCB BOM uses GH-compatible XUNPU wafers — genuine JST SM0*B-GHS-TB
# (C189895 / C189893) is routinely OOS / Extended with inflated "needed" qty.
# Mates standard GHR-0*V-S housings. See export_smt.py / BOM.csv.
CONN_4P_MPN  = "WAFER-GH1.25-4PWB"   # DECIDED  XUNPU; alt genuine SM04B-GHS-TB
CONN_4P_LCSC = "C3029379"            # DECIDED  was C189895
CONN_2P_MPN  = "WAFER-GH1.25-2PWB"   # DECIDED  XUNPU; alt genuine SM02B-GHS-TB
CONN_2P_LCSC = "C3029377"            # DECIDED  was C189893

# Lower-half rear screws through the controller PCB (also in PCB_MOUNTS).
# Sites sit in the cell↔driver strip with Ø5 head land on the flat back.
EXTRA_BOSSES = PCB_MOUNTS                    # DECIDED  single source (see above)

# ---------------------------------------------------- side-arc ergonomics ----
# Volume reduction only: continuous cylindrical arcs on a solid envelope, then
# hollow with WALL preserved (never cut arcs out of a hollow shell — holes).
# Full length, constant R; left limited by cell, right can go harder.
PCB_CORNER_R = 2.0         # DECIDED  top / generic outline fillet
PCB_BOTTOM_R = 14.0        # ASSUMED  bottom corners — frees lower side wall

# ---------------------------------------------------- lower zone stack ----
PCB_T          = 1.6     # DECIDED  JLCPCB standard (2.0 mm is ~15× the fab cost).
                         # Free-board flex at 1.6 was worse than travel; in the
                         # shell the board sits on posts/shoulders. Revisit if
                         # coupon presses feel mushy.
PET_T          = 0.2     # ASSUMED  battery insulator
CELL_T         = 5.0     # DECIDED  503450
CELL_W, CELL_H = 50.0, 34.0        # DECIDED
CELL_SWELL     = 0.5     # ASSUMED

LOWER_ZONE_T = PCB_FRONT_Z + PCB_T + PET_T + CELL_T + CELL_SWELL + WALL
# The module hangs off the front face at MODULE_Z, so its stack starts there and
# not at zero. Leaving MODULE_Z out read 12.40 for a zone that actually wants
# 12.80, and would have read 14.05 against the datasheet's rear maximum — which
# is how a 4.70 header came to be sitting 0.46 inside a 13.30 case.
UPPER_ZONE_T = MODULE_Z + MOD_FRONT_STACK + MOD_REAR_TYPICAL + 0.3 + WALL   # 12.80
BODY_T       = max(LOWER_ZONE_T, UPPER_ZONE_T)

# ------------------------------------------------------ rear display deck ----
# Authored display transform in pocket_card_complete.blend places this component
# at measured mesh bounds x 34.5476..42.1976, y 41.2781..44.8781,
# z -12.2148..-7.5148. The 3.70 mm width below is the conservative
# nominal/datasheet envelope (0.05 mm beyond each measured mesh side).
DISPLAY_PLUG_BODY_L = 7.65
DISPLAY_PLUG_BODY_W = 3.70
DISPLAY_PLUG_X = 38.3726
DISPLAY_PLUG_Y = 43.0781
DISPLAY_PLUG_CLEAR = 0.40
DISPLAY_PLUG_MATED_H = 5.70
DISPLAY_PLUG_CABLE = 0.80
DISPLAY_PLUG_ROLL_ALLOWANCE = 0.20

DECK_ZONE_T = (
    MODULE_Z + MOD_FRONT_STACK + DISPLAY_PLUG_MATED_H
    + DISPLAY_PLUG_CABLE + DISPLAY_PLUG_ROLL_ALLOWANCE + WALL
)
DECK_H = round(DECK_ZONE_T - BODY_T, 3)  # unchanged: 2.40 mm
DECK_FLOOR_Z = -DECK_ZONE_T + WALL

DECK_PLATEAU_Y0 = (
    DISPLAY_PLUG_Y - DISPLAY_PLUG_BODY_W / 2
    - DISPLAY_PLUG_CLEAR - WALL
)
DECK_PLATEAU_Y1 = (
    DISPLAY_PLUG_Y + DISPLAY_PLUG_BODY_W / 2
    + DISPLAY_PLUG_CLEAR + WALL
)

# Move the upper shoulder 5 mm toward the plug while retaining the original
# 22-degree profile as an explicit reference for the previous start point.
DECK_RISE_REFERENCE_PHI = 22.0
DECK_RISE_START_SHIFT = 5.0
_deck_rise_reference_p = _math.radians(DECK_RISE_REFERENCE_PHI)
_deck_rise_reference_r = DECK_H / (
    2 * (1 - _math.cos(_deck_rise_reference_p))
)
_deck_rise_reference_run = (
    2 * _deck_rise_reference_r * _math.sin(_deck_rise_reference_p)
)
DECK_RISE_Y0 = (
    DECK_PLATEAU_Y0 - _deck_rise_reference_run + DECK_RISE_START_SHIFT
)
DECK_RISE_RUN = DECK_PLATEAU_Y0 - DECK_RISE_Y0
DECK_RISE_PHI = _math.degrees(2 * _math.atan(DECK_H / DECK_RISE_RUN))
_deck_rise_p = _math.radians(DECK_RISE_PHI)
DECK_RISE_R = DECK_H / (2 * (1 - _math.cos(_deck_rise_p)))

# Use all remaining length for a tangent lower return.
DECK_TAPER_Y0 = DECK_PLATEAU_Y1
DECK_TAPER_Y1 = BODY_H
DECK_TAPER_RUN = DECK_TAPER_Y1 - DECK_TAPER_Y0
DECK_TAPER_PHI = _math.degrees(2 * _math.atan(DECK_H / DECK_TAPER_RUN))
_deck_taper_p = _math.radians(DECK_TAPER_PHI)
DECK_TAPER_R = DECK_H / (2 * (1 - _math.cos(_deck_taper_p)))

# ------------------------------------------------------------ USB-C port ----
# The module's own receptacle, in the left wall. It is dead centre of the
# module's 50 mm edge: the outline drawing's bottom dimension chain reads
# 13.44 / 11.56 / 11.57 / 13.43, so the connector lands at 25.00 of 50.
USB_Y      = MOD_Y + MOD_H / 2                    # 27.5
USB_REC_W, USB_REC_H = 8.94, 3.26   # ASSUMED  16-pin receptacle shell, outside
USB_REC_Z1 = -(MODULE_Z + MOD_FRONT_STACK)        # -7.50, rear-mounted on the module
USB_REC_Z0 = USB_REC_Z1 - USB_REC_H               # -10.76
#
# The hole does NOT have to pass a plug's overmold, which is the assumption that
# makes people cut 12.35 x 6.50 slots. USB Type-C R2.0 fig 3-80 asks only that
# the overmold clear the exterior surface by 0.05 when the plug is seated, and
# the plug's shell is 6.65 long (fig 3-11 sec C-C) — so the budget from the
# receptacle's mating datum to the skin is ~6.5. Ours is 2.00. The overmold
# seats ~4.5 clear of the case and never enters the hole at all, and the
# aperture only has to clear the plug's 8.25 x 2.40 shell.
USB_CLEAR  = 0.23   # DECIDED  aperture over the receptacle shell, per side.
                    # Leaves 0.58/side on the plug shell, so the module's
                    # +/-0.3 placement drift cannot bring the case into the
                    # plug's path.
USB_W      = USB_REC_W + 2 * USB_CLEAR            # 9.40
# The top edge is the split seam itself, not a line below it. The receptacle's
# top is only 0.20 under the seam, so ANY aperture that clears the receptacle
# reaches the seam anyway — the old 4.2-tall window left 0.21 mm of tray wall
# under the joint, a knife edge no process holds. Ending on the seam removes it
# and the front shell's skirt becomes the port's upper edge.
USB_Z1     = -(BODY_T - LID_T)                    # -7.30, the split
USB_Z0     = USB_REC_Z0 - USB_CLEAR               # -10.99
# The wall sweeps 1 deg to 40 deg across the port, because the port sits wholly
# inside the back roll — fig 3-81 covers this case and its worked example is a
# 22 deg wall. So the hole is a prism along the PLUG axis, not normal to the
# skin, and it has to outrun the wall's inner face at the deepest point: at
# USB_Z0 the rolled wall reaches x 3.25, and a cutter stopping at 3.0 clipped
# the receptacle's bottom corner by 0.11.
USB_CUT_X  = MOD_X + 3.5                          # 5.5, past the inner face
#
# What the aperture actually has to pass, and the reach the overmold needs.
# The shell's minimum exposed length is 6.51 (fig 3-11), and fig 3-80 wants
# 0.05 of daylight, so the skin may sit at most 6.46 behind the mating datum.
USB_PLUG_W, USB_PLUG_H, USB_PLUG_L = 8.25, 2.40, 6.65   # DATASHEET  USB-IF
USB_MOLD_W, USB_MOLD_H = 12.35, 6.50                    # DATASHEET  maxima
USB_SKIN_MAX = 6.46                                     # 6.51 shell - 0.05 gap

# ------------------------------------------------- back roll (envelope) ----
# The back is ONE rolled perimeter, not three separate features.
#
# It used to be: side arcs as an XZ profile extruded along Y, plan-view corners
# as PRISMATIC cylinder cuts (no z rounding at all), and the chin as its own
# cut — with nothing on the north edge, which ran flat out to y=0 at the full
# BODY_T. Where the extruded arc met the vertical corner cut you got a space
# curve, not a blend: the "cut meat" crease. SIDE_ARC_BOTTOM_BLEND existed only
# to paper over that, and only ever ran on the two bottom corners.
#
# Now: extrude the plan outline, then fillet the whole back perimeter at one
# radius. Corners become torus patches continuous with the side runs, so there
# is no seam to blend — there is no boolean intersection to begin with. Along a
# straight run a back-edge fillet of radius R is the same surface as the old
# extruded arc of radius R, so the side ergonomics carry over unchanged.
#
# Mirror-symmetric about x = BODY_W/2 by construction: one roll radius, one
# plan radius per end. The old 8.0 (left) / 11.6 (right) side split and the
# 16.5 / 17.0 bottom split made the right-hand side read wavy against a
# straight left.
#
# Caps on the roll, tightest first:
#   torus — must stay under the plan corner radius or the corner self-intersects
#   face  — must top out below the face plate (z <= -FACE_T) or it eats button
#           and driver land
#   cell  — the side wall must stay behind the pouch (check_battery_keepout)
BACK_ROLL_MARGIN = 1.5     # DECIDED  torus safety margin vs the plan radius
# Plan-view corners. Top was 8.0 and read sharp, then 10.0 — as far as the
# Ø7.7 module screw lands at (6,6.5)/(84,6.5) allow before they reach the skin.
# But the binding constraint is the display module, not the lands: its PCB is
# 86.0 x 50.0 with R3.50 corners (DATASHEET, ES3C28P outline drawing) sitting
# at (2.0, 2.5), and a top corner of 10.0 buried those corners 1.61 mm into
# the wall at the board's rear plane. 7.5 is the largest that clears them.
#
# This one number also sets the roll, via _ROLL_PLAN_CAP below — a deep roll
# needs a deep plan corner to sit in, and the deep plan corner is exactly what
# eats the module. Moving the module south instead would buy only 0.5 mm: the
# controller board starts at y 53.0 and the two overlap 0.2 mm in z.
CASE_TOP_R = 7.5                       # DECIDED  module-corner limited
# Bottom corners. These used to hug the controller outline (PCB_BOTTOM_R plus
# the board-to-shell gap, ~16.5), which was free while the corner was a
# prismatic cut. Once the back rolls, a plan corner that deep drags the cavity
# wall right onto the cell: the pouch's bottom-left corner (9, 89) ends up
# ~0.5 mm inside the wall, so ANY roll there intrudes. 12.0 pulls the corner
# back out and clears it; the board (R=14 corners) still fits with room, it
# just is not hugged any more. Measured — 14.0 still clips the pouch.
CASE_BOTTOM_R = 12.0                   # ASSUMED  cell-limited, not board-led
_ROLL_FACE_CAP = BODY_T - FACE_T - 0.2                       # 11.6
_ROLL_PLAN_CAP = min(CASE_TOP_R, CASE_BOTTOM_R) - BACK_ROLL_MARGIN
#
# One radius per straight run; the corner arcs interpolate between the two runs
# they join, so the radius is continuous the whole way round. That continuity
# is load-bearing, not cosmetic — OCC flatly refuses a chain whose radius jumps
# at a vertex (measured: every constant-per-edge variant returned IsDone=False,
# even gentle ones), while the interpolated version builds in a fraction of a
# second.
#
# Left and right are the SAME value, so the shape is mirror-symmetric about
# x = BODY_W/2. Only north-to-south varies, and only because it must:
#   sides — the cell's left edge (x=9) clears a roll up to ~8.7
#   chin  — the cell's bottom edge (y=89) is just 4 mm off the south edge, and
#           the pouch sits 11.8 deep, so the south run cannot exceed ~4. This
#           is why the old chin was 2.5 while the sides were 8+; the old code
#           got away with a hard bottom corner only because the plan corners
#           were prismatic, which is exactly what made the crease.
# 8.5 is the ergonomic wish; the plan cap binds first and lands this on 6.0,
# which puts the roll's tangent line exactly on the split plane (LID_T = 6.0).
BACK_ROLL_SIDE = min(8.5, _ROLL_FACE_CAP, _ROLL_PLAN_CAP)    # 6.0, plan-capped
BACK_ROLL_N    = BACK_ROLL_SIDE        # DECIDED  whole top half at one radius
BACK_ROLL_S    = 3.5                   # ASSUMED  cell-limited (check enforces)

# ------------------------------------------------- structural invariants ----
# Counterbores must always be cut into deliberately added land material, never
# into bare floor: WALL == SCREW_HEAD_H means a pocket in the floor is a
# through-hole. See 2026-08-03 feature-framework spec.
MIN_MEMBRANE = 0.8     # ASSUMED  min solid behind any counterbore seat (mm)
LAND_WALL    = 1.2     # ASSUMED  radial land material beyond the head pocket

# Assembly screws are M2 pan-head machine screws through the 2.4 mm clearance
# path into captive DIN 934 M2 nuts. Their stocked lengths and variable rear
# head-seat depths are selected from the compound profile in joints.py; see
# out/hardware_BOM.csv.

# Switch height is a direct thickness lever: every millimetre of TACT_H is a
# millimetre of device. SKQGABE010 at 1.5 mm is the chosen low-profile part.

# ------------------------------------------------------------- audio ------
# The actual speaker, read out of hardware/card/case/case.blend (object
# "speaker", 20.00 x 14.00 x 3.50, 68 vertices). It is a PILL, not a rectangle:
# 14 mm wide with semicircular ends of radius 7, so a 6 mm straight section
# The board front moved from 5.5 to 4.5 with the low-profile switch (TACT_H
# 1.5), leaving only 3.0 mm face->board — the 3.5 mm driver no longer fits ON
# the board. The bottom-right corner is therefore NOTCHED out of the outline
# (long assumed by the screw-placement comments above; never actually drawn
# until now) and the driver dips 0.5 mm through it.
PCB_DRIVER_NOTCH_X = 68.2   # DECIDED  board removed where x >= this ...
PCB_DRIVER_NOTCH_Y = 69.0   # DECIDED  ... and y >= this (device y is down)
PCB_NOTCH_R        = 2.0    # ASSUMED  inner-corner radius (mill/stress)

# With the board gone under the driver, a pedestal from the back-shell floor
# rises through the notch void and stops just behind the driver's back: it
# catches the driver on impact without preloading it (pressure would peel the
# face adhesive the driver hangs from).
DRIVER_BACKSTOP_D   = 10.0  # DECIDED  disc under the magnet, inside the notch
DRIVER_BACKSTOP_CLR = 0.3   # ASSUMED  gap to driver back: catch, don't press

# between them. DRIVER_W/H are the bounding box; DRIVER_PILL says how to draw it.
# Long axis VERTICAL here, unlike the blend, which is the older `card` case.
# Horizontal gives +1.00 mm to the walls instead of +0.00, but fouls corner boss
# 2 at (86, 89) and PCB mount H4 at (66, 81), and there is no grille position
# that clears both. Vertical fouls nothing; its +0.00 top margin is not a breach,
# it just means the pocket borrows the case's own top wall for that side.
DRIVER_W, DRIVER_H = 14.0, 20.0    # MEASURED  bounding box, long axis vertical
DRIVER_T = 3.5                     # MEASURED
DRIVER_PILL = True                 # MEASURED  stadium profile, not a box
# The driver carries adhesive on its front face, so it bonds flat to the inside
# of the front face and that bond is what carries it -- there is deliberately no
# seat, lip or shelf. A lip was tried and removed: 0.5 mm of standoff is exactly
# where the adhesive needs contact, so it would have held the driver off its own
# bonding surface and broken the seal to the grille chamber at the same time.
# The pocket walls are a locator for placing it squarely, nothing more.
# Leads leave the driver on a side face near its REAR, so the notch is cut in
# the back of the wall only and the front 2.0 mm stays continuous as a locator.
DRIVER_CABLE_W = 5.0               # MEASURED  notch width
DRIVER_CABLE_CLR = 1.5             # MEASURED  notch height, from the driver's back
# The stadium locator is symmetric, so production installs the driver rotated
# 180 degrees with its physical lead tabs facing south.  The north notch remains
# a harmless candidate opening, but is not a usable route: it enters the Action
# collar's moving envelope and could pinch or chafe the leads.
DRIVER_LEAD_EXIT = "south"          # DECIDED  approved installed orientation
# The adhesive is a perimeter ring, so what matters is solid face under the RIM,
# not over the whole footprint. Ring bond measured at 94-95% for 1.0-2.0 mm ring
# widths; the missing 5% is the two points where the arm slot crosses the rim.
DRIVER_BOND_RING = 1.5             # ASSUMED  ring width the check measures
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
# Read off object "speaker_cutout" in hardware/card/case/case.blend, which is
# the existing hand-drawn grille: 3.000 mm pitch in BOTH axes, slots 1.377 tall,
# each run inset 0.347 from its end cells. Previously guessed at 2.6 / 1.6.
GRILLE_CELL      = 3.0     # MEASURED  pitch, x and y alike
GRILLE_SLOT_H    = 1.377   # MEASURED  slot height, web 1.623
GRILLE_RUN_INSET = 0.347   # MEASURED  per end of a run, web 0.694

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
