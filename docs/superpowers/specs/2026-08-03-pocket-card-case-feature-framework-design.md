# Pocket Card case: feature framework, screw joints, structural invariants

Date: 2026-08-03
Status: approved (option B of fix-vs-refactor discussion)

## Problem

Six screw sites on the back shell had daylight rings around the counterbores,
and `checks.py` said `all checks passed` while they did. Root causes found in
audit:

1. `SCREW_HEAD_H (1.5) == WALL (1.5)` — counterbore depth equals skin
   thickness, so the membrane under every Ø5.3 head pocket was 0.00 mm.
2. The Ø5.3 pocket was **wider** than the Ø4.4 PCB shoulder behind it, and the
   module-rib bore (Ø3.6) is wider than the shaft (Ø2.6) — open rings by
   construction, unfixable by boolean ordering.
3. Correctness depended on the union/cut order inside `build_back()`.
4. `side_arc.outer_back_z_at()` duplicated the envelope surface in hand
   trig; it diverged from the B-rep twice (belly scoop, arc flares).
5. No structural invariant (min wall / membrane) is asserted anywhere, and
   there is no model of free/fillable interior space.

## Design

Keep `params.py` as the single numeric truth and CadQuery as the kernel.
Add a thin feature layer; no new dependencies.

### 1. Surface queries raycast the real envelope (`side_arc`)

`outer_back_z_at(x, y)` keeps its signature but is reimplemented by
intersecting a vertical line with the cached, unfilleted envelope solid
(`shaped_brick(blend_seams=False)`) and returning the backmost hit. The
analytic trig goes away; any future curve (scoop, chin, new blends) is
automatically reflected in every consumer.

### 2. `joints.py` — one spec per screw joint

`ScrewJoint(x, y, kind)` with `kind ∈ {module, pcb}` derives all geometry for
the back shell from params:

- **Seat plane** `z_seat = max(outer z over head footprint) + SCREW_HEAD_H` —
  a flat seat regardless of the curved skin above it.
- **Land** (material): solid cylinder Ø`SCREW_HEAD_D + 2·(clear + LAND_WALL)`
  from below the skin up to the joint's functional top (module: rib top at the
  module PCB back; pcb: shoulder top at the controller PCB back). The land is
  what guarantees membrane — pockets are always cut into deliberately added
  material, never into bare floor.
- **Voids**: head pocket Ø`SCREW_HEAD_D + 2·clear` from outside the skin down
  to `z_seat`; shaft Ø`SCREW_CLEAR_D` through everything; for module joints a
  **stepped bore**: Ø3.6 (post-tip entry) only in the top of the rib, shaft-
  width below, so at least `MIN_MEMBRANE` of solid ring remains above the seat.

New params: `MIN_MEMBRANE` (0.8), `LAND_WALL` (1.2). Existing
`module_support()` ribs and `pcb_shoulders()` are absorbed by joint lands.

### 3. Fixed build pipeline (`shell_back.build_back`)

```
tray  = lid()                        # envelope band − cavity + rim
body  = tray ∪ all material          # fences, rib strip, pads, joint lands
body −= all voids                    # joint pockets/shafts/bores, USB
body  = clip_to_envelope(body)
```

Material always unions before any void cuts. Because lands are sized against
the pockets by construction, order within each group no longer matters.

### 4. Invariant checks (`checks.py`)

Per joint, point-classification probes on the built solid:

- **pocket open**: void from just inside the skin to the seat, across the head
  footprint;
- **seat present**: solid ring behind `z_seat` between shaft and head radius;
- **membrane**: that ring stays solid for ≥ `MIN_MEMBRANE` of depth;
- **shaft open**: void along the axis through the tray.

These fail loudly; the old checks only looked at named clearances and missed
all of this.

### 5. Free-space report (`free_space.py`)

Voxel-sample (~1.5 mm grid) the interior of the closed shells, subtract
component keepouts (module, controller PCB, cell, driver, USB path, caps),
and report fillable volume per region plus per-slice PGM maps in `out/`.
Answers "can I put a boss/rib here" before layout changes.

## Out of scope

Front shell keeps its current structure (its bosses/collars have no reported
defects); it can adopt joints later. Split-lip redesign is a separate task.
