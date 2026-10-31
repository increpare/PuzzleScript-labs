'use strict';
const assert = require('node:assert/strict');
const { loadPuzzleScript } = require('./native-host.cjs');
const { candidateLoweringView } = require('./legacy-rule-lowering.cjs');
const { createGameDataOracle } = require('./legacy-game-data-oracle.cjs');
const { createDeclarationOracle } = require('./legacy-declaration-oracle.cjs');
const { decodeSessionGame } = require('./legacy-session-data.cjs');
const { nativeSourceObjects, candidateObjectLabels } = require('./legacy-source-objects.cjs');
const { assertVanillaFields } = require('./vanilla-fields.cjs');
const fs = require('node:fs');
const path = require('node:path');

function createSourceCompilerOracle(types) {
  loadPuzzleScript({ includeTests: true });
  const compareGame = createCompiledGameComparator(types);
  const producers = [...new Set(['parser.js', 'compiler.js', 'engine.js'].flatMap(file =>
    [...fs.readFileSync(path.join(__dirname, './vanilla/js', file), 'utf8').matchAll(/^function (\w+)\s*\(/gm)].map(match => match[1])))];
  function independently(callback) {
    const originals = producers.map(name => globalThis[name]);
    const parser = codeMirrorFn, stream = CodeMirror.StringStream, methods = [];
    const protect = owner => {
      for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(owner))) {
        if (name === 'constructor' || typeof descriptor.value !== 'function' || !descriptor.writable) continue;
        methods.push({ owner, name, descriptor });
        Object.defineProperty(owner, name, { ...descriptor, value: () => { throw new Error('Candidate called native prototype ' + name); } });
      }
    };
    try {
      [Rule, CellPattern, CellReplacement, Level, RNG].forEach(constructor => protect(constructor.prototype));
      producers.forEach(name => { globalThis[name] = () => { throw new Error('Candidate called native ' + name); }; });
      codeMirrorFn = function() { throw new Error('Candidate called native parser'); };
      CodeMirror.StringStream = function() { throw new Error('Candidate called native stream'); };
      return callback();
    } finally {
      codeMirrorFn = parser; CodeMirror.StringStream = stream;
      producers.forEach((name, i) => { globalThis[name] = originals[i]; });
      for (const { owner, name, descriptor } of methods) Object.defineProperty(owner, name, descriptor);
    }
  }
  function nativeCompile(source) {
    const saved = { logIssue, loadFile, levelsToArray, setGameState, parser: codeMirrorFn, unitTesting, consoleError: console.error };
    let cursor, parserInterrupted = false;
    let levelLines = [];
    const lines = source.split('\n'), offsets = [];
    let offset = 0;
    for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
    const rawDiagnostics = [], diagnostics = [];
    let formed, installed = false, stopped = false;
    try {
      unitTesting = true;
      // Observe the real parser token cursor without replacing its traversal or recovery.
      codeMirrorFn = function() {
        const processor = new saved.parser(), token = processor.token;
        processor.token = function(stream, parsed) {
          try { return token.apply(this, arguments); }
          catch (error) { parserInterrupted = true; throw error; }
          finally {
            const line = lines[parsed.lineNumber - 1];
            let column = 0, normalized = 0;
            if (stream.string === line) column = stream.pos;
            else for (const character of line) {
              if (normalized >= stream.pos) break;
              column += character.length; normalized += character.toLowerCase().length;
            }
            cursor = { line: parsed.lineNumber, column: column + 1,
              offset: offsets[parsed.lineNumber - 1] + column };
          }
        };
        return processor;
      };
      globalThis.logIssue = function(message, line, urgent, className, countsAsError, printUrgent) {
        const issue = { message, line: line ?? null, severity: className === 'warningText'
          ? types.SourceDiagnosticSeverity.Warning : types.SourceDiagnosticSeverity.Error, countsAsError, urgent: urgent ?? false };
        rawDiagnostics.push(issue);
        const before = errorStrings.length;
        try { return saved.logIssue.apply(this, arguments); }
        finally { if (errorStrings.length > before) diagnostics.push(issue); }
      };
      globalThis.loadFile = function() { formed = saved.loadFile.apply(this, arguments); return formed; };
      globalThis.levelsToArray = parsed => {
        levelLines = parsed.levels.filter(level => level.length > 0).map(level => level[0] === '\n' ? level[2] : level[0]);
        return saved.levelsToArray(parsed);
      };
      globalThis.setGameState = game => { assert.equal(game, formed); installed = true; };
      console.error = () => {};
      try { compile(['restart'], source, 'source compiler oracle'); }
      catch (error) {
        const isIssueCap = error.message === 'Too many errors/warnings; aborting compilation.'
          || error.message === 'Too many errors/warnings; noping out.';
        if (!isIssueCap || diagnostics.length !== 101) throw error;
        stopped = true;
      }
      const kind = stopped || formed === undefined ? types.SourceCompilationKind.Stopped
        : formed === null ? types.SourceCompilationKind.Invalid
        : installed ? types.SourceCompilationKind.Accepted : types.SourceCompilationKind.Declined;
      return { kind, formed, rawDiagnostics, diagnostics, errorCount, stopped, cursor, parserInterrupted, levelLines, palette: { name: Object.entries(colorPalettes).find(([, colors]) => colors === colorPalette)?.[0], colors: [...Object.entries(colorPalette ?? {})] } };
    } finally {
      codeMirrorFn = saved.parser;
      globalThis.logIssue = saved.logIssue; globalThis.loadFile = saved.loadFile;
      globalThis.levelsToArray = saved.levelsToArray; globalThis.setGameState = saved.setGameState; unitTesting = saved.unitTesting; console.error = saved.consoleError;
    }
  }
  const issueView = issue => {
    assertVanillaFields('source diagnostic', issue, ['code', 'message', 'reportedLine', 'severity', 'countsAsError', 'urgent', 'span', 'phase']);
    assert.equal(typeof issue.code, 'string');
    assert.equal(typeof issue.phase, 'number');
    assert.ok(Object.values(types.SourceDiagnosticPhase).includes(issue.phase));
    return { message: issue.message,
      line: issue.reportedLine === undefined ? issue.span?.start.line ?? null : issue.reportedLine,
      severity: issue.severity, countsAsError: issue.countsAsError, urgent: issue.urgent ?? false };
  };
  function compareFixture(fixture, options = {}) {
    const native = nativeCompile(fixture.source);
    options.afterNative?.(native.formed);
    const result = independently(() => (options.compileSource ?? types.compileSource)(fixture.source));
    assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'document', 'errorCount', 'outcome', 'rawDiagnostics']);
    assert.equal(result.document.source, fixture.source, fixture.name + ': original source');
    assert.equal(result.outcome.kind, native.kind, fixture.name + ': installation outcome');
    assert.deepEqual(result.rawDiagnostics.map(issueView), native.rawDiagnostics, fixture.name + ': exact raw diagnostics');
    assert.deepEqual(result.diagnostics.map(issueView), native.diagnostics, fixture.name + ': exact recorded diagnostics');
    assert.equal(result.errorCount, native.errorCount, fixture.name + ': native error count');
    if (result.outcome.kind === types.SourceCompilationKind.Stopped) {
      assert.equal(result.outcome.reason, native.stopped ? types.SourceCompilationStopReason.IssueLimit : types.SourceCompilationStopReason.ParserErrors);
      const stoppedInParser = !native.stopped || native.parserInterrupted;
      assert.deepEqual(Object.keys(result.outcome).sort(), stoppedInParser ? ['cursor', 'kind', 'reason'] : ['kind', 'reason'], 'exact stopped outcome fields');
      if (stoppedInParser) {
        assert.deepEqual(Object.keys(result.outcome.cursor).sort(), ['column', 'line', 'offset'], 'exact stopping cursor fields');
        assert.deepEqual(result.outcome.cursor, native.cursor, 'actual native stopping cursor');
      }
    } else if (result.outcome.kind === types.SourceCompilationKind.Invalid) assert.deepEqual(Object.keys(result.outcome), ['kind']);
    if (native.kind === types.SourceCompilationKind.Accepted || native.kind === types.SourceCompilationKind.Declined) {
      assert.deepEqual(Object.keys(result.outcome).sort(), ['kind', 'game', 'declarations', 'sprites', 'palette', 'displayColors', 'metadata', 'ruleSources'].sort());
      const correspondence = compareGame(fixture, native.formed, result, native.levelLines);
      assert.deepEqual({ name: result.outcome.palette.name, colors: [...result.outcome.palette.colors] }, native.palette, 'complete selected palette');
      return { result, native, correspondence };
    }
    return { result, native };
  }
  return { compareFixture, compareGame, nativeCompile, independently, issueView,
    compilationFixtures: () => errormessage_testdata.map(([name, data]) => ({ name, source: data[0] })),
    corpusFixtures: () => testdata.map(([name, data]) => ({ name, source: data[0] })) };
}
/** Host-free comparator factory, safe for an already installed native session. */
function createCompiledGameComparator(types) {
  const dataOracle = createGameDataOracle(types, { nativeAlreadyLoaded: true });
  const declarationOracle = createDeclarationOracle(types, { nativeAlreadyLoaded: true });
  const fields = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'complete public compiler fields');
  function ruleView(game, declarations, document) {
    const sources = new Map();
    const schedule = value => {
      fields(value, ['groups', 'loops']); assert.ok(value.loops instanceof Map);
      return { loops: value.loops, groups: value.groups.map(group => {
        fields(group, ['random', 'rules']);
        return { random: group.random, rules: group.rules.map(rule => {
          const source = document.rules.find(source => 'lhs' in source && source.originalLine.span.start.line === rule.sourceLine);
          assert.ok(source, 'authored rule source exists');
          assert.ok(!sources.has(rule), 'unique final executable rule identity');
          sources.set(rule, source);
          const predicates = rule.rows.flat().filter(cell => cell !== types.Ellipsis);
          const edits = rule.replacements.flat().filter(replacement => replacement !== null).map(replacement => replacement.edits);
          const runtimeObjects = [...predicates.flatMap(cell => [...cell.requiredObjects, ...cell.forbiddenObjects,
            ...cell.anyObjects.flatMap(objects => [...objects])]), ...edits.flatMap(edit =>
            [...edit.removeObjects, ...edit.addObjects, ...edit.randomObjects.map(entry => entry.object)])];
          for (const object of runtimeObjects) assert.ok(declarations.objectChoiceOrder.includes(object), 'canonical writable runtime object');
          const namedRule = { source, sourceGroup: 0, direction: rule.direction, lhs: [], rhs: [],
            late: false, rigid: false, random: false, commands: rule.commands };
          const [lowered] = candidateLoweringView(types, { declarations, rules: [namedRule],
            result: { rules: [{ namedRule, executable: rule, overlap: null }], diagnostics: [] } });
          const { owner, overlap, ...semantic } = lowered;
          return semantic;
        }) };
      }) };
    };
    return { view: { early: schedule(game.earlyRules), late: schedule(game.lateRules),
      rigid: game.rigid, rigidMerges: game.rigidMerges }, sources };
  }
  function checkDataFields(game) {
    fields(game, ['collisionLayers', 'player', 'levels', 'winConditions', 'metadata', 'sounds', 'movementSounds',
      'failureSounds', 'earlyRules', 'lateRules', 'rigid', 'rigidMerges', 'restorePolicies', 'quirks']);
    // Independently state the complete behavior profile of the pinned revision.
    // Fixed upstream bugs are false; comparing with candidate defaults here
    // would let a wrong default silently redefine the oracle's authority.
    assert.deepEqual(game.quirks, {
      restoreKeepsMovements: true, rigidOwnerOrdinalMerge: false, lhsRandomDirIsUpAndLeft: false,
      combinedMovementsStayPut: true, uniformCanReachOne: true, columnMajorMovementOrder: true,
      lateMovementsCarryOver: false,
    }, 'source oracle compiles with the pinned vanilla profile');
    fields(game.player, ['kind', 'objects']);
    assertVanillaFields('session metadata', game.metadata, ['requirePlayerMovement', 'runRulesOnLevelStart', 'noUndo', 'noRestart', 'flickscreen', 'zoomscreen']);
    for (const level of game.levels) {
      assert.ok(level.kind === types.LevelKind.Grid || level.kind === types.LevelKind.Message, 'unsupported level kind: ' + level.kind);
      fields(level, level.kind === types.LevelKind.Message ? ['kind', 'text', 'sourceLine'] : ['kind', 'board', 'sourceLine']);
      if (level.kind === types.LevelKind.Grid) {
        fields(level.board, ['width', 'height', 'rows']);
        for (const row of level.board.rows) for (const cell of row) fields(cell, ['objects']);
      }
    }
    for (const win of game.winConditions) {
      fields(win, ['quantifier', 'subject', 'target']);
      fields(win.subject, ['kind', 'objects']); fields(win.target, ['kind', 'objects']);
    }
    fields(game.sounds, ['simple', 'sfx', 'creation', 'destruction']);
    for (const sound of [...game.sounds.creation, ...game.sounds.destruction]) fields(sound, ['objects', 'seed']);
    for (const sound of [...game.movementSounds.flat(), ...game.failureSounds]) fields(sound, ['objects', 'layer', 'movements', 'seed']);
    for (const policy of game.restorePolicies) {
      fields(policy, ['width', 'height', 'retain']);
      for (const entry of policy.retain) { fields(entry, ['position', 'layer', 'movements']); fields(entry.position, ['x', 'y']); }
    }
  }
  /** Compare semantics and bind canonical identities against an existing native state. No compile/reset. */
  function compareGame(fixture, nativeState, result, levelLines = nativeState.levels.map((level, i) =>
    level.message === undefined ? level.lineNumber : result.document.levels[i].keyword.span.start.line)) {
    const formed = result.outcome, { declarations, game } = formed;
    assertVanillaFields('compiled state', nativeState, ['LAYER_COUNT', 'STRIDE_MOV', 'STRIDE_OBJ', 'aggregateMasks',
      'aggregatesDict', 'arrow_passed', 'backgroundid', 'backgroundlayer', 'bgcolor', 'lhs_rhs_rowcount_difference',
      'rhs_pattern_started', 'current_line_mixed_case',
      'calculateRowColMasks', 'collisionLayers', 'fgcolor', 'glyphDict', 'glyphOrder', 'groupIndex_to_RigidGroupIndex',
      'groupNumber_to_RigidGroupIndex', 'idDict', 'inside_cell', 'lateLoopPoint', 'lateRules', 'layerMasks',
      'legend_aggregates', 'legend_properties', 'legend_synonyms', 'levels', 'lineNumber', 'loopPoint',
      'matchCellRow', 'matchCellRowWildCard', 'metadata', 'metadata_lines', 'moveEntitiesAtIndex', 'objectCount',
      'objectMasks', 'objects', 'original_case_names', 'original_line_numbers', 'playerMask', 'propertiesDict',
      'propertiesSingleLayer', 'repositionEntitiesAtCell', 'resolveMovements', 'rigid', 'rigidGroupIndex_to_GroupIndex',
      'rigidGroups', 'rule_prelude', 'rules', 'sfx_CreationMasks', 'sfx_DestructionMasks', 'sfx_Events',
      'sfx_MovementFailureMasks', 'sfx_MovementMasks', 'sounds', 'synonymsDict', 'winconditions']);
    checkDataFields(game);
    fields(declarations, ['objects', 'orphanedObject', 'objectSources', 'names', 'ruleNames', 'firstDeclarationWords',
      'namedObjects', 'rawObjectLookups', 'namedAggregates', 'soundTargets', 'objectChoiceOrder', 'collisionLayers', 'objectLayers', 'glyphs', 'player', 'background']);
    assert.equal(game.collisionLayers, declarations.collisionLayers, 'canonical game layers');
    assert.equal(game.player, declarations.player, 'canonical player definition');
    const registrations = [...Object.entries(nativeState.objects).map(([name, object]) => [name, object.lineNumber]),
      ...[nativeState.legend_synonyms, nativeState.legend_properties, nativeState.legend_aggregates]
        .flatMap(entries => entries.map(entry => [entry[0], entry.lineNumber]))].sort((a, b) => a[1] - b[1]);
    const firstRegistrations = new Map();
    for (const [name, line] of registrations) if (!firstRegistrations.has(name)) firstRegistrations.set(name, line);
    const byName = entries => [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    assert.deepEqual(byName([...declarations.firstDeclarationWords].map(([name, word]) => [name, word.span.start.line])),
      byName(firstRegistrations), 'complete first accepted name registrations');
    const authoredWords = new Set([...result.document.objects.flatMap(object => object.definitionNames.map(token => token.word)),
      ...result.document.legend.flatMap(entry => entry.name === null ? [] : [entry.name])]);
    for (const word of declarations.firstDeclarationWords.values()) assert.ok(authoredWords.has(word), 'canonical first accepted word identity');
    const nativeDecl = declarationOracle.nativeView(nativeState);
    const candidateDecl = declarationOracle.candidateView(fixture, result.document, declarations);
    assert.deepEqual(candidateDecl, nativeDecl.view, fixture.name + ': complete declarations');
    for (const [name, line] of nativeDecl.sourceLines) assert.equal(declarations.names.get(name)?.word.span.start.line, line, 'canonical name source');
    const data = { data: game, metadata: formed.metadata };
    assert.deepEqual(dataOracle.candidateDataView(fixture, declarations, data), dataOracle.nativeView(nativeState, levelLines), fixture.name + ': complete game data');
    const decoded = decodeSessionGame(nativeState, types), projection = nativeSourceObjects(nativeState);
    // Native deletes loop targets by assigning undefined; absence has the same meaning.
    for (const schedule of [decoded.game.earlyRules, decoded.game.lateRules]) for (const [from, to] of schedule.loops) {
      if (to === undefined) schedule.loops.delete(from);
    }
    const nativeOrphan = projection.orphanedName === null ? null : decoded.objects[0];
    const nativeObjects = Object.values(nativeState.objects).filter(object => object.id !== undefined).map(object => decoded.objects[object.id]);
    const nativeDeclarations = { objects: nativeObjects, orphanedObject: nativeOrphan, objectSources: new Map(),
      collisionLayers: decoded.game.collisionLayers, objectLayers: new Map(nativeObjects.map(object => [object, nativeState.objects[object.name].layer])),
      objectChoiceOrder: projection.entries.map(entry => decoded.objects[entry.id]) };
    const actualRules = ruleView(game, declarations, result.document), expectedRules = ruleView(decoded.game, nativeDeclarations, result.document);
    assert.deepEqual(actualRules.view, expectedRules.view, fixture.name + ': every executable rule, group, loop and rigid transition');
    assert.ok(formed.ruleSources instanceof Map); assert.equal(formed.ruleSources.size, actualRules.sources.size, 'one source per final rule');
    for (const [rule, source] of actualRules.sources) assert.equal(formed.ruleSources.get(rule), source, 'canonical source-map identity');
    fields(formed.palette, ['name', 'colors']); assert.ok(formed.palette.colors instanceof Map);
    fields(formed.displayColors, ['backgroundColor', 'textColor']);
    assert.deepEqual(formed.displayColors, { backgroundColor: nativeState.bgcolor, textColor: nativeState.fgcolor }, 'display colors');
    assert.equal(formed.sprites.size, declarations.objects.length, 'only authored object sprites');
    assert.equal(formed.sprites.has(declarations.orphanedObject), false, 'no invented orphan sprite');
    const labels = candidateObjectLabels(declarations, fixture.name);
    const sprites = [...formed.sprites].map(([object, sprite]) => {
      assert.ok(declarations.objectSources.has(object), 'canonical sprite key'); fields(sprite, ['colors', 'pixels']);
      return [labels(object), { colors: [...sprite.colors], pixels: sprite.pixels.map(row => row.map(pixel => {
        fields(pixel, pixel.kind === types.SpritePixelKind.Color ? ['kind', 'color'] : ['kind']);
        assert.ok([types.SpritePixelKind.Color, types.SpritePixelKind.Transparent, types.SpritePixelKind.Invalid].includes(pixel.kind));
        return pixel.kind === types.SpritePixelKind.Color ? pixel.color : pixel.kind === types.SpritePixelKind.Transparent ? -1 : NaN;
      })) }];
    });
    assert.deepEqual(sprites, Object.entries(nativeState.objects).map(([name, object]) => {
      assertVanillaFields('compiled object', object, ['lineNumber', 'colors', 'spritematrix', 'id', 'layer']);
      return [name, { colors: object.colors, pixels: object.spritematrix }];
    }), 'all canonical authored sprites');
    const objectIds = new Map(declarations.objectChoiceOrder.map((object, index) => [object, projection.entries[index].id]));
    const nativeRules = new Map();
    for (const [key, nativeKey] of [['earlyRules', 'rules'], ['lateRules', 'lateRules']]) game[key].groups.forEach((group, i) =>
      group.rules.forEach((rule, j) => nativeRules.set(rule, nativeState[nativeKey][i][j])));
    return { objectIds, nativeRules };
  }
  return compareGame;
}

function compareCompiledGame(types, fixture, nativeState, result, levelLines) {
  return createCompiledGameComparator(types)(fixture, nativeState, result, levelLines);
}

module.exports = { createSourceCompilerOracle, createCompiledGameComparator, compareCompiledGame };
