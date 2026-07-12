#!/usr/bin/env node
'use strict';

const probe = require('./handheld_probe_log');

if (require.main === module) {
    try {
        process.exitCode = probe.runCli(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`esp32p4_probe_log: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = probe;
