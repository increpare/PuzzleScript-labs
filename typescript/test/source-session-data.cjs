'use strict';

const assert = require('node:assert/strict');

// Validate the full candidate boundary before any observation is projected.
// Known Win/Diagnostic effects and per-turn bans are intentionally not compared
// by this session adapter, but their fields and discriminants are still checked.
function createSessionValidator(types) {
  const fields = (value, expected, name) => {
    assert.ok(value !== null && typeof value === 'object', name + ' must be data');
    assert.deepEqual(Reflect.ownKeys(value).sort(), [...expected].sort(), name + ' fields');
  };
  const tag = (value, enumeration, name) => assert.ok(typeof value === 'number'
    && Object.values(enumeration).includes(value), 'unsupported ' + name + ': ' + value);
  const viewport = value => {
    if (value !== null) fields(value, ['left', 'top', 'right', 'bottom'], 'session viewport');
  };
  function board(value) {
    fields(value, ['width', 'height', 'rows'], 'session board');
    for (const row of value.rows) for (const cell of row) fields(cell, ['objects'], 'session cell');
  }
  function snapshot(value) {
    if (value === null) return;
    fields(value, ['board', 'viewport'], 'session snapshot');
    board(value.board); viewport(value.viewport);
  }
  function address(value, rigid) {
    fields(value, rigid ? ['position', 'layer', 'movements', 'group'] : ['position', 'layer', 'movements'],
      rigid ? 'session rigid mark' : 'session movement');
    fields(value.position, ['x', 'y'], 'session position');
    for (const movement of value.movements) tag(movement, types.Movement, 'session movement kind');
  }
  function command(value) {
    tag(value.kind, types.CommandKind, 'session command kind');
    fields(value, value.kind === types.CommandKind.Message ? ['kind', 'text']
      : value.kind === types.CommandKind.Sound ? ['kind', 'index'] : ['kind'], 'session command');
  }
  function frame(value) {
    fields(value, ['board', 'pendingMovements', 'rigidMarks', 'bannedGroups', 'canMoveSounds',
      'cantMoveSounds', 'commands', 'createdObjects', 'destroyedObjects', 'random'], 'session frame');
    board(value.board);
    value.pendingMovements.forEach(entry => address(entry, false));
    value.rigidMarks.forEach(entry => address(entry, true));
    fields(value.commands, ['entries', 'message'], 'session commands');
    for (const entry of value.commands.entries) {
      fields(entry, ['command', 'source'], 'session queued command'); command(entry.command);
    }
    fields(value.random, ['seed', 'i', 'j', 'permutation'], 'session random');
  }
  function state(value) {
    fields(value, ['execution', 'levelIndex', 'levelTarget', 'restartTarget', 'history', 'viewport',
      'screen', 'winning', 'againing', 'restarting', 'levelStarting', 'checkpointUsed', 'loadedLevelSeed', 'runMode'], 'session state');
    frame(value.execution);
    snapshot(value.levelTarget); snapshot(value.restartTarget); value.history.forEach(snapshot);
    viewport(value.viewport);
    tag(value.screen.kind, types.ScreenKind, 'session screen kind');
    fields(value.screen, value.screen.kind === types.ScreenKind.Board || value.screen.kind === types.ScreenKind.Title
      ? ['kind'] : ['kind', 'text'], 'session screen');
    tag(value.runMode, types.RunMode, 'session run mode');
  }
  function effect(value) {
    tag(value.kind, types.SessionEffectKind, 'session effect kind');
    switch (value.kind) {
      case types.SessionEffectKind.Sound:
        fields(value, ['kind', 'seed', 'simple'], 'session sound effect'); break;
      case types.SessionEffectKind.Persistence:
        tag(value.operation, types.PersistenceKind, 'session persistence operation');
        fields(value, value.operation === types.PersistenceKind.Checkpoint
          ? ['kind', 'operation', 'levelIndex', 'snapshot'] : ['kind', 'operation', 'levelIndex'], 'session persistence effect');
        if (value.operation === types.PersistenceKind.Checkpoint) snapshot(value.snapshot);
        break;
      case types.SessionEffectKind.Win:
        fields(value, ['kind', 'levelIndex', 'suppressed'], 'session win effect'); break;
      case types.SessionEffectKind.Diagnostic: {
        fields(value, ['kind', 'diagnostic'], 'session diagnostic effect');
        const diagnostic = value.diagnostic;
        assert.ok(diagnostic.origin === 'rules' || diagnostic.origin === 'session',
          'unsupported session diagnostic origin: ' + diagnostic.origin);
        fields(diagnostic, diagnostic.origin === 'rules' ? ['origin', 'detail'] : ['origin', 'kind'], 'session diagnostic');
        if (diagnostic.origin === 'session') tag(diagnostic.kind, types.SessionDiagnosticKind, 'session diagnostic kind');
        else {
          fields(diagnostic.detail, ['kind', 'sourceLine'], 'session rule diagnostic');
          tag(diagnostic.detail.kind, types.ExecutionDiagnosticKind, 'session rule diagnostic kind');
        }
        break;
      }
    }
  }
  function result(value) {
    fields(value, ['state', 'modified', 'effects'], 'session result');
    state(value.state); value.effects.forEach(effect);
  }
  return { state, result };
}

module.exports = { createSessionValidator };
