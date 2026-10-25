import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { CommandKind, queueCommands } from '../build/commands.js';

const cancel = Object.freeze({ kind: CommandKind.Cancel });
const restart = Object.freeze({ kind: CommandKind.Restart });
const win = Object.freeze({ kind: CommandKind.Win });
const checkpoint = Object.freeze({ kind: CommandKind.Checkpoint });
const again = Object.freeze({ kind: CommandKind.Again });
const firstRule = Object.freeze({ name: 'first rule' });
const secondRule = Object.freeze({ name: 'second rule' });

function message(text) {
  return Object.freeze({ kind: CommandKind.Message, text });
}

function sound(index) {
  return Object.freeze({ kind: CommandKind.Sound, index });
}

function state(commands = [], text = '', source = firstRule) {
  return Object.freeze({
    entries: Object.freeze(commands.map(command => Object.freeze({ command, source }))),
    message: text,
  });
}

function assertCommands(actual, expected, text = '') {
  assert.deepEqual(actual.entries.map(entry => entry.command), expected);
  assert.equal(actual.message, text);
}

test('command kinds are numeric enum cases', () => {
  for (const kind of [CommandKind.Cancel, CommandKind.Restart, CommandKind.Win,
    CommandKind.Checkpoint, CommandKind.Again, CommandKind.Message, CommandKind.Sound]) {
    assert.equal(typeof kind, 'number');
  }
  assert.equal(new Set([CommandKind.Cancel, CommandKind.Restart, CommandKind.Win,
    CommandKind.Checkpoint, CommandKind.Again, CommandKind.Message, CommandKind.Sound]).size, 7);
});

test('commands append in rule order with their actual source reference', () => {
  const before = state([checkpoint]);
  const commands = Object.freeze([sound(3), win, message('hello'), again]);
  const result = queueCommands(before, secondRule, commands);
  assertCommands(result, [checkpoint, ...commands], 'hello');
  assert.equal(result.entries[0].source, firstRule);
  for (const entry of result.entries.slice(1)) assert.equal(entry.source, secondRule);
});

test('an empty command list preserves an existing cancel queue and message', () => {
  const before = state([win, cancel, message('cancel message')], 'cancel message');
  const result = queueCommands(before, secondRule, []);
  assertCommands(result, before.entries.map(entry => entry.command), 'cancel message');
});

test('an existing cancel ignores the whole incoming list including another cancel', () => {
  const before = state([cancel, sound(1)], 'retained');
  const result = queueCommands(before, secondRule, [message('ignored'), restart, cancel, win]);
  assertCommands(result, [cancel, sound(1)], 'retained');
  assert.equal(result.entries[0].source, firstRule);
});

test('an existing restart ignores every incoming list without cancel', () => {
  const before = state([restart, message('retained')], 'retained');
  for (const commands of [[win, message('ignored')], [restart, sound(2)], [checkpoint, again]]) {
    const result = queueCommands(before, secondRule, commands);
    assertCommands(result, [restart, message('retained')], 'retained');
  }
});

test('cancel replaces an existing restart queue and its message', () => {
  const result = queueCommands(state([restart, win], 'old message'), secondRule, [sound(9), cancel, again]);
  assertCommands(result, [sound(9), cancel, again]);
  for (const entry of result.entries) assert.equal(entry.source, secondRule);
});

test('a new restart clears earlier commands and message before appending its whole list', () => {
  const result = queueCommands(state([checkpoint, message('old')], 'old'), secondRule,
    [win, sound(4), restart, again]);
  assertCommands(result, [win, sound(4), restart, again]);
});

test('a new cancel clears earlier commands and keeps commands on both sides of cancel', () => {
  const result = queueCommands(state([checkpoint, sound(2)], 'old'), secondRule,
    [message('before cancel'), cancel, win, sound(2), again]);
  assertCommands(result, [message('before cancel'), cancel, win, sound(2), again], 'before cancel');
});

test('cancel and restart together retain source order instead of filtering each other', () => {
  for (const commands of [[restart, message('between'), cancel, win],
    [cancel, sound(8), restart, checkpoint]]) {
    const result = queueCommands(state([again], 'old'), secondRule, commands);
    assertCommands(result, commands, commands[1].kind === CommandKind.Message ? 'between' : '');
  }
});

test('ordinary command names deduplicate within and across rules', () => {
  const result = queueCommands(state([win]), secondRule,
    [again, checkpoint, win, again, checkpoint]);
  assertCommands(result, [win, again, checkpoint]);
  assert.equal(result.entries[0].source, firstRule);
  assert.equal(result.entries[1].source, secondRule);
});

test('duplicate cancel and restart names deduplicate inside a mixed list', () => {
  const result = queueCommands(state([checkpoint]), secondRule,
    [cancel, restart, cancel, win, restart, win]);
  assertCommands(result, [cancel, restart, win]);
});

test('message names deduplicate regardless of text and preserve the first payload', () => {
  const firstMessage = message('first');
  const result = queueCommands(state(), firstRule, [firstMessage, message('second')]);
  assertCommands(result, [firstMessage], 'first');
  assert.equal(result.entries[0].command, firstMessage);
  const later = queueCommands(result, secondRule, [message('third'), win]);
  assertCommands(later, [firstMessage, win], 'first');
  assert.equal(later.entries[0].source, firstRule);
});

test('a duplicate message preserves state.message even when it differs from its payload', () => {
  const result = queueCommands(state([message('payload')], 'current display'), secondRule,
    [message('ignored')]);
  assertCommands(result, [message('payload')], 'current display');
});

test('all eleven sound indices are distinct names while repeated indices deduplicate', () => {
  const sounds = Array.from({ length: 11 }, (_, index) => sound(index));
  const result = queueCommands(state([sounds[10], sounds[0]]), secondRule,
    [...sounds, sound(3), sound(10)]);
  assertCommands(result, [sounds[10], sounds[0], ...sounds.slice(1, 10)]);
  assert.equal(result.entries[0].source, firstRule);
  assert.equal(result.entries[1].source, firstRule);
  for (const entry of result.entries.slice(2)) assert.equal(entry.source, secondRule);
});

test('an empty queue keeps old message text until a new message or priority clear', () => {
  const before = state([], 'old display');
  assertCommands(queueCommands(before, firstRule, []), [], 'old display');
  assertCommands(queueCommands(before, firstRule, [win]), [win], 'old display');
  assertCommands(queueCommands(before, firstRule, [message('new display')]), [message('new display')], 'new display');
  assertCommands(queueCommands(before, firstRule, [restart]), [restart]);
  assertCommands(queueCommands(before, firstRule, [cancel]), [cancel]);
});

test('priority clearing allows a fresh message even when the old queue already had one', () => {
  for (const priority of [restart, cancel]) {
    const commands = [message('new'), priority, message('ignored')];
    const result = queueCommands(state([message('old'), win], 'old'), secondRule, commands);
    assertCommands(result, [commands[0], priority], 'new');
  }
});

test('lookalike rule objects remain separate sources and the first source wins deduplication', () => {
  const lookalike = Object.freeze({ name: firstRule.name });
  const originalMessage = message('same');
  const before = state([originalMessage, sound(6)]);
  const result = queueCommands(before, lookalike, [message('same'), sound(6), win]);
  assert.equal(result.entries[0].source, firstRule);
  assert.equal(result.entries[1].source, firstRule);
  assert.equal(result.entries[2].source, lookalike);
  assert.notEqual(result.entries[2].source, firstRule);
  assert.equal(result.entries[0].command, originalMessage);
});

test('empty, duplicate and ignored lists return fresh containers and entry wrappers', () => {
  for (const [before, commands] of [
    [state([win], 'display'), []],
    [state([win]), [win]],
    [state([cancel]), [restart]],
    [state([restart]), [win]],
  ]) {
    const first = queueCommands(before, secondRule, commands);
    const second = queueCommands(before, secondRule, commands);
    assert.notEqual(first, before);
    assert.notEqual(first, second);
    assert.notEqual(first.entries, before.entries);
    assert.notEqual(first.entries, second.entries);
    assert.notEqual(first.entries[0], before.entries[0]);
    assert.notEqual(first.entries[0], second.entries[0]);
    assert.equal(first.entries[0].command, before.entries[0].command);
    assert.equal(first.entries[0].source, before.entries[0].source);
  }
});

test('queueing preserves frozen inputs and independent snapshots across later calls', () => {
  const oldMessage = message('old');
  const before = state([oldMessage, win], 'old');
  const commands = Object.freeze([sound(5), again]);
  const snapshot = structuredClone({ before, commands, firstRule, secondRule });
  const first = queueCommands(before, secondRule, commands);
  const second = queueCommands(before, secondRule, commands);
  assert.deepEqual({ before, commands, firstRule, secondRule }, snapshot);
  assert.deepEqual(first, second);
  assert.equal(first.entries[2].command, commands[0]);
  assert.equal(first.entries[3].command, commands[1]);
  const secondSnapshot = structuredClone(second);
  first.entries[0].source = secondRule;
  first.entries[0].command = cancel;
  first.entries.push({ command: restart, source: firstRule });
  first.message = 'changed by caller';
  assert.deepEqual(second, secondSnapshot);
  assert.deepEqual({ before, commands, firstRule, secondRule }, snapshot);
  const later = queueCommands(second, firstRule, [cancel]);
  assertCommands(later, [cancel]);
  assert.deepEqual(second, secondSnapshot);
});

// The oracle runs the actual legacy function in a private global context.
// The TypeScript runtime has no dependency on the legacy engine.
const engine = readFileSync(new URL('./vanilla/js/engine.js', import.meta.url), 'utf8');
const queueStart = engine.indexOf('Rule.prototype.queueCommands = function () {');
const queueEnd = engine.indexOf('\nfunction showTempMessage()', queueStart);
assert.ok(queueStart >= 0 && queueEnd > queueStart, 'legacy queue function must exist');
const legacyQueueSource = engine.slice(queueStart, queueEnd);

function legacyCommand(command) {
  switch (command.kind) {
    case CommandKind.Cancel: return ['cancel'];
    case CommandKind.Restart: return ['restart'];
    case CommandKind.Win: return ['win'];
    case CommandKind.Checkpoint: return ['checkpoint'];
    case CommandKind.Again: return ['again'];
    case CommandKind.Message: return ['message', command.text];
    case CommandKind.Sound: return [`sfx${command.index}`];
    default: throw new Error(`Unexpected command kind ${command.kind}`);
  }
}

const legacyScenarios = [
  { name: 'empty list after cancel', lists: [[message('start'), cancel], []] },
  { name: 'existing cancel blocks everything', lists: [[cancel, message('stay')], [win, restart, cancel, message('ignored')]] },
  { name: 'existing restart blocks noncancel lists', lists: [[restart, sound(2)], [restart, message('ignored')], [win]] },
  { name: 'cancel overrides restart', lists: [[restart, message('old')], [sound(4), cancel, message('new'), win]] },
  { name: 'restart replaces ordinary commands', lists: [[win, message('old'), sound(5)], [message('new'), restart, again]] },
  { name: 'cancel and restart share one list', lists: [[again], [restart, message('new'), cancel, checkpoint, message('ignored')]] },
  { name: 'first message and source win', lists: [[message('first'), sound(3)], [message('second'), sound(3), checkpoint], [message('third'), win]] },
  { name: 'empty queue keeps message', initialMessage: 'previous display', lists: [[], [win], [checkpoint]] },
  { name: 'priority clears stale message', initialMessage: 'previous display', lists: [[sound(8)], [cancel]] },
  { name: 'all sound names and duplicate ordinary names', lists: [Array.from({ length: 11 }, (_, index) => sound(index)), [sound(10), sound(0), win, win, again, again, checkpoint, checkpoint]] },
];

for (const scenario of legacyScenarios) {
  test(`legacy command queue parity: ${scenario.name}`, () => {
    const context = {
      Rule: function Rule() {},
      level: { commandQueue: [], commandQueueSourceRules: [] },
      messagetext: scenario.initialMessage ?? '',
      verbose_logging: false,
    };
    runInNewContext(legacyQueueSource, context);
    let actual = state([], scenario.initialMessage ?? '');
    for (const [index, commands] of scenario.lists.entries()) {
      const rule = Object.freeze({ index, commands: Object.freeze(commands.map(legacyCommand)) });
      context.Rule.prototype.queueCommands.call(rule);
      actual = queueCommands(actual, rule, commands);
      assert.deepEqual(actual.entries.map(entry => legacyCommand(entry.command)[0]),
        Array.from(context.level.commandQueue));
      assert.equal(actual.message, context.messagetext);
      for (const [position, entry] of actual.entries.entries()) {
        assert.equal(entry.source, context.level.commandQueueSourceRules[position]);
      }
    }
  });
}
