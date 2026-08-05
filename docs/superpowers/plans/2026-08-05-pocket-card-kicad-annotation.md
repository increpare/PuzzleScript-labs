# Pocket Card KiCad Annotation and Footprint Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Pocket Card controller schematic fully annotated and make all assigned standard footprints resolve through a portable project-local KiCad 10 library table.

**Architecture:** Migrate the fourteen descriptive but nonnumeric component references to stable digit-suffixed references while retaining all component UUIDs and PCB schematic paths. Keep the canonical connectivity model authoritative, make both JavaScript and Python adapters reject nonnumeric ordinary references, generate a four-entry project-local `fp-lib-table`, and patch rather than rebuild the routed PCB.

**Tech Stack:** KiCad 10 S-expression files, Node.js/CommonJS, Python 3 `unittest`, Make, `kicad-cli`.

---

## File structure

- `hardware/pocket_card/schematic/connectivity.json`: canonical references, UUIDs, pins, and nets.
- `hardware/pocket_card/schematic/validate_connectivity.js`: JavaScript model validation and PCB parity parsing.
- `hardware/pocket_card/schematic/connectivity_test.js`: canonical identity and validation regressions.
- `hardware/pocket_card/schematic/generate_kicad.js`: deterministic schematic and project-local footprint-table generation.
- `hardware/pocket_card/schematic/generate_kicad_test.js`: schematic, annotation, footprint-table, ERC, netlist, and PDF verification.
- `hardware/pocket_card/case/pcb_connectivity.py`: validated Python adapter for the canonical model.
- `hardware/pocket_card/case/pcb.py`: headless and `pcbnew` board generators.
- `hardware/pocket_card/case/test_pcb_connectivity.py`: Python adapter and board-generator regressions.
- `hardware/pocket_card/case/export_smt.py`: manufacturing reference-to-part mapping.
- `hardware/pocket_card/case/silk_layout.py` and `gen_silk_preview.py`: connector reference labels.
- `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch`: generated annotated schematic.
- `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb`: routed board, changed only in reference properties.
- `hardware/pocket_card/case/out/pcb/fp-lib-table`: generated project-local footprint libraries.
- `hardware/pocket_card/case/out/pcb/{BOM.csv,CPL.csv,pocket_card_controller-all-pos.csv}`: regenerated manufacturing outputs with migrated references.
- `hardware/pocket_card/schematic/README.md` and `hardware/pocket_card/case/README.md`: updated workflow instructions.

The complete reference migration used by every task is:

```text
SW_UP      -> SW_UP1       SW_DOWN    -> SW_DOWN1
SW_LEFT    -> SW_LEFT1     SW_RIGHT   -> SW_RIGHT1
SW_UNDO    -> SW_UNDO1     SW_ACTION  -> SW_ACTION1
SW_RESET   -> SW_RESET1    SW_MENU    -> SW_MENU1
SW_PWR     -> SW_PWR1      SW_MUTE    -> SW_MUTE1
J_I2C      -> J_I2C1       J_EXP      -> J_EXP1
J_BAT_IN   -> J_BAT_IN1    J_BAT_OUT  -> J_BAT_OUT1
```

`U1`, `H1`, and `H2` remain unchanged.

### Task 1: Enforce KiCad-annotated component references

**Files:**
- Modify: `hardware/pocket_card/schematic/connectivity_test.js`
- Modify: `hardware/pocket_card/schematic/validate_connectivity.js`

- [ ] **Step 1: Add a failing JavaScript validation regression**

Add this test next to the existing duplicate-reference tests:

```javascript
test("ordinary component references must end in a digit", function () {
    var candidate = clone(V.model);
    candidate.components[0].ref = "SW_UP";
    assertRejected(candidate, /component reference SW_UP is not fully annotated/);
});
```

- [ ] **Step 2: Run the focused test and verify the missing diagnostic**

Run:

```bash
node hardware/pocket_card/schematic/connectivity_test.js
```

Expected: failure in `ordinary component references must end in a digit` because the validator does not report `not fully annotated`.

- [ ] **Step 3: Add the minimal validator rule**

Inside the component loop in `validateConnectivity`, after checking that `component.ref` is a string, add:

```javascript
if (typeof component.ref === "string" && !/[0-9]$/.test(component.ref)) {
    errors.push("component reference " + component.ref +
        " is not fully annotated; ordinary references must end in a digit");
}
```

- [ ] **Step 4: Run the test and confirm the regression passes while the canonical model now fails for the fourteen old references**

Run:

```bash
node hardware/pocket_card/schematic/connectivity_test.js
```

Expected: the new regression passes, and `canonical connectivity validates without errors` fails with fourteen `not fully annotated` diagnostics. This is the red state carried into Task 2.

- [ ] **Step 5: Preserve the red state only in the worktree**

Do not commit while the canonical model fails validation. Proceed directly to
Task 2; its final green commit includes this regression and validator rule.

### Task 2: Migrate the canonical model and generated schematic

**Files:**
- Modify: `hardware/pocket_card/schematic/connectivity.json`
- Modify: `hardware/pocket_card/schematic/validate_connectivity.js`
- Modify: `hardware/pocket_card/schematic/connectivity_test.js`
- Modify: `hardware/pocket_card/schematic/generate_kicad.js`
- Modify: `hardware/pocket_card/schematic/generate_kicad_test.js`
- Modify: `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch`

- [ ] **Step 1: Add an exact canonical-reference assertion**

Add this test after canonical model validation:

```javascript
test("all 17 canonical references are fully annotated and stable", function () {
    assert.deepStrictEqual(V.model.components.map(function (component) {
        return component.ref;
    }), [
        "U1",
        "SW_UP1", "SW_DOWN1", "SW_LEFT1", "SW_RIGHT1",
        "SW_UNDO1", "SW_ACTION1", "SW_RESET1", "SW_MENU1",
        "SW_PWR1", "SW_MUTE1",
        "J_I2C1", "J_EXP1", "J_BAT_IN1", "J_BAT_OUT1",
        "H1", "H2"
    ]);
});
```

- [ ] **Step 2: Run the JavaScript connectivity tests and verify the reference assertion fails**

Run:

```bash
node hardware/pocket_card/schematic/connectivity_test.js
```

Expected: failure showing `SW_UP` where `SW_UP1` was expected, plus canonical annotation diagnostics.

- [ ] **Step 3: Apply the reference map to the canonical model and JavaScript contracts**

Change the fourteen exact component keys in `connectivity.json`, including every connection node, `noConnects` key, and board-only rule. Apply the same names to `REQUIRED_REFS`, `CANONICAL_COMPONENTS`, `FIXED_PIN_NETS`, `FIXED_NO_CONNECTS`, and `CANONICAL_BOARD_ONLY_PAD_RULE` in `validate_connectivity.js`, and to all exact reference expectations and fixtures in `connectivity_test.js`.

Do not change any component `uuid`, value, footprint, symbol, pin number, or net name. For example:

```json
{
  "ref": "SW_UP1",
  "value": "SKQGABE010",
  "footprint": "Button_Switch_SMD:SW_SPST_SKQG_WithStem",
  "uuid": "0e4c7620-48d6-4920-a112-21a3249bfba7",
  "symbol": "TACT"
}
```

and:

```json
{ "net": "SIG_UP", "nodes": [["U1", "1"], ["SW_UP1", "1"]] }
```

- [ ] **Step 4: Update schematic placement and generator expectations**

Rename the fourteen keys in `POSITIONS` and every explicit reference fixture in `generate_kicad_test.js`. Keep all positions and component UUIDs unchanged:

```javascript
var POSITIONS = {
    J_I2C1: [35, 35],
    J_EXP1: [35, 75],
    U1: [105, 70],
    SW_UP1: [185, 30],
    SW_DOWN1: [185, 50],
    SW_LEFT1: [185, 70],
    SW_RIGHT1: [185, 90],
    SW_UNDO1: [235, 30],
    SW_ACTION1: [235, 50],
    SW_RESET1: [235, 70],
    SW_MENU1: [235, 90],
    SW_MUTE1: [235, 115],
    J_BAT_IN1: [35, 130],
    SW_PWR1: [105, 130],
    J_BAT_OUT1: [185, 130],
    H1: [255, 130],
    H2: [270, 130],
    "#FLG01": [60, 27.5],
    "#FLG02": [90, 27.5]
};
```

- [ ] **Step 5: Regenerate the schematic**

Run:

```bash
node hardware/pocket_card/schematic/generate_kicad.js
```

Expected: `pocket_card_controller.kicad_sch` is rewritten with the fourteen digit-suffixed references while retaining the same seventeen placed-symbol UUIDs.

- [ ] **Step 6: Run JavaScript connectivity and schematic tests**

Run:

```bash
node hardware/pocket_card/schematic/connectivity_test.js
node hardware/pocket_card/schematic/generate_kicad_test.js
```

Expected: all connectivity tests pass; KiCad reports zero ERC errors; exported netlist endpoints use the migrated references.

- [ ] **Step 7: Commit the canonical and schematic migration**

```bash
git add hardware/pocket_card/schematic/connectivity.json hardware/pocket_card/schematic/validate_connectivity.js hardware/pocket_card/schematic/connectivity_test.js hardware/pocket_card/schematic/generate_kicad.js hardware/pocket_card/schematic/generate_kicad_test.js hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_sch
git commit -m "fix: fully annotate Pocket Card schematic"
```

### Task 3: Migrate Python PCB consumers and the routed board

**Files:**
- Modify: `hardware/pocket_card/case/pcb_connectivity.py`
- Modify: `hardware/pocket_card/case/test_pcb_connectivity.py`
- Modify: `hardware/pocket_card/case/pcb.py`
- Modify: `hardware/pocket_card/case/export_smt.py`
- Modify: `hardware/pocket_card/case/silk_layout.py`
- Modify: `hardware/pocket_card/case/gen_silk_preview.py`
- Modify: `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb`
- Modify: `hardware/pocket_card/case/out/pcb/BOM.csv`
- Modify: `hardware/pocket_card/case/out/pcb/CPL.csv`
- Modify: `hardware/pocket_card/case/out/pcb/pocket_card_controller-all-pos.csv`
- Modify: `hardware/pocket_card/case/out/silk_back.svg`
- Modify: `hardware/pocket_card/case/out/silk_preview.html`

- [ ] **Step 1: Add failing Python annotation and exact-reference tests**

Add to `ConnectivityAdapterTests`:

```python
def test_all_component_references_are_fully_annotated(self):
    refs = [item["ref"] for item in C.model()["components"]]
    self.assertEqual(refs, [
        "U1", "SW_UP1", "SW_DOWN1", "SW_LEFT1", "SW_RIGHT1",
        "SW_UNDO1", "SW_ACTION1", "SW_RESET1", "SW_MENU1",
        "SW_PWR1", "SW_MUTE1", "J_I2C1", "J_EXP1",
        "J_BAT_IN1", "J_BAT_OUT1", "H1", "H2",
    ])

def test_loader_rejects_unannotated_component_reference(self):
    candidate = C.model()
    candidate["components"][0]["ref"] = "SW_UP"
    self.assert_model_invalid(candidate, r"SW_UP.*not fully annotated")
```

- [ ] **Step 2: Run Python tests and verify old consumer keys and the missing loader diagnostic fail**

Run:

```bash
cd hardware/pocket_card/case
python3 -m unittest test_pcb_connectivity.py
```

Expected: failures from fixtures still using old references and from `_load_model` accepting `SW_UP`.

- [ ] **Step 3: Enforce annotated references in the Python adapter**

Import `re`, then add this check after the component-field loop has validated `item["ref"]`:

```python
if not re.search(r"[0-9]$", item["ref"]):
    _invalid(path, base + ".ref",
             "uses %s, which is not fully annotated; references must end in a digit"
             % item["ref"])
```

- [ ] **Step 4: Apply the reference map to every PCB-facing consumer**

Update exact reference keys in the Python tests, `pcb.py` placement lists, `export_smt.py` `PARTS`, and connector labels in both silk generators. Leave net names such as `SIG_UP`, geometry constants, and human control names unchanged.

Examples:

```python
expected_switches = {
    "SW_UP1": "SIG_UP", "SW_DOWN1": "SIG_DOWN",
    "SW_LEFT1": "SIG_LEFT", "SW_RIGHT1": "SIG_RIGHT",
    "SW_UNDO1": "SIG_UNDO", "SW_ACTION1": "SIG_ACTION",
    "SW_RESET1": "SIG_RESET", "SW_MENU1": "SIG_MENU",
}
```

```python
CONNECTORS = [
    ("J_I2C1", 4, *P.CONN_I2C, "3V3/GND/SCL/SDA -- to module I2C"),
    ("J_EXP1", 4, *P.CONN_EXP, "IO2 interrupt -- to module expansion"),
    ("J_BAT_IN1", 2, *P.CONN_BAT_IN, "from cell"),
    ("J_BAT_OUT1", 2, *P.CONN_BAT_OUT, "to module BAT"),
]
```

- [ ] **Step 5: Patch only the fourteen routed-board reference properties**

In `pocket_card_controller.kicad_pcb`, change only these property values:

```text
(property "Reference" "SW_UP")      -> (property "Reference" "SW_UP1")
(property "Reference" "SW_DOWN")    -> (property "Reference" "SW_DOWN1")
(property "Reference" "SW_LEFT")    -> (property "Reference" "SW_LEFT1")
(property "Reference" "SW_RIGHT")   -> (property "Reference" "SW_RIGHT1")
(property "Reference" "SW_UNDO")    -> (property "Reference" "SW_UNDO1")
(property "Reference" "SW_ACTION")  -> (property "Reference" "SW_ACTION1")
(property "Reference" "SW_RESET")   -> (property "Reference" "SW_RESET1")
(property "Reference" "SW_MENU")    -> (property "Reference" "SW_MENU1")
(property "Reference" "SW_PWR")     -> (property "Reference" "SW_PWR1")
(property "Reference" "SW_MUTE")    -> (property "Reference" "SW_MUTE1")
(property "Reference" "J_I2C")      -> (property "Reference" "J_I2C1")
(property "Reference" "J_EXP")      -> (property "Reference" "J_EXP1")
(property "Reference" "J_BAT_IN")   -> (property "Reference" "J_BAT_IN1")
(property "Reference" "J_BAT_OUT") -> (property "Reference" "J_BAT_OUT1")
```

Do not alter any top-level footprint UUID, schematic `path` expression, pad, position, track, via, zone, graphic, or setup expression. Verify the board diff has fourteen deletions and fourteen additions, all on `property "Reference"` lines.

- [ ] **Step 6: Regenerate reference-bearing manufacturing and silk artifacts**

Run:

```bash
cd hardware/pocket_card/case
python3 export_smt.py
python3 silk_layout.py
python3 gen_silk_preview.py
```

Expected: BOM, CPL, position CSV, back-silk SVG, and preview HTML use the digit-suffixed connector and switch references.

- [ ] **Step 7: Run Python and board-parity tests**

Run:

```bash
cd hardware/pocket_card/case
python3 -m unittest test_pcb_connectivity.py
cd ../../../..
node hardware/pocket_card/schematic/board_parity_test.js
```

Expected: all Python tests pass and board parity reports `17 linked footprints`.

- [ ] **Step 8: Commit the PCB-side migration**

```bash
git add hardware/pocket_card/case/pcb_connectivity.py hardware/pocket_card/case/test_pcb_connectivity.py hardware/pocket_card/case/pcb.py hardware/pocket_card/case/export_smt.py hardware/pocket_card/case/silk_layout.py hardware/pocket_card/case/gen_silk_preview.py hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb hardware/pocket_card/case/out/pcb/BOM.csv hardware/pocket_card/case/out/pcb/CPL.csv hardware/pocket_card/case/out/pcb/pocket_card_controller-all-pos.csv hardware/pocket_card/case/out/silk_back.svg hardware/pocket_card/case/out/silk_preview.html
git commit -m "fix: migrate Pocket Card PCB references"
```

### Task 4: Generate the project-local footprint library table

**Files:**
- Modify: `hardware/pocket_card/schematic/generate_kicad.js`
- Modify: `hardware/pocket_card/schematic/generate_kicad_test.js`
- Create: `hardware/pocket_card/case/out/pcb/fp-lib-table`

- [ ] **Step 1: Add failing pure-generation and CLI artifact tests**

Define the required libraries in the test:

```javascript
var expectedFootprintLibraries = [
    "Button_Switch_SMD",
    "Connector_JST",
    "MountingHole",
    "Package_SO"
];
```

Assert that `generator.generateFootprintLibraryTable(model)` returns one `fp_lib_table` root with exactly those sorted names and these URIs:

```javascript
expectedFootprintLibraries.forEach(function (library) {
    assert.ok(footprintTable.indexOf('(name "' + library + '")') !== -1);
    assert.ok(footprintTable.indexOf(
        '(uri "${KICAD10_FOOTPRINT_DIR}/' + library + '.pretty")'
    ) !== -1);
});
```

In the temporary CLI-generation block, also assert that `fp-lib-table` exists beside the requested schematic and is byte-identical on the second run.

- [ ] **Step 2: Run the generator test and verify the new API is missing**

Run:

```bash
node hardware/pocket_card/schematic/generate_kicad_test.js
```

Expected: failure because `generateFootprintLibraryTable` is not defined or exported.

- [ ] **Step 3: Implement deterministic table generation**

Add these pure helpers to `generate_kicad.js`:

```javascript
function footprintLibraryNames(model) {
    return Array.from(new Set(model.components.map(function (component) {
        return component.footprint.split(":", 1)[0];
    }))).sort();
}

function generateFootprintLibraryTable(model) {
    var errors = connectivity.validateConnectivity(model);
    if (errors.length > 0) {
        throw new Error("invalid connectivity model:\n- " + errors.join("\n- "));
    }
    var lines = ["(fp_lib_table", "  (version 7)"];
    footprintLibraryNames(model).forEach(function (library) {
        lines.push('  (lib (name "' + library + '") (type "KiCad") ' +
            '(uri "${KICAD10_FOOTPRINT_DIR}/' + library + '.pretty") ' +
            '(options "") (descr "Pocket Card required KiCad standard library"))');
    });
    lines.push(")");
    return lines.join("\n") + "\n";
}
```

Replace the CLI writer with a project writer that writes both files beside each other:

```javascript
function writeProjectFiles(outputPath) {
    var destination = outputPath || OUTPUT_PATH;
    var directory = path.dirname(destination);
    var tableDestination = path.join(directory, "fp-lib-table");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(destination, generateSchematic(connectivity.model), "utf8");
    fs.writeFileSync(tableDestination,
        generateFootprintLibraryTable(connectivity.model), "utf8");
    return { schematic: destination, footprintLibraryTable: tableDestination };
}
```

Call `writeProjectFiles(process.argv[2])` from the CLI and export both `generateFootprintLibraryTable` and `writeProjectFiles`.

- [ ] **Step 4: Verify installed footprint files for every assigned footprint**

In the test, locate the installed root from the first existing candidate among `process.env.KICAD10_FOOTPRINT_DIR`, `/usr/share/kicad/footprints`, `/usr/local/share/kicad/footprints`, and the macOS path derived from the real `kicad-cli` executable. Then require every assignment to exist:

```javascript
model.components.forEach(function (component) {
    var parts = component.footprint.split(":");
    var modulePath = path.join(
        installedFootprintRoot,
        parts[0] + ".pretty",
        parts[1] + ".kicad_mod"
    );
    assert.ok(fs.existsSync(modulePath),
        component.ref + " assigned footprint must exist: " + modulePath);
});
```

- [ ] **Step 5: Generate and verify the tracked table**

Run:

```bash
node hardware/pocket_card/schematic/generate_kicad.js
node hardware/pocket_card/schematic/generate_kicad_test.js
```

Expected: the new `fp-lib-table` is created with four entries; the generator test passes; KiCad ERC remains at zero errors.

- [ ] **Step 6: Commit the self-contained library configuration**

```bash
git add hardware/pocket_card/schematic/generate_kicad.js hardware/pocket_card/schematic/generate_kicad_test.js hardware/pocket_card/case/out/pcb/fp-lib-table
git commit -m "fix: add Pocket Card footprint libraries"
```

### Task 5: Update workflow documentation and run full verification

**Files:**
- Modify: `hardware/pocket_card/schematic/README.md`
- Modify: `hardware/pocket_card/case/README.md`
- Modify: `docs/superpowers/specs/2026-08-05-pocket-card-controller-schematic-design.md`
- Modify: `hardware/pocket_card/case/params.py` comments naming `SW_LEFT`, `J_BAT_OUT`, and `J_BAT_IN`
- Modify: `hardware/pocket_card/case/shell_back.py` comments naming `J_BAT_IN` and `J_BAT_OUT`

- [ ] **Step 1: Document the fully annotated workflow**

State explicitly:

```text
The generated references are already fully annotated (`SW_UP1`, `SW_PWR1`,
`J_I2C1`, and `J_BAT_OUT1`); do not run Annotate Schematic. The generator also writes the
project-local `fp-lib-table` containing the four required KiCad 10 standard
libraries.
```

Update reference examples in both READMEs and the earlier controller schematic design so they describe the migrated canonical names. Correct comments that call a physical connector or switch by its old reference. Preserve control names and signal names that are not reference designators.

- [ ] **Step 2: Add the safe Update PCB from Schematic settings**

Document that after reopening the project, **Update PCB from Schematic** is run with reference-based relinking, footprint replacement, and deletion of unmatched footprints disabled. Explain that the top-level PCB `path` remains the authoritative schematic association.

- [ ] **Step 3: Verify no active source or primary artifact retains an old reference**

Run a scoped search across the canonical model, validators, generators, Python consumers, generated schematic, routed board, BOM, CPL, and position CSV. Exclude the new migration design and implementation plan because their mapping tables intentionally record the old names.

Expected: no whole-word occurrence of any old reference remains in the scoped active files.

- [ ] **Step 4: Run the complete Pocket Card KiCad pipeline**

Run:

```bash
make pocket_card_kicad
```

Expected: connectivity validation passes for 17 components and 16 nets; all JavaScript tests pass; KiCad ERC reports zero errors; board parity reports 17 linked footprints; all Python tests pass.

- [ ] **Step 5: Verify KiCad resave stability on a temporary board copy**

First require that the task-owned temporary path is absent, create it, and copy the branch board:

```bash
test ! -e /private/tmp/pocket-card-annotation-resave
mkdir /private/tmp/pocket-card-annotation-resave
cp hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb /private/tmp/pocket-card-annotation-resave/pocket_card_controller.kicad_pcb
kicad-cli pcb upgrade --force /private/tmp/pocket-card-annotation-resave/pocket_card_controller.kicad_pcb
env POCKET_CARD_BOARD=/private/tmp/pocket-card-annotation-resave/pocket_card_controller.kicad_pcb node hardware/pocket_card/schematic/board_parity_test.js
```

Expected: KiCad saves the board in current format and parity still reports 17 linked footprints. Remove only `/private/tmp/pocket-card-annotation-resave` after the check.

- [ ] **Step 6: Inspect the final diff**

Run:

```bash
git diff --check e347d7a5..HEAD
git diff --check
git status --short
```

Expected: no whitespace errors in task files and a clean worktree. Confirm the board commit changed only fourteen `Reference` property values and kept all seventeen UUID/path pairs.

- [ ] **Step 7: Commit documentation if it changed**

```bash
git add hardware/pocket_card/schematic/README.md hardware/pocket_card/case/README.md docs/superpowers/specs/2026-08-05-pocket-card-controller-schematic-design.md hardware/pocket_card/case/params.py hardware/pocket_card/case/shell_back.py
git commit -m "docs: explain Pocket Card annotation workflow"
```

### Task 6: Integrate without overwriting the live routed board

**Files:**
- Preserve and patch: `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb` in the main checkout.

- [ ] **Step 1: Use the branch-finishing workflow**

Invoke `superpowers:verification-before-completion`, request a focused code review, then invoke `superpowers:finishing-a-development-branch`. Proceed only with the user's chosen integration option.

- [ ] **Step 2: Snapshot the live board before a local merge**

If the user selects local merge, record the SHA-256 hash of the main checkout's live board and copy that exact file into a newly created directory under `/private/tmp`. Confirm the backup hash matches before changing the main checkout.

- [ ] **Step 3: Temporarily isolate the live board and fast-forward the branch**

Stash only `hardware/pocket_card/case/out/pcb/pocket_card_controller.kicad_pcb`, fast-forward `master` to the feature branch, and restore the exact pre-merge live board from the verified temporary backup. Do not stash or modify any other dirty render, routing, or manufacturing output.

- [ ] **Step 4: Apply only the fourteen reference migrations to the restored live board**

Use the reference map at the top of this plan. Compare the patched live board against its backup with zero context and require exactly fourteen removed old-reference lines and fourteen added digit-suffixed lines. Confirm its seventeen UUID/path pairs and all non-reference content are byte-identical to the backup.

- [ ] **Step 5: Verify the merged live project**

Run:

```bash
make pocket_card_kicad
node hardware/pocket_card/schematic/board_parity_test.js
```

Expected: the full pipeline passes and the live board reports 17 linked footprints with fully annotated references.

- [ ] **Step 6: Clean only task-owned temporary state**

After verification, drop the scoped temporary stash, remove the verified `/private/tmp` backup, remove the feature worktree, and delete the merged feature branch. Preserve every unrelated dirty file in the main checkout.
