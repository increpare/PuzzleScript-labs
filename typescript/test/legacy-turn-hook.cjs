'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');

// Keep the real session/command/history host around a replaceable turn boundary.
// Only trusted test-loaded engine source reaches this helper.
function instrumentTurnInput(source, { before, after, candidate }) {
  const start = '\tlet inputindex = dir;';
  const end = '\n\t// Post move stuff';
  for (const anchor of [start, end]) {
    assert.equal(source.split(anchor).length - 1, 1, 'Expected exactly one turn hook anchor: ' + anchor.trim());
  }
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  assert.ok(from < to, 'Turn hook anchors must be ordered');
  const baseline = source.slice(0, from)
    + 'const __turnRecord = __before(dir);\n'
    + source.slice(from, to)
    + '\n__after(__turnRecord, { playerPositions, attempts: i, bannedGroup });\n'
    + source.slice(to);
  const replacement = '\tlet inputindex = dir;\n'
    + '\tlet playerPositions = __candidate(dir);\n';
  const typed = source.slice(0, from) + replacement + source.slice(to);
  const bind = vm.runInThisContext(
    '(function(__before, __after, __candidate) { return { baseline: (' + baseline
      + '), candidate: (' + typed + ') }; })',
    { filename: 'test-only-turn-boundary.js' },
  );
  return bind(before, after, candidate);
}

module.exports = { instrumentTurnInput };
