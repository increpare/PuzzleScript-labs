# Pocket Card Sculpted Buttons Design

## Goal

Prototype a tactile shape language for the four auxiliary Pocket Card face
buttons without changing any opening, position, retention, switch stack or
travel. The four direction buttons retain their established production shape.

## Crown language

- Up, Down, Left and Right use the original neutral round, dished caps generated
  by `coupon.cap`; there is no experimental D-pad crown geometry.
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
neutral fit-calibration source and the complete geometry source for all four
direction caps. The sculpted generator owns only the Undo, Action, Reset and
Menu crown geometry above the outer face.

The prototype exports individual printable caps at the origin, a sprued set
whose connections touch hidden flange material, and a placed multi-body STEP
plus front-shell preview. It also replaces the eight neutral caps in the
existing complete coloured Blender assembly while preserving all other case,
display and electronics objects. Generated artefacts live under `case/out/`
and are not committed.

## Verification

Automated checks prove that every direction cap is geometrically identical to
the neutral production cap, that all roles preserve the mechanical envelope
below the face, and that every cap remains one valid solid fitting the existing
collars. The auxiliary caps retain their intended relative crown heights. A
rendered oblique preview is inspected for collisions, sharp crown
discontinuities and unreadable role differences.
