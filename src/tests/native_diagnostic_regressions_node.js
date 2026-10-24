#!/usr/bin/env node
'use strict';
// Compile real sources in isolation, including in a cwd containing deliberately
// poisoned fixture answers. Diagnostics must depend only on the source.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const binary=process.argv[2];assert(binary,'Pass the native CLI executable');
const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'resources/errormessage_testdata.js'),'utf8'),context);
const tests=context.errormessage_testdata;
assert(tests.length>=321);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ps-real-diagnostics-'));
try {
    const fixture=path.join(directory,'independent.js');
    fs.writeFileSync(fixture,'var errormessage_testdata = '+JSON.stringify(tests.map(([name,[source,...rest]])=>[name,[source+'\n(independent native diagnostic canary)\n',...rest]]))+';');
    const run=spawnSync(path.resolve(binary),['test','diagnostics-corpus',fixture,'--progress-every','0'],{cwd:directory,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
    assert.equal(run.status,0,run.stdout+run.stderr);
    process.stdout.write(run.stdout+run.stderr);
    fs.writeFileSync(fixture,'var errormessage_testdata = '+JSON.stringify(tests)+';');
    const poison=path.join(directory,'src/tests/resources');
    fs.mkdirSync(poison,{recursive:true});
    fs.writeFileSync(path.join(poison,'errormessage_testdata.js'),'var errormessage_testdata = '+JSON.stringify(tests.map(([name,[source]])=>[name,[source,['POISONED FIXTURE ANSWER'],1]]))+';');
    const independent=spawnSync(path.resolve(binary),['test','diagnostics-corpus',fixture,'--progress-every','0'],{cwd:directory,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
    assert.equal(independent.status,0,independent.stdout+independent.stderr);
    assert(!independent.stdout.includes('POISONED FIXTURE ANSWER'));
    // Vary actual identifiers as well as source identity. Keep required Player
    // and Background names, glyphs, title lengths and level messages intact.
    const replacements={crate:'cargo_box',wall:'obstacle_tile',target:'destination_tile',thing:'sample_kind'};
    const rename=text=>text.replace(/\b(crate|wall|target|thing)\b/gi,word=>{
        const value=replacements[word.toLowerCase()];
        return word===word.toUpperCase()?value.toUpperCase():word[0]===word[0].toUpperCase()?value[0].toUpperCase()+value.slice(1):value;
    });
    const renamed=tests.map(([name,[source,expected,...rest]])=>{
        let active=false;
        const changed=source.split('\n').map(line=>{
            const section=line.trim().match(/^(objects|legend|sounds|collisionlayers|rules|winconditions|levels)\b/i);
            if(section) active=section[1].toLowerCase()!=='levels';
            return active?rename(line):line;
        }).join('\n');
        // The win-condition help text contains fixed example object names.
        const messages=expected.map(message=>message.includes('Win conditions is badly formatted')?message:rename(message));
        return [name,[changed,messages,...rest]];
    });
    fs.writeFileSync(fixture,'var errormessage_testdata = '+JSON.stringify(renamed)+';');
    const varied=spawnSync(path.resolve(binary),['test','diagnostics-corpus',fixture,'--progress-every','0'],{cwd:directory,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
    assert.equal(varied.status,0,varied.stdout+varied.stderr);
    console.log(`Native diagnostics: all ${tests.length} fixtures pass with source canaries, poisoned answers and renamed identifiers`);
} finally {
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    fs.rmSync(directory,{recursive:true,force:true});
}
