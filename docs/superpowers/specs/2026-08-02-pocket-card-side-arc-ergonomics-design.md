# Pocket Card — Side-Arc Ergonomics (Volume Reduction)

Date: 2026-08-02  
Status: agreed in design session.

## What this amends

This document is authoritative for **outer-shell side-arc carving** and related
**controller PCB bottom outline** freedom. It does not reopen the stack stackup
(`BODY_T`, cell, SKQG height), face control layout, or module orientation.

| Prior topic | Status |
|---|---|
| Enclosure is a flat brick + small edge chamfer | **Amended** — side arcs carve volume from the brick |
| `EXTRA_BOSSES` / lower PCB posts as fixed sites | **Deferred** — re-place after outer carve settles |
| Controller PCB outline (~2 mm corner fillet) | **May change** at the bottom if it frees carve depth |
| Module Ø3.2 / 78×42 mounts | **Unchanged** |
| Cell, USB, tip slots, grille, min wall | **Unchanged** hard keepouts |

Numeric truth continues to live in `hardware/pocket_card/case/params.py`.
When this spec and that file disagree after implementation, fix the file to
match this document, then re-derive dependent CAD.

## Intent

- **Goal:** ergonomic **volume reduction** at the gripped left/right edges so
  the device feels closer to a GBA squat curve in the hand.
- **Not a goal:** making the centre thicker than today’s `BODY_T` (~13.3 mm).
  The midsection stays at (or below) the current brick depth; material is
  **removed** from the side/back corners only.
- **Silhouette:** same XY footprint (no mid flare). Flat front remains; outer
  sides/back gain a squat curved profile by boolean removal.
- **Extent:** **full length** along Y (through the bottom). No mid-band-only
  scoops; no faded crescent slices.
- **Aggressiveness:** continuous cylindrical arcs, as deep as keepouts allow
  (left limited by cell back-flat; right can go harder).
- **Wrap:** shaped **solid envelope**, then hollowed with `WALL` preserved so
  the curve wraps the split without punching holes through side walls.

## Approach

**Extruded XZ profile** (straight edges + B-spline quarter-corners), then
hollow with a matching inset profile. Implemented in `side_arc.py`.

1. Build a closed XZ silhouette: flat front, vertical sides, back corners as
   B-splines through quarter-circle samples (left/right radii may differ).
2. Extrude full length along Y (`SIDE_ARC_Y0`…`Y1`, normally the whole body).
3. Hollow with the same silhouette inset by `WALL` (radii reduced by `WALL`) so
   side walls stay closed — never boolean-cut crescents out of a hollow brick.
4. Clip into front/back Z bands; split line stays planar.

Rejected / failed attempts:

- Growing a mid “belly” past `BODY_T`.
- Boolean crescents on a hollow shell (punches mid-side holes).
- OCC `radiusArc` / `tangentArc` long-way scoops (same holes, deeper).
- Fillets-only soft edges (insufficient GBA read).

## Keepouts

### Hard (carve must respect)

- Min wall after cut ≥ `WALL` (1.5 mm) over cavity / cell / fence.
- Cell volume and fence (`BATT_*`, `CELL_*`, swell).
- Module mount posts that pass the module’s own Ø3.2 holes (78×42 grid).
- USB-C, mute/power tip slots, speaker grille — local carve depth clamped so
  function and openings stay valid.
- Antenna keepout: no new metal; plastic wall thinning only within min wall.

### Deferred (not carve constraints)

- `EXTRA_BOSSES` and other **controller-side** posts/shoulders we invented for
  the lower half.
- For the carve pass: **ignore current XY** of those sites; do not shrink arcs
  to protect today’s (4.5, 88) / (86, 89) positions.
- After the outer shell looks right: re-place fewer/better posts where wall
  stock remains; update PCB holes to match.
- Case remains openable with screws; exact count/sites are a follow-up.

### Optional PCB bottom rounding

- Controller outline may grow **bottom** corner radii and/or soft south-edge
  relief (today: ~2 mm uniform fillet from `pcb_outline_wire`).
- Allowed only where copper allows: slides, tip chambers, mounts that remain,
  cell fence, rear GH connectors, pad copper.
- Purpose: free lower side-wall stock so side arcs can go deeper — skip if it
  does not buy carve depth.

## Params (names; values tuned on first print)

Suggested `params.py` knobs (exact names flexible):

| Param | Role |
|---|---|
| `SIDE_ARC_R_L` / `SIDE_ARC_R_R` | Peak cutter radii (or equivalent ellipse axes) |
| `SIDE_ARC_Y0` / `SIDE_ARC_Y1` | Active carve span along Y |
| Fade lengths | Blend to near-zero at top/bottom |
| `SIDE_ARC_MIN_WALL` | Floor (= `WALL` unless deliberately raised) |
| `PCB_BOTTOM_R` (optional) | Bottom outline radius / relief |

Start maxed under keepouts; back off if SLA walls feel fragile.

## Implementation touch-points

| Area | Work |
|---|---|
| `params.py` | Side-arc + optional PCB-bottom knobs |
| `shell_front.py` / `shell_back.py` | Shared outer carve helper; apply to both |
| `shell_back.pcb_outline_wire` | Bottom rounding if needed; regen DXF → KiCad |
| Lower bosses / PCB mounts | Strip or leave inert for carve pass; re-place later |
| Order STLs | Regen `shell_front` / `shell_back` for feel print |

### Verify

- Cross-sections at mid, top fade, bottom fade — volume removed, centre ≤ brick.
- Wall thickness vs cell / cavity ≥ min wall.
- USB / tip / grille still function.
- PCB outline + place check only if bottom rounding is used.
- First print is a **feel coupon** for R / fade — tune params, don’t redesign the stack.

### Out of this change

- Final lower post layout (follow-up).
- Thinner cell or stack changes.
- Full loft rewrite of the outer envelope.

## Order of work

1. Implement side-arc carve on both shells (deferred lower posts).
2. Optionally round PCB bottom if it unlocks deeper arcs.
3. Feel-print and tune radii / fade.
4. Re-place lower screw posts and update PCB holes.

## Branching

Implement on a dedicated git branch (not direct-to-`master`) so shell/PCB
churn stays reviewable against the current brick baseline.
