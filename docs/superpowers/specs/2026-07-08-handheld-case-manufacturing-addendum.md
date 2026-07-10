# PuzzleScript Handheld Case Manufacturing Addendum

Status: proposed guidance for small-run shells.
Date: 2026-07-08.

## Summary

This addendum records how to make a crisp, smoky/frosted translucent shell for
the 5-inch PuzzleScript handheld in quantities of roughly 2-10 units. It
supplements the geometry and construction notes in
`docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md`.

The target look is not glass-clear everywhere. The shell should preserve sharp
mechanical detail (button wells, 5x5 speaker grille, ~0.4 mm brick relief,
internal mascot rim-light geometry) while diffusing grip RGB LEDs and keeping
the PCB visible as a designed product surface.

## Recommended Process (Small Run)

### Primary path: SLA master, silicone mold, tinted urethane cast

Best fit for a boutique handheld with sculpted grips and visible internals.

1. **CAD** the front and rear shells from the approved blockout, with
   manufacturing-friendly wall thickness and draft (see below).
2. **Print one high-resolution SLA master** per shell half. Orient the front
   shell face-down on the build plate so the speaker grille and display frame
   land on the show face.
3. **Make silicone molds** from the masters (two-part mold if undercuts require
   it).
4. **Cast** each shell in optically clear urethane with a small smoke tint.
5. **Post-process**: deflash, wet-sand show surfaces, bead-blast or matte-clear
   the inner glow surfaces, install brass heat-set inserts, bond in the display
   lens insert.

**Why this path**

- Reproduces fine grille holes and shallow relief better than FDM.
- Curved grip surfaces finish smoother than printing every unit.
- Tint and frost levels repeat across copies once the process is dialed in.
- Cost per extra shell stays reasonable after mold setup.

**Rough cost envelope (2026, order-of-magnitude)**

| Stage | Typical range |
|---|---|
| SLA masters (2 halves) | $80-200 via service, less if you own a resin printer |
| Silicone molds (2 halves) | $50-150 in materials |
| Each cast shell set | $30-80 in resin, labor, and finishing |
| Display lens inserts (cut acrylic) | $5-15 each |

### Fast hero-unit path: finished SLA prints

For the first beautiful shell before committing to molds:

- Print both halves in a clear SLA resin on a resin printer or through a print
  bureau (JLCPCB 3D Printing, PCBWay, Craftcloud, or a local shop).
- Post-process: proper wash/cure, wet-sand show faces (400 to 800 to 1500),
  apply smoky tint via tinted clear coat or lightly pigmented resin wipe, frost
  inner grip/LED surfaces.

Use this for fit-check and photography. Hand finishing does not scale as cleanly
as casting for copies 3-10.

### Iteration / abuse shells: opaque FDM

Keep at least one cheap PETG or PLA shell for ongoing hardware bring-up. Do not
optimize the translucent process until opaque fit, button travel, USB access,
and speaker chamber behavior are proven.

## Processes To Avoid For This Shell

| Process | Reason |
|---|---|
| Clear FDM (PETG, PC filament) | Cloudy layers; weak on fine grille and relief |
| SLS / MJF nylon | Strong, not meaningfully transparent |
| Single-block CNC acrylic | Good for flat windows, poor for sculpted grips and undercuts |
| Vacuum-formed clear sheet | Cannot hold the 5x5 grille or brick texture crisply |

Injection molding in clear polycarbonate or PMMA is viable only if tooling cost
($3k-$15k+) is acceptable. Out of scope for the stated few-unit goal unless a
later commercial run appears.

## Material Notes

### Body shell (smoky/frosted translucent)

- **Cast urethane (preferred for copies):** Smooth-On Crystal Clear or similar
  optically clear systems, plus a trace of black or smoke pigment. Easy to
  over-tint; add pigment gradually.
- **SLA resin (masters and hero units):** Clear resins marketed for optical
  clarity (Formlabs Clear, Elegoo/other "clear v4" class materials, or bureau
  equivalents such as Watershed-class SLA). Expect yellowing over years on some
  formulations; keep units out of direct sun if that matters.
- **Not recommended for show surfaces:** transparent FDM filament.

### Display lens insert (separate part)

Bond a **clear, untinted** window behind the display opening. The game image
stays sharp; the body shell keeps atmosphere.

| Material | Notes |
|---|---|
| **Laser-cut acrylic (PMMA), 1.5-2.0 mm** | Cheap, crisp, scratches more easily |
| **Polycarbonate sheet, 1.0-1.5 mm** | Tougher, slightly less optical clarity |
| **Glass, ~1.1 mm** | Best optics; heavier; harder to mount |

**Lens cutout (from blockout display frame):**

- Opening reference: **121 x 77 mm** (Waveshare 5-inch DSI class lens
  outline), centered on the front face per the blockout spec.
- Lens blank: cut **1-2 mm undersize** per side for bonding shelf, or match the
  frame ledge once CAD exists.
- Bond with a thin bead of **optically clear UV adhesive** (Norland NOA 61 or
  equivalent) on a ledge or rebate; avoid glue in the visible field.
- Anti-reflection coating is optional; skip for v1 unless cost is irrelevant.

### Hardware

- **M2.5 screws** through the rear shell into **brass heat-set inserts** in the
  front bosses or standoff posts. Do not rely on printed threads in cast or SLA
  material.
- **Seam gasket:** thin black foam or a printed TPU strip at the perimeter
  split hides light leak and tolerances. The seam sits at the widest profile
  line per the blockout construction notes.

## Translucency Design Rules

The shell uses two surface treatments, not one uniform finish:

1. **Outside show faces:** polished or satin-smooth. Fingerprints and scratches
   read here; keep texture off palm-contact areas except the intentional brick
   relief.
2. **Inside glow surfaces:** matte/frosted. Inner grip walls, LED aim zones,
   and the rear mascot relief benefit from frosting so RGB reads as ambient rim
   light instead of hot spots.

**Wall thickness targets (translucent regions)**

| Region | Target thickness | Notes |
|---|---|---|
| Flat front band (display surround, speaker zone) | 2.0-2.5 mm | Uniform thickness avoids bright patches |
| Grip bulges | 2.0-3.0 mm | Thinner looks sharper; thicker diffuses more |
| Waist behind display | 2.0-2.5 mm | PCB visibility zone |
| Bosses and screw posts | Solid fill or >= 4 mm local | Do not hollow posts |
| Speaker grille web | >= 0.8 mm ligaments | Validate on first SLA before molding |
| Brick relief | 0.4 mm depth, >= 0.6 mm remaining wall | Start here; adjust from mockups |

Thin spots blow out under LED glow. Thick spots look muddy. Aim for fairly
uniform translucent walls in each visual zone.

**Smoke tint starting point:** cast or coat until a white LED behind 2.5 mm of
wall reads as soft amber-gray, not bare bulb. Tune on scrap before committing
the mold.

## CAD Checklist (Before First Print)

- [ ] Split line at widest profile; rear shell carries screw heads.
- [ ] Front shell prints/builds with display frame and grille on the primary
  show face.
- [ ] Display lens rebate or ledge modeled; lens is a separate part.
- [ ] M2.5 boss holes sized for M2.5 brass inserts (typically ~3.4-3.6 mm
  pilot per insert datasheet).
- [ ] Button wells leave >= 7 mm cap-to-cap edge clearance (blockout minimum
  until measured).
- [ ] USB-C cutout includes connector overhang and cable bend radius clearance.
- [ ] Speaker chamber volume and port path match blockout (~15 cm3 target).
- [ ] LED aim pockets or flat facets on inner grip walls.
- [ ] Internal mascot relief on rear shell inner face for rim-light (blockout
  identity section).
- [ ] 0.5-1.0 deg draft on deep pockets if casting; SLA masters can be tighter.

## Manufacturing Validation Plan

Run after opaque fit is good and before ordering multiple cast shells.

1. **SLA fit shell:** verify display module seat, button well depth/travel,
   USB-C access, and screw closure with inserts installed.
2. **Grille sample:** confirm 5x5 perforations are open, not fused; adjust hole
   diameter or web thickness if needed.
3. **LED glow tile:** cast or print a 40 x 40 mm sample at target thickness and
   tint; place an RGB LED behind it; approve smoke level and frost before full
   molds.
4. **Lens bond trial:** bond one acrylic insert; check for bubbles, glue creep
   into the field, and parallax against the LCD.
5. **Drop-handling:** one cast shell from desk height onto carpet; inspect bosses
   and seam. Translucent urethane is harder than resin but not polycarbonate-
   tough; treat as a handled object, not a crash helmet.
6. **Play session:** 20-minute Sokoban-style loop with final caps; recheck
   brick relief comfort and palm gloss.

Log failures back into the blockout spec and CAD before scaling to a multi-unit
cast run.

## Suggested Build Order

1. Foam/cardboard blockout (blockout validation plan).
2. Opaque FDM fit shells.
3. One SLA translucent fit shell (or cast from a quick mold if already committed).
4. Approve tint/frost on glow tile.
5. Final molds and 3-10 cast shells.
6. Keep one opaque FDM shell permanently for hardware hacking.

## Sources

- Case geometry and construction:
  `docs/superpowers/specs/2026-07-07-handheld-case-blockout-design.md`
- Parent hardware design:
  `docs/superpowers/specs/2026-07-03-puzzlescript-handheld-design.md`
