# PuzzleScript Handheld Case Blockout Design

Status: approved concept blockout, pre-hardware.
Date: 2026-07-07.

## Summary

This spec fixes the concept-blockout geometry for the final 5-inch PuzzleScript
handheld case: a split-side landscape body with a fan-shaped puzzle control
cluster on the right, Menu below the D-pad on the left, a front-ported speaker,
and a sculpted-grip profile. It resolves the split-side versus controls-under
question from the designer handoff in favor of split-side (Candidate A) and
pins first-pass millimeter coordinates for every front-face and top-edge
feature.

This is blockout, not mechanical engineering. Every dimension here is intended
to be validated with the companion 1:1 printable sheet and a foam/cardboard
mockup before any CAD or shell printing. Known-unverified items are listed in
Open Risks.

Decisions were made interactively against scale drawings on 2026-07-07, with
these session-level choices: final 5-inch device only (no 7-inch bench shell),
average-adult-hand ergonomic targets, and comfort prioritized over pocket
footprint.

## Decisions And Rationale

- Layout: split-side (handoff Candidate A). Comfort-first mandate; hands
  support the screen from both sides with the grip line at the center of
  gravity. Candidate B (controls under) rejected as cantilevered and
  wrist-flexing; Candidate C (center utility strip) rejected as front-face
  clutter on a translucent shell.
- Right cluster: fan geometry. Action sits at the right thumb's resting point,
  Undo one inward flick away, Restart directly below Action. Undo is treated
  as the second-most-pressed button (Sokoban-style play is
  move-move-undo-undo), which is why it gets the closest secondary position.
  The one-large-plus-two-support triangle deliberately does not read as an
  `ABXY` cluster.
- Menu: bottom-left below the D-pad, GBA Start/Select position, as a small
  angled pill. The left face has only the D-pad, so a pill there cannot be
  confused with play buttons; shape coding (pill versus round caps) does the
  rest. This also keeps the right side at exactly three play buttons. A
  bottom-right Menu was considered and rejected as a fourth right-side button.
- Speaker: front-firing, ported. Grille perforates the lower front band; the
  driver mounts on an internal bracket with a sealed chamber that borrows
  unused case depth behind the display module. Sound fires at the player and
  cannot be blocked by palms or a tabletop. Rear-firing chamber is the
  documented fallback if the ported version sounds thin in physical testing.
- USB-C: top edge, centre-left (over the left-grip/screen seam). Top-center is
  reserved as display-FPC keep-out; centre-left also sits over deeper internal
  volume. Bottom exit rejected per handoff (cable fights handheld play).
- Body profile: sculpted grip bulges, 31 mm at grips tapering to a 22 mm waist
  behind the display. Palms fill the bulges; the bulges are where the split
  battery and speaker chamber want volume. Uniform 26 mm slab remains a valid
  cheaper geometry for the first throwaway test shells.

## Geometry

All front-face coordinates are millimeters from the top-left corner of the
face, X rightward, Y downward.

Body:

- Face outline: 228 x 105 mm, corner radius 14 mm.
- Depth: 31 mm at grip bulges, 22 mm waist behind the display, blended.
- Estimated weight: roughly 300 g, center of gravity on the grip line.

Display:

- Lens reference 121 x 77 mm (Waveshare 5-inch DSI class), centered: lens
  spans X 53.5-174.5, Y 14-91.
- Visible area reference 109 x 65.8 mm, centered inside the lens.
- Side control fields: 53.5 mm each. Bands above/below lens: 14 mm each.

Controls:

| Control | Spec                          | Center (X, Y) |
|---------|-------------------------------|---------------|
| D-pad   | 26 mm cross, 8 mm arms        | (27, 52.5)    |
| Action  | O16 mm, gently concave cap    | (202, 44)     |
| Undo    | O12 mm, convex cap            | (187, 60)     |
| Restart | O11 mm, convex cap            | (205, 67)     |
| Menu    | 13 x 4.5 mm pill, -20 deg tilt| (27, 90)      |

Cluster spacing (cap edge to cap edge): Action-Undo 7.9 mm, Undo-Restart
7.8 mm, Action-Restart 9.7 mm. Minimum acceptable in printed shell material is
assumed 7 mm until measured.

Cap differentiation: Action concave (rest-and-press), Undo and Restart convex;
distinct cap colors; icon plus word labels next to each button (undo arrow +
UNDO, restart arrow + RESTART). Restart is a full-size honest button, never
recessed, per the handoff. Final icon language is deferred to shell graphics.

Top edge (X along the same axis):

- Power/Sleep: 10 x 4.5 mm pill at X ~23.
- USB-C: at X ~68 (centre-left, clear of FPC keep-out spanning roughly
  X 108-140).
- Volume: -/+ rocker 18 x 4 mm at X ~201.

Bottom, left, and right edges carry no features (clean grip surfaces).
microSD/TF is internal, service-only; USB mass storage is the user-facing file
path.

Speaker grille: dot perforation centered at X 114 in the lower front band
(Y ~93-100), sized to the chamber mouth.

## Internals (Volume Allocation)

- Battery: split 1S pack, two roughly 36 x 56 x 10 mm cells paralleled,
  ~10 Wh total, one per grip bulge. Balances mass into the palms.
- Main PCB: behind display center.
- Speaker: O15-20 mm micro driver, 4-6 mm deep, front-firing on a bracket at
  bottom-center; sealed chamber ~15 cm3 extending rearward and up behind the
  display module.
- Haptic LRA: right grip, near the thumb cluster.
- RGB LEDs: both grips, aimed into the translucent shell walls.
- Button PCB or flex daughterboards under each control field, per handoff
  mounting assumptions.

## Construction

- Two shells, front and rear, perimeter seam at the widest profile line.
- M2.5 standoffs, 6-8 screws entering from the rear.
- Front shell: display frame, button wells, speaker grille. Prints face-down
  flat.
- Rear shell: grip sculpt, battery bays, chamber half, LED mounts.
- Translucent (smoky/frosted) material; internal routing, cable dressing, and
  PCB faces are visible product surfaces.

## Open Risks (Carry To Physical Testing)

- Speaker: whether ~15 cm3 ported chamber is loud/full enough. Fallback:
  rear-firing chamber.
- Undo-to-screen clearance: Undo cap edge is ~6.5 mm from the lens edge;
  verify the printed button well leaves enough frame material.
- USB-C connector overhang and bend radius versus the actual display FPC exit
  on the chosen 800x480 panel.
- Real battery pack dimensions and swelling clearance versus the 36 x 56 x 10
  assumption.
- Button cap height, travel, force, and wobble in printed wells.
- All display-module mechanical numbers are Waveshare-reference values until
  the final panel is chosen (handoff mounting assumptions apply).

## Validation Plan

1. Print the companion 1:1 sheet at 100% scale and verify with the printed
   calibration ruler:
   `docs/superpowers/notes/2026-07-07-handheld-case-blockout-1to1.svg`
2. Laminate onto foam-core or cardboard stacked to the profile (31 mm grips,
   22 mm waist), using the printed profile section as a template.
3. Add dummy button caps at approximate heights; add battery-weight ballast
   (~35 g per grip) in the marked bays.
4. Run the handoff playtest loop: 10-15 minutes of Sokoban-style input
   (move, move, action, undo, undo, restart, menu, repeat).
5. Log thumb extension, grip changes, wrist angle, support-finger tension, and
   accidental presses. Test small, medium, and large hands if available.
6. Feed measured corrections back into this spec before any CAD work.

## Sources

- Designer handoff: `docs/superpowers/notes/2026-07-06-handheld-designer-handoff.md`
- Parent hardware design: `docs/superpowers/specs/2026-07-03-puzzlescript-handheld-design.md`
- Session blockout sheets: `.superpowers/brainstorm/349-1783376289/content/`
  (not committed; superseded by this spec and the 1:1 printable)
