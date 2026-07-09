# PuzzleScript Card — pin budget

Spin 1: **ESP32-P4NRW32X chip-down** (QFN104 10×10, no radio) on the card PCB —
see `docs/superpowers/specs/2026-07-09-handheld-card-chip-down-design.md`.
GPIO numbers are P4 chip GPIOs; QFN pin numbers are assigned at schematic
capture from the ESP32-P4 datasheet. GPIO9-GPIO11 are reserved for
wake/sleep-critical controls in the LP-capable bank (GPIO8 is a spare LP pin
since the power pill was replaced by a slide switch, see
`docs/superpowers/specs/2026-07-09-handheld-card-power-switch-design.md`);
final assignment is subject to schematic ERC.

## Connector pinouts

### J3 — Raspberry Pi 15-pin DSI FFC (panel side)

Standard Pi DSI mapping (WS24773 no-touch uses DSI + power; I2C pins NC).

| FFC pin | Net | Source |
|---------|-----|--------|
| 1 | GND | Power block |
| 2 | DSI_D1_N | U1 `DSI_DATAN1` (QFN pin at capture) |
| 3 | DSI_D1_P | U1 `DSI_DATAP1` |
| 4 | GND | |
| 5 | DSI_CLK_N | U1 `DSI_CLKN` |
| 6 | DSI_CLK_P | U1 `DSI_CLKP` |
| 7 | GND | |
| 8 | DSI_D0_N | U1 `DSI_DATAN0` |
| 9 | DSI_D0_P | U1 `DSI_DATAP0` |
| 10 | GND | |
| 11 | NC | No touch ID |
| 12 | NC | |
| 13 | GND | |
| 14 | +3V3_PANEL | Switched 3V3 panel rail from U6 load switch (>=400 mA path) |
| 15 | GND | |

### J1 — USB-C (mid-mount, USB 2.0 + charge)

| Function | Net | Source |
|----------|-----|--------|
| VBUS | VBUS_IN | Charger U2 |
| D+ | USB_DP | U1 USB PHY D+ |
| D− | USB_DM | U1 USB PHY D− |
| CC1/CC2 | Rd 5.1 kΩ | Each to GND (sink) |
| SBU | NC | |
| Shield | GND | |

### J2 — Battery (1S pouch)

| Pin | Net |
|-----|-----|
| + | BAT+ → charger / gauge sense |
| − | GND |

## I2C bus (shared)

| Addr | Device | Function |
|------|--------|----------|
| 0x36 | MAX17048 (typ.) | Fuel gauge |
| 0x5A | DRV2605L | Haptic |

**Nets:** `I2C_SDA`, `I2C_SCL` — **candidate:** GPIO26 / GPIO27.
4.7 kΩ pull-ups to 3V3. Route away from DSI.

## GPIO map

Active-low switches to GND with 10 kΩ pull-up to 3V3 unless LP wake requires otherwise.

QFN-104 pin numbers for each GPIO come from the ESP32-P4 datasheet at
schematic capture; the map below is by chip GPIO.

| Signal | Candidate GPIO | Physical control |
|--------|----------------|------------------|
| (spare, LP bank) | GPIO8 | Freed by power slide switch; keep for future LP use |
| `SW_DPAD_DOWN` | GPIO9 (LP bank) | D-pad wake input |
| `SW_ACTION` | GPIO10 (LP bank) | Action wake input |
| `PANEL_EN` | GPIO11 (LP bank) | Enables U6 panel load switch |
| `SW_DPAD_UP` | GPIO28 | D-pad |
| `SW_DPAD_LEFT` | GPIO30 | D-pad |
| `SW_DPAD_RIGHT` | GPIO31 | D-pad |
| `SW_UNDO` | GPIO33 | Undo cap |
| `SW_RESTART` | GPIO34 | Restart cap |
| `SW_MENU` | GPIO37 | Menu pill |
| `VOL_UP` | GPIO39 | Volume rocker leg |
| `VOL_DOWN` | GPIO40 | Volume rocker leg |
| `PIEZO_PWM` | GPIO41 | Piezo driver (LEDC) |
| `LED_R` | GPIO42 | Case RGB |
| `LED_G` | GPIO43 | Case RGB |
| `LED_B` | GPIO44 | Case RGB |
| `GAUGE_ALERT` | GPIO45 | MAX17048 ALRT (optional) |

**LP wake:** `SW_DPAD_DOWN` and `SW_ACTION` are intentionally on the LP-capable
GPIO bank so idle deep sleep can wake on input. This is an optional
battery-saver, not the power model: on/off is a physical slide switch. If
pin-mux constraints force a move, keep these two signals in the LP bank.

**D-pad switch stack:** `SW_DPAD_*` are four separate TL3315-class dome tacts,
not a one-piece rocker. Firmware must ignore or otherwise resolve opposite
direction pairs (`UP+DOWN`, `LEFT+RIGHT`) before emitting gameplay input.

## SDMMC (microSD)

**Spin 1 (locked in `schematic/connectivity.json`): SPI** on GPIO46–49 → internal
microSD socket. Service-only; acceptable for v1.

4-bit SDIO remains an option if bring-up needs faster transfers — update
`connectivity.json` and re-run `make handheld_card_schematic_tests`.

## Chip support nets (chip-down)

All values/pins copied from the Espressif ESP32-P4 chip-down reference design
at schematic capture; deviations must be justified.

| Net | Card connection |
|-----|-----------------|
| `VDD_3V3` (all supply domains) | 3V3 buck-boost, decoupling network per reference design |
| `GND` | Solid plane + QFN thermal pad |
| `ESP_EN` | 10 kΩ pull-up to 3V3 (R5) + TP4 test pad; no latch IC — power is controlled by the slide switch on U4 EN |
| `XTAL_IN`/`XTAL_OUT` | X1 40 MHz crystal + load caps |
| `FLASH_CLK/CS/D0-D3` | U9 QSPI NOR flash (voltage domain per reference design) |
| `DCDC_L`/`DCDC_FB` | L1 inductor for the P4 internal DC-DC |
| `BOOT` (GPIO35) | Test pad + optional button; verify full strap set per datasheet |
| `BOOT_EN` (GPIO36) | 10 kΩ pull-up 3V3; verify against chip strap requirements |

## Reserved / do not use on card

| Chip resource | Reason |
|---------------|--------|
| MIPI CSI | No camera |
| Ethernet MAC | No PHY populated |
| Radio | None — chip-down design has no ESP32-C6; no antenna, no keep-out |

## Power / enable logic (decided 2026-07-09)

```
Power slide switch (SW9, top edge, SPDT):
  - ON:  U4 (TPS63070) EN pulled to SYS  -> 3V3 up, system runs
  - OFF: U4 EN pulled to GND             -> hard off (µA-class battery drain)

Charging: BQ24075 is upstream of the switch, so charge works while off.
D4 charge LED is lit from VBUS through the charger's open-drain CHG pin.
U2 SYSOFF is tied to GND (inactive). ESP_EN is just a pull-up + test pad.
+3V3_PANEL is separately gated by U6 for idle sleep.
```

There is no U7 latch IC. Hard off is the normal off; idle deep sleep (waking
on `SW_DPAD_DOWN`/`SW_ACTION`) is an optional battery-saver while switched on.
See `docs/superpowers/specs/2026-07-09-handheld-card-power-switch-design.md`.

## Firmware mapping note

`firmware/esp32p4` supports both targets via `menuconfig` → **Target board**:

- **Waveshare 7B** (default) — `board_waveshare_7b.cpp`
- **PuzzleScript Card** — `board_card_pins.hpp` + `board_card.cpp` (`CONFIG_PS_BOARD_CARD`)

Card GPIO table matches the map above; wake buttons use GPIO9-GPIO10, gameplay
buttons also use GPIO28, GPIO30-GPIO34, and GPIO37.

## Checklist before schematic capture

- [ ] Confirm SDIO pin mux vs GPIO map in ESP-IDF for ESP32-P4
- [ ] Copy the Espressif chip-down reference schematic (crystal, flash domain, DC-DC inductor/feedback, straps, decoupling) and confirm the ESP32-P4NRW32**X** part number + JLC stock
- [ ] Pick exact charger IC (power path; ship mode not required with slide switch)
- [ ] Verify mid-mount USB-C footprint height in the 9.5 mm display-zone Z-stack
- [ ] Pick exact power slide switch part (JS102000SAQN / SSSS8 class) and verify knob/slot geometry on the 1:1 sheet
- [ ] Run `make handheld_pcb_export` and place J3 at `CONN_DSI_FFC` anchor
