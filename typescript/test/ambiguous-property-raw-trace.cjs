'use strict';

const { isDeepStrictEqual } = require('node:util');

const prefix = 'This rule has a property on the right-hand side, "';
const suffix = '", that can\'t be inferred from the left-hand side.  (either for every property on the right there has to be a corresponding one on the left in the same cell, OR, if there\'s a single occurrence of a particular property name on the left, all properties of the same name on the right are assumed to be the same).';

// Direct movement expansion changes only the number of identical consecutive
// property-error visits. Keep every distinct message, line, severity and flag,
// and keep every visit for all other diagnostic kinds. Recorded issues and
// error counts are compared separately without this projection.
function ambiguousPropertyRawTrace(issues) {
  const result = [];
  for (const issue of issues) {
    const propertyVisit = issue.message.startsWith(prefix) && issue.message.endsWith(suffix)
      && !issue.message.slice(prefix.length, -suffix.length).includes('"');
    if (propertyVisit && isDeepStrictEqual(issue, result.at(-1))) continue;
    result.push(issue);
  }
  return result;
}

module.exports = { ambiguousPropertyRawTrace };
