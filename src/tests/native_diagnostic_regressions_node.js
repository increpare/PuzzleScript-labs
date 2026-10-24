#!/usr/bin/env node
'use strict';
// Append a unique comment and use an empty cwd so the legacy fixture lookup
// cannot supply expected diagnostics for these regression cases.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const binary=process.argv[2];assert(binary,'Pass the native CLI executable');
const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'resources/errormessage_testdata.js'),'utf8'),context);
const updated=new Set([
    "You can't have anything in with an ellipsis. Sorry.",
    'Game title is too long to fit on screen; truncating to fit.',
    'A rule-group can only be marked random by the opening rule in the group',
    'An ellipsis on the right must be matched by one in the corresponding place on the left.',
    '#1067 [ player no wall ] message test suite, No. 5',
]);
const selected=context.errormessage_testdata.filter(([name])=>updated.has(name)||name.startsWith('#1192')||name.startsWith('diagnostic coverage:'));
const tests=[...new Map(selected.map(row=>[JSON.stringify(row),row])).values()];
assert.equal(tests.length,17);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ps-real-diagnostics-'));
try {
    const fixture=path.join(directory,'independent.js');
    fs.writeFileSync(fixture,'var errormessage_testdata = '+JSON.stringify(tests.map(([name,[source,...rest]])=>[name,[source+'\n(independent native diagnostic canary)\n',...rest]]))+';');
    const run=spawnSync(path.resolve(binary),['test','diagnostics-corpus',fixture],{cwd:directory,encoding:'utf8',windowsHide:true});
    assert.equal(run.status,0,run.stdout+run.stderr);
    process.stdout.write(run.stdout+run.stderr);
} finally {fs.rmSync(directory,{recursive:true,force:true});}
