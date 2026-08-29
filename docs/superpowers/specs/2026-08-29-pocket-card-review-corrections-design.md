# Pocket Card Review Corrections Design

**Status:** Approved for direct implementation by the owner on 2026-08-29.

## Goal

Correct the four issues found in the first captive-nut enclosure review without
weakening the SLA 8001 closure: the rear bulge must read 5 mm lower, the rear
texture must cover the compound underside, U1 must sit more centrally, and the
controller PCB must have a face-side stop opposite its left rear support.

## Rear bulge

Owner correction after inspecting the first implementation: moving only the
rise start and lower plateau edge stretched the form around the unchanged
`39.3281 mm` crest. It did **not** translate the visible bump.

Translate all three interior profile stations 5.00 mm south relative to the
original profile:

- upper rise start: `26.9812 -> 31.9812 mm`;
- full-depth plateau start: `39.3281 -> 44.3281 mm`;
- full-depth plateau end: `46.8281 -> 51.8281 mm`.

The translated rise therefore retains its original `12.3469 mm` run and
`22 degree` tangent profile. The south end of the enclosure remains fixed at
`93 mm`, so recompute only the lower return from the translated plateau end to
that fixed boundary.

Do not retain a local tongue or blister at the old crest. A direct collision
probe of the translated 22-degree rise against the mated connector at every
`+/-0.3 mm` placement extreme, plus the `0.8 mm` cable-exit envelope, measures
`0.0000 mm3` intersection. The connector lies on `2.353 mm` of the available
`2.400 mm` rise, so the one broad translated form clears it without another
visible feature.

## Rear texture

Retire the fixed-plane Blender `bricktexture_back` Boolean for the generated
back shell. It spans only about 33 mm in Y and cannot follow a surface whose Z
varies by 2.4 mm.

The finite Y span is part of the old composition, not a defect. Recreate the
legacy cutter layout in CadQuery, but intersect it with the outer 0.30 mm skin
between the real envelope and its inward offset so it follows the spherical
perimeter roll and relocated rear bulge.

Measurements recovered from `hardware/card/case/case_updated.blend`:

- brick band: model-space `y = 12.67..45.89 mm`, equivalent to layout-space
  `y = 47.11..80.33 mm`, spanning the rear width and clipped by the shell;
- circular brick keep-out: diameter `18.70 mm`, centred at layout
  `(45.00, 54.91)`;
- recessed medallion: diameter `15.59 mm` at the same centre;
- protected PuzzleScript man: the existing five-row `GRILLE_BITMAP`, at
  `2.00 mm` per cell (about `10 x 10 mm`), centred at approximately
  `(45.05, 54.69)`.

Boolean order is significant: build the partial mortar grid, remove the outer
medallion circle, add the smaller recessed medallion, then remove the man from
the cutter. Keep smooth discs around every screw seat. The result must read as
the old partial brick band with a raised logo-negative, not wallpaper over the
whole rear.

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

- Unit tests lock all three translated rear-profile stations and reject any
  local feature that re-anchors the connector position at full depth.
- Texture cutter sections must exist only in the recovered partial Y band,
  preserve the medallion annulus and logo-negative, and stay out of screw-seat
  keep-outs.
- The front stop must lie on real PCB material, clear real components, and
  leave the specified axial gap.
- KiCad validation must report zero ERC/DRC errors and zero unconnected items.
- Rebuild all PCB, shell, embossed, and assembly artifacts.
- Render and inspect the assembled rear, exploded closure, H2 cutaway, and
  trap close-ups before reporting completion.
