# Static Analysis Fixture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the recent multi-family static-analysis regression out of long inline Node tests and into browseable fixture directories, while adding first-class `runtime_contracts` fixture support.

**Architecture:** Keep the existing family fixture runner as the source of truth for focused expectations. Add a small `runtime_contracts` family that reuses the existing runtime-contract replay helper. Duplicate small PuzzleScript sources across family directories for readability, and add a human-only `regressions.md` index.

**Tech Stack:** Node.js CommonJS test runner code, PuzzleScript static analysis fixtures under `src/tests/static_analysis_testdata/`, existing `make static_analysis_tests` target.

---

## File Structure

- Modify `src/tests/run_static_analysis_runtime_contracts_node.js`
  - Add and export a `replayFinalSerializedLevel()` helper so fixture generation can compute `expectedFinalLevel` without duplicating runtime setup.

- Modify `src/tests/static_analysis_testdata_runner.js`
  - Import `runSimulationWithStaticChecks()` and `replayFinalSerializedLevel()`.
  - Add `buildRuntimeContractExpectations()`, `checkRuntimeContractFixture()`, and `runRuntimeContractsDir()`.
  - Wire `runtime_contracts/` into `runStaticAnalysisTestdata()`.
  - Export the new functions for runner unit tests.

- Modify `src/tests/static_analysis_testdata_runner_node.js`
  - Add failing unit coverage for runtime-contract generation, validation, non-overwrite behavior, and documented-field rejection.

- Modify `src/tests/static_analysis_claim_descriptions.json`
  - Add the `runtime_contracts` fixture schema.

- Modify `src/tests/static_analysis_testdata/README.md`
  - Document duplicate multi-family fixtures, `runtime_contracts/`, and `regressions.md`.

- Create `src/tests/static_analysis_testdata/runtime_contracts/`
  - Add focused runtime replay fixtures.

- Create `src/tests/static_analysis_testdata/regressions.md`
  - Add a human index for the property inferred overwrite regression.

- Create fixture files:
  - `src/tests/static_analysis_testdata/object_tags/property-inferred-overwrite.txt`
  - `src/tests/static_analysis_testdata/object_tags/property-inferred-overwrite.json`
  - `src/tests/static_analysis_testdata/rule_tags/property-inferred-overwrite.txt`
  - `src/tests/static_analysis_testdata/rule_tags/property-inferred-overwrite.json`
  - `src/tests/static_analysis_testdata/winflow/property-inferred-overwrite.txt`
  - `src/tests/static_analysis_testdata/winflow/property-inferred-overwrite.json`
  - `src/tests/static_analysis_testdata/movement_action/property-inferred-overwrite-action.txt`
  - `src/tests/static_analysis_testdata/movement_action/property-inferred-overwrite-action.json`
  - `src/tests/static_analysis_testdata/runtime_contracts/property-inferred-overwrite.txt`
  - `src/tests/static_analysis_testdata/runtime_contracts/property-inferred-overwrite.json`

- Modify `src/tests/ps_static_analysis_node.js`
  - Remove the inline property inferred overwrite assertions after fixture coverage exists.

- Modify `src/tests/run_static_analysis_runtime_contracts_node_test.js`
  - Remove the inline property inferred overwrite runtime-contract fixture after `runtime_contracts/` coverage exists.

---

### Task 1: Add Failing Runtime Contract Runner Tests

**Files:**
- Modify: `src/tests/static_analysis_testdata_runner_node.js`

- [ ] **Step 1: Extend the test runner imports**

At the import from `./static_analysis_testdata_runner`, add these names:

```js
    buildRuntimeContractExpectations,
    runRuntimeContractsDir,
```

The import block should include:

```js
const {
    assertFixtureFieldsDocumented,
    buildMovementActionExpectations,
    buildRuntimeContractExpectations,
    fixtureFieldsAtPath,
    fixtureSchemaByName,
    findRuleRecord,
    formatFixtureJson,
    loadClaimDescriptions,
    runObjectTagsDir,
    runRuntimeContractsDir,
    runRuleTagsDir,
} = require('./static_analysis_testdata_runner');
```

- [ ] **Step 2: Add a focused runtime contract source fixture in the runner unit test**

In `run()`, after the movement-action payload assertion and before the existing `generatedLog` setup, add this exact block:

```js
        const runtimeContractSource = [
            '========',
            'OBJECTS',
            '========',
            '',
            'Background',
            'Black',
            '',
            'Player',
            'Pink',
            '',
            '=======',
            'LEGEND',
            '=======',
            '',
            '. = Background',
            'P = Player',
            '',
            '======',
            'SOUNDS',
            '======',
            '',
            '================',
            'COLLISIONLAYERS',
            '================',
            '',
            'Background',
            'Player',
            '',
            '======',
            'RULES',
            '======',
            '',
            '[ Player ] -> [ Player ]',
            '',
            '==============',
            'WINCONDITIONS',
            '==============',
            '',
            'Some Player',
            '',
            '=======',
            'LEVELS',
            '=======',
            '',
            'P',
        ].join('\\n');

        const runtimeContractPayload = buildRuntimeContractExpectations(
            runtimeContractSource,
            'runtime-contract-tmp',
            { inputs: ['tick'] }
        );
        assert.strictEqual(runtimeContractPayload.schema, FIXTURE_SCHEMA);
        assert.deepStrictEqual(runtimeContractPayload.inputs, ['tick']);
        assert.strictEqual(runtimeContractPayload.expectedFinalLevel, 'background player:0,\\n');
        assert.strictEqual(runtimeContractPayload.expect.neverAppearsObjectCount, 0);
```

- [ ] **Step 3: Add generation and non-overwrite tests for `runRuntimeContractsDir()`**

After the existing object-tags rerun non-overwrite assertion:

```js
        assert.strictEqual(fs.readFileSync(jsonPath, 'utf8'), curatedText);
```

add this exact block:

```js
        const runtimeContractsDir = path.join(tmpRoot, 'runtime_contracts');
        fs.mkdirSync(runtimeContractsDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeContractsDir, 'runtime-contract-tmp.txt'), runtimeContractSource, 'utf8');

        const generatedRuntimeLog = [];
        runRuntimeContractsDir(runtimeContractsDir, claimDescriptions, message => generatedRuntimeLog.push(message));
        assert.deepStrictEqual(generatedRuntimeLog, [
            'generated static analysis testdata: runtime_contracts/runtime-contract-tmp.json (review before committing)\\n',
        ]);

        const runtimeJsonPath = path.join(runtimeContractsDir, 'runtime-contract-tmp.json');
        const generatedRuntimePayload = JSON.parse(fs.readFileSync(runtimeJsonPath, 'utf8'));
        assert.strictEqual(generatedRuntimePayload.schema, FIXTURE_SCHEMA);
        assert.deepStrictEqual(generatedRuntimePayload.inputs, ['tick']);
        assert.strictEqual(generatedRuntimePayload.expectedFinalLevel, 'background player:0,\\n');
        assert.strictEqual(generatedRuntimePayload.expect.neverAppearsObjectCount, 0);

        const curatedRuntime = {
            schema: FIXTURE_SCHEMA,
            inputs: ['tick'],
            expectedFinalLevel: 'background player:0,\\n',
            expect: {
                neverAppearsObjectCount: 0,
            },
        };
        writeJson(runtimeJsonPath, curatedRuntime);
        const curatedRuntimeText = fs.readFileSync(runtimeJsonPath, 'utf8');

        const rerunRuntimeLog = [];
        runRuntimeContractsDir(runtimeContractsDir, claimDescriptions, message => rerunRuntimeLog.push(message));
        assert.deepStrictEqual(rerunRuntimeLog, []);
        assert.strictEqual(fs.readFileSync(runtimeJsonPath, 'utf8'), curatedRuntimeText);
```

- [ ] **Step 4: Add documented-field rejection for runtime contract payloads**

After the existing `undocumented-nested-field` assertion, add:

```js
        assert.throws(
            () => assertFixtureFieldsDocumented(
                'undocumented-runtime-contract-field.json',
                fixtureSchemaByName(claimDescriptions, 'runtime_contracts'),
                {
                    schema: FIXTURE_SCHEMA,
                    inputs: ['tick'],
                    expectedFinalLevel: 'background player:0,\\n',
                    expect: {
                        neverAppearsObjectCount: 0,
                        mysteryRuntimeField: 1,
                    },
                }
            ),
            /undocumented fixture field expect\\.mysteryRuntimeField/
        );
```

- [ ] **Step 5: Run the runner unit test and verify it fails**

Run:

```sh
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: FAIL with an error like `buildRuntimeContractExpectations is not a function` or `runRuntimeContractsDir is not a function`.

- [ ] **Step 6: Commit the failing test**

Only commit the runner unit test. If other unrelated source files are dirty, do not stage them.

```sh
git add src/tests/static_analysis_testdata_runner_node.js
git commit -m "test: cover runtime contract fixture runner"
```

---

### Task 2: Implement Runtime Contract Fixture Runner

**Files:**
- Modify: `src/tests/run_static_analysis_runtime_contracts_node.js`
- Modify: `src/tests/static_analysis_testdata_runner.js`
- Modify: `src/tests/static_analysis_claim_descriptions.json`

- [ ] **Step 1: Make single-case runtime checks load the runtime**

At the start of `runSimulationWithStaticChecks(testName, dataarray)`, add:

```js
    ensureRuntimeLoaded();
```

The function should begin:

```js
function runSimulationWithStaticChecks(testName, dataarray) {
    ensureRuntimeLoaded();
    const source = dataarray[0];
    const inputs = dataarray[1];
    const expectedSerializedLevel = dataarray[2];
```

This keeps existing direct callers working and lets `static_analysis_testdata_runner.js` call the helper without manually loading the PuzzleScript runtime.

- [ ] **Step 2: Export a final-level replay helper**

In `src/tests/run_static_analysis_runtime_contracts_node.js`, add this function after `assertFinalReplayParity()`:

```js
function replayFinalSerializedLevel(testName, source, inputs, options = {}) {
    ensureRuntimeLoaded();
    const targetLevel = options.targetLevel === undefined ? 0 : options.targetLevel;
    const randomSeed = options.randomSeed === undefined ? null : options.randomSeed;
    const previousUnitTesting = unitTesting;
    const previousLazyFunctionGeneration = lazyFunctionGeneration;
    unitTesting = true;
    lazyFunctionGeneration = false;
    try {
        compileSimulationSource(testName, source, targetLevel, randomSeed);
        for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
            const inputToken = inputs[inputIndex];
            executeInputToken(inputToken);
            drainAgain(`${testName}: fixture generation input ${inputIndex} ${tokenLabel(inputToken)}`);
        }
        return convertLevelToString();
    } finally {
        unitTesting = previousUnitTesting;
        lazyFunctionGeneration = previousLazyFunctionGeneration;
    }
}
```

In the `module.exports` object, add:

```js
    replayFinalSerializedLevel,
```

- [ ] **Step 3: Import runtime replay helpers in the fixture runner**

At the top of `src/tests/static_analysis_testdata_runner.js`, add:

```js
const {
    replayFinalSerializedLevel,
    runSimulationWithStaticChecks,
} = require('./run_static_analysis_runtime_contracts_node');
```

- [ ] **Step 4: Add runtime contract constants and helpers**

After `const FIXTURE_SCHEMA = 'ps-static-analysis-testdata-v1';`, add:

```js
const RUNTIME_CONTRACT_DEFAULT_INPUTS = ['tick'];
const RUNTIME_CONTRACT_EXPECT_FIELDS = [
    'staticObjectCount',
    'staticLayerCount',
    'inertLayerCount',
    'constantQuantityObjectCount',
    'temporaryObjectCount',
    'neverAppearsObjectCount',
    'cosmeticObjectCount',
    'cosmeticRuleCount',
    'inertCommandRuleCount',
    'mergeAliasCount',
    'objectBoundaryChecks',
    'staticLayerBoundaryChecks',
    'inertLayerBoundaryChecks',
    'quantityBoundaryChecks',
    'temporaryBoundaryChecks',
    'neverAppearsBoundaryChecks',
    'cosmeticProjectionChecks',
    'cosmeticRuleProjectionChecks',
    'cosmeticRuleOptimizerProjectionChecks',
    'inertCommandRuleSuppressionChecks',
    'mergeProjectionChecks',
    'winflowBoundaryChecks',
    'winflowCleanWinconditionChecks',
    'actionUnnecessaryBoundaryChecks',
    'tickNoopBoundaryChecks',
    'noAgainBoundaryChecks',
    'noRandomReplayChecks',
    'actionUnnecessaryProved',
    'tickNoopProved',
    'noAgainProved',
    'noRandomProved',
];
```

- [ ] **Step 5: Add runtime contract builder and validator functions**

Before `function runStaticAnalysisTestdata(options = {})`, add:

```js
function normalizeRuntimeContractInputs(payload) {
    if (payload && payload.inputs !== undefined) {
        assert.ok(Array.isArray(payload.inputs), 'runtime_contracts inputs must be an array');
        return payload.inputs.slice();
    }
    return RUNTIME_CONTRACT_DEFAULT_INPUTS.slice();
}

function runtimeContractDataArray(source, payload) {
    const inputs = normalizeRuntimeContractInputs(payload);
    return [
        source,
        inputs,
        payload.expectedFinalLevel,
        payload.targetLevel === undefined ? 0 : payload.targetLevel,
        payload.randomSeed === undefined ? null : payload.randomSeed,
        payload.expectedSounds === undefined ? null : payload.expectedSounds,
    ];
}

function runtimeContractExpectationSubset(result, requestedExpect = null) {
    const fields = requestedExpect ? Object.keys(requestedExpect) : RUNTIME_CONTRACT_EXPECT_FIELDS;
    const out = {};
    for (const fieldName of fields) {
        assert.ok(
            RUNTIME_CONTRACT_EXPECT_FIELDS.includes(fieldName),
            `runtime_contracts expect contains unsupported field ${JSON.stringify(fieldName)}`
        );
        assert.ok(
            Object.prototype.hasOwnProperty.call(result, fieldName),
            `runtime contract result missing field ${JSON.stringify(fieldName)}`
        );
        out[fieldName] = result[fieldName];
    }
    return out;
}

function buildRuntimeContractExpectations(source, testName, seedPayload = {}) {
    const inputs = normalizeRuntimeContractInputs(seedPayload);
    const targetLevel = seedPayload.targetLevel === undefined ? 0 : seedPayload.targetLevel;
    const randomSeed = seedPayload.randomSeed === undefined ? null : seedPayload.randomSeed;
    const expectedFinalLevel = seedPayload.expectedFinalLevel === undefined
        ? replayFinalSerializedLevel(testName, source, inputs, { targetLevel, randomSeed })
        : seedPayload.expectedFinalLevel;
    const payload = {
        schema: FIXTURE_SCHEMA,
        inputs,
        expectedFinalLevel,
    };
    if (seedPayload.targetLevel !== undefined) payload.targetLevel = seedPayload.targetLevel;
    if (seedPayload.randomSeed !== undefined) payload.randomSeed = seedPayload.randomSeed;
    if (seedPayload.expectedSounds !== undefined) payload.expectedSounds = seedPayload.expectedSounds;

    const result = runSimulationWithStaticChecks(testName, runtimeContractDataArray(source, payload));
    payload.expect = runtimeContractExpectationSubset(result, seedPayload.expect || null);
    return payload;
}

function validateRuntimeContractFixtureShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    assert.ok(Array.isArray(payload.inputs), `${filePath}: inputs must be an array`);
    for (const [index, input] of payload.inputs.entries()) {
        assert.ok(
            typeof input === 'string' || Number.isInteger(input),
            `${filePath}: inputs[${index}] must be a string token or integer input code`
        );
    }
    assert.ok(typeof payload.expectedFinalLevel === 'string', `${filePath}: expectedFinalLevel must be a string`);
    if (payload.targetLevel !== undefined) {
        assert.ok(Number.isInteger(payload.targetLevel) && payload.targetLevel >= 0, `${filePath}: targetLevel must be a non-negative integer`);
    }
    if (payload.randomSeed !== undefined) {
        assert.ok(Number.isInteger(payload.randomSeed), `${filePath}: randomSeed must be an integer`);
    }
    if (payload.expectedSounds !== undefined) {
        assert.ok(Array.isArray(payload.expectedSounds), `${filePath}: expectedSounds must be an array`);
    }
    assert.ok(payload.expect && typeof payload.expect === 'object' && !Array.isArray(payload.expect), `${filePath}: expect must be an object`);
    for (const fieldName of Object.keys(payload.expect)) {
        assert.ok(RUNTIME_CONTRACT_EXPECT_FIELDS.includes(fieldName), `${filePath}: unsupported expect field ${fieldName}`);
    }
}

function checkRuntimeContractFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'runtime_contracts'), payload);
    validateRuntimeContractFixtureShape(jsonPath, payload);
    const result = runSimulationWithStaticChecks(path.basename(txtPath, '.txt'), runtimeContractDataArray(source, payload));
    const actual = runtimeContractExpectationSubset(result, payload.expect);
    assert.deepStrictEqual(actual, payload.expect, `${jsonPath}: expect mismatch`);
}

function runRuntimeContractsDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
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
            writeJson(jsonPath, buildRuntimeContractExpectations(source, stem, {
                inputs: RUNTIME_CONTRACT_DEFAULT_INPUTS,
            }));
            log(`generated static analysis testdata: runtime_contracts/${stem}.json (review before committing)\n`);
        }
        checkRuntimeContractFixture(txtPath, jsonPath, claimDescriptions);
    }
}
```

- [ ] **Step 6: Wire the runtime contract directory into the main runner**

In `runStaticAnalysisTestdata()`, after `runMovementActionDir(...)`, add:

```js
    const runtimeContractsDir = path.join(root, 'runtime_contracts');
    assert.ok(fs.existsSync(runtimeContractsDir), `${runtimeContractsDir}: missing runtime_contracts testdata directory`);
    runRuntimeContractsDir(runtimeContractsDir, claimDescriptions, options.log);
```

In `module.exports`, add:

```js
    buildRuntimeContractExpectations,
    runRuntimeContractsDir,
```

- [ ] **Step 7: Add the runtime contract fixture schema**

In `src/tests/static_analysis_claim_descriptions.json`, add this object to the `fixtureSchemas` array after the `movement_action` schema object:

```json
{
  "name": "runtime_contracts",
  "description": "Fixtures for focused static-analysis runtime replay contracts.",
  "specification": "Each runtime_contracts fixture contains replay metadata plus selected summary fields returned by runSimulationWithStaticChecks().",
  "fields": [
    {
      "name": "schema",
      "type": "string",
      "description": "Fixture format version.",
      "specification": "Must be ps-static-analysis-testdata-v1."
    },
    {
      "name": "inputs",
      "type": "array",
      "description": "Replay input sequence.",
      "specification": "Each input is either a token string such as tick, up, down, left, right, or action, or an integer engine input code."
    },
    {
      "name": "targetLevel",
      "type": "integer",
      "description": "Optional zero-based level index to load before replay.",
      "specification": "When omitted, runtime contract fixtures load level 0."
    },
    {
      "name": "randomSeed",
      "type": "integer",
      "description": "Optional replay random seed.",
      "specification": "When omitted, the runtime contract replay uses the default deterministic test seed behavior."
    },
    {
      "name": "expectedSounds",
      "type": "array",
      "description": "Optional expected sound history.",
      "specification": "When present, compared by runSimulationWithStaticChecks() after replay."
    },
    {
      "name": "expectedFinalLevel",
      "type": "string",
      "description": "Expected final serialized level after replay.",
      "specification": "Compared exactly with convertLevelToString() after all inputs and AGAIN draining."
    },
    {
      "name": "expect",
      "type": "object",
      "description": "Selected runtime contract summary fields to assert.",
      "specification": "Only listed fields are compared, so fixtures should keep this object focused on the regression they protect.",
      "fields": [
        { "name": "staticObjectCount", "type": "integer", "description": "Number of static objects.", "specification": "Matches runSimulationWithStaticChecks().staticObjectCount." },
        { "name": "staticLayerCount", "type": "integer", "description": "Number of static layers.", "specification": "Matches runSimulationWithStaticChecks().staticLayerCount." },
        { "name": "inertLayerCount", "type": "integer", "description": "Number of inert layers.", "specification": "Matches runSimulationWithStaticChecks().inertLayerCount." },
        { "name": "constantQuantityObjectCount", "type": "integer", "description": "Number of constant-quantity objects.", "specification": "Matches runSimulationWithStaticChecks().constantQuantityObjectCount." },
        { "name": "temporaryObjectCount", "type": "integer", "description": "Number of temporary objects.", "specification": "Matches runSimulationWithStaticChecks().temporaryObjectCount." },
        { "name": "neverAppearsObjectCount", "type": "integer", "description": "Number of objects proved absent from levels and never created.", "specification": "Matches runSimulationWithStaticChecks().neverAppearsObjectCount." },
        { "name": "cosmeticObjectCount", "type": "integer", "description": "Number of projectable cosmetic objects.", "specification": "Matches runSimulationWithStaticChecks().cosmeticObjectCount." },
        { "name": "cosmeticRuleCount", "type": "integer", "description": "Number of cosmetic rules eligible for runtime checks.", "specification": "Matches runSimulationWithStaticChecks().cosmeticRuleCount." },
        { "name": "inertCommandRuleCount", "type": "integer", "description": "Number of inert command rules eligible for suppression checks.", "specification": "Matches runSimulationWithStaticChecks().inertCommandRuleCount." },
        { "name": "mergeAliasCount", "type": "integer", "description": "Number of merge aliases used by runtime checks.", "specification": "Matches runSimulationWithStaticChecks().mergeAliasCount." },
        { "name": "objectBoundaryChecks", "type": "integer", "description": "Static object boundary checks executed.", "specification": "Matches runSimulationWithStaticChecks().objectBoundaryChecks." },
        { "name": "staticLayerBoundaryChecks", "type": "integer", "description": "Static layer boundary checks executed.", "specification": "Matches runSimulationWithStaticChecks().staticLayerBoundaryChecks." },
        { "name": "inertLayerBoundaryChecks", "type": "integer", "description": "Inert layer boundary checks executed.", "specification": "Matches runSimulationWithStaticChecks().inertLayerBoundaryChecks." },
        { "name": "quantityBoundaryChecks", "type": "integer", "description": "Quantity boundary checks executed.", "specification": "Matches runSimulationWithStaticChecks().quantityBoundaryChecks." },
        { "name": "temporaryBoundaryChecks", "type": "integer", "description": "Temporary object boundary checks executed.", "specification": "Matches runSimulationWithStaticChecks().temporaryBoundaryChecks." },
        { "name": "neverAppearsBoundaryChecks", "type": "integer", "description": "Never-appears boundary checks executed.", "specification": "Matches runSimulationWithStaticChecks().neverAppearsBoundaryChecks." },
        { "name": "cosmeticProjectionChecks", "type": "integer", "description": "Cosmetic projection checks executed.", "specification": "Matches runSimulationWithStaticChecks().cosmeticProjectionChecks." },
        { "name": "cosmeticRuleProjectionChecks", "type": "integer", "description": "Cosmetic rule suppression checks executed.", "specification": "Matches runSimulationWithStaticChecks().cosmeticRuleProjectionChecks." },
        { "name": "cosmeticRuleOptimizerProjectionChecks", "type": "integer", "description": "Cosmetic rule optimizer checks executed.", "specification": "Matches runSimulationWithStaticChecks().cosmeticRuleOptimizerProjectionChecks." },
        { "name": "inertCommandRuleSuppressionChecks", "type": "integer", "description": "Inert command suppression checks executed.", "specification": "Matches runSimulationWithStaticChecks().inertCommandRuleSuppressionChecks." },
        { "name": "mergeProjectionChecks", "type": "integer", "description": "Merge projection checks executed.", "specification": "Matches runSimulationWithStaticChecks().mergeProjectionChecks." },
        { "name": "winflowBoundaryChecks", "type": "integer", "description": "Winflow boundary checks executed.", "specification": "Matches runSimulationWithStaticChecks().winflowBoundaryChecks." },
        { "name": "winflowCleanWinconditionChecks", "type": "integer", "description": "Winflow clean win-condition checks executed.", "specification": "Matches runSimulationWithStaticChecks().winflowCleanWinconditionChecks." },
        { "name": "actionUnnecessaryBoundaryChecks", "type": "integer", "description": "Action-unnecessary boundary probes executed.", "specification": "Matches runSimulationWithStaticChecks().actionUnnecessaryBoundaryChecks." },
        { "name": "tickNoopBoundaryChecks", "type": "integer", "description": "Tick-noop boundary probes executed.", "specification": "Matches runSimulationWithStaticChecks().tickNoopBoundaryChecks." },
        { "name": "noAgainBoundaryChecks", "type": "integer", "description": "No-again boundary checks executed.", "specification": "Matches runSimulationWithStaticChecks().noAgainBoundaryChecks." },
        { "name": "noRandomReplayChecks", "type": "integer", "description": "No-random replay checks executed.", "specification": "Matches runSimulationWithStaticChecks().noRandomReplayChecks." },
        { "name": "actionUnnecessaryProved", "type": "boolean", "description": "Whether action_unnecessary was proved.", "specification": "Matches runSimulationWithStaticChecks().actionUnnecessaryProved." },
        { "name": "tickNoopProved", "type": "boolean", "description": "Whether no autonomous tick rules were proved.", "specification": "Matches runSimulationWithStaticChecks().tickNoopProved." },
        { "name": "noAgainProved", "type": "boolean", "description": "Whether no AGAIN rules were proved.", "specification": "Matches runSimulationWithStaticChecks().noAgainProved." },
        { "name": "noRandomProved", "type": "boolean", "description": "Whether no random behavior was proved.", "specification": "Matches runSimulationWithStaticChecks().noRandomProved." }
      ]
    }
  ]
}
```

- [ ] **Step 8: Create the runtime contract directory**

Run:

```sh
mkdir -p src/tests/static_analysis_testdata/runtime_contracts
```

- [ ] **Step 9: Run the failing test again and verify it passes**

Run:

```sh
node src/tests/static_analysis_testdata_runner_node.js
```

Expected: `static_analysis_testdata_runner_node: ok`

- [ ] **Step 10: Run the full static-analysis fixture runner**

Run:

```sh
make static_analysis_tests
```

Expected: the existing fixture families pass and the runner prints `static_analysis_testdata_runner: ok`.

- [ ] **Step 11: Commit runtime contract runner support**

Only stage the runtime-contract runner support files:

```sh
git add src/tests/run_static_analysis_runtime_contracts_node.js \
  src/tests/static_analysis_testdata_runner.js \
  src/tests/static_analysis_testdata_runner_node.js \
  src/tests/static_analysis_claim_descriptions.json \
  src/tests/static_analysis_testdata/runtime_contracts
git commit -m "feat: add runtime contract testdata fixtures"
```

---

### Task 3: Document Fixture Duplication And Runtime Contracts

**Files:**
- Modify: `src/tests/static_analysis_testdata/README.md`
- Create: `src/tests/static_analysis_testdata/regressions.md`

- [ ] **Step 1: Add README guidance for duplicate multi-family fixtures**

In `src/tests/static_analysis_testdata/README.md`, after the opening paragraph that explains `.txt` and `.json` files, add:

```markdown
Some regressions deliberately appear in multiple family directories. That
duplication is preferred when a small PuzzleScript source protects several
independent analyses: each family stays browseable on its own, and
`regressions.md` links the duplicated fixture stems for readers who want the bug
story.
```

- [ ] **Step 2: Add README guidance for runtime contract fixtures**

Before `## Review Policy`, add:

```markdown
## Adding A Runtime-Contract Test

1. Add a small whole-source `.txt` file under `runtime_contracts/`.
2. Run `make static_analysis_tests`.
3. The runner will create a matching `.json` file using a default `["tick"]`
   replay and the observed final serialized level.
4. If the fixture needs a different replay, edit the JSON `inputs`,
   `targetLevel`, `randomSeed`, `expectedSounds`, and `expectedFinalLevel`,
   then rerun `make static_analysis_tests`.
5. Trim the `expect` object to the summary fields the fixture is meant to
   protect.

Runtime-contract fixtures call `runSimulationWithStaticChecks()`. They are for
small specimens that need runtime evidence for static-analysis claims, not for
large corpus replays.
```

- [ ] **Step 3: Create the human regression index**

Create `src/tests/static_analysis_testdata/regressions.md` with:

```markdown
# Static Analysis Regression Index

This file links duplicated family fixtures that belong to the same bug story.
It is not read by the test runner.

## Property Inferred Overwrite

`[ Thing ] -> [ Thing ObjA ]` must not treat `Thing` as preserved on the
`ObjA, ObjB` collision layer, because the explicit `ObjA` RHS term can overwrite
an initial `ObjB`.

- `object_tags/property-inferred-overwrite.*`
- `rule_tags/property-inferred-overwrite.*`
- `winflow/property-inferred-overwrite.*`
- `movement_action/property-inferred-overwrite-action.*`
- `runtime_contracts/property-inferred-overwrite.*`
```

- [ ] **Step 4: Run fixture runner**

Run:

```sh
make static_analysis_tests
```

Expected: `static_analysis_testdata_runner: ok`

- [ ] **Step 5: Commit documentation**

```sh
git add src/tests/static_analysis_testdata/README.md \
  src/tests/static_analysis_testdata/regressions.md
git commit -m "docs: explain static analysis regression fixtures"
```

---

### Task 4: Move Property Inferred Overwrite Into Family Fixtures

**Files:**
- Create: property inferred overwrite fixture files listed in File Structure
- Modify: `src/tests/ps_static_analysis_node.js`
- Modify: `src/tests/run_static_analysis_runtime_contracts_node_test.js`

- [ ] **Step 1: Create the shared base source in `object_tags/`, `rule_tags/`, `winflow/`, and `runtime_contracts/`**

Use this exact source for:

- `src/tests/static_analysis_testdata/object_tags/property-inferred-overwrite.txt`
- `src/tests/static_analysis_testdata/rule_tags/property-inferred-overwrite.txt`
- `src/tests/static_analysis_testdata/runtime_contracts/property-inferred-overwrite.txt`

```text
title Property inferred overwrite
========
OBJECTS
========
Background
black
Player
white
ObjA
red
ObjB
blue
=======
LEGEND
=======
. = Background
P = Player
x = ObjA
y = ObjB
Thing = ObjA or ObjB
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Player
ObjA, ObjB
=====
RULES
=====
[ Thing ] -> [ Thing ObjA ]
=============
WINCONDITIONS
=============
Some Player
======
LEVELS
======
Py
```

Use the same source for `src/tests/static_analysis_testdata/winflow/property-inferred-overwrite.txt`, except line 37 must be:

```text
Some ObjB
```

- [ ] **Step 2: Create the action variant source**

Create `src/tests/static_analysis_testdata/movement_action/property-inferred-overwrite-action.txt` with:

```text
title Property inferred overwrite action
========
OBJECTS
========
Background
black
Player
white
ObjA
red
ObjB
blue
=======
LEGEND
=======
. = Background
P = Player
x = ObjA
y = ObjB
Thing = ObjA or ObjB
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Player
ObjA, ObjB
=====
RULES
=====
[ action Player ] [ Thing ] -> [ Player ] [ Thing ObjA ]
=============
WINCONDITIONS
=============
Some ObjB
======
LEVELS
======
Py
```

- [ ] **Step 3: Create the object-tag expectation JSON**

Create `src/tests/static_analysis_testdata/object_tags/property-inferred-overwrite.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "objectTag": [
    {
      "object": "ObjA",
      "created_by_rules": true,
      "static": false,
      "quantity_never_increases": false,
      "quantity_never_decreases": true
    },
    {
      "object": "ObjB",
      "destroyed_by_rules": true,
      "static": false,
      "quantity_never_increases": true,
      "quantity_never_decreases": false
    }
  ]
}
```

- [ ] **Step 4: Create the rule-tag expectation JSON**

Create `src/tests/static_analysis_testdata/rule_tags/property-inferred-overwrite.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "ruleTag": [
    {
      "line": 33,
      "text": "[ Thing ] -> [ Thing ObjA ]",
      "tags": {
        "objects_written": ["ObjA"],
        "objects_erased": ["ObjB"]
      }
    }
  ]
}
```

- [ ] **Step 5: Create the winflow expectation JSON**

Create `src/tests/static_analysis_testdata/winflow/property-inferred-overwrite.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "wakeEdges": [
    {
      "from_line": 33,
      "from_text": "[ Thing ] -> [ Thing ObjA ]",
      "to_line": 37,
      "to_text": "Some ObjB",
      "reasons": ["object_absence"]
    }
  ]
}
```

- [ ] **Step 6: Create the movement-action expectation JSON**

Create `src/tests/static_analysis_testdata/movement_action/property-inferred-overwrite-action.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "actionInput": true,
  "actionUnnecessary": false,
  "actionUnnecessaryBlockers": ["action_may_mutate_objects", "reads_action"],
  "actionUnnecessaryBlockerRuleIds": ["early_group_0_rule_0"],
  "actionUnnecessaryChangedObjects": ["ObjA", "ObjB"],
  "movements_reachable_from_action_input": ["Player:action"]
}
```

- [ ] **Step 7: Create the runtime-contract expectation JSON**

Create `src/tests/static_analysis_testdata/runtime_contracts/property-inferred-overwrite.json`:

```json
{
  "schema": "ps-static-analysis-testdata-v1",
  "inputs": ["tick"],
  "expectedFinalLevel": "background player:0,background obja:1,\n",
  "expect": {
    "neverAppearsObjectCount": 0
  }
}
```

- [ ] **Step 8: Run fixture runner and fix only generated expectation mismatches**

Run:

```sh
make static_analysis_tests
```

Expected: PASS. If a fixture fails because a hand-written expectation differs from generated analyzer output, inspect the generated analyzer output before changing the expectation. Do not weaken the expectation unless the implementation has proved the hand-written expectation is wrong.

- [ ] **Step 9: Remove migrated inline static-analysis assertions**

In `src/tests/ps_static_analysis_node.js`, remove the block that starts with:

```js
const PROPERTY_INFERRED_OVERWRITE_GAME = `
```

and ends with:

```js
assert.ok(propertyInferredOverwriteActionUnnecessary.blockers.includes('action_may_mutate_objects'));
```

Do not remove `PROPERTY_BINDING_SPAWN_GAME`; it protects the separate ambiguous property RHS write regression.

- [ ] **Step 10: Remove migrated inline runtime-contract assertion**

In `src/tests/run_static_analysis_runtime_contracts_node_test.js`, remove the block that starts with:

```js
const propertyInferredOverwriteBoundarySource = [
```

and ends with:

```js
);
```

where the assertion message is:

```text
same-cell property overwrites should not prove never-appears for objects created by an explicit same-layer RHS write
```

- [ ] **Step 11: Run focused tests**

Run:

```sh
make static_analysis_tests
node src/tests/ps_static_analysis_node.js
node src/tests/run_static_analysis_runtime_contracts_node_test.js
```

Expected:

- `static_analysis_testdata_runner: ok`
- `ps_static_analysis_node: ok`
- `run_static_analysis_runtime_contracts_node_test: ok`

- [ ] **Step 12: Commit fixture migration**

```sh
git add src/tests/static_analysis_testdata/object_tags/property-inferred-overwrite.txt \
  src/tests/static_analysis_testdata/object_tags/property-inferred-overwrite.json \
  src/tests/static_analysis_testdata/rule_tags/property-inferred-overwrite.txt \
  src/tests/static_analysis_testdata/rule_tags/property-inferred-overwrite.json \
  src/tests/static_analysis_testdata/winflow/property-inferred-overwrite.txt \
  src/tests/static_analysis_testdata/winflow/property-inferred-overwrite.json \
  src/tests/static_analysis_testdata/movement_action/property-inferred-overwrite-action.txt \
  src/tests/static_analysis_testdata/movement_action/property-inferred-overwrite-action.json \
  src/tests/static_analysis_testdata/runtime_contracts/property-inferred-overwrite.txt \
  src/tests/static_analysis_testdata/runtime_contracts/property-inferred-overwrite.json \
  src/tests/ps_static_analysis_node.js \
  src/tests/run_static_analysis_runtime_contracts_node_test.js
git commit -m "test: move property overwrite regression to fixtures"
```

---

### Task 5: Final Verification

**Files:**
- No planned code changes

- [ ] **Step 1: Run static-analysis fixture and focused invariant tests**

Run:

```sh
make static_analysis_tests
node src/tests/ps_static_analysis_node.js
node src/tests/run_static_analysis_runtime_contracts_node_test.js
node src/tests/run_static_analysis_runtime_contracts_node.js --filter "super tricky"
```

Expected:

- `static_analysis_testdata_runner: ok`
- `ps_static_analysis_node: ok`
- `run_static_analysis_runtime_contracts_node_test: ok`
- `static_analysis_runtime_contracts: ok` for the `super tricky` filtered case

- [ ] **Step 2: Run canonicalizer tests if canonicalizer files are dirty on this branch**

Run:

```sh
node src/tests/canonicalizer_node.js
```

Expected:

```text
canonicalizer_node: ok
```

- [ ] **Step 3: Run whitespace check**

Run:

```sh
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 4: Optional broad runner**

Run:

```sh
node src/tests/run_tests_node.js
```

Expected in the current repository state: 741 passed, 1 failed, with the existing `Voitex Rasteriser 2 [2nd Demake of Vertex Dispenser Puzzle Mode]` failure. If any additional failure appears, stop and investigate before finalizing.

- [ ] **Step 5: Inspect final diff**

Run:

```sh
git status --short
git diff --stat
```

Expected: only files from this fixture refactor plus any pre-existing invariant/canonicalizer changes that were intentionally left in the worktree.

- [ ] **Step 6: Commit verification-only cleanup if needed**

If verification required small follow-up fixes, commit them:

```sh
git add <changed fixture-refactor files>
git commit -m "fix: stabilize static analysis fixture refactor"
```

If no follow-up fixes were needed, do not create an empty commit.
