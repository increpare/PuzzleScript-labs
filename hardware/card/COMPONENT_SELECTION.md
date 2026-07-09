# PuzzleScript Card - Spin 1 Component Selection

Date: 2026-07-09. Status: working selection for footprint import and PCB layout.

This document turns the reset layout into a real component direction. It uses
the attached handheld-controls research report where it applies, but it does
not force console parts into places where the PuzzleScript Card constraints are
different.

## Rules For This Pass

- Prefer SMT parts that can be placed by the PCB assembler.
- Lock player-facing or mass-critical parts first: display FFC, USB-C, buttons,
  edge controls, battery, haptic, piezo pads, and support pads.
- Let non-player-facing parts move during routing: ESP module, storage, charger,
  gauge, regulator, passives, and debug pads.
- Do not use through-hole parts unless there is a real mechanical reason.
- Do not treat live stock as permanent. Re-check EasyEDA/JLC/LCSC before final
  footprint import and order.

## Important Power Correction

The old placeholder `TPS62135` was a buck regulator. That is the wrong default
for a one-cell LiPo system if we want a regulated 3.3 V rail across the useful
battery range, because the pouch voltage can fall below 3.3 V.

Spin 1 should use a 3.3 V buck-boost regulator. The baseline is `TPS63070`.
It handles input above and below the output rail, has enough current headroom
for the display and ESP32-P4 bursts, and stays compact enough for the rear PMIC
cluster. A JLC-stocked alternate can replace it only if it is still a true
buck-boost with comparable current and layout support.

Treat the buck-boost inductor loop as a priority layout item. It is the noisiest
block on the board after USB/DSI edge rates, and the PMIC cluster sits close to
the display envelope.

## Z-Stack Decision

The 11.5 mm control/battery band does not close with a 5-6 mm pouch, a tall
front switch stack, PCB, shell, and swelling allowance all stacked on top of one another.
For the current enclosure budget, the baseline cell is therefore a 4 mm-class
`403048` pouch in the same 58 x 30 mm rear pocket. A `503048` or `603048` cell
is still acceptable only if the rear shell gets a measured recess/pocket or the
band thickness increases.

The D-pad switch decision now helps this stack: the spin-1 D-pad uses
TL3315-class 1.2 mm dome tacts instead of 1.9 mm KMR2 tacts under a rocker,
saving about 0.7 mm in the most sensitive front-control stack.

The display zone is now treated as a 9.5 mm stack target, not an 8 mm promise.
That gives the 2.9 mm panel, PCB, rear ESP32-P4 module, rear shell, and normal
clearances a plausible path. The USB-C body and display carrier overlap in plan
view, so the exact mid-mount connector footprint must be checked against the
panel/case section before routing.

## Selected Parts

| Block | Spin 1 pick | Package / footprint direction | Status | Notes |
|---|---|---|---|---|
| Compute | Waveshare ESP32-P4-Module-32MB | 25 x 25 mm castellated module | Locked | Already selected. Place on back above battery, with antenna keep-out. |
| Display assembly | Waveshare 43H-800480 / 4.3-DSI-A no-touch | External module, 15-pin 1.0 mm DSI FFC | Locked | Keep current 105.42 x 67.07 mm module blockout. |
| DSI connector | 15-pin 1.0 mm right-angle FFC, Hirose FH12-15S-1SH(55) class | SMT FFC/FPC connector | Selected, verify contact side | Must match the Waveshare/Raspberry-Pi-style DSI cable orientation before routing. |
| USB-C | 16-pin USB-C 2.0 mid-mount receptacle, HRO/Korean Hrop mid-mount class | SMT/mid-mount with shell stakes | Selected class, exact footprint pending | The case cutout and board notch must match the exact EasyEDA/KiCad footprint. |
| Battery | One 1S LiPo pouch in the 58 x 30 mm rear pocket | `403048` class baseline; tabs/leads toward PMIC cluster | Envelope locked, supplier pending | `503048`/`603048` only if rear-shell recess or thicker band is validated. Prefer welded tabs or low-profile lead exit over a tall JST on the active PCB area. |
| Charger / power path | TI BQ24075RGTR | 3 x 3 mm VQFN-16 | Baseline | Standalone 1S linear charger with power path and SYSOFF. Set ISET conservatively around 0.5 C unless thermal testing proves the sealed card can dissipate more. |
| Fuel gauge | MAX17048G+T10 | 2 x 2 mm TDFN-8, not WLP | Baseline | Simple 1S I2C gauge, no sense resistor. |
| 3V3 regulator | TI TPS63070RNM family | 3 x 2.5 mm QFN buck-boost | Baseline | Replaces the old TPS62135 buck placeholder. |
| Panel load switch | TPS22918/TPS22919 class | Small WLCSP/SON load switch | Baseline | U6 gates `+3V3_PANEL` so sleep current is not dominated by the display module. |
| Power switch | SPDT slide switch, C&K JS102000SAQN / ALPS SSSS8 class | Right-angle SMD slide, top edge | Selected class, exact part pending | Gates TPS63070 EN (signal-level, no load current). Replaces the U7 latch IC entirely — see `docs/superpowers/specs/2026-07-09-handheld-card-power-switch-design.md`. |
| Charge LED | 0603 LED + 1 kΩ from VBUS via BQ24075 `CHG` | 0603 + 0402 | Baseline | Shows charging with the power switch off; needs a light path in the shell. |
| D-pad SW1-SW4 | E-Switch TL3315NF160Q class | 4.5 x 4.5 x 1.2 mm SMT dome tact | Baseline | Arduboy-style four separate direction buttons, no rocker/pivot. Current 17.5 mm diamond spacing is only a print-test candidate. |
| Action / Undo / Restart / Menu SW5-SW8 | C&K KMR211NG LFS, evaluate TL3315NF160Q class | Low-profile SMT tact or dome tact | Candidate split | KMR2 remains a known clicky option for larger caps; TL3315 may unify feel and reduce stack if the face-button ergonomics work. |
| Front-control fallback | Omron B3U-1000P | Ultra-small SMT tact | Fallback | Use only where the preferred footprint or actuator height does not fit. |
| Edge volume | Panasonic EVP-AKE31A | IP67 side-push SMT tact | Baseline from report | Better edge-control feel/durability than generic side tacts. Power is now a slide switch, not an EVP-AK pill. |
| Edge-control fallback | Panasonic EVQ-P7A01P | Side-operational SMT tact | Fallback | Cheaper and well documented, but higher force and lower cycle rating than EVP-AK. |
| Haptic driver | TI DRV2605L | VSSOP-10 preferred for hand assembly/debug, DSBGA only if needed | Baseline | I2C LRA/ERM driver with library and auto-resonance support. |
| Haptic actuator | Coin LRA, about 10 mm diameter, 3 mm class | Wire pads or SMT spring pads | Envelope selected, supplier pending | Tune location after battery mass is fixed. |
| Audio | 16-20 mm piezo disc in shell | Wire pads on PCB, disc bonded to shell | Baseline | Keep the centered piezo pad/grille. Fit simple transistor drive first, but include DNP boost/H-bridge footprints plus a 0R return link so quiet audio is a rework, not a respin. |
| microSD | Low-profile SMT microSD socket | Internal/service-only | Candidate | Not mechanically sacred; pick the easiest stocked footprint during layout. |
| Debug | Bare test pads | 1.27/2.0 mm pad grid on back | Locked approach | No through-hole debug connector in spin 1. |
| RGB case LEDs | Side-firing SMT RGB LEDs | 2020/3227 side-view class | Candidate | Choose from stocked EasyEDA/JLC parts when the shell light-pipe geometry is final. |

## Controls Decision From The Research Report

The report says membrane D-pads and face buttons are still the best route for
Nintendo-like feel. That is true, but it is not the best first PCB spin for this
card. A membrane stack would require custom carbon contacts, silicone geometry,
cap travel tuning, and tighter case iteration before the electronics layout can
settle.

For spin 1, use COTS SMT switches, but not a one-piece tact D-pad rocker. The
owner-approved direction is Arduboy-style: four separate TL3315-class dome tacts
in a diamond, each exposed through its own small round shell opening or a
minimal loose cap. This avoids membrane stack height, rocker pivot tolerances,
and the old mushy-board-flex problem. PuzzleScript movement is strictly 4-way,
so diagonal feel is a firmware filtering problem rather than a mechanical
feature requirement.

The old membrane idea remains a spin-2 feel experiment only. The old KMR2 D-pad
baseline is superseded for SW1-SW4. KMR2 remains useful for Action/Undo/Restart
and Menu until a TL3315 face-button mockup proves the smaller dome style also
feels right there.

## Placement Consequences

- `SW1`-`SW4`: place TL3315-class dome tacts on the four separate D-pad anchors
  in `mechanical/layout.json`. Keep the current 17.5 mm diamond only as the
  first spacing candidate; print two or three tighter variants before final
  footprint placement.
- `SW5`-`SW8`: place Action, Undo, Restart, and Menu on the front at the
  mechanical anchors in `mechanical/layout.json`; decide KMR2 vs TL3315 after
  the face-button fit/feel check.
- `DPAD_SUPPORT`: keep the central D-pad shell support/standoff pad in the freed
  diamond center. It should stiffen the board without interfering with the four
  dome switch openings.
- `SW9`: power slide switch at the top-edge `SW_PWR_SLIDE` anchor; verify knob
  travel and case slot on the 1:1 sheet (the anchor sits near the corner arc).
- `SW10A`, `SW10B`: place at the right-edge volume anchor; confirm actuator
  direction against the case before routing.
- `J3`: place at `CONN_DSI_FFC`; route DSI before anything else.
- `J1`: place at `CONN_USB_C_MID`; confirm mid-mount geometry against shell
  opening before finalizing edge cuts.
- `J2` / pouch: keep the rear 58 x 30 mm keep-out sacred. Route BAT+/GND to
  charger/gauge with short, wide paths.
- `U4`: place near U2/J2 in the PMIC cluster. Treat it as a noisy switching
  supply and keep it away from the DSI pairs.
- `U6`: place close to the display FFC bulk capacitor and keep `+3V3_PANEL`
  separated from always-on logic where practical.
- `D4`/`R8`: place the charge LED where the shell can give it a light path,
  near the charger; it runs from VBUS so it works with the power switch off.
- `U8`/`R7`: keep the DNP piezo boost/H-bridge option physically near the piezo
  pads and simple transistor driver.

## Must Verify Before PCB Routing Is Called Ready

- Exact pouch supplier, nominal thickness, swelling allowance, protection
  circuit, tab/lead exit, and connector/pad style.
- Whether the enclosure stays with a 4 mm-class pouch or adds a rear recess for
  a thicker `503048`/`603048` pouch.
- Exact power slide switch part (height, travel, knob) against the top-edge
  case section, and BQ24075 ISET/thermal target.
- DSI FFC contact side and cable exit direction with the actual Waveshare panel.
- USB-C mid-mount part height, board cutout, shell opening, display overlap, and
  assembly support.
- EasyEDA/JLC availability and assembly tier for every selected SMT part.
- TL3315 D-pad actuator height, shell opening diameter, capless/loose-cap feel,
  and diamond spacing from the 1:1 print workflow.
- KMR2 vs TL3315 choice for Action/Undo/Restart/Menu.
- Whether the LRA should be wired, spring-contacted, or glued with service loops.

## Source Notes

- Local research report: `hardware/card/COMPONENTS_REPORT.md`.
- TI BQ24075 product page: https://www.ti.com/product/BQ24075
- TI TPS63070 product page: https://www.ti.com/product/TPS63070
- TI DRV2605L product page: https://www.ti.com/product/DRV2605L
- ADI MAX17048 product page: https://www.analog.com/en/products/max17048.html
- Panasonic EVQ-P7A01P product page: https://industry.panasonic.com/global/en/products/control/switch/light-touch/number/evqp7a01p
- Panasonic EVP-AKE31A product page: https://industry.panasonic.com/global/en/products/control/switch/light-touch/number/evpake31a
