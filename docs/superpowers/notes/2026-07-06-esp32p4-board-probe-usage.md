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

For a first bring-up run, capture monitor output and summarize it after the
monitor exits:

```bash
make handheld_p4_probe_capture ESP32P4_PORT=/dev/cu.usbmodemXXXX
```

This writes the raw monitor log to `build/esp32p4-probe.log` by default and
then writes the JSON summary to `build/esp32p4_probe_log_summary.json`. Override
the raw log path with `ESP32P4_CAPTURE_LOG=...`.

To summarize a captured monitor log, write the monitor output to a file and run:

```bash
make handheld_p4_probe_summarize ESP32P4_LOG=build/esp32p4-probe.log
```

This writes `build/esp32p4_probe_log_summary.json` by default. Override the
output path with `ESP32P4_LOG_SUMMARY_JSON=...`.

To use the captured log as a pass/fail gate, run:

```bash
make handheld_p4_probe_check_log ESP32P4_LOG=build/esp32p4-probe.log
```

The gate exits nonzero if the log has malformed JSON, no boot event, failed
phase events, or allocation failures.

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

## Log Summary

The summary tool extracts JSON payloads from ESP-IDF-style monitor lines,
ignores non-JSON driver chatter, and reports:

- latest status and elapsed time for each phase
- source-grouped phase runs for game-specific probes
- failed phase events
- per-region heap minima and largest-free-block values
- source-grouped heap samples when firmware logs include `source`
- allocation failures
- compiler diagnostics
- malformed JSON lines that need firmware escaping fixes

`handheld_p4_probe_check_log` and the post-monitor step in
`handheld_p4_probe_capture` use the same parser with `--fail-on-failure`, so a
first board run can produce both a readable JSON report and a shell-level
pass/fail result.
