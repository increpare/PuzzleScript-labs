# P4 Handheld Circuit Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete net-level schematic and JLC-checked BOM for a custom single-board ESP32-P4 handheld in `hardware/p4_handheld/`, per the approved spec `docs/superpowers/specs/2026-07-12-p4-handheld-circuit-design.md`.

**Architecture:** Single board, chip-down ESP32-P4NRW32X, small MIPI-DSI panel on FFC, power/compute blocks salvaged from `hardware/card/`, direct-GPIO buttons, I2S mono amp, microSD. Schematic-as-code: a de-carded copy of the `hardware/card/schematic/` pipeline (`connectivity.json` → `generate_kicad.js` → KiCad project + BOM CSV), with the PCB-generation path removed.

**Tech Stack:** Node.js (repo-style plain scripts, `"use strict"`, no deps), KiCad 8 (`kicad-cli` for ERC), JLCPCB parts catalog JSON.

## Global Constraints

- MCU part is **ESP32-P4NRW32X** (X = v3.x silicon); plain NRW32 is NRND and must not appear in any BOM line.
- No radio, no antenna, no RF keepout anywhere in the design.
- Phase ends at schematic + BOM. **No PCB layout, no Gerbers, no mechanical, no firmware.**
- Do not modify `hardware/card/` or `hardware/pocket_card/` — copy, never edit in place.
- Panel, battery, and speaker are hand-attached BOM lines, never pick-and-place parts.
- Panel selection requires all five checks from the spec (esp_lcd controller support; published pinout with 1–2 DSI lanes; feasible backlight; touch wired-but-disabled policy; small-quantity buyable).
- Every pick-and-place BOM line needs a JLC part number checked in stock, or a documented consignment/alternative.
- Deferred by explicit gate (footprint `"TBD"` + `"gate"` field, following the card convention): battery connector footprint, button mechanism footprints, panel FFC contact orientation.
- Plan-time audit result (locks the spec's infra decision): geometry coupling in `generate_kicad.js` is confined to `buildPcb()`/placement/routing helpers and `mechanical/layout.json`; schematic/netlist/BOM generation is data-driven. **Decision: reuse the pipeline, delete the PCB path.**

---

### Task 1: Scaffold `hardware/p4_handheld/` with README

**Files:**
- Create: `hardware/p4_handheld/README.md`

**Interfaces:**
- Produces: the directory all later tasks write into; README records the infra decision later tasks rely on.

- [ ] **Step 1: Write the README**

```markdown
# PuzzleScript P4 Handheld — hardware (parallel track)

Custom single-board ESP32-P4 handheld. Spec:
`docs/superpowers/specs/2026-07-12-p4-handheld-circuit-design.md`.

Parallel exploratory track. The pocket card (`hardware/pocket_card/`,
ES3C28P/ESP32-S3) remains the plan of record. This board salvages circuit
blocks from the retired `hardware/card/` design but copies them — it never
modifies that directory.

## Schematic-as-code

```bash
node hardware/p4_handheld/schematic/generate_kicad.js
node hardware/p4_handheld/schematic/connectivity_test.js
node hardware/p4_handheld/schematic/generate_kicad_test.js
```

Net source of truth: `schematic/connectivity.json`. Edit it, run the tests,
then regenerate. Do not hand-edit generated `.kicad_*` files.

**Infra decision (2026-07-12):** the `hardware/card/schematic/` pipeline is
reused with its PCB-generation path deleted. Audit found geometry coupling
confined to `buildPcb()` + placement/routing helpers + `mechanical/layout.json`;
schematic, netlist, and BOM generation are purely connectivity-driven.
PCB generation returns in the layout phase.

## Docs

- `PANEL_RESEARCH.md` — DSI panel candidates, five checks, decision record
- `BLOCK_DIAGRAM.md` — architecture + power tree
- `PIN_BUDGET.md` — P4 pin map: DSI, SDMMC, USB, I2S, I2C, buttons, straps, spares
- `bom/` — generated BOM + availability record

Phase scope: net-level schematic + JLC-checked BOM only. No PCB layout,
no mechanical, no firmware in this phase.
```

- [ ] **Step 2: Verify the tree**

Run: `ls hardware/p4_handheld/`
Expected: `README.md`

- [ ] **Step 3: Commit**

```bash
git add hardware/p4_handheld/README.md
git commit -m "hw(p4_handheld): scaffold parallel-track directory"
```

---

### Task 2: Copy and de-card the schematic pipeline

**Files:**
- Create: `hardware/p4_handheld/schematic/generate_kicad.js` (copied, PCB path removed)
- Create: `hardware/p4_handheld/schematic/validate_connectivity.js` (copied verbatim)
- Create: `hardware/p4_handheld/schematic/connectivity_test.js` (new, minimal)
- Create: `hardware/p4_handheld/schematic/generate_kicad_test.js` (copied, PCB assertions removed)
- Create: `hardware/p4_handheld/schematic/jlc_parts.js`, `jlc_parts_test.js`, `jlc_catalog.json`, `refresh_jlc_packages.js` (copied verbatim)
- Create: `hardware/p4_handheld/schematic/connectivity.json` (minimal seed)

**Interfaces:**
- Consumes: `hardware/card/schematic/*` as copy source.
- Produces: `node hardware/p4_handheld/schematic/connectivity_test.js` and `generate_kicad_test.js` as the standing test cycle; `generateAll()` writing `p4_handheld.kicad_pro`/`.kicad_sch`/`sheets/*.kicad_sch`/`bom/bom_jlc.csv` (no `.kicad_pcb`).

- [ ] **Step 1: Copy the pipeline files**

```bash
mkdir -p hardware/p4_handheld/schematic
cp hardware/card/schematic/{generate_kicad.js,validate_connectivity.js,generate_kicad_test.js,jlc_parts.js,jlc_parts_test.js,jlc_catalog.json,refresh_jlc_packages.js} hardware/p4_handheld/schematic/
```

- [ ] **Step 2: Seed a minimal connectivity.json**

Write `hardware/p4_handheld/schematic/connectivity.json`:

```json
{
  "meta": {
    "project": "PuzzleScript P4 Handheld",
    "revision": "circuit-phase-0",
    "date": "2026-07-12",
    "jlc_catalog": "jlc_catalog.json",
    "power_control": "slide switch gates buck-boost EN; charging works with switch off",
    "mcu": "ESP32-P4NRW32X chip-down (QFN104, no radio)",
    "storage": "microSD via SDMMC (cartridge library is the primary user path)",
    "source_docs": ["PIN_BUDGET.md", "BLOCK_DIAGRAM.md", "PANEL_RESEARCH.md"]
  },
  "sheets": [
    { "id": "power", "file": "sheets/power.kicad_sch", "title": "Power" },
    { "id": "compute", "file": "sheets/compute.kicad_sch", "title": "Compute" },
    { "id": "display", "file": "sheets/display.kicad_sch", "title": "Display" },
    { "id": "controls", "file": "sheets/controls.kicad_sch", "title": "Controls" },
    { "id": "storage", "file": "sheets/storage.kicad_sch", "title": "Storage" },
    { "id": "audio", "file": "sheets/audio.kicad_sch", "title": "Audio" },
    { "id": "debug", "file": "sheets/debug.kicad_sch", "title": "Debug" }
  ],
  "components": [],
  "connections": []
}
```

Note: no `haptic` or `led` sheets — DRV2605/LRA, piezo, and case RGB are card
features the spec drops.

- [ ] **Step 3: De-card `generate_kicad.js`**

In `hardware/p4_handheld/schematic/generate_kicad.js`:

1. Delete the `boardPreview` require (line ~10) and every function that uses
   it (`routePoints` callers, DSI route plan, placement map — the block of
   helpers around lines 800–980 in the card copy).
2. In `generateAll()` (line ~1085): delete the `loadJson(.../mechanical/layout.json)`
   line and the `card.kicad_pcb` write; keep root sheet, sheet files, project
   file, and BOM CSV writes.
3. Rename output basename `card.` → `p4_handheld.` and `CARD_DIR` → `BOARD_DIR`.
4. Change the BOM CSV output path to `path.join(BOARD_DIR, "bom", "bom_jlc.csv")`
   and `fs.mkdirSync(path.join(BOARD_DIR, "bom"), { recursive: true })` before writing.
5. Replace the schematic library prefix string `"PSCard:"` with `"PSP4H:"`
   (`grep -n "PSCard" generate_kicad.js` to find all sites).

- [ ] **Step 4: Write the minimal connectivity test**

Write `hardware/p4_handheld/schematic/connectivity_test.js`:

```js
"use strict";

var assert = require("assert");
var V = require("./validate_connectivity.js");

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("connectivity validates without errors", function () {
    var errors = V.validateConnectivity(V.model);
    assert.deepStrictEqual(errors, [], errors.join("; "));
});

test("board has no radio, haptic, or RGB sheets", function () {
    var ids = V.model.sheets.map(function (s) { return s.id; });
    assert.strictEqual(ids.indexOf("haptic"), -1);
    assert.strictEqual(ids.indexOf("led"), -1);
});

console.log(passed + " tests passed");
```

- [ ] **Step 5: Trim `generate_kicad_test.js`**

Delete every test that asserts on `card.kicad_pcb`, board outline, keep-outs,
placement, or routing (grep for `kicad_pcb`, `layout`, `route`). Keep tests for
root sheet, sheet generation, netlist consistency, and BOM CSV. Update paths
`card.` → `p4_handheld.`.

- [ ] **Step 6: Run the test cycle — expect green on the empty model**

```bash
node hardware/p4_handheld/schematic/connectivity_test.js
node hardware/p4_handheld/schematic/jlc_parts_test.js
node hardware/p4_handheld/schematic/generate_kicad.js
node hardware/p4_handheld/schematic/generate_kicad_test.js
```

Expected: each script exits 0, `ok - ...` lines, and generation produces
`hardware/p4_handheld/p4_handheld.kicad_pro`, `.kicad_sch`,
`schematic/sheets/*.kicad_sch`, `bom/bom_jlc.csv` — and **no** `.kicad_pcb`.
If `validate_connectivity.js` rejects empty component lists, relax nothing —
add the components in later tasks; only fix path constants here.

- [ ] **Step 7: Commit**

```bash
git add hardware/p4_handheld/schematic hardware/p4_handheld/p4_handheld.* hardware/p4_handheld/bom
git commit -m "hw(p4_handheld): de-carded schematic pipeline, empty model green"
```

---

### Task 3: Panel research → `PANEL_RESEARCH.md`

**Files:**
- Create: `hardware/p4_handheld/PANEL_RESEARCH.md`

**Interfaces:**
- Produces: chosen **primary** and **fallback** panel with, for each: exact model, size, resolution, controller IC, DSI lane count, FFC pin count/pitch and full pinout (or a link plus transcription), backlight drive requirement (voltage/current, integrated driver or not), touch controller if any, price and shop link. Task 5 (power budget), Task 7 (display sheet), and Task 11 (BOM) consume these facts.

- [ ] **Step 1: Enumerate candidates (web research)**

Build the candidate table from at least these sources, plus anything newer found:

- Waveshare small DSI panels: 2.8" DSI (480×640), 3.4" round DSI, 4" DSI —
  search `site:waveshare.com DSI LCD` and the Waveshare wiki page per panel
  for pinout/controller
- Any panel Espressif lists as supported in `esp_lcd` MIPI-DSI examples
  (search ESP-IDF `examples/peripherals/lcd/mipi_dsi` and the
  `esp_lcd_ili9881c` / `esp_lcd_st7701` / `esp_lcd_jd9365` component registry
  entries)
- Raw-panel vendors only if a datasheet with full pinout is public

- [ ] **Step 2: Score each candidate against the five spec checks**

For every candidate record pass/fail with a citation (URL) per check:
(1) controller has an esp_lcd driver or documented DCS init;
(2) published pinout, ≤2 DSI lanes;
(3) backlight feasible (integrated driver preferred; else note boost LED
voltage/current the board must supply);
(4) touch variant policy satisfiable;
(5) buyable in 1–10 quantity from a normal channel.

- [ ] **Step 3: Check the 640×480-class preference**

Note in the doc which candidates give an integer multiple of 320×240
(640×480 preferred; 480×640 portrait requires rotation — record whether the
controller + esp_lcd path supports landscape addressing or the framebuffer
must rotate in software; that is a software-phase cost, not a blocker).

- [ ] **Step 4: Write the decision record**

`PANEL_RESEARCH.md` structure:

```markdown
# DSI panel research — five-check gate

Date: YYYY-MM-DD. Spec: docs/superpowers/specs/2026-07-12-p4-handheld-circuit-design.md

## Candidates

| Panel | Size | Res | Controller | Lanes | Backlight | Touch | Buyable | Checks passed |
|---|---|---|---|---|---|---|---|---|

## Five-check detail per candidate

### <panel name>
1. esp_lcd support: PASS/FAIL — <citation>
...

## Decision

Primary: <panel> — <one-paragraph why>
Fallback: <panel> — <one-paragraph why>

## Frozen interface facts (consumed by display sheet + power budget)

- FFC: <n> pin, <pitch> mm, pinout table below
- Panel rail: <voltage, current>
- Backlight: <supply, current, driver location>
- Touch: <controller, I2C address> or none
- Reset/enable lines: <list>

| Pin | Net |
|---|---|
```

The frozen-facts section must be fully filled for the primary panel —
this is the panel gate from the spec. If no candidate passes all five
checks, STOP and escalate to the owner with the table rather than
weakening a check.

- [ ] **Step 5: Commit**

```bash
git add hardware/p4_handheld/PANEL_RESEARCH.md
git commit -m "hw(p4_handheld): DSI panel research and five-check decision"
```

---

### Task 4: `BLOCK_DIAGRAM.md` and `PIN_BUDGET.md`

**Files:**
- Create: `hardware/p4_handheld/BLOCK_DIAGRAM.md`
- Create: `hardware/p4_handheld/PIN_BUDGET.md`

**Interfaces:**
- Consumes: spec section "Architecture"; `hardware/card/BLOCK_DIAGRAM.md` and `hardware/card/PIN_BUDGET.md` as templates; Task 3 frozen panel facts.
- Produces: the named GPIO assignments (net names like `BTN_UP`, `I2S_BCLK`, `SD_CMD`, …) that Tasks 5–9 wire into `connectivity.json`. Net names defined here are canonical.

- [ ] **Step 1: Write BLOCK_DIAGRAM.md**

Adapt `hardware/card/BLOCK_DIAGRAM.md`: keep the mermaid system-overview +
power-tree format. Blocks: USB-C → BQ24075-class charger (+CHG LED from VBUS)
→ SYS → TPS63070-class buck-boost (EN gated by SPDT slide) → 3V3 → {P4
cluster, logic, TPS22918-class panel load switch → panel rail}; MAX17048-class
fuel gauge on I2C; MAX98357A-class I2S amp → speaker; microSD on SDMMC;
buttons direct-GPIO; DSI FFC per Task 3 panel. Delete haptic/piezo/RGB blocks.
Power budget table: copy the card's rows, replace the panel row with Task 3
measured/datasheet numbers, and mark the whole table "re-verify at layout
phase with measured panel".

- [ ] **Step 2: Write PIN_BUDGET.md — transcribe, don't invent**

Sources (cite each in the doc):
- `hardware/card/PIN_BUDGET.md` — starting P4 pin map
- ESP32-P4 datasheet (linked in spec) — IO MUX table, strap pins, dedicated
  DSI/USB-HS pins, SDMMC-capable pins

Required sections:
1. **Dedicated pins:** MIPI-DSI lanes, USB 2.0 HS PHY, flash/PSRAM domain —
   from the datasheet, not assignable.
2. **Strap/boot pins:** list each strap pin and its required boot level;
   any strap pin reused for a button MUST be flagged and avoided.
3. **Assigned GPIO map:** one row per net — SDMMC (CLK/CMD/D0–D3), I2S
   (BCLK/LRCLK/DIN to amp), I2C (SDA/SCL: fuel gauge + touch), amp SD_MODE,
   panel reset, backlight enable/PWM, 11 button nets (`BTN_UP`, `BTN_DOWN`,
   `BTN_LEFT`, `BTN_RIGHT`, `BTN_NAV_CENTER`, `BTN_UNDO`, `BTN_ACTION`,
   `BTN_RESTART`, `BTN_MENU`, `BTN_VOL_UP`, `BTN_VOL_DOWN`), UART0 TX/RX,
   EN, BOOT.
4. **Spares:** every remaining usable GPIO listed as spare/test-point.

- [ ] **Step 3: Cross-check straps vs buttons**

Manually verify no button net landed on a strap pin; record the check as a
line in PIN_BUDGET.md ("strap audit: PASS, checked against datasheet table
<n>"). Task 8's connectivity test re-asserts this in code.

- [ ] **Step 4: Commit**

```bash
git add hardware/p4_handheld/BLOCK_DIAGRAM.md hardware/p4_handheld/PIN_BUDGET.md
git commit -m "hw(p4_handheld): block diagram and pin budget"
```

---

### Task 5: Connectivity — power sheet

**Files:**
- Modify: `hardware/p4_handheld/schematic/connectivity.json`
- Modify: `hardware/p4_handheld/schematic/connectivity_test.js`

**Interfaces:**
- Consumes: card power components/nets as copy source (`J1` USB-C, `J2` battery, `U2` BQ24075RGTR, `U3` MAX17048G+T10, `U4` TPS63070, `U6` TPS22919DCK, `SW9` slide, `D4`/`R8` charge LED, CC resistors `R1`/`R2`, bulk caps); Task 3 panel rail current (buck-boost headroom note).
- Produces: nets `VBUS_IN`, `BAT+`, `SYS`, `+3V3`, `+3V3_PANEL`, `I2C_SDA`/`I2C_SCL` (gauge side), `PWR_EN` for later sheets.

- [ ] **Step 1: Write the failing tests first**

Append to `connectivity_test.js`:

```js
test("power tree: charger, buck-boost, panel switch, gauge", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.VBUS_IN.some(function (n) { return n[0] === "J1"; }));
    assert.ok(byNet["BAT+"].some(function (n) { return n[0] === "J2"; }));
    assert.ok(byNet["BAT+"].some(function (n) { return n[0] === "U3"; }), "fuel gauge senses cell");
    assert.ok(byNet.SYS.some(function (n) { return n[0] === "U2"; }));
    assert.ok(byNet.SYS.some(function (n) { return n[0] === "U4"; }));
    assert.ok(byNet["+3V3"].some(function (n) { return n[0] === "U4"; }));
    assert.ok(byNet["+3V3_PANEL"].some(function (n) { return n[0] === "U6"; }));
});

test("slide switch gates buck-boost EN, not battery current", function () {
    var byNet = V.buildNetMap(V.model);
    var enNet = byNet.PWR_EN;
    assert.ok(enNet.some(function (n) { return n[0] === "SW9"; }));
    assert.ok(enNet.some(function (n) { return n[0] === "U4" && /EN/i.test(n[1]); }));
    assert.ok(!byNet["BAT+"].some(function (n) { return n[0] === "SW9"; }),
        "switch must not carry battery current");
});

test("charge LED works with power off (fed from VBUS via charger CHG)", function () {
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet.VBUS_IN.some(function (n) { return n[0] === "R8"; }));
});
```

- [ ] **Step 2: Run — expect FAIL** (`TypeError`/assert on missing nets)

`node hardware/p4_handheld/schematic/connectivity_test.js`

- [ ] **Step 3: Port the power block**

Copy the power-sheet component entries and connections from
`hardware/card/schematic/connectivity.json` (refs listed above, `"sheet": "power"`),
preserving values/footprints/gates verbatim, with these edits:

- net `+3V3_PANEL` endpoints on `J3` change later in Task 7 (leave the `U6`
  output side in place; do not add `J3` nodes yet)
- name the switch-to-EN net `PWR_EN`
- keep `GATE-BATTERY-SAMPLE` on `J2` (battery deferred by spec)

- [ ] **Step 4: Run tests — expect PASS**, then regenerate and commit

```bash
node hardware/p4_handheld/schematic/connectivity_test.js
node hardware/p4_handheld/schematic/generate_kicad.js
node hardware/p4_handheld/schematic/generate_kicad_test.js
git add hardware/p4_handheld
git commit -m "hw(p4_handheld): power sheet connectivity"
```

---

### Task 6: Connectivity — compute sheet

**Files:**
- Modify: `hardware/p4_handheld/schematic/connectivity.json`
- Modify: `hardware/p4_handheld/schematic/connectivity_test.js`

**Interfaces:**
- Consumes: card compute cluster (`U1` ESP32-P4NRW32X, `U9` QSPI-NOR-32MB, `X1` 40MHz crystal, `L1` 2.2uH, `R3`–`R6` straps/pulls) and its nets; PIN_BUDGET strap section.
- Produces: `U1` pin nodes that display/controls/audio/storage tasks attach to; nets `EN`, `BOOT`.

- [ ] **Step 1: Write the failing tests**

```js
test("compute cluster: P4 + flash + crystal + DCDC L on 3V3", function () {
    var comps = {};
    V.model.components.forEach(function (c) { comps[c.ref] = c; });
    assert.strictEqual(comps.U1.value, "ESP32-P4NRW32X");
    assert.strictEqual(comps.U1.sheet, "compute");
    assert.ok(comps.U9 && comps.X1 && comps.L1);
    var byNet = V.buildNetMap(V.model);
    assert.ok(byNet["+3V3"].some(function (n) { return n[0] === "U1"; }));
    assert.ok(byNet.EN.some(function (n) { return n[0] === "U1"; }));
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Port the compute cluster and diff against the card**

Copy all `"sheet": "compute"` components and their connections verbatim
(preserve `GATE-ESP32-P4-REF-CAPTURE` gates). Then run the check the spec's
connectivity gate requires:

```bash
node -e "
var a=require('./hardware/card/schematic/connectivity.json');
var b=require('./hardware/p4_handheld/schematic/connectivity.json');
function pick(m){return m.connections.filter(c=>c.nodes.some(n=>/^(U1|U9|X1|L1)$/.test(n[0])))
  .map(c=>c.net+':'+JSON.stringify(c.nodes.filter(n=>/^(U1|U9|X1|L1)$/.test(n[0])).sort())).sort();}
var da=pick(a),db=pick(b);
console.log(JSON.stringify(da)===JSON.stringify(db)?'compute cluster MATCHES card':'DIFF:\n'+da.filter(x=>db.indexOf(x)<0).concat(db.filter(x=>da.indexOf(x)<0)).join('\n'));
"
```

Expected: `compute cluster MATCHES card`. Any intentional deviation (there
should be none in this task) must be written into PIN_BUDGET.md.

- [ ] **Step 4: Run tests — PASS, regenerate, commit**

```bash
node hardware/p4_handheld/schematic/connectivity_test.js && node hardware/p4_handheld/schematic/generate_kicad.js && node hardware/p4_handheld/schematic/generate_kicad_test.js
git add hardware/p4_handheld && git commit -m "hw(p4_handheld): compute cluster ported, diffs clean vs card"
```

---

### Task 7: Connectivity — display sheet

**Files:**
- Modify: `hardware/p4_handheld/schematic/connectivity.json`
- Modify: `hardware/p4_handheld/schematic/connectivity_test.js`

**Interfaces:**
- Consumes: Task 3 frozen panel facts (FFC pin count/pitch, full pinout, backlight, touch, reset); `U6` panel switch output net `+3V3_PANEL` (rename if the panel rail differs); `U1` DSI pins from PIN_BUDGET.
- Produces: `J3` FFC connector wired end-to-end; `panelInterface` evidence block; touch I2C on `I2C_SDA`/`I2C_SCL` if present.

- [ ] **Step 1: Write the failing tests — mirror the card's evidence pattern**

Follow `hardware/card/schematic/connectivity_test.js` tests
"DSI panel interface locks … pinout" and "records … layout assumption", but
assert the **Task 3 primary panel's** name, connector, and full
pin→net table, and keep an orientation gate:

```js
test("DSI panel interface locks the chosen panel pinout", function () {
    var iface = V.model.panelInterface;
    assert.ok(iface, "connectivity must carry panel evidence");
    assert.strictEqual(iface.panel, "<primary panel name from PANEL_RESEARCH.md>");
    assert.deepStrictEqual(iface.pinout.map(function (p) { return [p.pin, p.net]; }),
        [/* full table transcribed from PANEL_RESEARCH.md frozen facts */]);
    assert.strictEqual(iface.orientation.gate, "GATE-PANEL-FFC-CONTACT");
});

test("DSI lanes are differential pairs at U1 and J3", function () {
    var byNet = V.buildNetMap(V.model);
    ["DSI_D0_P","DSI_D0_N","DSI_CLK_P","DSI_CLK_N"].forEach(function (net) {
        assert.ok(byNet[net] && byNet[net].some(function (n) { return n[0] === "U1"; }));
        assert.ok(byNet[net].some(function (n) { return n[0] === "J3"; }));
    });
});
```

(Include `DSI_D1_*` in the list only if the chosen panel uses 2 lanes.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Wire the display block**

Add to connectivity.json: `J3` (FFC, footprint TBD + `GATE-PANEL-FFC-CONTACT`),
panel-rail nodes onto `+3V3_PANEL` (or the renamed rail), panel reset and
backlight-enable nets to the PIN_BUDGET GPIOs, touch controller I2C nodes if
the panel has touch (wired, disabled-in-firmware policy noted), local bulk
cap `C3` on the panel rail, and a `panelInterface` evidence object with
pinout + orientation `known` / `mustCheckBeforeRouting` / `gate` fields —
same shape as the card's `dsiPanelInterface`.

If the panel needs a backlight boost stage (Task 3 fallback outcome), add the
boost part here with a `GATE-BACKLIGHT-BOOST-REVIEW` gate and a note in
BLOCK_DIAGRAM's power tree.

- [ ] **Step 4: Run tests — PASS, regenerate, commit**

```bash
node hardware/p4_handheld/schematic/connectivity_test.js && node hardware/p4_handheld/schematic/generate_kicad.js && node hardware/p4_handheld/schematic/generate_kicad_test.js
git add hardware/p4_handheld && git commit -m "hw(p4_handheld): display sheet wired to chosen panel"
```

---

### Task 8: Connectivity — controls sheet

**Files:**
- Modify: `hardware/p4_handheld/schematic/connectivity.json`
- Modify: `hardware/p4_handheld/schematic/connectivity_test.js`

**Interfaces:**
- Consumes: the 11 button nets and GPIO numbers from PIN_BUDGET.md; strap-pin list from PIN_BUDGET.md.
- Produces: switches `SW1`–`SW8`, `SW10A`/`SW10B` (volume), nav-center contact; all footprints TBD behind `GATE-BUTTON-COUPON`.

- [ ] **Step 1: Write the failing tests**

```js
var BTN_NETS = ["BTN_UP","BTN_DOWN","BTN_LEFT","BTN_RIGHT","BTN_NAV_CENTER",
    "BTN_UNDO","BTN_ACTION","BTN_RESTART","BTN_MENU","BTN_VOL_UP","BTN_VOL_DOWN"];

test("all 11 buttons reach U1 directly, active-low, no expander", function () {
    var byNet = V.buildNetMap(V.model);
    BTN_NETS.forEach(function (net) {
        assert.ok(byNet[net], net + " missing");
        assert.ok(byNet[net].some(function (n) { return n[0] === "U1"; }), net + " not on U1");
    });
    assert.ok(!V.model.components.some(function (c) { return /MCP23017/.test(c.value); }));
});

test("no button lands on a P4 strap pin", function () {
    var straps = V.model.strapPins;
    assert.ok(Array.isArray(straps) && straps.length > 0,
        "connectivity must carry strapPins transcribed from PIN_BUDGET.md");
    var byNet = V.buildNetMap(V.model);
    BTN_NETS.forEach(function (net) {
        byNet[net].forEach(function (n) {
            if (n[0] === "U1") {
                assert.strictEqual(straps.indexOf(n[1]), -1, net + " uses strap pin " + n[1]);
            }
        });
    });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Wire the controls**

Add a `strapPins` array to connectivity.json (transcribed from PIN_BUDGET.md's
datasheet-sourced strap section). Add switches: `SW1`–`SW4` navigation
directions + nav-center contact, `SW5`–`SW8` (Undo/Action/Restart/Menu),
`SW10A`/`SW10B` volume — one side to its `BTN_*` net on the assigned `U1`
GPIO, other side to `GND`; internal pull-ups assumed (note in PIN_BUDGET;
external pull-up array only if the datasheet forbids internal pulls on a
chosen pin). All switch footprints `"TBD"` with `"gate": "GATE-BUTTON-COUPON"`.

- [ ] **Step 4: Run tests — PASS, regenerate, commit**

```bash
node hardware/p4_handheld/schematic/connectivity_test.js && node hardware/p4_handheld/schematic/generate_kicad.js && node hardware/p4_handheld/schematic/generate_kicad_test.js
git add hardware/p4_handheld && git commit -m "hw(p4_handheld): controls sheet, 11 direct-GPIO buttons"
```

---

### Task 9: Connectivity — audio, storage, debug sheets

**Files:**
- Modify: `hardware/p4_handheld/schematic/connectivity.json`
- Modify: `hardware/p4_handheld/schematic/connectivity_test.js`

**Interfaces:**
- Consumes: PIN_BUDGET I2S/SDMMC/UART assignments.
- Produces: `U7` MAX98357A + `J5` speaker connector; `J4` microSD on SDMMC nets; `TP1`–`TP4`+ test pads.

- [ ] **Step 1: Write the failing tests**

```js
test("audio: I2S amp with shutdown control and speaker connector", function () {
    var byNet = V.buildNetMap(V.model);
    ["I2S_BCLK","I2S_LRCLK","I2S_DIN"].forEach(function (net) {
        assert.ok(byNet[net].some(function (n) { return n[0] === "U1"; }));
        assert.ok(byNet[net].some(function (n) { return n[0] === "U7"; }));
    });
    assert.ok(byNet.AMP_SD_MODE.some(function (n) { return n[0] === "U1"; }), "true-mute control");
    assert.ok(byNet["SPK+"].some(function (n) { return n[0] === "J5"; }));
});

test("storage: microSD on SDMMC nets", function () {
    var byNet = V.buildNetMap(V.model);
    ["SD_CLK","SD_CMD","SD_D0","SD_D1","SD_D2","SD_D3"].forEach(function (net) {
        assert.ok(byNet[net].some(function (n) { return n[0] === "J4"; }), net);
        assert.ok(byNet[net].some(function (n) { return n[0] === "U1"; }), net);
    });
});

test("debug: UART, EN, BOOT test pads present", function () {
    var tps = V.model.components.filter(function (c) { return c.sheet === "debug"; });
    assert.ok(tps.length >= 4);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Wire the three sheets**

- Audio: `U7` value `MAX98357AETE` (or the JLC-stocked MAX98357A variant found
  in Task 11 — value may be updated there), gain-set pin per datasheet default,
  `AMP_SD_MODE` to a PIN_BUDGET GPIO, output `SPK+`/`SPK-` to `J5`
  (2-pin connector, footprint TBD, `"gate": "GATE-SPEAKER-SELECT"`, hand-attached).
- Storage: `J4` microSD push-push (footprint TBD, `GATE-MICROSD-FOOTPRINT`,
  copied gate name from card), six SDMMC nets to the PIN_BUDGET pins, card-detect
  if the socket provides it.
- Debug: `TP1`–`TP4` (UART_TX/UART_RX/BOOT/EN) copied from the card debug sheet,
  plus one test pad per spare GPIO listed in PIN_BUDGET.

- [ ] **Step 4: Run tests — PASS, regenerate, commit**

```bash
node hardware/p4_handheld/schematic/connectivity_test.js && node hardware/p4_handheld/schematic/generate_kicad.js && node hardware/p4_handheld/schematic/generate_kicad_test.js
git add hardware/p4_handheld && git commit -m "hw(p4_handheld): audio, storage, debug sheets"
```

---

### Task 10: KiCad project opens and ERC is clean

**Files:**
- Modify: generated `hardware/p4_handheld/p4_handheld.kicad_sch` + `schematic/sheets/*` (via generator only)

**Interfaces:**
- Consumes: complete connectivity model from Tasks 5–9.
- Produces: ERC-clean generated project — the spec's review-gate precondition.

- [ ] **Step 1: Regenerate everything from a clean state**

```bash
node hardware/p4_handheld/schematic/generate_kicad.js
git status --short hardware/p4_handheld
```

Expected: only generated files changed or nothing dirty.

- [ ] **Step 2: Run ERC**

```bash
kicad-cli sch erc hardware/p4_handheld/p4_handheld.kicad_sch --exit-code-violations
```

Expected: exit 0. If `kicad-cli` is not installed, install KiCad 8
(`brew install --cask kicad`) — the card README already assumes KiCad 8 is
the human-facing tool, so this is not a new dependency.

- [ ] **Step 3: Fix violations at the source**

Every ERC violation is fixed in `connectivity.json` or the generator
(e.g., missing power flags, unconnected pins needing explicit no-connects) —
never by hand-editing generated files. Re-run Step 1 + 2 until clean, keeping
`connectivity_test.js` green.

- [ ] **Step 4: Commit**

```bash
git add hardware/p4_handheld
git commit -m "hw(p4_handheld): generated schematic ERC clean"
```

---

### Task 11: BOM with JLC availability record

**Files:**
- Modify: `hardware/p4_handheld/schematic/jlc_catalog.json`
- Create: `hardware/p4_handheld/bom/AVAILABILITY.md`
- Modify (generated): `hardware/p4_handheld/bom/bom_jlc.csv`

**Interfaces:**
- Consumes: complete component list; `refresh_jlc_packages.js` + `jlc_parts.js` tooling.
- Produces: the spec's BOM gate — every PnP line has an in-stock JLC part number or documented alternative; hand-attached lines flagged.

- [ ] **Step 1: Extend jlc_catalog.json**

For each component value not already in the copied catalog (at minimum:
MAX98357A variant, FFC connector family, microSD socket, speaker connector,
any backlight boost part), look up the JLC part number on jlcpcb.com/parts
and add an entry following the existing catalog entry shape.

- [ ] **Step 2: Regenerate and check the BOM**

```bash
node hardware/p4_handheld/schematic/jlc_parts_test.js
node hardware/p4_handheld/schematic/generate_kicad.js
column -s, -t < hardware/p4_handheld/bom/bom_jlc.csv | head -40
```

Expected: every row either carries a JLC part number or is explicitly one of
the hand-attached lines (panel, battery, speaker) / gated parts (buttons).

- [ ] **Step 3: Write AVAILABILITY.md**

One row per BOM line: value, JLC part number, stock count seen, date checked,
basic/extended, or "hand-attached" / "gated: <gate name>" / "consignment plan:
<source>". Include the ESP32-P4NRW32X line explicitly: record whether JLC
stocks it and, if not, the consignment/hand-source plan (this is the one part
most likely to need consignment — the spec allows it if documented).

- [ ] **Step 4: Commit**

```bash
git add hardware/p4_handheld/schematic/jlc_catalog.json hardware/p4_handheld/bom
git commit -m "hw(p4_handheld): JLC-checked BOM and availability record"
```

---

### Task 12: Phase gate review

**Files:**
- Create: `hardware/p4_handheld/PHASE_REVIEW.md`

**Interfaces:**
- Consumes: everything above; the four validation gates in the spec.

- [ ] **Step 1: Run the full check suite one more time**

```bash
node hardware/p4_handheld/schematic/connectivity_test.js
node hardware/p4_handheld/schematic/jlc_parts_test.js
node hardware/p4_handheld/schematic/generate_kicad.js
node hardware/p4_handheld/schematic/generate_kicad_test.js
kicad-cli sch erc hardware/p4_handheld/p4_handheld.kicad_sch --exit-code-violations
```

Expected: all exit 0.

- [ ] **Step 2: Write PHASE_REVIEW.md against the spec's four gates**

```markdown
# Circuit-phase gate review

Spec: docs/superpowers/specs/2026-07-12-p4-handheld-circuit-design.md

1. Panel gate: PASS/FAIL — primary <x>, fallback <y>, PANEL_RESEARCH.md §Decision
2. Connectivity gate: PASS/FAIL — pin budget rows all netted; strap test in
   connectivity_test.js; compute diff vs card: MATCHES (Task 6 command output)
3. BOM gate: PASS/FAIL — bom/AVAILABILITY.md, N PnP lines with JLC numbers,
   M hand-attached, K gated
4. Review gate: PASS/FAIL — ERC exit 0 on <date>; power-tree budget
   self-review below

## Power-tree current budget self-review
<walk the tree with the panel's real numbers: VBUS in, charger limit,
buck-boost max, panel rail draw, P4 burst, margin conclusion>
```

Any FAIL: stop, fix in the owning task's files, re-run. Do not hand-wave a
gate as "mostly done".

- [ ] **Step 3: Commit**

```bash
git add hardware/p4_handheld/PHASE_REVIEW.md
git commit -m "hw(p4_handheld): circuit-phase gate review"
```
