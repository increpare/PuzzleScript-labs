#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    auditCompileExceptions,
    countExceptionFailures,
    resolveCppCli,
} = require('./compile_exception_corpus');

const corpusPath = path.join(__dirname, 'solver_tests');
const games = fs.readdirSync(corpusPath)
    .filter(name => name.endsWith('.txt'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .slice(0, 12);

assert.ok(games.length > 0, 'expected solver_tests corpus');

let cppCli = null;
try {
    cppCli = resolveCppCli();
} catch {
    // C++ binary optional for this smoke test.
}

for (const game of games) {
    const filePath = path.join(corpusPath, game);
    const source = fs.readFileSync(filePath, 'utf8');

    const jsResult = auditCompileExceptions(source, game, {
        compiler: 'js',
        jsMode: 'both',
        sourcePath: game,
    });
    assert.strictEqual(jsResult.outcome, 'passed', `${game} JS exception: ${JSON.stringify(jsResult.failures)}`);

    if (cppCli) {
        const cppResult = auditCompileExceptions(source, game, {
            compiler: 'cpp',
            jsMode: 'both',
            sourcePath: game,
            filePath,
            cppCli,
        });
        assert.strictEqual(cppResult.outcome, 'passed', `${game} C++ exception: ${JSON.stringify(cppResult.failures)}`);
    }
}

const brokenSource = `
title Broken
author Test

========
OBJECTS
========

Background
black
00000
00000
00000
00000
00000

=======
LEGEND
=======

. = Background

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background

=====
RULES
=====

======
LEVELS
======

...
`;

const broken = auditCompileExceptions(brokenSource, 'broken_fixture.txt', {
    compiler: 'js',
    jsMode: 'semantic',
    sourcePath: 'broken_fixture.txt',
});
assert.strictEqual(broken.outcome, 'passed');
assert.strictEqual(countExceptionFailures({ tested: 1 }), 0);

console.log(`compile_exception_corpus_audit_node: ok (${games.length} games${cppCli ? ', js+cpp' : ', js only'})`);
