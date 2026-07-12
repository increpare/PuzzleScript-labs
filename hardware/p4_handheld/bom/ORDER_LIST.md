# Week-1 bring-up order list

Date: 2026-07-12. Purpose: put every long-lead physical unknown in flight in
one ordering pass, so firmware bring-up and panel validation run in parallel
with PCB layout. Nothing on this list blocks layout; everything on it
de-risks the first (and intended only) board spin. Prices are estimates at
order time — the point is that the whole basket is under ~$100.

## The unlock: firmware starts now

| Item | Qty | ~Price | Why |
|---|---|---|---|
| Waveshare **ESP32-P4-NANO** devkit | 1 | ~$30 | Same P4, same SDMMC pins (GPIO39–44), same 15-pin DSI connector as our board. The entire firmware phase (DSI bring-up, renderer, cartridge loader, input, I2S audio) runs on it with zero custom hardware. |

## Panels

| Item | Qty | ~Price | Why |
|---|---|---|---|
| Waveshare **2.8inch DSI LCD** (the DSI one, not the DPI variant) | 1–2 | ~$25 ea | Primary panel; plugs straight into the P4-NANO. On arrival: measure the full assembly stack (glass + adapter PCB) with calipers and record it in PANEL_RESEARCH.md — this closes the thickness check. |
| Bare MIPI-DSI panel candidates | 2–3 | ~$8–15 ea | The thin-product hedge. Search AliExpress/Panelook for: 2.8–3.4", 480×640 or similar, **MIPI DSI 1–2 lane**, bare FPC (no adapter board), controller named in the listing (ST7701S-class preferred — esp_lcd driver exists). Only buy listings that publish the FPC pinout or datasheet. On arrival: thickness, FPC pin count/pitch, and whether the controller/init is documented. |

## Button coupon parts (feeds GATE-BUTTON-COUPON, same basket)

| Item | Qty | ~Price | Why |
|---|---|---|---|
| ALPS SKRH-class 5-way navigation switch | 3–5 | ~$2 ea | Leading nav candidate (pocket-card research carries over) |
| TL3315NF160Q-class low-profile tacts | 10 | ~$3 | Direction/face button candidate |
| KMR2-class side tacts | 10 | ~$2 | Face/edge button candidate |
| Stainless snap domes assortment | 1 pack | ~$8 | Dome-on-pad candidate |

## Small electrical odds and ends

| Item | Qty | ~Price | Why |
|---|---|---|---|
| FH12-15S (or clone) 15-pin 1.0 mm FFC connectors + a few 15-pin cables, both same-side and opposite-side | 5 + cables | ~$8 | Closes `GATE-PANEL-FFC-CONTACT` by measurement instead of assumption; spares for the board build |
| MAX98357A breakout board | 1 | ~$6 | I2S audio development on the devkit before our board exists |
| Small 8 Ω dynamic speakers, 15–20 mm | 2–3 | ~$5 | Speaker selection (`GATE-SPEAKER-SELECT`) |

## Deliberately NOT in this order

- **ESP32-P4 chips (U1):** blocked on the NRW32-vs-NRW32X revision check with
  JLC (see AVAILABILITY.md) — resolve by support ticket, not by ordering.
- **Battery:** gated on measured cavity at the mechanical phase.
- **PCBs:** layout hasn't started; the entire point of this basket is that
  boards get ordered once, after the panels and buttons have been measured.

## What runs in parallel once this ships

1. Firmware bring-up on the P4-NANO + 2.8" panel (days after arrival).
2. PCB layout with the dual display connector hedge: J3 (15-pin FFC, proven
   path) + a DNP bare-panel FPC footprint and DNP backlight boost, per
   PANEL_RESEARCH.md §Dual-footprint decision.
3. Button coupon on arrival of switches (mechanical, no PCB needed for the
   first feel test).
