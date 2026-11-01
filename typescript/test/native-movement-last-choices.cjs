'use strict';

const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');

// Project only one original named input's actual native movement histories.
// Native headers/source ownership are constant within this array. Concrete and
// unresolved family terms on both sides are the complete choice identity;
// movingReplacement is path bookkeeping, not part of the resulting rule.
function nativeMovementLastChoices(nativeVariants) {
  const kept = [];
  for (let index = nativeVariants.length - 1; index >= 0; index--) {
    const rule = nativeVariants[index];
    assert.equal(typeof rule.lineNumber, 'number', 'native movement input');
    assert.equal(typeof rule.direction, 'string', 'native movement orientation');
    if (kept.some(other => isDeepStrictEqual(rule.lhs, other.lhs)
      && isDeepStrictEqual(rule.rhs, other.rhs))) continue;
    kept.unshift(rule);
  }
  return kept;
}

module.exports = { nativeMovementLastChoices };
