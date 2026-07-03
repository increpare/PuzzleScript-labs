#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { analyzeSource } = require('./ps_static_analysis');
const {
    replayFinalSerializedLevel,
    runSimulationWithStaticChecks,
} = require('./run_static_analysis_runtime_contracts_node');
const {
    CLAIM_DESCRIPTIONS_PATH,
    FIXTURE_SCHEMA,
    assertFixtureFieldsDocumented,
    assertSameStringSet,
    assertStringArray,
    fieldByName,
    fixtureFieldsAtPath,
    fixtureSchemaByName,
    formatFixtureJson,
    loadClaimDescriptions,
    readJson,
    writeJson,
} = require('./static_analysis_testdata_runner/fixture_utils');
const {
    allRuleRecords,
    assertRuleRecordsIdempotent,
    compareAgainRows,
    compareEdgeRows,
    compareRuleLocatorEdges,
    compareRuleLocators,
    findRuleRecord,
    recordById,
    ruleLocator,
} = require('./static_analysis_testdata_runner/rule_records');

const TESTDATA_ROOT = path.join(__dirname, 'static_analysis_testdata');
const RUNTIME_CONTRACT_DEFAULT_INPUTS = ['TICK'];
const RUNTIME_CONTRACT_INPUT_TOKENS = new Set([
    'U',
    'UP',
    'L',
    'LEFT',
    'D',
    'DOWN',
    'R',
    'RIGHT',
    'A',
    'ACTION',
    'UNDO',
    'RESTART',
    'TICK',
]);
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

function propertyMembers(psTagged, canonicalName) {
    const property = (psTagged.properties || []).find(item =>
        item.canonical_name === canonicalName || String(item.name).toLowerCase() === canonicalName
    );
    return property ? new Set(property.members || []) : null;
}

function roleObjectNames(psTagged, canonicalName) {
    const fromProperty = propertyMembers(psTagged, canonicalName);
    if (fromProperty) return fromProperty;
    const object = (psTagged.objects || []).find(item =>
        item.canonical_name === canonicalName || String(item.name).toLowerCase() === canonicalName
    );
    return new Set(object ? [object.name] : []);
}

function deriveLevelPresence(object) {
    const tags = object.tags || {};
    if (tags.present_in_all_levels) return 'all';
    if (tags.present_in_some_levels) return 'some';
    return 'none';
}

function deriveObjectTagValue(report, object, tagName) {
    const psTagged = report.ps_tagged || {};
    if (tagName === 'is_player') {
        return roleObjectNames(psTagged, 'player').has(object.name);
    }
    if (tagName === 'is_background') {
        return roleObjectNames(psTagged, 'background').has(object.name);
    }
    if (tagName === 'level_presence') {
        return deriveLevelPresence(object);
    }
    if (tagName === 'created_by_rules') {
        return !!((object.tags || {}).may_be_created);
    }
    if (tagName === 'destroyed_by_rules') {
        return !!((object.tags || {}).may_be_destroyed);
    }
    if (tagName === 'quantity_never_increases') {
        return !!(object.tags && object.tags.quantity && object.tags.quantity.never_increases);
    }
    if (tagName === 'quantity_never_decreases') {
        return !!(object.tags && object.tags.quantity && object.tags.quantity.never_decreases);
    }
    return !!((object.tags || {})[tagName]);
}

function buildObjectTagExpectations(report, claimDescriptions) {
    const objectTags = fixtureFieldsAtPath(fixtureSchemaByName(claimDescriptions, 'object_tags'), ['objectTag'])
        .filter(field => field.name !== 'object');
    const objectTag = [];
    for (const object of (report.ps_tagged && report.ps_tagged.objects) || []) {
        const row = { object: object.name };
        for (const tag of objectTags) {
            row[tag.name] = deriveObjectTagValue(report, object, tag.name);
        }
        objectTag.push(row);
    }
    return {
        schema: FIXTURE_SCHEMA,
        human_verified: false,
        objectTag,
    };
}

function objectByName(report, objectName) {
    return ((report.ps_tagged && report.ps_tagged.objects) || []).find(object => object.name === objectName) || null;
}

function claimByName(claimDescriptions, tagName) {
    return fieldByName(
        fixtureFieldsAtPath(fixtureSchemaByName(claimDescriptions, 'object_tags'), ['objectTag']),
        tagName
    );
}

function validateExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    assert.ok(Array.isArray(payload.objectTag), `${filePath}: objectTag must be an array`);
    for (const [index, item] of payload.objectTag.entries()) {
        assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${filePath}: objectTag[${index}] must be an object`);
        assert.ok(typeof item.object === 'string' && item.object.length > 0, `${filePath}: objectTag[${index}] missing object`);
        for (const tagName of Object.keys(item)) {
            assert.ok(tagName === 'object' || tagName.length > 0, `${filePath}: objectTag[${index}] has an empty tag name`);
        }
    }
}

function checkObjectTagExpectation(filePath, report, claimDescriptions, row, tagName) {
    const claim = claimByName(claimDescriptions, tagName);
    assert.ok(claim, `${filePath}: unknown object tag ${tagName}`);

    const object = objectByName(report, row.object);
    if (!object) {
        const available = ((report.ps_tagged && report.ps_tagged.objects) || []).map(item => item.name).join(', ');
        assert.fail(`${filePath}: unknown object ${row.object}; available objects: ${available}`);
    }

    const expected = row[tagName];
    if (claim.values) {
        assert.ok(claim.values.includes(expected), `${filePath}: ${tagName} expected value must be one of ${claim.values.join(', ')}`);
    } else {
        assert.strictEqual(typeof expected, 'boolean', `${filePath}: ${tagName} expected value must be boolean`);
    }

    const actual = deriveObjectTagValue(report, object, tagName);
    if (actual !== expected) {
        assert.fail([
            `${filePath}`,
            `objectTag ${row.object}.${tagName} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
            `  object: ${object.name} id=${object.id} layer=${object.layer}`,
        ].join('\n'));
    }
}

function checkFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'object_tags'), payload);
    validateExpectationShape(jsonPath, payload);
    for (const row of payload.objectTag) {
        for (const tagName of Object.keys(row)) {
            if (tagName !== 'object') checkObjectTagExpectation(jsonPath, report, claimDescriptions, row, tagName);
        }
    }
}

function ruleClaimByName(claimDescriptions, tagName) {
    return fieldByName(
        fixtureFieldsAtPath(fixtureSchemaByName(claimDescriptions, 'rule_tags'), ['ruleTag', 'tags']),
        tagName
    );
}

function deriveRuleTagValue(rule, tagName) {
    const value = rule.tags ? rule.tags[tagName] : undefined;
    return Array.isArray(value) ? value.slice() : [];
}

function deriveRuleTagBooleanValue(rule, tagName) {
    const value = rule.tags ? rule.tags[tagName] : undefined;
    return typeof value === 'boolean' ? value : false;
}

function buildRuleTagExpectations(source, report, claimDescriptions) {
    const ruleTags = fixtureFieldsAtPath(fixtureSchemaByName(claimDescriptions, 'rule_tags'), ['ruleTag', 'tags']);
    const records = allRuleRecords(report, source);
    assertRuleRecordsIdempotent(report.source.path, records);
    return {
        schema: FIXTURE_SCHEMA,
        human_verified: false,
        ruleTag: records.map(record => ({
            line: record.line,
            text: record.text,
            tags: Object.fromEntries(ruleTags.map(tag => [
                tag.name,
                tag.type === 'boolean'
                    ? deriveRuleTagBooleanValue(record.rule, tag.name)
                    : deriveRuleTagValue(record.rule, tag.name),
            ])),
        })),
    };
}

function validateRuleTagExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    assert.ok(Array.isArray(payload.ruleTag), `${filePath}: ruleTag must be an array`);
    for (const [index, item] of payload.ruleTag.entries()) {
        assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${filePath}: ruleTag[${index}] must be an object`);
        assert.ok(Number.isInteger(item.line) && item.line > 0, `${filePath}: ruleTag[${index}] missing positive integer line`);
        assert.ok(typeof item.text === 'string' && item.text.length > 0, `${filePath}: ruleTag[${index}] missing text`);
        assert.ok(item.tags && typeof item.tags === 'object' && !Array.isArray(item.tags), `${filePath}: ruleTag[${index}] missing tags object`);
    }
}

function checkRuleTagExpectation(filePath, record, claimDescriptions, tags, tagName) {
    const claim = ruleClaimByName(claimDescriptions, tagName);
    assert.ok(claim, `${filePath}: unknown rule tag ${tagName}`);
    const expected = tags[tagName];
    if (claim.type === 'boolean') {
        assert.ok(typeof expected === 'boolean', `${filePath}: ${tagName} expected value must be boolean`);
        const actual = deriveRuleTagBooleanValue(record.rule, tagName);
        assert.strictEqual(actual, expected, `${filePath}: ruleTag line ${record.line} ${record.text} ${tagName} expected ${expected}, got ${actual}`);
        return;
    }
    assertStringArray(filePath, tagName, expected);
    const actual = deriveRuleTagValue(record.rule, tagName);
    assertSameStringSet(filePath, `ruleTag line ${record.line} ${record.text} ${tagName}`, expected, actual);
}

function checkRuleFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'rule_tags'), payload);
    validateRuleTagExpectationShape(jsonPath, payload);
    const records = allRuleRecords(report, source);
    assertRuleRecordsIdempotent(txtPath, records);
    for (const row of payload.ruleTag) {
        const record = findRuleRecord(jsonPath, records, row);
        for (const tagName of Object.keys(row.tags)) {
            checkRuleTagExpectation(jsonPath, record, claimDescriptions, row.tags, tagName);
        }
    }
}

const REASON_VALUES = ['object_presence', 'object_absence', 'movement'];

function programFlowFactValue(report) {
    const facts = (report.facts && report.facts.program_flow) || [];
    if (facts.length === 0) return { rule_ids: [], wake_edges: [], again_rules: [], tick_restart_possible: false };
    return facts[0].value;
}

function buildProgramFlowExpectations(source, report) {
    const records = allRuleRecords(report, source);
    assertRuleRecordsIdempotent(report.source.path, records);
    const byId = recordById(records);
    const value = programFlowFactValue(report);
    const wakeEdges = value.wake_edges.map(edge => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        assert.ok(from, `program_flow edge from rule id ${edge.from} not found in records`);
        assert.ok(to, `program_flow edge to rule id ${edge.to} not found in records`);
        return {
            from_line: from.line,
            from_text: from.text,
            to_line: to.line,
            to_text: to.text,
            reasons: edge.reasons.slice(),
        };
    });
    wakeEdges.sort(compareEdgeRows);
    const againRules = value.again_rules.map(ruleId => {
        const record = byId.get(ruleId);
        assert.ok(record, `program_flow again rule id ${ruleId} not found in records`);
        return { line: record.line, text: record.text };
    });
    againRules.sort(compareAgainRows);
    return {
        schema: FIXTURE_SCHEMA,
        human_verified: false,
        wakeEdges,
        againRules,
    };
}

function validateProgramFlowExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    assert.ok(Array.isArray(payload.wakeEdges), `${filePath}: wakeEdges must be an array`);
    assert.ok(Array.isArray(payload.againRules), `${filePath}: againRules must be an array`);
    for (const [index, edge] of payload.wakeEdges.entries()) {
        assert.ok(edge && typeof edge === 'object' && !Array.isArray(edge), `${filePath}: wakeEdges[${index}] must be an object`);
        assert.ok(Number.isInteger(edge.from_line) && edge.from_line > 0, `${filePath}: wakeEdges[${index}] missing positive integer from_line`);
        assert.ok(typeof edge.from_text === 'string' && edge.from_text.length > 0, `${filePath}: wakeEdges[${index}] missing from_text`);
        assert.ok(Number.isInteger(edge.to_line) && edge.to_line > 0, `${filePath}: wakeEdges[${index}] missing positive integer to_line`);
        assert.ok(typeof edge.to_text === 'string' && edge.to_text.length > 0, `${filePath}: wakeEdges[${index}] missing to_text`);
        assert.ok(Array.isArray(edge.reasons) && edge.reasons.length > 0, `${filePath}: wakeEdges[${index}].reasons must be a non-empty array`);
        for (const reason of edge.reasons) {
            assert.ok(REASON_VALUES.includes(reason), `${filePath}: wakeEdges[${index}].reasons contains unknown reason ${JSON.stringify(reason)}`);
        }
    }
    for (const [index, row] of payload.againRules.entries()) {
        assert.ok(row && typeof row === 'object' && !Array.isArray(row), `${filePath}: againRules[${index}] must be an object`);
        assert.ok(Number.isInteger(row.line) && row.line > 0, `${filePath}: againRules[${index}] missing positive integer line`);
        assert.ok(typeof row.text === 'string' && row.text.length > 0, `${filePath}: againRules[${index}] missing text`);
    }
}

function checkProgramFlowFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'program_flow'), payload);
    validateProgramFlowExpectationShape(jsonPath, payload);
    const actual = buildProgramFlowExpectations(source, report);
    const expectedEdges = payload.wakeEdges.slice().sort(compareEdgeRows);
    const expectedAgain = payload.againRules.slice().sort(compareAgainRows);
    assert.deepStrictEqual(actual.wakeEdges, expectedEdges, `${jsonPath}: wakeEdges mismatch`);
    assert.deepStrictEqual(actual.againRules, expectedAgain, `${jsonPath}: againRules mismatch`);
}

function sortedFiles(dirPath, ext) {
    return fs.readdirSync(dirPath)
        .filter(name => name.endsWith(ext))
        .sort((left, right) => left.localeCompare(right));
}

function runObjectTagsDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
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
            writeJson(jsonPath, buildObjectTagExpectations(report, claimDescriptions));
            log(`generated static analysis testdata: object_tags/${stem}.json (review before committing)\n`);
        }
        checkFixture(txtPath, jsonPath, claimDescriptions);
    }
}

function runRuleTagsDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
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
            writeJson(jsonPath, buildRuleTagExpectations(source, report, claimDescriptions));
            log(`generated static analysis testdata: rule_tags/${stem}.json (review before committing)\n`);
        }
        checkRuleFixture(txtPath, jsonPath, claimDescriptions);
    }
}

function runProgramFlowDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
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
            writeJson(jsonPath, buildProgramFlowExpectations(source, report));
            log(`generated static analysis testdata: program_flow/${stem}.json (review before committing)\n`);
        }
        checkProgramFlowFixture(txtPath, jsonPath, claimDescriptions);
    }
}

function winflowFactValue(report) {
    const facts = (report.facts && report.facts.winflow) || [];
    if (facts.length === 0) return { rule_ids: [], win_ids: [], wake_edges: [] };
    return facts[0].value;
}

function buildWinflowExpectations(source, report) {
    const ruleRecords = allRuleRecords(report, source);
    assertRuleRecordsIdempotent(report.source.path, ruleRecords);
    const winRecords = allWinConditionRecords(report, source);
    const ruleById = recordById(ruleRecords);
    const winById = new Map(winRecords.map(r => [r.wincondition.id, r]));
    const value = winflowFactValue(report);
    const wakeEdges = value.wake_edges.map(edge => {
        const from = ruleById.get(edge.from);
        const to = winById.get(edge.to);
        assert.ok(from, `winflow edge from rule id ${edge.from} not found in records`);
        assert.ok(to, `winflow edge to win id ${edge.to} not found in records`);
        return {
            from_line: from.line,
            from_text: from.text,
            to_line: to.line,
            to_text: to.text,
            reasons: edge.reasons.slice(),
        };
    });
    wakeEdges.sort(compareEdgeRows);
    return { schema: FIXTURE_SCHEMA, human_verified: false, wakeEdges };
}

function validateWinflowExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    assert.ok(Array.isArray(payload.wakeEdges), `${filePath}: wakeEdges must be an array`);
    for (const [index, edge] of payload.wakeEdges.entries()) {
        assert.ok(edge && typeof edge === 'object' && !Array.isArray(edge), `${filePath}: wakeEdges[${index}] must be an object`);
        assert.ok(Number.isInteger(edge.from_line) && edge.from_line > 0, `${filePath}: wakeEdges[${index}] missing positive integer from_line`);
        assert.ok(typeof edge.from_text === 'string' && edge.from_text.length > 0, `${filePath}: wakeEdges[${index}] missing from_text`);
        assert.ok(Number.isInteger(edge.to_line) && edge.to_line > 0, `${filePath}: wakeEdges[${index}] missing positive integer to_line`);
        assert.ok(typeof edge.to_text === 'string' && edge.to_text.length > 0, `${filePath}: wakeEdges[${index}] missing to_text`);
        assert.ok(Array.isArray(edge.reasons) && edge.reasons.length > 0, `${filePath}: wakeEdges[${index}].reasons must be a non-empty array`);
        for (const reason of edge.reasons) {
            assert.ok(REASON_VALUES.includes(reason), `${filePath}: wakeEdges[${index}].reasons contains unknown reason ${JSON.stringify(reason)}`);
        }
    }
}

function checkWinflowFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'winflow'), payload);
    validateWinflowExpectationShape(jsonPath, payload);
    const actual = buildWinflowExpectations(source, report);
    const expectedEdges = payload.wakeEdges.slice().sort(compareEdgeRows);
    assert.deepStrictEqual(actual.wakeEdges, expectedEdges, `${jsonPath}: wakeEdges mismatch`);
}

function runWinflowDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
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
            writeJson(jsonPath, buildWinflowExpectations(source, report));
            log(`generated static analysis testdata: winflow/${stem}.json (review before committing)\n`);
        }
        checkWinflowFixture(txtPath, jsonPath, claimDescriptions);
    }
}

function allWinConditionRecords(report, source) {
    const sourceLines = source.split(/\r?\n/);
    return (report.ps_tagged && report.ps_tagged.winconditions || []).map(wincondition => {
        const text = (sourceLines[(wincondition.source_line || 1) - 1] || '').trim();
        return { wincondition, line: wincondition.source_line, text };
    });
}

function winConditionClaimByName(claimDescriptions, tagName) {
    return fieldByName(
        fixtureFieldsAtPath(fixtureSchemaByName(claimDescriptions, 'wincondition_tags'), ['winConditionTag', 'tags']),
        tagName
    );
}

function deriveWinConditionTagValue(wincondition, tagName) {
    const value = wincondition.tags ? wincondition.tags[tagName] : undefined;
    return Array.isArray(value) ? value.slice() : [];
}

function buildWinConditionTagExpectations(source, report, claimDescriptions) {
    const winConditionTags = fixtureFieldsAtPath(fixtureSchemaByName(claimDescriptions, 'wincondition_tags'), ['winConditionTag', 'tags']);
    const records = allWinConditionRecords(report, source);
    return {
        schema: FIXTURE_SCHEMA,
        human_verified: false,
        winConditionTag: records.map(record => ({
            line: record.line,
            text: record.text,
            tags: Object.fromEntries(winConditionTags.map(tag => [
                tag.name,
                deriveWinConditionTagValue(record.wincondition, tag.name),
            ])),
        })),
    };
}

function validateWinConditionTagExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    assert.ok(Array.isArray(payload.winConditionTag), `${filePath}: winConditionTag must be an array`);
    for (const [index, item] of payload.winConditionTag.entries()) {
        assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${filePath}: winConditionTag[${index}] must be an object`);
        assert.ok(Number.isInteger(item.line) && item.line > 0, `${filePath}: winConditionTag[${index}] missing positive integer line`);
        assert.ok(typeof item.text === 'string' && item.text.length > 0, `${filePath}: winConditionTag[${index}] missing text`);
        assert.ok(item.tags && typeof item.tags === 'object' && !Array.isArray(item.tags), `${filePath}: winConditionTag[${index}] missing tags object`);
    }
}

function findWinConditionRecord(filePath, records, expected) {
    const matches = records.filter(record => record.line === expected.line && record.text === expected.text);
    if (matches.length !== 1) {
        assert.fail(`${filePath}: winConditionTag line ${expected.line} text ${JSON.stringify(expected.text)} matched ${matches.length} analyzed win conditions; expected exactly 1`);
    }
    return matches[0];
}

function checkWinConditionFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'wincondition_tags'), payload);
    validateWinConditionTagExpectationShape(jsonPath, payload);
    const records = allWinConditionRecords(report, source);
    for (const row of payload.winConditionTag) {
        const record = findWinConditionRecord(jsonPath, records, row);
        for (const tagName of Object.keys(row.tags)) {
            const claim = winConditionClaimByName(claimDescriptions, tagName);
            assert.ok(claim, `${jsonPath}: unknown win condition tag ${tagName}`);
            assertStringArray(jsonPath, tagName, row.tags[tagName]);
            const actual = deriveWinConditionTagValue(record.wincondition, tagName);
            assertSameStringSet(jsonPath, `winConditionTag line ${record.line} ${record.text} ${tagName}`, row.tags[tagName], actual);
        }
    }
}

function runWinConditionTagsDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
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
            writeJson(jsonPath, buildWinConditionTagExpectations(source, report, claimDescriptions));
            log(`generated static analysis testdata: wincondition_tags/${stem}.json (review before committing)\n`);
        }
        checkWinConditionFixture(txtPath, jsonPath, claimDescriptions);
    }
}

// ─── mergeability ────────────────────────────────────────────────────────────

function buildMergeabilityExpectations(report) {
    const facts = (report.facts && report.facts.mergeability) || [];
    const mergePairs = facts.map(fact => ({
        objects: (fact.subjects && fact.subjects.objects ? fact.subjects.objects.slice() : []).sort(),
        status: fact.status,
        blockers: (fact.blockers || []).slice().sort(),
    }));
    mergePairs.sort((a, b) => {
        const cmp = a.objects[0].localeCompare(b.objects[0]);
        return cmp !== 0 ? cmp : (a.objects[1] || '').localeCompare(b.objects[1] || '');
    });
    return { schema: FIXTURE_SCHEMA, human_verified: false, mergePairs };
}

function validateMergeabilityExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    assert.ok(Array.isArray(payload.mergePairs), `${filePath}: mergePairs must be an array`);
    for (const [index, item] of payload.mergePairs.entries()) {
        assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${filePath}: mergePairs[${index}] must be an object`);
        assert.ok(Array.isArray(item.objects) && item.objects.length === 2 && item.objects.every(o => typeof o === 'string' && o.length > 0), `${filePath}: mergePairs[${index}].objects must be a 2-element string[]`);
        assert.ok(item.status === 'candidate' || item.status === 'rejected', `${filePath}: mergePairs[${index}].status must be candidate or rejected`);
        assertStringArray(filePath, `mergePairs[${index}].blockers`, item.blockers);
    }
}

function checkMergeabilityFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'mergeability'), payload);
    validateMergeabilityExpectationShape(jsonPath, payload);
    const actual = buildMergeabilityExpectations(report);
    const actualByKey = new Map(actual.mergePairs.map(p => [p.objects.join('\0'), p]));
    for (const expected of payload.mergePairs) {
        const key = expected.objects.slice().sort().join('\0');
        const actualPair = actualByKey.get(key);
        if (!actualPair) {
            const available = Array.from(actualByKey.keys()).map(k => k.replace('\0', '+')).join(', ');
            assert.fail(`${jsonPath}: mergePairs pair ${expected.objects.join('+')} not found; available: ${available}`);
        }
        assert.strictEqual(actualPair.status, expected.status, `${jsonPath}: pair ${expected.objects.join('+')} status expected ${expected.status}, got ${actualPair.status}`);
        assertSameStringSet(jsonPath, `pair ${expected.objects.join('+')} blockers`, expected.blockers, actualPair.blockers);
    }
}

function runMergeabilityDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
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
            writeJson(jsonPath, buildMergeabilityExpectations(report));
            log(`generated static analysis testdata: mergeability/${stem}.json (review before committing)\n`);
        }
        checkMergeabilityFixture(txtPath, jsonPath, claimDescriptions);
    }
}

// ─── rulegroup_flow ───────────────────────────────────────────────────────────

function allGroupRecords(report) {
    const records = [];
    for (const section of (report.ps_tagged && report.ps_tagged.rule_sections) || []) {
        for (const group of section.groups || []) {
            records.push({ group, section });
        }
    }
    return records;
}

function buildRulegroupFlowExpectations(source, report) {
    const facts = (report.facts && report.facts.rulegroup_flow) || [];
    const groupRecords = allGroupRecords(report);
    const groupById = new Map(groupRecords.map(r => [r.group.id, r.group]));
    const ruleRecords = allRuleRecords(report, source);
    const ruleById = recordById(ruleRecords);
    const rulegroupFlow = facts.map(fact => {
        const groupId = (fact.subjects && fact.subjects.groups && fact.subjects.groups[0]) || '';
        const group = groupById.get(groupId);
        assert.ok(group, `rulegroup_flow fact ${fact.id} references unknown group ${groupId}`);
        const value = fact.value || {};
        const interactionEdges = (value.interaction_edges || []).map(edge => {
            const from = ruleById.get(edge.from);
            const to = ruleById.get(edge.to);
            assert.ok(from, `rulegroup_flow edge from rule id ${edge.from} not found in records`);
            assert.ok(to, `rulegroup_flow edge to rule id ${edge.to} not found in records`);
            return {
                from_line: from.line,
                from_text: from.text,
                to_line: to.line,
                to_text: to.text,
                reasons: edge.reasons.slice(),
            };
        }).sort(compareRuleLocatorEdges);
        const rerunMasks = Object.keys(value.rerun_masks || {}).sort().map(ruleId => {
            const from = ruleById.get(ruleId);
            assert.ok(from, `rulegroup_flow rerun mask from rule id ${ruleId} not found in records`);
            return {
                ...ruleLocator(from),
                rerun: (value.rerun_masks[ruleId] || []).map(rerunRuleId => {
                    const to = ruleById.get(rerunRuleId);
                    assert.ok(to, `rulegroup_flow rerun mask to rule id ${rerunRuleId} not found in records`);
                    return ruleLocator(to);
                }).sort(compareRuleLocators),
            };
        });
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
    });
    rulegroupFlow.sort((a, b) => a.line - b.line);
    return { schema: FIXTURE_SCHEMA, human_verified: false, rulegroupFlow };
}

function validateRulegroupFlowExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    assert.ok(Array.isArray(payload.rulegroupFlow), `${filePath}: rulegroupFlow must be an array`);
    for (const [index, item] of payload.rulegroupFlow.entries()) {
        assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${filePath}: rulegroupFlow[${index}] must be an object`);
        assert.ok(Number.isInteger(item.line) && item.line > 0, `${filePath}: rulegroupFlow[${index}] missing positive integer line`);
        assert.ok(typeof item.split_candidate === 'boolean', `${filePath}: rulegroupFlow[${index}].split_candidate must be boolean`);
        assert.ok(Number.isInteger(item.components_count) && item.components_count >= 0, `${filePath}: rulegroupFlow[${index}].components_count must be a non-negative integer`);
        if (item.single_pass_safe !== undefined) {
            assert.ok(typeof item.single_pass_safe === 'boolean', `${filePath}: rulegroupFlow[${index}].single_pass_safe must be boolean`);
        }
        if (item.single_pass_blockers !== undefined) {
            assertStringArray(filePath, `rulegroupFlow[${index}].single_pass_blockers`, item.single_pass_blockers);
        }
        assertStringArray(filePath, `rulegroupFlow[${index}].blockers`, item.blockers);
        if (item.interactionEdges !== undefined) {
            assert.ok(Array.isArray(item.interactionEdges), `${filePath}: rulegroupFlow[${index}].interactionEdges must be an array`);
            for (const [edgeIndex, edge] of item.interactionEdges.entries()) {
                assert.ok(edge && typeof edge === 'object' && !Array.isArray(edge), `${filePath}: rulegroupFlow[${index}].interactionEdges[${edgeIndex}] must be an object`);
                assert.ok(Number.isInteger(edge.from_line) && edge.from_line > 0, `${filePath}: rulegroupFlow[${index}].interactionEdges[${edgeIndex}] missing positive integer from_line`);
                assert.ok(typeof edge.from_text === 'string' && edge.from_text.length > 0, `${filePath}: rulegroupFlow[${index}].interactionEdges[${edgeIndex}] missing from_text`);
                assert.ok(Number.isInteger(edge.to_line) && edge.to_line > 0, `${filePath}: rulegroupFlow[${index}].interactionEdges[${edgeIndex}] missing positive integer to_line`);
                assert.ok(typeof edge.to_text === 'string' && edge.to_text.length > 0, `${filePath}: rulegroupFlow[${index}].interactionEdges[${edgeIndex}] missing to_text`);
                assert.ok(Array.isArray(edge.reasons) && edge.reasons.length > 0, `${filePath}: rulegroupFlow[${index}].interactionEdges[${edgeIndex}].reasons must be a non-empty array`);
                for (const reason of edge.reasons) {
                    assert.ok(REASON_VALUES.includes(reason), `${filePath}: rulegroupFlow[${index}].interactionEdges[${edgeIndex}].reasons contains unknown reason ${JSON.stringify(reason)}`);
                }
            }
        }
        if (item.rerunMasks !== undefined) {
            assert.ok(Array.isArray(item.rerunMasks), `${filePath}: rulegroupFlow[${index}].rerunMasks must be an array`);
            for (const [maskIndex, mask] of item.rerunMasks.entries()) {
                assert.ok(mask && typeof mask === 'object' && !Array.isArray(mask), `${filePath}: rulegroupFlow[${index}].rerunMasks[${maskIndex}] must be an object`);
                assert.ok(Number.isInteger(mask.line) && mask.line > 0, `${filePath}: rulegroupFlow[${index}].rerunMasks[${maskIndex}] missing positive integer line`);
                assert.ok(typeof mask.text === 'string' && mask.text.length > 0, `${filePath}: rulegroupFlow[${index}].rerunMasks[${maskIndex}] missing text`);
                assert.ok(Array.isArray(mask.rerun), `${filePath}: rulegroupFlow[${index}].rerunMasks[${maskIndex}].rerun must be an array`);
                for (const [rerunIndex, rerun] of mask.rerun.entries()) {
                    assert.ok(rerun && typeof rerun === 'object' && !Array.isArray(rerun), `${filePath}: rulegroupFlow[${index}].rerunMasks[${maskIndex}].rerun[${rerunIndex}] must be an object`);
                    assert.ok(Number.isInteger(rerun.line) && rerun.line > 0, `${filePath}: rulegroupFlow[${index}].rerunMasks[${maskIndex}].rerun[${rerunIndex}] missing positive integer line`);
                    assert.ok(typeof rerun.text === 'string' && rerun.text.length > 0, `${filePath}: rulegroupFlow[${index}].rerunMasks[${maskIndex}].rerun[${rerunIndex}] missing text`);
                }
            }
        }
    }
}

function checkRulegroupFlowFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'rulegroup_flow'), payload);
    validateRulegroupFlowExpectationShape(jsonPath, payload);
    const actual = buildRulegroupFlowExpectations(source, report);
    const actualByLine = new Map(actual.rulegroupFlow.map(r => [r.line, r]));
    for (const expected of payload.rulegroupFlow) {
        const actualRow = actualByLine.get(expected.line);
        if (!actualRow) {
            const available = Array.from(actualByLine.keys()).join(', ');
            assert.fail(`${jsonPath}: rulegroupFlow group at line ${expected.line} not found; available lines: ${available}`);
        }
        assert.strictEqual(actualRow.split_candidate, expected.split_candidate, `${jsonPath}: group at line ${expected.line} split_candidate expected ${expected.split_candidate}, got ${actualRow.split_candidate}`);
        assert.strictEqual(actualRow.components_count, expected.components_count, `${jsonPath}: group at line ${expected.line} components_count expected ${expected.components_count}, got ${actualRow.components_count}`);
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
        if (expected.interactionEdges !== undefined) {
            assert.deepStrictEqual(
                actualRow.interactionEdges,
                expected.interactionEdges.slice().sort(compareRuleLocatorEdges),
                `${jsonPath}: group at line ${expected.line} interactionEdges mismatch`
            );
        }
        if (expected.rerunMasks !== undefined) {
            const actualMasks = actualRow.rerunMasks.map(mask => ({
                ...mask,
                rerun: mask.rerun.slice().sort(compareRuleLocators),
            }));
            const expectedMasks = expected.rerunMasks.map(mask => ({
                ...mask,
                rerun: mask.rerun.slice().sort(compareRuleLocators),
            }));
            assert.deepStrictEqual(
                actualMasks,
                expectedMasks,
                `${jsonPath}: group at line ${expected.line} rerunMasks mismatch`
            );
        }
        assertSameStringSet(jsonPath, `group at line ${expected.line} blockers`, expected.blockers, actualRow.blockers);
    }
}

function runRulegroupFlowDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
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
            writeJson(jsonPath, buildRulegroupFlowExpectations(source, report));
            log(`generated static analysis testdata: rulegroup_flow/${stem}.json (review before committing)\n`);
        }
        checkRulegroupFlowFixture(txtPath, jsonPath, claimDescriptions);
    }
}

// ─── certified_wake_masks ────────────────────────────────────────────────────

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
    const byId = recordById(records);
    const rows = (certifiedWakeMaskFactValue(report).rules || []).map(row => {
        const record = byId.get(row.rule_id);
        assert.ok(record, `certified_wake_masks rule id ${row.rule_id} not found in records`);
        return {
            rule_id: row.rule_id,
            line: record.line,
            text: record.text,
            reads: sortedMaskPart(row.reads || {}),
            writes: sortedMaskPart(row.writes || {}),
        };
    });
    rows.sort(compareWakeMaskRows);
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
        assert.ok(typeof item.rule_id === 'string' && item.rule_id.length > 0, `${filePath}: ruleWakeMasks[${index}] missing rule_id`);
        assert.ok(Number.isInteger(item.line) && item.line > 0, `${filePath}: ruleWakeMasks[${index}] missing positive integer line`);
        assert.ok(typeof item.text === 'string' && item.text.length > 0, `${filePath}: ruleWakeMasks[${index}] missing text`);
        assertMaskPartShape(filePath, `ruleWakeMasks[${index}].reads`, item.reads);
        assertMaskPartShape(filePath, `ruleWakeMasks[${index}].writes`, item.writes);
    }
}

function compareWakeMaskRows(left, right) {
    return left.line - right.line
        || left.text.localeCompare(right.text)
        || left.rule_id.localeCompare(right.rule_id);
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

// ─── movement_action ──────────────────────────────────────────────────────────

function buildMovementActionExpectations(report) {
    const facts = (report.facts && report.facts.movement_action) || [];
    const noopFact = facts.find(f => f.id === 'action_unnecessary');
    const diagnosticsFact = facts.find(f => f.id === 'action_unnecessary_diagnostics');
    const movementsReachableFromActionInputFact = facts.find(f => f.id === 'movements_reachable_from_action_input');
    const diagnostics = diagnosticsFact && diagnosticsFact.value ? diagnosticsFact.value : {};
    const blockerRules = diagnostics.blocker_rules || [];
    return {
        schema: FIXTURE_SCHEMA,
        human_verified: false,
        actionInput: report.ps_tagged && report.ps_tagged.game && report.ps_tagged.game.tags
            ? report.ps_tagged.game.tags.has_action_input !== false
            : true,
        actionUnnecessary: noopFact ? !!noopFact.value : true,
        actionUnnecessaryBlockers: noopFact ? (noopFact.blockers || []).slice().sort() : [],
        actionUnnecessaryHypotheses: (diagnostics.hypotheses || []).slice().sort(),
        actionUnnecessaryBlockerRuleIds: blockerRules.map(rule => rule.rule_id).sort(),
        actionUnnecessaryChangedObjects: Array.from(new Set(blockerRules.flatMap(rule => rule.changed_objects || []))).sort(),
        movements_reachable_from_action_input: movementsReachableFromActionInputFact
            ? (movementsReachableFromActionInputFact.value || []).slice().sort()
            : [],
    };
}

function validateMovementActionExpectationShape(filePath, payload) {
    assert.strictEqual(payload.schema, FIXTURE_SCHEMA, `${filePath}: unsupported fixture schema`);
    if (payload.actionInput !== undefined) {
        assert.ok(typeof payload.actionInput === 'boolean', `${filePath}: actionInput must be boolean`);
    }
    assert.ok(typeof payload.actionUnnecessary === 'boolean', `${filePath}: actionUnnecessary must be boolean`);
    assertStringArray(filePath, 'actionUnnecessaryBlockers', payload.actionUnnecessaryBlockers);
    if (payload.actionUnnecessaryHypotheses !== undefined) {
        assertStringArray(filePath, 'actionUnnecessaryHypotheses', payload.actionUnnecessaryHypotheses);
    }
    if (payload.actionUnnecessaryBlockerRuleIds !== undefined) {
        assertStringArray(filePath, 'actionUnnecessaryBlockerRuleIds', payload.actionUnnecessaryBlockerRuleIds);
    }
    if (payload.actionUnnecessaryChangedObjects !== undefined) {
        assertStringArray(filePath, 'actionUnnecessaryChangedObjects', payload.actionUnnecessaryChangedObjects);
    }
    if (payload.movements_reachable_from_action_input !== undefined) {
        assertStringArray(
            filePath,
            'movements_reachable_from_action_input',
            payload.movements_reachable_from_action_input
        );
    }
}

function checkMovementActionFixture(txtPath, jsonPath, claimDescriptions) {
    const source = fs.readFileSync(txtPath, 'utf8');
    const report = analyzeSource(source, { sourcePath: txtPath });
    assert.strictEqual(report.status, 'ok', `${txtPath}: static analysis status ${report.status}`);
    const payload = readJson(jsonPath);
    assertFixtureFieldsDocumented(jsonPath, fixtureSchemaByName(claimDescriptions, 'movement_action'), payload);
    validateMovementActionExpectationShape(jsonPath, payload);
    const actual = buildMovementActionExpectations(report);
    if (payload.actionInput !== undefined) {
        assert.strictEqual(actual.actionInput, payload.actionInput, `${jsonPath}: actionInput expected ${payload.actionInput}, got ${actual.actionInput}`);
    }
    assert.strictEqual(actual.actionUnnecessary, payload.actionUnnecessary, `${jsonPath}: actionUnnecessary expected ${payload.actionUnnecessary}, got ${actual.actionUnnecessary}`);
    assertSameStringSet(jsonPath, 'actionUnnecessaryBlockers', payload.actionUnnecessaryBlockers, actual.actionUnnecessaryBlockers);
    if (payload.actionUnnecessaryHypotheses !== undefined) {
        assertSameStringSet(jsonPath, 'actionUnnecessaryHypotheses', payload.actionUnnecessaryHypotheses, actual.actionUnnecessaryHypotheses);
    }
    if (payload.actionUnnecessaryBlockerRuleIds !== undefined) {
        assertSameStringSet(jsonPath, 'actionUnnecessaryBlockerRuleIds', payload.actionUnnecessaryBlockerRuleIds, actual.actionUnnecessaryBlockerRuleIds);
    }
    if (payload.actionUnnecessaryChangedObjects !== undefined) {
        assertSameStringSet(jsonPath, 'actionUnnecessaryChangedObjects', payload.actionUnnecessaryChangedObjects, actual.actionUnnecessaryChangedObjects);
    }
    if (payload.movements_reachable_from_action_input !== undefined) {
        assertSameStringSet(
            jsonPath,
            'movements_reachable_from_action_input',
            payload.movements_reachable_from_action_input,
            actual.movements_reachable_from_action_input
        );
    }
}

function runMovementActionDir(dirPath, claimDescriptions, log = process.stdout.write.bind(process.stdout)) {
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
            writeJson(jsonPath, buildMovementActionExpectations(report));
            log(`generated static analysis testdata: movement_action/${stem}.json (review before committing)\n`);
        }
        checkMovementActionFixture(txtPath, jsonPath, claimDescriptions);
    }
}

// ─── runtime_contracts ───────────────────────────────────────────────────────

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
        human_verified: false,
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
            typeof input === 'string',
            `${filePath}: inputs[${index}] must be a readable string token`
        );
        assert.ok(
            RUNTIME_CONTRACT_INPUT_TOKENS.has(input.trim().toUpperCase()),
            `${filePath}: inputs[${index}] has unknown token ${JSON.stringify(input)}`
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

function runStaticAnalysisTestdata(options = {}) {
    const root = options.root || TESTDATA_ROOT;
    const claimDescriptions = loadClaimDescriptions(options.claimDescriptionsPath || CLAIM_DESCRIPTIONS_PATH);
    const objectTagsDir = path.join(root, 'object_tags');
    assert.ok(fs.existsSync(objectTagsDir), `${objectTagsDir}: missing object_tags testdata directory`);
    runObjectTagsDir(objectTagsDir, claimDescriptions, options.log);
    const ruleTagsDir = path.join(root, 'rule_tags');
    assert.ok(fs.existsSync(ruleTagsDir), `${ruleTagsDir}: missing rule_tags testdata directory`);
    runRuleTagsDir(ruleTagsDir, claimDescriptions, options.log);
    const programFlowDir = path.join(root, 'program_flow');
    assert.ok(fs.existsSync(programFlowDir), `${programFlowDir}: missing program_flow testdata directory`);
    runProgramFlowDir(programFlowDir, claimDescriptions, options.log);
    const winflowDir = path.join(root, 'winflow');
    assert.ok(fs.existsSync(winflowDir), `${winflowDir}: missing winflow testdata directory`);
    runWinflowDir(winflowDir, claimDescriptions, options.log);
    const winConditionTagsDir = path.join(root, 'wincondition_tags');
    assert.ok(fs.existsSync(winConditionTagsDir), `${winConditionTagsDir}: missing wincondition_tags testdata directory`);
    runWinConditionTagsDir(winConditionTagsDir, claimDescriptions, options.log);
    const mergeabilityDir = path.join(root, 'mergeability');
    assert.ok(fs.existsSync(mergeabilityDir), `${mergeabilityDir}: missing mergeability testdata directory`);
    runMergeabilityDir(mergeabilityDir, claimDescriptions, options.log);
    const rulegroupFlowDir = path.join(root, 'rulegroup_flow');
    assert.ok(fs.existsSync(rulegroupFlowDir), `${rulegroupFlowDir}: missing rulegroup_flow testdata directory`);
    runRulegroupFlowDir(rulegroupFlowDir, claimDescriptions, options.log);
    const certifiedWakeMasksDir = path.join(root, 'certified_wake_masks');
    assert.ok(fs.existsSync(certifiedWakeMasksDir), `${certifiedWakeMasksDir}: missing certified_wake_masks testdata directory`);
    runCertifiedWakeMasksDir(certifiedWakeMasksDir, claimDescriptions, options.log);
    const movementActionDir = path.join(root, 'movement_action');
    assert.ok(fs.existsSync(movementActionDir), `${movementActionDir}: missing movement_action testdata directory`);
    runMovementActionDir(movementActionDir, claimDescriptions, options.log);
    const runtimeContractsDir = path.join(root, 'runtime_contracts');
    assert.ok(fs.existsSync(runtimeContractsDir), `${runtimeContractsDir}: missing runtime_contracts testdata directory`);
    runRuntimeContractsDir(runtimeContractsDir, claimDescriptions, options.log);
    process.stdout.write('static_analysis_testdata_runner: ok\n');
}

if (require.main === module) {
    runStaticAnalysisTestdata();
}

module.exports = {
    assertFixtureFieldsDocumented,
    buildCertifiedWakeMaskExpectations,
    buildMergeabilityExpectations,
    buildMovementActionExpectations,
    buildObjectTagExpectations,
    buildProgramFlowExpectations,
    buildRuleTagExpectations,
    buildRulegroupFlowExpectations,
    buildRuntimeContractExpectations,
    buildWinConditionTagExpectations,
    buildWinflowExpectations,
    deriveObjectTagValue,
    deriveRuleTagValue,
    deriveWinConditionTagValue,
    fixtureFieldsAtPath,
    fixtureSchemaByName,
    findRuleRecord,
    findWinConditionRecord,
    formatFixtureJson,
    loadClaimDescriptions,
    runMergeabilityDir,
    runMovementActionDir,
    runObjectTagsDir,
    runProgramFlowDir,
    runCertifiedWakeMasksDir,
    runRuleTagsDir,
    runRulegroupFlowDir,
    runRuntimeContractsDir,
    runStaticAnalysisTestdata,
    runWinConditionTagsDir,
    runWinflowDir,
};
