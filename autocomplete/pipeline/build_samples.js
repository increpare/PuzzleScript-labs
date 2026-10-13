'use strict';
// Phase 0, step 3.6: turn split files into training samples through the shared context builder.
//
//   node autocomplete/pipeline/build_samples.js [--data DIR] [--seed N] [--fim-rate 0.5]
//
// Reads  <data>/splits.json, <data>/compile.jsonl, <data>/raw/text/<id>.txt
// Writes <data>/samples/train.jsonl, <data>/samples/val.jsonl
//          {id, kind: causal|fim_psm|fim_spm, section, text, spans: [{start, end, kind, section, weight}]}
//        <data>/samples/samples_stats.json
//
// Per file: one causal sample (levels trimmed to the first three plus messages; no header,
// no prefix) and, at --fim-rate, one FIM sample whose split point is half at a line boundary
// and half at a random character, with a target of the rest of the line (50%), the next
// 2-8 lines (25%) or a 1-200 char span (25%). PSM and SPM alternate.
// Loss weights: level map rows 0.2, prelude author/homepage lines 0, everything else 1,
// multiplied by 0.3 for files that do not compile. Header and markers weigh 0.

const fs = require('fs');
const path = require('path');
const ctx = require('./context.js');
const { extractSymbols } = require('./symbols.js');
const { mulberry32 } = require('./split.js');

const BROKEN_MULTIPLIER = 0.3;
const LEVEL_ROW_WEIGHT = 0.2;

function seededRandom(seed) { return mulberry32(seed); }

function weightFor(broken) {
    const mult = broken ? BROKEN_MULTIPLIER : 1;
    return (section, kind, line) => {
        const trimmed = (line || '').trim();
        if (section === 'levels' && trimmed !== '' && !/^message\b/i.test(trimmed)) return LEVEL_ROW_WEIGHT * mult;
        if (section === 'prelude' && /^(author|homepage)\b/i.test(trimmed)) return 0;
        return 1 * mult;
    };
}

// Pick the FIM split point and target span. Lines are chosen with level map rows
// down-weighted so LEVELS does not dominate the sample mix.
function chooseFimSpan(text, rand) {
    const lines = text.split('\n');
    const sections = ctx.lineSections(text);
    const starts = [];
    let pos = 0;
    for (const l of lines) { starts.push(pos); pos += l.length + 1; }
    const weights = lines.map((l, i) => {
        if (l.trim() === '') return 0.05;
        if (sections[i] === 'levels' && !/^\s*message\b/i.test(l)) return LEVEL_ROW_WEIGHT;
        return 1;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let li = 0;
    for (; li < lines.length - 1; li++) { r -= weights[li]; if (r <= 0) break; }

    const lineStart = starts[li];
    const lineEnd = Math.min(text.length, lineStart + lines[li].length + 1); // includes newline
    const atBoundary = rand() < 0.5;
    const from = atBoundary ? lineStart : lineStart + Math.floor(rand() * Math.max(1, lines[li].length));

    const mode = rand();
    let to;
    if (mode < 0.5) {
        to = lineEnd;
    } else if (mode < 0.75) {
        const n = 2 + Math.floor(rand() * 7);
        const endLine = Math.min(lines.length - 1, li + n - 1);
        to = Math.min(text.length, starts[endLine] + lines[endLine].length + 1);
    } else {
        to = Math.min(text.length, from + 1 + Math.floor(rand() * 200));
    }
    if (to <= from) to = Math.min(text.length, from + 1);
    return { from, to };
}

function readJsonl(p) {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

function compactSpans(spans) {
    return spans.map(s => ({ start: s.start, end: s.end, kind: s.kind, section: s.section, weight: s.weight }));
}

function buildFileSamples(id, text, broken, rand, fimRate, config) {
    const out = [];
    const weight = weightFor(broken);

    const trimmed = ctx.trimLevels(text, { keep: (config && config.keepLevels) || ctx.DEFAULT_CONFIG.keepLevels }).text;
    const causal = ctx.buildContext({ text: trimmed, from: 0, to: trimmed.length, symbols: () => null, config });
    const rc = ctx.render(causal, 'psm', weight);
    out.push({ id, kind: 'causal', section: 'prelude', text: rc.text, spans: compactSpans(rc.spans) });

    if (rand() < fimRate) {
        const { from, to } = chooseFimSpan(text, rand);
        const fim = ctx.buildContext({ text, from, to, symbols: doc => extractSymbols(doc), config });
        const mode = rand() < 0.5 ? 'psm' : 'spm';
        const rf = ctx.render(fim, mode, weight);
        out.push({ id, kind: 'fim_' + mode, section: fim.sectionAtCursor, text: rf.text, spans: compactSpans(rf.spans) });
    }
    return out;
}

function runBuildSamples({ dataDir, seed, fimRate, config, quiet }) {
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');
    seed = seed === undefined ? 20261013 : seed;
    fimRate = fimRate === undefined ? 0.5 : fimRate;
    const textDir = path.join(dataDir, 'raw', 'text');
    const splits = JSON.parse(fs.readFileSync(path.join(dataDir, 'splits.json'), 'utf8'));
    const status = new Map(readJsonl(path.join(dataDir, 'compile.jsonl')).map(r => [r.id, r.status]));
    const outDir = path.join(dataDir, 'samples');
    fs.mkdirSync(outDir, { recursive: true });

    const stats = { seed, fim_rate: fimRate, config: Object.assign({}, ctx.DEFAULT_CONFIG, config || {}) };
    for (const name of ['train', 'val']) {
        const rand = seededRandom(seed + (name === 'val' ? 1 : 0));
        const fd = fs.openSync(path.join(outDir, name + '.jsonl'), 'w');
        const st = { files: 0, causal: 0, fim: 0, chars: 0, fim_sections: {} };
        for (const lineage of splits[name]) {
            for (const id of lineage.file_ids) {
                const text = fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8');
                const s = status.get(id);
                const broken = s === 'errors' || s === 'timeout' || s === 'junk';
                for (const sample of buildFileSamples(id, text, broken, rand, fimRate, config)) {
                    fs.writeSync(fd, JSON.stringify(sample) + '\n');
                    st.chars += sample.text.length;
                    if (sample.kind === 'causal') st.causal++;
                    else { st.fim++; st.fim_sections[sample.section] = (st.fim_sections[sample.section] || 0) + 1; }
                }
                st.files++;
                if (st.files % 2000 === 0) log(`build_samples: ${name} ${st.files} files`);
            }
        }
        fs.closeSync(fd);
        stats[name] = st;
        log(`build_samples: ${name}: ${st.files} files, ${st.causal} causal, ${st.fim} fim, ${st.chars} chars`);
    }
    fs.writeFileSync(path.join(outDir, 'samples_stats.json'), JSON.stringify(stats, null, 2) + '\n');
    return stats;
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
    }
    return args;
}

if (require.main === module) {
    const { resolvePaths } = require('./paths.js');
    const args = parseArgs(process.argv.slice(2));
    const configPath = path.join(__dirname, '..', 'configs', 'context.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : undefined;
    const stats = runBuildSamples({
        dataDir: args.data || resolvePaths().dataDir,
        seed: args.seed ? parseInt(args.seed, 10) : undefined,
        fimRate: args['fim-rate'] ? parseFloat(args['fim-rate']) : undefined,
        config,
    });
    console.log(JSON.stringify(stats, null, 2));
}

module.exports = { weightFor, chooseFimSpan, seededRandom, buildFileSamples, runBuildSamples };
