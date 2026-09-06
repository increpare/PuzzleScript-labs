#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { summarize } = require('./survey_future_object_universe');
const [output, ...inputs] = process.argv.slice(2);
if (!output || !inputs.length) throw new Error('Usage: node summarize_future_universe_survey.js output.json shard.json ...');
const shards = inputs.map(p => JSON.parse(fs.readFileSync(p, 'utf8')));
const rows = shards.flatMap(s => s.rows).sort((a,b) => a.source.localeCompare(b.source));
assert.strictEqual(new Set(rows.map(r => r.sha256)).size, rows.length, 'duplicate source across shards');
const channels = {};
for (const row of rows) for (const level of row.levels || []) {
    if (level.status === 'error') continue;
    for (const [name, values] of Object.entries(level.channels)) {
        const target = channels[name] ||= { transitions: 0, loss_transitions: 0, preventing_transitions: 0 };
        for (const field of Object.keys(target)) target[field] += values[field];
    }
}
const result = {
    schema: 'future-object-universe-survey-v1', scope: shards[0].scope,
    inputs: shards.map(s => s.options), totals: summarize(rows), channels, rows,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result)+'\n');
console.log(JSON.stringify({ totals: result.totals, channels }, null, 2));
