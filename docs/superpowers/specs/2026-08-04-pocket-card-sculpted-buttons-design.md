# Pocket Card Sculpted Buttons Design

## Goal

Prototype a tactile shape language for the eight existing Pocket Card face
buttons without changing their openings, positions, retention, switch stack or
travel.

## Crown language

- The four direction caps are asymmetric pebbles. Each rises toward the outer
  edge and falls toward the centre of the cluster, so the four separate buttons
  read under the thumb as one shallow directional bowl.
- Undo has the deepest concave dish and remains the most inviting round cap.
- Action is a smooth, low convex lens, deliberately opposite to Undo without
  becoming a slippery high dome.
- Reset is low and cratered so it is identifiable but difficult to hit by
  accident.
- Menu remains a low oblong pill and gains three shallow transverse grooves.

All crown transitions are rounded or lofted. No legend is engraved in this
prototype; shape alone must distinguish the roles.

The dimensions follow two human-factors findings: gross size and plan shape
are more reliably distinguished than small differences in edge roundness, and
concave or gently rounded surfaces centre a finger better than a high convex
cap. The 11 mm Undo/Action diameter is retained because it fits within the
typical fingertip contact area reported by van Deurzen et al. (2024).

References:

- van Deurzen et al., *Substitute Buttons: Exploring Tactile Perception of
  Physical Buttons for Use as Haptic Proxies* (2024),
  <https://doi.org/10.3390/mti8030015>
- U.S. Department of Defense human-factors guidance summarized in the
  *Interface Design for System of Systems* report, including concave
  switchcaps for finger centring,
  <https://files.eric.ed.gov/fulltext/ED287683.pdf>
- Nakatani et al., fingertip concave/convex identification threshold study,
  <https://www.jstage.jst.go.jp/article/tvrsj/13/1/13_KJ00007499176/_article>

## Mechanical boundary

The existing head diameter, radial clearance, keyed flange, flange thickness,
boss, switch gap and collar geometry are invariant. `coupon.py` remains the
neutral fit-calibration source and is not changed. The sculpted generator owns
only role-specific crown geometry above the outer face.

The prototype exports individual printable caps at the origin, a sprued set
whose connections touch hidden flange material, and a placed multi-body STEP
plus front-shell preview. It also replaces the eight neutral caps in the
existing complete coloured Blender assembly while preserving all other case,
display and electronics objects. Generated artefacts live under `case/out/`
and are not committed.

## Verification

Automated checks prove that all roles preserve the mechanical envelope below
the face, remain single solids, have the intended relative crown heights and
asymmetry, and fit the existing collars. The full case checks continue to pass.
A rendered oblique preview is inspected for obvious collisions, inverted
direction slopes, sharp crown discontinuities and unreadable role differences.
