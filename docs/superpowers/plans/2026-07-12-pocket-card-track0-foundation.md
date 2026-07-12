# Pocket Card Track 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a host-tested, runtime-only ESP32-S3 firmware foundation for the ES3C28P that boots, reports memory, loads a desktop-generated PuzzleScript IR fixture, and executes a deterministic input trace without pulling the source compiler onto the device.

**Architecture:** Create new `hardware/pocket_card/` and `firmware/pocket_card/` targets rather than modifying the legacy ESP32-P4 Card. The host compiler emits the existing runtime IR JSON; the firmware links only `puzzlescript_native`, embeds that IR fixture, and emits machine-checkable serial JSON for boot, heap, load, level, and input-trace phases. Display, SD, audio, battery, controls, cartridges, and mechanics remain subsequent gated plans.

**Tech Stack:** ESP-IDF 5.4.4 targeting ESP32-S3, C++20, native PuzzleScript runtime C API, Node.js contract/generator tests, CMake/CTest, Make.

---

## Scope and roadmap boundary

The approved product spec covers several independently testable subsystems. This
plan implements only the foundation that does not require the physical display
module:

- canonical ES3C28P pin/I2C contract
- generic handheld serial-probe log tooling
- reproducible desktop IR-fixture generation
- runtime-only host load/turn test
- buildable ESP32-S3 project with PSRAM and USB serial logging
- embedded IR load, level load, Right/Down/Undo/Restart trace, and heap gates

Later plans begin only after this plan passes:

1. ES3C28P display, I2C, microSD, audio, battery ADC, and backlight bring-up
2. `.pscart` envelope, library, renderer, saves, and appliance boot path
3. controller/button coupon and MCP23017 firmware
4. PCB sandwich, midframe, battery selection, and two-device pilot integration

Acquire two ES3C28P modules in parallel. Tasks 1-7 can be completed without the
boards; Task 8's flash/monitor steps wait for a module and do not block host
verification.

## File structure

- Create `hardware/pocket_card/es3c28p_pin_contract.json`
  - Single machine-readable source for module pins, shared buses, and reserved
    resources.
- Create `hardware/pocket_card/test_pin_contract.js`
  - Fails on accidental pin collisions, address collisions, or drift from the
    approved module schematic.
- Create `hardware/pocket_card/README.md`
  - Scope and source links; clearly distinguishes this target from
    `hardware/card/`.
- Rename `scripts/esp32p4_probe_log.js` to `scripts/handheld_probe_log.js`
  - Board-neutral serial JSON parser and gate.
- Create `scripts/esp32p4_probe_log.js`
  - Compatibility wrapper for existing P4 commands/tests.
- Rename `scripts/test_esp32p4_probe_log.js` to
  `scripts/test_handheld_probe_log.js`
  - Existing parser coverage plus an ESP32-S3 boot record.
- Create `scripts/build_pocket_card_fixture.js`
  - Runs `puzzlescript_cpp compile --emit-ir-json`, validates the envelope, and
    writes a deterministic firmware fixture.
- Create `scripts/test_build_pocket_card_fixture.js`
  - Unit tests argument parsing, malformed compiler output, and successful
    deterministic output.
- Create `native/tests/pocket_card_runtime_fixture.cpp`
  - Loads the generated fixture through the runtime-only C API and executes the
    Pocket Card smoke trace.
- Modify `native/CMakeLists.txt`
  - Registers the host fixture smoke test linked only to
    `puzzlescript_native`.
- Create `firmware/pocket_card/CMakeLists.txt`
  - ESP-IDF project root.
- Create `firmware/pocket_card/sdkconfig.defaults`
  - ESP32-S3, 16 MB flash, 8 MB octal PSRAM, USB Serial/JTAG console, C++
    exceptions, and custom partition defaults.
- Create `firmware/pocket_card/partitions.csv`
  - NVS, factory application, and future storage space.
- Create `firmware/pocket_card/main/CMakeLists.txt`
  - Runtime-only native source list and embedded IR fixture.
- Create `firmware/pocket_card/main/idf_component.yml`
  - ESP-IDF 5.4 target contract; no peripheral component dependencies yet.
- Create `firmware/pocket_card/main/probe_config.hpp`
  - Display-independent module/build constants and acceptance thresholds.
- Create `firmware/pocket_card/main/probe_log.hpp`
  - Firmware phase and structured logging API.
- Create `firmware/pocket_card/main/probe_log.cpp`
  - Boot, phase, and heap JSON emitters.
- Create `firmware/pocket_card/main/runtime_probe.hpp`
  - Runtime-only probe entry point.
- Create `firmware/pocket_card/main/runtime_probe.cpp`
  - Embedded IR load, session creation, level load, and deterministic trace.
- Create `firmware/pocket_card/main/main.cpp`
  - Minimal boot orchestration.
- Generate `firmware/pocket_card/main/sokoban_basic.ir.json`
  - Deterministic host-compiled runtime fixture.
- Modify `Makefile`
  - Host tests plus build/flash/monitor/capture/log-gate targets.
- Create `docs/superpowers/notes/2026-07-12-pocket-card-track0-usage.md`
  - Exact environment, build, flash, capture, expected phases, and exit gate.

### Task 1: Freeze and test the ES3C28P pin contract

**Files:**
- Create: `hardware/pocket_card/es3c28p_pin_contract.json`
- Create: `hardware/pocket_card/test_pin_contract.js`
- Create: `hardware/pocket_card/README.md`

- [ ] **Step 1: Write the failing pin-contract test**

Create `hardware/pocket_card/test_pin_contract.js`:

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const contractPath = path.join(__dirname, 'es3c28p_pin_contract.json');
assert.ok(fs.existsSync(contractPath), `missing ${contractPath}`);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

assert.strictEqual(contract.module, 'ES3C28P');
assert.strictEqual(contract.target, 'esp32s3');
assert.deepStrictEqual(contract.display, {
    controller: 'ILI9341V', cs: 10, dc: 46, sck: 12, mosi: 11,
    miso: 13, backlight: 45, reset: 'CHIP_PU', width: 320, height: 240,
});
assert.deepStrictEqual(contract.i2c, {
    sda: 16,
    scl: 15,
    addresses: { audio_codec: 0x18, controls: 0x20, touch: 0x38 },
});
assert.deepStrictEqual(contract.touch, { reset: 18, interrupt: 17 });
assert.deepStrictEqual(contract.audio, {
    amp_enable: 1, mclk: 4, bclk: 5, data_out: 6, lrclk: 7, data_in: 8,
});
assert.deepStrictEqual(contract.sdmmc, {
    clk: 38, cmd: 40, data0: 39, data1: 41, data2: 48, data3: 47,
});
assert.strictEqual(contract.battery_adc, 9);
assert.deepStrictEqual(contract.expansion_gpio, [2, 3, 14, 21]);
assert.deepStrictEqual(contract.reserved, {
    boot: 0, rgb: 42, usb_d_minus: 19, usb_d_plus: 20,
    uart_rx: 44, uart_tx: 43,
});
assert.strictEqual(contract.controls_interrupt_gpio, 2);
assert.strictEqual(contract.release_touch_enabled, false);

const gpioUses = [];
function addUse(name, pin) {
    assert.ok(Number.isInteger(pin) && pin >= 0 && pin <= 48, `${name}: invalid GPIO ${pin}`);
    gpioUses.push({ name, pin });
}
for (const [name, value] of Object.entries(contract.display)) {
    if (Number.isInteger(value) && !['width', 'height'].includes(name)) addUse(`display.${name}`, value);
}
for (const [name, value] of Object.entries(contract.audio)) addUse(`audio.${name}`, value);
for (const [name, value] of Object.entries(contract.sdmmc)) addUse(`sdmmc.${name}`, value);
for (const [name, value] of Object.entries(contract.reserved)) addUse(`reserved.${name}`, value);
for (const [name, value] of Object.entries(contract.touch)) addUse(`touch.${name}`, value);
addUse('i2c.sda', contract.i2c.sda);
addUse('i2c.scl', contract.i2c.scl);
addUse('battery_adc', contract.battery_adc);
for (const pin of contract.expansion_gpio) addUse(`expansion_gpio.${pin}`, pin);

const duplicates = new Map();
for (const use of gpioUses) {
    const names = duplicates.get(use.pin) || [];
    names.push(use.name);
    duplicates.set(use.pin, names);
}
for (const [pin, names] of duplicates) {
    assert.strictEqual(names.length, 1, `GPIO${pin} collision: ${names.join(', ')}`);
}
assert.ok(contract.expansion_gpio.includes(contract.controls_interrupt_gpio));
assert.strictEqual(new Set(Object.values(contract.i2c.addresses)).size, 3, 'I2C addresses must be unique');

process.stdout.write('pocket_card_pin_contract: ok\n');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node hardware/pocket_card/test_pin_contract.js
```

Expected: FAIL with `missing .../es3c28p_pin_contract.json`.

- [ ] **Step 3: Add the approved module contract**

Create `hardware/pocket_card/es3c28p_pin_contract.json`:

```json
{
  "module": "ES3C28P",
  "target": "esp32s3",
  "display": {
    "controller": "ILI9341V",
    "cs": 10,
    "dc": 46,
    "sck": 12,
    "mosi": 11,
    "miso": 13,
    "backlight": 45,
    "reset": "CHIP_PU",
    "width": 320,
    "height": 240
  },
  "i2c": {
    "sda": 16,
    "scl": 15,
    "addresses": {
      "audio_codec": 24,
      "controls": 32,
      "touch": 56
    }
  },
  "touch": {
    "reset": 18,
    "interrupt": 17
  },
  "audio": {
    "amp_enable": 1,
    "mclk": 4,
    "bclk": 5,
    "data_out": 6,
    "lrclk": 7,
    "data_in": 8
  },
  "sdmmc": {
    "clk": 38,
    "cmd": 40,
    "data0": 39,
    "data1": 41,
    "data2": 48,
    "data3": 47
  },
  "battery_adc": 9,
  "expansion_gpio": [2, 3, 14, 21],
  "controls_interrupt_gpio": 2,
  "reserved": {
    "boot": 0,
    "rgb": 42,
    "usb_d_minus": 19,
    "usb_d_plus": 20,
    "uart_rx": 44,
    "uart_tx": 43
  },
  "release_touch_enabled": false
}
```

Create `hardware/pocket_card/README.md`:

```markdown
# PuzzleScript Pocket Card hardware

This directory is the ES3C28P/ESP32-S3 Pocket Card target defined by
`docs/superpowers/specs/2026-07-12-puzzlescript-pocket-card-design.md`.
It does not inherit the ESP32-P4, DSI, power, or geometry contracts in
`hardware/card/`.

`es3c28p_pin_contract.json` is transcribed from the vendor specification and
schematic. Any pin change requires updating the contract test and citing a new
module revision.

Primary sources:

- https://www.lcdwiki.com/2.8inch_ESP32-S3_Display
- https://www.lcdwiki.com/res/ES3C28P/ES3C28P_ES2N28P_Specification_V1.0.pdf
- https://www.lcdwiki.com/res/ES3C28P/2.8inch_ESP32-S3_Display_Schematic.pdf
```

- [ ] **Step 4: Run the contract test**

Run:

```bash
node hardware/pocket_card/test_pin_contract.js
```

Expected: `pocket_card_pin_contract: ok`.

- [ ] **Step 5: Commit the hardware contract**

```bash
git add hardware/pocket_card
git commit -m "hardware: add Pocket Card ES3C28P pin contract"
```

### Task 2: Generalize the serial probe log gate

**Files:**
- Rename: `scripts/esp32p4_probe_log.js` to `scripts/handheld_probe_log.js`
- Create: `scripts/esp32p4_probe_log.js`
- Rename: `scripts/test_esp32p4_probe_log.js` to `scripts/test_handheld_probe_log.js`
- Modify: `Makefile`

- [ ] **Step 1: Move the parser and its tests, then run the old target to expose broken paths**

Move the files without changing content:

```bash
git mv scripts/esp32p4_probe_log.js scripts/handheld_probe_log.js
git mv scripts/test_esp32p4_probe_log.js scripts/test_handheld_probe_log.js
node scripts/test_handheld_probe_log.js
```

Expected: FAIL because the test still requires `./esp32p4_probe_log` and invokes
the old CLI path.

- [ ] **Step 2: Make the parser board-neutral**

In `scripts/handheld_probe_log.js`, make these exact replacements:

```javascript
// parseArgs default
out: path.join('build', 'handheld_probe_log_summary.json'),
requiredPhases: [],
requiredHeapRegions: [],

// parseArgs loop, beside --fail-on-failure
} else if (arg === '--require-phase') {
    index += 1;
    const phase = argv[index] || null;
    if (!phase) throw new Error('missing value for --require-phase');
    options.requiredPhases.push(phase);
} else if (arg === '--require-heap-region') {
    index += 1;
    const region = argv[index] || null;
    if (!region) throw new Error('missing value for --require-heap-region');
    options.requiredHeapRegions.push(region);
}

// printUsage first lines and new options
'Usage: node scripts/handheld_probe_log.js --log probe.log [--out build/handheld_probe_log_summary.json]',
'Summarizes handheld board-probe JSON-lines captured from ESP-IDF serial output.',
'  --require-phase NAME',
'                require a passing phase; repeat for each required phase',
'  --require-heap-region NAME',
'                require at least one heap sample; repeat for each region',

// CLI error prefix
process.stderr.write(`handheld_probe_log: ${error.message}\n`);
```

Change the gate signature and add the required-record checks after the existing
failed-phase check:

```javascript
function gateFailureReasons(summary, requiredPhases = [], requiredHeapRegions = []) {
    const reasons = [];
    if (summary.event_count === 0) {
        reasons.push('no probe events');
    }
    if (summary.ignored_boot) {
        reasons.push('missing boot event');
    }
    if (summary.parse_error_count > 0) {
        reasons.push(`${summary.parse_error_count} parse error(s)`);
    }
    if (summary.failed_phase_count > 0) {
        reasons.push(`${summary.failed_phase_count} failed phase(s)`);
    }
    if (summary.alloc_failures.length > 0) {
        reasons.push(`${summary.alloc_failures.length} allocation failure(s)`);
    }
    for (const phase of requiredPhases) {
        if (!summary.phases[phase] || summary.phases[phase].status !== 'pass') {
            reasons.push(`missing passing ${phase} phase`);
        }
    }
    for (const region of requiredHeapRegions) {
        const stats = summary.heap.regions[region];
        if (!stats || stats.samples < 1) {
            reasons.push(`missing ${region} heap sample`);
        }
    }
    return reasons;
}
```

Replace the `command` object in `buildReport` with:

```javascript
command: {
    log: options.log,
    fail_on_failure: options.failOnFailure,
    required_phases: options.requiredPhases,
    required_heap_regions: options.requiredHeapRegions,
},
```

In `runCli`, pass both arrays to the gate:

```javascript
const reasons = gateFailureReasons(
    report.summary,
    options.requiredPhases,
    options.requiredHeapRegions,
);
```

In `scripts/test_handheld_probe_log.js`, replace every
`esp32p4_probe_log`/`esp32p4_probe_log.js` reference with
`handheld_probe_log`/`handheld_probe_log.js`. Add this test before `main()`:

```javascript
function acceptsPocketCardBootRecord() {
    const text = [
        'I (12) ps_probe: {"event":"boot","target":"esp32s3","board":"ES3C28P","cores":2,"flash_bytes":16777216}',
        'I (13) ps_probe: {"event":"phase","phase":"BOOT","status":"pass","detail":"boot_summary","elapsed_ms":1,"fb_mode":"none","fb_width":0,"fb_height":0,"fb_count":0,"fb_bpp":2}',
        'I (14) ps_probe: {"event":"heap","phase":"BOOT","region":"internal","free":180000,"allocated":20000,"largest_free_block":110000,"minimum_free":170000}',
        'I (15) ps_probe: {"event":"heap","phase":"BOOT","region":"spiram","free":7000000,"allocated":500000,"largest_free_block":6900000,"minimum_free":6800000}',
        '',
    ].join('\n');
    const parsed = probeLog.parseProbeLogText('pocket.log', text);
    const summary = probeLog.summarizeEvents(parsed.events, parsed.parse_errors);
    assert.strictEqual(summary.boot.target, 'esp32s3');
    assert.strictEqual(summary.boot.board, 'ES3C28P');
    assert.deepStrictEqual(
        probeLog.gateFailureReasons(summary, ['BOOT'], ['internal', 'spiram']),
        [],
    );
    assert.deepStrictEqual(
        probeLog.gateFailureReasons(summary, ['BOOT', 'LOAD_IR'], ['internal', 'spiram']),
        ['missing passing LOAD_IR phase'],
    );
}
```

Call it from `main()`:

```javascript
acceptsPocketCardBootRecord();
```

Keep `gateFailureReasons` in the existing `module.exports` object so the new
test can call it.

- [ ] **Step 3: Add the P4 compatibility wrapper**

Create `scripts/esp32p4_probe_log.js`:

```javascript
#!/usr/bin/env node
'use strict';

const probe = require('./handheld_probe_log');

if (require.main === module) {
    try {
        process.exitCode = probe.runCli(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`esp32p4_probe_log: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = probe;
```

- [ ] **Step 4: Run generic and compatibility tests**

Run:

```bash
node scripts/test_handheld_probe_log.js
node scripts/esp32p4_probe_log.js --help
```

Expected: test exits 0; help prints the generic handheld usage.

- [ ] **Step 5: Update existing P4 Make targets to use the generic parser**

In `Makefile`, replace the three invocations of
`scripts/esp32p4_probe_log.js` with `scripts/handheld_probe_log.js`. Keep the
P4 variable names and output paths unchanged.

Run:

```bash
node scripts/test_handheld_probe_log.js
```

Expected: exit 0.

- [ ] **Step 6: Commit the generic log gate**

```bash
git add scripts/handheld_probe_log.js scripts/esp32p4_probe_log.js scripts/test_handheld_probe_log.js Makefile
git commit -m "tools: generalize handheld probe log gate"
```

### Task 3: Generate and host-test a runtime-only IR fixture

**Files:**
- Create: `scripts/build_pocket_card_fixture.js`
- Create: `scripts/test_build_pocket_card_fixture.js`
- Create: `native/tests/pocket_card_runtime_fixture.cpp`
- Modify: `native/CMakeLists.txt`
- Generate: `firmware/pocket_card/main/sokoban_basic.ir.json`

- [ ] **Step 1: Write the fixture-builder tests**

Create `scripts/test_build_pocket_card_fixture.js`:

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fixture = require('./build_pocket_card_fixture');

assert.deepStrictEqual(
    fixture.parseArgs(['--binary', 'bin', '--source', 'game.txt', '--out', 'game.ir.json']),
    { binary: 'bin', source: 'game.txt', out: 'game.ir.json' },
);
assert.throws(() => fixture.validateIrText('{"schema_version":2,"game":{}}'), /schema_version/);
assert.throws(() => fixture.validateIrText('{"schema_version":1}'), /game/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-card-fixture-'));
try {
    const out = path.join(temp, 'fixture.json');
    const fakeIr = JSON.stringify({ schema_version: 1, document: {}, game: { levels: [] } });
    const result = fixture.buildFixture(
        { binary: 'fake', source: 'game.txt', out },
        () => ({ status: 0, stdout: `${fakeIr}\n`, stderr: '' }),
    );
    assert.strictEqual(result.schema_version, 1);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), `${JSON.stringify(result, null, 2)}\n`);
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}

process.stdout.write('build_pocket_card_fixture: ok\n');
```

- [ ] **Step 2: Run the fixture-builder test to verify it fails**

Run:

```bash
node scripts/test_build_pocket_card_fixture.js
```

Expected: FAIL with `Cannot find module './build_pocket_card_fixture'`.

- [ ] **Step 3: Implement the deterministic fixture builder**

Create `scripts/build_pocket_card_fixture.js`:

```javascript
#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const options = { binary: null, source: null, out: null };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--binary' || arg === '--source' || arg === '--out') {
            i += 1;
            options[arg.slice(2)] = argv[i] || null;
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }
    for (const key of ['binary', 'source', 'out']) {
        if (!options[key]) throw new Error(`missing --${key}`);
    }
    return options;
}

function validateIrText(text) {
    let value;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`compiler emitted invalid JSON: ${error.message}`);
    }
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error('IR root must be an object');
    }
    if (value.schema_version !== 1) {
        throw new Error(`unsupported schema_version: ${value.schema_version}`);
    }
    if (value.game === null || Array.isArray(value.game) || typeof value.game !== 'object') {
        throw new Error('IR is missing game object');
    }
    return value;
}

function buildFixture(options, spawn = childProcess.spawnSync) {
    const result = spawn(options.binary, ['compile', options.source, '--emit-ir-json'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`compiler failed (${result.status}): ${String(result.stderr).trim()}`);
    }
    const value = validateIrText(result.stdout);
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return value;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    buildFixture(options);
    process.stderr.write(`Wrote ${options.out}\n`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`build_pocket_card_fixture: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = { buildFixture, parseArgs, validateIrText };
```

- [ ] **Step 4: Run the builder tests and generate the real fixture**

Run:

```bash
node scripts/test_build_pocket_card_fixture.js
cmake --build build --target puzzlescript_cpp
node scripts/build_pocket_card_fixture.js --binary build/native/puzzlescript_cpp --source src/demo/sokoban_basic.txt --out firmware/pocket_card/main/sokoban_basic.ir.json
```

Expected: test prints `build_pocket_card_fixture: ok`; generator writes a JSON
object with `schema_version: 1`.

- [ ] **Step 5: Write the runtime-only host smoke test**

Create `native/tests/pocket_card_runtime_fixture.cpp`:

```cpp
#include "puzzlescript/puzzlescript.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

namespace {
std::string readFile(const char* path) {
    std::ifstream input(path, std::ios::binary);
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

int fail(const char* stage, ps_error* error = nullptr) {
    std::cerr << stage;
    if (error != nullptr) {
        std::cerr << ": " << ps_error_message(error);
        ps_free_error(error);
    }
    std::cerr << '\n';
    return 1;
}
} // namespace

int main(int argc, char** argv) {
    if (argc != 2) return fail("usage: pocket_card_runtime_fixture IR_JSON");
    const std::string ir = readFile(argv[1]);
    if (ir.empty()) return fail("empty fixture");

    ps_game* game = nullptr;
    ps_error* error = nullptr;
    if (!ps_load_ir_json(ir.data(), ir.size(), &game, &error)) return fail("load_ir", error);

    ps_full_state* state = nullptr;
    if (!ps_full_state_create(game, &state, &error)) {
        ps_free_game(game);
        return fail("create_state", error);
    }
    if (!ps_full_state_load_level(state, 0, &error)) {
        ps_full_state_destroy(state);
        ps_free_game(game);
        return fail("load_level", error);
    }

    int32_t player_x = -1;
    int32_t player_y = -1;
    const auto player_at = [&](int32_t expected_x, int32_t expected_y) {
        return ps_full_state_first_player_position(state, &player_x, &player_y) &&
               player_x == expected_x && player_y == expected_y;
    };
    if (!player_at(2, 3)) {
        ps_full_state_destroy(state);
        ps_free_game(game);
        return fail("initial_player_position");
    }
    (void)ps_full_state_turn(state, PS_INPUT_RIGHT);
    (void)ps_full_state_turn(state, PS_INPUT_DOWN);
    if (!player_at(3, 3)) {
        ps_full_state_destroy(state);
        ps_free_game(game);
        return fail("right_down_player_position");
    }
    if (!ps_full_state_undo(state) || !player_at(2, 3)) {
        ps_full_state_destroy(state);
        ps_free_game(game);
        return fail("undo");
    }
    if (!ps_full_state_restart(state) || !player_at(2, 3)) {
        ps_full_state_destroy(state);
        ps_free_game(game);
        return fail("restart");
    }

    ps_full_state_destroy(state);
    ps_free_game(game);
    std::cout << "pocket_card_runtime_fixture: ok\n";
    return 0;
}
```

Append this target near the other runtime smoke tests in `native/CMakeLists.txt`:

```cmake
add_executable(pocket_card_runtime_fixture
  tests/pocket_card_runtime_fixture.cpp
)
target_link_libraries(pocket_card_runtime_fixture PRIVATE puzzlescript_native)
add_test(
  NAME pocket_card_runtime_fixture
  COMMAND pocket_card_runtime_fixture
          ${PUZZLESCRIPT_REPO_ROOT}/firmware/pocket_card/main/sokoban_basic.ir.json
)
```

- [ ] **Step 6: Build and run the runtime-only test**

Run:

```bash
cmake -S . -B build
cmake --build build --target pocket_card_runtime_fixture
ctest --test-dir build --output-on-failure -R '^pocket_card_runtime_fixture$'
```

Expected: `1/1` test passes and the executable links without
`puzzlescript_compiler`.

- [ ] **Step 7: Commit the fixture pipeline**

```bash
git add scripts/build_pocket_card_fixture.js scripts/test_build_pocket_card_fixture.js native/tests/pocket_card_runtime_fixture.cpp native/CMakeLists.txt firmware/pocket_card/main/sokoban_basic.ir.json
git commit -m "firmware: add runtime-only Pocket Card fixture pipeline"
```

### Task 4: Scaffold the ESP32-S3 runtime-only project

**Files:**
- Create: `firmware/pocket_card/CMakeLists.txt`
- Create: `firmware/pocket_card/sdkconfig.defaults`
- Create: `firmware/pocket_card/partitions.csv`
- Create: `firmware/pocket_card/main/CMakeLists.txt`
- Create: `firmware/pocket_card/main/idf_component.yml`
- Create: `firmware/pocket_card/main/probe_config.hpp`
- Create: `firmware/pocket_card/main/main.cpp`

- [ ] **Step 1: Run the firmware build before the project exists**

Run:

```bash
source "$HOME/esp/esp-idf/export.sh"
idf.py -C firmware/pocket_card build
```

Expected: FAIL because `firmware/pocket_card/CMakeLists.txt` does not exist.

- [ ] **Step 2: Add the ESP-IDF root and partition files**

Create `firmware/pocket_card/CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.20)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(puzzlescript_pocket_card_probe)
```

Create `firmware/pocket_card/partitions.csv`:

```csv
# Name,   Type, SubType, Offset,  Size, Flags
nvs,      data, nvs,     0x9000,  0x6000,
phy_init, data, phy,     0xf000,  0x1000,
factory,  app,  factory, 0x10000, 0x700000,
storage,  data, fat,             , 0x800000,
```

Create `firmware/pocket_card/sdkconfig.defaults`:

```text
CONFIG_IDF_TARGET="esp32s3"
CONFIG_ESPTOOLPY_FLASHMODE_QIO=y
CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"
CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ_240=y
CONFIG_COMPILER_OPTIMIZATION_PERF=y
CONFIG_COMPILER_CXX_EXCEPTIONS=y
CONFIG_COMPILER_CXX_RTTI=y
CONFIG_SPIRAM=y
CONFIG_SPIRAM_MODE_OCT=y
CONFIG_SPIRAM_SPEED_80M=y
CONFIG_SPIRAM_USE_MALLOC=y
CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL=32768
CONFIG_ESP_MAIN_TASK_STACK_SIZE=16384
CONFIG_FREERTOS_HZ=1000
CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y
CONFIG_ESP_CONSOLE_SECONDARY_NONE=y
```

- [ ] **Step 3: Add the runtime-only component**

Create `firmware/pocket_card/main/idf_component.yml`:

```yaml
version: 0.1.0
targets:
  - esp32s3
dependencies:
  idf: ">=5.4,<5.5"
```

Create `firmware/pocket_card/main/probe_config.hpp`:

```cpp
#pragma once

namespace pocket_card {
inline constexpr const char* kBoardName = "ES3C28P";
inline constexpr int kDisplayWidth = 320;
inline constexpr int kDisplayHeight = 240;
} // namespace pocket_card
```

Create `firmware/pocket_card/main/CMakeLists.txt`:

```cmake
set(PUZZLESCRIPT_NATIVE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../native")

idf_component_register(
  SRCS
    "main.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/c_api.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/compiled_rules.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/core.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/hash.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/json.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/locality_survey.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/simd.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson/simdjson.cpp"
  INCLUDE_DIRS
    "."
    "${PUZZLESCRIPT_NATIVE_DIR}/include"
    "${PUZZLESCRIPT_NATIVE_DIR}/src"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson"
  # Binary embedding keeps _end - _start equal to the JSON byte length. Text
  # embedding appends a NUL that the explicit-length runtime parser must not see.
  EMBED_FILES
    "sokoban_basic.ir.json"
  REQUIRES
    esp_timer
    spi_flash
)

target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_20)
target_compile_options(${COMPONENT_LIB} PRIVATE
  -Wall
  -Wextra
  -Wno-missing-field-initializers
  -Wno-unused-parameter
  -Wno-sign-compare
)
target_compile_definitions(${COMPONENT_LIB} PRIVATE
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)
set_source_files_properties(
  "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson/simdjson.cpp"
  "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/core.cpp"
  "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/json.cpp"
  PROPERTIES COMPILE_OPTIONS "-Wno-error=format"
)
```

Create the initial `firmware/pocket_card/main/main.cpp`:

```cpp
#include "esp_log.h"
#include "probe_config.hpp"

extern "C" void app_main(void) {
    ESP_LOGI("ps_probe", "{\"event\":\"probe_stub\",\"target\":\"esp32s3\",\"board\":\"%s\",\"status\":\"ok\"}", pocket_card::kBoardName);
}
```

- [ ] **Step 4: Configure and build the scaffold**

Run:

```bash
source "$HOME/esp/esp-idf/export.sh"
idf.py -C firmware/pocket_card set-target esp32s3
idf.py -C firmware/pocket_card build
```

Expected: build produces
`firmware/pocket_card/build/puzzlescript_pocket_card_probe.bin`. Inspect the
link map and verify no object path contains `/src/compiler/`.

- [ ] **Step 5: Commit the scaffold**

```bash
git add firmware/pocket_card/CMakeLists.txt firmware/pocket_card/sdkconfig.defaults firmware/pocket_card/partitions.csv firmware/pocket_card/main/CMakeLists.txt firmware/pocket_card/main/idf_component.yml firmware/pocket_card/main/probe_config.hpp firmware/pocket_card/main/main.cpp
git commit -m "firmware: scaffold Pocket Card ESP32-S3 runtime"
```

### Task 5: Add boot, phase, and heap instrumentation

**Files:**
- Create: `firmware/pocket_card/main/probe_log.hpp`
- Create: `firmware/pocket_card/main/probe_log.cpp`
- Modify: `firmware/pocket_card/main/CMakeLists.txt`
- Modify: `firmware/pocket_card/main/main.cpp`

- [ ] **Step 1: Add calls to the missing logging API**

Replace `firmware/pocket_card/main/main.cpp` with:

```cpp
#include "probe_log.hpp"

extern "C" void app_main(void) {
    pocket_card::probe_log_init();
    const int64_t started = pocket_card::now_ms();
    pocket_card::emit_boot_summary();
    pocket_card::emit_phase(pocket_card::Phase::Boot, "pass", "boot_summary", pocket_card::now_ms() - started);
}
```

- [ ] **Step 2: Build to verify the missing API fails**

Run:

```bash
source "$HOME/esp/esp-idf/export.sh"
idf.py -C firmware/pocket_card build
```

Expected: FAIL because `probe_log.hpp` does not exist.

- [ ] **Step 3: Implement the logging API**

Create `firmware/pocket_card/main/probe_log.hpp`:

```cpp
#pragma once

#include <cstdint>

namespace pocket_card {
enum class Phase : uint8_t { Boot, LoadIr, CreateRuntime, LoadLevel, InputTrace, Unload };

int64_t now_ms();
const char* phase_name(Phase phase);
void probe_log_init();
void emit_boot_summary();
void emit_phase(Phase phase, const char* status, const char* detail, int64_t elapsed_ms);
} // namespace pocket_card
```

Create `firmware/pocket_card/main/probe_log.cpp`:

```cpp
#include "probe_log.hpp"

#include <cinttypes>

#include "esp_chip_info.h"
#include "esp_err.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "probe_config.hpp"

namespace pocket_card {
namespace {
constexpr const char* kTag = "ps_probe";

void emit_heap(Phase phase, const char* region, uint32_t caps) {
    multi_heap_info_t info{};
    heap_caps_get_info(&info, caps);
    ESP_LOGI(kTag,
        "{\"event\":\"heap\",\"phase\":\"%s\",\"region\":\"%s\",\"free\":%zu,\"allocated\":%zu,\"largest_free_block\":%zu,\"minimum_free\":%zu}",
        phase_name(phase), region, info.total_free_bytes, info.total_allocated_bytes,
        info.largest_free_block, info.minimum_free_bytes);
}

void allocation_failed(size_t requested, uint32_t caps, const char* function_name) {
    ESP_EARLY_LOGE(kTag,
        "{\"event\":\"alloc_failed\",\"requested\":%zu,\"caps\":%" PRIu32 ",\"function\":\"%s\"}",
        requested, caps, function_name == nullptr ? "?" : function_name);
}
} // namespace

int64_t now_ms() { return esp_timer_get_time() / 1000; }

const char* phase_name(Phase phase) {
    switch (phase) {
        case Phase::Boot: return "BOOT";
        case Phase::LoadIr: return "LOAD_IR";
        case Phase::CreateRuntime: return "CREATE_RUNTIME";
        case Phase::LoadLevel: return "LOAD_LEVEL";
        case Phase::InputTrace: return "INPUT_TRACE";
        case Phase::Unload: return "UNLOAD";
    }
    return "UNKNOWN";
}

void probe_log_init() { heap_caps_register_failed_alloc_callback(allocation_failed); }

void emit_boot_summary() {
    esp_chip_info_t chip{};
    esp_chip_info(&chip);
    uint32_t flash_bytes = 0;
    const esp_err_t flash_status = esp_flash_get_size(nullptr, &flash_bytes);
    ESP_LOGI(kTag,
        "{\"event\":\"boot\",\"target\":\"esp32s3\",\"board\":\"%s\",\"cores\":%d,\"revision\":%d,\"flash_bytes\":%" PRIu32 ",\"flash_status\":\"%s\",\"idf\":\"%s\",\"reset_reason\":%d}",
        kBoardName, chip.cores, chip.revision, flash_bytes,
        flash_status == ESP_OK ? "ok" : esp_err_to_name(flash_status),
        esp_get_idf_version(), static_cast<int>(esp_reset_reason()));
}

void emit_phase(Phase phase, const char* status, const char* detail, int64_t elapsed_ms) {
    ESP_LOGI(kTag,
        "{\"event\":\"phase\",\"phase\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\",\"elapsed_ms\":%" PRId64 ",\"fb_mode\":\"none\",\"fb_width\":0,\"fb_height\":0,\"fb_count\":0,\"fb_bpp\":2}",
        phase_name(phase), status, detail, elapsed_ms);
    emit_heap(phase, "internal", MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    emit_heap(phase, "spiram", MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
}
} // namespace pocket_card
```

Add `"probe_log.cpp"` to the `SRCS` list in
`firmware/pocket_card/main/CMakeLists.txt`.

- [ ] **Step 4: Build and inspect compiler/link output**

Run:

```bash
source "$HOME/esp/esp-idf/export.sh"
idf.py -C firmware/pocket_card build
rg '/src/compiler/' firmware/pocket_card/build/puzzlescript_pocket_card_probe.map
```

Expected: firmware build succeeds; `rg` exits 1 with no compiler paths.

- [ ] **Step 5: Commit instrumentation**

```bash
git add firmware/pocket_card/main
git commit -m "firmware: instrument Pocket Card boot and heaps"
```

### Task 6: Run the embedded runtime fixture on ESP32-S3

**Files:**
- Create: `firmware/pocket_card/main/runtime_probe.hpp`
- Create: `firmware/pocket_card/main/runtime_probe.cpp`
- Modify: `firmware/pocket_card/main/CMakeLists.txt`
- Modify: `firmware/pocket_card/main/main.cpp`

- [ ] **Step 1: Call the missing runtime probe from boot**

Add this include to `main.cpp`:

```cpp
#include "runtime_probe.hpp"
```

Append this line after the boot phase:

```cpp
pocket_card::run_runtime_probe();
```

- [ ] **Step 2: Build to verify the missing probe fails**

Run:

```bash
source "$HOME/esp/esp-idf/export.sh"
idf.py -C firmware/pocket_card build
```

Expected: FAIL because `runtime_probe.hpp` does not exist.

- [ ] **Step 3: Implement the runtime-only trace**

Create `firmware/pocket_card/main/runtime_probe.hpp`:

```cpp
#pragma once
namespace pocket_card { void run_runtime_probe(); }
```

Create `firmware/pocket_card/main/runtime_probe.cpp`:

```cpp
#include "runtime_probe.hpp"

#include <cstddef>

#include "probe_log.hpp"
#include "puzzlescript/puzzlescript.h"

extern const uint8_t _binary_sokoban_basic_ir_json_start[] asm("_binary_sokoban_basic_ir_json_start");
extern const uint8_t _binary_sokoban_basic_ir_json_end[] asm("_binary_sokoban_basic_ir_json_end");

namespace pocket_card {
namespace {
void emit_failure(Phase phase, const char* detail, int64_t started, ps_error* error = nullptr) {
    // Keep structured fields to controlled strings; compiler/runtime messages may
    // contain quotes or newlines and would require JSON escaping.
    emit_phase(phase, "fail", detail, now_ms() - started);
    if (error != nullptr) ps_free_error(error);
}
} // namespace

void run_runtime_probe() {
    ps_game* game = nullptr;
    ps_full_state* state = nullptr;
    ps_error* error = nullptr;

    int64_t started = now_ms();
    const char* ir = reinterpret_cast<const char*>(_binary_sokoban_basic_ir_json_start);
    const std::size_t ir_size = static_cast<std::size_t>(
        _binary_sokoban_basic_ir_json_end - _binary_sokoban_basic_ir_json_start);
    if (!ps_load_ir_json(ir, ir_size, &game, &error)) {
        emit_failure(Phase::LoadIr, "load_ir_failed", started, error);
        return;
    }
    emit_phase(Phase::LoadIr, "pass", "sokoban_basic.ir.json", now_ms() - started);

    started = now_ms();
    if (!ps_full_state_create(game, &state, &error)) {
        emit_failure(Phase::CreateRuntime, "create_runtime_failed", started, error);
        ps_free_game(game);
        return;
    }
    emit_phase(Phase::CreateRuntime, "pass", "runtime_created", now_ms() - started);

    started = now_ms();
    if (!ps_full_state_load_level(state, 0, &error)) {
        emit_failure(Phase::LoadLevel, "load_level_failed", started, error);
        ps_full_state_destroy(state);
        ps_free_game(game);
        return;
    }
    emit_phase(Phase::LoadLevel, "pass", "level_0", now_ms() - started);

    started = now_ms();
    int32_t player_x = -1;
    int32_t player_y = -1;
    const auto player_at = [&](int32_t expected_x, int32_t expected_y) {
        return ps_full_state_first_player_position(state, &player_x, &player_y) &&
               player_x == expected_x && player_y == expected_y;
    };
    if (!player_at(2, 3)) {
        emit_failure(Phase::InputTrace, "initial_player_position_failed", started);
    } else {
        (void)ps_full_state_turn(state, PS_INPUT_RIGHT);
        (void)ps_full_state_turn(state, PS_INPUT_DOWN);
        if (!player_at(3, 3)) {
            emit_failure(Phase::InputTrace, "right_down_position_failed", started);
        } else if (!ps_full_state_undo(state) || !player_at(2, 3)) {
            emit_failure(Phase::InputTrace, "undo_failed", started);
        } else if (!ps_full_state_restart(state) || !player_at(2, 3)) {
            emit_failure(Phase::InputTrace, "restart_failed", started);
        } else {
            emit_phase(Phase::InputTrace, "pass", "right_down_undo_restart", now_ms() - started);
        }
    }

    started = now_ms();
    ps_full_state_destroy(state);
    ps_free_game(game);
    emit_phase(Phase::Unload, "pass", "runtime_freed", now_ms() - started);
}
} // namespace pocket_card
```

Add `"runtime_probe.cpp"` to the component `SRCS` list.

- [ ] **Step 4: Build the full headless probe and verify it remains compiler-free**

Run:

```bash
source "$HOME/esp/esp-idf/export.sh"
idf.py -C firmware/pocket_card build
rg '/src/compiler/' firmware/pocket_card/build/puzzlescript_pocket_card_probe.map
```

Expected: build succeeds; `rg` returns no matches.

- [ ] **Step 5: Commit the runtime probe**

```bash
git add firmware/pocket_card/main
git commit -m "firmware: run Pocket Card runtime-only smoke trace"
```

### Task 7: Add Make targets and operator documentation

**Files:**
- Modify: `Makefile`
- Create: `docs/superpowers/notes/2026-07-12-pocket-card-track0-usage.md`

- [ ] **Step 1: Add Pocket Card variables and phony targets**

Add these variables beside the existing ESP32-P4 variables in `Makefile`:

```make
POCKET_CARD_PORT ?=
POCKET_CARD_FIRMWARE_DIR := firmware/pocket_card
POCKET_CARD_LOG ?=
POCKET_CARD_CAPTURE_LOG ?= $(BUILD_DIR)/pocket-card-probe.log
POCKET_CARD_LOG_SUMMARY_JSON ?= $(BUILD_DIR)/pocket_card_probe_log_summary.json
```

Add these names to the `.PHONY` declaration:

```make
pocket_card_contract_tests pocket_card_fixture pocket_card_probe_build pocket_card_probe_flash pocket_card_probe_monitor pocket_card_probe_capture pocket_card_probe_summarize pocket_card_probe_check_log
```

Add these targets beside the P4 probe targets:

```make
pocket_card_contract_tests:
	$(NODE) hardware/pocket_card/test_pin_contract.js
	$(NODE) scripts/test_build_pocket_card_fixture.js
	$(NODE) scripts/test_handheld_probe_log.js

pocket_card_fixture:
	$(CMAKE) --build $(BUILD_DIR) --target puzzlescript_cpp
	$(NODE) scripts/build_pocket_card_fixture.js --binary "$(abspath $(PUZZLESCRIPT_CPP))" --source src/demo/sokoban_basic.txt --out firmware/pocket_card/main/sokoban_basic.ir.json

pocket_card_probe_build: pocket_card_contract_tests pocket_card_fixture
	cd $(POCKET_CARD_FIRMWARE_DIR) && $(IDF_PY) set-target esp32s3
	cd $(POCKET_CARD_FIRMWARE_DIR) && $(IDF_PY) build

pocket_card_probe_flash:
	@if [ -z "$(POCKET_CARD_PORT)" ]; then echo "Set POCKET_CARD_PORT to the detected serial device" >&2; exit 2; fi
	cd $(POCKET_CARD_FIRMWARE_DIR) && $(IDF_PY) -p "$(POCKET_CARD_PORT)" flash

pocket_card_probe_monitor:
	@if [ -z "$(POCKET_CARD_PORT)" ]; then echo "Set POCKET_CARD_PORT to the detected serial device" >&2; exit 2; fi
	cd $(POCKET_CARD_FIRMWARE_DIR) && $(IDF_PY) -p "$(POCKET_CARD_PORT)" monitor

pocket_card_probe_capture:
	@if [ -z "$(POCKET_CARD_PORT)" ]; then echo "Set POCKET_CARD_PORT to the detected serial device" >&2; exit 2; fi
	@mkdir -p "$(dir $(abspath $(POCKET_CARD_CAPTURE_LOG)))"
	cd $(POCKET_CARD_FIRMWARE_DIR) && $(IDF_PY) -p "$(POCKET_CARD_PORT)" monitor 2>&1 | tee "$(abspath $(POCKET_CARD_CAPTURE_LOG))"
	$(NODE) scripts/handheld_probe_log.js --log "$(abspath $(POCKET_CARD_CAPTURE_LOG))" --out "$(POCKET_CARD_LOG_SUMMARY_JSON)" --require-phase BOOT --require-phase LOAD_IR --require-phase CREATE_RUNTIME --require-phase LOAD_LEVEL --require-phase INPUT_TRACE --require-phase UNLOAD --require-heap-region internal --require-heap-region spiram --fail-on-failure

pocket_card_probe_summarize:
	@if [ -z "$(POCKET_CARD_LOG)" ]; then echo "Set POCKET_CARD_LOG=path/to/probe.log" >&2; exit 2; fi
	$(NODE) scripts/handheld_probe_log.js --log "$(POCKET_CARD_LOG)" --out "$(POCKET_CARD_LOG_SUMMARY_JSON)"

pocket_card_probe_check_log:
	@if [ -z "$(POCKET_CARD_LOG)" ]; then echo "Set POCKET_CARD_LOG=path/to/probe.log" >&2; exit 2; fi
	$(NODE) scripts/handheld_probe_log.js --log "$(POCKET_CARD_LOG)" --out "$(POCKET_CARD_LOG_SUMMARY_JSON)" --require-phase BOOT --require-phase LOAD_IR --require-phase CREATE_RUNTIME --require-phase LOAD_LEVEL --require-phase INPUT_TRACE --require-phase UNLOAD --require-heap-region internal --require-heap-region spiram --fail-on-failure
```

- [ ] **Step 2: Write the usage and gate note**

Create `docs/superpowers/notes/2026-07-12-pocket-card-track0-usage.md`:

````markdown
# Pocket Card Track 0 usage

## Host verification

```bash
cmake -S . -B build
make pocket_card_contract_tests
make pocket_card_fixture
cmake --build build --target pocket_card_runtime_fixture
ctest --test-dir build --output-on-failure -R '^pocket_card_runtime_fixture$'
```

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
phases, no allocation failures, and valid JSON events.

Track 0 is complete when the host tests and firmware build pass and one physical
ES3C28P capture passes the serial-log gate. Display, storage, audio, battery,
touch-controller discovery, and MCP23017 work belong to the next plan.
````

- [ ] **Step 3: Run all host-side Track 0 tests**

Run:

```bash
cmake -S . -B build
make pocket_card_contract_tests
make pocket_card_fixture
cmake --build build --target pocket_card_runtime_fixture
ctest --test-dir build --output-on-failure -R '^pocket_card_runtime_fixture$'
```

Expected: all commands exit 0; CTest reports `1/1` passed.

- [ ] **Step 4: Build firmware through the Make target**

Run:

```bash
source "$HOME/esp/esp-idf/export.sh"
make pocket_card_probe_build
```

Expected: ESP-IDF build succeeds for `esp32s3` and produces the `.bin`.

- [ ] **Step 5: Commit build targets and usage**

```bash
git add Makefile docs/superpowers/notes/2026-07-12-pocket-card-track0-usage.md
git commit -m "docs: add Pocket Card Track 0 workflow"
```

### Task 8: Final verification and physical-module handoff

**Files:**
- Verify only; no source changes expected.

- [ ] **Step 1: Run the repository-level host gates**

Run:

```bash
node hardware/pocket_card/test_pin_contract.js
node scripts/test_build_pocket_card_fixture.js
node scripts/test_handheld_probe_log.js
ctest --test-dir build --output-on-failure -R 'pocket_card_runtime_fixture|runtime_standalone_link|handheld_display_layout'
```

Expected: all commands exit 0 with no failed CTest cases.

- [ ] **Step 2: Run the clean firmware build and compiler-exclusion gate**

Run:

```bash
source "$HOME/esp/esp-idf/export.sh"
idf.py -C firmware/pocket_card fullclean
make pocket_card_probe_build
rg '/src/compiler/' firmware/pocket_card/build/puzzlescript_pocket_card_probe.map
```

Expected: clean build succeeds; final `rg` exits 1 with no output.

- [ ] **Step 3: Check the firmware size and staged scope**

Run:

```bash
source "$HOME/esp/esp-idf/export.sh"
idf.py -C firmware/pocket_card size
git status --short
```

Expected: the factory app fits the 7 MB partition; worktree is clean after the
task commits.

- [ ] **Step 4: When an ES3C28P is present, flash and capture the proof**

Run:

```bash
ls /dev/cu.usbmodem*
export POCKET_CARD_PORT=/dev/cu.usbmodem2101
make pocket_card_probe_flash
make pocket_card_probe_capture
```

Expected serial phase statuses:

```text
BOOT pass
LOAD_IR pass
CREATE_RUNTIME pass
LOAD_LEVEL pass
INPUT_TRACE pass right_down_undo_restart
UNLOAD pass
```

The captured summary must report no failed phases, parsing errors, or allocation
failures. Record minimum internal free memory, largest internal block, and PSRAM
free memory for the next peripheral-bring-up plan.

## Plan self-review checklist

- Spec coverage in this track: separate S3 target, desktop compilation,
  runtime-only firmware, module pin contract, structured memory evidence, and
  deterministic runtime input trace are covered.
- Deliberately deferred: display, touch discovery, SD, audio, battery ADC,
  expander, controls, cartridges, saves, mechanical parts, and pilots each have
  an explicit later-plan boundary.
- Type consistency: `Phase`, `run_runtime_probe`, `probe_log_init`, fixture
  filename/symbol, Make variables, and log paths use one spelling throughout.
- Placeholder scan: the serial port is shown as a concrete example and the
  operator is explicitly told to replace it with the device path printed by
  `ls`; no implementation placeholders remain.
