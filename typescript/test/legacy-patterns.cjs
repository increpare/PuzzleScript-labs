'use strict';

const { assertVanillaFields } = require('./vanilla-fields.cjs');

// Test-only translation from the old compiled predicates to the domain model.
function createPatternDecoder({ Direction, Movement, Ellipsis, legacyEllipsis, objects, layerCount }) {
  const movements = [[1, Movement.Up], [2, Movement.Down], [4, Movement.Left],
    [8, Movement.Right], [16, Movement.Action]];
  const members = mask => new Set(objects.filter((_object, id) => mask.get(id)));
  const movementTerms = mask => {
    const terms = [];
    for (let layer = 0; layer < layerCount; layer++) {
      const value = mask.getshiftor(31, layer * 5);
      for (const [bit, movement] of movements) {
        if (value & bit) terms.push({ layer, movement });
      }
    }
    return terms;
  };
  const cell = pattern => {
    assertVanillaFields('cell predicate', pattern, ['objectsPresent', 'objectsMissing', 'anyObjectsPresent',
      'movementsPresent', 'movementsMissing', 'replacement', 'matches', 'replace']);
    return {
      requiredObjects: members(pattern.objectsPresent),
      forbiddenObjects: members(pattern.objectsMissing),
      anyObjects: pattern.anyObjectsPresent.map(members),
      requiredMovements: movementTerms(pattern.movementsPresent),
      forbiddenMovements: movementTerms(pattern.movementsMissing),
    };
  };
  const directions = new Map([[1, Direction.Up], [2, Direction.Down],
    [4, Direction.Left], [8, Direction.Right], [16, Direction.InPlace]]);
  const rule = source => {
    if (!directions.has(source.direction)) throw new Error('Unexpected legacy rule direction');
    return {
      direction: directions.get(source.direction),
      rows: source.patterns.map(row => row.map(pattern =>
        pattern === legacyEllipsis ? Ellipsis : cell(pattern))),
    };
  };
  return { members, movementTerms, cell, rule };
}

function decodeRulePattern(rule, context) { return createPatternDecoder(context).rule(rule); }

function decodeMatches(matches, height) {
  return matches.map(row => row.map(entry => {
    const tile = typeof entry === 'number' ? entry : entry[0];
    return {
      start: { x: Math.floor(tile / height), y: tile % height },
      gaps: typeof entry === 'number' ? [] : entry.slice(1),
    };
  }));
}

function encodeMatches(matches, height) {
  return matches.map(row => row.map(({ start, gaps }) => {
    const tile = start.x * height + start.y;
    return gaps.length === 0 ? tile : [tile, ...gaps];
  }));
}

module.exports = { createPatternDecoder, decodeRulePattern, decodeMatches, encodeMatches };
