# P4 Handheld — pin budget

ESP32-P4NRW32X chip-down (QFN104 10×10). GPIO numbers are P4 chip GPIOs; QFN
pin numbers are assigned at schematic capture from the ESP32-P4 datasheet.

Sources:

- `hardware/card/PIN_BUDGET.md` — starting map (deviations noted below)
- [ESP32-P4 datasheet v1.3](https://documentation.espressif.com/esp32-p4-chip-revision-v1.3_datasheet_en.pdf) — straps, dedicated pins
- [esptool ESP32-P4 boot mode selection](https://docs.espressif.com/projects/esptool/en/latest/esp32p4/advanced-topics/boot-mode-selection.html) — strap levels
- Waveshare ESP32-P4-NANO BSP (`esp32_p4_nano.h`) — proven SDMMC/I2C/I2S
  assignments on working P4 hardware

## Dedicated pins (not assignable)

| Resource | Pins | Note |
|---|---|---|
| MIPI DSI | dedicated D-PHY pads (2 data lanes + clock) | to J3 FFC; nets `DSI_D0_P/N`, `DSI_D1_P/N`, `DSI_CLK_P/N` |
| USB 2.0 | dedicated USB pads | `USB_DP`/`USB_DM` to J1; serves flashing (USB-Serial-JTAG/download) and OTG; confirm pad naming at capture |
| Flash domain | `FLASH_CLK/CS/D0-D3` + `VDD_FLASHIO` | U9 QSPI NOR per Espressif reference |
| Crystal | `XTAL_IN`/`XTAL_OUT` | X1 40 MHz |
| Internal DC-DC | `DCDC_L`/`DCDC_FB` | L1 2.2 µH |
| MIPI CSI | unused | no camera |
| Ethernet MAC | unused | no PHY |

## Strap pins — keep clear of user inputs

| GPIO | Strap role | Board use |
|---|---|---|
| GPIO34 | JTAG signal source select | test pad only |
| GPIO35 | boot mode (with GPIO36) | `BOOT` test pad (TP3) |
| GPIO36 | boot mode; must be high for reliable serial bootloader | pull-up per datasheet, test pad |
| GPIO37 | strap + `UART0_TXD` | UART TX test pad (TP1) |
| GPIO38 | strap + `UART0_RXD` | UART RX test pad (TP2) |

**Strap audit: PASS.** No `BTN_*`, `I2S_*`, `SD_*`, `I2C_*`, or enable net is
assigned to GPIO34–GPIO38 (checked against the esptool boot-mode page and
datasheet strap table). *Deviation from the card map:* the card placed
`SW_RESTART` on GPIO34 and `SW_MENU` on GPIO37; this board keeps all buttons
off strap pins.

## Assigned GPIO map

Buttons are active-low to GND, internal pull-ups assumed (external 10 kΩ
array only if a chosen pin's internal pull is unavailable — verify at
capture). LP-capable bank (GPIO0–15) carries wake-relevant inputs so idle
light/deep sleep can wake on input; on/off remains the physical slide switch.

| Signal | GPIO | Note |
|---|---|---|
| `I2C_SDA` | GPIO7 | gauge + GT911 touch + panel ctrl `0x45`; proven on P4-NANO |
| `I2C_SCL` | GPIO8 | 4.7 kΩ pull-ups to 3V3; route away from DSI |
| `I2S_DIN` | GPIO9 | to U7 amp DIN |
| `I2S_LRCLK` | GPIO10 | |
| `I2S_BCLK` | GPIO12 | |
| `AMP_SD_MODE` | GPIO13 | amp shutdown = true mute |
| `BTN_UP` | GPIO2 | LP bank, wake-capable |
| `BTN_DOWN` | GPIO3 | LP bank, wake-capable |
| `BTN_LEFT` | GPIO4 | LP bank, wake-capable |
| `BTN_RIGHT` | GPIO5 | LP bank, wake-capable |
| `BTN_ACTION` | GPIO6 | LP bank, wake-capable |
| `BTN_UNDO` | GPIO14 | LP bank, wake-capable |
| `PANEL_EN` | GPIO15 | LP bank so sleep code can gate U6 |
| `BTN_RESTART` | GPIO20 | |
| `BTN_MENU` | GPIO21 | |
| `BTN_VOL_UP` | GPIO22 | |
| `BTN_VOL_DOWN` | GPIO23 | |
| `BTN_NAV_CENTER` | GPIO24 | diagnostics only, ignored in gameplay |
| `GAUGE_ALERT` | GPIO25 | MAX17048 ALRT, optional |
| `SD_D0` | GPIO39 | SDMMC slot, per P4-NANO |
| `SD_D1` | GPIO40 | |
| `SD_D2` | GPIO41 | |
| `SD_D3` | GPIO42 | |
| `SD_CLK` | GPIO43 | |
| `SD_CMD` | GPIO44 | |
| `UART0_TX` | GPIO37 | TP1 (strap-aware) |
| `UART0_RX` | GPIO38 | TP2 (strap-aware) |
| `BOOT` | GPIO35 | TP3 |
| `ESP_EN` | EN pad | 10 kΩ pull-up + TP4 |

## Spares (test pads)

GPIO0, GPIO1 (optional 32K crystal pads — unused, keep as spares), GPIO16,
GPIO17, GPIO18, GPIO19, GPIO26, GPIO27, GPIO45–GPIO54 remain unassigned.
One test pad per spare is added on the debug sheet at capture; at minimum
GPIO16–GPIO19 get pads in this phase.

## Chip support nets (chip-down)

Copied from the card, which copies the Espressif chip-down reference design;
deviations must be justified:

| Net | Connection |
|---|---|
| `VDD_3V3` domains | 3V3 buck-boost + decoupling per reference |
| `GND` | plane + QFN thermal pad |
| `ESP_EN` | 10 kΩ pull-up (R5) + TP4; power control is the slide switch on U4 EN |
| `XTAL_IN/OUT` | X1 + load caps |
| `FLASH_*` | U9 QSPI NOR, voltage domain per reference |
| `DCDC_L`/`DCDC_FB` | L1 2.2 µH |
| `BOOT` (GPIO35) | test pad; strap set verified above |
| GPIO36 | 10 kΩ pull-up per bootloader requirement |

## SDMMC decision

4-bit SDMMC on the proven GPIO39–44 slot (P4-NANO assignment). The card used
SPI-mode SD as service-only storage; this board's microSD is the primary
user-facing cartridge library, so it gets the real SDMMC host.
