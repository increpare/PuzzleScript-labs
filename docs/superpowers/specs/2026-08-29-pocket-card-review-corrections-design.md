# Pocket Card Review Corrections Design

**Status:** Approved for direct implementation by the owner on 2026-08-29.

## Goal

Correct the four issues found in the first captive-nut enclosure review without
weakening the SLA 8001 closure: the rear bulge must read 5 mm lower, the rear
texture must cover the compound underside, U1 must sit more centrally, and the
controller PCB must have a face-side stop opposite its left rear support.

## Rear bulge

The previous change moved only the upper rise start. The full-depth band and
lower return stayed fixed, so the visible bulge did not move. Keep the
plug-derived upper edge of the full-depth region at `39.3281 mm`; moving it
would remove required display-connector and cable clearance. Move the two
visible shoulder boundaries 5.00 mm south relative to the original profile:

- retain the already-corrected upper rise start at `31.9812 mm`;
- extend the full-depth band so its lower edge moves from `46.8281 mm` to
  `51.8281 mm`; and
- recompute the tangent lower return from that new edge to the south end.

This is the safe geometric correction: the broad form moves lower while the
small part of the plateau that is structurally required above it remains.

## Rear texture

Retire the fixed-plane Blender `bricktexture_back` Boolean for the generated
back shell. It spans only about 33 mm in Y and cannot follow a surface whose Z
varies by 2.4 mm.

Generate the back mortar pattern in CadQuery. Intersect the pattern with the
outer 0.30 mm skin between the real envelope and its inward offset, then cut
that skin from the shell. This makes the recess follow the spherical perimeter
roll and the relocated rear bulge. Texture the broad rear field while leaving
a smooth perimeter margin and smooth discs around all screw seats.

## U1 placement

Move U1 from `(44.3, 72.0)` to `(41.3, 69.0)`: 3 mm left and 3 mm up in PCB
layout coordinates. Preserve every electrical net, reroute affected copper,
refill zones, and require zero DRC errors and zero unconnected items.

## Left PCB retention

The battery fence supports the PCB from the rear on the left, but there is no
opposing face-side feature. Add a rigid cylindrical front-shell stop at
approximately `(8.0, 82.0)`, aligned with the left battery-fence rail. Its rear
end stops 0.20 mm before the PCB front surface. The board still installs
straight in with no snap flex, but can no longer lift or rattle appreciably in
that corner after the two right-side screws are tightened.

## Verification

- Unit tests lock both moved rear-profile boundaries and retained plug depth.
- Texture cutter sections must exist in multiple Y bands across the usable
  rear field and must not enter screw-seat keep-outs.
- The front stop must lie on real PCB material, clear real components, and
  leave the specified axial gap.
- KiCad validation must report zero ERC/DRC errors and zero unconnected items.
- Rebuild all PCB, shell, embossed, and assembly artifacts.
- Render and inspect the assembled rear, exploded closure, H2 cutaway, and
  trap close-ups before reporting completion.

