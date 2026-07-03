# Static Analyzer Certificates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add analyzer-only certified wake masks, rule-group single-pass certificates, and win-relevance slices with comprehensive fixture coverage.

**Architecture:** Extend the existing JS static analyzer in `src/tests/ps_static_analysis.js` and its fixture runner. Each fact is emitted as analyzer JSON only; no engine, solver, or native runtime behavior changes in this plan. Fixtures document and pin every new field through `static_analysis_claim_descriptions.json` and `static_analysis_testdata_runner.js`.

**Tech Stack:** Node.js CommonJS, existing PuzzleScript JS static analyzer, `assert`-based fixture runner, JSON static-analysis fixtures.

---

## File Structure

- Modify: `src/tests/ps_static_analysis.js`
  - Add `certified_wake_masks` fact family.
  - Extend `rulegroup_flow` fact values with `single_pass_safe` and `single_pass_blockers`.
  - Add `win_relevance` fact family.
- Modify: `src/tests/static_analysis_claim_descriptions.json`
  - Document the `certified_wake_masks` fixture schema.
  - Document `single_pass_safe` and `single_pass_blockers` inside `rulegroup_flow`.
  - Document the `win_relevance` fixture schema.
- Modify: `src/tests/static_analysis_testdata_runner.js`
  - Project, validate, and check `certified_wake_masks` fixtures.
  - Project, validate, and check new `rulegroup_flow` fields.
  - Project, validate, and check `win_relevance` fixtures.
  - Include new fixture families in `runStaticAnalysisTestdata()` and exports.
- Create: `src/tests/static_analysis_testdata/certified_wake_masks/*.txt`
  - Fixture sources for object polarity, movement, randomdir/moving, stationary, and properties.
- Create: `src/tests/static_analysis_testdata/certified_wake_masks/*.json`
  - Expected projected wake-mask rows.
- Modify: selected `src/tests/static_analysis_testdata/rulegroup_flow/*.json`
  - Pin `single_pass_safe` and blockers on representative existing fixtures.
- Create: `src/tests/static_analysis_testdata/win_relevance/*.txt`
  - Fixture sources for direct, indirect, absence, movement, semantic root, and irrelevant rules.
- Create: `src/tests/static_analysis_testdata/win_relevance/*.json`
  - Expected projected win-relevance rows.

## Task 1: Rulegroup Single-Pass Certificates

**Files:**
- Modify: `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-forward-enable.json`
- Modify: `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-backward-enable.json`
- Modify: `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-random-blocker.json`
- Modify: `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-rigid-blocker.json`
- Modify: `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-semantic-command.json`
- Modify: `src/tests/static_analysis_claim_descriptions.json`
- Modify: `src/tests/static_analysis_testdata_runner.js`
- Modify: `src/tests/ps_static_analysis.js`

- [ ] **Step 1: Write failing fixture expectations for single-pass-safe groups**

In `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-forward-enable.json`, add these fields to the only `rulegroupFlow` row after `components_count`:

```json
"single_pass_safe": true,
"single_pass_blockers": [],
```

In `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-backward-enable.json`, add these fields to the only `rulegroupFlow` row after `components_count`:

```json
"single_pass_safe": false,
"single_pass_blockers": ["earlier_rule_may_be_enabled"],
```

- [ ] **Step 2: Write failing fixture expectations for conservative blockers**

In `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-random-blocker.json`, add these fields to the tested `rulegroupFlow` row after `components_count`:

```json
"single_pass_safe": false,
"single_pass_blockers": ["random_rule_group"],
```

In `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-rigid-blocker.json`, add these fields to the tested `rulegroupFlow` row after `components_count`:

```json
"single_pass_safe": false,
"single_pass_blockers": ["rigid_rule"],
```

In `src/tests/static_analysis_testdata/rulegroup_flow/rulegroup-semantic-command.json`, add these fields to the tested `rulegroupFlow` row after `components_count`:

```json
"single_pass_safe": false,
"single_pass_blockers": ["semantic_command"],
```

- [ ] **Step 3: Run the fixture runner to verify the new fields fail before implementation**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: FAIL. The first useful failure should report undocumented or unchecked `single_pass_safe` or `single_pass_blockers` fields in a `rulegroup_flow` fixture.

- [ ] **Step 4: Document the new rulegroup fixture fields**

In `src/tests/static_analysis_claim_descriptions.json`, inside the `rulegroup_flow` schema item fields, add these two field descriptions after `components_count`:

```json
{
  "name": "single_pass_safe",
  "type": "boolean",
  "description": "Whether this rule group has a conservative certificate that no rule application can enable itself or an earlier rule in the same group.",
  "specification": "true only when the analyzer's intra-group wake graph has no self edge and no edge from a later rule to itself or an earlier rule, and when group-level blockers such as random rules, rigid rules, semantic commands, or static force-always behavior are absent. This is an analyzer certificate only; no runtime behavior changes when the field is true."
},
{
  "name": "single_pass_blockers",
  "type": "string[]",
  "description": "Reasons this group is not certified single-pass-safe.",
  "specification": "Known blockers include earlier_rule_may_be_enabled, random_rule_group, rigid_rule, semantic_command, and force_always_rule. A group with single_pass_safe true must have an empty blocker list."
}
```

- [ ] **Step 5: Extend the rulegroup fixture runner so the test now fails on missing analyzer values**

In `src/tests/static_analysis_testdata_runner.js`, update `buildRulegroupFlowExpectations()` so each projected row includes the new fields:

```js
return {
    line: group.source_line_min,
    split_candidate: value.split_candidate || false,
    components_count: (value.components || []).length,
    single_pass_safe: !!value.single_pass_safe,
    single_pass_blockers: (value.single_pass_blockers || []).slice().sort(),
    interactionEdges,
    rerunMasks,
    blockers: (fact.blockers || []).slice().sort(),
};
```

Update `validateRulegroupFlowExpectationShape()` after the `components_count` assertion:

```js
if (item.single_pass_safe !== undefined) {
    assert.ok(typeof item.single_pass_safe === 'boolean', `${filePath}: rulegroupFlow[${index}].single_pass_safe must be boolean`);
}
if (item.single_pass_blockers !== undefined) {
    assertStringArray(filePath, `rulegroupFlow[${index}].single_pass_blockers`, item.single_pass_blockers);
}
```

Update `checkRulegroupFlowFixture()` after the `components_count` assertion:

```js
if (expected.single_pass_safe !== undefined) {
    assert.strictEqual(
        actualRow.single_pass_safe,
        expected.single_pass_safe,
        `${jsonPath}: group at line ${expected.line} single_pass_safe expected ${expected.single_pass_safe}, got ${actualRow.single_pass_safe}`
    );
}
if (expected.single_pass_blockers !== undefined) {
    assertSameStringSet(
        jsonPath,
        `group at line ${expected.line} single_pass_blockers`,
        expected.single_pass_blockers,
        actualRow.single_pass_blockers
    );
}
```

- [ ] **Step 6: Run the fixture runner to verify analyzer support is still missing**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: FAIL with `single_pass_safe expected true, got false` for `rulegroup-forward-enable.json`.

- [ ] **Step 7: Implement the rulegroup certificate derivation**

In `src/tests/ps_static_analysis.js`, add this helper near `deriveRulegroupFlowFacts()`:

```js
function rulegroupSinglePassBlockers(group, interactionEdges, indexById) {
    const blockers = [];
    if (interactionEdges.some(edge => indexById.get(edge.to) <= indexById.get(edge.from))) {
        blockers.push('earlier_rule_may_be_enabled');
    }
    if (group.random) blockers.push('random_rule_group');
    if (group.rules.some(rule => rule.rigid)) blockers.push('rigid_rule');
    if (group.rules.some(rule => rule.summary.semantic_commands.length > 0)) blockers.push('semantic_command');
    if (group.rules.some(rule => rule.tags && rule.tags.force_always_run)) blockers.push('force_always_rule');
    return uniqueSorted(blockers);
}
```

In `deriveRulegroupFlowFacts()`, after `const blockers = [];`, compute the new blockers:

```js
const singlePassBlockers = rulegroupSinglePassBlockers(group, interactionEdges, indexById);
```

Then add the new values to the fact value object:

```js
single_pass_safe: singlePassBlockers.length === 0,
single_pass_blockers: singlePassBlockers,
```

Keep the existing `split_candidate` blockers unchanged. `single_pass_safe` and `split_candidate` are separate certificates.

- [ ] **Step 8: Run the fixture runner to verify rulegroup coverage passes**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: PASS with `static_analysis_testdata_runner: ok`.

- [ ] **Step 9: Run targeted analyzer CLI output for rulegroup facts**

Run:

```bash
node src/tests/run_ps_static_analysis.js src/tests/static_analysis_testdata/rulegroup_flow --family rulegroup_flow --summary-only --no-ps-tagged
```

Expected: PASS and JSON output containing a `rulegroup_flow` summary with proved/candidate/rejected counts.

- [ ] **Step 10: Commit the rulegroup certificate slice**

Run:

```bash
git add src/tests/ps_static_analysis.js src/tests/static_analysis_claim_descriptions.json src/tests/static_analysis_testdata_runner.js src/tests/static_analysis_testdata/rulegroup_flow
git commit -m "feat: certify single-pass rule groups"
```

Expected: commit succeeds.

## Task 2: Certified Wake Masks

**Files:**
- Create: `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-object-polarity.txt`
- Create: `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-object-polarity.json`
- Create: `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-movement.txt`
- Create: `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-movement.json`
- Create: `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-property.txt`
- Create: `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-property.json`
- Modify: `src/tests/static_analysis_claim_descriptions.json`
- Modify: `src/tests/static_analysis_testdata_runner.js`
- Modify: `src/tests/ps_static_analysis.js`

- [ ] **Step 1: Create failing certified wake mask source fixtures**

Create `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-object-polarity.txt`:

```text
title Static Analysis Certified Wake Mask Object Polarity

========
OBJECTS
========

Background
black

Player
white

Crate
orange

Wall
gray

Marker
green

=======
LEGEND
=======

. = Background
P = Player
C = Crate
W = Wall
M = Marker

================
COLLISIONLAYERS
================

Background
Player
Crate
Wall
Marker

=====
RULES
=====

[ Player no Wall ] -> [ Player Marker ]
[ Marker ] -> [ no Marker Crate ]

=============
WINCONDITIONS
=============

Some Player

======
LEVELS
======

P.CW
....
```

Create `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-movement.txt`:

```text
title Static Analysis Certified Wake Mask Movement

========
OBJECTS
========

Background
black

Player
white

Crate
orange

=======
LEGEND
=======

. = Background
P = Player
C = Crate

================
COLLISIONLAYERS
================

Background
Player
Crate

=====
RULES
=====

[ > Player | Crate ] -> [ Player | > Crate ]
[ moving Crate ] -> [ Crate ]
[ randomdir Player ] -> [ randomdir Player ]

=============
WINCONDITIONS
=============

Some Player

======
LEVELS
======

PC.
```

Create `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-property.txt`:

```text
title Static Analysis Certified Wake Mask Property

========
OBJECTS
========

Background
black

Player
white

RedKey
red

BlueKey
blue

Door
brown

=======
LEGEND
=======

. = Background
P = Player
R = RedKey
B = BlueKey
D = Door
Key = RedKey or BlueKey

================
COLLISIONLAYERS
================

Background
Player
RedKey, BlueKey
Door

=====
RULES
=====

[ Key | Door ] -> [ Key | no Door ]
[ no Key ] -> [ RedKey ]

=============
WINCONDITIONS
=============

Some Player

======
LEVELS
======

PRD
```

- [ ] **Step 2: Create failing certified wake mask JSON expectations**

Create `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-object-polarity.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "human_verified": false,
  "ruleWakeMasks": [
    {
      "line": 46,
      "text": "[ Player no Wall ] -> [ Player Marker ]",
      "reads": {
        "object_present": ["Player"],
        "object_absent": ["Wall"],
        "movement": []
      },
      "writes": {
        "object_present": ["Marker"],
        "object_absent": [],
        "movement": []
      }
    },
    {
      "line": 47,
      "text": "[ Marker ] -> [ no Marker Crate ]",
      "reads": {
        "object_present": ["Marker"],
        "object_absent": [],
        "movement": []
      },
      "writes": {
        "object_present": ["Crate"],
        "object_absent": ["Marker"],
        "movement": []
      }
    }
  ]
}
```

Create `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-movement.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "human_verified": false,
  "ruleWakeMasks": [
    {
      "line": 36,
      "text": "[ > Player | Crate ] -> [ Player | > Crate ]",
      "reads": {
        "object_present": ["Crate", "Player"],
        "object_absent": [],
        "movement": ["Player:up"]
      },
      "writes": {
        "object_present": [],
        "object_absent": [],
        "movement": ["Crate:moving", "Crate:up", "Player:stationary"]
      }
    },
    {
      "line": 37,
      "text": "[ moving Crate ] -> [ Crate ]",
      "reads": {
        "object_present": ["Crate"],
        "object_absent": [],
        "movement": ["Crate:moving"]
      },
      "writes": {
        "object_present": [],
        "object_absent": [],
        "movement": ["Crate:stationary"]
      }
    },
    {
      "line": 38,
      "text": "[ randomdir Player ] -> [ randomdir Player ]",
      "reads": {
        "object_present": ["Player"],
        "object_absent": [],
        "movement": ["Player:randomdir"]
      },
      "writes": {
        "object_present": [],
        "object_absent": [],
        "movement": []
      }
    }
  ]
}
```

Create `src/tests/static_analysis_testdata/certified_wake_masks/wake-mask-property.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "human_verified": false,
  "ruleWakeMasks": [
    {
      "line": 46,
      "text": "[ Key | Door ] -> [ Key | no Door ]",
      "reads": {
        "object_present": ["BlueKey", "Door", "RedKey"],
        "object_absent": [],
        "movement": []
      },
      "writes": {
        "object_present": [],
        "object_absent": ["Door"],
        "movement": []
      }
    },
    {
      "line": 47,
      "text": "[ no Key ] -> [ RedKey ]",
      "reads": {
        "object_present": [],
        "object_absent": ["BlueKey", "RedKey"],
        "movement": []
      },
      "writes": {
        "object_present": ["RedKey"],
        "object_absent": ["BlueKey"],
        "movement": []
      }
    }
  ]
}
```

- [ ] **Step 3: Run the fixture runner to verify the new family fails before support exists**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: FAIL because `certified_wake_masks` is not documented or not included in the runner.

- [ ] **Step 4: Document the certified wake mask fixture schema**

In `src/tests/static_analysis_claim_descriptions.json`, add a new `fixtureSchemas` entry after `rulegroup_flow`:

```json
{
  "name": "certified_wake_masks",
  "description": "Fixtures for analyzer-certified per-rule read/write wake masks.",
  "specification": "Each certified_wake_masks fixture projects the rule_wake_masks fact into source-located rows. These are analyzer-level object and movement-key sets, not runtime bitvec masks.",
  "fields": [
    {
      "name": "schema",
      "type": "string",
      "description": "Fixture format version.",
      "specification": "Must be ps-static-analysis-testdata-v1."
    },
    {
      "name": "human_verified",
      "type": "boolean",
      "description": "Whether a human has reviewed this fixture's assertions.",
      "specification": "Human-owned metadata. Generated fixtures emit this field as false; set it to true only after manually checking the fixture's asserted expectations."
    },
    {
      "name": "ruleWakeMasks",
      "type": "array",
      "description": "Per-rule certified wake mask rows.",
      "specification": "Every row identifies one analyzed rule by source line and text, then asserts signed read and write sets.",
      "items": {
        "type": "object",
        "fields": [
          {
            "name": "line",
            "type": "integer",
            "description": "1-based source line of the rule.",
            "specification": "Together with text, identifies exactly one analyzed rule."
          },
          {
            "name": "text",
            "type": "string",
            "description": "Trimmed source text of the rule.",
            "specification": "Used with line to identify the rule."
          },
          {
            "name": "reads",
            "type": "object",
            "description": "Objects and movements read by the rule LHS.",
            "specification": "Contains object_present, object_absent, and movement string arrays. Movement entries use Object:movement."
          },
          {
            "name": "writes",
            "type": "object",
            "description": "Objects and movements the rule RHS may write.",
            "specification": "Contains object_present, object_absent, and movement string arrays. Movement entries use Object:movement and include stationary when movement clearing can wake stationary-sensitive reads."
          }
        ]
      }
    }
  ]
}
```

- [ ] **Step 5: Add certified wake mask fixture runner support**

In `src/tests/static_analysis_testdata_runner.js`, add these helper functions after the rulegroup-flow helpers:

```js
function certifiedWakeMaskFactValue(report) {
    const facts = (report.facts && report.facts.certified_wake_masks) || [];
    if (facts.length === 0) return { rules: [] };
    return facts[0].value || { rules: [] };
}

function sortedMaskPart(value) {
    return {
        object_present: (value.object_present || []).slice().sort(),
        object_absent: (value.object_absent || []).slice().sort(),
        movement: (value.movement || []).slice().sort(),
    };
}

function buildCertifiedWakeMaskExpectations(source, report) {
    const records = allRuleRecords(report, source);
    assertRuleRecordsIdempotent(report.source.path, records);
    const byId = recordById(records);
    const rows = (certifiedWakeMaskFactValue(report).rules || []).map(row => {
        const record = byId.get(row.rule_id);
        assert.ok(record, `certified_wake_masks rule id ${row.rule_id} not found in records`);
        return {
            line: record.line,
            text: record.text,
            reads: sortedMaskPart(row.reads || {}),
            writes: sortedMaskPart(row.writes || {}),
        };
    });
    rows.sort((left, right) => left.line - right.line || left.text.localeCompare(right.text));
    return { schema: FIXTURE_SCHEMA, human_verified: false, ruleWakeMasks: rows };
}

function assertMaskPartShape(filePath, label, value) {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${filePath}: ${label} must be an object`);
    assertStringArray(filePath, `${label}.object_present`, value.object_present);
    assertStringArray(filePath, `${label}.object_absent`, value.object_absent);
    assertStringArray(filePath, `${label}.movement`, value.movement);
}

function validateCertifiedWakeMaskExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    assert.ok(Array.isArray(payload.ruleWakeMasks), `${filePath}: ruleWakeMasks must be an array`);
    for (const [index, item] of payload.ruleWakeMasks.entries()) {
        assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${filePath}: ruleWakeMasks[${index}] must be an object`);
        assert.ok(Number.isInteger(item.line) && item.line > 0, `${filePath}: ruleWakeMasks[${index}] missing positive integer line`);
        assert.ok(typeof item.text === 'string' && item.text.length > 0, `${filePath}: ruleWakeMasks[${index}] missing text`);
        assertMaskPartShape(filePath, `ruleWakeMasks[${index}].reads`, item.reads);
        assertMaskPartShape(filePath, `ruleWakeMasks[${index}].writes`, item.writes);
    }
}

function compareWakeMaskRows(left, right) {
    return left.line - right.line || left.text.localeCompare(right.text);
}

function checkCertifiedWakeMaskFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'certified_wake_masks'), payload);
    validateCertifiedWakeMaskExpectationShape(jsonPath, payload);
    const actual = buildCertifiedWakeMaskExpectations(source, report).ruleWakeMasks;
    const expected = payload.ruleWakeMasks.slice().sort(compareWakeMaskRows);
    assert.deepStrictEqual(actual, expected, `${jsonPath}: ruleWakeMasks mismatch`);
}

function runCertifiedWakeMasksDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
    const txtFiles = sortedFiles(dirPath, '.txt');
    const jsonFiles = sortedFiles(dirPath, '.json');
    const txtStems = new Set(txtFiles.map(name => path.basename(name, '.txt')));
    const jsonStems = new Set(jsonFiles.map(name => path.basename(name, '.json')));
    for (const stem of jsonStems) {
        assert.ok(txtStems.has(stem), `${path.join(dirPath, `${stem}.json`)}: missing matching .txt`);
    }
    for (const txtName of txtFiles) {
        const stem = path.basename(txtName, '.txt');
        const txtPath = path.join(dirPath, txtName);
        const jsonPath = path.join(dirPath, `${stem}.json`);
        if (!fs.existsSync(jsonPath)) {
            const source = fs.readFileSync(txtPath, 'utf8');
            const report = analyzeSource(source, { sourcePath: txtPath });
            assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
            writeJson(jsonPath, buildCertifiedWakeMaskExpectations(source, report));
            log(`generated static analysis testdata: certified_wake_masks/${stem}.json (review before committing)\n`);
        }
        checkCertifiedWakeMaskFixture(txtPath, jsonPath, claimDescriptions);
    }
}
```

In `runStaticAnalysisTestdata()`, add this block after `runRulegroupFlowDir(...)`:

```js
const certifiedWakeMasksDir = path.join(root, 'certified_wake_masks');
assert.ok(fs.existsSync(certifiedWakeMasksDir), `${certifiedWakeMasksDir}: missing certified_wake_masks testdata directory`);
runCertifiedWakeMasksDir(certifiedWakeMasksDir, claimDescriptions, options.log);
```

In `module.exports`, add:

```js
buildCertifiedWakeMaskExpectations,
runCertifiedWakeMasksDir,
```

- [ ] **Step 6: Run the fixture runner to verify analyzer facts are still missing**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: FAIL with `ruleWakeMasks mismatch` because the analyzer does not yet emit `certified_wake_masks`.

- [ ] **Step 7: Implement certified wake mask facts**

In `src/tests/ps_static_analysis.js`, add these helpers near `ruleFlowReads()`:

```js
function flowMovementKeys(movements) {
    return uniqueSorted((movements || []).map(item => `${item.object}:${item.movement}`));
}

function flowSetValues(values) {
    return uniqueSorted(values || []);
}

function ruleWakeMaskRecord(psTagged, rule) {
    const reads = ruleFlowReads(rule);
    const writes = ruleFlowWrites(psTagged, rule);
    return {
        rule_id: rule.id,
        reads: {
            object_present: flowSetValues(reads.object_present),
            object_absent: flowSetValues(reads.object_absent),
            movement: flowMovementKeys(reads.movement),
        },
        writes: {
            object_present: flowSetValues(writes.object_present),
            object_absent: flowSetValues(writes.object_absent),
            movement: flowMovementKeys(writes.movement),
        },
    };
}

function deriveCertifiedWakeMaskFacts(psTagged) {
    const rules = allRuleEntries(psTagged).map(entry => entry.rule);
    const records = rules.map(rule => ruleWakeMaskRecord(psTagged, rule));
    return [fact('certified_wake_masks', 'rule_wake_masks', 'proved', {
        subjects: { rules: rules.map(rule => rule.id) },
        value: { rules: records },
        proof: ['rule_flow_reads_writes_exported'],
        evidence: rules.map(rule => rule.id),
    })];
}
```

Update `emptyFacts()`:

```js
certified_wake_masks: [],
```

Update `factDerivers()`:

```js
certified_wake_masks: deriveCertifiedWakeMaskFacts,
```

- [ ] **Step 8: Run certified wake mask fixtures**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: PASS with `static_analysis_testdata_runner: ok`.

- [ ] **Step 9: Run targeted analyzer output for certified wake masks**

Run:

```bash
node src/tests/run_ps_static_analysis.js src/tests/static_analysis_testdata/certified_wake_masks --family certified_wake_masks --no-ps-tagged
```

Expected: PASS and JSON output with `certified_wake_masks` facts for each fixture.

- [ ] **Step 10: Commit the certified wake mask slice**

Run:

```bash
git add src/tests/ps_static_analysis.js src/tests/static_analysis_claim_descriptions.json src/tests/static_analysis_testdata_runner.js src/tests/static_analysis_testdata/certified_wake_masks
git commit -m "feat: emit certified wake masks"
```

Expected: commit succeeds.

## Task 3: Win Relevance Facts

**Files:**
- Create: `src/tests/static_analysis_testdata/win_relevance/win-relevance-direct.txt`
- Create: `src/tests/static_analysis_testdata/win_relevance/win-relevance-direct.json`
- Create: `src/tests/static_analysis_testdata/win_relevance/win-relevance-chain.txt`
- Create: `src/tests/static_analysis_testdata/win_relevance/win-relevance-chain.json`
- Create: `src/tests/static_analysis_testdata/win_relevance/win-relevance-semantic.txt`
- Create: `src/tests/static_analysis_testdata/win_relevance/win-relevance-semantic.json`
- Modify: `src/tests/static_analysis_claim_descriptions.json`
- Modify: `src/tests/static_analysis_testdata_runner.js`
- Modify: `src/tests/ps_static_analysis.js`

- [ ] **Step 1: Create failing win relevance source fixtures**

Create `src/tests/static_analysis_testdata/win_relevance/win-relevance-direct.txt`:

```text
title Static Analysis Win Relevance Direct

========
OBJECTS
========

Background
black

Player
white

Goal
yellow

Deco
blue

=======
LEGEND
=======

. = Background
P = Player
G = Goal
D = Deco

================
COLLISIONLAYERS
================

Background
Player, Goal
Deco

=====
RULES
=====

[ Player ] -> [ Goal ]
[ Deco ] -> [ no Deco ]

=============
WINCONDITIONS
=============

Some Goal

======
LEVELS
======

PD.
```

Create `src/tests/static_analysis_testdata/win_relevance/win-relevance-chain.txt`:

```text
title Static Analysis Win Relevance Chain

========
OBJECTS
========

Background
black

Player
white

Goal
yellow

Marker
green

Deco
blue

=======
LEGEND
=======

. = Background
P = Player
G = Goal
M = Marker
D = Deco

================
COLLISIONLAYERS
================

Background
Player
Goal
Marker
Deco

=====
RULES
=====

[ Player ] -> [ Player Marker ]
[ Marker ] -> [ Marker Goal ]
[ Deco ] -> [ no Deco ]

=============
WINCONDITIONS
=============

Some Goal

======
LEVELS
======

PD.
```

Create `src/tests/static_analysis_testdata/win_relevance/win-relevance-semantic.txt`:

```text
title Static Analysis Win Relevance Semantic

========
OBJECTS
========

Background
black

Player
white

Goal
yellow

Deco
blue

=======
LEGEND
=======

. = Background
P = Player
G = Goal
D = Deco

================
COLLISIONLAYERS
================

Background
Player
Goal
Deco

=====
RULES
=====

[ Player ] -> [ Player ] win
[ Goal ] -> [ no Goal ]
[ Deco ] -> [ no Deco ]

=============
WINCONDITIONS
=============

Some Goal

======
LEVELS
======

PD.
```

- [ ] **Step 2: Create failing win relevance JSON expectations**

Create `src/tests/static_analysis_testdata/win_relevance/win-relevance-direct.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "human_verified": false,
  "rootRules": [
    {
      "line": 40,
      "text": "[ Player ] -> [ Goal ]"
    }
  ],
  "semanticRootRules": [],
  "relevantRules": [
    {
      "line": 39,
      "text": "[ Player ] -> [ Goal ]"
    }
  ],
  "irrelevantRules": [
    {
      "line": 41,
      "text": "[ Deco ] -> [ no Deco ]"
    }
  ]
}
```

Create `src/tests/static_analysis_testdata/win_relevance/win-relevance-chain.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "human_verified": false,
  "rootRules": [
    {
      "line": 47,
      "text": "[ Marker ] -> [ Marker Goal ]"
    }
  ],
  "semanticRootRules": [],
  "relevantRules": [
    {
      "line": 46,
      "text": "[ Player ] -> [ Player Marker ]"
    },
    {
      "line": 47,
      "text": "[ Marker ] -> [ Marker Goal ]"
    }
  ],
  "irrelevantRules": [
    {
      "line": 48,
      "text": "[ Deco ] -> [ no Deco ]"
    }
  ]
}
```

Create `src/tests/static_analysis_testdata/win_relevance/win-relevance-semantic.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "human_verified": false,
  "rootRules": [
    {
      "line": 42,
      "text": "[ Goal ] -> [ no Goal ]"
    },
    {
      "line": 41,
      "text": "[ Player ] -> [ Player ] win"
    }
  ],
  "semanticRootRules": [
    {
      "line": 41,
      "text": "[ Player ] -> [ Player ] win"
    }
  ],
  "relevantRules": [
    {
      "line": 39,
      "text": "[ Player ] -> [ Player ] win"
    },
    {
      "line": 42,
      "text": "[ Goal ] -> [ no Goal ]"
    }
  ],
  "irrelevantRules": [
    {
      "line": 43,
      "text": "[ Deco ] -> [ no Deco ]"
    }
  ]
}
```

- [ ] **Step 3: Run the fixture runner to verify the new family fails before support exists**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: FAIL because `win_relevance` is not documented or not included in the runner.

- [ ] **Step 4: Document the win relevance fixture schema**

In `src/tests/static_analysis_claim_descriptions.json`, add a new `fixtureSchemas` entry after `winflow`:

```json
{
  "name": "win_relevance",
  "description": "Fixtures for solver-scoped backward relevance slices from win conditions and semantic commands.",
  "specification": "Each win_relevance fixture asserts source-located root, semantic-root, relevant, and irrelevant rule sets derived from winflow and program_flow.",
  "fields": [
    {
      "name": "schema",
      "type": "string",
      "description": "Fixture format version.",
      "specification": "Must be ps-static-analysis-testdata-v1."
    },
    {
      "name": "human_verified",
      "type": "boolean",
      "description": "Whether a human has reviewed this fixture's assertions.",
      "specification": "Human-owned metadata. Generated fixtures emit this field as false; set it to true only after manually checking the fixture's asserted expectations."
    },
    {
      "name": "rootRules",
      "type": "array",
      "description": "Rules that seed the relevance slice.",
      "specification": "Includes direct win-waking rules and semantic-command roots."
    },
    {
      "name": "semanticRootRules",
      "type": "array",
      "description": "Rules that seed relevance because they queue solver-visible semantic commands.",
      "specification": "Includes cancel, again, restart, win, and checkpoint commands."
    },
    {
      "name": "relevantRules",
      "type": "array",
      "description": "Solver-active rules in the backward closure from rootRules through program_flow wake edges.",
      "specification": "These rules may participate in a causal chain into a win condition or semantic command."
    },
    {
      "name": "irrelevantRules",
      "type": "array",
      "description": "Solver-active rules outside the backward win-relevance closure.",
      "specification": "These rules are reported for future solver pruning only. This milestone does not remove or suppress them."
    }
  ]
}
```

- [ ] **Step 5: Add win relevance fixture runner support**

In `src/tests/static_analysis_testdata_runner.js`, add these helper functions near the winflow helpers:

```js
function winRelevanceFactValue(report) {
    const facts = (report.facts && report.facts.win_relevance) || [];
    if (facts.length === 0) {
        return {
            root_rule_ids: [],
            semantic_root_rule_ids: [],
            relevant_rule_ids: [],
            irrelevant_rule_ids: [],
        };
    }
    return facts[0].value || {};
}

function locatorsForRuleIds(ruleById, ruleIds, label) {
    const rows = [];
    for (const ruleId of ruleIds || []) {
        const record = ruleById.get(ruleId);
        assert.ok(record, `${label} rule id ${ruleId} not found in records`);
        rows.push(ruleLocator(record));
    }
    return rows.sort(compareRuleLocators);
}

function buildWinRelevanceExpectations(source, report) {
    const records = allRuleRecords(report, source);
    assertRuleRecordsIdempotent(report.source.path, records);
    const byId = recordById(records);
    const value = winRelevanceFactValue(report);
    return {
        schema: FIXTURE_SCHEMA,
        human_verified: false,
        rootRules: locatorsForRuleIds(byId, value.root_rule_ids, 'win_relevance root'),
        semanticRootRules: locatorsForRuleIds(byId, value.semantic_root_rule_ids, 'win_relevance semantic root'),
        relevantRules: locatorsForRuleIds(byId, value.relevant_rule_ids, 'win_relevance relevant'),
        irrelevantRules: locatorsForRuleIds(byId, value.irrelevant_rule_ids, 'win_relevance irrelevant'),
    };
}

function validateRuleLocatorArray(filePath, fieldName, rows) {
    assert.ok(Array.isArray(rows), `${filePath}: ${fieldName} must be an array`);
    for (const [index, row] of rows.entries()) {
        assert.ok(row && typeof row === 'object' && !Array.isArray(row), `${filePath}: ${fieldName}[${index}] must be an object`);
        assert.ok(Number.isInteger(row.line) && row.line > 0, `${filePath}: ${fieldName}[${index}] missing positive integer line`);
        assert.ok(typeof row.text === 'string' && row.text.length > 0, `${filePath}: ${fieldName}[${index}] missing text`);
    }
}

function validateWinRelevanceExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    validateRuleLocatorArray(filePath, 'rootRules', payload.rootRules);
    validateRuleLocatorArray(filePath, 'semanticRootRules', payload.semanticRootRules);
    validateRuleLocatorArray(filePath, 'relevantRules', payload.relevantRules);
    validateRuleLocatorArray(filePath, 'irrelevantRules', payload.irrelevantRules);
}

function checkWinRelevanceFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'win_relevance'), payload);
    validateWinRelevanceExpectationShape(jsonPath, payload);
    const actual = buildWinRelevanceExpectations(source, report);
    assert.deepStrictEqual(actual.rootRules, payload.rootRules.slice().sort(compareRuleLocators), `${jsonPath}: rootRules mismatch`);
    assert.deepStrictEqual(actual.semanticRootRules, payload.semanticRootRules.slice().sort(compareRuleLocators), `${jsonPath}: semanticRootRules mismatch`);
    assert.deepStrictEqual(actual.relevantRules, payload.relevantRules.slice().sort(compareRuleLocators), `${jsonPath}: relevantRules mismatch`);
    assert.deepStrictEqual(actual.irrelevantRules, payload.irrelevantRules.slice().sort(compareRuleLocators), `${jsonPath}: irrelevantRules mismatch`);
}

function runWinRelevanceDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
    const txtFiles = sortedFiles(dirPath, '.txt');
    const jsonFiles = sortedFiles(dirPath, '.json');
    const txtStems = new Set(txtFiles.map(name => path.basename(name, '.txt')));
    const jsonStems = new Set(jsonFiles.map(name => path.basename(name, '.json')));
    for (const stem of jsonStems) {
        assert.ok(txtStems.has(stem), `${path.join(dirPath, `${stem}.json`)}: missing matching .txt`);
    }
    for (const txtName of txtFiles) {
        const stem = path.basename(txtName, '.txt');
        const txtPath = path.join(dirPath, txtName);
        const jsonPath = path.join(dirPath, `${stem}.json`);
        if (!fs.existsSync(jsonPath)) {
            const source = fs.readFileSync(txtPath, 'utf8');
            const report = analyzeSource(source, { sourcePath: txtPath });
            assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
            writeJson(jsonPath, buildWinRelevanceExpectations(source, report));
            log(`generated static analysis testdata: win_relevance/${stem}.json (review before committing)\n`);
        }
        checkWinRelevanceFixture(txtPath, jsonPath, claimDescriptions);
    }
}
```

In `runStaticAnalysisTestdata()`, add this block after `runWinflowDir(...)`:

```js
const winRelevanceDir = path.join(root, 'win_relevance');
assert.ok(fs.existsSync(winRelevanceDir), `${winRelevanceDir}: missing win_relevance testdata directory`);
runWinRelevanceDir(winRelevanceDir, claimDescriptions, options.log);
```

In `module.exports`, add:

```js
buildWinRelevanceExpectations,
runWinRelevanceDir,
```

- [ ] **Step 6: Run the fixture runner to verify analyzer support is missing**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: FAIL with a `win_relevance` rule set mismatch because the analyzer does not yet emit the fact.

- [ ] **Step 7: Implement win relevance derivation**

In `src/tests/ps_static_analysis.js`, add these helpers near `deriveWinflowFacts()` and `deriveProgramFlowFacts()`:

```js
function semanticRootRuleIds(rules) {
    const ids = [];
    for (const rule of rules) {
        if ((rule.summary.semantic_commands || []).some(command => SEMANTIC_COMMANDS.has(command))) {
            ids.push(rule.id);
        }
    }
    return uniqueSorted(ids);
}

function backwardRelevantRuleIds(rootRuleIds, wakeEdges) {
    const relevant = new Set(rootRuleIds);
    let changed = true;
    while (changed) {
        changed = false;
        for (const edge of wakeEdges) {
            if (!relevant.has(edge.to) || relevant.has(edge.from)) continue;
            relevant.add(edge.from);
            changed = true;
        }
    }
    return uniqueSorted(relevant);
}

function deriveWinRelevanceFacts(psTagged) {
    const entries = allRuleEntries(psTagged);
    const rules = entries.map(entry => entry.rule);
    const ruleIds = rules.map(rule => rule.id);
    const programFlow = deriveProgramFlowFacts(psTagged)[0].value;
    const winflow = deriveWinflowFacts(psTagged)[0].value;
    const relevanceEdges = relevanceEdgesForRules(psTagged, rules);
    const directWinRoots = uniqueSorted((winflow.wake_edges || []).map(edge => edge.from));
    const semanticRoots = semanticRootRuleIds(rules);
    const rootRuleIds = uniqueSorted(directWinRoots.concat(semanticRoots));
    const relevantRuleIds = backwardRelevantRuleIds(rootRuleIds, relevanceEdges);
    const relevantSet = new Set(relevantRuleIds);
    const irrelevantRuleIds = uniqueSorted(rules
        .filter(rule => rule.tags.solver_state_active && !relevantSet.has(rule.id))
        .map(rule => rule.id));
    return [fact('win_relevance', 'win_relevance', 'proved', {
        subjects: { rules: ruleIds },
        value: {
            rule_ids: ruleIds,
            root_rule_ids: rootRuleIds,
            relevant_rule_ids: relevantRuleIds,
            irrelevant_rule_ids: irrelevantRuleIds,
            wake_edges: programFlow.wake_edges || [],
            win_wake_edges: winflow.wake_edges || [],
            relevance_edges: relevanceEdges,
            semantic_root_rule_ids: semanticRoots,
        },
        proof: ['backward_relevance_slice_from_winflow_semantic_roots_and_conservative_dependencies'],
        evidence: relevantRuleIds,
    })];
}
```

The final `relevanceEdgesForRules()` helper should be conservative for future
pruning: include normal enabling edges, plus object presence/absence writes and
same-object movement writes that may disable a currently relevant rule's reads.
Keep `wake_edges` as the narrower `program_flow` diagnostic graph.

Update `emptyFacts()`:

```js
win_relevance: [],
```

Update `factDerivers()`:

```js
win_relevance: deriveWinRelevanceFacts,
```

- [ ] **Step 8: Run win relevance fixtures**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: PASS with `static_analysis_testdata_runner: ok`.

- [ ] **Step 9: Run targeted analyzer output for win relevance**

Run:

```bash
node src/tests/run_ps_static_analysis.js src/tests/static_analysis_testdata/win_relevance --family win_relevance --no-ps-tagged
```

Expected: PASS and JSON output with one `win_relevance` fact per fixture.

- [ ] **Step 10: Commit the win relevance slice**

Run:

```bash
git add src/tests/ps_static_analysis.js src/tests/static_analysis_claim_descriptions.json src/tests/static_analysis_testdata_runner.js src/tests/static_analysis_testdata/win_relevance
git commit -m "feat: derive win relevance facts"
```

Expected: commit succeeds.

## Task 4: Full Analyzer Verification

**Files:**
- Modify only if a previous task revealed an integration mismatch:
  - `src/tests/ps_static_analysis.js`
  - `src/tests/static_analysis_claim_descriptions.json`
  - `src/tests/static_analysis_testdata_runner.js`
  - `src/tests/static_analysis_testdata/**`

- [ ] **Step 1: Run the static analysis fixture suite**

Run:

```bash
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: PASS with `static_analysis_testdata_runner: ok`.

- [ ] **Step 2: Run the core static analyzer unit smoke**

Run:

```bash
node src/tests/ps_static_analysis_node.js
```

Expected: PASS with `ps_static_analysis_node: ok`.

- [ ] **Step 3: Run the analyzer CLI over all static-analysis fixture sources**

Run:

```bash
node src/tests/run_ps_static_analysis.js src/tests/static_analysis_testdata --summary-only --no-ps-tagged
```

Expected: PASS and JSON output with `"schema": "ps-static-analysis-batch-summary-v1"`.

- [ ] **Step 4: Run the full JS test suite**

Run:

```bash
node src/tests/run_tests_node.js
```

Expected: PASS with the standard QUnit success output.

- [ ] **Step 5: Inspect git status and diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only planned analyzer, fixture-runner, claim-description, and static-analysis fixture files are modified.

- [ ] **Step 6: Commit final verification adjustments if any were required**

If Step 5 shows uncommitted fixes from this verification task, run:

```bash
git add src/tests/ps_static_analysis.js src/tests/static_analysis_claim_descriptions.json src/tests/static_analysis_testdata_runner.js src/tests/static_analysis_testdata
git commit -m "test: verify static analyzer certificates"
```

Expected: commit succeeds only when there were verification fixes to commit.

## Self-Review Checklist

- S1 is implemented by Task 2 with `certified_wake_masks` facts, claim docs, runner support, and fixtures for object polarity, movement, randomdir/moving, stationary, and properties.
- S2 is implemented by Task 1 with `single_pass_safe` and `single_pass_blockers`, claim docs, runner support, and positive/blocker fixtures.
- S12 is implemented by Task 3 with `win_relevance` facts, claim docs, runner support, and direct/indirect/semantic/irrelevant fixtures.
- Non-goals are preserved: no engine, solver, native, or `bin/` changes.
- Verification commands match the approved design spec.
