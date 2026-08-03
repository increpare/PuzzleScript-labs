# Pocket Card: center-gap speaker / IO-chip swap (experimental)

**Status:** design approved for an experimental CAD branch  
**Date:** 2026-08-03  
**Supersedes (for this experiment only):** bottom-right grille + through-board
driver notch in
`2026-07-31-pocket-card-mechanical-controls-design.md` §Audio / face layout.
Mute/power edge XY and the rest of that document stay in force unless noted.

## Goal

See what the console looks like with the speaker grille in the empty face field
between the direction cluster and Undo/Action, by actually swapping that volume
with the MCP23017 (U1) that already occupies the center of the controller PCB.
Deliver regenerable shell + PCB geometry on a feature branch — not a production
respin.

## Decisions

| Topic | Choice |
|---|---|
| Grille target | Center gap between d-pad and Undo/Action (~x 42.6, y 68.8) |
| Driver stack | On the PCB front under a ~1 mm face blister (not through the board into battery space) |
| Mute tip | Stays bottom-right (does **not** follow the grille) |
| Power tip | Unchanged (far left) |
| Scope | Paired shell + PCB explore on a branch; routing may stay approximate |
| Out of scope | Production gerbers, full re-route, merging to master before visual sign-off |

## Why not “above the battery” through the board

In plan view the center gap sits over the cell’s right half. A through-board
driver notch there would fight the pouch keepout, swell allowance, insulation,
and retaining fence. That path is rejected.

The safe reading of “above the battery” is: grille and driver in the *face*
band over that plan region, with the cell left alone behind a solid PCB.

## Stack

Current cavity face→PCB is 3.0 mm (`PCB_FRONT_Z - FACE_T`); driver is 3.5 mm
(`DRIVER_T`) → 0.5 mm short under a flat face.

Caps already stand 1.0 mm proud (`CAP_PROUD`). A face blister of ~1.0 mm gives
4.0 mm of room (> 3.5) and matches the existing crown budget. Only 0.5 mm is
mechanically required; the rest is visual + mesh/adhesive.

```
z=0        outer face (blister crown locally at −0…−1)
z≈−1.5     face inner (flat); blister pocket deeper under grille
z≈−4.5     PCB front — driver rests here
z≈−6.1     PCB back
           cell unchanged behind the board
```

## Hard constraint: blister vs buttons

**No part of the face blister may impinge on any front control** — direction
caps, Undo, Action, Reset, or Menu. That means:

1. In plan, the blister’s outer plan (including draft/fillet) stays clear of
   every cap flange / collar outer diameter by a decided margin (start at
   ≥ 0.5 mm; tighten only with evidence).
2. In z, the blister’s rise must not collide with a cap’s travel or flange
   underside at the rest position.
3. A dedicated check asserts (1) and (2) on the built solid — same class of
   invariant as the existing driver-vs-collar checks. Visual inspection alone
   is not enough.

If the vertical 14×20 pill plus blister margin cannot clear the gap (~19.8 mm
between dir and Undo, ~2.9 mm per side to the driver body alone), shrink the
blister plan (not the buttons) or rotate the pill — do not borrow button space.

## Layout targets (starting numbers)

These are seeds for `params.py`, not frozen millimetres:

| Item | Target |
|---|---|
| `GRILLE_X`, `GRILLE_Y` | ~42.6, ~68.8 (gap centre, aligned with `DIR_CY`) |
| Driver orientation | Vertical pill 14×20 (same as today) |
| `FACE_BUMP_H` | 1.0 mm (need ≥ 0.5) |
| Blister plan | Driver body + small margin, inside the button keepout |
| U1 (MCP23017 SOIC-28W) | From (45, 72) into the freed BR field; seed near old grille ~(76, 80), tune vs Reset/mute courtyards |
| `PCB_DRIVER_NOTCH_*` | Removed / unused — no corner dip |
| Driver backstop-through-notch | Removed / idle |
| Mute / power | Unchanged XY |

U1 today already sits at (45, 72), under the target gap — this is a literal
swap with the BR driver, not a search for new real estate.

## Work units

1. **Params** — new grille/bump/driver-seat constants; retire notch-driven
   stack assumptions for the BR corner.
2. **Front shell** — center blister + grille; shallow driver recess to PCB
   front; no BR speaker chamber.
3. **PCB** — delete notch from outline; place driver keepout/land under the
   gap; move U1 (+ local decoupling) to BR; leave B.Cu connectors and edge
   slides.
4. **Checks** — blister↔button clearance (hard); driver seat clearance;
   U1 vs Reset/mute; battery keepout still clean; drop or rewrite notch-era
   assertions.
5. **Outputs** — regenerate `shell_front` / `shell_back` / placed PCB preview
   on the feature branch for eyeballing.

## Non-goals (this branch)

- Moving mute under the new grille (explicitly deferred).
- Reclaiming BR for anything other than U1 + necessary passives.
- Changing `BODY_T`, battery pack, or module stack.
- Production-ready routing / JLCPCB upload from this experiment.

## Success criteria

- Face STL reads as: grille in the center gap, IO in the old speaker corner.
- Blister clears every front button by the check above.
- Driver fits under the blister without a board notch and without invading
  the cell.
- Existing non-conflicting checks still pass; notch-specific checks are gone
  or updated.
- Owner can decide keep/revert from STLs without a fab order.
