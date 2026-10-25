'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nativeSourceObjects } = require('./legacy-source-objects.cjs');
const { createSourceSchedulesOracle } = require('./legacy-source-schedules.cjs');
function createSourceRuleCompilerOracle(types) {
  const stages = createSourceSchedulesOracle(types);
  const gameplayProducers = [...fs.readFileSync(path.join(__dirname, './vanilla/js/engine.js'), 'utf8')
    .matchAll(/^function (\w+)\s*\(/gm)].map(match => match[1]);
  function independently(callback) {
    const originals = gameplayProducers.map(name => globalThis[name]);
    const methods = [];
    const protect = (owner, label) => {
      for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(owner))) {
        if (name === 'constructor' || typeof descriptor.value !== 'function' || !descriptor.writable) continue;
        methods.push({ owner, name, descriptor });
        Object.defineProperty(owner, name, { ...descriptor, value: () => { throw new Error('Candidate called native ' + label + '.' + name); } });
      }
    };
    try {
      for (const [name, constructor] of [['Rule', Rule], ['CellPattern', CellPattern], ['CellReplacement', CellReplacement], ['Level', Level], ['RNG', RNG]]) {
        protect(constructor.prototype, name);
      }
      if (state) {
        protect(state, 'state');
        for (const group of [...(state.rules ?? []), ...(state.lateRules ?? [])]) {
          for (const rule of Array.isArray(group) ? group : [group]) protect(rule, 'compiled rule');
        }
      }
      gameplayProducers.forEach(name => { globalThis[name] = () => { throw new Error('Candidate called native ' + name); }; });
      return stages.independently(callback);
    } finally {
      gameplayProducers.forEach((name, index) => { globalThis[name] = originals[index]; });
      for (const { owner, name, descriptor } of methods) Object.defineProperty(owner, name, descriptor);
    }
  }
  function freezeInput(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) for (const [key, child] of value) { freezeInput(key, seen); freezeInput(child, seen); }
    else if (value instanceof Set) for (const child of value) freezeInput(child, seen);
    else for (const child of Object.values(value)) freezeInput(child, seen);
    Object.freeze(value);
  }
  function nativeCompile(source, options = {}) {
    resetParserErrorState();
    const processor = new codeMirrorFn(), parsed = processor.startState();
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    generateExtraMembers(parsed); generateMasks(parsed);
    const diagnostics = stages.capture(() => rulesToArray(parsed));
    if (parsed.invalid) return { data: null, diagnostics, parsed };
    cacheAllRuleNames(parsed); removeDuplicateRules(parsed);
    const lowered = stages.nativeLower(parsed, options.afterLower);
    const schedules = stages.nativeSchedules(parsed, options.afterNative);
    return { data: schedules, lowered, diagnostics: [...diagnostics, ...lowered.diagnostics, ...schedules.diagnostics], parsed };
  }
  function compareFixture(fixture, options = {}) {
    const expected = nativeCompile(fixture.source, options);
    let document, declarations, result;
    independently(() => {
      ({ document } = types.readSource(fixture.source));
      ({ declarations } = types.resolveDeclarations(document));
      freezeInput(document); freezeInput(declarations);
      const before = structuredClone({ document, declarations });
      result = (options.compileSourceRules ?? types.compileSourceRules)(document, declarations);
      assert.deepEqual({ document, declarations }, before, 'compiler inputs are unchanged');
    });
    assert.equal(result.data === null, expected.data === null, fixture.name + ': native invalid checkpoint');
    assert.deepEqual(Object.keys(result).sort(), ['data', 'diagnostics']);
    if (result.data !== null) {
      assert.deepEqual(Object.keys(result.data).sort(), ['earlyRules', 'lateRules', 'rigid', 'rigidMerges']);
      const candidateSchedule = schedule => {
        assert.deepEqual(Object.keys(schedule).sort(), ['groups', 'loops']);
        assert.ok(schedule.loops instanceof Map);
        return { loops: schedule.loops, groups: schedule.groups.map(group => {
          assert.deepEqual(Object.keys(group).sort(), ['random', 'rules']);
          return { random: group.random, rules: group.rules.map(rule => {
            const source = document.rules.find(source => source.originalLine.span.start.line === rule.sourceLine);
            assert.ok(source && 'lhs' in source, 'canonical authored source line');
            // This shell only reuses the complete lowering field decoder. It
            // supplies no compiled native data to candidate compilation.
            const namedRule = { source, sourceGroup: 0, direction: rule.direction, lhs: [], rhs: [],
              late: false, rigid: false, random: false, commands: rule.commands };
            const [view] = stages.loweringView({ declarations, rules: [namedRule],
              result: { rules: [{ namedRule, executable: rule, overlap: null }], diagnostics: [] } });
            // The native object decoder orders known runtime identities. Do
            // not let that projection hide an extra unassigned declaration.
            const predicates = rule.rows.flat().filter(cell => cell !== types.Ellipsis);
            const edits = rule.replacements.flat().filter(replacement => replacement !== null).map(replacement => replacement.edits);
            const runtimeObjects = [...predicates.flatMap(cell => [...cell.requiredObjects, ...cell.forbiddenObjects,
              ...cell.anyObjects.flatMap(objects => [...objects])]), ...edits.flatMap(edit =>
              [...edit.removeObjects, ...edit.addObjects, ...edit.randomObjects.map(entry => entry.object)])];
            for (const object of runtimeObjects) assert.ok(declarations.objectChoiceOrder.includes(object), 'canonical runtime object identity');
            const { owner, overlap, ...semantic } = view;
            return semantic;
          }) };
        }) };
      };
      const nativeSchedule = schedule => ({ loops: schedule.loops, groups: schedule.groups.map(group => ({
        random: group.random, rules: group.rules.map(rule => {
          const { owner, overlap, ...semantic } = expected.lowered.after[rule.owner];
          return { ...semantic, rigidGroup: rule.rigidGroup };
        }),
      })) });
      assert.deepEqual({ early: candidateSchedule(result.data.earlyRules), late: candidateSchedule(result.data.lateRules),
        rigid: result.data.rigid, rigidMerges: result.data.rigidMerges }, {
        early: nativeSchedule(expected.data.early), late: nativeSchedule(expected.data.late),
        rigid: expected.data.rigid, rigidMerges: expected.data.rigidMerges,
      }, fixture.name + ': every final predicate/edit/command/group/loop/rigid field');
    }
    assert.deepEqual(result.diagnostics.map(issue => {
      assert.equal(issue.phase, types.SourceDiagnosticPhase.Rules);
      assert.equal(typeof issue.code, 'string');
      if (issue.span !== null) for (const position of [issue.span.start, issue.span.end]) {
        const line = document.lines[position.line - 1];
        assert.ok(line && position.column >= 1 && position.column <= line.original.length + 1, 'diagnostic evidence bounds');
        assert.equal(position.offset, line.span.start.offset + position.column - 1, 'diagnostic evidence offsets');
      }
      return { message: issue.message, line: issue.span?.start.line ?? null,
        severity: issue.severity, countsAsError: issue.countsAsError };
    }), expected.diagnostics, fixture.name + ': complete raw rule diagnostics');
    return { document, declarations, result, expected };
  }
  function nativeRandomApplication(source, seed) {
    const testing = unitTesting;
    try {
      unitTesting = true;
      level = new Level(0, 0, 0, 0, new Int32Array(0));
      backups = []; restartTarget = undefined; oldflickscreendat = [];
      messagetext = ''; soundHistory = [];
      compile(['loadLevel', 0], source, seed);
      state.calculateRowColMasks(level);
      const group = state.rules[0];
      const candidates = group.flatMap((rule, index) => {
        const matches = rule.findMatches(level);
        return matches.length === 0 ? [] : generateTuples(matches).map(tuple => ({ index,
          tuple: tuple.map(start => ({ start: { x: Math.floor(start / level.height), y: start % level.height }, gaps: [] })) }));
      });
      const changed = applyRuleGroup(group);
      const objects = nativeSourceObjects(state);
      return { candidates, changed, cells: Array.from({ length: level.height }, (_, y) =>
        Array.from({ length: level.width }, (_, x) => objects.members(level.getCell(x * level.height + y)))),
        commands: [...level.commandQueue], message: messagetext,
        sources: level.commandQueueSourceRules.map(rule => ({ index: group.indexOf(rule), line: rule.lineNumber })),
        random: { i: RandomGen._state.i, j: RandomGen._state.j, permutation: [...RandomGen._state.s] } };
    } finally { unitTesting = testing; }
  }
  function nativeRigidAttempts(source, seed) {
    const testing = unitTesting;
    try {
      unitTesting = true;
      compile(['loadLevel', 0], source, seed);
      const resolve = state.resolveMovements, attempts = [];
      state.resolveMovements = function(current, bans) {
        const retry = resolve.apply(this, arguments);
        attempts.push({ retry, bans: Object.keys(bans).filter(key => bans[key]).map(Number) });
        return retry;
      };
      processInput(-1);
      return attempts;
    } finally { unitTesting = testing; }
  }
  function nativeLoadFailure(source) {
    resetParserErrorState();
    let result;
    const diagnostics = stages.capture(() => {
      try { result = { data: loadFile(source), name: null }; }
      catch (error) { result = { name: error.name }; }
    });
    return { ...result, diagnostics };
  }
  return { ...stages, nativeCompile, compareFixture, independently, gameplayProducers, nativeRandomApplication, nativeRigidAttempts, nativeLoadFailure };
}
module.exports = { createSourceRuleCompilerOracle };
