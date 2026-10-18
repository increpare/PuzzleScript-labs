'use strict';
// Phase 1, baseline 2: section-aware Kneser-Ney 5-gram, trained on the train split.
//
//   node --max-old-space-size=12288 autocomplete/eval/run_ngram.js [--data DIR] [--split val|test] [--order 5] [--max-files N]
//
// Writes <data>/eval/preds/ngram_<split>.jsonl         all four tasks, greedy decoding
//        <data>/eval/preds/ngram_rerank_<split>.jsonl  rest_of_token: the deterministic completer's
//                                                      candidates re-ranked by n-gram probability
// The target is removed from the document before predicting; only the prefix is used.

const fs = require('fs');
const path = require('path');
const ngram = require('./ngram.js');
const engine = require('./engine.js');

function trainModel({ dataDir, order, maxFiles, log }) {
    const splits = JSON.parse(fs.readFileSync(path.join(dataDir, 'splits.json'), 'utf8'));
    const textDir = path.join(dataDir, 'raw', 'text');
    const model = new ngram.KneserNey(order);
    let n = 0;
    const t0 = Date.now();
    for (const lineage of splits.train) {
        for (const id of lineage.file_ids) {
            model.train(fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8'));
            n++;
            if (maxFiles && n >= maxFiles) break;
            if (n % 2000 === 0) log(`ngram: trained ${n} files, heap ${(process.memoryUsage().heapUsed / 1e9).toFixed(2)} GB`);
        }
        if (maxFiles && n >= maxFiles) break;
    }
    model.finalize();
    log(`ngram: trained on ${n} files in ${((Date.now() - t0) / 1000).toFixed(0)}s, heap ${(process.memoryUsage().heapUsed / 1e9).toFixed(2)} GB`);
    return model;
}

// Split the prefix text into history tokens and the partial token at the cursor, if any.
function historyAndPrefix(prefixText) {
    const { tokens } = ngram.tokenize(prefixText);
    const partial = prefixText.length > 0 && !/\s$/.test(prefixText) && tokens.length && tokens[tokens.length - 1] !== ngram.NL;
    if (partial) return { history: tokens.slice(0, -1), prefix: tokens[tokens.length - 1] };
    return { history: tokens, prefix: null };
}

function predictCase(model, fullText, c) {
    const doc = fullText.slice(0, c.from) + fullText.slice(c.to);
    const t0 = process.hrtime.bigint();
    const { history, prefix } = historyAndPrefix(doc.slice(0, c.from));
    let prediction = null;
    let candidates;
    if (c.task === 'rest_of_token') {
        const m = model.sectionModel(c.section);
        const list = m.candidates(history, prefix || '');
        const scored = list.map(w => ({ w, p: m.prob(history, w) })).sort((a, b) => b.p - a.p).slice(0, 5);
        candidates = scored.map(s => s.w.slice((prefix || '').length));
        prediction = candidates.length ? candidates[0] : null;
    } else {
        const stop = c.task === 'next_block' ? 'block' : 'line';
        const out = model.generate(c.section, history, { stop, maxTokens: c.task === 'next_block' ? 120 : 40, prefix });
        let text = out.text;
        if (prefix && text.toLowerCase().startsWith(prefix.toLowerCase())) text = text.slice(prefix.length);
        // An empty generation (the model chose a newline first) is a prediction of an empty
        // line, not an abstention: it counts as covered and wrong.
        prediction = text;
    }
    const latency = Number(process.hrtime.bigint() - t0) / 1e6;
    const row = { prediction, latency_ms: Math.round(latency * 100) / 100 };
    if (candidates) row.candidates = candidates;
    return row;
}

function rerankCase(model, fullText, c) {
    const doc = fullText.slice(0, c.from) + fullText.slice(c.to);
    const t0 = process.hrtime.bigint();
    const result = engine.completeAt(doc, c.from);
    const typed = doc.slice(result.from, c.from);
    const { history } = historyAndPrefix(doc.slice(0, result.from));
    const scored = [];
    for (const item of result.list) {
        if (!item.text || item.text.length <= typed.length) continue;
        if (item.text.slice(0, typed.length).toLowerCase() !== typed.toLowerCase()) continue;
        const tokens = item.text.trim().split(/\s+/);
        scored.push({ rest: item.text.slice(typed.length), lp: model.sequenceLogProb(c.section, history, tokens) });
    }
    scored.sort((a, b) => b.lp - a.lp);
    const latency = Number(process.hrtime.bigint() - t0) / 1e6;
    return { prediction: scored.length ? scored[0].rest : null, candidates: scored.map(s => s.rest), latency_ms: Math.round(latency * 100) / 100 };
}

function runNgram({ dataDir, split, order, maxFiles, quiet }) {
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');
    const model = trainModel({ dataDir, order: order || 5, maxFiles, log });
    const tasks = JSON.parse(fs.readFileSync(path.join(dataDir, 'eval', `tasks_${split}.json`), 'utf8'));
    const textDir = path.join(dataDir, 'raw', 'text');
    const texts = new Map();
    const text = id => { if (!texts.has(id)) texts.set(id, fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8')); return texts.get(id); };
    const outDir = path.join(dataDir, 'eval', 'preds');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `ngram_${split}.jsonl`);
    const rerankPath = path.join(outDir, `ngram_rerank_${split}.jsonl`);
    const fd = fs.openSync(outPath, 'w');
    const fdr = fs.openSync(rerankPath, 'w');
    const t0 = Date.now();
    tasks.cases.forEach((c, i) => {
        fs.writeSync(fd, JSON.stringify(Object.assign({ i }, predictCase(model, text(c.id), c))) + '\n');
        if (c.task === 'rest_of_token') fs.writeSync(fdr, JSON.stringify(Object.assign({ i }, rerankCase(model, text(c.id), c))) + '\n');
        if ((i + 1) % 1000 === 0) log(`ngram: predicted ${i + 1}/${tasks.cases.length}`);
    });
    fs.closeSync(fd);
    fs.closeSync(fdr);
    log(`ngram: ${split}: ${tasks.cases.length} cases in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${outPath}, ${rerankPath}`);
    return { outPath, rerankPath };
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
    runNgram({
        dataDir: args.data || resolvePaths().dataDir,
        split: args.split || 'val',
        order: args.order ? parseInt(args.order, 10) : 5,
        maxFiles: args['max-files'] ? parseInt(args['max-files'], 10) : 0,
    });
}

module.exports = { runNgram, trainModel, predictCase, rerankCase, historyAndPrefix };
