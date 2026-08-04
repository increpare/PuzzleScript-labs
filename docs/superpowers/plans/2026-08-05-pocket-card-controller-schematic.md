# Pocket Card Controller Schematic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a real KiCad 10 schematic for the existing Pocket Card controller, link every symbol to its already placed PCB footprint, and make one tested connectivity model drive both schematic generation and PCB net assignment.

**Architecture:** A canonical `connectivity.json` records component identity, stable UUIDs, pins, nets, explicit no-connects, and exceptional board-only pad rules. JavaScript validates that model, emits a deterministic flat KiCad schematic, and checks the live board for exact pin/net and UUID parity; a small standard-library Python adapter supplies the same assignments to `pcb.py` and `pcb_route.py`. The current routed board is never regenerated as part of schematic generation.

**Tech Stack:** Node.js standard library, Python 3 standard library, KiCad 10 S-expression files, `kicad-cli` ERC/netlist/PDF export, existing KiCad `pcbnew` routing pipeline.

---

## File structure

| Path | Responsibility |
|---|---|
| `hardware/pocket_card/schematic/connectivity.json` | Canonical components, UUIDs, pin inventory, nets, no-connects, and board-only pad rules |
| `hardware/pocket_card/schematic/validate_connectivity.js` | Pure model validation, lookup helpers, and balanced KiCad PCB footprint/pad parsing |
| `hardware/pocket_card/schematic/connectivity_test.js` | Contract tests for the exact MCP23017, switch, connector, and battery mapping |
| `hardware/pocket_card/schematic/generate_kicad.js` | Deterministic KiCad 10 schematic S-expression generator |
| `hardware/pocket_card/schematic/generate_kicad_test.js` | Determinism, actual-pin-label attachment, CLI load, ERC, netlist, PDF, and UUID tests |
| `hardware/pocket_card/schematic/board_parity_test.js` | Read-only comparison of the canonical model with the current routed board |
| `hardware/pocket_card/schematic/README.md` | Source-of-truth, regeneration, retro-link, and forward-annotation workflow |
| `hardware/pocket_card/case/pcb_connectivity.py` | Standard-library JSON loader and normalized pad assignment API for PCB scripts |
| `hardware/pocket_card/case/test_pcb_connectivity.py` | Python-side parity and duplicate-pad assignment tests |
| `hardware/pocket_card/case/pcb.py` | Preserve canonical component UUIDs on regenerated footprint instances |
| `hardware/pocket_card/case/pcb_route.py` | Apply model assignments instead of geometry-selecting GPIOs |
| `hardware/pocket_card/case/build_pcb.sh` | Validate/generate schematic before any intentional PCB rebuild |
| `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch` | Generated, reviewable schematic artifact next to the existing project and board |
| `hardware/pocket_card/ELECTRICAL_AUDIT.md` | Separate audit of omissions found by the exact reconstruction |
| `hardware/pocket_card/README.md` | Link the schematic and explain its authority |
| `Makefile` | Fast schematic test and generation targets |

## Safety invariant

Before each task that reads the board, record:

```bash
git status --short -- hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb
shasum -a 256 hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb
```

Schematic generation and tests must leave that hash unchanged. Do not run
`hardware/pocket_card/case/build_pcb.sh`, `pcb.py`, `pcb_route.py`, or
`pcb_reroute.py` against the live board during Tasks 1-5. Tests that need a PCB
generator use a temporary directory or pure functions.

Implementation runs in a dedicated worktree. Because the original workspace
contains an uncommitted, newer PCB, board-reading tools accept
`POCKET_CARD_BOARD=/absolute/path/to/pocket_card_controller.kicad_pcb`. Point
that variable at the original workspace board during parity tests; never copy
or stage the user's PCB into the implementation branch. With the variable
unset, tools use `meta.sourceBoard` relative to `connectivity.json`.

### Task 1: Canonical connectivity model and validator

**Files:**
- Create: `hardware/pocket_card/schematic/connectivity.json`
- Create: `hardware/pocket_card/schematic/validate_connectivity.js`
- Create: `hardware/pocket_card/schematic/connectivity_test.js`

- [ ] **Step 1: Write failing validator tests**

Create a tiny test harness matching the repository's existing hardware tests,
then assert the exact current mapping:

```js
"use strict";

var assert = require("assert");
var V = require("./validate_connectivity.js");
var passed = 0;

function test(name, fn) {
    fn();
    passed++;
    console.log("ok - " + name);
}

test("the exact controller contract validates", function () {
    assert.deepStrictEqual(V.validateConnectivity(V.model), []);
});

test("MCP23017 routing matches the current board", function () {
    var nets = V.pinNetMap(V.model);
    assert.strictEqual(nets["U1.1"], "SIG_UP");
    assert.strictEqual(nets["U1.21"], "SIG_DOWN");
    assert.strictEqual(nets["U1.22"], "SIG_RESET");
    assert.strictEqual(nets["U1.23"], "SIG_MENU");
    assert.strictEqual(nets["U1.24"], "SIG_LEFT");
    assert.strictEqual(nets["U1.25"], "SIG_RIGHT");
    assert.strictEqual(nets["U1.26"], "SIG_UNDO");
    assert.strictEqual(nets["U1.27"], "SIG_MUTE");
    assert.strictEqual(nets["U1.28"], "SIG_ACTION");
});

test("MCP23017 support pins are explicit", function () {
    var nets = V.pinNetMap(V.model);
    ["15", "16", "17"].forEach(function (pin) {
        assert.strictEqual(nets["U1." + pin], "GND");
    });
    assert.strictEqual(nets["U1.18"], "+3V3");
    assert.strictEqual(nets["U1.20"], "INT");
    assert.deepStrictEqual(V.model.noConnects.U1,
        ["2", "3", "4", "5", "6", "7", "8", "11", "14", "19"]);
});

test("module and battery connectors match the board", function () {
    var nets = V.pinNetMap(V.model);
    assert.deepStrictEqual([
        nets["J_I2C.1"], nets["J_I2C.2"],
        nets["J_I2C.3"], nets["J_I2C.4"]
    ], ["+3V3", "GND", "SCL", "SDA"]);
    assert.strictEqual(nets["J_EXP.1"], "INT");
    assert.strictEqual(nets["J_BAT_IN.1"], "BAT_P");
    assert.strictEqual(nets["J_BAT_OUT.1"], "BAT_SW");
    assert.strictEqual(nets["SW_PWR.2"], "BAT_P");
    assert.strictEqual(nets["SW_PWR.1"], "BAT_SW");
});

test("every gameplay switch is active low", function () {
    var nets = V.pinNetMap(V.model);
    ["UP", "DOWN", "LEFT", "RIGHT", "UNDO", "ACTION", "RESET", "MENU"]
        .forEach(function (name) {
            assert.strictEqual(nets["SW_" + name + ".1"], "SIG_" + name);
            assert.strictEqual(nets["SW_" + name + ".2"], "GND");
        });
    assert.strictEqual(nets["SW_MUTE.1"], "SIG_MUTE");
    assert.strictEqual(nets["SW_MUTE.2"], "GND");
    assert.strictEqual(nets["SW_MUTE.3"], "GND");
});

console.log(passed + " tests passed");
```

- [ ] **Step 2: Run the tests and verify the expected failure**

Run:

```bash
node hardware/pocket_card/schematic/connectivity_test.js
```

Expected: `MODULE_NOT_FOUND` for `validate_connectivity.js`.

- [ ] **Step 3: Create the exact connectivity model**

Use this schema. Populate the `components` array with all 17 references
(`U1`, ten `SW_*`, four `J_*`, `H1`, and `H2`). Capture each `uuid` from the
top-level footprint UUID currently paired with that reference; do not copy a
property or pad UUID.

```json
{
  "meta": {
    "project": "Pocket Card Controller",
    "revision": "as-routed-2026-08-05",
    "date": "2026-08-05",
    "sourceBoard": "../case/out/pcb/pocket_card_controller.kicad_pcb"
  },
  "components": [
    {
      "ref": "U1",
      "value": "MCP23017-E/SO",
      "footprint": "Package_SO:SOIC-28W_7.5x17.9mm_P1.27mm",
      "uuid": "a0c52e9f-7cf8-4d80-b5d2-9fa1c931e2d6",
      "symbol": "MCP23017"
    },
    {
      "ref": "SW_UP",
      "value": "SKQGABE010",
      "footprint": "Button_Switch_SMD:SW_SPST_SKQG_WithStem",
      "uuid": "12bbd0c6-6028-46e3-acd8-550535105f48",
      "symbol": "TACT"
    }
  ],
  "connections": [
    { "net": "+3V3", "nodes": [["U1", "9"], ["U1", "18"], ["J_I2C", "1"]] },
    { "net": "GND", "nodes": [
      ["U1", "10"], ["U1", "15"], ["U1", "16"], ["U1", "17"],
      ["J_I2C", "2"], ["J_I2C", "MP"], ["J_EXP", "MP"],
      ["J_BAT_IN", "2"], ["J_BAT_IN", "MP"],
      ["J_BAT_OUT", "2"], ["J_BAT_OUT", "MP"],
      ["SW_UP", "2"], ["SW_DOWN", "2"], ["SW_LEFT", "2"],
      ["SW_RIGHT", "2"], ["SW_UNDO", "2"], ["SW_ACTION", "2"],
      ["SW_RESET", "2"], ["SW_MENU", "2"],
      ["SW_MUTE", "2"], ["SW_MUTE", "3"]
    ]},
    { "net": "SCL", "nodes": [["U1", "12"], ["J_I2C", "3"]] },
    { "net": "SDA", "nodes": [["U1", "13"], ["J_I2C", "4"]] },
    { "net": "INT", "nodes": [["U1", "20"], ["J_EXP", "1"]] },
    { "net": "SIG_UP", "nodes": [["U1", "1"], ["SW_UP", "1"]] },
    { "net": "SIG_DOWN", "nodes": [["U1", "21"], ["SW_DOWN", "1"]] },
    { "net": "SIG_RESET", "nodes": [["U1", "22"], ["SW_RESET", "1"]] },
    { "net": "SIG_MENU", "nodes": [["U1", "23"], ["SW_MENU", "1"]] },
    { "net": "SIG_LEFT", "nodes": [["U1", "24"], ["SW_LEFT", "1"]] },
    { "net": "SIG_RIGHT", "nodes": [["U1", "25"], ["SW_RIGHT", "1"]] },
    { "net": "SIG_UNDO", "nodes": [["U1", "26"], ["SW_UNDO", "1"]] },
    { "net": "SIG_MUTE", "nodes": [["U1", "27"], ["SW_MUTE", "1"]] },
    { "net": "SIG_ACTION", "nodes": [["U1", "28"], ["SW_ACTION", "1"]] },
    { "net": "BAT_P", "nodes": [["J_BAT_IN", "1"], ["SW_PWR", "2"]] },
    { "net": "BAT_SW", "nodes": [["SW_PWR", "1"], ["J_BAT_OUT", "1"]] }
  ],
  "noConnects": {
    "U1": ["2", "3", "4", "5", "6", "7", "8", "11", "14", "19"],
    "J_EXP": ["2", "3", "4"],
    "SW_PWR": ["3"]
  },
  "boardOnlyPadRules": [
    { "ref": "SW_MUTE", "pad": "", "net": "GND", "reason": "existing mechanical-pad grounding" }
  ]
}
```

Add the other components with these symbol classes and current footprint UUIDs:

```text
SW_DOWN=c250c9da-2bee-46a4-b7ca-91ff1eb1e266 TACT
SW_LEFT=20120e89-808e-4f14-ae3d-5653da504b64 TACT
SW_RIGHT=33bc12e1-f178-4222-b2ed-5f41de6f189c TACT
SW_UNDO=25f4781b-e4eb-47f3-9c0f-0c804641ace1 TACT
SW_ACTION=2cd59da1-45f9-4108-929d-636ff576196a TACT
SW_RESET=34f2d7dc-aecc-4bec-b762-6ad6d303d6f7 TACT
SW_MENU=13a1e285-a060-4b69-ab4d-d35d08c40518 TACT
SW_PWR=99f09a6a-ec7d-482b-97f6-7a0e90c6b508 SLIDE
SW_MUTE=172d317f-26dc-4e51-b7e0-a83123e0dcd8 SLIDE
J_I2C=3cda2b0e-35cc-46c2-9ccf-8b79d860f180 JST4
J_EXP=febffb9e-0036-460b-9f13-a8bdff6ef02f JST4
J_BAT_IN=1b12a045-9c24-4901-a0e9-fd07ebbb6a46 JST2
J_BAT_OUT=47a61db0-b07c-4fb4-8b6e-7b684c25f7e1 JST2
H1=ddca0b02-a830-481c-bad4-e33758ae5955 MOUNT
H2=e94bb404-f582-4d30-af56-12794bd5a4e0 MOUNT
```

Before committing, rerun the footprint extraction. If a concurrent KiCad save
changed a top-level UUID, use the value in the live board and update the table;
the parity test added in Task 3 is authoritative.

- [ ] **Step 4: Implement strict validation helpers**

`validate_connectivity.js` exports `model`, `componentMap`, `pinNetMap`,
`validateConnectivity`, `parseBoardFootprints`, and `compareBoard`. Validation
must enforce this algorithm:

```js
function validateConnectivity(input) {
    var errors = [];
    var refs = Object.create(null);
    var uuids = Object.create(null);
    var pinNets = Object.create(null);

    input.components.forEach(function (component) {
        if (refs[component.ref]) errors.push("duplicate ref: " + component.ref);
        if (uuids[component.uuid]) errors.push("duplicate uuid: " + component.uuid);
        refs[component.ref] = component;
        uuids[component.uuid] = component.ref;
    });
    input.connections.forEach(function (connection) {
        if (connection.nodes.length < 2 && connection.net !== "GND") {
            errors.push("net has fewer than two nodes: " + connection.net);
        }
        connection.nodes.forEach(function (node) {
            var key = node[0] + "." + node[1];
            if (!refs[node[0]]) errors.push("unknown ref: " + node[0]);
            if (pinNets[key]) errors.push("pin on multiple nets: " + key);
            pinNets[key] = connection.net;
        });
    });
    Object.keys(input.noConnects).forEach(function (ref) {
        input.noConnects[ref].forEach(function (pin) {
            if (pinNets[ref + "." + pin]) errors.push("connected pin marked NC: " + ref + "." + pin);
        });
    });
    return errors;
}
```

Also enforce the MCP23017 support-pin constants and require all 17 named
references. These are contract checks, not configurable policies.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
node hardware/pocket_card/schematic/connectivity_test.js
```

Expected: all tests pass and the last line reports the count.

- [ ] **Step 6: Commit the model and validation layer**

```bash
git add hardware/pocket_card/schematic/connectivity.json \
  hardware/pocket_card/schematic/validate_connectivity.js \
  hardware/pocket_card/schematic/connectivity_test.js
git commit -m "feat: model pocket card controller connectivity"
```

### Task 2: Real deterministic KiCad schematic

**Files:**
- Create: `hardware/pocket_card/schematic/generate_kicad.js`
- Create: `hardware/pocket_card/schematic/generate_kicad_test.js`
- Create: `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch`

- [ ] **Step 1: Write failing generation and electrical-attachment tests**

The tests must generate twice, compare bytes, and require every modeled symbol
UUID plus real pin-attached labels and no-connect markers:

```js
"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");
var gen = require("./generate_kicad.js");
var V = require("./validate_connectivity.js");

var output = path.join(__dirname, "..", "case", "out", "pcb",
    "pocket_card_controller.kicad_sch");

gen.generateAll();
var first = fs.readFileSync(output, "utf8");
gen.generateAll();
var second = fs.readFileSync(output, "utf8");

assert.strictEqual(second, first, "schematic generation must be deterministic");
V.model.components.forEach(function (component) {
    assert.ok(first.indexOf('(uuid "' + component.uuid + '")') !== -1,
        component.ref + " symbol UUID");
});
V.model.connections.forEach(function (connection) {
    assert.ok(first.indexOf('(label "' + connection.net + '"') !== -1,
        connection.net + " label");
});
Object.keys(V.model.noConnects).forEach(function (ref) {
    V.model.noConnects[ref].forEach(function (pin) {
        assert.ok(first.indexOf("NC " + ref + "." + pin) !== -1,
            ref + "." + pin + " no-connect audit marker");
    });
});

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-card-sch-"));
var tmpSch = path.join(tmp, "pocket_card_controller.kicad_sch");
fs.writeFileSync(tmpSch, first);
var upgraded = childProcess.spawnSync("kicad-cli", ["sch", "upgrade", "--force", tmpSch],
    { encoding: "utf8" });
assert.strictEqual(upgraded.status, 0, upgraded.stdout + upgraded.stderr);
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```bash
node hardware/pocket_card/schematic/generate_kicad_test.js
```

Expected: `MODULE_NOT_FOUND` for `generate_kicad.js`.

- [ ] **Step 3: Implement deterministic UUIDs for non-component objects**

Component symbol UUIDs come from the model. All other sheet, property, wire,
label, and library object UUIDs use this deterministic helper:

```js
function stableUuid(key) {
    var hex = crypto.createHash("sha1")
        .update("pocket-card-controller:" + key)
        .digest("hex").slice(0, 32);
    return [
        hex.slice(0, 8), hex.slice(8, 12),
        "4" + hex.slice(13, 16),
        ((parseInt(hex.charAt(16), 16) & 3) | 8).toString(16) + hex.slice(17, 20),
        hex.slice(20, 32)
    ].join("-");
}
```

Never use a counter whose output changes when an earlier object is inserted;
keys contain semantic identities such as `label:U1:12:SCL`.

- [ ] **Step 4: Implement embedded electrical symbols and layout**

Generate one A4 landscape sheet with custom embedded symbols named
`PocketCard:MCP23017`, `PocketCard:Tact`, `PocketCard:SlideSPDT`,
`PocketCard:JST4`, `PocketCard:JST2`, and `PocketCard:Mount`. Each symbol pin
definition must use the actual PCB pad number. Use these instance anchors:

```js
var POSITION = {
    J_I2C: [35, 35], J_EXP: [35, 75],
    U1: [105, 70],
    SW_UP: [185, 30], SW_DOWN: [185, 50],
    SW_LEFT: [185, 70], SW_RIGHT: [185, 90],
    SW_UNDO: [235, 30], SW_ACTION: [235, 50],
    SW_RESET: [235, 70], SW_MENU: [235, 90],
    SW_MUTE: [235, 115],
    J_BAT_IN: [35, 130], SW_PWR: [105, 130], J_BAT_OUT: [185, 130],
    H1: [255, 130], H2: [270, 130]
};
```

For every symbol pin, the generator calculates its connection endpoint from
the symbol definition. Connected pins get a 5.08 mm wire stub and a local label
at the far endpoint. Unconnected pins get a KiCad `no_connect` at the pin
endpoint and a hidden text marker `NC <ref>.<pin>` used by tests. Power and
ground symbols are optional decoration; labels remain the electrical source.

The symbol `Footprint` property must contain the exact library identifier from
the model. H1/H2 use `exclude_from_sim yes`, `in_bom no`, and `on_board yes`.

- [ ] **Step 5: Run generator tests and inspect KiCad parsing**

Run:

```bash
node hardware/pocket_card/schematic/generate_kicad_test.js
kicad-cli sch export svg \
  --output /tmp/pocket-card-controller-svg \
  hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch
```

Expected: tests pass, KiCad exits 0, and `/tmp/pocket-card-controller-svg/`
contains a rendered sheet.

- [ ] **Step 6: Commit the generated schematic**

First confirm the PCB hash from the safety invariant is unchanged. Then:

```bash
git add hardware/pocket_card/schematic/generate_kicad.js \
  hardware/pocket_card/schematic/generate_kicad_test.js \
  hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch
git commit -m "feat: generate pocket card controller schematic"
```

### Task 3: Board parity and retroactive UUID links

**Files:**
- Modify: `hardware/pocket_card/schematic/validate_connectivity.js`
- Modify: `hardware/pocket_card/schematic/connectivity_test.js`
- Create: `hardware/pocket_card/schematic/board_parity_test.js`

- [ ] **Step 1: Write failing parser and parity tests**

Balanced-parenthesis parsing is required because footprints contain nested
zones. Do not use a `.*?` regex for whole footprints.

```js
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var V = require("./validate_connectivity.js");

var boardPath = process.env.POCKET_CARD_BOARD || path.join(__dirname, "..",
    "case", "out", "pcb", "pocket_card_controller.kicad_pcb");
var board = fs.readFileSync(boardPath, "utf8");
var footprints = V.parseBoardFootprints(board);
var errors = V.compareBoard(V.model, footprints);

assert.strictEqual(Object.keys(footprints).length, 17);
assert.deepStrictEqual(errors, [], errors.join("\n"));
V.model.components.forEach(function (component) {
    assert.strictEqual(footprints[component.ref].uuid, component.uuid,
        component.ref + " retroactive UUID link");
});
console.log("board parity OK (17 linked footprints)");
```

Add unit fixtures proving the parser returns both duplicated SKQG pad `1`
instances and both JST `MP` pads.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
POCKET_CARD_BOARD=/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs/hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb \
  node hardware/pocket_card/schematic/board_parity_test.js
```

Expected: failure because `parseBoardFootprints` or `compareBoard` is not yet
implemented, or because the UUID snapshot changed and needs recapturing.

- [ ] **Step 3: Implement balanced block and pad parsing**

Add a scanner that ignores parentheses inside quoted strings and returns a
complete S-expression block beginning at a supplied offset:

```js
function balancedBlock(text, start) {
    var depth = 0;
    var quoted = false;
    var escaped = false;
    for (var i = start; i < text.length; i++) {
        var ch = text.charAt(i);
        if (quoted) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') quoted = false;
            continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === "(") depth++;
        else if (ch === ")" && --depth === 0) return text.slice(start, i + 1);
    }
    throw new Error("unterminated S-expression at " + start);
}
```

`parseBoardFootprints` finds top-level footprint openings at line starts,
extracts the first top-level UUID and reference property, and scans all pad
blocks into `{number, net}` entries without collapsing duplicate pad numbers.

- [ ] **Step 4: Implement exact model-to-board comparison**

For every numbered modeled node, all PCB pads with that reference and number
must have the model net. For every board-only pad rule, all matching pads must
have the specified net. Pads absent from both the model and board-only rules
must remain unnetted. H1/H2 are allowed to have only an unnumbered, unnetted
NPTH pad.

Return errors with actionable strings:

```text
SW_UP pad 1 expected SIG_UP, found GND
J_I2C UUID expected ..., found ...
U1 pad 2 expected unconnected, found SIG_...
```

- [ ] **Step 5: Run the full JavaScript schematic suite**

```bash
node hardware/pocket_card/schematic/connectivity_test.js
node hardware/pocket_card/schematic/generate_kicad_test.js
POCKET_CARD_BOARD=/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs/hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb \
  node hardware/pocket_card/schematic/board_parity_test.js
```

Expected: all pass; board parity reports 17 linked footprints. Recheck the live
board hash to prove read-only behavior.

- [ ] **Step 6: Commit parity enforcement**

```bash
git add hardware/pocket_card/schematic/validate_connectivity.js \
  hardware/pocket_card/schematic/connectivity_test.js \
  hardware/pocket_card/schematic/board_parity_test.js
git commit -m "test: enforce pocket card schematic pcb parity"
```

### Task 4: Make PCB generation consume canonical connectivity

**Files:**
- Create: `hardware/pocket_card/case/pcb_connectivity.py`
- Create: `hardware/pocket_card/case/test_pcb_connectivity.py`
- Modify: `hardware/pocket_card/case/pcb.py:23-33,70-72,107-149,365-477`
- Modify: `hardware/pocket_card/case/pcb_route.py:22-50,162-214,268-270`

- [ ] **Step 1: Write failing Python adapter tests**

Use `unittest` and plain mock pad objects so these tests do not require
KiCad's bundled Python:

```python
import unittest

import pcb_connectivity as C


class ConnectivityTest(unittest.TestCase):
    def test_expander_mapping_is_static(self):
        assignments = C.pad_net_map()
        self.assertEqual(assignments[("U1", "1")], "SIG_UP")
        self.assertEqual(assignments[("U1", "21")], "SIG_DOWN")
        self.assertEqual(assignments[("U1", "28")], "SIG_ACTION")

    def test_duplicate_pad_numbers_share_a_net(self):
        assignments = C.pad_net_map()
        self.assertEqual(assignments[("SW_UP", "1")], "SIG_UP")
        self.assertEqual(assignments[("SW_UP", "2")], "GND")

    def test_component_uuid_is_canonical(self):
        self.assertEqual(C.component_uuid("U1"),
                         C.model()["components"][0]["uuid"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```bash
cd hardware/pocket_card/case && python3 -m unittest test_pcb_connectivity.py
```

Expected: import failure for `pcb_connectivity`.

- [ ] **Step 3: Implement the pure Python adapter**

`pcb_connectivity.py` loads `../schematic/connectivity.json` once and exports:

```python
def model(): ...
def component(ref): ...
def component_uuid(ref): ...
def pad_net_map(): ...
def board_only_rules(): ...
def assignments_for(ref): ...
```

`pad_net_map()` returns one `(reference, pad_number) -> net` entry per model
node. Multiple footprint pads with the same number deliberately consume the
same entry.

- [ ] **Step 4: Preserve component UUIDs in `pcb.py`**

Import `pcb_connectivity as C`. Change `footprint_sexpr` to accept a
`component_uuid` argument and emit it for only the top-level footprint UUID:

```python
def footprint_sexpr(lib, name, x, y, ref, rot=0, back=False):
    component_uuid = C.component_uuid(ref)
    # Library child UUIDs may still use _uid(); the footprint opening uses:
    out = [
        '\t(footprint "%s"' % name,
        '\t\t(layer "%s")' % layer,
        '\t\t(uuid "%s")' % component_uuid,
        '\t\t%s' % at,
    ]
```

For the optional pcbnew path, set the footprint UUID through the supported
KiCad API if available. If KiCad's Python bindings do not expose a setter,
raise a clear error before saving rather than generate an unlinked board; the
headless S-expression path remains the supported build path.

Add a pure `build_sexpr()` test that parses its returned text and confirms all
17 top-level footprint UUIDs match the model. Do not execute `pcb.py` as a
script in this test because its normal output path is the live board.

- [ ] **Step 5: Replace geometry-selected nets in `pcb_route.py`**

Delete `GPIO`, `SWITCHES`, the nearest-pad search, and the hand-written pin
assignment loops. Apply canonical assignments uniformly:

```python
import pcb_connectivity as C


def apply_connectivity(board, footprints):
    nets = {}
    for (ref, pad_name), net_name in C.pad_net_map().items():
        target = nets.setdefault(net_name, net(board, net_name))
        matches = [pad for pad in footprints[ref].Pads()
                   if pad.GetPadName() == pad_name]
        if not matches:
            raise KeyError("%s has no pad %s" % (ref, pad_name))
        for pad in matches:
            pad.SetNet(target)
    for rule in C.board_only_rules():
        target = nets.setdefault(rule["net"], net(board, rule["net"]))
        for pad in footprints[rule["ref"]].Pads():
            if pad.GetPadName() == rule["pad"]:
                pad.SetNet(target)
    return nets
```

Print the fixed expander mapping from `connectivity.json` after routing. No
trace-length or placement calculation may select a different GPIO.

- [ ] **Step 6: Run adapter and static integration tests**

```bash
cd hardware/pocket_card/case
python3 -m unittest test_pcb_connectivity.py
cd ../../..
POCKET_CARD_BOARD=/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs/hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb \
  node hardware/pocket_card/schematic/board_parity_test.js
```

Expected: all tests pass. The live PCB hash is unchanged.

- [ ] **Step 7: Commit PCB source-of-truth integration**

```bash
git add hardware/pocket_card/case/pcb_connectivity.py \
  hardware/pocket_card/case/test_pcb_connectivity.py \
  hardware/pocket_card/case/pcb.py \
  hardware/pocket_card/case/pcb_route.py
git commit -m "refactor: share pocket card schematic connectivity"
```

### Task 5: ERC, exported netlist, PDF legibility, and audit

**Files:**
- Modify: `hardware/pocket_card/schematic/generate_kicad_test.js`
- Create: `hardware/pocket_card/ELECTRICAL_AUDIT.md`

- [ ] **Step 1: Add failing CLI verification tests**

Run KiCad only on a temporary copy. Require loadable schematic, JSON ERC, a
KiCad netlist containing all canonical nets, and a nonempty PDF:

```js
var ercPath = path.join(tmp, "erc.json");
var netlistPath = path.join(tmp, "controller.net");
var pdfPath = path.join(tmp, "controller.pdf");

function run(args) {
    var result = childProcess.spawnSync("kicad-cli", args, { encoding: "utf8" });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
}

run(["sch", "erc", "--format", "json", "--severity-error",
    "--exit-code-violations", "--output", ercPath, tmpSch]);
run(["sch", "export", "netlist", "--output", netlistPath, tmpSch]);
run(["sch", "export", "pdf", "--output", pdfPath, tmpSch]);

var netlist = fs.readFileSync(netlistPath, "utf8");
V.model.connections.forEach(function (connection) {
    assert.ok(netlist.indexOf(connection.net) !== -1, connection.net);
});
assert.ok(fs.statSync(pdfPath).size > 1000, "nonempty schematic PDF");
```

- [ ] **Step 2: Run and characterize ERC failures**

```bash
node hardware/pocket_card/schematic/generate_kicad_test.js
```

Expected initially: failure naming real electrical pin-type or unconnected-pin
issues. Fix symbol electrical types and explicit no-connect markers, not by
globally suppressing ERC.

- [ ] **Step 3: Make ERC pass without hiding the audit findings**

Use `power_in`, `input`, `open_collector`, and `passive` pin types where they
describe MCP23017 and connector behavior. The absence of a decoupling
capacitor, test points, and local I2C pull-ups is documented in the audit;
those are design findings, not syntactic ERC errors.

- [ ] **Step 4: Write the separate electrical audit**

Create `ELECTRICAL_AUDIT.md` with these explicit findings and dispositions:

```markdown
# Pocket Card Controller Electrical Audit

The generated schematic is an exact reconstruction of the routed controller,
not an endorsement that it is production-ready.

| Finding | Current implementation | Disposition |
|---|---|---|
| MCP23017 decoupling | No local bypass capacitor | Add 100 nF close to pins 9/10 in the next reviewed PCB revision |
| Factory access | No dedicated test points | Add 3V3, GND, SDA, SCL, INT, and representative input test pads |
| I2C pull-ups | Relies on ES3C28P module pull-ups | Measure/confirm module values before adding parallel pull-ups |
| Input map | Nine inputs, geometry-derived legacy allocation | Frozen explicitly in connectivity.json; update firmware from this contract |
| Interrupt/reset/address | INTA to module IO2; RESET high; A0-A2 low | Verify module GPIO2 suitability and power-up behavior |
| Mechanical copper | JST MP and mute mechanical pads tied to GND | Confirm footprint/vendor guidance before production release |
```

- [ ] **Step 5: Render and inspect the PDF**

```bash
mkdir -p /tmp/pocket-card-sch-review
kicad-cli sch export pdf \
  --output /tmp/pocket-card-sch-review/pocket_card_controller.pdf \
  hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch
```

Render the PDF using the PDF skill's Poppler workflow and inspect the page.
Require no overlapping symbols/text, clipped title block, floating labels, or
ambiguous no-connect markers. Adjust only schematic presentation and rerun the
determinism/CLI tests.

- [ ] **Step 6: Commit CLI verification and audit**

```bash
git add hardware/pocket_card/schematic/generate_kicad_test.js \
  hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch \
  hardware/pocket_card/ELECTRICAL_AUDIT.md
git commit -m "docs: audit pocket card controller circuit"
```

### Task 6: Build targets and operating documentation

**Files:**
- Create: `hardware/pocket_card/schematic/README.md`
- Modify: `hardware/pocket_card/README.md:1-15`
- Modify: `hardware/pocket_card/case/README.md:18-42,110-135`
- Modify: `hardware/pocket_card/case/build_pcb.sh:17-41`
- Modify: `Makefile:18,550-565,919-930,948-964`

- [ ] **Step 1: Add failing Make target smoke expectation**

Run before editing:

```bash
make pocket_card_schematic_tests
```

Expected: `No rule to make target 'pocket_card_schematic_tests'`.

- [ ] **Step 2: Add focused Make targets**

Add both names to `.PHONY`, help output, and these recipes:

```make
pocket_card_schematic_tests:
	$(NODE) hardware/pocket_card/schematic/connectivity_test.js
	$(NODE) hardware/pocket_card/schematic/generate_kicad_test.js
	POCKET_CARD_BOARD="$${POCKET_CARD_BOARD:-hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb}" \
	  $(NODE) hardware/pocket_card/schematic/board_parity_test.js
	cd hardware/pocket_card/case && python3 -m unittest test_pcb_connectivity.py

pocket_card_kicad:
	$(NODE) hardware/pocket_card/schematic/validate_connectivity.js
	$(NODE) hardware/pocket_card/schematic/generate_kicad.js
	$(MAKE) pocket_card_schematic_tests
```

- [ ] **Step 3: Guard intentional PCB rebuilds**

At the start of `build_pcb.sh`, before `pcb.py`, run:

```bash
node ../schematic/validate_connectivity.js
node ../schematic/generate_kicad.js
```

Update the step numbering/output so schematic validation is step 1 and PCB
placement is step 2. This script remains intentionally destructive to its
generated board output; documentation must tell users to commit/stash reviewed
PCB work before invoking it.

- [ ] **Step 4: Document the linked KiCad workflow**

The schematic README must state:

1. edit `connectivity.json` for electrical changes;
2. run `make pocket_card_kicad`;
3. open `pocket_card_controller.kicad_pro`;
4. on the first legacy reconciliation only, choose **Update PCB from
   Schematic**, enable reference-based re-linking, disable footprint
   replacement, and disable deletion of unmatched footprints;
5. verify the preview contains no added/deleted/moved footprints;
6. apply the update, save, and thereafter leave reference-based re-linking off;
7. run ERC and PCB DRC before manufacture.

Also explain that the generated symbol and existing footprint already share
UUIDs when `board_parity_test.js` passes, so the GUI reconciliation option is a
fallback/sanity check rather than a routine step.

- [ ] **Step 5: Run focused build/documentation verification**

```bash
make pocket_card_kicad
git diff --check
git status --short -- hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb
shasum -a 256 hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb
```

Expected: all tests pass, only the generated schematic changes, and the live
PCB hash remains the safety-invariant value.

- [ ] **Step 6: Commit build integration and docs**

```bash
git add Makefile \
  hardware/pocket_card/README.md \
  hardware/pocket_card/case/README.md \
  hardware/pocket_card/case/build_pcb.sh \
  hardware/pocket_card/schematic/README.md
git commit -m "docs: establish pocket card schematic workflow"
```

### Task 7: Final verification and preservation proof

**Files:**
- Modify only if verification exposes a defect in a file already listed above.

- [ ] **Step 1: Run all focused tests from a clean implementation worktree**

```bash
make pocket_card_kicad
node hardware/pocket_card/schematic/connectivity_test.js
node hardware/pocket_card/schematic/generate_kicad_test.js
POCKET_CARD_BOARD=/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs/hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb \
  node hardware/pocket_card/schematic/board_parity_test.js
cd hardware/pocket_card/case && python3 -m unittest test_pcb_connectivity.py
```

Expected: every command exits 0.

- [ ] **Step 2: Run KiCad ERC and exports directly**

```bash
kicad-cli sch erc --format json --severity-error --exit-code-violations \
  --output /tmp/pocket-card-controller-erc.json \
  hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch
kicad-cli sch export netlist \
  --output /tmp/pocket-card-controller.net \
  hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch
kicad-cli sch export pdf \
  --output /tmp/pocket-card-controller.pdf \
  hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch
```

Expected: all exit 0; PDF and netlist are nonempty.

- [ ] **Step 3: Prove the live routed board was preserved**

Compare the final board SHA-256 with the hash recorded before Task 1. Then run:

```bash
git diff -- hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb
```

Expected: no implementation-created board diff. Pre-existing user changes may
still appear in the original working tree; the implementation must not claim
or stage them.

- [ ] **Step 4: Inspect final repository scope**

```bash
git status --short
git log --oneline -8
git diff --check HEAD~6..HEAD
```

Expected: only planned source, schematic, docs, tests, and build integration
are in the implementation commits. Existing case meshes, Blender files,
Gerbers, routes, and other generated outputs are untouched.

- [ ] **Step 5: Run verification-before-completion review**

Invoke `superpowers:verification-before-completion`, report exact command
outputs, and do not call the schematic complete unless ERC, netlist parity,
UUID parity, deterministic generation, PDF inspection, and PCB preservation
all have current evidence.
