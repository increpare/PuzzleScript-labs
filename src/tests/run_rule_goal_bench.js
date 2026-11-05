#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const {spawnSync} = require('child_process');
if (process.argv.length !== 5) throw Error('Usage: run_rule_goal_bench.js BENCH_EXE CORPUS OUTPUT_DIR');
const [exe, corpus, output] = process.argv.slice(2).map(p => path.resolve(p));
fs.mkdirSync(output, {recursive: true});
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PUZZLESCRIPT_')));
const manifest = {schema: 1, binary_sha256: sha(fs.readFileSync(exe)), timeout_ms: 250,
    scope: 'All structurally eligible corpus levels; serial native portfolio, compact nodes, exact keys. Plan warmed for both arms. Compilation and ruleset setup excluded from level deadline; load/search/win replay included.', runs: []};
function run(mode, repeat) {
    const label = `${mode}-${repeat}`;
    const start = performance.now();
    const result = spawnSync(exe, [corpus, mode, '250'], {env, encoding: 'utf8', windowsHide: true,
        timeout: 600000, maxBuffer: 128 * 1024 * 1024});
    fs.writeFileSync(path.join(output, label + '.jsonl'), result.stdout || '');
    fs.writeFileSync(path.join(output, label + '.stderr'), result.stderr || '');
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    const rows = result.stdout.trim().split('\n').map(JSON.parse);
    manifest.runs.push({label, wall_ms: performance.now() - start, sha256: sha(result.stdout)});
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return rows;
}
const survey = run('survey', 0);
manifest.sources = survey.map(row => ({game: row.game, sha256: sha(fs.readFileSync(path.join(corpus, row.game)))}));
const eligible = survey.filter(row => row.supported);
const expected = eligible.reduce((sum, row) => sum + row.levels, 0);
let keys;
for (let repeat = 1; repeat <= 3; ++repeat) {
    for (const mode of repeat % 2 ? ['auto', 'rule-goals'] : ['rule-goals', 'auto']) {
        const rows = run(mode, repeat);
        assert.equal(rows.length, expected);
        assert(rows.every(row => ['solved', 'timeout', 'exhausted'].includes(row.status)));
        assert(rows.every(row => !row.compiled_rules_attached && !row.compiled_tick_attached && row.exact_state_keys && row.compact_node_storage));
        const newKeys = rows.map(row => `${row.game}#${row.level}`);
        if (keys) assert.deepEqual(newKeys, keys); else keys = newKeys;
    }
}
console.log(`Completed three pairs over ${expected} levels; all wins passed native replay.`);
