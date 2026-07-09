# PuzzleScript Card - Footprint Lock Matrix

Date: 2026-07-09. Status: JLC-first footprint import pass.

This file separates package decisions that are ready to assign in KiCad from
parts that still need physical samples or EasyEDA/JLC library confirmation.
Live stock is not permanent; re-check JLC/EasyEDA/LCSC immediately before
ordering.

## Status Meanings

- **Package locked:** use this package/land-pattern direction now.
- **Class locked:** the electrical/mechanical class is fixed, but the exact
  orderable MPN or library component still needs import-time confirmation.
- **Sample gate:** do not finalize the footprint until a physical sample,
  actuator, shell slot, or supplier measurement is checked.

## Matrix

| Ref | Block | Current pick | Footprint direction | Status | Next import action |
|---|---|---|---|---|---|
| U1 | Compute | ESP32-P4NRW32X | QFN104 10 x 10 mm, 0.35 mm pitch | Package locked | Use Espressif pinout/package drawing; confirm X-revision stock and JLC assembly tier at order time. |
| U9 | Boot flash | 32 MB QSPI NOR, 3.3 V domain unless Espressif reference says otherwise | Ref-design gate | Class locked | Copy the ESP32-P4 reference flash circuit and only then choose WSON/SOIC package. Keep `+3V3` vs `VDDO_FLASH` consistent. |
| X1 | Main clock | 40 MHz crystal | Ref-design gate | Class locked | Copy Espressif load caps and package recommendation before footprint import. |
| L1 | P4 DC-DC | P4 internal DC-DC inductor | Ref-design gate | Class locked | Copy Espressif value/current/DCR recommendation before footprint import. |
| J3 | Display FFC | 15-pin 1.0 mm Raspberry-Pi-style DSI FFC, FH12 class | Right-angle 15-pin 1.0 mm, top/bottom contact TBD; Waveshare pinout captured with pins 14 and 15 both on 3V3 | Class locked | Use `DSI_PANEL_INTERFACE.md`; determine same-side/opposite-side cable parity, take the card-end photo, then choose the exact J3 contact orientation before routing DSI. |
| J1 | USB-C | HRO TYPE-C-31-M-12 USB-C 2.0 SMD receptacle | `Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12`; courtyard about 10.64 x 9.42 mm, fab body 8.94 x 7.30 mm | Package locked | Use the official KiCad footprint geometry for routing and shell-port checks; re-check JLC/EasyEDA stock/library match before ordering. |
| U2 | Charger / power path | BQ24075RGTR | VQFN-16 RGT, 3 x 3 mm | Package locked | Assign TI RGT-16 footprint; set ISET after measured cell capacity and sealed-case thermal target. |
| U3 | Fuel gauge | MAX17048G+T10 | LFCSP/TDFN-8, 2 x 2 mm | Package locked | Assign the ADI G+T10 2 x 2 mm 8-pin package, not the WLP/X variant. |
| U4 | 3V3 buck-boost | TPS63070 RNM family | VQFN-HR-15 RNM, 3 x 2.5 mm | Package locked | Assign TI RNM-15 footprint; keep inductor loop compact and away from DSI. |
| U6 | Panel load switch | TPS22919DCK | SOT-SC70-6 DCK, 2 x 2.1 mm | Package locked | Assign TI DCK-6 footprint near J3 panel bulk capacitor. |
| D4/R8 | Charge indicator | 0603 LED + 1 k resistor | 0603 + 0402 | Package locked | Place where shell can expose a small charge light path from the charger area. |
| SW1-SW4 | D-pad | TL3315NF160Q-class separate dome tacts | TL3315 4.5 x 4.5 mm class | Class locked | Import TL3315-class footprint, then verify shell opening/cap feel and diamond spacing on the print/mockup. |
| SW5-SW8 | Face/Menu buttons | KMR211NG placeholder, TL3315 alternate | KMR2 or TL3315 class | Sample gate | Do the face-button feel check before final footprint assignment. |
| SW9 | Power | SPDT right-angle slide switch | JS102/SSSS8-class SMD slide | Sample gate | Pick exact knob height/travel, then verify top-edge slot and corner-arc clearance. |
| SW10A/SW10B | Volume | Panasonic EVPAKE31A | EVPAK side-push SMD, 3.9 x 2.9 x 1.6 mm | Package locked | Assign Panasonic EVPAK footprint; verify actuator direction against the right-edge shell. |
| U5 | Haptic driver | DRV2605LDGS | VSSOP-10 DGS, 3 x 4.9 mm | Package locked | Prefer DGS over DSBGA for spin-1 debug/assembly tolerance. |
| B1 | Haptic actuator | 10 mm, 3 mm-class coin LRA | Wire/spring/glue TBD | Sample gate | Choose after battery mass and service-loop strategy are fixed. |
| JP1 | Piezo | 16-20 mm shell piezo disc | PCB wire pads | Class locked | Keep pads near centered piezo shell zone; leave room for rework wires. |
| U8/R7 | Piezo upgrade path | DNP boost/H-bridge + 0R return link | DNP footprint TBD + 0402 | Class locked | Choose DNP driver only after simple transistor drive is reviewed; keep physically near JP1. |
| J2 | Battery | 403048-class protected pouch, wired leads | JST-SH/PH-class connector TBD | Sample gate | Buy 3-5 samples from two suppliers, measure thickness/PCM/lead exit, then choose connector. |
| J4 | microSD | Internal service-only socket | Low-profile SMT socket TBD | Class locked | Pick the easiest stocked JLC footprint after main routing constraints are placed. |
| D1-D3 | Case LEDs | Side-firing RGB or discrete side LEDs | 2020/3227 side-view class | Class locked | Pick from stocked EasyEDA/JLC parts after shell light path is fixed. |
| TP1-TP4 | Debug | Bare test pads | 1.27/2.0 mm pad grid | Package locked | Keep on PCB back; no through-hole debug connector for spin 1. |

## Open Gate IDs

These gates are the remaining blockers before routing can be called ready. Keep
the IDs stable so notes, KiCad comments, and bring-up checklists can refer to
the same item. Components with open gates carry the same ID in
`schematic/connectivity.json`, and `generate_kicad.js` emits it as a hidden
KiCad symbol property named `Gate`.

| Gate | Blocks | Close when |
|---|---|---|
| GATE-ESP32-P4-REF-CAPTURE | U1/U9/X1/L1 support capture | Espressif reference schematic has been copied part-for-part: flash voltage domain, crystal/load caps, internal DC-DC inductor/feedback, straps, boot/debug pulls, and decoupling reviewed. |
| GATE-DSI-FFC-CONTACT | J3 display connector and cable | Same-side/opposite-side 15-pin cable parity, card-end contact photo, connector latch side, cable exit direction, and pin-1 orientation are verified against the Waveshare no-touch panel before DSI routing. Waveshare pinout is captured; this gate now only blocks physical orientation, not electrical pin mapping. |
| GATE-DPAD-MOCKUP | SW1-SW4 front D-pad | TL3315 actuator height, shell opening diameter, capless/loose-cap feel, board stiffness, and final diamond spacing are validated with print/mockup parts. |
| GATE-FACE-BUTTON-FEEL | SW5-SW8 footprint choice | KMR2 vs TL3315 face-button mockup is tested for capless/loose-cap feel, actuator height, opening diameter, and clearance to the front shell. |
| GATE-POWER-SLIDE-SLOT | SW9 footprint and top-edge shell | Exact SPDT slide switch MPN is selected; knob height, travel, slot length, corner-arc clearance, and OFF/ON orientation are checked on the 1:1 sheet or sample. |
| GATE-BATTERY-SAMPLE | J2 connector and pouch pocket | 3-5 protected 403048-class cells from at least two suppliers are measured for thickness, PCM position, lead exit, connector style, and fit in the 58 x 30 mm pocket. |
| GATE-LRA-MOUNT | B1 haptic actuator | Battery mass is fixed and LRA attachment is chosen: wire pads, spring contacts, adhesive with service loop, or another serviceable mounting method. |
| GATE-PIEZO-DRIVE-REVIEW | JP1/U8/R7 piezo path | Simple transistor drive and DNP boost/H-bridge option are reviewed for footprint, return link, rework access, and shell piezo wiring before final placement. |
| GATE-MICROSD-FOOTPRINT | J4 internal service socket | Low-profile SMT microSD socket is selected from available assembly/library parts after high-priority placement and routing constraints settle. |
| GATE-CASE-LED-LIGHTPIPE | D1-D3 LED footprint and shell light path | Side-firing LED package is chosen with shell wall/light-pipe geometry, current-limit strategy, and JLC/EasyEDA availability checked. |

## Closed Gate IDs

| Gate | Closed | Evidence |
|---|---|---|
| GATE-USB-C-BACK-FOOTPRINT | 2026-07-09 | J1 is locked to the official KiCad `Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12` footprint. The preview envelope remains 14 x 9 mm at `CONN_USB_C_BACK`, which covers the footprint courtyard and back-edge shell bump allowance. Live JLC/EasyEDA availability still gets rechecked immediately before ordering. |

## Import Order

1. Assign package-locked ICs first: U1, U2, U3, U4, U5, U6, D4/R8, TP pads.
2. Place mechanical anchors from `mechanical/layout.json`: J1, J3, SW1-SW10,
   J2/pouch, piezo pads, LRA envelope.
3. Leave class/sample gates visibly marked in KiCad notes until their physical
   checks close.
4. Route DSI first, buck-boost and charger loops second, USB third, then
   controls/storage/audio/haptic/LEDs.

## Sources Checked

- Espressif ESP32-P4 datasheet
  (https://www.espressif.com/sites/default/files/documentation/esp32-p4_datasheet_en.pdf):
  QFN104 package, ESP32-P4NRW32X part, v3.x X revision, and P4
  hardware-design-guideline reference.
- Espressif ESP32-P4 hardware design guidelines
  (https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32p4/index.html):
  checklist source for chip-down capture/layout review.
- Waveshare 43H-800480 product page: no-touch display option, 800 x 480 DSI,
  95.04 x 53.86 mm active area, 105.42 x 67.07 mm no-touch product outline
  (https://www.waveshare.com/43h-800480-ips.htm).
- Waveshare 43H-800480 wiki: 15-pin DSI pinout captured for J3. Pins 1/4/7/10/13
  are GND, pins 14/15 are 3V3, DSI lanes are 2-3/5-6/8-9, and the
  screen-side cable gold finger faces upward
  (https://www.waveshare.com/wiki/43H-800480-IPS).
- Waveshare 43H-800480 official STEP drawing: confirms the no-touch display
  envelope; it does not close card-end FFC contact parity by itself
  (https://files.waveshare.com/upload/c/cd/43h-800480-IPS.zip).
- TI BQ24075 page: active 1S 1.5 A charger with Power Path, SYSOFF, RGT-16
  VQFN 3 x 3 mm (https://www.ti.com/product/BQ24075).
- TI TPS63070 page: active 2 V to 16 V buck-boost, RNM-15 VQFN-HR 3 x 2.5 mm
  (https://www.ti.com/product/TPS63070).
- TI TPS22919 page: active 1.5 A load switch, DCK-6 SOT-SC70 2 x 2.1 mm
  (https://www.ti.com/product/TPS22919).
- TI DRV2605L page: active haptic driver, DGS-10 VSSOP 3 x 4.9 mm and YZF
  DSBGA options (https://www.ti.com/product/DRV2605L).
- ADI MAX17048 page: recommended for new designs; MAX17048G+T10 production,
  2 x 2 mm 8-pin package, non-WLP variant
  (https://www.analog.com/en/products/max17048.html).
- Panasonic EVPAKE31A page: side-push SMD switch, 3.9 x 2.9 x 1.6 mm, IP67,
  500k cycle rating
  (https://industry.panasonic.com/global/en/products/control/switch/light-touch/number/evpake31a).
- KiCad official `USB_C_Receptacle_HRO_TYPE-C-31-M-12` footprint:
  USB Type-C 2.0/PD HRO receptacle footprint, with HRO datasheet URL in the
  footprint description and explicit fab/courtyard geometry
  (https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/Connector_USB.pretty/USB_C_Receptacle_HRO_TYPE-C-31-M-12.kicad_mod).
