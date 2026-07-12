#!/usr/bin/env node
'use strict';

const path = require('path');
const probe = require('./handheld_probe_log');

const DEFAULT_OUT = path.join('build', 'esp32p4_probe_log_summary.json');

function printUsage(stream) {
    stream.write([
        'Usage: node scripts/esp32p4_probe_log.js --log probe.log [--out build/esp32p4_probe_log_summary.json]',
        '',
        'Summarizes ESP32-P4 board-probe JSON-lines captured from serial monitor output.',
        '',
        'Options:',
        '  --log PATH    captured serial log to parse',
        '  --out PATH    JSON report path (default: build/esp32p4_probe_log_summary.json)',
        '  --require-phase NAME',
        '                require a passing phase; repeat for each required phase',
        '  --require-heap-region NAME',
        '                require at least one heap sample; repeat for each region',
        '  Specifying either requirement option enables the failure gate.',
        '  --fail-on-failure',
        '                exit nonzero if phases, allocations, parsing, or boot checks fail',
        '',
    ].join('\n'));
}

if (require.main === module) {
    try {
        const argv = process.argv.slice(2);
        const options = probe.parseArgs(argv);
        if (options.help) {
            printUsage(process.stdout);
            process.exitCode = 0;
        } else {
            const cliArgs = argv.includes('--out') ? argv : [...argv, '--out', DEFAULT_OUT];
            process.exitCode = probe.runCli(cliArgs);
        }
    } catch (error) {
        process.stderr.write(`esp32p4_probe_log: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = probe;
