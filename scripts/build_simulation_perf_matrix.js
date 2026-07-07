#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build', 'codex-perf');
const SMOKE_CASES = 30;
const PY = process.env.ESP32_PYTHON || 'C:/Espressif/tools/python/v6.0.2/venv/Scripts/python.exe';
const ESP_PORT = process.env.ESP32_PORT || 'COM3';

function readJson(filePath) {
    let buffer = fs.readFileSync(filePath);
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        buffer = buffer.slice(2);
        return JSON.parse(buffer.toString('utf16le'));
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        throw new Error(`unsupported UTF-16 BE JSON file: ${filePath}`);
    }
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
}

function pct(part, total) {
    if (!total) {
        return null;
    }
    return Math.round((1000 * part) / total) / 10;
}

function ratio(numerator, denominator) {
    if (!denominator) {
        return null;
    }
    return Math.round((1000 * numerator) / denominator) / 1000;
}

function rowFromJs(profile, label, cases) {
    const b = profile.breakdown_avg_ms || {};
    const compileMs = b.compile_ms || 0;
    const movesMs = (b.process_input_ms || 0) + (b.undo_ms || 0) + (b.restart_ms || 0);
    const totalMs = profile.average_ms || profile.median_ms || 0;
    const otherMs = Math.max(0, totalMs - compileMs - movesMs);
    return {
        runtime: label,
        corpus: cases === 470
            ? 'src/tests/resources/testdata.js'
            : `smoke subset (${cases} cases, evenly sampled)`,
        cases,
        repeats: profile.cold_process_runs || 1,
        jobs: 1,
        mask_bits: 32,
        turn_executor: 'interpreter',
        status: profile.status || 'unknown',
        total_ms: totalMs,
        compile_ms: compileMs,
        moves_ms: movesMs,
        other_ms: otherMs,
        compile_pct: pct(compileMs, totalMs),
        moves_pct: pct(movesMs, totalMs),
        other_pct: pct(otherMs, totalMs),
        detail: {
            process_input_ms: b.process_input_ms || 0,
            undo_ms: b.undo_ms || 0,
            restart_ms: b.restart_ms || 0,
        },
        source_json: profile.source_json || 'build/codex-perf/js_simulation_profile.json',
    };
}

function rowFromNative(summary, label, sourceJson, maskBits, cases) {
    const p = summary.profile || {};
    const totalMs = p.wall_ms || summary.status_summary?.elapsed_ms || 0;
    const compileMs = p.source_compile_ms || 0;
    const movesMs = p.replay_ms || 0;
    const otherMs = Math.max(
        0,
        totalMs
        - compileMs
        - movesMs
        - (p.testdata_parse_ms || 0)
        - (p.session_create_ms || 0)
        - (p.level_load_ms || 0)
        - (p.serialize_ms || 0),
    );
    const caseCount = summary.status_summary?.cases || cases;
    return {
        runtime: label,
        corpus: caseCount === 470
            ? 'src/tests/resources/testdata.js'
            : `smoke subset (${caseCount} cases, evenly sampled)`,
        cases: caseCount,
        repeats: summary.status_summary?.repeats || 1,
        jobs: summary.status_summary?.jobs || 1,
        mask_bits: maskBits,
        turn_executor: summary.status_summary?.turn_executor || 'interpreter',
        status: summary.status_summary?.failed === 0 ? 'ok' : 'failed',
        total_ms: totalMs,
        compile_ms: compileMs,
        moves_ms: movesMs,
        other_ms: otherMs,
        compile_pct: pct(compileMs, totalMs),
        moves_pct: pct(movesMs, totalMs),
        other_pct: pct(otherMs, totalMs),
        detail: {
            testdata_parse_ms: p.testdata_parse_ms || 0,
            session_create_ms: p.session_create_ms || 0,
            level_load_ms: p.level_load_ms || 0,
            serialize_ms: p.serialize_ms || 0,
        },
        source_json: sourceJson,
    };
}

function runProfile(command, args, outPath) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        env: Object.assign({}, process.env, { PUZZLESCRIPT_SKIP_AUXILIARY_TESTS: '1' }),
    });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
    }
    if (outPath.endsWith('.json') && command.endsWith('node')) {
        const start = result.stdout.indexOf('{');
        const end = result.stdout.lastIndexOf('}');
        if (start < 0 || end < start) {
            throw new Error(`expected JSON on stdout from ${command}`);
        }
        fs.writeFileSync(outPath, `${result.stdout.slice(start, end + 1)}\n`, 'utf8');
    }
    return result.stdout;
}

function addSpeedups(rows) {
    const js = rows.find((row) => row.runtime.startsWith('JS'));
    if (!js) {
        return rows;
    }
    return rows.map((row) => ({
        ...row,
        speedup_vs_js: {
            total: ratio(js.total_ms, row.total_ms),
            compile: ratio(js.compile_ms, row.compile_ms),
            moves: ratio(js.moves_ms, row.moves_ms),
        },
    }));
}

function rowFromEsp32ProbeSummary(probeSummary, sourceJson, cases) {
    const event = probeSummary?.simulation_corpus_summary;
    if (!event || !event.profile) {
        return {
            runtime: `C++ interpreter (ESP32-P4 on-device, smoke ${cases})`,
            corpus: `smoke subset (${cases} cases, evenly sampled)`,
            cases,
            repeats: 1,
            jobs: 1,
            mask_bits: 32,
            turn_executor: 'interpreter',
            status: 'missing',
            total_ms: null,
            compile_ms: null,
            moves_ms: null,
            other_ms: null,
            compile_pct: null,
            moves_pct: null,
            other_pct: null,
            detail: {},
            source_json: sourceJson,
        };
    }
    return rowFromNative(
        {
            status_summary: event.status_summary || {},
            profile: event.profile || {},
        },
        `C++ interpreter (ESP32-P4 on-device, smoke ${cases})`,
        sourceJson,
        32,
        cases,
    );
}

function buildSmokeArtifacts(smokeCases) {
    const smokeNdjson = path.join(OUT_DIR, 'simulation_corpus_smoke.ndjson');
    const smokeTestdata = path.join(OUT_DIR, 'smoke_testdata.js');
    runProfile(process.execPath, [
        path.join('scripts', 'build_simulation_corpus_bundle.js'),
        '--limit',
        String(smokeCases),
        '--max-source-bytes',
        '4096',
        '--out',
        smokeNdjson,
        '--testdata-out',
        smokeTestdata,
    ], smokeNdjson);
    return { smokeNdjson, smokeTestdata, smokeCases };
}

function flashSmokeCorpus(smokeNdjson) {
    runProfile(PY, [
        path.join('scripts', 'flash_esp32p4_corpus_storage.py'),
        '--port',
        ESP_PORT,
        '--bundle',
        path.relative(ROOT, smokeNdjson),
    ], smokeNdjson);
}

function captureEsp32Probe(logPath, timeoutMs) {
    const result = spawnSync(PY, [
        path.join('scripts', 'esp32p4_probe_capture.py'),
        '--port',
        ESP_PORT,
        '--out',
        path.relative(ROOT, logPath),
        '--reset',
        '--timeout-ms',
        String(timeoutMs),
        '--done-pattern',
        'simulation_corpus_summary',
    ], {
        cwd: ROOT,
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        throw new Error(`esp32 capture failed:\n${result.stdout}\n${result.stderr}`);
    }
}

function parseEsp32ProbeSummary(logPath, summaryPath) {
    runProfile(process.execPath, [
        path.join('scripts', 'esp32p4_probe_log.js'),
        '--log',
        path.relative(ROOT, logPath),
        '--out',
        path.relative(ROOT, summaryPath),
    ], summaryPath);
}

function buildMatrix(options) {
    const smokeCases = options.smokeCases;
    const rows = [
        rowFromJs(
            Object.assign(readJson(options.jsProfile), { source_json: path.relative(ROOT, options.jsProfile) }),
            options.smoke ? `JS (Node, smoke ${smokeCases})` : 'JS (Node, simulation corpus)',
            smokeCases,
        ),
        rowFromNative(
            readJson(options.native64Profile),
            options.smoke ? `C++ interpreter (desktop 64-bit, smoke ${smokeCases})` : 'C++ interpreter (desktop, 64-bit masks)',
            path.relative(ROOT, options.native64Profile),
            64,
            smokeCases,
        ),
        rowFromNative(
            readJson(options.native32Profile),
            options.smoke ? `C++ interpreter (desktop 32-bit, smoke ${smokeCases})` : 'C++ interpreter (desktop, 32-bit masks)',
            path.relative(ROOT, options.native32Profile),
            32,
            smokeCases,
        ),
    ];
    if (options.espProbeSummary && fs.existsSync(options.espProbeSummary)) {
        const probeReport = readJson(options.espProbeSummary);
        rows.push(rowFromEsp32ProbeSummary(
            probeReport.summary,
            path.relative(ROOT, options.espProbeSummary),
            smokeCases,
        ));
    }
    return {
        generated_at: new Date().toISOString(),
        corpus: options.smoke
            ? `smoke subset (${smokeCases} cases, evenly sampled from testdata.js)`
            : 'src/tests/resources/testdata.js',
        notes: [
            options.smoke
                ? `Smoke mode: ${smokeCases} evenly spaced simulation cases (same subset on JS, desktop C++, and ESP32).`
                : 'Full 470-case simulation corpus.',
            'All rows use interpreter turn execution.',
            'JS moves_ms = processInput + undo + restart from --breakdown instrumentation.',
            'C++ moves_ms = replay_ms (input replay through native runtime).',
            'C++ other_ms = parse + session create + level load + serialize overhead.',
            'ESP32 row comes from simulation_corpus_summary JSON emitted on-device.',
        ],
        rows: addSpeedups(rows),
    };
}

function printMatrix(matrix) {
    const header = ['Runtime', 'Cases', 'Total', 'Compile', 'Moves', 'Other', 'vs JS'];
    const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
    for (const row of matrix.rows) {
        lines.push([
            row.runtime,
            String(row.cases),
            row.total_ms == null ? 'n/a' : `${row.total_ms}ms`,
            row.compile_ms == null ? 'n/a' : `${row.compile_ms}ms`,
            row.moves_ms == null ? 'n/a' : `${row.moves_ms}ms`,
            row.other_ms == null ? 'n/a' : `${row.other_ms}ms`,
            row.speedup_vs_js && row.speedup_vs_js.total != null ? `${row.speedup_vs_js.total}x` : 'n/a',
        ].join(' | '));
    }
    process.stdout.write(`${lines.join('\n')}\n`);
}

function parseArgs(argv) {
    const options = {
        jsProfile: path.join(OUT_DIR, 'js_simulation_profile.json'),
        native64Profile: path.join(OUT_DIR, 'native_interp_64_profile.json'),
        native32Profile: path.join(OUT_DIR, 'native_interp_32_profile.json'),
        espProbeSummary: path.join(OUT_DIR, 'esp32p4_probe_live_summary.json'),
        out: path.join(OUT_DIR, 'simulation_perf_matrix.json'),
        run: false,
        smoke: false,
        smokeCases: SMOKE_CASES,
        skipEsp: false,
        print: true,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--run') {
            options.run = true;
        } else if (arg === '--smoke') {
            options.smoke = true;
        } else if (arg === '--skip-esp') {
            options.skipEsp = true;
        } else if (arg === '--smoke-cases' && argv[index + 1]) {
            options.smokeCases = Number(argv[index + 1]);
            index += 1;
        } else if (arg === '--no-print') {
            options.print = false;
        } else if (arg === '--out') {
            index += 1;
            options.out = path.isAbsolute(argv[index]) ? argv[index] : path.join(ROOT, argv[index]);
        } else if (arg === '--help' || arg === '-h') {
            process.stdout.write(
                'Usage: node scripts/build_simulation_perf_matrix.js [--run] [--smoke] [--smoke-cases 30] [--skip-esp]\n',
            );
            process.exit(0);
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }
    if (options.smoke) {
        const suffix = `_smoke${options.smokeCases}`;
        options.jsProfile = path.join(OUT_DIR, `js_simulation_profile${suffix}.json`);
        options.native64Profile = path.join(OUT_DIR, `native_interp_64_profile${suffix}.json`);
        options.native32Profile = path.join(OUT_DIR, `native_interp_32_profile${suffix}.json`);
        options.espProbeSummary = path.join(OUT_DIR, `esp32p4_probe_smoke_summary.json`);
        options.out = path.join(OUT_DIR, `simulation_perf_matrix_smoke${options.smokeCases}.json`);
    }
    return options;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    fs.mkdirSync(OUT_DIR, { recursive: true });

    if (options.run) {
        let smokeTestdata = path.join(ROOT, 'src/tests/resources/testdata.js');
        let smokeNdjson = null;
        if (options.smoke) {
            const smoke = buildSmokeArtifacts(options.smokeCases);
            smokeTestdata = smoke.smokeTestdata;
            smokeNdjson = smoke.smokeNdjson;
        }

        const jsEnv = Object.assign({}, process.env, {
            PUZZLESCRIPT_SKIP_AUXILIARY_TESTS: '1',
            PUZZLESCRIPT_TESTDATA: smokeTestdata,
        });
        const jsResult = spawnSync(process.execPath, [
            path.join('src', 'tests', 'run_tests_node.js'),
            '--profile',
            '--profile-runs',
            '1',
            '--sim-only',
            '--breakdown',
            '--profile-json',
        ], {
            cwd: ROOT,
            encoding: 'utf8',
            env: jsEnv,
        });
        if (jsResult.status !== 0) {
            throw new Error(`js profile failed:\n${jsResult.stdout}\n${jsResult.stderr}`);
        }
        const start = jsResult.stdout.indexOf('{');
        const end = jsResult.stdout.lastIndexOf('}');
        if (start < 0 || end < start) {
            throw new Error('expected JSON on stdout from js profile');
        }
        fs.writeFileSync(options.jsProfile, `${jsResult.stdout.slice(start, end + 1)}\n`, 'utf8');

        const native64 = path.join(ROOT, 'build', 'native', 'Release', 'puzzlescript_cpp.exe');
        const native32 = path.join(ROOT, 'build-32', 'native', 'Release', 'puzzlescript_cpp.exe');
        const benchArgs = [
            'test',
            'simulation-corpus',
            smokeTestdata,
            '--jobs',
            '1',
            '--repeat',
            '1',
            '--profile-timers',
            '--quiet',
            '--json-summary-out',
        ];
        runProfile(native64, [...benchArgs, options.native64Profile], options.native64Profile);
        runProfile(native32, [...benchArgs, options.native32Profile], options.native32Profile);

        if (options.smoke && !options.skipEsp && smokeNdjson) {
            const espLog = path.join(OUT_DIR, 'esp32p4_probe_smoke.log');
            flashSmokeCorpus(smokeNdjson);
            const fwBin = path.join(ROOT, 'firmware', 'esp32p4', 'build', 'puzzlescript_esp32p4_probe.bin');
            runProfile(PY, [
                '-m', 'esptool',
                '--chip', 'esp32p4',
                '-p', ESP_PORT,
                '-b', '460800',
                'write-flash',
                '--flash-mode', 'dio',
                '--flash-freq', '80m',
                '--flash-size', '32MB',
                '0x10000',
                fwBin,
            ], fwBin);
            captureEsp32Probe(espLog, 900000);
            parseEsp32ProbeSummary(espLog, options.espProbeSummary);
        }
    }

    const matrix = buildMatrix(options);
    fs.writeFileSync(options.out, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
    process.stderr.write(`Wrote ${path.relative(ROOT, options.out)}\n`);
    if (options.print) {
        printMatrix(matrix);
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`build_simulation_perf_matrix: ${error.message}\n`);
        process.exit(1);
    }
}

module.exports = {
    buildMatrix,
    rowFromJs,
    rowFromNative,
};
