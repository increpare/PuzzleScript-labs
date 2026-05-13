#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { analyzeSource } = require('./ps_static_analysis');
const {
    buildExplorerModel,
    editorHrefForSource,
    renderExplorerHtml,
} = require('./build_static_analysis_explorer');

const EXPLORER_FIXTURE = `
title Explorer Fixture
========
OBJECTS
========
Background
black
Player
white
Wall
gray
Rock
brown
BodyH
red
BodyV
blue
BodyD
purple
Alpha
green
Beta
yellow
MarkerX
pink
MarkerY
orange
${'======='}
LEGEND
${'======='}
. = Background
P = Player
# = Wall
R = Rock
h = BodyH
v = BodyV
d = BodyD
a = Alpha
b = Beta
Body = BodyH or BodyV or BodyD
${'======='}
SOUNDS
${'======='}
================
COLLISIONLAYERS
================
Background
Player
Wall
Rock
BodyH, BodyV, BodyD
Alpha
Beta
MarkerX
MarkerY
=====
RULES
=====
[ Body ] -> [ Body ]
[ Wall ] -> sfx0
[ Alpha ] -> [ Alpha MarkerX ]
+ [ Beta ] -> [ Beta MarkerY ]
=============
WINCONDITIONS
=============
Some Player
======
LEVELS
======
P#Rhvdab
`;

const EXPLORER_FLOW_FIXTURE = `
title Explorer Flow Fixture
========
OBJECTS
========
Background
black
Player
white
Alpha
green
MarkerX
pink
Shrink
blue
Flux
yellow
${'======='}
LEGEND
${'======='}
. = Background
P = Player
a = Alpha
m = MarkerX
s = Shrink
f = Flux
${'======='}
SOUNDS
${'======='}
================
COLLISIONLAYERS
================
Background
Player
Alpha
MarkerX
Shrink
Flux
=====
RULES
=====
[ Alpha ] -> [ Alpha MarkerX ]
[ Shrink ] -> [ ]
[ no Flux Alpha ] -> [ Flux Alpha ]
late [ Flux ] -> [ ]
=============
WINCONDITIONS
=============
Some MarkerX
======
LEVELS
======
P.as
`;

const EXPLORER_NOACTION_FIXTURE = `
title Explorer Noaction Fixture
noaction
========
OBJECTS
========
Background
black
Player
white
Marker
green
${'======='}
LEGEND
${'======='}
. = Background
P = Player
M = Marker
${'======='}
SOUNDS
${'======='}
================
COLLISIONLAYERS
================
Background
Player
Marker
=====
RULES
=====
[ action Player ] -> [ action Player Marker ]
=============
WINCONDITIONS
=============
Some Marker
======
LEVELS
======
P
`;

const repoRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repoRoot, 'src/tests/solver_tests/explorer_fixture.txt');
const report = analyzeSource(EXPLORER_FIXTURE, { sourcePath, includeSourceText: true });
assert.strictEqual(report.status, 'ok');

const model = buildExplorerModel([report], { repoRoot });
assert.strictEqual(model.games.length, 1);
const game = model.games[0];
assert.strictEqual(game.display_name, 'explorer_fixture.txt');
assert.ok(game.editor_href.endsWith('/src/editor.html?file=tests%2Fsolver_tests%2Fexplorer_fixture.txt'));
assert.ok(game.mergeable.some(pair => pair.objects.join(',') === 'BodyH,BodyV'));
assert.ok(game.mergeable_groups.some(group => group.objects.join(',') === 'BodyD,BodyH,BodyV'));
assert.ok(game.static_objects.includes('Wall'));
assert.ok(game.static_objects.includes('Rock'));
assert.strictEqual(game.static_objects_label, 'Background, Wall, Rock, BodyH, BodyV, BodyD, Alpha, Beta');
assert.ok(game.static_layers.some(layer => layer.objects.includes('Wall')));
assert.ok(game.inert_rules.some(rule => rule.text.includes('sfx0')));
assert.ok(game.rulegroup_flow.some(group => group.status === 'candidate' && group.components.length === 2));
assert.deepStrictEqual(game.corpus_metrics.objects, {
    total: 11,
    static: 8,
    constant_count: 9,
    temporary: 0,
    cosmetic: 10,
    mergable: 2,
});
assert.deepStrictEqual(game.corpus_metrics.layers, {
    total: 9,
    static: 6,
    inert: 2,
});
assert.deepStrictEqual(game.corpus_metrics.rules, {
    source: 4,
    compiled: 4,
    action: 'none',
    tick: 'tick',
    cosmetic: 4,
    inert_command: 1,
});
assert.deepStrictEqual(game.corpus_metrics.rulegroups, {
    total: 3,
    splittable: 1,
});
assert.deepStrictEqual(game.corpus_metrics.winconditions, {
    total: 1,
});
assert.ok(game.object_rows.some(row =>
    row.name === 'BodyH' &&
    row.layer === 4 &&
    row.quantity === 'constant' &&
    row.static === true &&
    row.cosmetic === true &&
    row.merge_group === 'merge_group_0' &&
    row.rule_count > 0
));
assert.ok(game.object_rows.some(row =>
    row.name === 'MarkerX' &&
    row.quantity === 'can increase' &&
    row.static === false &&
    row.win_role === 'none'
));
assert.ok(game.layer_rows.some(row =>
    row.id === 4 &&
    row.static === true &&
    row.inert === false &&
    row.objects.join(',') === 'BodyH,BodyV,BodyD'
));
assert.ok(game.rule_rows.some(row =>
    row.compiled_id === 'early_group_1_rule_0' &&
    row.source_line === 60 &&
    row.cosmetic === true
));
assert.ok(game.rulegroup_rows.some(row =>
    row.id === 'early_group_0' &&
    row.rule_count > 0
));
assert.deepStrictEqual(game.wincondition_rows.map(row => row.text), ['Some Player']);
assert.ok(game.source_lines.some(row =>
    row.line === 2 &&
    row.text === 'title Explorer Fixture'
));
assert.ok(game.source_lines.some(row =>
    row.text.includes('[ Wall ] -> sfx0') &&
    row.rule_count > 0 &&
    row.rule_summaries.some(rule => rule.group === 'early_group_1')
));
assert.strictEqual(model.totals.mergable_objects, 2);
assert.strictEqual(model.totals.temporary_objects, 0);
assert.strictEqual(model.totals.cosmetic_rules, 4);
assert.strictEqual(model.totals.inert_command_rules, 1);

const flowReport = analyzeSource(EXPLORER_FLOW_FIXTURE, {
    sourcePath: path.join(repoRoot, 'src/tests/solver_tests/explorer_flow_fixture.txt'),
});
assert.strictEqual(flowReport.status, 'ok');
const flowModel = buildExplorerModel([flowReport], { repoRoot });
const flowGame = flowModel.games[0];
assert.deepStrictEqual(flowGame.quantity.constant, ['Background', 'Player', 'Alpha']);
assert.ok(flowGame.quantity.can_increase.includes('MarkerX'));
assert.ok(flowGame.quantity.can_decrease.includes('Shrink'));
assert.ok(flowGame.quantity.dynamic.includes('Flux'));
assert.strictEqual(flowGame.action_noop.status, 'rejected');
assert.ok(flowGame.action_noop.blockers.includes('autonomous_solver_active_rule'));
assert.strictEqual(flowGame.program_flow.tick_noop, false);
assert.strictEqual(flowGame.program_flow.no_again, true);
assert.strictEqual(flowGame.program_flow.no_random, true);
assert.strictEqual(flowGame.corpus_metrics.rules.action, 'action');
assert.strictEqual(flowGame.corpus_metrics.rules.tick, 'tick');
assert.ok(flowGame.corpus_metrics.objects.temporary >= 0);
assert.ok(flowGame.program_flow.wake_edge_count > 0);
assert.ok(flowGame.winflow.wake_edges.some(edge =>
    edge.from_text.includes('MarkerX') && edge.to_text === 'Some MarkerX'
));

const noactionReport = analyzeSource(EXPLORER_NOACTION_FIXTURE, {
    sourcePath: path.join(repoRoot, 'src/tests/solver_tests/explorer_noaction_fixture.txt'),
});
assert.strictEqual(noactionReport.status, 'ok');
const noactionModel = buildExplorerModel([noactionReport], { repoRoot });
const noactionGame = noactionModel.games[0];
assert.strictEqual(noactionGame.action_noop.status, 'proved');
assert.strictEqual(noactionGame.program_flow.action_input, false);
assert.strictEqual(noactionGame.corpus_metrics.rules.action, 'disabled');
assert.strictEqual(noactionGame.corpus_metrics.rules.tick, 'none');

assert.strictEqual(
    editorHrefForSource(sourcePath, { repoRoot }),
    '/src/editor.html?file=tests%2Fsolver_tests%2Fexplorer_fixture.txt'
);

const html = renderExplorerHtml(model);
assert.ok(html.includes('PuzzleScript Static Analysis Explorer'));
assert.ok(html.includes('explorer_fixture.txt'));
assert.ok(html.includes('BodyH'));
assert.ok(html.includes('BodyD, BodyH, BodyV'));
assert.ok(!html.includes('BodyD = BodyH = BodyV'));
assert.ok(html.includes('Wall, Rock'));
assert.ok(html.includes('Open in editor'));
assert.ok(html.includes('Corpus Explorer'));
assert.ok(html.includes('Game Explorer'));
assert.ok(html.includes('Mergable objects'));
assert.ok(html.includes('Splittable rulegroups'));
assert.ok(html.includes('Objects'));
assert.ok(html.includes('Layers'));
assert.ok(html.includes('Rules'));
assert.ok(html.includes('Rulegroups'));
assert.ok(html.includes('Winconditions'));
assert.ok(html.includes('mergable objects'));
assert.ok(html.includes('constant count'));
assert.ok(html.includes('temporary'));
assert.ok(html.includes('cosmetic rules'));
assert.ok(html.includes('inert command rules'));
assert.ok(html.includes('splittable rulegroups'));
assert.ok(html.includes('constant-count objects'));
assert.ok(!html.includes('winflow edges'));
assert.ok(!html.includes('cell name name'));
assert.ok(html.includes('data-view="corpus"'));
assert.ok(html.includes('data-view="game"'));
assert.ok(html.includes('Objects tab'));
assert.ok(html.includes('Rules tab'));
assert.ok(html.includes('Layers tab'));
assert.ok(html.includes('Rulegroups tab'));
assert.ok(html.includes('Source tab'));
assert.ok(html.includes('Winconditions tab'));
assert.ok(html.includes('Rule Flow tab'));
assert.ok(html.indexOf('Winconditions tab') < html.indexOf('Source tab'));
assert.ok(html.includes('data-object-cell="quantity"'));
assert.ok(html.includes('data-object-cell="merge_group"'));
assert.ok(html.includes('data-object-cell="win_role"'));
assert.ok(html.includes('data-object-sort-key="quantity"'));
assert.ok(html.includes('function handleObjectHeaderSort'));
assert.ok(html.includes('data-cell-kind="objects.mergable"'));
assert.ok(html.includes('data-sort-key="corpus_metrics.objects.static"'));
assert.ok(html.includes('function handleCorpusHeaderSort'));
assert.ok(html.includes('white-space: normal'));
assert.ok(html.includes('button.cell.name[data-game]'));
assert.ok(html.includes('function closeInspector()'));
assert.ok(html.includes('function inspectorContent'));
assert.ok(html.includes('function renderRulesTab'));
assert.ok(html.includes('Rule analysis'));
assert.ok(html.includes('Rules summary'));
assert.ok(html.includes('<th>Line</th>'));
assert.ok(!html.includes("'<td>line ' +"));
assert.ok(html.includes('data-rule-cell="cosmetic"'));
assert.ok(html.includes('function renderLayersTab'));
assert.ok(html.includes('Layer analysis'));
assert.ok(html.includes('Object count'));
assert.ok(html.includes('data-layer-cell="static"'));
assert.ok(html.includes('function renderRulegroupsTab'));
assert.ok(html.includes('Rulegroup analysis'));
assert.ok(html.includes('Source lines'));
assert.ok(html.includes('data-rulegroup-cell="source_lines"'));
assert.ok(html.includes('Components'));
assert.ok(html.includes('data-rulegroup-cell="splittable"'));
assert.ok(html.includes('function renderRuleFlowTab'));
assert.ok(html.includes('Rule flow analysis'));
assert.ok(html.includes('data-rule-flow-group='));
assert.ok(html.includes('function renderSourceTab'));
assert.ok(html.includes('Best-effort source annotation'));
assert.ok(html.includes('Source line'));
assert.ok(html.includes('title Explorer Fixture'));
assert.ok(html.includes('data-source-line="'));
assert.ok(html.includes('ruleSummariesTitle'));
assert.ok(html.includes('function renderWinconditionsTab'));
assert.ok(html.includes('Wincondition analysis'));
assert.ok(html.includes('Subjects'));
assert.ok(html.includes('data-wincondition-cell="wake_edge_count"'));
assert.ok(html.includes("row.source_line == null ? 'compiled' : row.source_line"));
assert.ok(html.includes('Mergable object savings'));
assert.ok(html.includes('Source-facing rules'));
assert.ok(html.includes('Compiled rules'));
assert.ok(html.includes('Action input'));
assert.ok(html.includes('Autonomous tick'));
assert.ok(html.includes('JSON.stringify(game.corpus_metrics)'));
assert.ok(html.includes("corpusColumns.map(column => column.label).join(' ')"));
assert.ok(html.includes('b.corpus_metrics.objects.mergable - a.corpus_metrics.objects.mergable'));
assert.ok(html.includes('closeInspector();'));

const flowHtml = renderExplorerHtml(flowModel);
assert.ok(flowHtml.includes('can increase'));
assert.ok(flowHtml.includes('can decrease'));
assert.ok(flowHtml.includes('dynamic'));
assert.ok(flowHtml.includes('Some MarkerX'));

const noactionHtml = renderExplorerHtml(noactionModel);
assert.ok(noactionHtml.includes('action_input'));

const editorSource = fs.readFileSync(path.join(repoRoot, 'src/js/editor.js'), 'utf8');
assert.ok(editorSource.includes('getParameterByName("file")'), 'editor should accept explorer file links');
assert.ok(editorSource.includes('tryLoadSourceFile'), 'editor should load same-origin source files');

console.log('static_analysis_explorer_node: ok');
