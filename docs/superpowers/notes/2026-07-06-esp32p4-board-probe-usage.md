# ESP32-P4 Board Probe Usage

The ESP32-P4 board probe targets the Waveshare ESP32-P4-WIFI6-Touch-LCD-7B.
It verifies the first hardware slice for the PuzzleScript handheld: boot logs,
heap snapshots, display diagnostics, TF-card game loading, and one rendered
PuzzleScript board frame.

## Build

Activate ESP-IDF first, then run:

```bash
make handheld_p4_probe_build
```

The firmware project lives at:

```bash
firmware/esp32p4
```

## Flash And Monitor

Set the serial port for the connected board:

```bash
make handheld_p4_probe_flash ESP32P4_PORT=/dev/cu.usbmodemXXXX
make handheld_p4_probe_monitor ESP32P4_PORT=/dev/cu.usbmodemXXXX
```

## SD Card

Format a TF card as FAT and create:

```bash
/games
```

Copy one or more PuzzleScript `.txt` games into that directory. To run the
current memory-audit outlier, copy it as:

```bash
/games/at-the-hedges-of-time.txt
```

## Expected Serial Events

The probe prints JSON-lines through ESP logging. Important event names:

- `boot`
- `phase`
- `heap`
- `diagnostic`

Required phase names:

```text
BOOT
DISPLAY_INIT
STORAGE_INIT
LOAD_SOURCE_FLASH
COMPILE_SOURCE
CREATE_RUNTIME
LOAD_LEVEL
RENDER_FRAME
RUN_INPUT_TRACE
UNLOAD_GAME
LOAD_SOURCE_SD
```

The first useful success run has `pass` for `BOOT`, `DISPLAY_INIT`,
`COMPILE_SOURCE`, `CREATE_RUNTIME`, `LOAD_LEVEL`, and `RENDER_FRAME` for
`embedded:sokoban_basic.txt`.
