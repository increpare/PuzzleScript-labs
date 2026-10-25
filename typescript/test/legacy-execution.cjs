'use strict';

const assert = require('node:assert/strict');
const { createPatternDecoder } = require('./legacy-patterns.cjs');
const { assertVanillaFields } = require('./vanilla-fields.cjs');

// All knowledge of old encodings is test-only. The new runtime receives plain
// edits, commands and a declared rigid responsibility transition table.
function decodeExecution(legacy, context) {
  const { CommandKind, layerCount, legacyEllipsis } = context;
  const decoder = createPatternDecoder(context);
  const commandNames = new Map([
    ['cancel', CommandKind.Cancel], ['restart', CommandKind.Restart],
    ['win', CommandKind.Win], ['checkpoint', CommandKind.Checkpoint], ['again', CommandKind.Again],
  ]);
  const command = ([name, text]) => {
    if (name === 'message') return { kind: CommandKind.Message, text: text ?? '' };
    if (/^sfx(?:10|[0-9])$/.test(name)) return { kind: CommandKind.Sound, index: Number(name.slice(3)) };
    assert.ok(commandNames.has(name), 'Unknown legacy command: ' + name);
    return { kind: commandNames.get(name) };
  };
  const rigidGroups = legacy.rigidGroupIndex_to_GroupIndex;
  const rigidMerges = new Map(rigidGroups.map((group, before) => [group,
    new Map(rigidGroups.map((incoming, added) =>
      [incoming, rigidGroups[((before + 1) | (added + 1)) - 1] ?? null])),
  ]));
  const fullLayers = mask => {
    const layers = new Set();
    for (let layer = 0; layer < layerCount; layer++) {
      const section = mask.getshiftor(31, layer * 5);
      assert.ok(section === 0 || section === 31, 'Static affected layers must cover every movement');
      if (section !== 0) layers.add(layer);
    }
    return layers;
  };
  const replacement = source => {
    if (source === null) return null;
    assertVanillaFields('replacement', source, ['objectsClear', 'objectsSet', 'movementsClear', 'movementsSet',
      'movementsLayerMask', 'randomEntityMask', 'randomDirMask', 'replace']);
    const rigidLayers = fullLayers(source.movementsLayerMask);
    const edits = {
      removeObjects: decoder.members(source.objectsClear),
      addObjects: decoder.members(source.objectsSet),
      vacateLayers: new Set(),
      removeMovements: decoder.movementTerms(source.movementsClear),
      addMovements: decoder.movementTerms(source.movementsSet),
      resetMovementLayers: rigidLayers,
      randomObjects: [...decoder.members(source.randomEntityMask)].map(object => ({
        object, layer: legacy.objects[object.name].layer,
      })),
      randomDirectionLayers: new Set(),
    };
    for (let layer = 0; layer < layerCount; layer++) {
      if (source.randomDirMask.get(layer * 5)) edits.randomDirectionLayers.add(layer);
    }
    return { edits, rigidLayers };
  };
  const rules = new Map();
  for (const source of new Set([...legacy.rules.flat(), ...legacy.lateRules.flat()])) {
    assertVanillaFields('rule', source, ['direction', 'patterns', 'hasReplacements', 'lineNumber', 'ellipsisCount',
      'groupNumber', 'rigid', 'commands', 'isRandom', 'cellRowMasks', 'cellRowMasks_Movements', 'ruleMask',
      'applyAt', 'cellRowMatches', 'findMatches']);
    const rigidIndex = legacy.groupNumber_to_RigidGroupIndex[source.groupNumber];
    rules.set(source, {
      ...decoder.rule(source),
      sourceLine: source.lineNumber,
      hasReplacements: source.hasReplacements,
      rigidGroup: source.rigid ? rigidGroups[rigidIndex] ?? null : null,
      replacements: source.patterns.map(row => row.map(cell => cell === legacyEllipsis ? null : replacement(cell.replacement))),
      commands: source.commands.map(command),
    });
  }
  const schedule = (groups, loops) => ({
    groups: groups.map(group => ({ rules: group.map(rule => rules.get(rule)), random: Boolean(group[0].isRandom) })),
    loops: new Map(Object.entries(loops).map(([from, to]) => [Number(from), to])),
  });
  return {
    game: { collisionLayers: context.collisionLayers, rigidMerges },
    rules,
    legacyRules: new Map([...rules].map(([source, rule]) => [rule, source])),
    early: schedule(legacy.rules, legacy.loopPoint),
    late: schedule(legacy.lateRules, legacy.lateLoopPoint),
    command,
  };
}

module.exports = { decodeExecution };
