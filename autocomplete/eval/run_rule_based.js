'use strict';
// Phase 1, baseline 1: the deterministic completer on rest_of_token, scored at its own
// replacement range.
//
//   node autocomplete/eval/run_rule_based.js [--data DIR] [--split val|test]
//
// Writes <data>/eval/preds/rule_based_<split>.jsonl with {i, prediction, candidates, latency_ms}.
// prediction = the first candidate's text beyond the characters already typed; candidates =
// every candidate's remainder (for the "any candidate exact" column). Cases of other tasks
// get no row (coverage 0), since the completer does not perform them.

const fs = require('fs');
const path = require('path');
const engine = require('./engine.js');

// The target is removed first, as for every system: the completer sees the document the
// way the user does while typing, with nothing after the cursor on the current token.
function predictCase(fullText, c) {
    const text = fullText.slice(0, c.from) + fullText.slice(c.to);
    const t0 = process.hrtime.bigint();
    const result = engine.completeAt(text, c.from);
    const latency = Number(process.hrtime.bigint() - t0) / 1e6;
    const typed = text.slice(result.from, c.from);
    const remainders = [];
    for (const item of result.list) {
        if (!item.text || item.text.length <= typed.length) continue;
        if (item.text.slice(0, typed.length).toLowerCase() !== typed.toLowerCase()) continue;
        remainders.push(item.text.slice(typed.length));
    }
    return { prediction: remainders.length ? remainders[0] : null, candidates: remainders, latency_ms: Math.round(latency * 100) / 100 };
}

function runRuleBased({ dataDir, split, quiet }) {
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');
    const tasks = JSON.parse(fs.readFileSync(path.join(dataDir, 'eval', `tasks_${split}.json`), 'utf8'));
    const textDir = path.join(dataDir, 'raw', 'text');
    const texts = new Map();
    const text = id => { if (!texts.has(id)) texts.set(id, fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8')); return texts.get(id); };
    const outDir = path.join(dataDir, 'eval', 'preds');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `rule_based_${split}.jsonl`);
    const fd = fs.openSync(outPath, 'w');
    let n = 0, covered = 0;
    tasks.cases.forEach((c, i) => {
        if (c.task !== 'rest_of_token') return;
        const p = predictCase(text(c.id), c);
        fs.writeSync(fd, JSON.stringify(Object.assign({ i }, p)) + '\n');
        n++;
        if (p.prediction !== null) covered++;
    });
    fs.closeSync(fd);
    log(`rule_based: ${split}: ${n} cases, ${covered} with a suggestion -> ${outPath}`);
    return outPath;
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
    }
    return args;
}

if (require.main === module) {
    const { resolvePaths } = require('../pipeline/paths.js');
    const args = parseArgs(process.argv.slice(2));
    runRuleBased({ dataDir: args.data || resolvePaths().dataDir, split: args.split || 'val' });
}

module.exports = { runRuleBased, predictCase };
