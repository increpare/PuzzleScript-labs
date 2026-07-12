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

The firmware must link only the native runtime. This check must print no paths:

```bash
rg '/src/compiler/' firmware/pocket_card/build/puzzlescript_pocket_card_probe.map
```

## Flash and capture

```bash
ls /dev/cu.usbmodem*
export POCKET_CARD_PORT=/dev/cu.usbmodem2101
make pocket_card_probe_flash
make pocket_card_probe_capture
```

Replace the example port with the device path printed by `ls`.

Stop the ESP-IDF monitor with Ctrl-]. The capture gate requires passing
`BOOT`, `LOAD_IR`, `CREATE_RUNTIME`, `LOAD_LEVEL`, `INPUT_TRACE`, and `UNLOAD`
phases, no allocation or parse errors, and samples from both the internal and
SPIRAM heap regions.

Track 0 is complete only after the host tests and firmware build pass and one
physical ES3C28P capture passes the serial-log gate. Display, storage, audio,
battery, touch-controller discovery, and MCP23017 work belong to the next plan.
