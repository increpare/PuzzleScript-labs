#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadFixtures, fixtureTuple } = require('./fixtures.cjs');
const BEGIN = '// BEGIN GENERATED SEMANTIC FIXTURES';
const END = '// END GENERATED SEMANTIC FIXTURES';

function renderSection(fixtures) {
  return BEGIN + '\n// Edit ../semantic-fixtures/ sources and manifests, then run export.cjs.\n'
    + 'testdata.push(\n' + fixtures.map(fixture => '\t' + JSON.stringify(fixtureTuple(fixture))).join(',\n')
    + '\n);\n' + END + '\n';
}

function replaceGeneratedSection(original, section) {
  const start = original.indexOf(BEGIN), end = original.indexOf(END);
  if (start < 0) {
    assert.equal(end, -1, 'Unmatched semantic fixture marker');
    return original + (original.endsWith('\n') ? '\n' : '\n\n') + section;
  }
  assert.ok(end > start && original.indexOf(BEGIN, start + 1) === -1 && original.indexOf(END, end + 1) === -1,
    'Malformed or duplicate semantic fixture markers');
  const suffix = original.slice(end + END.length).replace(/^\r?\n/, '');
  return original.slice(0, start) + section + suffix;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  assert.ok(args.every(arg => arg === '--check' || arg === '--stdout') && args.length <= 1,
    'Usage: node export.cjs [--check|--stdout]');
  const fixtures = loadFixtures();
  assert.ok(fixtures.length > 0, 'No semantic fixtures found');
  if (args.includes('--stdout')) process.stdout.write('var testdata = ' + JSON.stringify(fixtures.map(fixtureTuple), null, 2) + ';\n');
  else {
    const target = path.join(__dirname, '..', 'resources', 'testdata.js');
    const original = fs.readFileSync(target, 'utf8');
    const updated = replaceGeneratedSection(original, renderSection(fixtures));
    if (args.includes('--check')) {
      assert.ok(updated === original, 'Generated semantic fixtures are stale; run node src/tests/semantic-fixtures/export.cjs');
      console.log('Semantic fixture export is current (' + fixtures.length + ' cases).');
    } else { fs.writeFileSync(target, updated); console.log('Exported ' + fixtures.length + ' semantic cases to testdata.js.'); }
  }
}

module.exports = { renderSection, replaceGeneratedSection };
