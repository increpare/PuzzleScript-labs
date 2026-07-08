# PuzzleScript Card - Spin 1 Component Selection

Date: 2026-07-09. Status: working selection for footprint import and PCB layout.

This document turns the reset layout into a real component direction. It uses
the attached handheld-controls research report where it applies, but it does
not force console parts into places where the PuzzleScript Card constraints are
different.

## Rules For This Pass

- Prefer SMT parts that can be placed by the PCB assembler.
- Lock player-facing or mass-critical parts first: display FFC, USB-C, buttons,
  edge controls, battery, haptic, and piezo pads.
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

## Selected Parts

| Block | Spin 1 pick | Package / footprint direction | Status | Notes |
|---|---|---|---|---|
| Compute | Waveshare ESP32-P4-Module-32MB | 25 x 25 mm castellated module | Locked | Already selected. Place on back above battery, with antenna keep-out. |
| Display assembly | Waveshare 43H-800480 / 4.3-DSI-A no-touch | External module, 15-pin 1.0 mm DSI FFC | Locked | Keep current 105.42 x 67.07 mm module blockout. |
| DSI connector | 15-pin 1.0 mm right-angle FFC, Hirose FH12-15S-1SH(55) class | SMT FFC/FPC connector | Selected, verify contact side | Must match the Waveshare/Raspberry-Pi-style DSI cable orientation before routing. |
| USB-C | 16-pin USB-C 2.0 mid-mount receptacle, HRO/Korean Hrop mid-mount class | SMT/mid-mount with shell stakes | Selected class, exact footprint pending | The case cutout and board notch must match the exact EasyEDA/KiCad footprint. |
| Battery | One 1S LiPo pouch in the 58 x 30 mm rear pocket | Target 503048 or 603048 family, tabs/leads toward PMIC cluster | Envelope locked, supplier pending | Prefer welded tabs or low-profile lead exit over a tall JST on the active PCB area. |
| Charger / power path | TI BQ24075RGTR | 3 x 3 mm VQFN-16 | Baseline | Standalone 1S charger with power path and SYSOFF. BQ25188 is the newer-I2C alternate if stock/footprint is better. |
| Fuel gauge | MAX17048G+T10 | 2 x 2 mm TDFN-8, not WLP | Baseline | Simple 1S I2C gauge, no sense resistor. |
| 3V3 regulator | TI TPS63070RNM family | 3 x 2.5 mm QFN buck-boost | Baseline | Replaces the old TPS62135 buck placeholder. |
| Front controls SW1-SW8 | C&K KMR211NG LFS | Low-profile SMT tact under guided plungers | Baseline from report | Good spin-1 COTS clicky option. Use one switch family for D-pad, Action, Undo, Restart, and Menu if it fits. |
| Front-control fallback | Omron B3U-1000P | Ultra-small SMT tact | Fallback | Use only where the KMR2 footprint or actuator height does not fit. |
| Edge power / volume | Panasonic EVP-AKE31A | IP67 side-push SMT tact | Baseline from report | Better edge-control feel/durability than generic side tacts. |
| Edge-control fallback | Panasonic EVQ-P7A01P | Side-operational SMT tact | Fallback | Cheaper and well documented, but higher force and lower cycle rating than EVP-AK. |
| Haptic driver | TI DRV2605L | VSSOP-10 preferred for hand assembly/debug, DSBGA only if needed | Baseline | I2C LRA/ERM driver with library and auto-resonance support. |
| Haptic actuator | Coin LRA, about 10 mm diameter, 3 mm class | Wire pads or SMT spring pads | Envelope selected, supplier pending | Tune location after battery mass is fixed. |
| Audio | 16-20 mm piezo disc in shell | Wire pads on PCB, disc bonded to shell | Baseline | Keep the centered piezo pad/grille. Use a simple transistor drive first. |
| microSD | Low-profile SMT microSD socket | Internal/service-only | Candidate | Not mechanically sacred; pick the easiest stocked footprint during layout. |
| Debug | Bare test pads | 1.27/2.0 mm pad grid on back | Locked approach | No through-hole debug connector in spin 1. |
| RGB case LEDs | Side-firing SMT RGB LEDs | 2020/3227 side-view class | Candidate | Choose from stocked EasyEDA/JLC parts when the shell light-pipe geometry is final. |

## Controls Decision From The Research Report

The report says membrane D-pads and face buttons are still the best route for
Nintendo-like feel. That is true, but it is not the best first PCB spin for this
card. A membrane stack would require custom carbon contacts, silicone geometry,
cap travel tuning, and tighter case iteration before the electronics layout can
settle.

For spin 1, use COTS SMT tact switches under guided caps/plungers. The report's
`C&K KMR2`, `Omron B3U`, and Panasonic side-switch recommendations map cleanly
to our current mechanical plan. Membrane input remains a later feel-improvement
experiment, not the first routing baseline.

## Placement Consequences

- `SW1`-`SW8`: place on the front at the mechanical anchors in
  `mechanical/layout.json`.
- `SW9`, `SW10A`, `SW10B`: place at the top/right edge anchors; confirm actuator
  direction against the case before routing.
- `J3`: place at `CONN_DSI_FFC`; route DSI before anything else.
- `J1`: place at `CONN_USB_C_MID`; confirm mid-mount geometry against shell
  opening before finalizing edge cuts.
- `J2` / pouch: keep the rear 58 x 30 mm keep-out sacred. Route BAT+/GND to
  charger/gauge with short, wide paths.
- `U4`: place near U2/J2 in the PMIC cluster. Treat it as a noisy switching
  supply and keep it away from the DSI pairs.

## Must Verify Before PCB Routing Is Called Ready

- Exact pouch supplier, nominal thickness, swelling allowance, protection
  circuit, tab/lead exit, and connector/pad style.
- DSI FFC contact side and cable exit direction with the actual Waveshare panel.
- USB-C mid-mount part height, board cutout, shell opening, and assembly support.
- EasyEDA/JLC availability and assembly tier for every selected SMT part.
- KMR2 actuator height against printed caps and shell travel.
- Whether the LRA should be wired, spring-contacted, or glued with service loops.

## Source Notes

- Local research report: `hardware/card/COMPONENTS_REPORT.md`.
- TI BQ24075 product page: https://www.ti.com/product/BQ24075
- TI TPS63070 product page: https://www.ti.com/product/TPS63070
- TI DRV2605L product page: https://www.ti.com/product/DRV2605L
- ADI MAX17048 product page: https://www.analog.com/en/products/max17048.html
- Panasonic EVQ-P7A01P product page: https://industry.panasonic.com/global/en/products/control/switch/light-touch/number/evqp7a01p
- Panasonic EVP-AKE31A product page: https://industry.panasonic.com/global/en/products/control/switch/light-touch/number/evpake31a
