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
| Control hierarchy and layout | **Retained** — four separate direction buttons, guided caps over tacts |
| Button mechanism gate | **Retained**, narrowed to tact selection and a clearance ladder |
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

- Body: **90 × 93 mm**, thickness **14.30 mm**.
- The touch surface sits **flush in the front shell's window**, not behind a
  wall, so the front shell contributes no depth over the screen. This is the
  same arrangement the July 12 spec assumed ("flush or slightly recessed").
- Thickness is set by the **control/battery zone**, not the display. The module
  zone is 12.40 mm; the lower zone is 14.30 mm.
- The 12 mm ceiling in the July 12 spec is missed by 2.30 mm and should be
  treated as withdrawn, not aspirational.
- Growing the body in X or Y to gain internal volume was considered and
  rejected by the owner. 90 × 93 is fixed.

**What sets the lower zone.** The button stack: face 1.50, cap flange 1.00,
boss gap 0.50, tact body 2.50 — putting the PCB front at **5.50 mm**.

Game Boy silicone membranes were adopted mid-session and rejected on
measurement; they would have put the PCB at 11.1 mm and the body at ~19.9 mm.
See *Control scheme*.

**Tact height is the one thickness lever the design controls.** A 1.5 mm
low-profile part would give ~13.3 mm, at some cost in tactile snap. The other
lever is a thinner cell, which trades against the four-hour runtime gate and is
not taken. The battery cannot move beside the PCB instead of behind it: the
button field occupies the whole lower band and no column is 50 mm wide.

### Depth stack-up

| Upper zone (module) | mm | Lower zone (controls + battery) | mm |
|---|---|---|---|
| front shell over screen | 0 — module is flush in the window | front face | 1.50 *decided* |
| — | — | cap flange | 1.00 *assumed* |
| — | — | boss gap | 0.50 *assumed* |
| module front stack | 5.85 | tact body | 2.50 *decided* |
| module rear components | 4.75 | controller PCB | 1.60 *assumed* |
| clearance | 0.30 *assumed* | PET insulator | 0.20 *assumed* |
| — | — | 503450 cell | 5.00 |
| — | — | swell allowance | 0.50 *assumed* |
| back shell | 1.50 *assumed* | back shell | 1.50 *assumed* |
| **total** | **12.40** | **total** | **14.30** |

**There is no usable space behind the display.** The module zone is the
shallower of the two, and its 1.9 mm of slack is far short of the cell (5 mm)
or a driver (3–4 mm), sits over the RF section, and would need the back shell
stepped.

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

Movement is **four independent direction buttons**, not a d-pad rocker. This
restores the July 12 rationale, which had been overridden only because the Game
Boy parts family comes as a set:

> PuzzleScript play depends on rapid, discrete, often alternating direction
> presses; separate contacts give cleaner actuation, faster repeat, and no
> cross-axis ambiguity.

With that constraint gone the original reasoning stands again. There are no
diagonals to arbitrate in firmware, and the pivot post — the hardest single
piece of geometry in the design — disappears.

The cost is **rolling**: a d-pad lets a thumb slide from up to right without
lifting. For a game of discrete grid steps this is judged no real loss, but it
is the one thing a rocker genuinely does better.

### Button mechanism — guided cap over an SMD tact

Game Boy silicone membranes were adopted mid-session and then **rejected on
measurement**. Physical DMG gaskets are 4 mm (d-pad), 5 mm (A/B) and 9 mm
(Start/Select) tall. Those heights force the PCB 11.1 mm below the outer face
and the body to ~19.9 mm — confirmed three ways: back-calculating from the A/B
cap, back-calculating from Start/Select, and a depth histogram of the reference
shell showing 101 mm² of standoffs at exactly 11.00–11.25 mm.

A DMG is 32 mm thick and can absorb that. This device cannot.

Tact switches put the PCB front at **5.5 mm** and the body at **14.30 mm**:

| Layer | mm | Note |
|---|---|---|
| front face | 1.50 | *decided* |
| cap flange | 1.00 | captured behind the face, guided in a collar |
| boss gap | 0.50 | boss end to plunger at rest |
| tact body | 2.50 | *decided*, see lever below |
| → PCB front | **5.50** | |

**Switch height is now a direct thickness lever.** Every millimetre of tact
height is a millimetre of device; a 1.5 mm low-profile part would give ~13.3 mm
at some cost in tactile snap. This is the first lever on thickness the design
actually controls.

What the membrane had been providing for free, and which we now own:

| Requirement | Target | Provided by |
|---|---|---|
| No wobble | <0.15 mm lateral | flange guided in a collar bore, not head in face hole |
| No rattle | silent when shaken | tact spring preloads the cap against the face underside |
| Hard stop | before switch damage | flange shoulder at 0.35 mm — past 0.25 mm actuation, before bottoming |
| No side load in solder joints | — | collar takes lateral force; the tact sees only axial |
| Anti-rotation | pills only | two flange flats in matching collar slots |
| 30-minute comfort | — | cap crown shape; only a printed part answers this |

The **button coupon gate returns**, and with it the tolerance ladder: cap-to-hole
and flange-to-collar clearances cannot be derived, only printed.

Dust sealing is lost. The silicone had been closing every opening for free.

### Cap geometry, inherited from the DMG

The DMG cap footprint is kept as the visual language even though the mechanism
underneath is now ours. Measured from
**[guighub/DMG-01-Shell](https://github.com/guighub/DMG-01-Shell)**
(`STL/DMG-01_Front_v54.stl`, MIT licence — vendored at
`hardware/DMG-01-Shell-Coffee/`), rasterised at 0.05 mm. The model measures
**89.99 × 148.00 mm**, the DMG exactly, which is the basic credibility check.
v38 and v54 are identical across every button feature.

| Control | Size | Pair geometry |
|---|---|---|
| Directions | Ø8.0 caps, **26.0 mm** span, 4.73 mm between adjacent | ours, not DMG |
| Undo / Action | **Ø11.00 mm** | **16.34 mm** centres at **25.4°** |
| Reset / Menu | pill **11.15 × 3.00 mm** at **23.4°** | **15.00 mm** apart, level |

**Confidence:** 11.00, 15.00 and 3.00 land exactly on round values and read as
surviving design intent. 11.15, 16.34, 25.4° and 23.4° do not, so treat those as
carrying the reference author's trace error. It is a replica, not a scan; its
author notes screw holes may be offset and makes no accuracy claim for the
button features. Add ±0.05 mm of rasterisation error.

The reference also yields the **anti-rotation pattern**: two opposed slots of
**24°**, opening 3.9 mm below the outer face and running to the collar bottom,
with matching spokes on the cap. Reused directly for the pills.

### Horizontal positions

A DMG is 90 mm wide and so is this body, so **X transfers 1:1 with no scaling**.
Measured from the left edge:

| Control | x | y |
|---|---|---|
| Direction cluster centre | 18.22 | 67.5 |
| Undo | 63.22 | 71.0 |
| Action | 77.98 | 63.99 |
| Reset | 33.23 | 86.0 |
| Menu | 48.23 | 86.0 |

The 26 mm cluster spans y = 54.5 to 80.5, clearing the module by 2.0 mm and the
pills by 1.9 mm.

### Mapping

| Control | Function | MCP23017 |
|---|---|---|
| Up / Down / Left / Right | Directions | PA0–PA3 |
| Undo (inboard, larger reach) | **Undo** | PA5 |
| Action (outboard) | Action | PA4 |
| Reset pill | Restart | PA7 |
| Menu pill | Back/Menu | PA6 |
| Mute slide switch | Audio mute (level, not edge) | PB0 |
| — | spare | PB1–PB7 |

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
86 × 50 in a 90 mm body and 10.6 mm deep in a 14.30 mm body whose upper zone is
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
- Depth: the PCB front sits at 5.50 mm. A 4 mm driver spanning roughly
  1.5–5.5 mm straddles the board plane, which is what the cutout is for.
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
- Carries: MCP23017, decoupling, **eight SMD tact switches** (four directions,
  Undo, Action, Reset, Menu), the power slide switch, the mute slide switch,
  and keyed connectors to the module.
- **No contact pads.** The earlier ENIG interdigitated-comb decision applied to
  silicone membranes and is void — every button is now an ordinary component
  from the LCSC library, placed by machine. Board finish reverts to whatever is
  cheapest.
- Tact selection targets ~2.5 mm body height, ~0.25 mm travel and ~1.6 N
  actuation force, with a crisp snap ratio. Height is a thickness lever; see
  *Envelope*.
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
- Prototype by printing shells and caps together. No tooling until fit, travel,
  port access, assembly order and boss strength are proven.

## Sourcing

Returning to tact switches **collapses the two-stream BOM back into one**. Every
electrical part, including all eight buttons, is an ordinary LCSC component that
JLCPCB places by machine. Nothing needs a repair-parts supplier.

What remains outside the board is the **caps**: printed for prototypes, moulded
at volume, in the same family tooling as the shells. They are our parts, in our
geometry, with no third-party supply risk.

| Stream | Contents |
|---|---|
| JLCPCB / LCSC | MCP23017, passives, 8 tact switches, both slide switches, connectors, test points |
| Us | Front shell, back shell, 8 caps — printed, then moulded |
| Final assembly | Owner for the pilot; PCBWay box-build at volume |

This removes several risks recorded earlier in the session: aftermarket quality
variance, dependence on a Game Boy repair market that is a market rather than a
contract, and reproducing someone else's membrane retention geometry.

It reintroduces one: **we own the button feel entirely**, and only a printed
coupon answers whether we got it right.

## Open items

1. **Clearance ladder.** Cap-to-hole and flange-to-collar clearances cannot be
   derived, only printed. `COUPON_CLEARANCES` sweeps 0.05–0.25 mm. This is the
   first print and it gates everything about button feel.
2. **Tact switch selection** — body height, travel, force and snap ratio. Height
   feeds straight back into body thickness.
3. **Confirm the clockwise module rotation** and connector positions on a
   physical sample.
4. **Cap crown shape** — dished, 1.0 mm proud is the starting point. A feel
   judgement, settled on the coupon.
5. **Driver diameter** the bottom-right corner actually allows, once the grille
   shape exists.
6. **Cell dimensions** including protection-board bulge and connector polarity.
7. **Speaker socket position**, to fix a cable length.

Items 1 and 2 gate the most downstream work and are coupled — print the ladder
with the switch you intend to use.

## Decisions reversed during this session

Recorded so they are not relitigated:

- **12 mm thickness → 14.30 mm.** This moved four times and the history is
  worth keeping: 13.9 mm (double-counted a shell wall in front of a module that
  actually sits flush in the window) → 12.6 mm (corrected) → 14.25 mm (measured
  DMG retention ribs at 3.95 mm, against 2.3 mm assumed) → **19.9 mm** (physical
  gasket heights showed the ribs were locating walls, not standoffs, and the
  real board plane is 11.1 mm down) → 14.30 mm (tact switches). Every move but
  the first came from replacing an assumption with a measurement.
- **Four separate direction buttons → d-pad rocker → four separate buttons
  again.** The rocker was adopted only because the DMG parts come as a set.
  Once the parts went, the July 12 gameplay argument stood unopposed.
- **Guided caps over tacts → silicone membranes → guided caps over tacts
  again.** The membrane genuinely does delete the load path and the coupon gate,
  and on a 32 mm-thick DMG that is the right trade. On a device targeting ~14 mm
  its 11.1 mm board plane is disqualifying. Measured gasket heights of 4 / 5 /
  9 mm killed it.
- **microSD as cartridge path → internal flash over USB.** Simpler in every
  dimension.
- **DMG cap geometry survives both reversals.** Ø11 Undo/Action at 16.34 mm and
  25.4°, the 11.15 × 3.00 pills at 23.4°, the 1:1 X coordinates and the 24°
  anti-rotation slots are all still in use as *cap* geometry.
- **Volume Up/Down → mute switch.** Momentary controls cannot live on a gripped
  edge; a slide switch can.
- **Growing the body to 90 × 100 for a top-mounted power switch → rejected.**
- **Control strip under the screen → withdrawn** once volume left the face.
- **Speaker grille muffling objection → withdrawn.** The DMG and Game Boy Color both fire
  from the lower right under the same heel of the same hand.
