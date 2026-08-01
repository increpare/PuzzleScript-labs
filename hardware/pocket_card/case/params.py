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
# Outer "brick" belt (face↔side, back↔side) and screen lip. Keep ≤~0.8 so the
# 1.5 mm wall/face is not knifed down at the rim.
EDGE_CHAMFER = 0.6        # DECIDED  front + back perimeter
APERTURE_CHAMFER = 0.7    # DECIDED  screen opening, viewing angle

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
# Undo/Action by size, which is the hierarchy the July 12 spec asked for.
# Menu stays a slit: it is the most recessive control on the device.
RESET_X, RESET_Y = 56.50, 80.00    # was 81.60; north so mute clears courtyard
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
# Widened left from x=8 to x=2.5 so the board reaches the bottom-left case
# boss and can be supported there. It also fixes SW_LEFT, whose pads reached
# x=7.2 and overhung the old edge.
PCB_X, PCB_Y   = 2.5, 53.0
PCB_W, PCB_H   = 80.5, 37.0

# Edge switches, on the bottom rail of the controller PCB
# PCB mounting screws. Both must land on actual board material -- the driver
# notch removes the whole bottom-right corner -- and off the cell, since a screw
# head protruding into a lithium pouch is a puncture risk. That leaves a narrow
# strip between the cell fence (x <= 60.8) and the notch (x >= 68.2).
# PCB mounts (approach A): thin pins from the FRONT through the board holes;
# wide shoulders on the BACK shell that the PCB rests on (with a bore for the
# pin tip). A rear flare on the front shell made the board impossible to seat.
PCB_MOUNTS = ((4.5, 56.0), (4.5, 88.0), (65.0, 56.0), (66.0, 81.0))
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
# open band left of the driver and right of the cell. Driver XY overlap on B.Cu
# is fine — the driver is front-shell only (z ≈ 1.5–5.0).
#
# 2×2 so a GH plug can engage (Δy=7 single-file was courtyard-only clearance).
# rot=180 pointed mouths at the bottom edge (away from the module); 0 flips them.
# Left column clear of H4 (66,81); Δy=13 / Δx=15 for GH plug access.
CONN_I2C     = (63.0, 63.0)   # ASSUMED  4P GH
CONN_EXP     = (78.0, 63.0)   # ASSUMED  4P GH
CONN_BAT_IN  = (63.0, 76.0)   # ASSUMED  2P GH from cell
CONN_BAT_OUT = (78.0, 76.0)   # ASSUMED  2P GH to module BAT
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
PCB_T          = 1.6     # DECIDED  JLCPCB standard (2.0 mm is ~15× the fab cost).
                         # Free-board flex at 1.6 was worse than travel; in the
                         # shell the board sits on posts/shoulders. Revisit if
                         # coupon presses feel mushy.
PET_T          = 0.2     # ASSUMED  battery insulator
CELL_T         = 5.0     # DECIDED  503450
CELL_W, CELL_H = 50.0, 34.0        # DECIDED
CELL_SWELL     = 0.5     # ASSUMED

LOWER_ZONE_T = PCB_FRONT_Z + PCB_T + PET_T + CELL_T + CELL_SWELL + WALL
UPPER_ZONE_T = MOD_DEPTH + 0.3 + WALL     # module sits flush in the front window
BODY_T       = max(LOWER_ZONE_T, UPPER_ZONE_T)

# Switch height is a direct thickness lever: every millimetre of TACT_H is a
# millimetre of device. SKQGABE010 at 1.5 mm is the chosen low-profile part.

# ------------------------------------------------------------- audio ------
# The actual speaker, read out of hardware/card/case/case.blend (object
# "speaker", 20.00 x 14.00 x 3.50, 68 vertices). It is a PILL, not a rectangle:
# 14 mm wide with semicircular ends of radius 7, so a 6 mm straight section
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
