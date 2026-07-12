# Pocket Card Track 0 usage

## Host verification

```bash
cmake -S . -B build
make pocket_card_contract_tests
make pocket_card_fixture
cmake --build build --target pocket_card_runtime_fixture
ctest --test-dir build --output-on-failure -R '^pocket_card_runtime_fixture$'
```

The Pocket Card firmware contains the native runtime only. Its IR fixture is
generated on the desktop by `make pocket_card_fixture` before the firmware
build.

## ESP-IDF build

The repository's verified environment is ESP-IDF 5.4.4:

```bash
source "$HOME/esp/esp-idf/export.sh"
make pocket_card_probe_build
```

The firmware must link only the native runtime. Check the linker map with:

```bash
make pocket_card_probe_check_map
```

The check succeeds silently when the map contains no compiler source paths. If
compiler sources are present, it prints the matches and an error, then its
recipe exits 1 (`make` reports `Error 1`). A missing or unreadable map exits 2.
Set `POCKET_CARD_MAP` to check a map at a different path.

## Flash and capture

On macOS, detect the serial device and capture the probe log with:

```bash
ls /dev/cu.usbmodem*
export POCKET_CARD_PORT=/dev/cu.usbmodem2101
make pocket_card_probe_flash
make pocket_card_probe_capture
```

Replace the example port with the device path printed by `ls`. Linux devices
are commonly named `/dev/ttyACM*`, while Windows devices are named `COMx` such
as `COM3`. On every platform, assign the detected device to `POCKET_CARD_PORT`
before running the flash, monitor, or capture target.

Stop the ESP-IDF monitor with Ctrl-]. The capture gate requires passing
`BOOT`, `LOAD_IR`, `CREATE_RUNTIME`, `LOAD_LEVEL`, `INPUT_TRACE`, and `UNLOAD`
phases, no allocation or parse errors, and samples from both the internal and
SPIRAM heap regions.

## Offline log

```bash
make pocket_card_probe_summarize POCKET_CARD_LOG=path/to/probe.log
make pocket_card_probe_check_log POCKET_CARD_LOG=path/to/probe.log
```

The summarize target writes a JSON report without enforcing capture
completeness. The check-log target applies the full six-phase and two-heap
capture gate.

Track 0 is complete only after the host tests and firmware build pass and one
physical ES3C28P capture passes the serial-log gate. Display, storage, audio,
battery, touch-controller discovery, and MCP23017 work belong to the next plan.
