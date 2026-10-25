'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPuzzleScript } = require('./native-host.cjs');
const { assertVanillaFields } = require('./vanilla-fields.cjs');
const { nativeSourceObjects, candidateObjectLabels } = require('./legacy-source-objects.cjs');

function createRuleLoweringOracle(types) {
  loadPuzzleScript({ includeTests: true });
  const qualifiers = ['', 'up', 'down', 'left', 'right', 'action', 'stationary', 'no', 'random', 'randomdir',
    'horizontal', 'vertical', 'orthogonal', 'moving', '>', '<', '^', 'v', 'parallel', 'perpendicular',
    'horizontal_par', 'vertical_par', 'horizontal_perp', 'vertical_perp', '...'];
  const directions = ['up', 'down', 'left', 'right', 'action'];
  const commandNames = ['cancel', 'restart', 'win', 'checkpoint', 'again', 'message', 'sound'];
  const producers = [...new Set(['compiler.js', 'parser.js'].flatMap(file =>
    [...fs.readFileSync(path.join(__dirname, './vanilla/js', file), 'utf8').matchAll(/^function (\w+)\s*\(/gm)]
      .map(match => match[1])))];

  const namedView = rules => rules.map(rule => ({ line: rule.lineNumber, sourceGroup: rule.groupNumber,
    direction: rule.direction, lhs: structuredClone(rule.lhs), rhs: structuredClone(rule.rhs),
    late: rule.late, rigid: rule.rigid, random: rule.randomRule, commands: structuredClone(rule.commands) }));
  const candidateNamedView = rules => rules.map(rule => ({ line: rule.source.originalLine.span.start.line,
    sourceGroup: rule.sourceGroup, direction: directions[rule.direction],
    lhs: rule.lhs.map(row => row.map(cell => cell.flatMap(term => [qualifiers[term.qualifier], term.name]))),
    rhs: rule.rhs.map(row => row.map(cell => cell.flatMap(term => [qualifiers[term.qualifier], term.name]))),
    late: rule.late, rigid: rule.rigid, random: rule.random,
    commands: rule.commands.map(command => command.kind === types.CommandKind.Sound ? ['sfx' + command.index]
      : command.kind === types.CommandKind.Message ? ['message', command.text] : [commandNames[command.kind]]) }));

  function parseNative(source) {
    resetParserErrorState();
    const processor = new codeMirrorFn(), parsed = processor.startState();
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    generateExtraMembers(parsed);
    generateMasks(parsed);
    const syntax = [];
    parsed.loops = [];
    for (const tuple of parsed.rules) {
      const rule = processRuleString(tuple, parsed, syntax);
      if (rule !== null && rule.bracket === undefined) syntax.push(rule);
      else if (rule !== null) parsed.loops.push([tuple[1], rule.bracket]);
    }
    checkSuperfluousCoincidences(parsed, syntax);
    const named = [];
    for (const rule of syntax) for (const direction of rule.directions) {
      const copy = deepCloneRule(rule);
      copy.direction = direction;
      convertRelativeDirsToAbsolute(copy);
      rewriteUpLeftRules(copy);
      atomizeAggregates(parsed, copy);
      rephraseSynonyms(parsed, copy);
      named.push(copy);
    }
    const moving = named.flatMap(rule => concretizeMovingRule(parsed, rule, rule.lineNumber));
    const properties = moving.flatMap(rule => concretizePropertyRule(parsed, rule, rule.lineNumber));
    properties.forEach(rule => makeSpawnedObjectsStationary(parsed, rule, rule.lineNumber));
    properties.forEach(rule => cacheRuleStringRep(rule));
    const spawnedCount = properties.length;
    parsed.rules = properties;
    removeDuplicateRules(parsed);
    return { parsed, counts: { syntax: syntax.length, named: named.length, movement: moving.length,
      spawned: spawnedCount, duplicates: parsed.rules.length } };
  }

  function nativeLower(parsed, afterLower = () => {}) {
    const inputs = [...parsed.rules], before = namedView(inputs), diagnostics = [];
    const names = ['logError', 'logWarning', 'logWarningNoLine'];
    const originals = names.map(name => globalThis[name]);
    try {
      globalThis.logError = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Error, countsAsError: true });
      globalThis.logWarning = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: line === undefined });
      globalThis.logWarningNoLine = message => diagnostics.push({ message, line: null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: true });
      rulesToMask(parsed);
    } finally { names.forEach((name, index) => { globalThis[name] = originals[index]; }); }
    afterLower(parsed);
    const projection = nativeSourceObjects(parsed);
    const members = projection.members;
    const movementTerms = mask => {
      const result = [];
      for (let layer = 0; layer < parsed.collisionLayers.length; layer++) {
        for (let movement = 0; movement < 5; movement++) if (mask.get(layer * 5 + movement)) result.push({ layer, movement });
      }
      return result;
    };
    const fullLayers = mask => {
      const result = [];
      for (let layer = 0; layer < parsed.collisionLayers.length; layer++) {
        const section = mask.getshiftor(31, layer * 5);
        assert.ok(section === 0 || section === 31, 'full movement layer');
        if (section) result.push(layer);
      }
      return result;
    };
    const replacement = cell => {
      if (cell === null) return null;
      assertVanillaFields('replacement', cell, ['objectsClear', 'objectsSet', 'movementsClear', 'movementsSet',
        'movementsLayerMask', 'randomEntityMask', 'randomDirMask', 'replace']);
      return { removeObjects: members(cell.objectsClear), addObjects: members(cell.objectsSet),
        removeMovements: movementTerms(cell.movementsClear), addMovements: movementTerms(cell.movementsSet),
        resetMovementLayers: fullLayers(cell.movementsLayerMask),
        randomObjects: projection.entries.filter(entry => cell.randomEntityMask.get(entry.id))
          .map(entry => ({ object: entry.label, layer: parsed.objects[entry.name].layer })),
        randomDirectionLayers: Array.from({ length: parsed.collisionLayers.length }, (_, layer) => layer).filter(layer => {
          const section = cell.randomDirMask.getshiftor(31, layer * 5);
          assert.ok(section === 0 || section === 5, 'native random direction layer encoding');
          return section !== 0;
        }),
        rigidLayers: fullLayers(cell.movementsLayerMask) };
    };
    const after = parsed.rules.map(rule => {
      assertVanillaFields('lowered named rule', rule, ['lineNumber', 'groupNumber', 'direction', 'directions', 'lhs', 'rhs',
        'late', 'rigid', 'randomRule', 'commands', 'stringRep', 'discard', 'ellipsisAtEdge', 'directional',
        // Retained evidence from movement expansion; rulesToMask never reads it.
        'aggregateDirReplacement']);
      return { owner: inputs.indexOf(rule), overlap: rule.discard ?? null,
        direction: directions.indexOf(rule.direction), sourceLine: rule.lineNumber, hasReplacements: rule.rhs.length > 0,
        commands: rule.commands, rigidGroup: null,
        rows: rule.lhs.map(row => row.map(cell => {
          if (cell === ellipsisPattern) return '...';
          assertVanillaFields('cell predicate', cell, ['objectsPresent', 'objectsMissing', 'anyObjectsPresent',
            'movementsPresent', 'movementsMissing', 'replacement', 'matches', 'replace']);
          return { requiredObjects: members(cell.objectsPresent), forbiddenObjects: members(cell.objectsMissing),
            anyObjects: cell.anyObjectsPresent.map(members), requiredMovements: movementTerms(cell.movementsPresent),
            forbiddenMovements: movementTerms(cell.movementsMissing) };
        })),
        replacements: rule.lhs.map(row => row.map(cell => cell === ellipsisPattern ? null : replacement(cell.replacement))) };
    });
    return { before, after, diagnostics, parsed };
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
    const parser = codeMirrorFn, stream = CodeMirror.StringStream;
    try {
      producers.forEach(name => { globalThis[name] = () => { throw new Error('Candidate called native ' + name); }; });
      codeMirrorFn = function() { throw new Error('Candidate called native codeMirrorFn'); };
      CodeMirror.StringStream = function() { throw new Error('Candidate called native CodeMirror.StringStream'); };
      return callback();
    } finally {
      codeMirrorFn = parser;
      CodeMirror.StringStream = stream;
      producers.forEach((name, index) => { globalThis[name] = originals[index]; });
    }
  }
  function candidateStages(source, options = {}) {
    return independently(() => {
      const { document } = (options.readSource ?? types.readSource)(source);
      const { declarations } = types.resolveDeclarations(document);
      freezeInput(document); freezeInput(declarations);
      const syntax = types.recoverRuleSyntax(document, declarations);
      const negatives = types.checkEarlyNegativeTerms(syntax.rules, declarations);
      const oriented = types.orientRules(negatives.rules);
      const named = types.expandRuleNames(oriented, declarations);
      const moving = types.expandRuleMovements(named.rules);
      const properties = types.expandRuleProperties(moving.rules, declarations);
      const spawned = types.inferSpawnedStationary(properties.rules, declarations);
      const duplicates = types.normalizeRuleDuplicates(spawned);
      const rules = options.boundary === undefined ? duplicates : options.boundary(duplicates, declarations);
      const inputs = { document, declarations, syntax, negatives, oriented, named, moving, properties, spawned, duplicates, rules };
      freezeInput(inputs);
      const snapshot = structuredClone(inputs);
      const result = (options.lowerRules ?? types.lowerRules)(rules, declarations);
      assert.deepEqual(inputs, snapshot, 'lowering inputs are unchanged');
      return { ...inputs, result };
    });
  }
  const candidateView = candidate => candidateLoweringView(types, candidate);
  function compareFixture(fixture, options = {}) {
    const native = parseNative(fixture.source);
    if (fixture.native !== undefined) {
      assert.match(fixture.name, /stage-boundary/, 'artificial fixture is labelled');
      native.parsed.rules = fixture.native(native.parsed.rules, native.parsed);
    }
    const expected = nativeLower(native.parsed);
    const candidate = candidateStages(fixture.source, { ...options, ...(fixture.candidate ? { boundary: fixture.candidate } : {}) });
    assert.deepEqual(candidateNamedView(candidate.rules), expected.before, fixture.name + ': full preceding pipeline');
    assert.deepEqual(candidateView(candidate), expected.after, fixture.name + ': exact lowered sequence');
    const issues = candidate.result.diagnostics.map(issue => {
      assert.equal(issue.phase, types.SourceDiagnosticPhase.Rules, 'lowering diagnostic phase');
      assert.ok(issue.span !== null, 'lowering evidence');
      assert.ok(candidate.rules.some(rule => issue.span === rule.source.originalLine.span), 'original diagnostic source span');
      return { message: issue.message, line: issue.span.start.line, severity: issue.severity, countsAsError: issue.countsAsError };
    });
    assert.deepEqual(issues, expected.diagnostics, fixture.name + ': exact ordered diagnostics');
    return { ...candidate, expected, counts: native.counts };
  }
  function nativeApplication(source, seed, inputs) {
    const previousTesting = unitTesting, savedWin = DoWin;
    let won = false;
    try {
      unitTesting = true;
      level = new Level(0, 0, 0, 0, new Int32Array(0));
      backups = []; restartTarget = undefined; oldflickscreendat = [];
      messagetext = ''; soundHistory = [];
      compile(['loadLevel', 0], source, seed);
      DoWin = () => { won = true; };
      const projection = nativeSourceObjects(state);
      const snapshot = () => {
        const cells = Array.from({ length: level.height }, (_, y) =>
          Array.from({ length: level.width }, (_, x) => projection.members(level.getCell(x * level.height + y))));
        const positions = startMovement(8);
        const intent = [];
        for (let x = 0; x < level.width; x++) for (let y = 0; y < level.height; y++) {
          const mask = level.getMovements(x * level.height + y);
          for (let layer = 0; layer < state.collisionLayers.length; layer++) {
            const movements = Array.from({ length: 5 }, (_, movement) => movement).filter(movement => mask.get(layer * 5 + movement));
            if (movements.length > 0) intent.push({ position: { x, y }, layer, movements });
          }
        }
        level.movements.fill(0);
        return { cells, won, playerPositions: positions.map(tile => ({ x: Math.floor(tile / level.height), y: tile % level.height })),
          intent, random: { i: RandomGen._state.i, j: RandomGen._state.j, permutation: [...RandomGen._state.s] } };
      };
      const frames = [snapshot()];
      for (const input of inputs) {
        won = false;
        processInput(input);
        frames.push(snapshot());
      }
      return { frames, errorCount };
    } finally { unitTesting = previousTesting; DoWin = savedWin; }
  }
  return { parseNative, nativeLower, candidateStages, compareFixture, candidateView, independently, producers,
    nativeApplication,
    corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })) };
}

/** Pure projection: does not load, parse, compile or reset a native host. */
function candidateLoweringView(types, candidate) {
  const commandNames = ['cancel', 'restart', 'win', 'checkpoint', 'again', 'message', 'sound'];
  const commandView = command => {
    switch (command.kind) {
      case types.CommandKind.Sound:
        assert.deepEqual(Object.keys(command).sort(), ['index', 'kind'], 'plain command fields');
        return ['sfx' + command.index];
      case types.CommandKind.Message:
        assert.deepEqual(Object.keys(command).sort(), ['kind', 'text'], 'plain command fields');
        return ['message', command.text];
      case types.CommandKind.Cancel:
      case types.CommandKind.Restart:
      case types.CommandKind.Win:
      case types.CommandKind.Checkpoint:
      case types.CommandKind.Again:
        assert.deepEqual(Object.keys(command), ['kind'], 'plain command fields');
        return [commandNames[command.kind]];
      default: assert.fail('unsupported command kind: ' + command.kind);
    }
  };
  const candidateNamedView = rules => rules.map(rule => ({ commands: rule.commands.map(commandView) }));
  const { declarations, rules, result } = candidate;
  const label = candidateObjectLabels(declarations, 'lowering');
  const fields = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.sort(), 'plain public domain fields');
  fields(result, ['rules', 'diagnostics']);
  const sorted = objects => {
    assert.ok(objects instanceof Set, 'ordinary object set');
    for (const object of objects) label(object);
    return declarations.objectChoiceOrder.filter(object => objects.has(object)).map(label);
  };
  const layerSet = layers => { assert.ok(layers instanceof Set); return [...layers].sort((a, b) => a - b); };
  const moves = values => {
    const sortedMoves = [...values].sort((a, b) => a.layer - b.layer || a.movement - b.movement);
    assert.deepEqual(values, sortedMoves, 'public movement order');
    assert.equal(new Set(values.map(value => `${value.layer}:${value.movement}`)).size, values.length, 'distinct movements');
    return sortedMoves;
  };
  return result.rules.map(lowered => {
    fields(lowered, ['namedRule', 'executable', 'overlap']);
    const { namedRule, executable, overlap } = lowered;
    fields(executable, ['direction', 'rows', 'replacements', 'sourceLine', 'hasReplacements', 'commands', 'rigidGroup']);
    const owner = rules.indexOf(namedRule);
    assert.ok(owner >= 0, 'original named rule identity');
    assert.equal(executable.commands, namedRule.commands, 'original command identity');
    const replacements = executable.replacements.map(row => row.map(replacement => {
      if (replacement === null) return null;
      fields(replacement, ['edits', 'rigidLayers']);
      const edits = replacement.edits;
      fields(edits, ['removeObjects', 'addObjects', 'vacateLayers', 'removeMovements', 'addMovements',
        'resetMovementLayers', 'randomObjects', 'randomDirectionLayers']);
      const clear = new Set(edits.removeObjects);
      for (const layer of edits.vacateLayers) for (const object of declarations.collisionLayers[layer]) clear.add(object);
      for (const entry of edits.randomObjects) label(entry.object);
      return { removeObjects: sorted(clear), addObjects: sorted(edits.addObjects),
        removeMovements: moves(edits.removeMovements), addMovements: moves(edits.addMovements),
        resetMovementLayers: layerSet(edits.resetMovementLayers),
        randomObjects: edits.randomObjects.map(entry => ({ object: label(entry.object), layer: entry.layer })),
        randomDirectionLayers: layerSet(edits.randomDirectionLayers), rigidLayers: layerSet(replacement.rigidLayers) };
    }));
    return { owner, overlap, direction: executable.direction, sourceLine: executable.sourceLine,
      hasReplacements: executable.hasReplacements, commands: candidateNamedView([namedRule])[0].commands,
      rigidGroup: executable.rigidGroup,
      rows: executable.rows.map(row => row.map(cell => {
        if (cell === types.Ellipsis) return '...';
        fields(cell, ['requiredObjects', 'forbiddenObjects', 'anyObjects', 'requiredMovements', 'forbiddenMovements']);
        return { requiredObjects: sorted(cell.requiredObjects), forbiddenObjects: sorted(cell.forbiddenObjects),
          anyObjects: cell.anyObjects.map(sorted), requiredMovements: moves(cell.requiredMovements),
          forbiddenMovements: moves(cell.forbiddenMovements) };
      })), replacements };
  });
}

module.exports = { createRuleLoweringOracle, candidateLoweringView };
