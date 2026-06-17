#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function usage() {
    console.error('Usage: node src/tests/generate_mismatch_manifest.js <triage.json> <source-manifest.json> <out.json>');
    process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 3) {
    usage();
}

const triagePath = path.resolve(args[0]);
const sourceManifestPath = path.resolve(args[1]);
const outPath = path.resolve(args[2]);

const triage = JSON.parse(fs.readFileSync(triagePath, 'utf8'));
const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
const sourceByKey = new Map(
    (sourceManifest.targets || []).map((target) => [`${target.game}#${target.level}`, target])
);

const targets = [];
for (const row of triage.rows || []) {
    const key = row.key || `${row.game}#${row.level}`;
    const source = sourceByKey.get(key);
    if (!source) {
        throw new Error(`missing source manifest target for ${key}`);
    }
    targets.push({
        game: row.game,
        level: row.level,
        timeout_ms: source.timeout_ms || source.first_solved_timeout_ms || sourceManifest.timeout_ms,
        first_solved_timeout_ms: source.first_solved_timeout_ms || source.timeout_ms || sourceManifest.timeout_ms,
    });
}

targets.sort((left, right) => (
    left.game === right.game
        ? left.level - right.level
        : left.game.localeCompare(right.game)
));

const manifest = {
    schema_version: 1,
    kind: 'solver_corpus_mismatch_group',
    generated_at: new Date().toISOString(),
    source_triage: triagePath,
    source_manifest: sourceManifestPath,
    corpus: sourceManifest.corpus,
    strategy: sourceManifest.strategy || 'weighted-astar',
    timeout_ms: sourceManifest.timeout_ms || 10000,
    target_count: targets.length,
    targets,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`generate_mismatch_manifest wrote ${outPath} targets=${targets.length}\n`);
