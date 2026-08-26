# Handheld Speaker-Clearance Rear Profile Design

**Status:** Approved in design discussion on 2026-08-26
**Target:** `hardware/pocket_card/case/out/order/pocket_card_complete.blend`
rear shell, generated from `hardware/pocket_card/case/params.py`,
`side_arc.py`, and `shell_back.py`

## Problem

The current rear shell reserves the already-calculated speaker-plug clearance
at the top of the case. The real speaker socket is on the back face of the
display PCB at its lower edge, approximately at the vertical middle of the
assembled handheld. The outward-running plug wires therefore collide with the
rear shell. The case presses hard against them and cannot seat normally.

Inspection of the placed display mesh in `pocket_card_complete.blend` locates
the connector body at approximately `y = 41.28..44.88 mm` in case coordinates.
The current north-edge deck instead gives its full clearance at `y = 0..11 mm`
and returns to normal depth by approximately `y = 23.35 mm`.

This is a placement error, not a clearance-sizing or cable-routing problem.
The existing clearance calculation remains authoritative.

## Design

Remove the raised top region. Make the screen portion of the enclosure use the
normal thin rear profile so that it reads as a deliberately slim display
section.

Relocate the existing maximum-depth clearance envelope to the actual
speaker-plug position. The deepest section is centered on the placed PCB's
plug-and-wire envelope at the display PCB's lower edge. Do not increase the
previously calculated maximum depth, wall allowance, or assembly tolerance.
The functional cavity keeps its calculated envelope; the exterior transition
may extend laterally only to blend that cavity into the full shell width.

Express the relocated clearance as a broad lower-rear form rather than an
isolated central blister:

- span the transition across the rear shell so it reads as part of the case;
- join the thin screen section to the maximum-depth section with the largest
  practical rounded step;
- confine maximum depth to a short vertical band aligned with the plug while
  allowing that band to blend laterally into the side walls;
- below that section, taper continuously and monotonically toward the normal
  rear plane;
- reach the normal rear depth at the bottom edge; and
- keep the profile laterally symmetric unless the placed PCB envelope proves
  that symmetry would cause an interference.

The resulting side silhouette is a thin upper screen housing, a soft shoulder
at the connector line, and a long shallow taper into the bottom. The visual
concept sketches exaggerate this depth change for readability. The production
shape must be as subtle as the established clearance permits: no extra
thickness should be added merely to make the feature more visible.

## Geometry Rules

The implementation is derived from placed assembly geometry rather than new
guessed dimensions:

1. Use the existing top-bulge clearance envelope as the source of maximum
   required rear depth (`2.40 mm` beyond the normal rear plane in the current
   model).
2. Align that envelope with the real outward-facing speaker plug and its wires
   in the assembled PCB coordinate frame.
3. Preserve the existing rear-shell wall thickness around the relocated
   envelope.
4. Start the rounded step as late as the available radius and plug clearance
   allow, preserving the visibly thin screen region.
5. From the maximum-depth section, reduce rear offset without reversals until
   it is zero at the bottom edge.
6. Blend the transition into both side walls without a local wart, sharp ledge,
   or secondary bulge.

## Constraints

- Do not change the speaker connector, plug, cable, or PCB orientation.
- Do not recalculate the clearance envelope unless physical measurement shows
  the existing calculation itself is wrong.
- Do not retain unused extra depth at the top.
- Do not carry the maximum thickness all the way to the bottom.
- Preserve screw bosses, PCB supports, shell seam geometry, minimum wall
  thickness, and other existing internal keep-outs.
- Avoid a new pressure point or an obvious rocking ridge on the assembled
  device. If the physical prototype rocks, revisit the taper rather than adding
  unapproved feet or another bulge.

## Verification

### CAD checks

- Overlay the rear shell with the correctly oriented and placed PCB assembly.
- Inspect a section through the speaker connector and wires. The relocated
  cavity must contain the complete existing clearance envelope.
- Confirm that the old top clearance volume is gone.
- Confirm that the upper screen region uses the normal rear plane.
- Confirm that the rear offset decreases monotonically below the connector and
  reaches zero at the bottom edge.
- Run collision checks against bosses, mounts, the PCB, battery volume, speaker
  volume, and shell seam.
- Confirm minimum wall thickness throughout the rounded step and taper.

### Physical fit check

Print the revised rear shell and assemble it with the actual PCB, plug, and
speaker wires. The shell must close until the full seam seats without unusual
force, visible wire deflection, pinching, or pressure on the connector. Open it
again and inspect the cable and plug for witness marks. Place the assembled
device rear-down and confirm that the tapered profile does not create
unacceptable rocking.

## Acceptance Criteria

The design is accepted when all of the following are true:

1. The real plugged-in assembly fits and the shell closes normally.
2. The previously calculated clearance is preserved at the correct location.
3. The top of the rear shell is restored to the normal thin profile.
4. The maximum rear depth occurs at the speaker connection, not elsewhere.
5. The lower rear surface returns smoothly to normal depth at the bottom.
6. The form reads as a rounded transition between a thin display section and
   the lower case, not as a central patch or isolated bulge.
7. No existing mounts, walls, seams, or internal component envelopes regress.

## Out of Scope

- Connector or cable replacement
- PCB or speaker relocation
- Front-shell changes
- New feet, stands, vents, or decorative rear features
- Unrelated cleanup of the Blender enclosure model
