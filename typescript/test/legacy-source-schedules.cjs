'use strict';
const assert = require('node:assert/strict');
const { createRuleLoweringOracle } = require('./legacy-rule-lowering.cjs');
const { assertVanillaFields } = require('./vanilla-fields.cjs');

function createSourceSchedulesOracle(types) {
  // Exactly one host load; reusing the lowering oracle keeps its complete
  // preceding-stage comparisons and unknown-field checks in this boundary.
  const lowering = createRuleLoweringOracle(types);
  function capture(callback) {
    const diagnostics = [];
    const names = ['logError', 'logWarning', 'logWarningNoLine'];
    const originals = names.map(name => globalThis[name]);
    try {
      globalThis.logError = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Error, countsAsError: true });
      globalThis.logWarning = (message, line) => diagnostics.push({ message, line: line ?? null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: line === undefined });
      globalThis.logWarningNoLine = message => diagnostics.push({ message, line: null,
        severity: types.SourceDiagnosticSeverity.Warning, countsAsError: true });
      callback();
    } finally { names.forEach((name, index) => { globalThis[name] = originals[index]; }); }
    return diagnostics;
  }
  function freezeInput(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) for (const [key, child] of value) { freezeInput(key, seen); freezeInput(child, seen); }
    else if (value instanceof Set) for (const child of value) freezeInput(child, seen);
    else for (const child of Object.values(value)) freezeInput(child, seen);
    Object.freeze(value);
  }
  function cloneInput(value, seen = new Map()) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const copy = value instanceof Map ? new Map() : value instanceof Set ? new Set() : Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    if (value instanceof Map) for (const [key, child] of value) copy.set(cloneInput(key, seen), cloneInput(child, seen));
    else if (value instanceof Set) for (const child of value) copy.add(cloneInput(child, seen));
    else for (const [key, child] of Object.entries(value)) copy[key] = cloneInput(child, seen);
    return copy;
  }
  function nativeSchedules(parsed, after = () => {}) {
    const inputs = [...parsed.rules];
    let earlyOwners, lateOwners;
    const diagnostics = capture(() => {
      arrangeRulesByGroupNumber(parsed);
      earlyOwners = parsed.rules.map(group => group.map(rule => inputs.indexOf(rule)));
      lateOwners = parsed.lateRules.map(group => group.map(rule => inputs.indexOf(rule)));
      collapseRules(parsed.rules); collapseRules(parsed.lateRules);
      generateRigidGroupList(parsed);
      generateLoopPoints(parsed);
    });
    after(parsed);
    const rigid = parsed.rigidGroupIndex_to_GroupIndex;
    const schedule = (groups, loops, owners) => ({
      groups: groups.map((group, index) => ({ random: Boolean(group[0].isRandom), rules: group.map((rule, ri) => {
        assertVanillaFields('scheduled rule', rule, ['direction', 'patterns', 'hasReplacements', 'lineNumber',
          'ellipsisCount', 'groupNumber', 'rigid', 'commands', 'isRandom', 'cellRowMasks',
          'cellRowMasks_Movements', 'ruleMask', 'applyAt', 'cellRowMatches', 'findMatches']);
        const input = inputs[owners[index][ri]];
        assert.equal(rule.direction, dirMasks[input.direction], 'collapsed native direction');
        assert.deepEqual(rule.patterns, input.lhs, 'collapsed native pattern values');
        rule.patterns.forEach((row, index) => assert.equal(row, input.lhs[index], 'collapsed native row identity'));
        assert.equal(rule.hasReplacements, input.rhs.length > 0, 'collapsed native replacement policy');
        for (const field of ['lineNumber', 'groupNumber', 'rigid', 'commands']) {
          assert.equal(rule[field], input[field], 'collapsed native ' + field);
        }
        assert.equal(rule.isRandom, input.randomRule, 'collapsed native random policy');
        assert.deepEqual(rule.ellipsisCount, rule.patterns.map(row => row.filter(cell => cell === ellipsisPattern).length));
        assert.deepEqual(rule.cellRowMasks, cellRowMasksGeneric([rule.direction, input.lhs], STRIDE_OBJ, 'objectsPresent'), 'native object row summaries');
        assert.deepEqual(rule.cellRowMasks_Movements, cellRowMasksGeneric([rule.direction, input.lhs], STRIDE_MOV, 'movementsPresent'), 'native movement row summaries');
        const wholeRule = new BitVec(STRIDE_OBJ);
        for (const row of rule.cellRowMasks) wholeRule.ior(row);
        assert.deepEqual(rule.ruleMask, wholeRule, 'native object rule summary');
        return { owner: owners[index][ri], rigidGroup: rule.rigid
          ? rigid[parsed.groupNumber_to_RigidGroupIndex[rule.groupNumber]] ?? null : null };
      }) })),
      loops: new Map(Object.entries(loops).filter(([, to]) => to !== undefined).map(([from, to]) => [Number(from), to])),
    });
    return { early: schedule(parsed.rules, parsed.loopPoint, earlyOwners),
      late: schedule(parsed.lateRules, parsed.lateLoopPoint, lateOwners), rigid: parsed.rigid,
      rigidMerges: new Map(rigid.map((group, i) => [group,
        new Map(rigid.map((incoming, j) => [incoming, rigid[((i + 1) | (j + 1)) - 1] ?? null]))])), diagnostics, parsed };
  }
  // Exercise the actual generated native replacement, with a newly affected
  // second layer forcing the cell-wide guard to merge the first layer's owner.
  // Only the test adapter constructs these native encodings.
  function actualRigidTransitions(parsed) {
    const oldState = state, oldLevel = level;
    try {
      state = parsed;
      RebuildGameArrays();
      sfxCreateMask = new BitVec(STRIDE_OBJ); sfxDestroyMask = new BitVec(STRIDE_OBJ);
      const rigid = parsed.rigidGroupIndex_to_GroupIndex;
      const patterns = layers => {
        const responsibilities = new BitVec(STRIDE_MOV);
        for (const layer of layers) responsibilities.ishiftor(31, 5 * layer);
        const pattern = new CellPattern([new BitVec(STRIDE_OBJ), new BitVec(STRIDE_OBJ), [],
          new BitVec(STRIDE_MOV), new BitVec(STRIDE_MOV), null]);
        pattern.replacement = new CellReplacement([new BitVec(STRIDE_OBJ), new BitVec(STRIDE_OBJ),
          new BitVec(STRIDE_MOV), new BitVec(STRIDE_MOV), responsibilities,
          new BitVec(STRIDE_OBJ), new BitVec(STRIDE_MOV)]);
        return pattern;
      };
      level = new Level(0, 1, 1, parsed.collisionLayers.length, new Int32Array(STRIDE_OBJ));
      const replacements = rigid.map(group => {
        const rule = parsed.rules[group].find(rule => rule.rigid);
        const first = patterns([1]), second = patterns([1, 2]);
        return { rule, first, second, firstReplace: first.generateReplaceFunction(STRIDE_OBJ, STRIDE_MOV, rule),
          secondReplace: second.generateReplaceFunction(STRIDE_OBJ, STRIDE_MOV, rule) };
      });
      return new Map(rigid.map((group, i) => [group, new Map(rigid.map((incoming, j) => {
        RebuildLevelArrays();
        const before = replacements[i], added = replacements[j];
        assert.equal(before.firstReplace.call(before.first, level, before.rule, 0), true, 'first native rigid attribution');
        assert.equal(added.secondReplace.call(added.second, level, added.rule, 0), true, 'new layer enables native owner merge');
        const encoded = level.rigidGroupIndexMask[0].getshiftor(31, 5);
        return [incoming, rigid[encoded - 1] ?? null];
      }))]));
    } finally { state = oldState; level = oldLevel; }
  }
  function candidateView(result, inputs) {
    assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'early', 'late', 'rigid', 'rigidMerges']);
    const owners = new Map();
    for (const key of ['early', 'late']) {
      assert.deepEqual(Object.keys(result[key]).sort(), ['groups', 'loops']);
      assert.ok(result[key].loops instanceof Map, 'ordinary loop Map');
      for (const group of result[key].groups) {
        assert.deepEqual(Object.keys(group).sort(), ['random', 'rules']);
        for (const rule of group.rules) {
          const owner = inputs.findIndex(input => input.executable.rows === rule.rows);
          assert.ok(owner >= 0, 'original pattern identity');
          assert.ok(!owners.has(rule), 'unique executable schedule identity');
          owners.set(rule, owner);
          const input = inputs[owner].executable;
          assert.notEqual(rule, input, 'new executable ownership record');
          assert.deepEqual(Object.keys(rule).sort(), Object.keys(input).sort(), 'plain executable fields');
          for (const key of ['direction', 'sourceLine', 'hasReplacements', 'rows', 'replacements', 'commands']) {
            assert.equal(rule[key], input[key], 'preserve executable ' + key + ' identity/value');
          }
        }
      }
    }
    assert.ok(result.rigidMerges instanceof Map, 'ordinary rigid Map');
    for (const transitions of result.rigidMerges.values()) assert.ok(transitions instanceof Map);
    const schedule = input => ({ groups: input.groups.map(group => ({ random: group.random,
      rules: group.rules.map(rule => ({ owner: owners.get(rule), rigidGroup: rule.rigidGroup })) })), loops: input.loops });
    return { early: schedule(result.early), late: schedule(result.late), rigid: result.rigid, rigidMerges: result.rigidMerges };
  }
  function compareFixture(fixture, options = {}) {
    const compared = lowering.compareFixture(fixture);
    const inputs = options.boundary?.candidate?.(compared.result.rules, compared) ?? compared.result.rules;
    const loops = options.boundary?.loops?.(compared.syntax.loops, compared) ?? compared.syntax.loops;
    const parsed = compared.expected.parsed;
    if (options.boundary !== undefined) {
      assert.match(fixture.name, /stage-boundary/, 'artificial fixture is labelled');
      options.boundary.native?.(parsed.rules, parsed);
    }
    const expected = nativeSchedules(parsed, options.afterNative);
    freezeInput(inputs); freezeInput(loops);
    const snapshot = cloneInput({ inputs, loops });
    let result;
    lowering.independently(() => {
      result = (options.compileRuleSchedules ?? types.compileRuleSchedules)(inputs, loops);
      assert.deepEqual({ inputs, loops }, snapshot, 'schedule inputs are unchanged');
    });
    assert.deepEqual(candidateView(result, inputs), { early: expected.early, late: expected.late,
      rigid: expected.rigid, rigidMerges: expected.rigidMerges }, fixture.name + ': exact schedules');
    const diagnostics = result.diagnostics.map(issue => {
      assert.equal(issue.phase, types.SourceDiagnosticPhase.Rules);
      assert.equal(typeof issue.code, 'string');
      assert.ok(issue.span !== null, 'schedule source evidence');
      assert.ok([...inputs.map(rule => rule.namedRule.source.originalLine.span), ...loops.map(loop => loop.originalLine.span)]
        .includes(issue.span), 'canonical source evidence');
      return { message: issue.message, line: issue.span.start.line, severity: issue.severity, countsAsError: issue.countsAsError };
    });
    assert.deepEqual(diagnostics, expected.diagnostics, fixture.name + ': exact ordered schedule diagnostics');
    return { ...compared, inputs, loops, schedule: result, expectedSchedules: expected };
  }
  return { ...lowering, compareFixture, nativeSchedules, candidateView, capture, actualRigidTransitions,
    loweringView: lowering.candidateView };
}
module.exports = { createSourceSchedulesOracle };
