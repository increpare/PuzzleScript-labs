'use strict';

// JS<->C++ SemanticProgram parity over a corpus.
//
// The contract assumes the single-layer invariant (every object on exactly one
// collision layer). The engine only warns on violations, so this runner skips
// non-conforming games (reporting them, never silently) and asserts byte-level
// (canonicalized) parity only over the conforming set. Exits non-zero on any
// conforming-game mismatch.
//
// Usage: node src/tests/semantic_program_parity_corpus_node.js <puzzlescript_cpp> <corpus_dir>

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');
const {
    buildSemanticProgramSnapshot,
    validateSingleLayerObjects,
} = require('./js_oracle/lib/puzzlescript_semantic_program');

function canonical(value) {
    const sort = (v) => (Array.isArray(v)
        ? v.map(sort)
        : (v && typeof v === 'object'
            ? Object.keys(v).sort().reduce((acc, k) => { acc[k] = sort(v[k]); return acc; }, {})
            : v));
    return JSON.stringify(sort(value), null, 2);
}

function jsSemanticProgram(source) {
    unitTesting = true;
    lazyFunctionGeneration = false;
    try {
        errorCount = 0;
        compile(['restart'], `${source}\n`, null);
    } finally {
        unitTesting = false;
        lazyFunctionGeneration = true;
    }
    if (errorCount > 0) {
        return null; // compile error — out of parity scope
    }
    return buildSemanticProgramSnapshot(state);
}

function cppSemanticProgram(cliPath, gamePath) {
    const result = spawnSync(cliPath, ['compile', gamePath, '--emit-semantic-program'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        return null;
    }
    try {
        return JSON.parse(result.stdout);
    } catch (e) {
        return null;
    }
}

function main() {
    if (process.argv.length < 4) {
        console.error('Usage: node src/tests/semantic_program_parity_corpus_node.js <puzzlescript_cpp> <corpus_dir>');
        process.exit(2);
    }
    const cliPath = path.resolve(process.argv[2]);
    const corpusDir = path.resolve(process.argv[3]);

    const games = fs.readdirSync(corpusDir).filter((name) => name.endsWith('.txt')).sort();

    loadPuzzleScript();

    let matched = 0;
    const nonConforming = [];
    const outOfScope = [];
    const failures = [];

    for (const game of games) {
        const gamePath = path.join(corpusDir, game);
        const source = fs.readFileSync(gamePath, 'utf8');

        let js;
        try {
            js = jsSemanticProgram(source);
        } catch (e) {
            js = null;
        }
        if (js === null) {
            outOfScope.push(`${game} (js compile)`);
            continue;
        }

        const cpp = cppSemanticProgram(cliPath, gamePath);
        if (cpp === null) {
            outOfScope.push(`${game} (cpp compile)`);
            continue;
        }

        const violations = validateSingleLayerObjects(js).concat(validateSingleLayerObjects(cpp));
        if (violations.length > 0) {
            nonConforming.push(`${game}: ${violations[0]}`);
            continue;
        }

        if (canonical(js) !== canonical(cpp)) {
            failures.push(game);
        } else {
            matched += 1;
        }
    }

    console.log(`SemanticProgram JS<->C++ parity over ${games.length} games in ${path.relative(process.cwd(), corpusDir)}`);
    console.log(`  conforming + parity-matched: ${matched}`);
    console.log(`  skipped (single-layer invariant violated): ${nonConforming.length}`);
    for (const item of nonConforming) {
        console.log(`      - ${item}`);
    }
    console.log(`  skipped (compile error / out of scope): ${outOfScope.length}`);

    if (failures.length > 0) {
        console.log(`  PARITY FAILURES: ${failures.length}`);
        for (const game of failures) {
            console.log(`      ! ${game}`);
        }
        process.exit(1);
    }
    console.log('  parity failures: 0');
}

main();
