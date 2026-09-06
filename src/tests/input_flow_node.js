'use strict';
const assert = require('assert');
const { analyzeInputSpecialization } = require('../canonicalize');
const { replayInputSpecializationTrace, firstReplayTraceDifference } = require('./run_static_analysis_runtime_contracts_node');
const R = 8, A = 16, ALL = 63;
const cases = [
    ['right [ right Player up A ] -> [ right Player up A ]', 'right [', 0],
    ['right [ action Player ] -> [ right Player ]\nright [ right Player ] -> [ right Player ]', 'right [ right Player ]', R | A],
    ['right [ right Player ] -> [ right Player ]\nright [ action Player ] -> [ right Player ]', 'right [ right Player ]', R],
    ['startloop\nright [ right Player ] -> [ right Player ]\nright [ action Player ] -> [ right Player ]\nendloop', 'right [ right Player ]', R | A],
    ['right [ right Player ] -> [ right Player ]\n+ right [ action Player ] -> [ right Player ]', 'right [ right Player ]', R | A],
    ['right [ stationary A ] -> [ up A ]\nright [ up A ] -> [ up A ]', 'right [ up A ]', ALL],
    ['right [ action Player A ] -> [ action Player right A ]\nright [ right A B ] -> [ right A up B ]\nright [ up B ] -> [ up B ]', 'right [ up B ]', A],
    ['right [ right Player ] -> [ stationary Player ]\nright [ stationary Player A ] -> [ Player up A ]\nright [ up A ] -> [ up A ]', 'right [ up A ]', ALL],
    ['right [ no A B ] -> [ no A up B ]\nright [ up B ] -> [ up B ]', 'right [ up B ]', ALL],
    ['right [ action Player A ] -> [ action Player right A ]\nright [ moving Thing ] -> [ moving Thing ]', 'right [ moving Thing ]', A],
    ['right [ A ] -> [ randomdir A ]\nright [ up A ] -> [ up A ]', 'right [ up A ]', ALL],
    ['rigid right [ action Player A ] -> [ right Player right A ]\nright [ right A ] -> [ right A ]', 'right [ right A ]', A],
    ['random right [ action Player A ] -> [ Player right A ]\nright [ right A ] -> [ right A ]', 'right [ right A ]', A],
    ['right [ up A ] -> [ right A ] win\nright [ right A ] -> [ right A ]', 'right [ right A ]', 0],
    ['right [ up A ] -> [ up A ]\nlate [ A ] -> [ B ]', 'right [ up A ]', 0],
    ['right [ action Player A ] -> [ Player B ] again\nright [ B ] -> [ up B ]\nright [ up B ] -> [ up B ]', 'right [ up B ]', ALL],
    ['startloop\nright [ up Player ] -> [ left Player ]\nright [ action Player ] -> [ up Player ]\nright [ left A ] -> [ left A ]\nendloop', 'right [ up Player ]', 1 | A],
];
for (const [rules, observed, expected] of cases) {
    const source = 'title Input flow\n\nobjects\nBackground\nblack\n\nPlayer\nwhite\n\nA\nred\n\nB\nblue\n\nWall\ngrey\n\n'
        + 'legend\n. = Background\nP = Player\nX = Player and A and B\n# = Wall\nThing = A or B\n\nsounds\n\n'
        + 'collisionlayers\nBackground\nPlayer, Wall\nA\nB\n\nrules\n' + rules
        + '\n\nwinconditions\n\nlevels\n.....\n.X.#.\n.....\n';
    const report = analyzeInputSpecialization(source);
    assert(report.ok, JSON.stringify(report.errorStrings));
    const line = source.slice(0, source.indexOf(observed)).split('\n').length;
    const copies = report.mainRules.filter(r => r.line === line);
    assert(copies.length);
    assert.strictEqual(copies.reduce((mask, r) => mask | r.activeInputsMask, 0), expected, rules);
    // A deterministic walk includes every length-three direction/action/tick
    // combination. Native fixtures additionally restart for each combination.
    const inputs = [];
    for (let n = 0; n < 216; n++) for (let d = 0; d < 3; d++) {
        const input = Math.floor(n / 6 ** d) % 6;
        inputs.push(input === 5 ? 'tick' : input);
    }
    const off = replayInputSpecializationTrace('input flow', source, inputs, { enabled: false, randomSeed: 'input-flow' });
    const on = replayInputSpecializationTrace('input flow', source, inputs, { enabled: true, randomSeed: 'input-flow' });
    assert.strictEqual(firstReplayTraceDifference(off, on), null, observed);
}
console.log(`input_flow_node: ok (${cases.length} cases)`);
