'use strict';
// Phase 0, step 3.3: compile every ingested file through the real engine, in child
// processes with a parent-side watchdog, and record status plus dedup hashes.
//
//   node autocomplete/pipeline/compile_filter.js [--data DIR] [--workers N] [--timeout MS] [--resume]
//
// Reads  <data>/raw/manifest.jsonl and <data>/raw/text/<id>.txt
// Writes <data>/compile.jsonl        {id, status, errorCount, errorStrings[0..5], ms, hash_no_levels, hash_mechanics}
//        <data>/compile_report.json  counts, throughput, top error strings
//
// status: ok | warnings | errors | timeout | junk
// Hashes are the sha256 of canonicalizeSource(text, mode) for files that compile; null otherwise.
// The engine compile is synchronous and cannot be interrupted from inside a child, so the
// parent watches each child's stdout: no line within the timeout means the child is killed,
// the in-flight id is recorded as timeout, and a fresh child resumes from the next id.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
let canonicalize = null;
function engine() {
    if (!canonicalize) canonicalize = require(path.join(REPO_ROOT, 'src', 'canonicalize.js'));
    return canonicalize;
}

const MAX_ERROR_STRINGS = 5;

function stripHtml(s) {
    return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Folds line numbers so identical messages from different lines histogram together.
function normaliseErrorString(s) {
    return stripHtml(s).replace(/\bline \d+/g, 'line #').replace(/^#\s*/, 'line # ');
}

function compileOne(text) {
    const eng = engine();
    const t0 = process.hrtime.bigint();
    const result = eng.validateCompileSource(text);
    const errorStrings = (result.errorStrings || []).slice(0, MAX_ERROR_STRINGS).map(stripHtml);
    let status;
    if (result.errorCount > 0) status = 'errors';
    else if (errorStrings.length > 0) status = 'warnings';
    else status = 'ok';

    let hashNoLevels = null;
    let hashMechanics = null;
    let hashError = null;
    if (status !== 'errors') {
        try {
            hashNoLevels = eng.hashCanonical(eng.canonicalizeSource(text, 'no-levels'));
            hashMechanics = eng.hashCanonical(eng.canonicalizeSource(text, 'mechanics'));
        } catch (err) {
            hashError = stripHtml(err && err.message || err).slice(0, 200);
        }
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const row = { status, errorCount: result.errorCount || 0, errorStrings, ms: Math.round(ms * 10) / 10, hash_no_levels: hashNoLevels, hash_mechanics: hashMechanics };
    if (hashError) row.hash_error = hashError;
    return row;
}

function readManifest(dataDir) {
    const p = path.join(dataDir, 'raw', 'manifest.jsonl');
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

function readExistingIds(outPath) {
    const ids = new Set();
    if (!fs.existsSync(outPath)) return ids;
    for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
        if (!line) continue;
        try { ids.add(JSON.parse(line).id); } catch (e) { /* partial line */ }
    }
    return ids;
}

// Runs one shard: spawns the worker, restarts it after a timeout, resolves when the
// shard's ids are all accounted for. onRow is called once per id.
const MAX_STARTUP_CRASHES = 3;

function runShard({ textDir, idsFile, ids, timeoutMs, env, onRow, log }) {
    return new Promise(resolve => {
        let next = 0;          // index of the next id the worker should start at
        let inFlight = null;   // id currently being compiled
        let inFlightIndex = -1;
        let startupCrashes = 0; // consecutive exits before any S line

        const failRemaining = reason => {
            for (let i = next; i < ids.length; i++) {
                onRow({ id: ids[i], status: 'errors', errorCount: 1, errorStrings: [reason], ms: 0, hash_no_levels: null, hash_mechanics: null });
            }
            next = ids.length;
            resolve();
        };

        function launch() {
            if (next >= ids.length) return resolve();
            const child = spawn(process.execPath, [path.join(__dirname, 'compile_worker.js'), textDir, idsFile, String(next)], {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: Object.assign({}, process.env, env || {}),
            });
            let buffer = '';
            let timer = null;
            let finished = false;  // once true, nothing more from this child is accepted
            let sawStart = false;

            const arm = () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    if (finished) return;
                    finished = true;
                    child.kill('SIGKILL');
                    if (inFlight !== null) {
                        onRow({ id: inFlight, status: 'timeout', errorCount: 0, errorStrings: [], ms: timeoutMs, hash_no_levels: null, hash_mechanics: null });
                        log(`timeout: ${inFlight}`);
                        next = inFlightIndex + 1;
                        inFlight = null;
                    }
                    launch();
                }, timeoutMs);
            };
            arm();

            child.on('error', err => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                failRemaining('worker spawn failed: ' + String(err && err.message || err));
            });

            child.stdout.on('data', chunk => {
                if (finished) return; // killed by the watchdog: anything still in the pipe is stale
                buffer += chunk.toString('utf8');
                let nl;
                while ((nl = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, nl);
                    buffer = buffer.slice(nl + 1);
                    if (line.startsWith('S ')) {
                        sawStart = true;
                        startupCrashes = 0;
                        inFlight = line.slice(2);
                        inFlightIndex = ids.indexOf(inFlight, next);
                        arm();
                    } else if (line.startsWith('R ')) {
                        const row = JSON.parse(line.slice(2));
                        onRow(row);
                        inFlight = null;
                        next = inFlightIndex + 1;
                        arm();
                    } else if (line === 'D') {
                        finished = true;
                        clearTimeout(timer);
                        next = ids.length;
                    }
                }
            });
            child.stderr.on('data', () => { /* engine console noise */ });
            // 'close' fires after stdout has been fully drained, unlike 'exit'.
            child.on('close', code => {
                if (finished && next >= ids.length) return resolve();
                if (finished) return; // watchdog already relaunched, or spawn error handled
                finished = true;
                clearTimeout(timer);
                if (inFlight !== null) {
                    // Crashed mid-file: record and move on.
                    onRow({ id: inFlight, status: 'errors', errorCount: 1, errorStrings: ['worker crashed, exit ' + code], ms: 0, hash_no_levels: null, hash_mechanics: null });
                    next = inFlightIndex + 1;
                    inFlight = null;
                } else if (!sawStart) {
                    // Died before compiling anything: a deterministic startup failure would loop forever.
                    startupCrashes++;
                    if (startupCrashes >= MAX_STARTUP_CRASHES) {
                        log(`worker failed to start ${startupCrashes} times (exit ${code}); failing the rest of the shard`);
                        return failRemaining('worker failed to start, exit ' + code);
                    }
                }
                launch();
            });
        }
        launch();
    });
}

function buildReport(rows, elapsedMs, compiledThisRun) {
    const counts = { ok: 0, warnings: 0, errors: 0, timeout: 0, junk: 0 };
    const hist = new Map();
    let msTotal = 0;
    let hashErrors = 0;
    for (const r of rows) {
        counts[r.status] = (counts[r.status] || 0) + 1;
        msTotal += r.ms || 0;
        if (r.hash_error) hashErrors++;
        if (r.status === 'errors' || r.status === 'warnings') {
            for (const e of r.errorStrings || []) {
                const k = normaliseErrorString(e);
                hist.set(k, (hist.get(k) || 0) + 1);
            }
        }
    }
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([message, count]) => ({ count, message }));
    return {
        files: rows.length,
        counts,
        hash_errors: hashErrors,
        compiled_this_run: compiledThisRun,
        elapsed_s: Math.round(elapsedMs / 100) / 10,
        files_per_s: elapsedMs > 0 ? Math.round(compiledThisRun / (elapsedMs / 1000) * 10) / 10 : null,
        mean_compile_ms: rows.length ? Math.round(msTotal / rows.length * 10) / 10 : 0,
        top_errors: top,
    };
}

async function runCompileFilter({ dataDir, workers, timeoutMs, resume, quiet, env }) {
    const log = quiet ? () => {} : msg => process.stderr.write(msg + '\n');
    workers = workers || Math.max(1, os.cpus().length - 1);
    timeoutMs = timeoutMs || 10000;
    const textDir = path.join(dataDir, 'raw', 'text');
    const outPath = path.join(dataDir, 'compile.jsonl');
    const manifest = readManifest(dataDir);
    const junkNow = new Map(manifest.map(m => [m.id, !!m.junk]));
    const done = new Set();
    const rows = [];
    if (resume && fs.existsSync(outPath)) {
        // Keep existing rows, except junk rows for files the manifest no longer calls junk
        // (the junk heuristic changed): those are compiled again.
        for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
            if (!line) continue;
            let row;
            try { row = JSON.parse(line); } catch (e) { continue; }
            if (row.status === 'junk' && junkNow.get(row.id) === false) continue;
            rows.push(row);
            done.add(row.id);
        }
        fs.writeFileSync(outPath, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    } else if (fs.existsSync(outPath)) {
        fs.unlinkSync(outPath);
    }
    const out = fs.openSync(outPath, 'a');
    const write = row => {
        rows.push(row);
        fs.writeSync(out, JSON.stringify(row) + '\n');
    };

    const todo = [];
    for (const m of manifest) {
        if (done.has(m.id)) continue;
        if (m.junk) {
            write({ id: m.id, status: 'junk', errorCount: 0, errorStrings: [], ms: 0, hash_no_levels: null, hash_mechanics: null });
        } else {
            todo.push(m.id);
        }
    }
    log(`compile_filter: ${todo.length} files, ${workers} workers, timeout ${timeoutMs} ms`);

    const t0 = Date.now();
    let completed = 0;
    const shardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-shards-'));
    const shards = [];
    const n = Math.min(workers, Math.max(1, todo.length));
    for (let s = 0; s < n; s++) {
        const ids = todo.filter((_, i) => i % n === s);
        if (ids.length === 0) continue;
        const idsFile = path.join(shardDir, `shard${s}.json`);
        fs.writeFileSync(idsFile, JSON.stringify(ids));
        shards.push(runShard({
            textDir, idsFile, ids, timeoutMs, env, log,
            onRow: row => {
                write(row);
                completed++;
                if (completed % 1000 === 0) {
                    const rate = completed / ((Date.now() - t0) / 1000);
                    log(`compile_filter: ${completed}/${todo.length} (${rate.toFixed(1)} files/s)`);
                }
            },
        }));
    }
    await Promise.all(shards);
    fs.closeSync(out);
    fs.rmSync(shardDir, { recursive: true, force: true });

    const report = buildReport(rows, Date.now() - t0, todo.length);
    fs.writeFileSync(path.join(dataDir, 'compile_report.json'), JSON.stringify(report, null, 2) + '\n');
    log(`compile_filter: done in ${report.elapsed_s}s, ${report.files_per_s} files/s`);
    return report;
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const key = argv[i].slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) args[key] = true;
        else { args[key] = next; i++; }
    }
    return args;
}

if (require.main === module) {
    const { resolvePaths } = require('./paths.js');
    const args = parseArgs(process.argv.slice(2));
    runCompileFilter({
        dataDir: args.data || resolvePaths().dataDir,
        workers: args.workers ? parseInt(args.workers, 10) : undefined,
        timeoutMs: args.timeout ? parseInt(args.timeout, 10) : undefined,
        resume: !!args.resume,
    }).then(report => {
        console.log(JSON.stringify(report, null, 2));
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { compileOne, normaliseErrorString, stripHtml, runCompileFilter, buildReport };
