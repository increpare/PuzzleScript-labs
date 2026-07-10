# Waveshare 4.3″ Input Daughterboard

Eight clicky tact switches in the **PuzzleScript card control layout**, wired to the GPIO map used by `firmware/esp32p4` breadboard bring-up. Connects to the [Waveshare ESP32-P4-WIFI6-Touch-LCD-4.3](https://docs.waveshare.com/ESP32-P4-WIFI6-Touch-LCD-4.3) **40-pin expansion header** via a 10-wire dupont harness.

## Generate

```bash
make handheld_devkit_input_kicad
```

Open `input_board.kicad_pro` in KiCad 8. Review DRC, then order from JLCPCB (2-layer, 1.6 mm default is fine).

## Layout (mm, card front coordinates)

| Ref | Control | Center (X, Y) | GPIO |
|-----|---------|---------------|------|
| SW1 | D-pad Up | 22, 78.25 | 28 |
| SW2 | D-pad Down | 22, 95.75 | 29 |
| SW3 | D-pad Left | 13.25, 87 | 30 |
| SW4 | D-pad Right | 30.75, 87 | 31 |
| SW5 | Action | 89, 83 | 32 |
| SW6 | Undo | 75, 96 | 34 |
| SW7 | Restart | 92, 102 | 35 |
| SW8 | Menu | 58, 101 | 49 |

Positions come from `tools/handheld_blockout/blockout.js` (`spacing: 17.5` mm D-pad).

## J1 → Waveshare 40-pin

**J1** is a **1×10 2.54 mm male header** on the daughterboard. Run dupont wires to the expansion header on the **same GPIO numbers** you used on breadboard:

| J1 pin | Signal | Wire to |
|--------|--------|---------|
| 1 | GND | GND on expansion header |
| 2 | GPIO28 | D-pad Up |
| 3 | GPIO29 | D-pad Down |
| 4 | GPIO30 | D-pad Left |
| 5 | GPIO31 | D-pad Right |
| 6 | GPIO32 | Action |
| 7 | GPIO34 | Undo |
| 8 | GPIO35 | Restart |
| 9 | GPIO49 | Menu |
| 10 | GND | GND |

Do **not** use GPIO 7/8 (I2C codec), 9–13 (audio), or 53 (amp enable) on the Waveshare 4.3 board — see `gpio_map.json`.

The 40-pin header follows a Raspberry Pi HAT-style pinout; use a multimeter or the Waveshare schematic PDF to find which physical header pins are GND and your chosen GPIOs. Your breadboard wiring is the ground truth if it already works.

## BOM (JLC)

| Part | LCSC | Qty |
|------|------|-----|
| TL3315NF160Q tact | C2886877 | 8 |
| 1×10 pin header 2.54 mm | C492421 | 1 |

See `bom_jlc.csv`.

## Firmware

Default `board_buttons.cpp` pin map matches this board (GPIO 28–32, 34, 35, 49). Rebuild with `make handheld_p4_probe_build` after any wiring change.
