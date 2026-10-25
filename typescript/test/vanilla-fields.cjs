'use strict';

const assert = require('node:assert/strict');

// Target one pinned native schema. Unknown fields must fail rather than silently
// disappearing during translation into the reference's ordinary domain values.
function assertVanillaFields(kind, value, fields) {
  for (const field of Object.keys(value)) {
    assert.ok(fields.includes(field), 'Unsupported vanilla ' + kind + ' field: ' + field);
  }
}

module.exports = { assertVanillaFields };
