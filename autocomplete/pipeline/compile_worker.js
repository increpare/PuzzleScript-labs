'use strict';
// Child process for compile_filter.js. Protocol on stdout, one line each:
//   S <id>          about to compile <id> (lets the parent attribute a hang)
//   R <json>        result row for the last S
//   D               done with the assigned range
// Args: <textDir> <idsFile> <startIndex>
// The parent kills and respawns this process when no line arrives within the timeout.

const fs = require('fs');
const path = require('path');
const { compileOne } = require('./compile_filter.js');

const [textDir, idsFile, startArg] = process.argv.slice(2);
const ids = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
const start = parseInt(startArg || '0', 10);
const hangId = process.env.PS_AC_TEST_HANG_ID || null;
if (process.env.PS_AC_TEST_CRASH_START) {
    // Test hook: simulate a worker that dies before compiling anything.
    process.exit(3);
}

for (let i = start; i < ids.length; i++) {
    const id = ids[i];
    process.stdout.write('S ' + id + '\n');
    if (hangId && id === hangId) {
        // Test hook: simulate a compile that never returns.
        for (;;) { /* spin */ }
    }
    let row;
    try {
        const text = fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8');
        row = compileOne(text);
    } catch (err) {
        row = { status: 'errors', errorCount: 1, errorStrings: ['worker exception: ' + String(err && err.message || err)], ms: 0, hash_no_levels: null, hash_mechanics: null };
    }
    row.id = id;
    process.stdout.write('R ' + JSON.stringify(row) + '\n');
}
process.stdout.write('D\n');
