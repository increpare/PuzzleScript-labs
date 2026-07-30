# Pocket Card — Mechanical and Control Design

Date: 2026-07-31
Status: agreed in design session; supersedes the mechanical, control, storage and
power sections of `2026-07-12-puzzlescript-pocket-card-design.md`.

## What this replaces

The July 12 specification remains authoritative for product intent, firmware
architecture, and the validation-gate philosophy. This document replaces five of
its sections outright:

| July 12 section | Status |
|---|---|
| Mechanical architecture (front/rear decorative PCB sandwich, midframe) | **Replaced** — moulded two-part shell |
| Control hierarchy and layout (four separate direction buttons, guided caps over tacts) | **Replaced** — DMG parts on silicone membranes |
| Button mechanism gate (tact vs snap dome coupon) | **Deleted** — the membrane decides it |
| Storage (microSD as the cartridge path) | **Replaced** — internal flash over USB-MSC |
| Power model (switch in battery lead, ≥1 A) | **Retained unchanged** |

`hardware/card/case/case.blend` is **not** a source of truth. It was examined and
set aside by the owner. Its `ab_button` / `staretselecT_cutout` geometry
described a different arrangement and no dimension in this document derives
from it.

## Source of truth for module geometry

All module numbers below come from **ES3C28P & ES3N28P Specification V1.0**
(LCDWIKI/QDtech, 2025-06-14), sections 3.2–3.4 and the §5.1 outline drawing.
A copy should be committed alongside `hardware/pocket_card/`.

| Property | Value | Source |
|---|---|---|
| Module outline | 50.00 × 86.00 mm | §3.4 |
| Total depth | **10.60 mm** | §5.1 side view |
| Front stack (touch surface → back of PCB) | 5.85 mm | §5.1 |
| Rear component height (max) | 4.75 mm | §5.1 |
| Active area | 43.20 × 57.60 mm | §3.2 |
| Visible window | 43.60 ±0.15 × 58.05 ±0.15 mm | §3.3 |
| Mounting holes | Ø3.2 on a **78.00 × 42.00** grid, 4 mm in from each edge | §5.1 |
| Charge current | 290 mA actual, 500 mA max | §3.5 |
| Total current, everything active | 560 mA | §3.6 |
| Speaker support | 1.5 W (8 Ω) or 2 W (4 Ω) | §3.7 |

Values marked **assumed** elsewhere in this document are engineering estimates
and must be replaced with measurements before CAD is frozen.

## Envelope

- Body: **90 × 93 mm**, thickness **14.25 mm**.
- The touch surface sits **flush in the front shell's window**, not behind a
  wall, so the front shell contributes no depth over the screen. This is the
  same arrangement the July 12 spec assumed ("flush or slightly recessed").
- Thickness is set by the **control/battery zone**, not the display. The module
  zone is 12.40 mm; the lower zone is 14.25 mm.
- The 12 mm ceiling in the July 12 spec is missed by 2.25 mm and should be
  treated as withdrawn, not aspirational.
- Growing the body in X or Y to gain internal volume was considered and
  rejected by the owner. 90 × 93 is fixed.

**Why the lower zone is deeper than first estimated.** Membrane compression is
set by the DMG's retention ribs, which stand **3.95 mm** above the inner face —
not the 2.3 mm originally assumed for "membrane + cap". That value is fixed by
the membrane and is not a design variable. Measurement replaced an assumption
and moved the number the wrong way.

The front face was thinned from the DMG's 2.30 mm to **1.50 mm** to recover
0.8 mm. The cost is A/B cap guide depth: **5.45 mm** of bore rather than the
DMG's 6.15 mm. Verify on the coupon.

The only remaining lever is a **thinner cell** — a 4 mm pouch would give
~13.3 mm — which trades directly against the four-hour runtime gate and is
not taken. The battery cannot move beside the PCB instead of behind it: the
button field occupies the whole lower band and no column is 50 mm wide.

### Depth stack-up

| Upper zone (module) | mm | Lower zone (controls + battery) | mm |
|---|---|---|---|
| front shell over screen | 0 — module is flush in the window | front face | 1.50 *decided* |
| — | — | retention rib | 3.95 **measured** |
| module front stack | 5.85 | controller PCB | 1.60 *assumed* |
| module rear components | 4.75 | PET insulator | 0.20 *assumed* |
| clearance | 0.30 *assumed* | 503450 cell | 5.00 |
| — | — | swell allowance | 0.50 *assumed* |
| back shell | 1.50 *assumed* | back shell | 1.50 *assumed* |
| **total** | **12.40** | **total** | **14.25** |

**There is no usable space behind the display.** The module zone is the
shallower of the two, and its 1.85 mm of slack is far short of the cell (5 mm)
or a driver (3–4 mm), sits over the RF section, and would need the back shell
stepped.

**The PCB front face is not a free variable.** It sits on the retention ribs at
`FACE_T + RIB_PROUD` = 5.45 mm, because the ribs are the standoffs that set
membrane compression.

These numbers are computed in `hardware/pocket_card/case/params.py`, which is
authoritative. This table is a transcription of it.

A touchless **ES3N28P** behind a transparent shell acting as the lens was
evaluated and **rejected** by the owner. It would have given 1.20 mm less module
depth (§3.4) and 270 rather than 230 cd/m² (§3.6), but required an opaque
backlight mask, polished tooling, a prototype path diverging from production,
and left the bare TFT exposed during assembly. Recorded so it is not
re-proposed.

## Module orientation

The module is portrait. It is rotated **clockwise** into landscape, viewed from
the front. This is forced, not preferred.

Only one of the module's two long edges ends up at a device edge; the other
faces inward. The microSD socket is on a long edge. Counter-clockwise rotation
buries it inside the case.

Resulting placement:

| Module feature | Lands at |
|---|---|
| microSD, UART, BAT sockets | device **top** edge |
| I2C, speaker, expansion sockets | facing **down** into the control cavity |
| USB-C | device **left** edge, centred on that 50 mm run |
| Antenna | device **right** edge, upper zone |
| RESET, BOOT | module rear face, sealed inside |

Consequences:

- I2C and speaker cables run straight down to the controller PCB. Good.
- The battery socket is at the top while the cell is at the bottom. The battery
  cable climbs the **left** wall — never the antenna side.
- **Antenna keepout** is the upper-right region. No metal, no battery, no PCB,
  no cable runs. Prefer an air gap over solid plastic against it.
- RESET and BOOT are sealed. Accepted by the owner. See *Recovery* below.

**To verify:** this rotation was derived from the drawing's mirrored back view,
not measured. Confirm on a physical sample before CAD.

## Control scheme

Movement is a **one-piece d-pad rocker**, not four independent buttons. This
reverses the July 12 rationale ("no cross-axis ambiguity"). The trade was made
deliberately: the Game Boy parts family is only available as a set, and its
mechanical benefits outweigh the theoretical actuation advantage. Firmware
arbitrates diagonals.

### Parts strategy

Aftermarket **Game Boy classic (DMG) repair parts**: d-pad, A/B caps, Start/Select
pills, and the conductive-carbon **silicone membranes** beneath them.

The membrane is the decisive element. It is simultaneously the return spring,
guide collar, hard stop, dust seal and switch. This deletes the entire
"guided cap, captured flange, hard stop, no side load into solder joints" load
path the July 12 spec specifies, and deletes the button coupon gate with it.
Shell design work per button reduces to a through-hole diameter and two
locating ribs.

The owner has accepted that the device will read as a Game Boy homage, with
shell colour doing the differentiation.

### Measured DMG geometry

Taken from **[guighub/DMG-01-Shell](https://github.com/guighub/DMG-01-Shell)**
(`STL/DMG-01_Front_v38.stl`, MIT licence), rasterised at 0.05 mm and analysed by
connected components. The model measures **89.99 × 148.00 mm** — the DMG exactly
— which is the basic credibility check.

These are **shell openings**, not cap dimensions. Caps are smaller by the
original's clearance, with the flange behind.

| Feature | Opening | Pair geometry |
|---|---|---|
| D-pad | cross, **22.00 mm** span; arm **7.75 mm**, filleted to ~7.6 at the tips | single part |
| A / B | **Ø11.00 mm** | **16.34 mm** centres, at **25.4°** |
| Start / Select | pill **11.15 × 3.00 mm**, at **23.4°** | **15.00 mm** apart, level |
| Screen aperture | 48.75 × 45.75 mm | — |
| Speaker slots | ~1.6 mm wide, ~60° | bottom-right corner |

**Confidence:** 22.00, 11.00, 15.00 and 3.00 land exactly on round values, which
reads as design intent surviving into the model. 7.75, 11.15, 16.34 and 25.4°
do not, so treat those as carrying the author's trace error. The model is a
replica, not a scan; its author notes screw holes may be offset from original
and makes no accuracy claim for the button features. Add ±0.05 mm of
rasterisation error to everything above.

### What the parts actually constrain

A DMG uses **three separate membranes** — d-pad, A/B, Start/Select. The
constrained geometry is therefore *within* each cluster and never between them.

| Fixed by the parts | Free to us |
|---|---|
| D-pad cross 22.00 mm | Position of each of the three clusters |
| A→B 16.34 mm at 25.4° | Distance between clusters |
| Start→Select 15.00 mm | Rotation of each group |

This is a much lighter constraint than assumed earlier in the design session,
where the parts were thought to dictate the whole face arrangement.

### Horizontal positions

A DMG is 90 mm wide and so is this body, so **X transfers 1:1 with no scaling**.
Measured from the left edge:

| Control | x (mm) |
|---|---|
| D-pad centre | 18.22 |
| Undo (B) | 63.22 |
| Action (A) | 77.98 |
| Restart (Select) | 33.23 |
| Menu (Start) | 48.23 |

### Vertical fit

The DMG spreads its controls over an 83 mm region; ours is 40 mm. The cluster
itself is only ~35 mm from d-pad top to pill bottom — the DMG simply has a lot
of empty plastic.

At true DMG spacing (d-pad centre to pills = 21.63 mm) the pills collide with
the bottom wall. Reducing that gap to **20.0 mm** resolves it:

- d-pad top at y = 55, **2.5 mm** clear of the module
- pill bottom at y = 89.1, **2.4 mm** clear of the interior wall
- A/B pair unrotated, at its true 25.4°

So the layout works at **full DMG scale**, with ~1.6 mm of compression between
clusters and none within any of them.

### Mapping

| DMG part | Function | MCP23017 |
|---|---|---|
| D-pad ↑ ↓ ← → | Directions | PA0–PA3 |
| B cap (inboard) | **Undo** | PA5 |
| A cap (outboard) | Action | PA4 |
| Select pill | Restart | PA7 |
| Start pill | Back/Menu | PA6 |
| Mute slide switch | Audio mute (level, not edge) | PB0 |
| — | spare | PB1–PB7 |

Undo lands on B, the inboard button the right thumb rests on — the hierarchy the
July 12 spec argued for, achieved for free by the parts.

Volume Up/Down as separate inputs are **deleted**. See *Audio*.

## Face layout

Screen above, controls below. Control band is the lower ~40 mm.

- **D-pad** — left, centred around x ≈ 23 mm.
- **Undo / Action** — right, on the DMG's fixed diagonal pitch and angle. Undo
  inboard and lower, Action outboard and upper.
- **Restart / Menu** — bottom centre, as the angled Start/Select pill pair.
- **Speaker grille** — front face, lower right. Owner is designing the grille
  pattern; the DMG's ~30° slot run is a placeholder only.

**A DMG is 90 mm wide and so is this body.** DMG control geometry is therefore
proportionally native to this face — d-pad size, A/B pitch and the Start/Select
pair were all laid out for exactly this width. This is the main reason DMG parts
were chosen over Game Boy Color ones, whose ~78 mm body would leave the clusters
reading undersized here.

**Known geometry conflict:** as currently drawn the Menu pill and Undo overlap
by ~1 mm. Shift the pill pair ~4 mm left, or Undo ~2 mm right.

A control strip beneath the screen carrying volume, Restart and Menu was
designed and then withdrawn once volume became an edge switch. It is recorded
here only so it is not re-proposed: it cost 8 mm of a 40 mm band and pushed the
face buttons back down into the grille.

## Edge layout

| Edge | Contents |
|---|---|
| Top | **Nothing.** No openings — microSD is deleted. |
| Left | USB-C only, centred on the module's 50 mm run |
| Right | Antenna keepout, upper zone. Lower zone free. |
| Bottom | Power switch (left), mute switch (beneath the grille) |

No control may be placed on a side edge in the **upper 50 mm**: the module is
86 × 50 in a 90 mm body and 10.6 mm deep in a 14.25 mm body whose upper zone is
only 12.40 mm, so the top and both
side edges are backed directly by module with no interior volume behind them.
This is why power cannot sit where a Game Boy's does without adding ~7 mm of
body height, which was considered and rejected.

### Why switches, not buttons, on the edges

Momentary controls on a gripped edge get pressed by resting fingers. Slide
switches cannot — actuating one requires a deliberate lateral push. Both edge
controls are therefore switches, and both are acceptable on surfaces the hand
contacts.

Position carries the meaning: power alone at the far left, mute directly beneath
the speaker it silences, ~50 mm apart. Different knob colours as reinforcement,
not as the primary signal.

## Audio

- Driver **Ø14–20 mm**, front-firing through the grille, in the bottom-right
  corner beside the battery. Final size set by the corner once the grille shape
  exists.
- **The driver must straddle the controller PCB plane, not sit behind it.** A
  driver behind a solid board cannot reach a front grille. Achieve this with a
  window in the board, an open notch, or a shifted board edge — settled when
  real dimensions exist. The principle is fixed; the shape is not.
- Depth: front shell 1.5 → membrane gap 2.3 → PCB at 3.8–5.4 mm. A 4 mm driver
  spanning 1.5–5.5 mm straddles the board plane. Interior is 9.6 mm.
- Acoustic mesh behind the grille, both for ingress and so the case interior
  isn't visible.
- Speaker cable runs ~55 mm from the module's socket across the board. Verify
  socket position on a sample before fixing a cable length.
- Bass response is limited by a small driver in a shallow chamber. Acceptable
  for sfxr output.

### Volume

A single **mute slide switch** replaces Volume Up/Down. Level is set in the menu
and stored in settings; the switch is a hard override, as on a phone.

Firmware drives **GPIO1 (amp enable, active low)** from the switch state, so
muted is physically silent — no hiss, slightly less drain. A persistent mute
glyph must appear on screen, or users will conclude the audio is broken.

Accepted regression: changing level mid-game requires opening the menu.

## Controller PCB

- Roughly 80 × 38 mm in the lower zone, with the speaker cutout described above.
- All switches, the MCP23017 and passives face **forward** into the button
  cavity. The battery-facing rear stays flat and component-free.
- Carries: MCP23017, decoupling, the power slide switch, the mute slide switch,
  keyed connectors to the module, and the button contact pads.
- **Contact pads: ENIG gold, interlaced combs.** There is no switch component
  under any face button — the switch is copper shorted by the membrane's carbon
  pill. Carbon ink was considered; ENIG needs no special process, no extra lead
  time, and carbon-pill-on-gold is standard in consumer devices. Comb pitch and
  pill diameter must be measured off a real board and membrane.
- Test points for 3V3, GND, SDA, SCL and the interrupt line.
- Battery is pushed hard left (50 mm wide in an ~84 mm interior) to reserve the
  right corner for the driver. Its position is no longer a free variable.

## Electrical

Unchanged from the July 12 contract except the mapping above.

- MCP23017 at **0x20**, 3.3 V, interrupt-on-change to ES3C28P **GPIO 2**.
- I2C: SDA **GPIO 16**, SCL **GPIO 15**, shared with the FT6336G touch
  controller (0x38) and ES8311 codec (0x18).
- Switches active-low to ground with pull-ups. Confirm the module's existing
  pull-ups before adding another set.
- Firmware debounces in software. The mute input is read as a **level**, at boot
  and on interrupt — not as an edge.

## Power

A hard slide switch in the battery lead. **Decided, not conditional.**

- Position: bottom edge, left. Rated **≥1 A** — the lead sees at most ~560 mA,
  so this is ~2× margin on a lithium cell.
- Semantics are unchanged from July 12: charging requires the switch on; USB
  powers the module regardless of switch position.
- Off means the cell is physically disconnected. Shelf life is set by the cell's
  own self-discharge and nothing else.

A soft-power alternative — deep sleep behind a momentary button, no switch — was
considered and dropped. The switch is simpler, is genuinely zero-drain, and
does not depend on any measurement.

### What standby current still affects

Nothing mechanical, and nothing about whether this switch exists. It affects
**firmware sleep policy only**:

- How long the device survives left switched *on* but idle. If module standby is
  milliamps, a weekend on the desk flattens it, and the switch stops being
  optional hygiene and becomes something the UI must actively push users toward.
- Whether an idle deep-sleep state is worth implementing at all, or whether
  dimming the backlight is the only lever that matters.
- Whether the July 12 critical-battery path (save, disable audio/backlight/LED,
  deep sleep before hardware cutoff) actually protects the cell for a useful
  period, or merely delays cutoff.

The unknown is the module, not the SoC: it carries a charger, LDO, FT6336G and
ES8311. Worth measuring when a sample exists, but it gates firmware behaviour,
not CAD.

## Storage

**Internal flash is the cartridge library. The microSD socket is left
unpopulated.**

- ~16 MB flash: ~4 MB app, ~3 MB OTA slot, **~9 MB wear-levelled FAT partition**.
- A PuzzleScript game is plain source text. At ~6 kB for a large one, 9 MB is on
  the order of 1,500 games. A card's capacity is headroom with no use.
- Exposed over USB as a mass-storage device via ESP-IDF's TinyUSB MSC driver.
- Two mutually exclusive modes, because only one side can own a FAT volume:
  **Playing** (firmware owns it) and **Library** (host owns it, device charges).
  Plugging in switches modes and says so on screen.
- USB is Full Speed (12 Mbps) — irrelevant for text files.

Deleted by this decision: a slot opening and its plastic tunnel, an ingress
path, a BOM line, an assembly step, a sealed-in failure mode, and every
"missing or unreadable card" firmware path.

The socket remains on the module. A user who opens the case can fit a card if
the firmware path is kept alive as an optional extra.

### Recovery

Running TinyUSB displaces the USB-Serial-JTAG peripheral, so ROM download mode
is the only recovery for wedged firmware — and it needs BOOT, which is sealed
inside.

**Therefore the case must remain openable.** Screws and clips; no glue, no
ultrasonic welding. This was already the preference in the handoff; it is now
load-bearing.

Firmware update should be by dropping a `.bin` on the mounted volume and letting
the device flash itself on next boot. A composite MSC + CDC device is the
alternative.

## Enclosure and assembly

- Two-part moulded shell, front and back.
- **Fixings: four screws through the module's own Ø3.2 mounting holes** on the
  78 × 42 grid. Boss on the front shell, screwed from the back. These holes are
  also the **dimensional datums** — the shell references them rather than
  accumulating tolerance from a board edge.
- This gives the upper half of the case real fixings. Without it, everything
  would have been anchored in the lower 43 mm, leaving the section wrapped
  around a glass screen opening held by nothing.
- The upper-right boss sits inside the antenna zone: plastic boss, short screw,
  no full-depth metal insert.
- One screw size throughout. Keyed connectors. Minimal adhesive.
- Battery insulated from the PCB by a PET layer, with swelling allowance.
- Prototype by printing shells and using bought caps and membranes. No tooling
  until fit, travel, port access, assembly order and boss strength are proven.

## Sourcing

The BOM splits permanently in two. JLCPCB cannot supply or fit the buttons:
silicone pads and plastic caps are not in the LCSC library, are not solderable,
and JLCPCB's turnkey PCBA does not do mechanical assembly.

| Stream | Contents |
|---|---|
| JLCPCB / LCSC | MCP23017, passives, both slide switches, connectors, test points, and the contact pads (copper, not a part) |
| Repair-parts supplier | D-pad, A/B caps, Start/Select pills, membranes, plus a donor DMG shell to measure |
| Final assembly | Owner for the pilot; PCBWay box-build at volume |

Risks specific to this route:

- Aftermarket quality varies. Buy from two or three vendors early and compare
  silicone durometer and pill conductivity.
- Supply exists because people repair Game Boys. That is a healthy market, not
  a contract.
- Membrane retention geometry (ribs and pockets) must be measured off a donor
  shell. This is the real remaining CAD work, and it is far less than designing
  a button mechanism from scratch.

## Open items — all measurements, no decisions

1. **Membrane and cap geometry** off a donor DMG shell — retention ribs, pocket
   depths, dome height. The largest remaining piece of real CAD input.
2. **Confirm the clockwise rotation** and connector positions on a physical
   module.
3. **Carbon pill diameter** off a real membrane. The comb pattern itself does not
   need reverse-engineering — silicone keypad vendors publish the design rules,
   and pills run 2–8 mm with a board contact area sized around them. One measured
   number is enough to draw our own pads.
4. **Confirm rib height against a real membrane.** 3.95 mm was measured off the
   reference shell and now sets body thickness directly. The coupon tests it.
5. **Driver diameter** the bottom-right corner actually allows, once the grille
   shape exists.
6. **Cell dimensions** including protection-board bulge and connector polarity.
7. **Speaker socket position**, to fix a cable length.

Items 1 and 2 gate the most downstream work and are cheap — a donor shell and a
module together are a few tens of pounds. Do those first.

ES3C28P standby current is **not** on this list: with a hard power switch it no
longer affects any mechanical or electrical decision. It is a firmware-behaviour
question, recorded under *Power* above.

## Decisions reversed during this session

Recorded so they are not relitigated:

- **12 mm thickness → 14.25 mm**, set by the control/battery zone. This moved
  twice. An intermediate 13.9 mm figure double-counted a shell wall in front of
  a module that sits flush in the window; correcting that gave 12.6 mm. Then
  measuring the DMG retention ribs at 3.95 mm — against 2.3 mm assumed for
  "membrane + cap" — pushed it back out to 14.25 mm. The front face was thinned
  from 2.30 to 1.50 mm to recover 0.8 mm of that.
- **Four separate direction buttons → d-pad rocker.** The parts family won.
- **Guided caps over tacts → silicone membranes.** Deletes the load path and
  the coupon gate.
- **microSD as cartridge path → internal flash over USB.** Simpler in every
  dimension.
- **Volume Up/Down → mute switch.** Momentary controls cannot live on a gripped
  edge; a slide switch can.
- **Growing the body to 90 × 100 for a top-mounted power switch → rejected.**
- **Control strip under the screen → withdrawn** once volume left the face.
- **Speaker grille muffling objection → withdrawn.** The DMG and Game Boy Color both fire
  from the lower right under the same heel of the same hand.
