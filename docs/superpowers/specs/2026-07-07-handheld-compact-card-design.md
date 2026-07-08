# PuzzleScript Card: Compact Handheld Design

Status: approved concept, pre-hardware. Supersedes the 5-inch form factor.
Date: 2026-07-07. Amended 2026-07-08: display grown to 4.3-inch 800x480 and
body to 108 x 102 mm to resolve the control-band packing conflicts surfaced
by the blockout tool; speaker changed to a piezo disc under the battery;
Menu pill moved off the D-pad's down-press axis, rightward against the
battery boundary. Amended 2026-07-08b: body grown to **120 x 110 mm** after
confirming the Waveshare WS24773 **no-touch display envelope** (105.42 x
67.07 mm — not the 112.4 x 75.1 mm touch-stack outline).

## Summary

This spec pivots the PuzzleScript handheld from the 5-inch comfort-first
split-side body to a radically compact card: a ~120 x 110 x 9 mm translucent
near-square card (Playdate-proportioned) with a 4.3-inch 800x480 IPS display
up top and a DMG-style control band below. The ESP32-P4 (32 MB PSRAM), the on-device
compilation model, the library/product contract, and the entire 800x480
display contract from the parent design carry over verbatim. The device is
built on a single-sided-PCB architecture (every component on the front face of
one board, thin flat rear shell) — the same trick that makes the Arduboy a
card.

The case blockout spec
`docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md` is
superseded by this document. Its fan-cluster logic, hardware identity work,
and validation method are inherited; its split-side geometry, sculpted grips,
split battery, and 31 mm profile are retired with the 5-inch form factor.

Decisions were made interactively on 2026-07-07. This is concept blockout plus
architecture, not mechanical engineering: dimensions are to be validated with
a 1:1 printable and a foam mockup before CAD, and all display-module numbers
are reference-class until a specific panel is chosen.

## Decisions And Rationale

- Form factor: card, not sculpted handheld. Arduboy-inspired flat slab,
  grown until the screen stops being the compromise. A true Arduboy-size card
  (1.5-1.8 inch panel) was rejected: at that scale p90 corpus levels drop
  below ~2 mm cells and the whole-level contract dies of illegibility, not of
  pixels.
- Display: 4.3-inch 800x480 IPS, DSI (amended 2026-07-08 from 4.0-inch).
  Same resolution, so the entire validated display contract — the handheld
  report's 0 degraded fits at 800x480, the integer x5 scaler, the 34x13 text
  screens — carries over with zero renderer or corpus re-validation, and the
  ESP32-P4 DSI bring-up work is reused. 4.3-inch is the commodity
  Raspberry-Pi-class panel size, so sourcing improves over 4.0-inch. The
  extra ~8 mm of card width lands almost entirely in the control band's
  battery gap, which is what resolves the battery/Undo overlap. Physical
  cells: p90 (21x17) levels get ~3.0 mm cells, median (11x9) levels ~5.9 mm,
  text chars ~2.8 mm wide. All readable.
- Product fit: the card replaces the 5-inch device. Everything is
  pre-hardware, so the pivot costs documentation only. One device, one PCB,
  one case; "radically compact + ESP32-P4" is the product identity.
- Thickness: ~9 mm uniform. The single-sided architecture makes thickness
  cheap (the binding battery constraint becomes face area, not Z). 12 mm with
  a full cell behind the panel (10 h+ battery) and a ~7 mm dome-button dare
  were both considered; 9 mm with honest battery numbers won.
- Layout: controls under the screen (DMG/Playdate style), not beside.
  Controls-under was rejected for the 5-inch because its 121 mm module mass
  sat above the gripping hands; at ~100 g total that argument is void. The
  near-square card is a one-hand-cradle / two-thumb object. This must still be
  confirmed by playtest, not argument (see Validation).
- Battery contract: ~2.5-3 h play, phone-style charging, play-while-charging
  supported. This deliberately replaces the parent spec's 6-8 h target, which
  was written for the larger device. The 4.3-inch amendment plus the piezo
  speaker restores the full-width battery strip (~32 x 30 x 4 mm, ~2.5 Wh)
  that the original 4.0-inch band could not actually hold. Growing the card
  further or going to 11 mm (10 h+) were considered and declined to keep the
  thin card.
- Speaker: piezo disc glued to the front shell under the battery zone,
  firing through the front 5x5 grille (amended 2026-07-08). A dynamic micro
  driver's footprint competes with the battery for band area regardless of
  which shell it fires through, while a ~0.5 mm piezo lives in the shell
  clearance layer in front of the battery at zero footprint cost.
  PuzzleScript's sfxr-style blips are a forgiving piezo load. Documented
  fallback if the piezo sounds too weak: a 15 x 11 mm dynamic driver below a
  shortened (~22 mm) battery, costing ~0.7 Wh.
- MCU: ESP32-P4 with 32 MB in-package PSRAM, unchanged. The P4 was never the
  size constraint: no radio, small module, and the 4-inch panel still wants
  the DSI path the firmware already targets. Track 0 gates from the parent
  spec still apply.

## Geometry

All front-face coordinates are millimeters from the top-left corner of the
face, X rightward, Y downward.

Body:

- Face outline: 120 x 110 mm, corner radius ~9 mm.
- Depth: 9 mm uniform. No grips, no bulges.
- Full-face cover lens: one flat ~1 mm sheet (glass or acrylic) spanning the
  whole front, printed opaque on the underside except the screen window.
- Estimated weight: ~95-105 g (panel module + PCB + cell + shells + lens;
  verify with a BOM mass rollup before ballast is cut).

Display:

- 4.3-inch 800x480 IPS (Waveshare WS24773 QLED no-touch), active area
  reference 95 x 54 mm (0.119 mm/px), centered in the display module:
  active area spans X 12.5-107.5, Y 10-64.
- Display module outline **105.42 x 67.07 x 2.9 mm** (Waveshare "Display
  Dimensions" for 43H-800480 no-touch). The **112.4 x 75.1 mm** outline is
  the touch-stack SKU — do not use it for the no-touch blockout.

Control band (Y ~72-105):

| Control | Spec                                   | Center (X, Y) |
|---------|----------------------------------------|---------------|
| D-pad   | mascot cap, ~26 mm tip-to-tip          | (22, 87)      |
| Action  | O14 mm, gently concave cap             | (89, 83)      |
| Undo    | O10 mm, convex cap                     | (75, 96)      |
| Restart | O10 mm, convex cap                     | (92, 102)     |
| Menu    | ~11 x 4 mm pill, angled                | (30.5, 106)   |

The fan cluster carries over from the blockout spec with its rationale
intact: Action at the resting thumb, Undo one inward flick away as the
second-most-pressed button, Restart below Action, full-size and honest. Cap
diameters shrink to ~0.85 scale, but the spacing is re-solved rather than
scaled, because cap-edge gaps must stay >= 7 mm — thumbs did not shrink with
the case. Resulting gaps: Action-Undo 7.1 mm, Undo-Restart 8.0 mm,
Action-Restart 7.2 mm. Cap coding unchanged: Action concave, Undo/Restart
convex, distinct colors, no glyphs in v1.

Clearances: the Menu pill sits right of the D-pad's down chevron (moved
2026-07-08 so it is not on the down-press axis), with its rotated footprint
~0.7 mm clear of the battery zone boundary at X 37; the circle-model
D-pad-to-Menu gap is ~2.3 mm. A left-edge Menu was considered and rejected
(that edge is palm-contact in the cradle grip); a top-edge shoulder position
remains a fallback if the mockup still shows accidental presses. The Restart
cap sits ~4 mm from the bottom face edge, inside the corner-radius arc.

Edges:

- USB-C: top edge, center-left, clear of the display-FPC keep-out at top
  center. Mid-mount receptacle (a standard 3.3 mm-tall receptacle does not
  fit the stack).
- Power/Sleep: small pill, top edge right.
- Volume: low-profile rocker, right edge near the top corner.
- Bottom and left edges clean. microSD internal, service-only; USB mass
  storage is the user-facing file path.

Speaker grille: 5x5 hole grid over the piezo disc in the battery field
(~X 53, Y ~99).

## Architecture: Single-Sided PCB

One ~116 x 106 mm PCB spans the card. Every component mounts on the front side:

- panel, framed over the PCB, DSI FPC folded back to its connector
- battery pouch cell (band gap, see below)
- low-profile tact switches under sculpted caps; D-pad is a one-piece rocker
  on a shallow pivot dome
- mid-mount USB-C
- ESP32-P4 module, charger/fuel-gauge PMIC, piezo driver circuit
- haptic LRA at the right edge of the band near the cluster
- RGB LEDs firing sideways into the translucent shell walls

The rear shell is a thin flat translucent sheet; the PCB back — routing,
silkscreen, test pads — is a visible product surface and is designed as one.
Debug pads (JTAG/UART/boot/reset) live on the PCB back.

Z-stack budget: front shell + lens ~1.8, component/panel plane ~2.5-3.0,
PCB 1.2, rear shell 1.0, remainder clearances → ~9 mm.

## The Band (Battery / Piezo / Haptics)

The gap between the D-pad field and the Undo cap is ~35 mm wide (X ~35-70)
after the 4.3-inch amendment, and is the tightest real estate in the device.
Packing:

- Battery: pouch cell ~32 x 30 x 4 mm, ~2.5 Wh, at X 37-69, Y 73-103. The
  cell cannot sit under the panel (occupied) or under buttons (switches need
  the PCB face), so face area is the battery budget.
- Piezo: ~O16-20 x 0.5 mm disc glued to the inside of the front shell in the
  clearance layer, in front of the battery, under the 5x5 grille at
  (~53, 99). It occupies no PCB face area.
- LRA: right edge of the band near the cluster (~X 96, Y 87).

The 2026-07-08 amendment resolved the original battery/Undo and
battery/speaker overlaps (the 2026-07-07 zones were drawn verbatim and
collided; the blockout tool's warning list documented this). Fallback if the
piezo is too weak: 15 x 11 mm dynamic driver below a battery shortened to
~22 mm (~1.8 Wh). Fine partition is still settled in PCB layout.

## Power

- Play budget ~1.0 W: display ~0.65 W dominant (4.3-inch), ESP32-P4 ~0.2 W
  average with idle-between-moves, remainder small. Parent-spec power
  disciplines (redraw only on change, dim in menus, LP core owns button scan
  and wake) apply unchanged.
- ~2.5 Wh → ~2.5 h play. Charge ~1 h at 5 V / 1.5 A. Play-while-charging
  supported.
- Sleep on power-pill tap or idle timeout; instant-on wake preserved.
- The runtime figure leans on the ~0.65 W display estimate; measuring the
  real backlight draw of the chosen panel is a required validation step.

## What Carries Over Unchanged

From `2026-07-03-puzzlescript-handheld-design.md`: the display contract
(whole level always visible, integer x5 scaler, flickscreen/zoomscreen
viewport rules, too-large honesty screen), the firmware layer plan, Track 0
memory/portability gates, the library/product contract, PuzzleScript
semantics, save/USB/error-handling behavior, and the corpus-first software
validation list.

From the superseded blockout spec: hardware identity — the D-pad cap is the
mascot (now ~26 mm), the mascot is molded inside the rear shell and rim-lit
by the case LEDs, the speaker grille is the 5x5 sprite unit, Action/Undo/
Restart caps stay plain. The wall-brick relief loses its grip bulges and
moves to the rear shell as a full-back running-bond texture, still
grip-functional in a cradle hold. The considered-and-rejected list of the
blockout spec (scrub wheels, NFC tiles, e-ink, separated chevron keys, boot
splashes) remains binding.

## Considered And Rejected (This Spec)

- 4.0-inch 800x480 (the original 2026-07-07 choice): amended to 4.3-inch
  after the blockout tool showed the 100 mm-wide band cannot hold the specced
  battery beside the Undo switch (usable gap ~27 mm vs the 32 mm battery).
  Same resolution, more commodity panel class, better cell legibility.
- Dynamic speaker in the band (front- or rear-firing): the driver's PCB
  footprint competes with the battery for band area regardless of which
  shell it fires through. Kept only as the documented piezo fallback.
- True Arduboy card (85 x 54 mm, 1.5-1.8 inch panel): breaks the whole-level
  contract physically (p90 cells < 2 mm) or the color identity (mono OLED).
- 3.5-inch 480x320 SPI panel: simpler electronics, but forks the display
  contract, requires corpus re-validation, and lands within ~0.4 mm of the
  same cell sizes as 4.0-inch 800x480 anyway.
- 2.4-2.8-inch 320x240 (Game Boy Micro class): under the x5-integer scaler
  the p90 level gets only 10 px tiles (~1.8 mm cells at 2.8 inch) — squint
  territory.
- Controls-beside landscape card (135 x 70 mm) with a bottom battery strip:
  better battery (~5 Wh) but the squarer controls-under card won on form.
- 12 mm body with the cell behind the panel (10 h+), 100 x 110 body (5-6 h),
  ~7 mm dome-button floor (< 3 h, flexy, Arduboy-feel buttons): all declined
  in favor of the pure 9 mm square with the ~3 h contract.
- 5 mm Arduboy-equal thickness: physically requires giving up the backlit
  LCD (OLED burn-in and e-ink refresh were already rejected in the parent
  spec) and the multi-hour battery. Not a card we can build honestly.

## Open Risks (Carry To Physical Testing)

- D-pad rocker dome depth at 9 mm: shallow pivot may hurt diagonal/corner
  press feel, and the mascot cap sculpt compounds it. Print-and-play early.
- Piezo loudness and timbre versus a dynamic driver: validate early with the
  actual sfxr sound set on a bench piezo against the printed shell. Fallback
  (dynamic driver, shorter battery) is documented in the band section.
- Structural stiffness: a 120 x 110 x 9 card can flex and creak. Plan:
  lens bonded to the front shell, PCB as a structural member. Verify
  physically.
- Panel sourcing: WS24773 / 43H-800480 QLED no-touch chosen; **105.42 × 67.07 mm**
  display envelope and ~0.65 W backlight budget **confirmed 2026-07-08** from
  Waveshare datasheet (owner sign-off). Optional caliper/backlight measure when
  parts arrive.
- Thumb reach-up ergonomics of controls-under on a light square card:
  argued from mass, must be confirmed by the playtest loop.
- Menu is no longer on the D-pad's down-press axis (2026-07-08) but still
  sits ~2-4 mm from the D-pad field; verify accidental Menu presses during
  rapid D-pad play in the mockup loop. Fallback: top-edge shoulder position
  at the left corner, shape-coded against Power.
- Mid-mount USB-C requires a PCB cutout and adds layout constraints near the
  FPC keep-out.
- Battery swelling clearance and real pouch dimensions versus the
  32 x 30 x 4 assumption; swelling now presses against the piezo shim.

## Validation Plan

1. Print the committed 1:1 sheet at 100% scale and verify with the printed
   calibration ruler:
   `docs/superpowers/notes/2026-07-07-handheld-card-1to1.svg`
   To test coordinate variations, use the parametric tool at
   `tools/handheld_blockout/index.html` (Export 1:1 SVG). The legibility
   sheet for validation step 4 is
   `docs/superpowers/notes/2026-07-07-handheld-card-legibility.svg`.
2. Build a 9 mm foam/cardboard card with dummy caps and ~100 g ballast
   distributed per the band plan.
3. Run the inherited playtest loop: 10-15 minutes of Sokoban-style input
   (move, move, action, undo, undo, restart, menu, repeat); log thumb
   extension, cradle vs two-hand grip, wrist angle, accidental presses;
   small/medium/large hands if available.
4. Print p90 and median levels at 3.0 mm / 5.9 mm cells and a 34x13 text
   screen at ~2.8 mm chars; confirm legibility at handheld reading distance.
5. Choose a specific 4.3-inch 800x480 panel; measure backlight draw at play
   brightness and re-run the battery arithmetic before PCB layout.
6. Corpus-first software validation and hardware measurement lists from the
   parent spec apply unchanged, with the battery-runtime acceptance target
   restated as ~3 h turn-based play at default brightness.

## Sources

- Parent hardware design:
  `docs/superpowers/specs/2026-07-03-puzzlescript-handheld-design.md`
- Superseded 5-inch blockout:
  `docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md`
- Designer handoff:
  `docs/superpowers/notes/2026-07-06-handheld-designer-handoff.md`
- Arduboy size-class comparison (discussion trigger):
  https://community.arduboy.com/t/arduboy-vs-gambuino-vs-pocket-c-h-i-p-specs-only/1905
