# Pocket Card — Enclosure Surface Treatment (Wrapped Brick Relief)

Date: 2026-08-03
Status: agreed in design session.

## What this amends

This document is authoritative for **decorative and grip relief on the outer
surfaces of both shells**, and for where that relief is authored. It does not
reopen the stack-up (`BODY_T`, cell, SKQG height), the side-arc profile, the
split-lip geometry, or control layout.

| Prior topic | Status |
|---|---|
| Emboss authored in `hardware/card/case/case_updated.blend` as boolean cutters | **Amended** — moves into the CadQuery build |
| `out/order/shell_front_embossed.stl` as the emboss deliverable | **Retired** — emboss lands in the normal `shell_front` / `shell_back` outputs |
| Relief is **cut** into the outer surface | **Amended** — relief is **proud** of it |
| Nominal outer envelope = final outer surface | **Amended** — final surface is envelope + relief in textured zones |
| `BODY_T` (~13.3 mm), side-arc profile, split lip | **Unchanged** |
| Control layout, cap sizes, `CAP_PROUD` | **Unchanged** — protected by keep-out |

Numeric truth continues to live in `hardware/pocket_card/case/params.py`.
Where this spec and that file disagree after implementation, fix the file to
match this document, then re-derive dependent CAD.

## Measured starting point

Taken from `case_updated.blend` on 2026-08-03, for the record. Six DIFFERENCE
booleans on `shell_front`, all MANIFOLD solver:

| Pass | Surface | Depth below face | Remesh voxel |
|---|---|---|---|
| `bricktexture` | front, left column | 0.088 mm | 0.195 mm |
| `bricktexture.001` | front, right column | 0.068 mm | 0.489 mm |
| `bricktexture.002` | left wall (x=0) | ~0.00 mm (misses) | 0.195 mm |
| `bricktexture.003` | right wall (x=90) | 0.211 mm | 0.244 mm |
| `texts.001` | button labels + PuzzlePocket | 0.285 mm | — |
| `logo` | face centre | 0.213 mm | 0.2 mm bevel |

All four brick cutters share a vertex-identical base tile (verts at
x, y ∈ {0, 4, 6, 8, 10}) at object scale 0.5, so the tile is **5 × 5 mm in
every pass** — the pitch is already consistent. What differs is the Remesh
BLOCKS voxel, which is derived per object as
`max_bbox_dim / (2^octree × scale)` and therefore falls out of each strip's
length rather than any design intent. The voxel sets the **minimum mortar-line
width**, which is why the left field reads as fine linework and the right as
fatter lines from identical geometry.

Known defects in the current state, all superseded by this design:

- `bricktexture.002` reaches x = 0.059 while the left wall's widest tangent is
  x = 0.000, so it cuts essentially nothing. The left wall is bare.
- `bricktexture.003` spans y −2.2 → 47.9 against a 93 mm part, so the right
  wall's pattern stops mid-course at roughly half length.
- Fields terminate mid-brick at the part silhouette and ignore the plan corner
  radii.
- The left field reaches x = 9.2 while the d-pad's left cap spans x 6.7 → 14.7,
  so the field runs into that cap's station.
- Relief at 0.068–0.088 mm is far below what `PROCESS = "jlc_resin"` resolves.

## Intent

- **Goal:** a brick relief that reads as PuzzleScript at arm's length on the
  front, gives real purchase in the hand on the walls and back, and **wraps
  continuously** across the side-arc roll and the shell split.
- **Goal:** survive printing at `PROCESS = "jlc_resin"` without relying on
  post-process luck.
- **Not a goal:** texturing the flat bottom face. It stays clear, and relief
  fades out before reaching it, as it does today.
- **Not a goal:** changing how the device is held, its footprint intent, or any
  control position.

## Approach

### Relief direction: proud, not cut

Relief is **added outside** the nominal envelope, not cut into it. Three
reasons, in order of weight:

1. **Wall thickness.** JLC advise ≥ 0.8 mm for resin, 1.5 mm optimal.
   `WALL = 1.5` and `FACE_T = 1.5` are already at optimal; cutting 0.40 mm of
   mortar would take them to 1.10 mm. Adding keeps them at 1.5 mm.
2. **The lap.** `LAP_FRONT_T = WALL − LAP_T − LAP_CLEAR = 0.70`. Cutting
   0.40 mm there would leave 0.30 mm. Adding leaves the skirt untouched, which
   is what lets the pattern cross the split at all.
3. **Overcure.** Near the process floor, resin overcure closes a narrow recess
   more readily than it erodes a narrow ridge.

Note that proud-vs-cut does **not** affect grip: the two produce identical
relief. Grip is set by pitch and land-to-groove ratio, which is why the walls
and back get a coarser tile (below), not a different relief direction.

### Tile

One tile, defined once in `params.py` as a 5 × 5 sprite-style row list, shared
by both shells and both pitches. At the fine pitch this puts one pixel at
1.0 mm — twice clear of the process floor, so the minimum feature is printable
by construction rather than by measurement.

Declaring the grid also makes the stepping intentional. The current staircase
reads as an artifact because the Remesh grid is arbitrary and differs per
strip; on a declared 1 mm pixel grid it reads as design.

### Two pitches

| Zone | Pixel | Tile | Purpose |
|---|---|---|---|
| Front face | 1.0 mm | 5 mm | graphic read |
| Walls, back roll | 0.5 mm | 2.5 mm | grip |

Same sprite, half scale. Both stand proud off the same nominal surface, which
is what lets them meet across the roll without a step.

### Wrapping

Cut the pattern out of a constant-thickness outer skin rather than extruding
flat cutters per face:

```
proud_skin = outer_solid_offset_outward_by_relief.cut(outer_solid)
bond_skin  = outer_solid_offset_outward_by_relief.cut(
                outer_solid_offset_inward_by_root_overlap)
textured   = outer_solid.union(
                brick_prisms.intersect(bond_skin).cut(hard_keepouts))
```

so relief stays constant measured **perpendicular to the surface**, regardless
of the prisms' extrusion direction, and does not thin out as the side arc rolls
away from the extrusion axis.

In-plane foreshortening on the roll and at the `CASE_TOP_R = 7.5` /
`CASE_BOTTOM_R = 12.0` plan corners is **accepted**. Courses compressing round
a curve is what brickwork does. Revisit only if a print looks wrong; the
fallback is splitting the extrusion (radial in plan for the perimeter zone,
−z for the flat face, meeting near 45°).

The fine front-prism field is clipped to the nominal device footprint
`[0, BODY_W] × [0, BODY_H]`, even though the proud skin itself extends outside
that box. A prism wholly outside the nominal footprint can intersect only the
grown skin and create a tiny floating shard with no path back to the shell; 47
such fragments were measured during integration. They are projection
artifacts, not printable bricks. Bricks crossing the footprint boundary remain
clipped in place, so tile phase and the intended edge wrap are preserved.

#### Construction-only root overlap

Decided 2026-08-04, during front-shell integration.

The mathematical `proud_skin` remains the exact outside-only reference used to
measure relief thickness. It touches the nominal shell at a zero-volume
boundary. OCC does not reliably fuse hundreds of disconnected solids that only
touch that boundary: the first front integration produced 135 detached relief
solids, including 89 genuinely floating over final openings and 46 tangent but
unfused to the shell. A fuzzy union still left 48 solids.

Shell integration therefore uses `bond_skin`, which extends the root of every
brick `TEX_ROOT_OVERLAP = 0.05 mm` inside the nominal envelope along the same
surface-normal offset used for the proud skin. That 0.05 mm lies wholly inside
material the shell already owns, so it disappears into the boolean union: it
does not change the exterior, thin a wall, enter the cavity or lap void, or
alter the measured `TEX_RELIEF` height. Its only purpose is to give OCC real
shared volume so the textured shell is one printable solid.

Keep `proud_skin()` outside-only and keep its thickness/deviation tests
unchanged. `relief_for_zone` may request the root overlap for shell integration;
standalone geometry tests may continue to use zero overlap when they need the
pure proud skin.

Rejected alternatives:

- **Fuzzy union of tangent solids:** empirically unreliable; 48 solids remained.
- **Translate roots along −z:** only points inward on the flat front. It is
  tangential or wrong on rolled walls and failed OCC cleanup in the front probe.
- **Extrude deep roots into the enclosure:** would couple decoration to wall,
  cavity and lap geometry rather than using the existing parallel envelope.

#### Accepted deviation from constant thickness — the rib blend

Decided 2026-08-03, during implementation, after measurement.

`side_arc._rib_region` offsets its profile by a diagonal translation
`(Δy, Δz) = (+r, −r)` rather than along the surface normal. `_envelope`'s own
docstring already records this for the inward case ("slightly over-offset
through the blend… up to 1.95 of wall there instead of 1.50"). Under negative
inset the same shift makes the proud skin **thicker** than `TEX_RELIEF`:

| Surface | Peak thickness | Over |
|---|---|---|
| Back | 0.510 mm | +29% |
| Side walls | 0.477 mm | +22% |

Confined to `y ∈ [RIB_Y, RIB_Y2] ≈ [11.0, 23.3]`, across nearly the full 90 mm
width. A 3057-point sweep found 169 points outside ±0.02 mm and **every one of
them inside that band** — the skin is exact everywhere else.

**Accepted, not fixed.** The deviation is additive, so it costs nothing in wall
thickness; ~0.11 mm of extra relief is below what reads by eye; and
normal-offsetting `_rib_region` would change shared enclosure geometry both
shells depend on, for a sub-0.1 mm gain. `test_proud_skin_deviation_map`
regression-locks the current behaviour with its excluded band named explicitly,
so a change that widens or worsens it fails the suite.

Revisit only if a print shows it.

### Registration across the split

Both shells generate their pattern from one shared origin in `params.py`, and
the split line lands on a course boundary, so courses register across the two
separately printed parts. This is for visual continuity — with proud relief
there is no longer a wall-thickness reason to interrupt the pattern at the lap.

### Button keep-out

The button cluster sits in a **smooth island** at nominal, with brick relief
around it. This preserves `CAP_PROUD = 1.0` exactly — caps emerge from an
untextured panel, not from a raised field — and removes the current x 6.7–9.2
overlap with the d-pad's left cap.

### Silhouette clipping

Fields are clipped with `side_arc.clip_to_envelope` / `shaped_brick` so they
stop cleanly at the plan corner radii instead of terminating mid-brick.
`shaped_outer_band(z0, z1)` / `section_prism` provide wall-following geometry,
which is the correct fix for `bricktexture.002` rather than nudging its
position until it bites.

### Construction

Build the pattern as a **single unioned 2D face** and extrude once, so the
model takes one boolean rather than several hundred box booleans. Remesh BLOCKS
is dropped entirely — parametric geometry is already crisp, and the remesh only
quantised clean rectangles onto an accidental grid.

Adjacent `#` pixels are one connected land before extrusion and chamfering. In
the declared tile, each pair of identical four-pixel rows is therefore one
`4 × 2` brick, not two separately chamfered `4 × 1` strips. The one-pixel
mortar course and the one-pixel running-bond offset remain separate.

Brick tops get a 0.2 mm chamfer, matching the existing `logo` bevel, so proud
edges do not feel sharp in the hand.

## Parameters

New, in `params.py`:

| Name | Value | Basis |
|---|---|---|
| `TEX_TILE` | 5 × 5 row strings | DECIDED |
| `TEX_PIXEL_FINE` | 1.0 | DECIDED — front face |
| `TEX_PIXEL_COARSE` | 0.5 | DECIDED — walls, back roll |
| `TEX_RELIEF` | 0.40 | ASSUMED — coupon settles it |
| `TEX_ROOT_OVERLAP` | 0.05 | DECIDED — construction-only boolean bond |
| `TEX_TOP_CHAMFER` | 0.2 | DECIDED — matches `logo` bevel |
| `TEX_KEEPOUT` | 1.0 | ASSUMED — from cap collar OD, see below |
| `TEX_ORIGIN` | shared (x, y) | DECIDED — split registration |
| `TEX_BOTTOM_CLEAR` | ~1.9 | MEASURED — current fade-out band |

`TEX_RELIEF` is the one number that cannot be derived. See Coupon below.

`TEX_KEEPOUT` is measured radially from the collar OD, which is already
`CAP_FLANGE_OS = 1.1` beyond the head plus `COLLAR_CLEAR`. 1.0 mm gives the
smooth island a visible margin around each cap without eating into the fields;
tighten it only if the island reads as too dominant.

## Keepouts

### Hard

- No relief inside `TEX_KEEPOUT` of any button station collar.
- No relief on the flat bottom face; fade out `TEX_BOTTOM_CLEAR` before it.
- No relief inside the screen aperture or its chamfer.
- No relief over the USB-C opening, mute/power tip slots, or speaker grille.
- Relief must not reduce wall anywhere. Proud construction makes this trivially
  true, but `checks.py` should assert it rather than assume it.
- Visible relief and newly occupied space must not intrude into the lap
  engagement. `TEX_ROOT_OVERLAP` may enter existing skirt material only; after
  union it adds nothing to the interior or lap void.

### Soft

- Existing `texts.001` / `logo` engraving depths (0.285 / 0.213 mm) are out of
  scope here but sit below the same process floor. Worth revisiting once the
  coupon returns a number.

## Coupon

`TEX_RELIEF` is measured, not derived — the same discipline as
`COUPON_CLEARANCES`. Extend `coupon.py` with a texture plate: the tile at a
ladder of relief heights (0.20 / 0.30 / 0.40 / 0.50 / 0.60 mm) at both pitches,
each station engraved with its index. Print alongside the next clearance
coupon, judge in the hand, feed the winner back into `TEX_RELIEF`.

## Verification

Add to `checks.py`, against the exported STL:

1. Relief height is within tolerance of `TEX_RELIEF` at sampled points on each
   textured zone, measured perpendicular to the local surface.
2. Minimum wall under every textured surface is ≥ `WALL`.
3. No relief geometry within `TEX_KEEPOUT` of any button station.
4. No relief geometry within `TEX_BOTTOM_CLEAR` of the flat bottom.
5. Courses register across the split: pattern phase at the split line matches
   between `shell_front` and `shell_back`.
6. Envelope assertions updated to allow envelope + `TEX_RELIEF` in textured
   zones, so proud geometry does not read as an envelope violation.
7. Each integrated shell is exactly one valid solid; no tangent or floating
   relief components remain.
8. The screen aperture/chamfer, grille, edge slots and connector openings remain
   empty after relief union, not merely after the nominal shell was cut.
9. The root overlap is no deeper than `TEX_ROOT_OVERLAP`, while the exterior
   surface and measured relief height match the zero-overlap construction.

## Blender

`case_updated.blend` becomes a **consumer** of the CAD, not a source. The six
boolean modifiers on `shell_front` and their cutter objects come out; the shell
imports arrive already textured.

Cleanup while there:

- `texts` is not wired into any boolean — `texts.001` is. They differ only in
  the UNDO/ACTION region, so `texts` is an older revision, not a duplicate.
- `ring_surface_flair` is in no boolean — an unfinished pass.
- The `label_*` and `PuzzlePocket` FONT objects no longer drive `texts.001`,
  which is a frozen join. Text edits do not propagate.

## Out of scope, flagged

`LAP_FRONT_T = 0.70` is below JLC's 0.8 mm resin minimum, independent of
anything in this document. It is a short 1.2 mm skirt so it may well print
fine, but it is a free-standing 0.70 mm rim during printing. Worth a separate
look.

## Open questions

None outstanding. The coarse zone is a **half-scale copy of the same sprite**
(decided 2026-08-03) — one tile, two pitches. Revisit only if it reads badly at
2.5 mm on a real print.
