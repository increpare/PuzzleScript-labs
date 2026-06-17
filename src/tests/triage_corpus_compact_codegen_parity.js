#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const interpretedPath = path.resolve(process.argv[2] || 'build/native/solver_corpus_benchmark_interpreted_compact_codegen.json');
const compiledPath = path.resolve(process.argv[3] || 'build/native/solver_corpus_benchmark_compiled_compact_codegen.json');

function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function targetKey(target) {
    return `${target.game}#${target.level}`;
}

function dominantStatus(sample) {
    return sample.status;
}

function isWorkMismatch(row) {
    const interpreted = row.interpreted.status;
    const compiled = row.compiled.status;
    if (interpreted === 'timeout' && (compiled === 'timeout' || compiled === 'solved')) {
        return false;
    }
    if (interpreted !== compiled) {
        return true;
    }
    return row.interpreted.generated !== row.compiled.generated
        || row.interpreted.expanded !== row.compiled.expanded;
}

function main() {
    const interpreted = loadJson(interpretedPath);
    const compiled = loadJson(compiledPath);
    const compiledByKey = new Map(compiled.targets.map((target) => [targetKey(target), target]));

    const rows = [];
    for (const target of interpreted.targets) {
        const compiledTarget = compiledByKey.get(targetKey(target));
        if (!compiledTarget) {
            throw new Error(`missing compiled target for ${targetKey(target)}`);
        }
        const interpretedSample = target.samples[0];
        const compiledSample = compiledTarget.samples[0];
        const row = {
            key: targetKey(target),
            game: target.game,
            level: target.level,
            interpreted: {
                status: interpretedSample.status,
                generated: interpretedSample.generated,
                expanded: interpretedSample.expanded,
                elapsed_ms: interpretedSample.elapsed_ms,
            },
            compiled: {
                status: compiledSample.status,
                generated: compiledSample.generated,
                expanded: compiledSample.expanded,
                elapsed_ms: compiledSample.elapsed_ms,
                compact_turn_native_hits: compiledSample.compact_turn_native_hits || 0,
                compact_turn_bridge_hits: compiledSample.compact_turn_bridge_hits || 0,
                compact_turn_attempts: compiledSample.compact_turn_attempts || 0,
            },
        };
        if (isWorkMismatch(row)) {
            row.kind = `${row.interpreted.status}->${row.compiled.status}`;
            rows.push(row);
        }
    }

    const byGame = new Map();
    for (const row of rows) {
        if (!byGame.has(row.game)) {
            byGame.set(row.game, {
                game: row.game,
                kind: row.kind,
                levels: [],
                nativeHits: 0,
                bridgeHits: 0,
            });
        }
        const entry = byGame.get(row.game);
        entry.levels.push(row.level);
        entry.nativeHits = Math.max(entry.nativeHits, row.compiled.compact_turn_native_hits);
        entry.bridgeHits = Math.max(entry.bridgeHits, row.compiled.compact_turn_bridge_hits);
    }

    const byKind = {};
    for (const row of rows) {
        byKind[row.kind] = (byKind[row.kind] || 0) + 1;
    }

    const report = {
        schema_version: 1,
        interpreted: interpretedPath,
        compiled: compiledPath,
        work_mismatch_count: rows.length,
        by_kind: byKind,
        by_game: Array.from(byGame.values())
            .map((entry) => ({
                ...entry,
                level_count: entry.levels.length,
            }))
            .sort((left, right) => right.level_count - left.level_count || left.game.localeCompare(right.game)),
        rows: rows.sort((left, right) => left.key.localeCompare(right.key)),
    };

    const outPath = path.resolve(process.argv[4] || 'build/native/solver_corpus_compact_codegen_parity_triage.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

    process.stdout.write(`triage_corpus_compact_codegen_parity work_mismatches=${rows.length}\n`);
    for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`  ${kind}: ${count}\n`);
    }
    process.stdout.write(`triage wrote ${outPath}\n`);
}

main();
