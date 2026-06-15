#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
const { analyzeSource } = require('./ps_static_analysis');

const FIXTURE_SCHEMA = 'ps-static-analysis-testdata-v1';

function findObjectTag(payload, object) {
    return payload.objectTag.find(item => item.object === object);
}

function findRuleTag(payload, text) {
    return payload.ruleTag.find(item => item.text === text);
}

function assertGeneratedFixtureIsUnverified(label, payload) {
    assert.strictEqual(payload.human_verified, false, `${label}: generated fixture must set human_verified false`);
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'review'), `${label}: generated fixture must not set review`);
}

function writeJson(filePath, payload) {
    fs.writeFileSync(filePath, `${formatFixtureJson(payload)}\n`, 'utf8');
}

function run() {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-static-analysis-testdata-runner-'));
    try {
        const objectTagsDir = path.join(tmpRoot, 'object_tags');
        fs.mkdirSync(objectTagsDir, { recursive: true });
        fs.copyFileSync(
            path.join(__dirname, 'static_analysis_testdata', 'object_tags', 'roles-basic.txt'),
            path.join(objectTagsDir, 'roles-basic.txt'),
        );

        const claimDescriptions = loadClaimDescriptions();
        const ruleTagNames = fixtureFieldsAtPath(
            fixtureSchemaByName(claimDescriptions, 'rule_tags'),
            ['ruleTag', 'tags']
        ).map(tag => tag.name);
        assert.deepStrictEqual(ruleTagNames, [
            'objects_required',
            'objects_matched',
            'object_absences_matched',
            'movements_required',
            'movements_matched',
            'objects_written',
            'objects_erased',
            'movements_written',
            'movements_removed',
            'cosmetic',
        ]);
        const movementActionReport = analyzeSource(`title Static Analysis Movement Action Name

========
OBJECTS
========

Background
black

Player
white

========
LEGEND
========

. = Background
P = Player

========
SOUNDS
========

================
COLLISIONLAYERS
================

Background
Player

=====
RULES
=====

[ action Player ] -> [ right Player ]

=============
WINCONDITIONS
=============

Some Player

======
LEVELS
======

P
`, { sourcePath: 'movement-action-name.txt' });
        const movementActionPayload = buildMovementActionExpectations(movementActionReport);
        assert.deepStrictEqual(
            movementActionPayload.movements_reachable_from_action_input,
            ['Player:action', 'Player:moving', 'Player:right']
        );

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
        ].join('\n');

        const runtimeContractPayload = buildRuntimeContractExpectations(
            runtimeContractSource,
            'runtime-contract-tmp',
            { inputs: ['TICK'] }
        );
        assert.strictEqual(runtimeContractPayload.schema, FIXTURE_SCHEMA);
        assert.deepStrictEqual(runtimeContractPayload.inputs, ['TICK']);
        assert.strictEqual(runtimeContractPayload.expectedFinalLevel, 'background player:0,\n');
        assert.strictEqual(runtimeContractPayload.expect.neverAppearsObjectCount, 0);
        const generatedLog = [];
        runObjectTagsDir(objectTagsDir, claimDescriptions, message => generatedLog.push(message));
        assert.deepStrictEqual(generatedLog, ['generated static analysis testdata: object_tags/roles-basic.json (review before committing)\n']);

        const jsonPath = path.join(objectTagsDir, 'roles-basic.json');
        const generated = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        assert.strictEqual(generated.schema, FIXTURE_SCHEMA);
        assertGeneratedFixtureIsUnverified('object_tags/roles-basic.json', generated);
        assert.strictEqual(generated.objectTag.length, 3);
        assert.strictEqual(findObjectTag(generated, 'Avatar').is_player, true);
        assert.strictEqual(findObjectTag(generated, 'Avatar').created_by_rules, false);
        assert.strictEqual(findObjectTag(generated, 'Avatar').destroyed_by_rules, false);
        assert.strictEqual(findObjectTag(generated, 'Background').is_background, true);
        assert.strictEqual(findObjectTag(generated, 'Goal').level_presence, 'all');

        assert.throws(
            () => assertFixtureFieldsDocumented(
                'undocumented-field.json',
                fixtureSchemaByName(claimDescriptions, 'object_tags'),
                {
                    schema: FIXTURE_SCHEMA,
                    human_verified: false,
                    note: 'undocumented fields should be rejected',
                    objectTag: [
                        {
                            object: 'Avatar',
                            is_player: true,
                        },
                    ],
                }
            ),
            /undocumented fixture field note/
        );
        assert.throws(
            () => assertFixtureFieldsDocumented(
                'human-verified-missing-field.json',
                fixtureSchemaByName(claimDescriptions, 'object_tags'),
                {
                    schema: FIXTURE_SCHEMA,
                    objectTag: [
                        {
                            object: 'Avatar',
                            is_player: true,
                        },
                    ],
                }
            ),
            /missing human_verified/
        );
        assert.doesNotThrow(
            () => assertFixtureFieldsDocumented(
                'human-verified-field.json',
                fixtureSchemaByName(claimDescriptions, 'object_tags'),
                {
                    schema: FIXTURE_SCHEMA,
                    human_verified: true,
                    objectTag: [
                        {
                            object: 'Avatar',
                            is_player: true,
                        },
                    ],
                }
            )
        );
        assert.throws(
            () => assertFixtureFieldsDocumented(
                'human-verified-string-field.json',
                fixtureSchemaByName(claimDescriptions, 'object_tags'),
                {
                    schema: FIXTURE_SCHEMA,
                    human_verified: 'yes',
                    objectTag: [
                        {
                            object: 'Avatar',
                            is_player: true,
                        },
                    ],
                }
            ),
            /human_verified must be boolean/
        );
        assert.throws(
            () => assertFixtureFieldsDocumented(
                'undocumented-nested-field.json',
                fixtureSchemaByName(claimDescriptions, 'program_flow'),
                {
                    schema: FIXTURE_SCHEMA,
                    human_verified: false,
                    wakeEdges: [
                        {
                            from_line: 1,
                            from_text: '[ a ] -> [ b ]',
                            to_line: 2,
                            to_text: '[ b ] -> [ c ]',
                            reasons: ['object_presence'],
                            mysteryEdgeField: true,
                        },
                    ],
                    againRules: [],
                }
            ),
            /undocumented fixture field wakeEdges\[\]\.mysteryEdgeField/
        );
        assert.throws(
            () => assertFixtureFieldsDocumented(
                'undocumented-runtime-contract-field.json',
                fixtureSchemaByName(claimDescriptions, 'runtime_contracts'),
                {
                    schema: FIXTURE_SCHEMA,
                    human_verified: false,
                    inputs: ['TICK'],
                    expectedFinalLevel: 'background player:0,\n',
                    expect: {
                        neverAppearsObjectCount: 0,
                        mysteryRuntimeField: 1,
                    },
                }
            ),
            /undocumented fixture field expect\.mysteryRuntimeField/
        );

        const curated = {
            schema: FIXTURE_SCHEMA,
            human_verified: true,
            objectTag: [
                {
                    object: 'Avatar',
                    is_player: true,
                },
            ],
        };
        writeJson(jsonPath, curated);
        const curatedText = fs.readFileSync(jsonPath, 'utf8');

        const rerunLog = [];
        runObjectTagsDir(objectTagsDir, claimDescriptions, message => rerunLog.push(message));
        assert.deepStrictEqual(rerunLog, []);
        assert.strictEqual(fs.readFileSync(jsonPath, 'utf8'), curatedText);

        const runtimeContractsDir = path.join(tmpRoot, 'runtime_contracts');
        fs.mkdirSync(runtimeContractsDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeContractsDir, 'runtime-contract-tmp.txt'), runtimeContractSource, 'utf8');

        const generatedRuntimeLog = [];
        runRuntimeContractsDir(runtimeContractsDir, claimDescriptions, message => generatedRuntimeLog.push(message));
        assert.deepStrictEqual(generatedRuntimeLog, [
            'generated static analysis testdata: runtime_contracts/runtime-contract-tmp.json (review before committing)\n',
        ]);

        const runtimeJsonPath = path.join(runtimeContractsDir, 'runtime-contract-tmp.json');
        const generatedRuntimePayload = JSON.parse(fs.readFileSync(runtimeJsonPath, 'utf8'));
        assert.strictEqual(generatedRuntimePayload.schema, FIXTURE_SCHEMA);
        assertGeneratedFixtureIsUnverified('runtime_contracts/runtime-contract-tmp.json', generatedRuntimePayload);
        assert.deepStrictEqual(generatedRuntimePayload.inputs, ['TICK']);
        assert.strictEqual(generatedRuntimePayload.expectedFinalLevel, 'background player:0,\n');
        assert.strictEqual(generatedRuntimePayload.expect.neverAppearsObjectCount, 0);

        writeJson(runtimeJsonPath, Object.assign({}, generatedRuntimePayload, { inputs: [4] }));
        assert.throws(
            () => runRuntimeContractsDir(runtimeContractsDir, claimDescriptions, () => {}),
            /inputs\[0\] must be a readable string token/
        );

        const curatedRuntime = {
            schema: FIXTURE_SCHEMA,
            human_verified: true,
            inputs: ['TICK'],
            expectedFinalLevel: 'background player:0,\n',
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

        const ruleTagsDir = path.join(tmpRoot, 'rule_tags');
        fs.mkdirSync(ruleTagsDir, { recursive: true });
        const ruleTagSource = `title Static Analysis Rule Tag Tmp

========
OBJECTS
========

Background
black

Player
white

Wall
brown

========
LEGEND
========

. = Background
P = Player
# = Wall

========
SOUNDS
========

================
COLLISIONLAYERS
================

Background
Player
Wall

=====
RULES
=====

[ wall ] -> [ ]

=============
WINCONDITIONS
=============

Some Player

======
LEVELS
======

P#
`;
        fs.writeFileSync(path.join(ruleTagsDir, 'tmp-rule.txt'), ruleTagSource, 'utf8');

        const generatedRuleLog = [];
        runRuleTagsDir(ruleTagsDir, claimDescriptions, message => generatedRuleLog.push(message));
        assert.deepStrictEqual(generatedRuleLog, ['generated static analysis testdata: rule_tags/tmp-rule.json (review before committing)\n']);

        const ruleJsonPath = path.join(ruleTagsDir, 'tmp-rule.json');
        const generatedRulePayload = JSON.parse(fs.readFileSync(ruleJsonPath, 'utf8'));
        assert.strictEqual(generatedRulePayload.schema, FIXTURE_SCHEMA);
        assertGeneratedFixtureIsUnverified('rule_tags/tmp-rule.json', generatedRulePayload);
        assert.strictEqual(generatedRulePayload.ruleTag.length, 1);
        assert.deepStrictEqual(findRuleTag(generatedRulePayload, '[ wall ] -> [ ]').tags.objects_required, ['Wall']);
        assert.deepStrictEqual(findRuleTag(generatedRulePayload, '[ wall ] -> [ ]').tags.objects_erased, ['Wall']);
        const generatedRuleText = fs.readFileSync(ruleJsonPath, 'utf8');
        assert.ok(generatedRuleText.includes('"objects_required": ["Wall"]'));
        assert.ok(generatedRuleText.includes('"object_absences_matched": []'));
        assert.ok(!generatedRuleText.includes('"objects_required": [\n'));
        assert.strictEqual(formatFixtureJson({
            schema: FIXTURE_SCHEMA,
            ruleTag: [
                {
                    line: 40,
                    text: '[ wall ] -> [ ]',
                    tags: {
                        objects_required: ['Wall'],
                        object_absences_matched: [],
                    },
                },
            ],
        }).trim(), `{
  "schema": "ps-static-analysis-testdata-v1",
  "ruleTag": [
    {
      "line": 40,
      "text": "[ wall ] -> [ ]",
      "tags": {
        "objects_required": ["Wall"],
        "object_absences_matched": []
      }
    }
  ]
}`);

        const curatedRulePayload = {
            schema: FIXTURE_SCHEMA,
            human_verified: true,
            ruleTag: [
                {
                    line: 40,
                    text: '[ wall ] -> [ ]',
                    tags: {
                        objects_erased: ['Wall'],
                    },
                },
            ],
        };
        writeJson(ruleJsonPath, curatedRulePayload);
        const curatedRuleText = fs.readFileSync(ruleJsonPath, 'utf8');

        const rerunRuleLog = [];
        runRuleTagsDir(ruleTagsDir, claimDescriptions, message => rerunRuleLog.push(message));
        assert.deepStrictEqual(rerunRuleLog, []);
        assert.strictEqual(fs.readFileSync(ruleJsonPath, 'utf8'), curatedRuleText);

        assert.throws(
            () => findRuleRecord('ambiguous-rule.json', [
                { line: 12, text: '[ wall ] -> [ ]', rule: { tags: {} } },
                { line: 12, text: '[ wall ] -> [ ]', rule: { tags: {} } },
            ], { line: 12, text: '[ wall ] -> [ ]' }),
            /matched 2 analyzed rules; expected exactly 1/
        );

        const nonIdempotentDir = path.join(tmpRoot, 'rule_tags_non_idempotent');
        fs.mkdirSync(nonIdempotentDir, { recursive: true });
        const nonIdempotentSource = `title Static Analysis Rule Tag Non Idempotent

========
OBJECTS
========

Background
black

Player
white

Wall
brown

Mark
yellow

========
LEGEND
========

. = Background
P = Player
# = Wall
M = Mark

========
SOUNDS
========

================
COLLISIONLAYERS
================

Background
Player
Wall
Mark

=====
RULES
=====

[ Player no Wall ] -> [ Player Mark ]

=============
WINCONDITIONS
=============

Some Player

======
LEVELS
======

P#M
`;
        fs.writeFileSync(path.join(nonIdempotentDir, 'non-idempotent.txt'), nonIdempotentSource, 'utf8');
        writeJson(path.join(nonIdempotentDir, 'non-idempotent.json'), {
            schema: FIXTURE_SCHEMA,
            human_verified: false,
            ruleTag: [
                {
                    line: 45,
                    text: '[ Player no Wall ] -> [ Player Mark ]',
                    tags: {
                        objects_written: ['Mark'],
                    },
                },
            ],
        });
        assert.throws(
            () => runRuleTagsDir(nonIdempotentDir, claimDescriptions, () => {}),
            /non-idempotent rule text/
        );
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    process.stdout.write('static_analysis_testdata_runner_node: ok\n');
}

run();
