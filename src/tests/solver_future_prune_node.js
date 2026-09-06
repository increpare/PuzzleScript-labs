'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const solver = require('./run_solver_tests_js');
fs.mkdirSync('build', { recursive: true });
const root = fs.mkdtempSync(path.resolve('build/future-prune-differential-'));
const boards = [];
// Exhaust all seed subsets and player placements on a four-cell line. ACTION
// converts a seed into a prize; RIGHT can destroy the last seed and make the
// SOME goal impossible. NO requires the opposite outcome. This tests both
// false-dead-end safety and shortest-input preservation on the same mechanics.
for (let player = 0; player < 4; player++) for (let seeds = 0; seeds < 16; seeds++) {
    boards.push(Array.from({ length: 4 }, (_, cell) => cell === player
        ? (seeds & (1 << cell) ? 'X' : 'P') : (seeds & (1 << cell) ? 'S' : '.')).join(''));
}
for (const win of ['some Prize', 'no Seed']) {
    const text = `title Future prune differential\nobjects\nBackground\nblack\n\nPlayer\nwhite\n\nSeed\ngreen\n\nPrize\nyellow\n\nlegend\n. = Background\nP = Player\nS = Seed\nX = Player and Seed\nsounds\ncollisionlayers\nBackground\nPlayer\nSeed\nPrize\nrules\n[ action Player Seed ] -> [ Player Prize ]\n[ right Player Seed ] -> [ right Player ]\nwinconditions\n${win}\nlevels\n${boards.join('\n\n')}\n`;
    fs.writeFileSync(path.join(root, win.startsWith('some') ? 'some.txt' : 'no.txt'), text);
}
function run(extra, strategy = 'bfs') {
    return solver.runCorpus(solver.parseArgs(['node', 'solver', root, '--strategy', strategy,
        '--timeout-ms', '2000', '--no-solutions', '--quiet', ...extra]));
}
const baseline = run([]);
const pruned = run(['--solver-future-prune']);
assert.strictEqual(baseline.length, 128);
assert.strictEqual(pruned.length, baseline.length);
for (let i = 0; i < baseline.length; i++) {
    const a = baseline[i], b = pruned[i];
    assert(['solved', 'exhausted'].includes(a.status), `${a.game}#${a.level}: ${a.status}`);
    assert.strictEqual(b.status, a.status, `${a.game}#${a.level}`);
    assert.strictEqual(b.solution_length, a.solution_length, `${a.game}#${a.level}: minimum input length`);
    assert.strictEqual(b.replay_rejected || 0, 0);
}
const a = solver.totals(baseline), b = solver.totals(pruned);
assert.strictEqual(b.future_ruleset_setups, 2, 'one reusable session per game, not 128 per-level plans');
assert.strictEqual(b.future_single_player_levels, 128, 'fixed player count plus actual one-player starts');
assert(b.future_pruned > 0, 'exercise actual dead-end pruning');
assert(b.expanded < a.expanded, 'pruning removes search work');
const portfolio = run(['--solver-future-prune'], 'portfolio');
for (let i = 0; i < baseline.length; i++) {
    assert.strictEqual(portfolio[i].status, baseline[i].status, `portfolio ${baseline[i].game}#${baseline[i].level}`);
    assert.strictEqual(portfolio[i].replay_rejected || 0, 0);
}
assert(solver.totals(portfolio).future_pruned > 0, 'exercise the shared portfolio consumer');
assert.strictEqual(solver.totals(portfolio).future_ruleset_setups, 2, 'portfolio also reuses the compiled ruleset');
console.log(`solver_future_prune_node: ok (128 exact BFS comparisons; expanded ${a.expanded} -> ${b.expanded}, pruned ${b.future_pruned})`);
