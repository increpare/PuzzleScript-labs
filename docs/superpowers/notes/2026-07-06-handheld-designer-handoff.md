# PuzzleScript Handheld Ergonomics Handoff

Date: 2026-07-06
Status: concept / blockout brief, not final engineering

## Purpose

This is a handoff brief for a designer or ergonomics-focused agent to continue
the physical layout discussion for a dedicated PuzzleScript handheld console.
The immediate design question is whether the final 5-inch handheld should use
split side controls or controls below the display, and what the PuzzleScript
button cluster should be.

The current recommendation is a split-side, GBA-like support geometry, but not
a generic retro-console `ABXY` face-button layout. PuzzleScript has its own
control hierarchy: movement, action, undo, restart, and menu.

Existing visual blockouts:

- `docs/superpowers/notes/2026-07-06-handheld-layout-visualizations.svg`
- `docs/superpowers/notes/2026-07-06-handheld-layout-visualizations.png`

## Product Context

The device is a small-run physical PuzzleScript player:

- Dedicated game-playing device, not a general retro console.
- No on-device editor in v1.
- Final target display: 5-inch, 800 x 480, landscape.
- Bring-up hardware already ordered: Waveshare ESP32-P4-WIFI6-Touch-LCD-7B.
- The 7-inch board is for firmware/display/input bring-up only; it should not
  drive the final enclosure proportions.
- Gameplay should preserve PuzzleScript semantics: whole-board fit unless
  `flickscreen` or `zoomscreen`, D-pad movement, Action, Undo, Restart, Menu.

## Known Hardware Anchors

### Bring-Up Board: Waveshare ESP32-P4-WIFI6-Touch-LCD-7B

Use this for firmware and bench bring-up, not as the final product size.

Officially stated:

- 7-inch, 1024 x 600 IPS touch display.
- ESP32-P4NRW32 with 32 MB PSRAM and 32 MB NOR flash.
- ESP32-C6 Wi-Fi/Bluetooth coprocessor.
- USB OTG, USB-C UART/debug, TF card slot, battery connector, speaker port,
  microphone, audio codec/amplifier, GPIO headers.

Approximate mechanical notes from official Waveshare dimension images:

- Front/glass outline: about 164.28 x 99.17 mm.
- Active area: about 154.58 x 86.42 mm.
- PCB: about 164 x 97 mm.
- Mounting appears to use M2.5 standoffs, but exact hole centers should be
  verified when the board arrives.
- USB/power exits the right edge in the viewed orientation; TF card access is
  along the bottom edge.
- The board has a reserved rear battery area, but actual clearance, cable
  bend, and pack safety need physical confirmation.

### Final Display Reference: 5-Inch 800 x 480

The intended final screen is 5-inch 800 x 480 landscape. A useful reference is
the Waveshare 5inch DSI LCD, but driver/interface compatibility with ESP32-P4
still needs validation.

Official Waveshare 5inch DSI LCD drawing gives:

- Lens outline: 120.70 +/- 0.1 x 77.20 +/- 0.1 mm.
- Visible area: 109.00 +/- 0.2 x 65.80 +/- 0.2 mm.
- PCB outline: 121.00 x 76.00 mm.
- Eight M2.5 mounting holes are shown.
- Display stack thickness and connector keep-out should be checked against the
  actual unit and final display choice.

Important caveat: Waveshare's integrated ESP32-P4-WIFI6-Touch-LCD-5 board is a
5-inch 720 x 1280 portrait-default module, not the current 800 x 480 landscape
target. It may be useful for experiments, but it changes the display contract
and physical design assumptions.

## Current Ergonomic Direction

Prefer split controls on both sides of the screen for the final 5-inch
landscape device.

Reasoning:

- Frequent controls should sit under natural thumb rest zones.
- The hands should support the screen mass from both sides, with the grip line
  near the center of gravity.
- Controls below the screen make the device taller and can leave the screen
  mass cantilevered above the gripping fingers, especially during handheld play.
- General ergonomic guidance favors neutral wrists and tool/control geometry
  that does not force wrist deviation or frequent grip changes.
- Smartphone reach studies are not handheld-console studies, but they reinforce
  the same practical point: far targets often cause grip adjustment, instability,
  or slower/more effortful acquisition.

"GBA-style" should mean the support geometry: two hands flanking a landscape
screen, frequent controls under the thumbs, and system controls separated from
play controls. It should not mean copying a four-button action-game cluster.

## Button Hierarchy

PuzzleScript should not inherit an `ABXY` diamond by default. The buttons should
communicate that this is a puzzle-playing device.

Recommended hierarchy:

- Primary: D-pad, Action.
- Secondary but real gameplay buttons: Undo, Restart.
- System/rare: Menu.

Restart should not be hidden, tiny, or recessed. In PuzzleScript, restart is
normally undoable. For rare `noundo` games, the software should give clear
feedback rather than making Restart physically awkward.

Menu should not live inside the main right-thumb play cluster. It should be
reachable but visually/systemically separate: top edge, top-center, or a small
center strip are all plausible.

## Layout Candidate A: Split-Side Puzzle Handheld

Recommendation to explore first.

Rough concept envelope:

- Width: 215-240 mm.
- Height: 95-115 mm.
- Thickness: 24-34 mm at grips, thinner near display if possible.
- Display/lens reference: about 121 x 77 mm centered.
- Side control fields: roughly 40-55 mm wide each.

Control placement concept:

- Left: D-pad centered in the left thumb rest zone.
- Right: one large Action button, with medium Undo and Restart buttons nearby.
- Menu: separated from the right cluster, likely top edge or top-center.
- Power/Sleep: top or side, distinct from Menu.
- Volume: side rocker or two small side buttons, not on the front play surface.

Right cluster should feel like:

- Action is easiest and largest.
- Undo and Restart are real, readable, and reachable.
- Undo and Restart can be slightly smaller than Action, but not "system"
  buttons.
- Avoid four equal buttons in a diamond unless a playtest specifically proves
  it is better.

Likely advantages:

- Best hand support for a 5-inch landscape device.
- Natural thumb reach for frequent input.
- Better center-of-gravity control with batteries or grips on both sides.
- Strong product identity: puzzle controls, not a retro action controller.

Likely risks:

- Wider pocket/bag footprint.
- Needs careful right-cluster design to avoid accidental generic console
  visual language.
- Button PCB and battery placement need clean internal routing.

## Layout Candidate B: Controls Under Screen

Keep as a comparison prototype, not the current recommendation.

Rough concept envelope:

- Width: 150-170 mm.
- Height: 135-155 mm.
- Thickness: 24-34 mm.
- Display/lens reference: about 121 x 77 mm near the top.
- Controls arranged in a lower chin.

Control placement concept:

- D-pad lower left.
- Action / Undo / Restart lower right or lower center-right.
- Menu in center/top edge or in a separated lower-center system zone.

Likely advantages:

- Narrower device.
- Simple flat front face and potentially simpler internal layout.
- May suit tabletop play, dev-kit shells, or a "small slate" identity.

Likely risks:

- Taller device with the display above the grip line.
- More wrist flexion and grip adjustment during handheld play.
- Less stable one-handed repositioning.
- Can feel like holding a small tablet by its bottom edge rather than a
  purpose-built handheld.

## Layout Candidate C: Split Sides With Center Utility Strip

Use if the designer wants a stronger separation between gameplay and system
controls without making the device too wide.

Rough concept envelope:

- Width: 220-245 mm.
- Height: 100-118 mm.
- Thickness: 24-34 mm.
- Side controls remain primary; a narrow center or top strip carries Menu,
  status LEDs, and perhaps speaker perforation.

Control placement concept:

- Left: D-pad.
- Right: Action, Undo, Restart in a non-ABXY cluster.
- Top-center or front-center: Menu.
- Speaker: front lower-center, top-edge slots, or rear chamber depending on
  acoustic constraints.

Likely advantages:

- Keeps the split-hand ergonomic benefit.
- Gives Menu a clear home away from gameplay.
- Can create a recognizable PuzzleScript face layout.

Likely risks:

- Center strip can become visual clutter.
- Requires restraint so the front does not become busy.

## Battery, Speaker, USB, And SD Access Assumptions

For split-side layouts:

- Battery mass can be split left/right as a 1S pack arrangement, or placed as a
  single central rear pack if balance remains acceptable.
- Side grips are good candidate volumes for battery, speaker chamber, haptic
  motor, and screw bosses.
- USB-C should exit top or side; avoid a bottom-only cable path if it interferes
  with handheld play.
- microSD/TF access is useful for dev kits but may be internal/service-only in
  the final device if USB mass storage is the user-facing file path.
- Speaker should not be blocked by palms. Front lower corners, top edge, or
  rear with a tuned chamber should be compared physically.

For controls-under layouts:

- Battery likely sits behind the display or lower chin.
- Bottom-heavy balance is possible, but the top screen may still tip away from
  the hands.
- Speaker and USB have simpler edge-routing options, but the lower face becomes
  crowded.

## Mounting Assumptions

For current blockouts:

- Treat final display as a 121 x 76 mm module until a specific final display is
  chosen.
- Leave bezel and gasket room around the lens. Do not assume the visible area
  reaches the module edge.
- Assume screw-serviceable case with internal standoffs.
- Assume a separate button PCB or flex/daughterboard for controls.
- Assume 3D-printed translucent shell, meaning internal LED placement, cable
  routing, battery shape, and visible PCB surfaces are part of the product
  design.

Unknown until parts arrive:

- Real connector overhangs and cable bend radii.
- Mount hole tolerances.
- Touch/display stack thickness.
- Whether the final 800 x 480 panel uses the same mechanical package as the
  Waveshare reference.
- Actual battery pack dimensions and swelling clearance.
- Speaker chamber volume needed for acceptable sound.
- Button cap height, travel, force, and wobble in printed shell.

## Measurements Needed When Hardware Arrives

Bring-up board:

- Confirm 7B outer board dimensions, glass dimensions, active area, and full
  thickness stack.
- Measure exact mounting hole centers, diameters, and standoff heights.
- Map connector keep-out zones: USB, TF card, battery, speaker, GPIO headers,
  camera/display FPCs.
- Check whether USB and TF card remain accessible in landscape bench shells.
- Photograph and measure rear battery reserved area, including height and cable
  routing.
- Weigh the board and note center of gravity.
- Measure heat after sustained display-on operation.

Final display candidate:

- Confirm lens, active area, PCB outline, hole centers, connector location, FPC
  exit direction, and thickness.
- Verify display orientation, touch orientation, brightness control, and driver
  bring-up on ESP32-P4.
- Check whether the module can mount cleanly without stressing the glass or FPC.

Ergonomic mockups:

- Make full-scale paper/foam/cardboard top-view blocks for split-side and
  controls-under candidates.
- Add temporary button caps with approximate heights and spacing.
- Add battery-weight ballast in likely locations.
- Play a 10-15 minute Sokoban-like input pattern: move, action, undo, restart,
  menu, repeat.
- Note thumb extension, grip changes, wrist angle, support finger tension, and
  accidental button hits.
- Test at least small, medium, and large hands if possible.

Button/mechanical details:

- D-pad diameter or cross size, pivot feel, and diagonal suppression.
- Action button diameter and cap profile.
- Undo/Restart diameter, shape difference, and label readability.
- Minimum spacing between button caps in the actual shell material.
- Label/icon approach for Action, Undo, Restart, and Menu.

## Suggested Next Step: HTML Preview Mode

An HTML design preview would be useful after the designer defines the variables
worth testing. It should not try to be CAD. It should be a 1:1 blockout tool
for comparing:

- screen module size
- body width/height/radius
- button center positions and diameters
- grip/battery volumes
- speaker and port zones
- top-edge vs center-strip Menu placement
- split-side vs controls-under layouts

Recommended output:

- a local HTML page with selectable layout presets
- millimeter grid overlay
- printable 1:1 SVG/PDF export if easy
- no decorative rendering until the ergonomic proportions feel right

## Designer-Agent Prompt

Use this prompt to continue:

> We are designing a dedicated PuzzleScript handheld console. Final target is a
> 5-inch 800 x 480 landscape display, not the current 7-inch Waveshare bring-up
> board. The main decision is split-side controls versus controls below the
> display. Please analyze ergonomic tradeoffs and propose 2-3 refined physical
> control layouts. Do not default to an `ABXY` four-button cluster. PuzzleScript
> controls are D-pad, Action, Undo, Restart, Menu. Action is primary; Undo and
> Restart are secondary but real gameplay buttons; Restart should not be tiny or
> recessed because PuzzleScript restart is normally undoable. Menu should be
> reachable but separated from the gameplay cluster. Include rough dimensions,
> thumb reach reasoning, center-of-gravity assumptions, battery/speaker/USB/SD
> placement, and a physical mockup/playtest plan. Treat this as concept
> blockout work, not final mechanical engineering.

## Sources

- PuzzleScript handheld design spec:
  `docs/superpowers/specs/2026-07-03-puzzlescript-handheld-design.md`
- Existing layout visualization:
  `docs/superpowers/notes/2026-07-06-handheld-layout-visualizations.png`
- Waveshare ESP32-P4-WIFI6-Touch-LCD-7B wiki:
  https://www.waveshare.com/wiki/ESP32-P4-WIFI6-Touch-LCD-7B
- Waveshare ESP32-P4-WIFI6-Touch-LCD-7B product page:
  https://www.waveshare.com/product/arduino/boards-kits/esp32-p4/esp32-p4-wifi6-touch-lcd-7b.htm
- Waveshare 5inch DSI LCD wiki:
  https://www.waveshare.com/wiki/5inch_DSI_LCD
- Waveshare 5inch DSI LCD drawing PDF:
  https://files.waveshare.com/wiki/5inch%20DSI%20LCD/5inch%20DSI%20LCD.pdf
- Waveshare ESP32-P4-WIFI6-Touch-LCD-5 docs:
  https://docs.waveshare.com/ESP32-P4-WIFI6-Touch-LCD-5
- Steven Hoober, "How Do Users Really Hold Mobile Devices?":
  https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- Mehrotra, Das, and Zanwar, "Action Bar Adaptations for One-Handed Use of
  Smartphones":
  https://arxiv.org/abs/2208.08734
- CCOHS, "Hand Tool Ergonomics - Tool Design":
  https://www.ccohs.ca/oshanswers/ergonomics/handtools/tooldesign.html
