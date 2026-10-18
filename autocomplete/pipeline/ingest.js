'use strict';
// Phase 0, step 3.2: ingest raw gist JSON dumps into a manifest plus normalised text.
//
//   node autocomplete/pipeline/ingest.js [--dump DIR] [--data DIR] [--dumpprocessed DIR]
//
// Reads every *.json in the dump directory (GitHub gist API responses), takes
// data.files["script.txt"].content, normalises it, replaces author/homepage values,
// and writes:
//   <data>/raw/manifest.jsonl     one row per kept gist
//   <data>/raw/text/<id>.txt      normalised source, id = <owner>_<gistid>
//   <data>/raw/ingest_stats.json  the section 3.1 numbers
// Nothing is modified under the dump directory.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIN_BYTES = 200;
const MAX_BYTES = 1024 * 1024;

// Mirrors metadata_with_value / metadata_no_value in src/js/parser.js.
const PRELUDE_KEYS = new Set([
    'title', 'author', 'homepage', 'background_color', 'text_color', 'key_repeat_interval',
    'realtime_interval', 'again_interval', 'flickscreen', 'zoomscreen', 'color_palette', 'youtube',
    'run_rules_on_level_start', 'norepeat_action', 'require_player_movement', 'debug',
    'verbose_logging', 'throttle_movement', 'noundo', 'noaction', 'norestart', 'scanline',
]);
const { stripComments, firstWord, SECTION_SET: SECTION_NAMES } = require('./text_util.js');

function normaliseText(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text.replace(/\r\n?/g, '\n');
}

// Replace the values of author/homepage lines in the prelude (everything before the
// first section header). Comments are ignored when deciding where the prelude ends, but
// the stored text keeps them.
function neutraliseIdentity(text) {
    const lines = text.split('\n');
    const bare = stripComments(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
        const word = firstWord(bare[i] || '');
        if (SECTION_NAMES.has(word)) break;
        const m = /^(\s*)(author|homepage)\b/i.exec(bare[i] || '');
        if (!m) continue;
        const key = m[2].toLowerCase();
        lines[i] = m[1] + (key === 'author' ? 'author anon' : 'homepage example.com');
    }
    return lines.join('\n');
}

// Junk = first meaningful line (comments removed, which may span lines) is neither a
// prelude key, a section header nor a section divider, or there is no OBJECTS header.
function isJunk(text) {
    const lines = stripComments(text).split('\n');
    let hasObjects = false;
    let first = null;
    for (const raw of lines) {
        const line = raw.trim();
        if (line === '') continue;
        const word = line.split(/\s+/)[0].toLowerCase();
        if (word === 'objects') hasObjects = true;
        if (first === null) first = { line, word };
    }
    if (!hasObjects || first === null) return true;
    if (/^=+$/.test(first.line)) return false;
    return !(PRELUDE_KEYS.has(first.word) || SECTION_NAMES.has(first.word));
}

function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
    return sorted[idx];
}

function ingestGist(fileName, json) {
    const data = json && json.data;
    if (!data || !data.files || typeof data.files !== 'object') return { skip: 'no_data_files' };
    const script = data.files['script.txt'];
    if (!script || typeof script.content !== 'string') return { skip: 'no_script_txt' };
    if (script.truncated || data.truncated) return { skip: 'truncated' };

    const owner = (data.owner && data.owner.login) || 'unknown';
    const gistId = data.id || path.basename(fileName, '.json').split('_').pop();
    const id = owner + '_' + gistId;

    let text = neutraliseIdentity(normaliseText(script.content));
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes < MIN_BYTES) return { skip: 'too_small' };
    if (bytes > MAX_BYTES) return { skip: 'too_large' };

    return {
        row: {
            id,
            gist_id: gistId,
            owner,
            created_at: data.created_at || null,
            updated_at: data.updated_at || null,
            history: Array.isArray(data.history) ? data.history.length : 0,
            bytes,
            sha256: sha256(text),
            truncated: false,
            junk: isJunk(text),
        },
        text,
    };
}

function runIngest({ dumpDir, dataDir, dumpprocessedDir, quiet }) {
    const rawDir = path.join(dataDir, 'raw');
    const textDir = path.join(rawDir, 'text');
    fs.mkdirSync(textDir, { recursive: true });

    const stats = {
        dump_dir: dumpDir,
        files_seen: 0, unparseable: 0, no_data_files: 0, no_script_txt: 0, truncated: 0,
        too_small: 0, too_large: 0, kept: 0, junk: 0,
        history_gt1: 0,
        bytes: { count: 0, total: 0, median: 0, p95: 0, max: 0 },
        dumpprocessed: null,
    };
    const sizes = [];
    const keptIds = new Set();
    const manifestPath = path.join(rawDir, 'manifest.jsonl');
    const out = fs.openSync(manifestPath, 'w');
    const names = fs.readdirSync(dumpDir).filter(n => n.endsWith('.json')).sort();
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');

    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        stats.files_seen++;
        let json;
        try {
            json = JSON.parse(fs.readFileSync(path.join(dumpDir, name), 'utf8'));
        } catch (err) {
            stats.unparseable++;
            continue;
        }
        const result = ingestGist(name, json);
        if (result.skip) {
            stats[result.skip]++;
            continue;
        }
        const { row, text } = result;
        if (keptIds.has(row.id)) {
            // Two dump files for one gist: keep the first, count the rest as duplicates of the dump itself.
            stats.dump_duplicate_ids = (stats.dump_duplicate_ids || 0) + 1;
            continue;
        }
        keptIds.add(row.id);
        fs.writeFileSync(path.join(textDir, row.id + '.txt'), text, 'utf8');
        fs.writeSync(out, JSON.stringify(row) + '\n');
        stats.kept++;
        if (row.junk) stats.junk++;
        if (row.history > 1) stats.history_gt1++;
        sizes.push(row.bytes);
        if ((i + 1) % 5000 === 0) log(`ingest: ${i + 1}/${names.length}`);
    }
    fs.closeSync(out);

    sizes.sort((a, b) => a - b);
    stats.bytes = {
        count: sizes.length,
        total: sizes.reduce((a, b) => a + b, 0),
        median: percentile(sizes, 0.5),
        p95: percentile(sizes, 0.95),
        max: sizes.length ? sizes[sizes.length - 1] : 0,
    };

    if (dumpprocessedDir && fs.existsSync(dumpprocessedDir)) {
        // dumpprocessed names carry the dump file's prefix (sometimes a batch label
        // rather than the owner), so compare on the gist id suffix.
        const processedFiles = fs.readdirSync(dumpprocessedDir).filter(n => n.endsWith('.txt'));
        const processed = new Set(processedFiles.map(n => n.slice(0, -4).split('_').pop()));
        const keptGists = new Set([...keptIds].map(id => id.split('_').pop()));
        let inBoth = 0;
        for (const g of keptGists) if (processed.has(g)) inBoth++;
        stats.dumpprocessed = {
            files: processedFiles.length,
            gist_ids: processed.size,
            in_both: inBoth,
            only_in_dumpprocessed: processed.size - inBoth,
            only_in_manifest: keptGists.size - inBoth,
        };
    }

    fs.writeFileSync(path.join(rawDir, 'ingest_stats.json'), JSON.stringify(stats, null, 2) + '\n');
    log('ingest: wrote ' + manifestPath);
    return stats;
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1], i++;
    }
    return args;
}

if (require.main === module) {
    const { resolvePaths } = require('./paths.js');
    const defaults = resolvePaths();
    const args = parseArgs(process.argv.slice(2));
    const stats = runIngest({
        dumpDir: args.dump || defaults.dumpDir,
        dataDir: args.data || defaults.dataDir,
        dumpprocessedDir: args.dumpprocessed || defaults.dumpprocessedDir,
    });
    console.log(JSON.stringify(stats, null, 2));
}

module.exports = { normaliseText, neutraliseIdentity, isJunk, ingestGist, runIngest, MIN_BYTES, MAX_BYTES };
