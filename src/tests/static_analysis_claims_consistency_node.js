#!/usr/bin/env node
'use strict';

// Cross-family consistency audit for static-analysis reports.
//
// Analyzes every game in the solver corpus and fails on claim combinations
// that are internally contradictory:
//   - cosmetic objects appearing in win conditions
//   - static layers containing non-static member objects
//   - merge candidates pairing a cosmetic with a non-cosmetic object
//   - objects tagged both temporary and static while present in levels
//   - analyzeSource throwing (rather than reporting a compile error)
//
// Differences in granularity between independent analyses are expected and
// reported as informational stats only — e.g. `may_be_created` (some rule has
// the object on its RHS where it was not required) is coarser than
// `quantity.never_increases` (no rule can increase the global count): a
// movement rule creates the object in one cell while deleting it in another.

const fs = require('fs');
const path = require('path');

const { analyzeSource } = require('./ps_static_analysis');

const corpusDir = path.join(__dirname, 'solver_tests');
const games = fs.readdirSync(corpusDir).filter(name => name.endsWith('.txt')).sort();

const violations = [];
const stats = {
    analyzed: 0,
    compileErrors: 0,
    createdButNeverIncreases: 0,
    destroyedButNeverDecreases: 0,
    inertCountChangeDisagreements: 0,
};

for (const game of games) {
    const source = fs.readFileSync(path.join(corpusDir, game), 'utf8');
    let report;
    try {
        report = analyzeSource(source, { sourcePath: game });
    } catch (error) {
        violations.push(`${game}: analyzeSource threw: ${String(error && error.message).split('\n')[0]}`);
        continue;
    }
    if (report.status !== 'ok') {
        stats.compileErrors++;
        continue;
    }
    stats.analyzed++;
    const tagged = report.ps_tagged;
    const objByName = new Map(tagged.objects.map(object => [object.name, object]));
    const winObjects = new Set();
    for (const win of tagged.winconditions || []) {
        for (const name of win.tags.objects_matched || []) winObjects.add(name);
        for (const name of win.tags.object_absences_matched || []) winObjects.add(name);
    }

    for (const object of tagged.objects) {
        const tags = object.tags || {};
        if (tags.cosmetic && winObjects.has(object.name)) {
            violations.push(`${game}: cosmetic object ${object.name} appears in win conditions`);
        }
        if (tags.temporary && tags.static && tags.present_in_some_levels) {
            violations.push(`${game}: object ${object.name} both temporary and static while present in levels`);
        }
        if (tags.quantity && tags.quantity.never_increases && tags.may_be_created === true) {
            stats.createdButNeverIncreases++;
        }
        if (tags.quantity && tags.quantity.never_decreases && tags.may_be_destroyed === true) {
            stats.destroyedButNeverDecreases++;
        }
        if (tags.may_be_created === false && tags.may_be_destroyed === false && tags.quantity
            && !(tags.quantity.never_increases && tags.quantity.never_decreases)) {
            stats.inertCountChangeDisagreements++;
        }
    }

    for (const layer of tagged.collision_layers || []) {
        if (!layer.tags || layer.tags.static !== true) continue;
        for (const name of layer.objects || []) {
            const object = objByName.get(name);
            if (object && object.tags && object.tags.static !== true) {
                violations.push(`${game}: layer ${layer.id} static but member ${name} is not static`);
            }
        }
    }

    for (const fact of (report.facts && report.facts.mergeability) || []) {
        if (fact.status !== 'candidate') continue;
        const pair = fact.subjects.objects;
        const cosmetics = pair.map(name => {
            const object = objByName.get(name);
            return object && object.tags ? Boolean(object.tags.cosmetic) : null;
        });
        if (cosmetics[0] !== cosmetics[1]) {
            violations.push(`${game}: merge candidate ${pair.join('+')} mixes cosmetic and non-cosmetic`);
        }
    }
}

process.stderr.write(
    `static_analysis_claims_consistency_node: analyzed=${stats.analyzed} compile_errors=${stats.compileErrors}`
    + ` created_but_never_increases=${stats.createdButNeverIncreases}`
    + ` destroyed_but_never_decreases=${stats.destroyedButNeverDecreases}`
    + ` inert_count_disagreements=${stats.inertCountChangeDisagreements}\n`
);

if (violations.length > 0) {
    for (const violation of violations) {
        process.stderr.write(`static_analysis_claims_consistency_node: VIOLATION ${violation}\n`);
    }
    process.stderr.write('static_analysis_claims_consistency_node: failed\n');
    process.exit(1);
}
console.log('static_analysis_claims_consistency_node: ok');
