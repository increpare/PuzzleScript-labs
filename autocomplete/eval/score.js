'use strict';
// Phase 1, step 4.2: score a predictions file against a task set.
//
//   node autocomplete/eval/score.js --tasks <data>/eval/tasks_val.json --predictions <file.jsonl> [--name NAME] [--no-compile]
//
// Predictions JSONL, one row per case: {i, prediction, latency_ms?, candidates?}
//   i            index of the case in the task file
//   prediction   string, or null when the system made no suggestion
//   candidates   optional list of alternative predictions (rest_of_token: "any candidate exact")
//
// Per task, per section (RULES always on its own row) and overall:
//   n, coverage, exact (over covered), exact_all (over all, null = miss), edit_sim (over covered),
//   any_exact (rest_of_token, any candidate matches), compile_valid (covered cases whose source
//   compiles; the prediction spliced in still compiles; the ground truth is 100% by construction),
//   symbol_valid (section-aware, covered cases), latency_ms median when reported.
// Writes <tasks dir>/scores/<name>.json and <name>.md.

const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('./engine.js');
const { compileMany } = require('../pipeline/compile_filter.js');
const { extractSymbols } = require('../pipeline/symbols.js');
const { stripComments } = require('../pipeline/text_util.js');

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;
const SYMBOL_SECTIONS = new Set(['rules', 'collisionlayers', 'winconditions', 'sounds', 'legend']);

function normalise(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, cur] = [cur, prev];
    }
    return prev[b.length];
}

function editSimilarity(a, b) {
    const na = normalise(a), nb = normalise(b);
    const m = Math.max(na.length, nb.length);
    return m === 0 ? 1 : 1 - levenshtein(na, nb) / m;
}

function identifiers(text) {
    const out = [];
    IDENT.lastIndex = 0;
    let m;
    while ((m = IDENT.exec(text)) !== null) out.push(m[0].toLowerCase());
    return out;
}

// Section-aware symbol validity. `symbols` is the lowercase set of names declared in the
// full original file. Returns null when the check does not apply to the section.
function symbolValid(section, prediction, symbols, keywordSet) {
    if (!SYMBOL_SECTIONS.has(section)) return null;
    const text = stripComments(prediction);
    if (section === 'legend') {
        // Only references on the right of '=' must exist; the left declares.
        let ok = true;
        for (const line of text.split('\n')) {
            const eq = line.indexOf('=');
            if (eq < 0) continue;
            for (const id of identifiers(line.slice(eq + 1))) {
                if (id === 'or' || id === 'and') continue;
                if (!symbols.has(id)) ok = false;
            }
        }
        return ok;
    }
    for (let line of text.split('\n')) {
        // Free text after `message` is not a symbol reference.
        const msg = /\bmessage\b/i.exec(line);
        if (msg) line = line.slice(0, msg.index);
        for (const id of identifiers(line)) {
            if (keywordSet.has(id) || symbols.has(id)) continue;
            if (/^sfx\d+$/.test(id)) continue;
            return false;
        }
    }
    return true;
}

function median(values) {
    if (values.length === 0) return null;
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function readJsonl(p) {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

async function scorePredictions({ tasksPath, predictionsPath, name, dataDir, compile = true, workers, quiet }) {
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');
    const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    const predictions = new Map(readJsonl(predictionsPath).map(r => [r.i, r]));
    dataDir = dataDir || path.resolve(path.dirname(tasksPath), '..');
    const textDir = path.join(dataDir, 'raw', 'text');
    const texts = new Map();
    const symbolCache = new Map();
    const text = id => { if (!texts.has(id)) texts.set(id, fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8')); return texts.get(id); };
    const symbolsOf = id => {
        if (!symbolCache.has(id)) {
            const s = extractSymbols(text(id));
            symbolCache.set(id, new Set([...s.objects, ...s.legend].map(x => x.toLowerCase())));
        }
        return symbolCache.get(id);
    };
    const keywordSet = engine.keywords();

    // The lines of the document that the spliced prediction lands on (so a token remainder
    // like "ayer" is judged as the whole token "Player", with whatever was typed before it).
    const splicedLines = (c, prediction) => {
        const src = text(c.id);
        const spliced = src.slice(0, c.from) + prediction + src.slice(c.to);
        const start = spliced.lastIndexOf('\n', c.from - 1) + 1;
        let end = spliced.indexOf('\n', c.from + prediction.length);
        if (end < 0) end = spliced.length;
        return spliced.slice(start, end);
    };

    // Per-case results.
    const perCase = tasks.cases.map((c, i) => {
        const p = predictions.get(i);
        const covered = !!(p && typeof p.prediction === 'string');
        const r = { i, task: c.task, section: c.section, covered, compiles: c.compiles };
        if (covered) {
            r.exact = normalise(p.prediction) === normalise(c.target);
            r.edit_sim = editSimilarity(p.prediction, c.target);
            r.symbol_valid = symbolValid(c.section, splicedLines(c, p.prediction), symbolsOf(c.id), keywordSet);
            if (typeof p.latency_ms === 'number') r.latency_ms = p.latency_ms;
            if (Array.isArray(p.candidates)) r.any_exact = p.candidates.some(x => normalise(x) === normalise(c.target));
        }
        return r;
    });

    // Compile validity: splice covered predictions into compiling sources, compile in workers.
    if (compile) {
        const spliceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-score-'));
        const toCompile = [];
        for (const r of perCase) {
            if (!r.covered || !r.compiles) continue;
            const c = tasks.cases[r.i];
            const src = text(c.id);
            const spliced = src.slice(0, c.from) + predictions.get(r.i).prediction + src.slice(c.to);
            const id = 'case' + r.i;
            fs.writeFileSync(path.join(spliceDir, id + '.txt'), spliced, 'utf8');
            toCompile.push(id);
        }
        log(`score: compiling ${toCompile.length} spliced sources`);
        const results = await compileMany({ textDir: spliceDir, ids: toCompile, workers, log });
        for (const r of perCase) {
            const row = results.get('case' + r.i);
            if (row) r.compile_valid = row.status === 'ok' || row.status === 'warnings';
        }
        fs.rmSync(spliceDir, { recursive: true, force: true });
    }

    // Aggregate per task x section, plus overall.
    const tables = {};
    for (const task of Object.keys(tasks.counts)) {
        const rows = {};
        const sections = [...new Set(perCase.filter(r => r.task === task).map(r => r.section))].sort();
        for (const section of [...sections, 'overall']) {
            const items = perCase.filter(r => r.task === task && (section === 'overall' || r.section === section));
            const covered = items.filter(r => r.covered);
            const mean = (list, key) => { const v = list.filter(r => typeof r[key] === 'number' || typeof r[key] === 'boolean'); return v.length ? v.reduce((a, r) => a + Number(r[key]), 0) / v.length : null; };
            const row = {
                n: items.length,
                coverage: items.length ? covered.length / items.length : 0,
                exact: mean(covered, 'exact'),
                exact_all: items.length ? covered.filter(r => r.exact).length / items.length : 0,
                edit_sim: mean(covered, 'edit_sim'),
                any_exact: mean(covered, 'any_exact'),
                compile_valid: mean(covered, 'compile_valid'),
                compile_n: covered.filter(r => typeof r.compile_valid === 'boolean').length,
                symbol_valid: mean(covered, 'symbol_valid'),
                symbol_n: covered.filter(r => typeof r.symbol_valid === 'boolean').length,
                latency_ms: median(covered.filter(r => typeof r.latency_ms === 'number').map(r => r.latency_ms)),
            };
            rows[section] = row;
        }
        tables[task] = rows;
    }

    const out = { name, tasks: path.basename(tasksPath), predictions: path.basename(predictionsPath), tables };
    const scoresDir = path.join(path.dirname(tasksPath), 'scores');
    fs.mkdirSync(scoresDir, { recursive: true });
    fs.writeFileSync(path.join(scoresDir, name + '.json'), JSON.stringify(out, null, 2) + '\n');
    fs.writeFileSync(path.join(scoresDir, name + '.md'), renderMarkdown(out));
    return out;
}

function fmt(v, pct = true) {
    if (v === null || v === undefined) return '-';
    return pct ? (v * 100).toFixed(1) : String(Math.round(v * 10) / 10);
}

function renderMarkdown(out) {
    const lines = [`# ${out.name}`, '', `Tasks: ${out.tasks}. Predictions: ${out.predictions}. Percentages; exact/edit_sim/validity over covered cases, exact_all over all cases.`, ''];
    for (const [task, rows] of Object.entries(out.tables)) {
        lines.push(`## ${task}`, '', '| section | n | coverage | exact | exact_all | edit_sim | any_exact | compile_valid (n) | symbol_valid (n) | latency_ms |', '|---|---|---|---|---|---|---|---|---|---|');
        const order = Object.keys(rows).filter(s => s !== 'overall' && s !== 'rules');
        for (const section of ['rules', ...order, 'overall']) {
            const r = rows[section];
            if (!r) continue;
            lines.push(`| ${section} | ${r.n} | ${fmt(r.coverage)} | ${fmt(r.exact)} | ${fmt(r.exact_all)} | ${fmt(r.edit_sim)} | ${fmt(r.any_exact)} | ${fmt(r.compile_valid)} (${r.compile_n}) | ${fmt(r.symbol_valid)} (${r.symbol_n}) | ${fmt(r.latency_ms, false)} |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const key = argv[i].slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) args[key] = true; else { args[key] = next; i++; }
    }
    return args;
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    if (!args.tasks || !args.predictions) {
        console.error('usage: node autocomplete/eval/score.js --tasks tasks_val.json --predictions preds.jsonl [--name NAME] [--no-compile]');
        process.exit(2);
    }
    const name = args.name || path.basename(args.predictions).replace(/\.jsonl$/, '');
    scorePredictions({ tasksPath: args.tasks, predictionsPath: args.predictions, name, dataDir: args.data, compile: !args['no-compile'], workers: args.workers ? parseInt(args.workers, 10) : undefined })
        .then(out => { console.log(renderMarkdown(out)); })
        .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { scorePredictions, editSimilarity, levenshtein, normalise, symbolValid, renderMarkdown };
