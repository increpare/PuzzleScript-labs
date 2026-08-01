# Pocket Card — Edge Slide Tips (Power / Mute)

Date: 2026-08-01
Status: agreed in design session.

## What this amends

Authoritative for **bottom-edge power and mute** mechanics and parts. Where this
disagrees with:

- `2026-07-31-pocket-card-mechanical-controls-design.md` (edge layout / slides)
- `2026-07-31-pocket-card-skqg-rear-connectors-design.md` (which left edge
  slides “out of scope” / still implied PCM12 in CAD)

…this document wins. Face XY meaning (power far left, mute under the grille),
mute/power *semantics*, SKQG face controls, and rear JST pocket are unchanged.

Numeric truth for CAD lives in `hardware/pocket_card/case/params.py` after
implementation. When CAD and this spec disagree, fix CAD to match this
document, then re-derive dependents.

## Problem

PCM12 ultraminiature slides sit on F.Cu with the actuator tip ~3 mm inside the
outer bottom wall. The shell openings were easy to mis-center on the PCB
sandwich; even when Z is correct, the bare nub is a poor thumb target and does
not poke proud of the case.

## Decision summary

| Topic | Decision |
|---|---|
| Switch part | Drop PCM12. Mid-size right-angle SPDT, **JS102011SAQN class** (KiCad `SW_SPDT_CK_JS102011SAQN` / Alps SSSS8 family). Same footprint for power and mute. |
| Load | Logic-level only (EN / GPIO-class). Switch does not carry battery current. |
| PCB | Local **south-edge notches** at each site so pads stay on copper (≥0.5 mm to Edge.Cuts) and the paddle reaches the wall cavity. Board cuts are in scope. |
| Tip | Printed **shell-captive** resin tip per switch — not glued to the actuator. |
| End-stop | Shell slot rails take end-stop and guide force; solder joints see actuation only (same rule as Card power-switch spec). |
| XY layout | Unchanged: power ≈ left bottom, mute under grille. |

## Switch selection

| Property | Value |
|---|---|
| Preferred footprint | KiCad `Button_Switch_SMD:SW_SPDT_CK_JS102011SAQN` |
| Class | C&K JS102011SAQN / Alps SSSS8-equivalent right-angle SMD SPDT |
| Sites | `SW_PWR`, `SW_MUTE` |
| Orientation | Actuator toward south (bottom) edge |
| Exact LCSC/JLC MPN | Chosen at footprint import; must match land pattern, throw, and actuator height vs the Z stack (PCB front at 4.5 mm) |

PCM12 (`SW_SPDT_PCM12`) is retired for this board.

### PCB notches

Each switch site gets a local Edge.Cuts notch (or scallop) on the south edge:

- Pads and pour keep **≥0.5 mm** clearance to the outline.
- Body/actuator may overhang into the notch / wall cavity so the paddle sits
  where the tip pocket needs it.
- Notch size is derived from the chosen footprint fab outline + assembly
  clearance; not a full-width board trim.

Placement Y moves south from the current PCM12 `y = 86.5` as required by the
chosen part — do not preserve 86.5 if it leaves the paddle short of the tip.

## Shell tip

Two identical tip shapes (power and mute). Colour differentiation is optional
later; v1 is geometry-only.

| Dim | Target |
|---|---|
| Thumb face | ~6 × 3 mm, slight crown |
| Proud of outer wall | 0.6–1.0 mm |
| Travel | Switch throw (~2 mm class) + ~0.2 mm slack each end |
| Tip Z center | On the paddle above F.Cu — **not** mid-PCB thickness |
| Back pocket | Fork/pocket on the paddle with ~0.2–0.3 mm play |
| Rails | Captive in the front-shell bottom wall; resist pull-out once the PCB is seated |

### Shell slot

Replace the PCM12 “tunnel” cuts with slots sized to the **tip** (face + travel),
not to a recessed ultraminiature nub. Slot Z follows tip Z.

## Assembly

1. Drop each tip into its front-shell slot from the inside (captive after PCB in).
2. Seat the controller PCB so each switch paddle enters its tip pocket.
3. Close the back shell as today.
4. No adhesive on tips for v1.

## Order / fab impact

- Regenerate `shell_front.stl` (and assembly preview) with tip cavities/slots.
- Add tip solids to the order pack (separate STLs or sprued if JLC’s 10-file
  cap requires merging — prefer two tips sprued together or with a capset only
  if file count forces it).
- Rebuild PCB (footprints, outline notches, route/DRC) after part import.

## Out of scope

- Changing mute/power electrical semantics or net names beyond footprint swap.
- Soft-power / momentary replacement of the hard slide.
- Tip colourways or engraved ON/MUTE legends (nice-to-have later).
- Replacing the speaker grille or face SKQG station layout.

## Acceptance

- Bare finger can find and throw both tips without a fingernail hunt.
- Tips stay captive through normal handling; shell (not solder) hits end of travel.
- DRC clean with notches and new footprints.
- 3D overlay: tip pocket engages paddle in both switch positions; no mid-PCB
  slot alignment.

## Pointers

| Doc / path | Role |
|---|---|
| `2026-07-09-handheld-card-power-switch-design.md` | Prior art: shell guides knob; joints see actuation only |
| `2026-07-31-pocket-card-mechanical-controls-design.md` | Parent edge layout / mute semantics |
| `2026-07-31-pocket-card-skqg-rear-connectors-design.md` | SKQG + rear JST; edge slides were deferred here |
| `hardware/pocket_card/case/{params,shell_front,pcb,build_variants}.py` | Implementation surface |
