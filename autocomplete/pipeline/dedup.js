'use strict';
// Phase 0, step 3.4: group files into lineages.
//
//   node autocomplete/pipeline/dedup.js [--data DIR] [--demo DIR]
//
// Reads  <data>/raw/manifest.jsonl, <data>/compile.jsonl, <data>/raw/text/<id>.txt
// Writes <data>/lineages.jsonl   {lineage_id, file_ids[], representative_id, size, owners[], title, demo}
//        <data>/dedup_report.json
//
// Keys:
//   1. exact      sha256 of text with comments removed and whitespace collapsed
//   2. no-levels  canonical hash from compile.jsonl (code sections, naming normalised)
//   3. near       MinHash/LSH over 5-token shingles of the code sections only
// Keys 1 and 2 are unioned freely. Key 3 is applied between clusters, comparing only
// each cluster's LATEST member, with a stricter threshold across owners, so that early
// template-derived revisions of unrelated games do not chain into one mega-cluster.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECTION_NAMES = new Set(['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels']);
const SHINGLE = 5;
const NUM_PERMS = 128;
const LSH_BANDS = 16;               // 16 bands x 8 rows: candidates above roughly 0.7 estimated Jaccard
const THRESHOLD_SAME_OWNER = 0.8;
const THRESHOLD_CROSS_OWNER = 0.9;

// --- text handling ---------------------------------------------------------

// Remove PuzzleScript comments, which nest.
function stripComments(text) {
    let out = '';
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') { depth++; continue; }
        if (ch === ')') { if (depth > 0) depth--; continue; }
        if (depth === 0) out += ch;
    }
    return out;
}

function exactKey(text) {
    const norm = stripComments(text).toLowerCase().replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}

// Whitespace tokens of the code sections: drops sprite pixel rows in OBJECTS and
// everything but message lines in LEVELS.
function codeTokens(text) {
    const tokens = [];
    let section = 'prelude';
    for (const rawLine of stripComments(text).split('\n')) {
        const line = rawLine.trim();
        if (line === '') continue;
        const lower = line.toLowerCase();
        if (/^=+$/.test(line)) continue;
        const first = lower.split(/\s+/)[0];
        if (SECTION_NAMES.has(first) && lower === first) { section = first; tokens.push(first); continue; }
        if (section === 'levels') {
            if (first === 'message') tokens.push(...lower.split(/\s+/));
            continue;
        }
        if (section === 'objects' && /^[0-9.]+$/.test(line)) continue;
        tokens.push(...lower.split(/\s+/));
    }
    return tokens;
}

function hash32(s) {
    const h = crypto.createHash('md5').update(s, 'utf8').digest();
    return h.readUInt32LE(0);
}

function shingleSet(tokens) {
    const set = new Set();
    if (tokens.length < SHINGLE) { if (tokens.length) set.add(hash32(tokens.join(' '))); return set; }
    for (let i = 0; i + SHINGLE <= tokens.length; i++) {
        set.add(hash32(tokens.slice(i, i + SHINGLE).join(' ')));
    }
    return set;
}

function jaccard(a, b) {
    if (a.size === 0 && b.size === 0) return 1;
    let inter = 0;
    const [small, large] = a.size < b.size ? [a, b] : [b, a];
    for (const x of small) if (large.has(x)) inter++;
    return inter / (a.size + b.size - inter);
}

// Deterministic universal hashing: h_i(x) = (a_i * x + b_i) mod p, p a Mersenne prime.
const PRIME = 4294967311; // > 2^32
const PERMS = (() => {
    let seed = 0x9E3779B9;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const out = [];
    for (let i = 0; i < NUM_PERMS; i++) out.push([next() % (PRIME - 1) + 1, next() % PRIME]);
    return out;
})();

function minhash(shingles) {
    const sig = new Array(NUM_PERMS).fill(Infinity);
    for (const x of shingles) {
        for (let i = 0; i < NUM_PERMS; i++) {
            const [a, b] = PERMS[i];
            // Use BigInt-free arithmetic: (a*x + b) mod p with a,x < 2^32 would overflow doubles, so split.
            const ax = (a * (x >>> 16) % PRIME) * 65536 % PRIME + a * (x & 0xFFFF);
            const v = (ax + b) % PRIME;
            if (v < sig[i]) sig[i] = v;
        }
    }
    return sig;
}

// --- union-find --------------------------------------------------------------

class UnionFind {
    constructor() { this.parent = new Map(); }
    find(x) {
        if (!this.parent.has(x)) this.parent.set(x, x);
        let r = x;
        while (this.parent.get(r) !== r) r = this.parent.get(r);
        while (this.parent.get(x) !== r) { const n = this.parent.get(x); this.parent.set(x, r); x = n; }
        return r;
    }
    union(a, b) {
        const ra = this.find(a), rb = this.find(b);
        if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
}

// --- main ----------------------------------------------------------------------

function readJsonl(p) {
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

function titleOf(text) {
    const m = /^\s*title\s+(.*)$/im.exec(text);
    return m ? m[1].trim() : '';
}

function demoFingerprints(demoDir) {
    const out = [];
    if (!demoDir || !fs.existsSync(demoDir)) return out;
    const { neutraliseIdentity, normaliseText } = require('./ingest.js');
    const { compileOne } = require('./compile_filter.js');
    for (const name of fs.readdirSync(demoDir)) {
        if (!name.endsWith('.txt')) continue;
        const text = neutraliseIdentity(normaliseText(fs.readFileSync(path.join(demoDir, name), 'utf8')));
        const row = compileOne(text);
        out.push({ name: name.slice(0, -4), exact: exactKey(text), no_levels: row.hash_no_levels, mechanics: row.hash_mechanics });
    }
    return out;
}

function runDedup({ dataDir, demoDir, quiet }) {
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');
    const textDir = path.join(dataDir, 'raw', 'text');
    const manifest = readJsonl(path.join(dataDir, 'raw', 'manifest.jsonl')).filter(r => !r.junk);
    const compile = new Map(readJsonl(path.join(dataDir, 'compile.jsonl')).map(r => [r.id, r]));
    const meta = new Map(manifest.map(r => [r.id, r]));
    const ids = manifest.map(r => r.id);
    log(`dedup: ${ids.length} files`);

    // Keys 1 and 2.
    const uf = new UnionFind();
    const byExact = new Map();
    const byNoLevels = new Map();
    const texts = new Map();
    let exactDupes = 0;
    for (const id of ids) {
        const text = fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8');
        texts.set(id, text);
        uf.find(id);
        const ek = exactKey(text);
        if (byExact.has(ek)) { uf.union(byExact.get(ek), id); exactDupes++; } else byExact.set(ek, id);
        const c = compile.get(id);
        if (c && c.hash_no_levels) {
            if (byNoLevels.has(c.hash_no_levels)) uf.union(byNoLevels.get(c.hash_no_levels), id);
            else byNoLevels.set(c.hash_no_levels, id);
        }
    }
    const clustersAfterExact = new Set(ids.map(id => uf.find(id))).size;
    log(`dedup: ${exactDupes} exact duplicates, ${clustersAfterExact} clusters after keys 1+2`);

    // Key 3 between clusters, latest member only.
    const latestOf = new Map();
    const createdKey = id => (meta.get(id).created_at || '') + '|' + id;
    for (const id of ids) {
        const root = uf.find(id);
        if (!latestOf.has(root) || createdKey(id) > createdKey(latestOf.get(root))) latestOf.set(root, id);
    }
    const reps = [...latestOf.values()];
    const shingles = new Map();
    const buckets = new Map();
    const rowsPerBand = NUM_PERMS / LSH_BANDS;
    for (const id of reps) {
        const sh = shingleSet(codeTokens(texts.get(id)));
        shingles.set(id, sh);
        const sig = minhash(sh);
        for (let b = 0; b < LSH_BANDS; b++) {
            const key = b + ':' + sig.slice(b * rowsPerBand, (b + 1) * rowsPerBand).join(',');
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(id);
        }
    }
    const seen = new Set();
    let nearMerges = 0;
    let candidates = 0;
    for (const list of buckets.values()) {
        if (list.length < 2) continue;
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                const pk = a < b ? a + '|' + b : b + '|' + a;
                if (seen.has(pk)) continue;
                seen.add(pk);
                candidates++;
                const sameOwner = meta.get(a).owner === meta.get(b).owner;
                const sim = jaccard(shingles.get(a), shingles.get(b));
                if (sim >= (sameOwner ? THRESHOLD_SAME_OWNER : THRESHOLD_CROSS_OWNER)) {
                    if (uf.find(a) !== uf.find(b)) { uf.union(a, b); nearMerges++; }
                }
            }
        }
    }
    log(`dedup: ${candidates} near candidates, ${nearMerges} merges`);

    // Assemble lineages.
    const members = new Map();
    for (const id of ids) {
        const root = uf.find(id);
        if (!members.has(root)) members.set(root, []);
        members.get(root).push(id);
    }
    const demos = demoFingerprints(demoDir);
    const demoByExact = new Map(demos.map(d => [d.exact, d.name]));
    const demoByNoLevels = new Map(demos.filter(d => d.no_levels).map(d => [d.no_levels, d.name]));
    const demoByMechanics = new Map(demos.filter(d => d.mechanics).map(d => [d.mechanics, d.name]));

    const lineages = [];
    const mechanicsPerLineage = [];
    const lineagesPerMechanics = new Map();
    for (const [root, list] of members) {
        list.sort((a, b) => createdKey(a) < createdKey(b) ? -1 : 1);
        const rep = list[list.length - 1];
        let demo = null;
        let demoMechanics = null;
        const mech = new Set();
        for (const id of list) {
            const c = compile.get(id) || {};
            const ek = exactKey(texts.get(id));
            if (!demo && demoByExact.has(ek)) demo = demoByExact.get(ek);
            if (!demo && c.hash_no_levels && demoByNoLevels.has(c.hash_no_levels)) demo = demoByNoLevels.get(c.hash_no_levels);
            if (!demoMechanics && c.hash_mechanics && demoByMechanics.has(c.hash_mechanics)) demoMechanics = demoByMechanics.get(c.hash_mechanics);
            if (c.hash_mechanics) mech.add(c.hash_mechanics);
        }
        mechanicsPerLineage.push(mech.size);
        for (const m of mech) lineagesPerMechanics.set(m, (lineagesPerMechanics.get(m) || 0) + 1);
        lineages.push({
            lineage_id: root,
            file_ids: list,
            representative_id: rep,
            size: list.length,
            owners: [...new Set(list.map(id => meta.get(id).owner))].sort(),
            title: titleOf(texts.get(rep)),
            demo,
            demo_mechanics: demoMechanics,
        });
    }
    lineages.sort((a, b) => b.size - a.size || (a.lineage_id < b.lineage_id ? -1 : 1));
    fs.writeFileSync(path.join(dataDir, 'lineages.jsonl'), lineages.map(l => JSON.stringify(l)).join('\n') + '\n');

    const sizeHist = { '1': 0, '2-5': 0, '6-20': 0, '21-100': 0, '>100': 0 };
    for (const l of lineages) {
        const s = l.size;
        sizeHist[s === 1 ? '1' : s <= 5 ? '2-5' : s <= 20 ? '6-20' : s <= 100 ? '21-100' : '>100']++;
    }
    const report = {
        files: ids.length,
        exact_duplicates: exactDupes,
        clusters_after_exact_and_no_levels: clustersAfterExact,
        near_candidates: candidates,
        near_merges: nearMerges,
        thresholds: { same_owner: THRESHOLD_SAME_OWNER, cross_owner: THRESHOLD_CROSS_OWNER },
        lineages: lineages.length,
        largest: { size: lineages[0] ? lineages[0].size : 0, title: lineages[0] ? lineages[0].title : null, share_of_files: lineages[0] ? Math.round(lineages[0].size / ids.length * 10000) / 100 : 0 },
        top10: lineages.slice(0, 10).map(l => ({ size: l.size, title: l.title, owners: l.owners.length, demo: l.demo, demo_mechanics: l.demo_mechanics })),
        size_histogram: sizeHist,
        demo_lineages: lineages.filter(l => l.demo).length,
        demo_files: lineages.filter(l => l.demo).reduce((a, l) => a + l.size, 0),
        demo_mechanics_lineages: lineages.filter(l => l.demo_mechanics).length,
        mechanics_agreement: {
            lineages_spanning_multiple_mechanics: mechanicsPerLineage.filter(n => n > 1).length,
            mechanics_groups: lineagesPerMechanics.size,
            mechanics_groups_spanning_multiple_lineages: [...lineagesPerMechanics.values()].filter(n => n > 1).length,
        },
    };
    fs.writeFileSync(path.join(dataDir, 'dedup_report.json'), JSON.stringify(report, null, 2) + '\n');
    log(`dedup: ${lineages.length} lineages, largest ${report.largest.size} (${report.largest.title})`);
    return report;
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
    const p = resolvePaths();
    const args = parseArgs(process.argv.slice(2));
    const report = runDedup({
        dataDir: args.data || p.dataDir,
        demoDir: args.demo || path.join(p.repoRoot, 'src', 'demo'),
    });
    console.log(JSON.stringify(report, null, 2));
}

module.exports = { stripComments, exactKey, codeTokens, shingleSet, jaccard, minhash, runDedup, UnionFind };
