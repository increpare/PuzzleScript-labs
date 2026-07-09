# PuzzleScript Card — block diagram

Status: PCB reset baseline (2026-07-08). Custom **116 x 106 mm** two-sided
PCB; not a dev-kit carrier. Mechanical anchors: `mechanical/layout.json`.
The reset baseline uses **one large rear 1S pouch**, low and centered, with the
ESP32-P4 module above it and the power cluster near the pouch tabs. See
`docs/superpowers/specs/2026-07-08-handheld-card-reset-design.md`.

## System overview

```mermaid
flowchart TB
    subgraph edge [Edge / user]
        USBC[USB-C mid-mount]
        PWR[Power pill]
        VOL[Volume rocker]
        FFC[DSI FFC 15-pin]
        PIEZO_PADS[Piezo wire pads]
    end

    subgraph power [Power block]
        LATCH[Pushbutton latch / SYSOFF]
        CHG[1S charger + power path]
        GAUGE[Fuel gauge I2C]
        BUCK[3V3 buck-boost]
        PANEL_SW[Panel load switch]
        CELL[LiPo pouch 1S]
    end

    subgraph compute [Compute block]
        MOD[ESP32-P4-Module-32MB<br/>25x25 castellated]
    end

    subgraph display [Display block]
        PANEL[WS24773 4.3 DSI QLED]
    end

    subgraph io [Controls + UX]
        SW[4x D-pad dome + face/edge switches]
        RGB[Side RGB LEDs]
        LRA[DRV2605 + LRA]
        PZ_DRV[Piezo driver]
    end

    subgraph storage [Storage]
        SD[microSD socket]
    end

    USBC --> CHG
    CELL --> CHG
    PWR --> LATCH
    LATCH --> CHG
    LATCH --> MOD
    CHG --> BUCK
    BUCK --> MOD
    BUCK --> PANEL_SW
    PANEL_SW --> PANEL
    GAUGE --> CELL
    MOD --> GAUGE
    MOD --> FFC
    FFC --> PANEL
    MOD --> SW
    MOD --> RGB
    MOD --> LRA
    MOD --> PZ_DRV
    PZ_DRV --> PIEZO_PADS
    MOD --> SD
    MOD --> USBC
    VOL --> MOD
```

## Power tree

```
USB-C VBUS (5 V) ──┬──► Charger IC (e.g. BQ24075-class)
                   │         │
1S LiPo (3.0–4.2 V)┘         ├──► SYS rail (~3.3–5 V switched)
                             │         │
                             │         ├──► 3V3 buck-boost (~1 A cont., >=500 mA display headroom)
                             │         │         ├──► ESP32-P4-Module (ESP_3V3 ×2, ESP_EN)
                             │         │         ├──► Logic, I2C, SD, LEDs, piezo driver
                             │         │         └──► Panel load switch ──► +3V3_PANEL (FFC pin 14 + local bulk)
                             │         │
                             │         └──► (optional) charge-path load when USB present
                             │
                             └──► Fuel gauge sense (I2C, cell voltage/current)

Power pill ──► U7 pushbutton latch / SYSOFF block ──► ESP_EN + charger SYSOFF
```

Budget (from spec, owner-confirmed):

| Rail | Budget | Notes |
|------|--------|-------|
| Panel 3V3 | ~400 mA peak | Backlight on module; no boost on card |
| P4 module | ~200 mA avg bursts | Compile/redraw peaks higher, short duty |
| Rest | &lt;50 mA | SD, I2C, haptics, LEDs |

## Block inventory (reset baseline)

| ID | Block | Function | Candidate parts (JLC-friendly) |
|----|-------|----------|--------------------------------|
| **U1** | Compute | P4 + C6 WiFi, 32 MB flash, 32 MB PSRAM | **Waveshare ESP32-P4-Module-32MB** |
| **U2** | Charger | 1S linear charger, power path, SYSOFF | TI BQ24075 baseline |
| **U3** | Fuel gauge | SOC %, alert | MAX17048 / CW2015 |
| **U4** | Buck-boost | Regulated 3V3 from 1S LiPo | TI TPS63070 baseline / TPS63802 alternate |
| **U6** | Panel load switch | Gate display 3V3 in sleep | TPS22918 / TPS22919 class |
| **U7** | Power latch | Pushbutton latch-off, ESP_EN, charger SYSOFF | LTC2954 / MAX16054 class, exact topology pending |
| **J1** | USB-C | Mid-mount, USB 2.0, 5 V charge | CUI / Korean Hrop 16-pin mid-mount |
| **J2** | Battery | One rear 1S pouch, low/centered; pads or low-profile connector after cell choice | 403048-class baseline; 503048/603048 only with rear recess/thicker band |
| **J3** | DSI FFC | 15-pin 1.0 mm, top edge | Molex 505110-1510 class |
| **J4** | microSD | Push-push, internal | — |
| **U5** | Haptic | I2C LRA driver | DRV2605L |
| **Q1/U8/R7** | Piezo | Simple transistor drive plus DNP boost/H-bridge escape path | SOT23 BJT + DNP driver + 0R return link |
| **SW1-SW4** | D-pad | Four separate direction buttons | TL3315NF160Q-class 4.5 x 4.5 x 1.2 mm dome tact |
| **SW5-SW8** | Face/Menu | Action/Undo/Restart/Menu | KMR2 baseline, TL3315 face-button check pending |
| **SW9-SW10** | Edge switches | Power + volume | Panasonic EVP-AKE31A class |
| **D*** | RGB | Side-firing into shell | 3× 3227 or 2835 side LED |

## Signal priorities (layout order)

1. **MIPI DSI** — 100 Ω diff, length-matched, short, 4-layer reference plane.
2. **USB D+/D−** — 90 Ω diff, direct module USB pins to USB-C.
3. **3V3 high-current** — wide pours to FFC + module; bulk caps at FFC, module, buck-boost.
4. **I2C** — fuel gauge + DRV2605 on one bus, pull-ups near module.
5. **Everything else** — GPIO switches, SD, piezo, RGB.

## Compute choice (locked spin 1)

**ESP32-P4-Module-32MB** (Waveshare), not chip-down, not a NANO dev board.

- 25 × 25 mm, 1 mm castellated edge — reflow onto card PCB.
- DSI lanes broken out on module pins 34–39 — route to FFC only.
- USB HS on pins 48–49 — route to USB-C.
- WiFi via C6 co-processor (not required for v1 gameplay; antenna keep-out on back).

Chip-down ESP32-P4NRW32 remains a spin-2 slimming option if Z-stack demands it.

## Debug / test (back of PCB)

Test pads (no connector in v1): UART TX/RX, EN, BOOT, 3V3, GND, optional JTAG strapped
to module C6 or P4 debug pins per firmware needs.

## Related files

- `PIN_BUDGET.md` — nets, GPIO map, connector pinouts
- `schematic/blocks.json` — machine-readable block list for schematic-as-code
- `docs/superpowers/notes/2026-07-08-handheld-card-pcb-handoff.md` — BOM notes
