'use strict';
// Phase 1, step 4.1: fixed evaluation task sets from the val and test splits.
//
//   node autocomplete/eval/tasks.js [--data DIR] [--split val|test] [--seed N]
//
// Reads  <data>/splits.json, <data>/compile.jsonl, <data>/raw/text/<id>.txt
// Writes <data>/eval/tasks_<split>.json  {split, seed, sizes, counts, cases: [...]}
//
// Case: {task, id, section, from, to, target, compiles, token_start?}
//   rest_of_token  cursor inside an identifier after >= 1 typed char; target = rest of the token;
//                  token_start is where the deterministic completer's replacement range begins
//   rest_of_line   cut at a random position inside a non-empty line; target = rest of that line
//   next_line      cursor at the start of a line; target = that line (without newline)
//   next_block     RULES and OBJECTS only; cursor at the start of a block of contiguous non-blank
//                  lines; target = the block
// rest_of_token, rest_of_line and next_line are stratified by section (equal shares, pooled
// fill when a section runs short). All sampling is seeded.

const fs = require('fs');
const path = require('path');
const { lineSections } = require('../pipeline/context.js');
const { mulberry32 } = require('../pipeline/split.js');

const SECTIONS = ['prelude', 'objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'];
const DEFAULT_SIZES = { rest_of_token: 2000, rest_of_line: 2000, next_line: 2000, next_block: 500 };
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

function readJsonl(p) {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

function isStructural(line) {
    const t = line.trim().toLowerCase();
    return t === '' || /^=+$/.test(t) || SECTIONS.includes(t);
}

// Per file: lines with offsets and sections, candidate lines, blocks.
function indexFile(id, text) {
    const lines = text.split('\n');
    const sections = lineSections(text);
    const starts = [];
    let pos = 0;
    for (const l of lines) { starts.push(pos); pos += l.length + 1; }
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
        if (isStructural(lines[i])) continue;
        candidates.push({ id, line: i, start: starts[i], end: starts[i] + lines[i].length, text: lines[i], section: sections[i] });
    }
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        if (isStructural(lines[i]) || !['rules', 'objects'].includes(sections[i])) { i++; continue; }
        const startLine = i;
        while (i < lines.length && !isStructural(lines[i]) && sections[i] === sections[startLine]) i++;
        blocks.push({ id, section: sections[startLine], start: starts[startLine], end: starts[i - 1] + lines[i - 1].length });
    }
    return { candidates, blocks };
}

function pick(list, rand) { return list[Math.floor(rand() * list.length)]; }

// Draw `n` items stratified by section: equal share per section, then pooled fill.
function stratified(pool, n, rand, makeCase) {
    const bySection = new Map(SECTIONS.map(s => [s, []]));
    for (const c of pool) if (bySection.has(c.section)) bySection.get(c.section).push(c);
    const present = SECTIONS.filter(s => bySection.get(s).length > 0);
    const out = [];
    const seen = new Set();
    const tryAdd = (item) => {
        const c = makeCase(item, rand);
        if (!c) return false;
        const key = c.task + '|' + c.id + '|' + c.from + '|' + c.to;
        if (seen.has(key)) return false;
        seen.add(key);
        out.push(c);
        return true;
    };
    const share = Math.ceil(n / Math.max(1, present.length));
    for (const s of present) {
        const list = bySection.get(s);
        let added = 0, attempts = 0;
        while (added < share && out.length < n && attempts < share * 20) {
            attempts++;
            if (tryAdd(pick(list, rand))) added++;
        }
    }
    let attempts = 0;
    while (out.length < n && attempts < n * 20 && pool.length) {
        attempts++;
        tryAdd(pick(pool, rand));
    }
    return out;
}

function makeRestOfLine(c, rand) {
    const len = c.text.length;
    if (len < 2) return null;
    const cut = 1 + Math.floor(rand() * (len - 1));
    const target = c.text.slice(cut);
    if (target.trim() === '') return null;
    return { task: 'rest_of_line', id: c.id, section: c.section, from: c.start + cut, to: c.end, target };
}

function makeNextLine(c) {
    return { task: 'next_line', id: c.id, section: c.section, from: c.start, to: c.end, target: c.text };
}

function makeRestOfToken(c, rand) {
    const tokens = [];
    IDENT.lastIndex = 0;
    let m;
    while ((m = IDENT.exec(c.text)) !== null) if (m[0].length >= 2) tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    if (tokens.length === 0) return null;
    const t = pick(tokens, rand);
    const k = 1 + Math.floor(rand() * (t.text.length - 1));
    return { task: 'rest_of_token', id: c.id, section: c.section, from: c.start + t.start + k, to: c.start + t.end, target: t.text.slice(k), token_start: c.start + t.start };
}

function makeNextBlock(b, texts) {
    return { task: 'next_block', id: b.id, section: b.section, from: b.start, to: b.end, target: texts.get(b.id).slice(b.start, b.end) };
}

function generateTasks({ dataDir, split, seed, sizes, quiet }) {
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');
    seed = seed === undefined ? 20261013 : seed;
    sizes = Object.assign({}, DEFAULT_SIZES, sizes || {});
    const splits = JSON.parse(fs.readFileSync(path.join(dataDir, 'splits.json'), 'utf8'));
    const status = new Map(readJsonl(path.join(dataDir, 'compile.jsonl')).map(r => [r.id, r.status]));
    const textDir = path.join(dataDir, 'raw', 'text');
    const ids = splits[split].flatMap(l => l.file_ids);
    const texts = new Map(ids.map(id => [id, fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8')]));
    const compiles = id => ['ok', 'warnings'].includes(status.get(id));

    const candidates = [];
    const blocks = [];
    for (const id of ids) {
        const idx = indexFile(id, texts.get(id));
        candidates.push(...idx.candidates);
        blocks.push(...idx.blocks);
    }
    const rand = mulberry32(seed + (split === 'test' ? 7 : 0));
    const cases = [];
    cases.push(...stratified(candidates, sizes.rest_of_token, rand, makeRestOfToken));
    cases.push(...stratified(candidates, sizes.rest_of_line, rand, makeRestOfLine));
    cases.push(...stratified(candidates, sizes.next_line, rand, (c) => makeNextLine(c)));
    // next_block: half RULES, half OBJECTS.
    const seenBlocks = new Set();
    for (const section of ['rules', 'objects']) {
        const list = blocks.filter(b => b.section === section);
        const want = Math.ceil(sizes.next_block / 2);
        let added = 0, attempts = 0;
        while (added < want && list.length && attempts < want * 20 && cases.filter(c => c.task === 'next_block').length < sizes.next_block) {
            attempts++;
            const b = pick(list, rand);
            const key = b.id + '|' + b.start;
            if (seenBlocks.has(key)) continue;
            seenBlocks.add(key);
            cases.push(makeNextBlock(b, texts));
            added++;
        }
    }
    for (const c of cases) c.compiles = compiles(c.id);

    const counts = {};
    for (const c of cases) {
        counts[c.task] = counts[c.task] || {};
        counts[c.task][c.section] = (counts[c.task][c.section] || 0) + 1;
    }
    const out = { split, seed, sizes, files: ids.length, counts, cases };
    const outDir = path.join(dataDir, 'eval');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `tasks_${split}.json`), JSON.stringify(out));
    log(`tasks: ${split}: ${cases.length} cases from ${ids.length} files`);
    return out;
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
    const dataDir = args.data || resolvePaths().dataDir;
    const splitsToDo = args.split ? [args.split] : ['val', 'test'];
    for (const split of splitsToDo) {
        const out = generateTasks({ dataDir, split, seed: args.seed ? parseInt(args.seed, 10) : undefined });
        console.log(split, JSON.stringify(out.counts));
    }
}

module.exports = { generateTasks, indexFile, SECTIONS, DEFAULT_SIZES };
