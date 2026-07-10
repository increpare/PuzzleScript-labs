# PuzzleScript Handheld Peak-Memory Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desk-only Track 0 audit that measures native compile/load/session peak RSS per testdata corpus game and reports outliers against an embedded PSRAM ceiling.

**Architecture:** Reuse the existing `scripts/build_parser_corpus_bundle.js testdata` NDJSON bundle so the measured corpus matches the handheld display report. Add a Node CLI that writes each source to a temporary file, runs `build/native/puzzlescript_cpp run <temp>.txt --headless --native-compile` in a separate process wrapped by `/usr/bin/time`, parses Darwin and GNU peak-RSS output, and emits a JSON summary plus per-game records. Add a Make target and usage note so Track 0 memory checks are reproducible from the repo root.

**Tech Stack:** Node.js built-ins (`fs`, `path`, `os`, `child_process`, `assert`), existing CMake native build, existing `puzzlescript_cpp` CLI, existing parser-corpus NDJSON bundler, `/usr/bin/time -lp` on Darwin or `/usr/bin/time -v` on GNU/Linux.

---

## Scope Check

This plan implements only the first Track 0 memory gate requested by the handheld design review:

- per-game peak-memory audit across the current `testdata` corpus
- hard embedded memory ceiling flagging, defaulting to 32 MB
- outlier report suitable for deciding whether to optimize runtime-load memory or document a too-large-game failure path

It does not diagnose the allocations, reduce memory use, cross-build rv32, run emulation parity, or design firmware memory allocators. Those should be separate plans after this audit identifies the real outliers under the native compiler path.

## File Structure

- Create `scripts/test_handheld_memory_audit.js`
  - Unit tests for parsing `/usr/bin/time` output, NDJSON corpus loading, summary generation, and source-file name sanitizing.
- Create `scripts/handheld_memory_audit.js`
  - CLI and reusable pure helpers. The pure helpers are exported for tests; the process-spawning CLI path runs only when the file is invoked directly.
- Modify `Makefile`
  - Add `HANDHELD_MEMORY_AUDIT_JSON`, `HANDHELD_MEMORY_CEILING_MB`, a `handheld_memory_audit` target, and help text.
- Create `docs/superpowers/notes/2026-07-05-handheld-memory-audit-usage.md`
  - Document build/run commands, output contract, default ceiling, and how to run a limited smoke audit before the full corpus.

## Task 1: Add Failing Unit Tests For The Audit Helpers

**Files:**
- Create: `scripts/test_handheld_memory_audit.js`

- [ ] **Step 1: Write the failing helper tests**

Create `scripts/test_handheld_memory_audit.js`:

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');

const audit = require('./handheld_memory_audit');

function parsesDarwinTimeOutput() {
    const parsed = audit.parseTimeOutput([
        '        0.03 real',
        '        0.01 user',
        '        0.01 sys',
        '     123456 maximum resident set size',
    ].join('\n'));

    assert.deepStrictEqual(parsed, {
        format: 'darwin',
        maxRssBytes: 123456,
        realSeconds: 0.03,
    });
}

function parsesGnuTimeOutput() {
    const parsed = audit.parseTimeOutput([
        'Command being timed: "true"',
        'Elapsed (wall clock) time (h:mm:ss or m:ss): 1:02.50',
        'Maximum resident set size (kbytes): 2048',
    ].join('\n'));

    assert.deepStrictEqual(parsed, {
        format: 'gnu',
        maxRssBytes: 2048 * 1024,
        realSeconds: 62.5,
    });
}

function rejectsMissingPeakRss() {
    assert.throws(
        () => audit.parseTimeOutput('0.01 real\n0.00 user\n0.00 sys\n'),
        /maximum resident set size/,
    );
}

function loadsNdjsonCorpusText() {
    const rows = audit.loadNdjsonCorpusText(
        'inline.ndjson',
        [
            '',
            '{"index":7,"name":"demo","source":"title demo\\nLEVELS\\nP"}',
            '   ',
            '{"name":"second","source":"title second"}',
        ].join('\n'),
    );

    assert.deepStrictEqual(rows, [
        { index: 7, name: 'demo', source: 'title demo\nLEVELS\nP' },
        { index: 1, name: 'second', source: 'title second' },
    ]);
}

function rejectsMalformedNdjsonRecords() {
    assert.throws(
        () => audit.loadNdjsonCorpusText('bad.ndjson', '[]\n'),
        /bad\.ndjson:1: record must be a JSON object/,
    );
    assert.throws(
        () => audit.loadNdjsonCorpusText('bad.ndjson', '{"source":"x"}\n'),
        /bad\.ndjson:1: missing string field name/,
    );
    assert.throws(
        () => audit.loadNdjsonCorpusText('bad.ndjson', '{"name":"x"}\n'),
        /bad\.ndjson:1: missing string field source/,
    );
    assert.throws(
        () => audit.loadNdjsonCorpusText('bad.ndjson', '{"name":3,"source":"x"}\n'),
        /bad\.ndjson:1: field name must be a string/,
    );
}

function sanitizesSourceFileNames() {
    assert.strictEqual(
        audit.sourceFileName({ index: 12, name: '../Odd Game: v1?.txt' }),
        '0012-Odd_Game_v1.txt',
    );
    assert.strictEqual(
        audit.sourceFileName({ index: 3, name: '***' }),
        '0003-game.txt',
    );
}

function summarizesResultsAgainstCeiling() {
    const ceiling = 32 * 1024 * 1024;
    const summary = audit.summarizeResults(
        [
            {
                index: 0,
                name: 'small',
                ok: true,
                peak_rss_bytes: 4 * 1024 * 1024,
                elapsed_seconds: 0.1,
            },
            {
                index: 1,
                name: 'large',
                ok: true,
                peak_rss_bytes: 110 * 1024 * 1024,
                elapsed_seconds: 1.5,
            },
            {
                index: 2,
                name: 'failed',
                ok: false,
                peak_rss_bytes: null,
                elapsed_seconds: null,
            },
        ],
        ceiling,
    );

    assert.strictEqual(summary.game_count, 3);
    assert.strictEqual(summary.measured_games, 2);
    assert.strictEqual(summary.failures, 1);
    assert.strictEqual(summary.memory_ceiling_bytes, ceiling);
    assert.strictEqual(summary.over_ceiling, 1);
    assert.strictEqual(summary.max_peak_rss_bytes, 110 * 1024 * 1024);
    assert.strictEqual(summary.max_peak_rss_mb, 110);
    assert.strictEqual(summary.top_peak_rss[0].name, 'large');
    assert.strictEqual(summary.top_peak_rss[0].peak_rss_mb, 110);
    assert.strictEqual(summary.top_peak_rss[1].name, 'small');
}

parsesDarwinTimeOutput();
parsesGnuTimeOutput();
rejectsMissingPeakRss();
loadsNdjsonCorpusText();
rejectsMalformedNdjsonRecords();
sanitizesSourceFileNames();
summarizesResultsAgainstCeiling();
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run:

```bash
node scripts/test_handheld_memory_audit.js
```

Expected: the command fails because `scripts/handheld_memory_audit.js` does not exist.

## Task 2: Implement The Memory Audit CLI

**Files:**
- Create: `scripts/handheld_memory_audit.js`

- [ ] **Step 1: Add the audit script**

Create `scripts/handheld_memory_audit.js`:

```javascript
#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MEMORY_CEILING_MB = 32;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function bytesToMb(bytes) {
    if (bytes === null || bytes === undefined) {
        return null;
    }
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function parseClockSeconds(value) {
    const parts = String(value).trim().split(':').map(Number);
    if (parts.some((part) => Number.isNaN(part))) {
        return null;
    }
    if (parts.length === 1) {
        return parts[0];
    }
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
}

function parseTimeOutput(stderrText) {
    const text = String(stderrText);
    const darwinRss = text.match(/^\s*(\d+)\s+maximum resident set size\s*$/m);
    if (darwinRss) {
        const real = text.match(/^\s*([0-9.]+)\s+real\s*$/m);
        return {
            format: 'darwin',
            maxRssBytes: Number(darwinRss[1]),
            realSeconds: real ? Number(real[1]) : null,
        };
    }

    const gnuRss = text.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
    if (gnuRss) {
        const elapsed = text.match(/Elapsed \(wall clock\) time.*:\s*([0-9:.]+)/);
        return {
            format: 'gnu',
            maxRssBytes: Number(gnuRss[1]) * 1024,
            realSeconds: elapsed ? parseClockSeconds(elapsed[1]) : null,
        };
    }

    throw new Error('could not parse maximum resident set size from /usr/bin/time output');
}

function requireStringField(object, key, context) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) {
        throw new Error(`${context}missing string field ${key}`);
    }
    if (typeof object[key] !== 'string') {
        throw new Error(`${context}field ${key} must be a string`);
    }
    return object[key];
}

function loadNdjsonCorpusText(label, ndjsonText) {
    const sources = [];
    const lines = String(ndjsonText).split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const lineNumber = lineIndex + 1;
        if (line.trim() === '') {
            continue;
        }
        const context = `${label}:${lineNumber}: `;
        let record;
        try {
            record = JSON.parse(line);
        } catch (error) {
            throw new Error(`${context}invalid JSON: ${error.message}`);
        }
        if (record === null || Array.isArray(record) || typeof record !== 'object') {
            throw new Error(`${context}record must be a JSON object`);
        }
        sources.push({
            index: Number.isInteger(record.index) ? record.index : sources.length,
            name: requireStringField(record, 'name', context),
            source: requireStringField(record, 'source', context),
        });
    }
    return sources;
}

function loadNdjsonCorpusFile(filePath) {
    return loadNdjsonCorpusText(filePath, fs.readFileSync(filePath, 'utf8'));
}

function sourceFileName(source) {
    const index = String(source.index).padStart(4, '0');
    const base = path.basename(String(source.name || 'game'), path.extname(String(source.name || '')));
    const cleaned = base
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    return `${index}-${cleaned || 'game'}.txt`;
}

function stderrTail(text, maxLines = 20, maxChars = 4000) {
    const lines = String(text || '').split(/\r?\n/).slice(-maxLines).join('\n');
    if (lines.length <= maxChars) {
        return lines;
    }
    return lines.slice(lines.length - maxChars);
}

function supportedTimeFlavor(preferredFlavor) {
    if (preferredFlavor && preferredFlavor !== 'auto') {
        return preferredFlavor;
    }
    const darwinProbe = childProcess.spawnSync('/usr/bin/time', ['-lp', 'true'], {
        encoding: 'utf8',
    });
    if (darwinProbe.status === 0) {
        return 'darwin';
    }
    const gnuProbe = childProcess.spawnSync('/usr/bin/time', ['-v', 'true'], {
        encoding: 'utf8',
    });
    if (gnuProbe.status === 0) {
        return 'gnu';
    }
    throw new Error('could not find a supported /usr/bin/time mode (-lp or -v)');
}

function timeArgs(flavor) {
    if (flavor === 'darwin') {
        return ['-lp'];
    }
    if (flavor === 'gnu') {
        return ['-v'];
    }
    throw new Error(`unsupported time flavor: ${flavor}`);
}

function runMeasuredGame(source, options) {
    fs.mkdirSync(options.tmpDir, { recursive: true });
    const sourcePath = path.join(options.tmpDir, sourceFileName(source));
    fs.writeFileSync(sourcePath, source.source, 'utf8');

    const commandArgs = [
        ...timeArgs(options.timeFlavor),
        options.binary,
        'run',
        sourcePath,
        '--headless',
        '--native-compile',
    ];

    const startedAt = Date.now();
    const result = childProcess.spawnSync('/usr/bin/time', commandArgs, {
        encoding: 'utf8',
        maxBuffer: options.maxBufferBytes,
    });
    const wallSeconds = (Date.now() - startedAt) / 1000;

    let measurement = null;
    let parseError = null;
    try {
        measurement = parseTimeOutput(result.stderr || '');
    } catch (error) {
        parseError = error.message;
    }

    const exitCode = typeof result.status === 'number' ? result.status : null;
    const ok = exitCode === 0 && result.signal === null && measurement !== null;
    return {
        index: source.index,
        name: source.name,
        source_bytes: Buffer.byteLength(source.source, 'utf8'),
        ok,
        exit_code: exitCode,
        signal: result.signal,
        peak_rss_bytes: measurement ? measurement.maxRssBytes : null,
        peak_rss_mb: measurement ? bytesToMb(measurement.maxRssBytes) : null,
        elapsed_seconds: measurement && measurement.realSeconds !== null ? measurement.realSeconds : wallSeconds,
        time_format: measurement ? measurement.format : options.timeFlavor,
        over_ceiling: measurement ? measurement.maxRssBytes > options.memoryCeilingBytes : false,
        parse_error: parseError,
        stdout_tail: stderrTail(result.stdout),
        stderr_tail: stderrTail(result.stderr),
        command: ['/usr/bin/time', ...commandArgs],
    };
}

function summarizeResults(results, memoryCeilingBytes) {
    const measured = results.filter((record) => record.ok && typeof record.peak_rss_bytes === 'number');
    const failures = results.filter((record) => !record.ok);
    const overCeiling = measured.filter((record) => record.peak_rss_bytes > memoryCeilingBytes);
    const sorted = measured
        .slice()
        .sort((a, b) => b.peak_rss_bytes - a.peak_rss_bytes)
        .slice(0, 10)
        .map((record) => ({
            index: record.index,
            name: record.name,
            peak_rss_bytes: record.peak_rss_bytes,
            peak_rss_mb: bytesToMb(record.peak_rss_bytes),
            elapsed_seconds: record.elapsed_seconds,
            over_ceiling: record.peak_rss_bytes > memoryCeilingBytes,
        }));
    const maxPeak = sorted.length > 0 ? sorted[0].peak_rss_bytes : null;

    return {
        game_count: results.length,
        measured_games: measured.length,
        failures: failures.length,
        memory_ceiling_bytes: memoryCeilingBytes,
        memory_ceiling_mb: bytesToMb(memoryCeilingBytes),
        over_ceiling: overCeiling.length,
        max_peak_rss_bytes: maxPeak,
        max_peak_rss_mb: bytesToMb(maxPeak),
        top_peak_rss: sorted,
    };
}

function parseArgs(argv) {
    const options = {
        binary: path.join('build', 'native', 'puzzlescript_cpp'),
        corpusNdjson: null,
        out: path.join('build', 'handheld_memory_audit.json'),
        tmpDir: path.join('build', 'handheld_memory_audit_sources'),
        limit: null,
        memoryCeilingBytes: DEFAULT_MEMORY_CEILING_MB * 1024 * 1024,
        timeFlavor: 'auto',
        maxBufferBytes: DEFAULT_MAX_BUFFER_BYTES,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--binary' && index + 1 < argv.length) {
            options.binary = argv[++index];
            continue;
        }
        if (arg === '--corpus-ndjson' && index + 1 < argv.length) {
            options.corpusNdjson = argv[++index];
            continue;
        }
        if (arg === '--out' && index + 1 < argv.length) {
            options.out = argv[++index];
            continue;
        }
        if (arg === '--tmp-dir' && index + 1 < argv.length) {
            options.tmpDir = argv[++index];
            continue;
        }
        if (arg === '--limit' && index + 1 < argv.length) {
            options.limit = Number(argv[++index]);
            continue;
        }
        if (arg === '--memory-ceiling-mb' && index + 1 < argv.length) {
            options.memoryCeilingBytes = Number(argv[++index]) * 1024 * 1024;
            continue;
        }
        if (arg === '--time-flavor' && index + 1 < argv.length) {
            options.timeFlavor = argv[++index];
            continue;
        }
        throw new Error(`unknown or incomplete option: ${arg}`);
    }

    if (!options.help && !options.corpusNdjson) {
        throw new Error('--corpus-ndjson is required');
    }
    if (!options.help && (!Number.isFinite(options.memoryCeilingBytes) || options.memoryCeilingBytes <= 0)) {
        throw new Error('--memory-ceiling-mb must be a positive number');
    }
    if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
        throw new Error('--limit must be a positive integer');
    }
    return options;
}

function printUsage(out) {
    out.write([
        'Usage: node scripts/handheld_memory_audit.js --corpus-ndjson build/handheld_testdata.bundle.ndjson [options]',
        '',
        'Options:',
        '  --binary PATH              puzzlescript_cpp binary (default: build/native/puzzlescript_cpp)',
        '  --out PATH                 JSON output path (default: build/handheld_memory_audit.json)',
        '  --tmp-dir PATH             temporary source directory (default: build/handheld_memory_audit_sources)',
        '  --limit N                  measure only the first N corpus records',
        '  --memory-ceiling-mb N      embedded memory ceiling for outlier flags (default: 32)',
        '  --time-flavor auto|darwin|gnu',
        '',
    ].join('\n'));
}

function runCli(argv) {
    const options = parseArgs(argv);
    if (options.help) {
        printUsage(process.stdout);
        return 0;
    }
    if (!fs.existsSync(options.binary)) {
        throw new Error(`missing puzzlescript_cpp binary: ${options.binary}`);
    }
    options.timeFlavor = supportedTimeFlavor(options.timeFlavor);

    let sources = loadNdjsonCorpusFile(options.corpusNdjson);
    if (options.limit !== null) {
        sources = sources.slice(0, options.limit);
    }

    const results = [];
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        process.stderr.write(`measuring ${index + 1}/${sources.length}: ${source.name}\n`);
        results.push(runMeasuredGame(source, options));
    }

    const report = {
        generated_at: new Date().toISOString(),
        host: {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
        },
        command: {
            binary: options.binary,
            corpus_ndjson: options.corpusNdjson,
            time_flavor: options.timeFlavor,
        },
        summary: summarizeResults(results, options.memoryCeilingBytes),
        games: results,
    };

    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stderr.write(
        `Wrote ${options.out}; max peak RSS ${report.summary.max_peak_rss_mb} MB; ` +
        `${report.summary.over_ceiling} over ${report.summary.memory_ceiling_mb} MB\n`,
    );
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = runCli(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`handheld_memory_audit: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    bytesToMb,
    loadNdjsonCorpusText,
    parseClockSeconds,
    parseTimeOutput,
    runMeasuredGame,
    sourceFileName,
    summarizeResults,
};
```

- [ ] **Step 2: Run the helper tests and verify they pass**

Run:

```bash
node scripts/test_handheld_memory_audit.js
```

Expected: the command exits with status 0 and no output.

- [ ] **Step 3: Run the CLI help smoke test**

Run:

```bash
node scripts/handheld_memory_audit.js --help
```

Expected: stdout starts with `Usage: node scripts/handheld_memory_audit.js`.

- [ ] **Step 4: Commit the audit script and tests**

Run:

```bash
git add scripts/handheld_memory_audit.js scripts/test_handheld_memory_audit.js
git commit -m "feat: add handheld memory audit script"
```

## Task 3: Add Makefile Target For The Audit

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Extend the Makefile variables**

Near the existing handheld report variables, add:

```make
HANDHELD_MEMORY_AUDIT_JSON := $(BUILD_DIR)/handheld_memory_audit.json
HANDHELD_MEMORY_CEILING_MB ?= 32
```

- [ ] **Step 2: Add the phony target**

Add `handheld_memory_audit` to the `.PHONY` list near `handheld_report`.

Add this help line near the existing `make handheld_report` help line:

```make
	@echo "  make handheld_memory_audit         Measure per-game native peak RSS for handheld Track 0"
```

Add this target near `handheld_report`:

```make
handheld_memory_audit:
	$(CMAKE) -S . -B $(BUILD_DIR) -DPS_MASK_WORD_BITS=64
	$(CMAKE) --build $(BUILD_DIR) --target puzzlescript_cpp
	$(NODE) scripts/build_parser_corpus_bundle.js testdata > $(HANDHELD_TESTDATA_BUNDLE)
	$(NODE) scripts/handheld_memory_audit.js \
		--binary $(PUZZLESCRIPT_CPP) \
		--corpus-ndjson $(HANDHELD_TESTDATA_BUNDLE) \
		--memory-ceiling-mb $(HANDHELD_MEMORY_CEILING_MB) \
		--out $(HANDHELD_MEMORY_AUDIT_JSON)
```

- [ ] **Step 3: Run the fast Makefile-adjacent checks**

Run:

```bash
node scripts/test_handheld_memory_audit.js
make help | rg 'handheld_memory_audit|handheld_report'
```

Expected:

- the Node test exits with status 0
- `make help` prints both handheld targets

- [ ] **Step 4: Run a one-game audit smoke**

Run:

```bash
cmake --build build --target puzzlescript_cpp
node scripts/build_parser_corpus_bundle.js testdata > build/handheld_testdata.bundle.ndjson
node scripts/handheld_memory_audit.js \
  --binary build/native/puzzlescript_cpp \
  --corpus-ndjson build/handheld_testdata.bundle.ndjson \
  --limit 1 \
  --out build/handheld_memory_audit_smoke.json
jq '.summary' build/handheld_memory_audit_smoke.json
```

Expected: the JSON summary has `"game_count": 1`, `"measured_games": 1`, and numeric `max_peak_rss_bytes`.

- [ ] **Step 5: Commit the Makefile target**

Run:

```bash
git add Makefile
git commit -m "build: add handheld memory audit target"
```

## Task 4: Add Usage Documentation And Full Validation Gate

**Files:**
- Create: `docs/superpowers/notes/2026-07-05-handheld-memory-audit-usage.md`

- [ ] **Step 1: Add the usage note**

Create `docs/superpowers/notes/2026-07-05-handheld-memory-audit-usage.md`:

```markdown
# Handheld Peak-Memory Audit Usage

The handheld peak-memory audit is the first no-hardware Track 0 gate for the
PuzzleScript handheld. It measures native C++ compile/load/session peak RSS for
each game in the current `testdata` corpus and flags games that exceed an
embedded memory ceiling.

This audit complements the display-only handheld report. It does not prove rv32
portability, firmware heap behavior, allocator fragmentation, binary size,
compile time on ESP32-P4, storage behavior, audio, haptics, or battery life.

## Build

Use the root CMake build:

```bash
cmake -S . -B build -DPS_MASK_WORD_BITS=64
cmake --build build --target puzzlescript_cpp
```

## One-Game Smoke

Build the testdata NDJSON bundle and run the audit on the first record:

```bash
node scripts/build_parser_corpus_bundle.js testdata > build/handheld_testdata.bundle.ndjson
node scripts/handheld_memory_audit.js \
  --binary build/native/puzzlescript_cpp \
  --corpus-ndjson build/handheld_testdata.bundle.ndjson \
  --limit 1 \
  --out build/handheld_memory_audit_smoke.json
jq '.summary' build/handheld_memory_audit_smoke.json
```

The measured command is:

```bash
/usr/bin/time -lp build/native/puzzlescript_cpp run <temp-source>.txt --headless --native-compile
```

On GNU/Linux the script uses `/usr/bin/time -v` instead of `-lp`.

## Full Corpus

```bash
make handheld_memory_audit
```

The output is:

```bash
build/handheld_memory_audit.json
```

Override the ceiling with:

```bash
make handheld_memory_audit HANDHELD_MEMORY_CEILING_MB=24
```

## Report Contract

The top-level JSON object contains:

- `generated_at`: ISO timestamp for the audit run
- `host`: platform, architecture, and release
- `command`: binary, corpus bundle, and `/usr/bin/time` flavor
- `summary`: aggregate counts and peak RSS outliers
- `games`: one measurement record per input source

`summary.memory_ceiling_mb` defaults to 32, matching the reference ESP32-P4
PSRAM package size. `summary.over_ceiling` is the first Track 0 number to watch.
Any over-ceiling game needs either runtime-load memory reduction or an explicit
too-large-game decision before Track 1 hardware spending.

Per-game `peak_rss_bytes` is host RSS, not embedded heap use. It is still useful
for ranking outliers and proving whether the current native load path is in the
same order of magnitude as the target PSRAM budget.
```

- [ ] **Step 2: Run the full validation commands**

Run:

```bash
node scripts/test_handheld_memory_audit.js
make handheld_memory_audit
jq '.summary' build/handheld_memory_audit.json
```

Expected:

- the Node helper test exits with status 0
- `make handheld_memory_audit` writes `build/handheld_memory_audit.json`
- the summary contains `game_count`, `measured_games`, `failures`, `memory_ceiling_mb`, `over_ceiling`, and `top_peak_rss`

- [ ] **Step 3: Re-run the display harness regression gate**

Run:

```bash
ctest --test-dir build/native -R '^handheld_' --output-on-failure
```

Expected: all handheld display/report tests pass.

- [ ] **Step 4: Commit the usage documentation**

Run:

```bash
git add docs/superpowers/notes/2026-07-05-handheld-memory-audit-usage.md
git commit -m "docs: add handheld memory audit usage"
```

## Self-Review Checklist

- Spec coverage:
  - The audit measures per-game peak RSS across the bundled `testdata` corpus.
  - The measured path uses `--native-compile`, matching the handheld native compiler/runtime premise.
  - The report flags records above a hard memory ceiling and defaults that ceiling to 32 MB.
  - The Make target regenerates the corpus bundle before measuring.
  - The usage note explains that host RSS is an outlier-ranking proxy, not an embedded heap proof.
- Deferred to separate plans:
  - Runtime-load allocation diagnosis and memory reduction.
  - rv32/32-bit cross-build and emulation parity.
  - Runtime-only binary-size budget.
  - ESP32-P4 compile-time estimation and compiled-cache scope decision.
- Placeholder scan:
  - The plan contains no unresolved placeholder markers, vague error-handling steps, or unexpanded test-writing steps.
- Type consistency:
  - `parseTimeOutput`, `loadNdjsonCorpusText`, `sourceFileName`, `summarizeResults`, and `runMeasuredGame` are defined before later steps depend on them.
  - Makefile variable names match the usage note and commands.
