# PuzzleScript Card — pin budget

Spin 1: **ESP32-P4-Module-32MB** on custom card PCB. GPIO numbers are P4 GPIO
unless noted. GPIO8-GPIO11 are reserved for wake/sleep-critical controls in the
LP-capable bank; final assignment is subject to schematic ERC and module pin
availability.

## Connector pinouts

### J3 — Raspberry Pi 15-pin DSI FFC (panel side)

Standard Pi DSI mapping (WS24773 no-touch uses DSI + power; I2C pins NC).

| FFC pin | Net | Module / source |
|---------|-----|-----------------|
| 1 | GND | Power block |
| 2 | DSI_D1_N | U1 pin 35 `DSI_DATAN1` |
| 3 | DSI_D1_P | U1 pin 34 `DSI_DATAP1` |
| 4 | GND | |
| 5 | DSI_CLK_N | U1 pin 36 `DSI_CLKN` |
| 6 | DSI_CLK_P | U1 pin 37 `DSI_CLKP` |
| 7 | GND | |
| 8 | DSI_D0_N | U1 pin 39 `DSI_DATAN0` |
| 9 | DSI_D0_P | U1 pin 38 `DSI_DATAP0` |
| 10 | GND | |
| 11 | NC | No touch ID |
| 12 | NC | |
| 13 | GND | |
| 14 | +3V3_PANEL | Switched 3V3 panel rail from U6 load switch (>=400 mA path) |
| 15 | GND | |

### J1 — USB-C (mid-mount, USB 2.0 + charge)

| Function | Net | Module |
|----------|-----|--------|
| VBUS | VBUS_IN | Charger U2 |
| D+ | USB_DP | U1 pin 49 |
| D− | USB_DM | U1 pin 48 |
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

**Nets:** `I2C_SDA`, `I2C_SCL` — **candidate:** GPIO26 / GPIO27 (module pins 53–54).
4.7 kΩ pull-ups to 3V3. Route away from DSI.

## GPIO map

Active-low switches to GND with 10 kΩ pull-up to 3V3 unless LP wake requires otherwise.

| Signal | Candidate GPIO | Module pin | Physical control |
|--------|----------------|------------|------------------|
| `SW_POWER` | GPIO8 | LP bank, verify module pin | Top-edge pill; also power-latch PB input |
| `SW_DPAD_DOWN` | GPIO9 | LP bank, verify module pin | D-pad wake input |
| `SW_ACTION` | GPIO10 | LP bank, verify module pin | Action wake input |
| `PANEL_EN` | GPIO11 | LP bank, verify module pin | Enables U6 panel load switch |
| `SW_DPAD_UP` | GPIO28 | 55 | D-pad |
| `SW_DPAD_LEFT` | GPIO30 | 57 | D-pad |
| `SW_DPAD_RIGHT` | GPIO31 | 58 | D-pad |
| `SW_UNDO` | GPIO33 | 60 | Undo cap |
| `SW_RESTART` | GPIO34 | 61 | Restart cap |
| `SW_MENU` | GPIO37 | 64 | Menu pill |
| `VOL_UP` | GPIO39 | 67 | Volume rocker leg |
| `VOL_DOWN` | GPIO40 | 68 | Volume rocker leg |
| `PIEZO_PWM` | GPIO41 | 69 | Piezo driver (LEDC) |
| `LED_R` | GPIO42 | 70 | Case RGB |
| `LED_G` | GPIO43 | 71 | Case RGB |
| `LED_B` | GPIO44 | 72 | Case RGB |
| `GAUGE_ALERT` | GPIO45 | 73 | MAX17048 ALRT (optional) |

**LP wake:** `SW_POWER`, `SW_DPAD_DOWN`, and `SW_ACTION` are intentionally on
the LP-capable GPIO bank so short-press wake can preserve state. If module pin
availability forces a move, keep these three signals in the LP bank.

## SDMMC (microSD)

**Spin 1 (locked in `schematic/connectivity.json`): SPI** on GPIO46–49 → internal
microSD socket. Service-only; acceptable for v1.

4-bit SDIO remains an option if bring-up needs faster transfers — update
`connectivity.json` and re-run `make handheld_card_schematic_tests`.

## Module control nets

| Net | Module pin | Card connection |
|-----|------------|-----------------|
| `ESP_3V3` | 85, 86 | 3V3 buck-boost, local 10 uF + 0.1 uF |
| `GND` | multiple | Solid plane |
| `ESP_EN` | 87 | Driven by U7 power-latch / enable controller, not directly by the pill |
| `BOOT` | 62 (GPIO35) | Test pad + optional button |
| `BOOT_EN` | 63 (GPIO36) | 10 kΩ pull-up 3V3 |
| `VBAT` | 84 | Optional tie to BAT+ for LP domain (per module wiki) |

## Reserved / do not use on card

| Module resource | Reason |
|-----------------|--------|
| CSI pins 41–46 | No camera |
| Ethernet | Not populated |
| C6 UART/JTAG 4–14 | Leave NC unless debug harness |
| Antenna pad | Keep-out on back shell; optional IPEX not in v1 |

## Power / enable logic (draft)

```
Power pill:
  - Short press: GPIO8 wake from deep sleep when rails are already latched on
  - Long press: U7 power-latch/SYSOFF path forces safe shutdown

ESP_EN: held high by U7 when system is on; U7 can drop ESP_EN / assert SYSOFF
for latch-off. +3V3_PANEL is separately gated by U6 for sleep.
```

Exact U7 topology is still a schematic sub-sheet (`power/enable_logic`); it
must be designed before footprint import and must satisfy parent spec
battery-safe shutdown.

## Firmware mapping note

`firmware/esp32p4` supports both targets via `menuconfig` → **Target board**:

- **Waveshare 7B** (default) — `board_waveshare_7b.cpp`
- **PuzzleScript Card** — `board_card_pins.hpp` + `board_card.cpp` (`CONFIG_PS_BOARD_CARD`)

Card GPIO table matches the map above; wake buttons use GPIO8-GPIO10, gameplay
buttons also use GPIO28, GPIO30-GPIO34, and GPIO37.

## Checklist before schematic capture

- [ ] Confirm SDIO pin mux vs GPIO map in ESP-IDF for ESP32-P4
- [ ] Pick exact charger IC (ship mode + power path)
- [ ] Verify mid-mount USB-C footprint height in the 9.5 mm display-zone Z-stack
- [ ] Verify U7 power-latch/SYSOFF topology before importing final footprints
- [ ] Run `make handheld_pcb_export` and place J3 at `CONN_DSI_FFC` anchor
