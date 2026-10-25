'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPuzzleScript } = require('./native-host.cjs');

function createRuleDuplicatesOracle(types) {
  loadPuzzleScript({ includeTests: true });
  const qualifierNames = ['', 'up', 'down', 'left', 'right', 'action', 'stationary', 'no', 'random', 'randomdir',
    'horizontal', 'vertical', 'orthogonal', 'moving', '>', '<', '^', 'v', 'parallel', 'perpendicular',
    'horizontal_par', 'vertical_par', 'horizontal_perp', 'vertical_perp', '...'];
  const directionNames = ['up', 'down', 'left', 'right', 'action'];
  const commandNames = ['cancel', 'restart', 'win', 'checkpoint', 'again', 'message', 'sound'];
  const producers = [...new Set(['compiler.js', 'parser.js'].flatMap(file => {
    const source = fs.readFileSync(path.join(__dirname, './vanilla/js', file), 'utf8');
    return [...source.matchAll(/^function (\w+)\s*\(/gm)].map(match => match[1]);
  }))];

  const nativeView = (rules, oriented = true) => rules.map(rule => ({
    line: rule.lineNumber, sourceGroup: rule.groupNumber,
    ...(oriented ? { direction: rule.direction } : { directions: [...rule.directions] }),
    lhs: structuredClone(rule.lhs), rhs: structuredClone(rule.rhs), late: rule.late,
    rigid: rule.rigid, random: rule.randomRule, commands: structuredClone(rule.commands),
  }));

  function nativeNormalize(rules) {
    // Snapshot before native caching mutates records; selection uses original identities.
    const before = nativeView(rules);
    const inputs = [...rules];
    rules.forEach(rule => cacheRuleStringRep(rule));
    const state = { rules };
    removeDuplicateRules(state);
    return { before, after: nativeView(state.rules), indices: state.rules.map(rule => inputs.indexOf(rule)) };
  }

  function nativeStages(source) {
    resetParserErrorState();
    const processor = new codeMirrorFn();
    const parsed = processor.startState();
    // Original text is the only input shared with the candidate pipeline.
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    generateExtraMembers(parsed);
    generateMasks(parsed);
    const rules = [];
    for (const tuple of parsed.rules) {
      const rule = processRuleString(tuple, parsed, rules);
      if (rule !== null && rule.bracket === undefined) rules.push(rule);
    }
    const syntax = nativeView(rules, false);
    checkSuperfluousCoincidences(parsed, rules);
    const negatives = nativeView(rules, false);
    const orientedRules = [];
    for (const rule of rules) for (const direction of rule.directions) {
      const copy = deepCloneRule(rule);
      copy.direction = direction;
      convertRelativeDirsToAbsolute(copy);
      rewriteUpLeftRules(copy);
      orientedRules.push(copy);
    }
    const oriented = nativeView(orientedRules);
    for (const rule of orientedRules) {
      atomizeAggregates(parsed, rule);
      rephraseSynonyms(parsed, rule);
    }
    const named = nativeView(orientedRules);
    const movementRules = orientedRules.flatMap(rule => concretizeMovingRule(parsed, rule, rule.lineNumber));
    const movement = nativeView(movementRules);
    const propertyRules = movementRules.flatMap(rule => concretizePropertyRule(parsed, rule, rule.lineNumber));
    const properties = nativeView(propertyRules);
    propertyRules.forEach(rule => makeSpawnedObjectsStationary(parsed, rule, rule.lineNumber));
    return { syntax, negatives, oriented, named, movement, properties, ...nativeNormalize(propertyRules) };
  }

  function freezeInput(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) for (const [key, child] of value) { freezeInput(key, seen); freezeInput(child, seen); }
    else if (value instanceof Set) for (const child of value) freezeInput(child, seen);
    else for (const child of Object.values(value)) freezeInput(child, seen);
    Object.freeze(value);
  }

  function independently(callback) {
    const originals = producers.map(name => globalThis[name]);
    const originalParser = codeMirrorFn, originalStream = CodeMirror.StringStream;
    try {
      for (const name of producers) globalThis[name] = () => { throw new Error('Candidate called native ' + name); };
      codeMirrorFn = function() { throw new Error('Candidate called native codeMirrorFn'); };
      CodeMirror.StringStream = function() { throw new Error('Candidate called native CodeMirror.StringStream'); };
      return callback();
    } finally {
      codeMirrorFn = originalParser;
      CodeMirror.StringStream = originalStream;
      producers.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
  }

  function candidateView(rules, oriented = true) {
    const rows = side => side.map(row => row.map(cell => cell.flatMap(term => {
      assert.ok(Number.isInteger(term.qualifier) && qualifierNames[term.qualifier] !== undefined, 'numeric qualifier');
      assert.equal(typeof term.name, 'string', 'named terms retain string identities');
      return [qualifierNames[term.qualifier], term.name];
    })));
    return rules.map(rule => ({ line: rule.source.originalLine.span.start.line, sourceGroup: rule.sourceGroup,
      ...(oriented ? { direction: directionNames[rule.direction] } : { directions: rule.directions.map(dir => directionNames[dir]) }),
      lhs: rows(rule.lhs), rhs: rows(rule.rhs), late: rule.late, rigid: rule.rigid, random: rule.random,
      commands: rule.commands.map(command => command.kind === types.CommandKind.Sound ? ['sfx' + command.index]
        : command.kind === types.CommandKind.Message ? ['message', command.text] : [commandNames[command.kind]]),
    }));
  }

  function candidateStages(source, options = {}) {
    return independently(() => {
      const { document } = (options.readSource ?? types.readSource)(source);
      freezeInput(document);
      // One declaration resolution supplies every typed source stage.
      const { declarations } = types.resolveDeclarations(document);
      freezeInput(declarations);
      const syntax = types.recoverRuleSyntax(document, declarations);
      freezeInput(syntax);
      const negatives = types.checkEarlyNegativeTerms(syntax.rules, declarations);
      freezeInput(negatives);
      const oriented = types.orientRules(negatives.rules);
      freezeInput(oriented);
      const named = types.expandRuleNames(oriented, declarations);
      freezeInput(named);
      const movement = types.expandRuleMovements(named.rules);
      freezeInput(movement);
      const properties = types.expandRuleProperties(movement.rules, declarations);
      freezeInput(properties);
      const spawned = types.inferSpawnedStationary(properties.rules, declarations);
      freezeInput(spawned);
      const inputs = { document, declarations, syntax, negatives, oriented, named, movement, properties, spawned };
      const snapshot = structuredClone(inputs);
      const result = (options.normalizeRuleDuplicates ?? types.normalizeRuleDuplicates)(spawned);
      assert.deepEqual(inputs, snapshot, 'duplicate inputs are unchanged');
      return { ...inputs, result };
    });
  }

  function checkSurvivors(result, inputs, indices) {
    assert.ok(Array.isArray(result), 'ordinary survivor array');
    assert.notEqual(result, inputs, 'new duplicate collection');
    assert.equal(result.length, indices.length, 'survivor count');
    result.forEach((rule, index) => {
      assert.equal(rule, inputs[indices[index]], 'selected original survivor identity and provenance');
    });
  }

  function compareFixture(fixture, options = {}) {
    const expected = nativeStages(fixture.source);
    const candidate = candidateStages(fixture.source, options);
    const stages = { syntax: candidate.syntax.rules, negatives: candidate.negatives.rules, oriented: candidate.oriented,
      named: candidate.named.rules, movement: candidate.movement.rules, properties: candidate.properties.rules, before: candidate.spawned };
    for (const [stage, rules] of Object.entries(stages)) {
      assert.deepEqual(candidateView(rules, stage !== 'syntax' && stage !== 'negatives'), expected[stage], fixture.name + ': ' + stage + ' sequence');
    }
    assert.deepEqual(candidateView(candidate.result), expected.after, fixture.name + ': complete duplicate sequence');
    checkSurvivors(candidate.result, candidate.spawned, expected.indices);
    return { ...candidate, expected };
  }

  function compareBoundary(fixture, options = {}) {
    // Explicit stage-boundary fixtures are constructed independently in both models.
    assert.match(fixture.name, /stage-boundary/, 'artificial fixture is labelled');
    const expected = nativeNormalize(fixture.native());
    const inputs = independently(fixture.candidate);
    freezeInput(inputs);
    const snapshot = structuredClone(inputs);
    const result = independently(() => (options.normalizeRuleDuplicates ?? types.normalizeRuleDuplicates)(inputs));
    assert.deepEqual(inputs, snapshot, 'duplicate boundary inputs are unchanged');
    assert.deepEqual(candidateView(inputs), expected.before, fixture.name + ': independent boundary input');
    assert.deepEqual(candidateView(result), expected.after, fixture.name + ': complete duplicate sequence');
    checkSurvivors(result, inputs, expected.indices);
    return { inputs, result, expected };
  }

  return { nativeStages, candidateStages, compareFixture, compareBoundary, independently, producers,
    corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })) };
}

module.exports = { createRuleDuplicatesOracle };
