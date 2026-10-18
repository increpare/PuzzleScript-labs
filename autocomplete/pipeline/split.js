'use strict';
// Phase 0, step 3.5: split lineages (not files) into train/val/test.
//
//   node autocomplete/pipeline/split.js [--data DIR] [--seed N]
//
// Reads  <data>/lineages.jsonl, <data>/raw/manifest.jsonl, <data>/raw/text/<id>.txt
// Writes <data>/splits.json  {seed, ratios, counts, train: [{lineage_id, file_ids}], val: [...], test: [...]}
//
// Lineages flagged as a shipped demo game are dropped from every split. Lineages are
// shuffled with a seeded PRNG and cut 90/5/5. Training lineages keep the latest revision
// plus at most two earlier ones at least MIN_DISTANCE apart by line-level diff; val and
// test keep only the latest revision.

const fs = require('fs');
const path = require('path');
const { GENERIC_TITLES, normaliseTitle, titleOf } = require('./text_util.js');

const RATIOS = { train: 0.9, val: 0.05, test: 0.05 };
const MIN_DISTANCE = 0.2;
const MAX_EARLIER = 2;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled(list, rand) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// Line-multiset distance: 1 - |common lines| / max(line count). Cheap and good enough
// to tell "same file with a tweak" from "materially different revision".
function lineDistance(a, b) {
    const la = a.split('\n'), lb = b.split('\n');
    const counts = new Map();
    for (const l of la) counts.set(l, (counts.get(l) || 0) + 1);
    let common = 0;
    for (const l of lb) {
        const c = counts.get(l);
        if (c) { common++; counts.set(l, c - 1); }
    }
    const denom = Math.max(la.length, lb.length);
    return denom === 0 ? 0 : 1 - common / denom;
}

// ordered: file ids oldest -> latest. Returns [latest, ...earlier picks].
function pickTrainingRevisions(ordered, getText, minDistance = MIN_DISTANCE, maxEarlier = MAX_EARLIER) {
    const latest = ordered[ordered.length - 1];
    const picked = [latest];
    const pickedTexts = [getText(latest)];
    for (let i = ordered.length - 2; i >= 0 && picked.length < 1 + maxEarlier; i--) {
        const text = getText(ordered[i]);
        if (pickedTexts.every(t => lineDistance(t, text) >= minDistance)) {
            picked.push(ordered[i]);
            pickedTexts.push(text);
        }
    }
    return picked;
}

function readJsonl(p) {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

function runSplit({ dataDir, seed, quiet }) {
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');
    seed = seed === undefined ? 20261013 : seed;
    const textDir = path.join(dataDir, 'raw', 'text');
    const meta = new Map(readJsonl(path.join(dataDir, 'raw', 'manifest.jsonl')).map(r => [r.id, r]));
    // Drop demo FILES (code identical to a shipped demo), not whole lineages: a game that
    // started as the template keeps its evolved revisions. Lineages left empty are dropped.
    const lineagesIn = readJsonl(path.join(dataDir, 'lineages.jsonl'));
    let droppedFiles = 0;
    const lineages = lineagesIn.map(l => {
        const demoIds = new Set(l.demo_file_ids || (l.demo ? l.file_ids : []));
        droppedFiles += demoIds.size;
        return Object.assign({}, l, { file_ids: l.file_ids.filter(id => !demoIds.has(id)) });
    });
    const kept = lineages.filter(l => l.file_ids.length > 0);
    const dropped = lineages.length - kept.length;

    const rand = mulberry32(seed);
    const order = shuffled(kept.map(l => l.lineage_id).sort(), rand);
    const byId = new Map(kept.map(l => [l.lineage_id, l]));
    const nVal = Math.max(1, Math.round(order.length * RATIOS.val));
    const nTest = Math.max(1, Math.round(order.length * RATIOS.test));
    const assign = { test: order.slice(0, nTest), val: order.slice(nTest, nTest + nVal), train: order.slice(nTest + nVal) };

    const createdKey = id => ((meta.get(id) || {}).created_at || '') + '|' + id;
    const getText = id => fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8');
    const out = { seed, ratios: RATIOS, min_distance: MIN_DISTANCE, max_earlier: MAX_EARLIER, counts: { dropped_demo_files: droppedFiles, dropped_demo_lineages: dropped }, train: [], val: [], test: [] };
    for (const name of ['train', 'val', 'test']) {
        let files = 0, bytes = 0;
        for (const lid of assign[name]) {
            const l = byId.get(lid);
            const ordered = l.file_ids.slice().sort((a, b) => createdKey(a) < createdKey(b) ? -1 : 1);
            const fileIds = name === 'train' ? pickTrainingRevisions(ordered, getText) : [ordered[ordered.length - 1]];
            out[name].push({ lineage_id: lid, file_ids: fileIds });
            files += fileIds.length;
            for (const id of fileIds) bytes += (meta.get(id) || {}).bytes || 0;
        }
        out.counts[name] = { lineages: assign[name].length, files, bytes };
        log(`split: ${name}: ${assign[name].length} lineages, ${files} files, ${bytes} bytes`);
    }
    out.counts.leakage = leakageCheck(out, dataDir, meta, getText);
    log(`split: leakage check ${JSON.stringify(out.counts.leakage)}`);
    fs.writeFileSync(path.join(dataDir, 'splits.json'), JSON.stringify(out, null, 1) + '\n');
    return out;
}

// Counts val/test files that look like relatives of a train file: same mechanics hash
// (any owner), same owner + mechanics hash, same owner + non-generic title. The owner
// keyed counts should be zero after dedup; the any-owner count is informational.
function leakageCheck(out, dataDir, meta, getText) {
    const compilePath = path.join(dataDir, 'compile.jsonl');
    const mech = new Map();
    if (fs.existsSync(compilePath)) {
        for (const r of readJsonl(compilePath)) if (r.hash_mechanics) mech.set(r.id, r.hash_mechanics);
    }
    const trainMech = new Set();
    const trainOwnerMech = new Set();
    const trainOwnerTitle = new Set();
    const keyOf = id => {
        const owner = (meta.get(id) || {}).owner || 'unknown';
        const title = normaliseTitle(titleOf(getText(id)));
        return {
            mech: mech.get(id) || null,
            ownerMech: mech.get(id) && owner !== 'unknown' ? owner + '|' + mech.get(id) : null,
            ownerTitle: owner !== 'unknown' && title.length >= 3 && !GENERIC_TITLES.has(title) ? owner + '|' + title : null,
        };
    };
    for (const l of out.train) for (const id of l.file_ids) {
        const k = keyOf(id);
        if (k.mech) trainMech.add(k.mech);
        if (k.ownerMech) trainOwnerMech.add(k.ownerMech);
        if (k.ownerTitle) trainOwnerTitle.add(k.ownerTitle);
    }
    const result = {};
    for (const name of ['val', 'test']) {
        const c = { same_mechanics_any_owner: 0, same_owner_mechanics: 0, same_owner_title: 0 };
        for (const l of out[name]) for (const id of l.file_ids) {
            const k = keyOf(id);
            if (k.mech && trainMech.has(k.mech)) c.same_mechanics_any_owner++;
            if (k.ownerMech && trainOwnerMech.has(k.ownerMech)) c.same_owner_mechanics++;
            if (k.ownerTitle && trainOwnerTitle.has(k.ownerTitle)) c.same_owner_title++;
        }
        result[name] = c;
    }
    return result;
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
    const out = runSplit({ dataDir: args.data || resolvePaths().dataDir, seed: args.seed ? parseInt(args.seed, 10) : undefined });
    console.log(JSON.stringify(out.counts, null, 2));
}

module.exports = { lineDistance, pickTrainingRevisions, runSplit, mulberry32 };
