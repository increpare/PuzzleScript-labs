'use strict';
const fs = require('node:fs');
const path = require('node:path');
const base = fs.readFileSync(path.join(__dirname, '../examples/push.ps'), 'utf8');
const push = '[ > Player | Crate ] -> [ > Player | > Crate ]';
const sound = ['titlescreen 111', 'startgame 222', 'startlevel 333', 'endlevel 444', 'endgame 555',
  'showmessage 666', 'closemessage 777', 'undo 888', 'restart 999', 'sfx0 12345', 'cancel 54321'].join('\n');
const source = (rules, metadata = '', levels = 'P...\n\nP...') => metadata + '\n' + base.replace(push, rules)
  .replace('sounds\n', 'sounds\n' + sound + '\n').replace('levels\nPC.#', 'levels\n' + levels);
const fixtures = [];
const add = (name, rules, inputs, extra = {}) => fixtures.push({ name, source: source(rules, extra.metadata, extra.levels), inputs, ...extra });
const dismiss = ['action', 'right', 'undo', 'repeat:action', 'action', 'wait:150', 'wait:1'];
add('rule message acknowledgement', '[ action Player ] -> [ Player ] message Hello', dismiss.concat('right'));
add('win deferred by a message', '[ action Player ] -> [ Player ] win\n+ [ action Player ] -> message Hello', dismiss.concat('right', 'wait:500', 'wait:1'));
add('restart deferred by a message', '[ action Player ] -> [ Player ] restart message Hello', ['right', ...dismiss, 'right']);
add('checkpoint while showing a message', '[ action Player ] -> [ Player ] checkpoint message Hello', ['right', ...dismiss, 'right', 'restart']);
add('cancel while showing a message', '[ action Player ] -> [ right Player ] cancel message Hello', dismiss.concat('right'));
add('empty rule message advances', '[ action Player ] -> [ Player ] message', dismiss.concat('right'));
add('natural win waits for a message', '[ action Player ] -> [ Crate ] message Finished', dismiss.concat('right', 'wait:500', 'wait:1'));
add('startup message discards its win', '[ Player ] -> [ Player ] win\n+ [ Player ] -> message Hello', ['action', 'wait:151', 'wait:501'], { metadata: 'run_rules_on_level_start' });
add('message level advances', '', ['right', 'undo', 'action', 'wait:150', 'wait:1', 'repeat:action', 'right'], { levels: 'message Welcome\n\nP...' });
add('title start timing', '', ['right', 'repeat:action', 'action', 'action', 'wait:300', 'wait:1', 'repeat:action', 'right'], { title: true });
add('title with saved progress continues', '', ['action', 'wait:301', 'right'], { title: true, resume: true, level: 1 });
add('title new game overrides saved progress', '', ['up', 'action', 'wait:301', 'right'], { title: true, resume: true, level: 1 });
add('escape retains a title continuation', '', ['right', 'menu', 'right', 'down', 'action', 'wait:301', 'right'], { level: 1 });
add('final win returns to title after delay', '[ action Player ] -> win', ['action', 'right', 'undo', 'menu', 'wait:500', 'wait:1', 'action', 'wait:301'], { levels: 'P...' });
add('realtime strict boundary', '[ Player ] -> [ right Player ]', ['wait:100', 'wait:1', 'wait:1000', 'undo', 'wait:101'], { metadata: 'realtime_interval 0.1' });
add('realtime pauses on a rule message', '[ action Player ] -> message Hello\n[ Player ] -> [ right Player ]', ['action', 'wait:1000', 'action', 'wait:151', 'wait:101'], { metadata: 'realtime_interval 0.1' });
for (const [name, metadata] of [['no action', 'noaction'], ['no undo', 'noundo'], ['no restart', 'norestart'], ['no action repeats', 'norepeat_action']])
  add(name, '[ action Player ] -> [ right Player ]', ['action', 'repeat:action', 'right', 'undo', 'restart'], { metadata });
add('checkpoint resume skips startup rules', '[ Player ] -> [ right Player ]', ['right', 'restart', 'menu', 'action', 'wait:301'], { metadata: 'run_rules_on_level_start', resume: true, checkpoint: '.P..' });
add('checkpoint title continuation restores snapshot', '', ['action', 'wait:301', 'right', 'restart'], { title: true, resume: true, checkpoint: '.P..' });
add('new game discards a saved checkpoint', '', ['up', 'action', 'wait:301', 'right', 'restart'], { title: true, resume: true, checkpoint: '.P..' });
add('again waits behind a rule message', '[ action Player ] -> [ right Player ] again message Pause\n[ stationary Player ] -> [ right Player ] again',
  ['action', 'right', 'wait:1000', 'action', 'wait:151', 'wait:0', 'wait:151', 'wait:151', 'undo']);
add('again strict custom interval', '[ action Player ] -> [ right Player ] again\n[ stationary Player ] -> [ right Player ] again',
  ['action', 'right', 'wait:250', 'wait:1', 'wait:250', 'wait:1', 'undo'], { metadata: 'again_interval 0.25' });
add('again and realtime share frame ordering', '[ action Player ] -> [ right Player ] again\n[ stationary Player ] -> [ right Player ] again',
  ['action', 'wait:151', 'wait:151', 'wait:151', 'undo', 'wait:101'], { metadata: 'realtime_interval 0.1' });
add('win after message command remains deferred', '[ action Player ] -> message Hello\n+ [ action Player ] -> win', dismiss.concat('wait:501'));
add('checkpoint persists through a following message level', '[ action Player ] -> checkpoint\n[ right Player ] -> win',
  ['action', 'right', 'wait:501', 'action', 'wait:151', 'restart'], { levels: 'P...\n\nmessage Middle\n\nP...' });
add('menu cancels visible rule text', '[ action Player ] -> message Hello', ['action', 'menu', 'action', 'wait:301', 'right']);
add('menu during message dismissal', '[ action Player ] -> message Hello', ['action', 'action', 'menu', 'wait:151', 'right']);
add('title confirmation overlaps message dismissal', '[ action Player ] -> message Hello', ['action', 'action', 'menu', 'action', 'wait:151', 'wait:151', 'right']);
for (const value of ['0', '-1', 'bad', '1e309'])
  add('again interval ' + value, '[ action Player ] -> [ right Player ] again\n[ stationary Player ] -> [ right Player ] again',
    ['action', 'wait:0', 'wait:1', 'wait:1000', 'undo'], { metadata: 'again_interval ' + value });
add('title and message close in one frame', '[ action Player ] -> message Hello',
  ['action', 'action', 'menu', 'action', 'wait:301', 'right']);
add('new checkpoint becomes a title continuation', '[ action Player ] -> checkpoint message Saved',
  ['right', 'action', 'action', 'wait:151', 'right', 'menu', 'action', 'wait:301', 'restart']);
add('message advance starts a timed again chain', '[ stationary Player ] -> [ right Player ] again',
  ['action', 'wait:151', 'wait:100', 'right', 'wait:51'], { metadata: 'run_rules_on_level_start', level: 0, levels: 'message Start\n\nP....' });
add('startup checkpoint becomes a title continuation', '[ Player ] -> checkpoint',
  ['menu', 'action', 'wait:301', 'restart'], { metadata: 'run_rules_on_level_start' });
add('startup message checkpoint survives dismissal', '[ Player ] -> checkpoint message Saved',
  ['action', 'wait:151', 'menu', 'action', 'wait:301'], { metadata: 'run_rules_on_level_start' });
add('disabled restart preserves the again timer', '[ stationary Player ] -> [ right Player ] again',
  ['wait:100', 'restart', 'wait:51', 'undo'], { metadata: 'run_rules_on_level_start\nnorestart', levels: 'P....' });
add('title return preserves a selected message', '', ['action', 'menu', 'wait:151', 'action', 'wait:501'],
  { level: 1, levels: 'P...\n\nmessage Middle\n\nP...' });
add('last message selects a fresh title', '', ['action', 'wait:151', 'action', 'wait:301'],
  { level: 1, levels: 'P...\n\nmessage Last' });
for (const value of ['0.15', '0', '-1', 'bad', '1e309', '1e-999', '0x1', '0b1', '0o1', '0x10000000000000000', '0o777777777777777777777777', '0b10000000000000000000000000000000000000000000000000000000000000000', '+0x1', '0x1.0', '0x1p2', '0b2', '0o8', '1_000'])
  add('direction throttle interval ' + value, '',
    ['right', 'repeat:right', 'right', 'wait:149', 'right', 'wait:1', 'right', 'left', 'right', 'menu', 'up', 'up', 'wait:1000', 'up'],
    { metadata: 'throttle_movement\nrealtime_interval 10000\nkey_repeat_interval ' + value, levels: 'P.......' });
add('direction throttle survives a message and title', '[ action Player ] -> message Pause',
  ['right', 'action', 'action', 'wait:151', 'right', 'menu', 'down', 'action', 'wait:301', 'right'],
  { metadata: 'throttle_movement\nrealtime_interval 10000' });
add('host reports a failed checkpoint write', '[ action Player ] -> checkpoint',
  ['right', 'action', 'storage:none', 'menu', 'action', 'wait:301', 'right']);
add('external progress replaces a running save', '',
  ['right', 'storage:1', 'right', 'menu', 'action', 'wait:301', 'right']);
add('external save does not change an open title', '',
  ['storage:1:.P..', 'action', 'wait:301', 'menu', 'action', 'wait:301'], { title: true });
add('erasing storage retains the already loaded target', '',
  ['storage:none', 'right', 'menu', 'action', 'wait:301', 'restart'], { resume: true, checkpoint: '.P..' });
add('external checkpoint is read on title entry', '',
  ['right', 'storage:0:.P..', 'menu', 'action', 'wait:301', 'right', 'restart']);
add('new game discards an external checkpoint', '',
  ['storage:0:.P..', 'menu', 'up', 'action', 'wait:301', 'right', 'restart']);
add('failed checkpoint storage preserves the running restart target', '[ action Player ] -> checkpoint',
  ['right', 'action', 'storage:0', 'right', 'restart', 'menu', 'action', 'wait:301']);
add('message progress retains a loaded board continuation', '',
  ['right', 'storage:1', 'menu', 'action', 'wait:301', 'action', 'wait:151', 'restart'],
  { resume: true, checkpoint: '.P..', levels: 'P...\n\nmessage Middle\n\nP...' });
add('title message continuation saves the current board', '[ action Player ] -> checkpoint',
  ['action', 'right', 'storage:1', 'menu', 'action', 'wait:301', 'menu', 'action', 'wait:301'],
  { resume: true, checkpoint: '.P..', levels: 'P...\n\nmessage Middle\n\nP...' });
add('direct message checkpoint resume preserves the underlying board', '',
  ['action', 'wait:151', 'restart', 'menu', 'action', 'wait:301'],
  { resume: true, level: 1, checkpoint: '.P..', levels: 'P...\n\nmessage Middle\n\nP...' });
add('checkpoint title continuation resets flickscreen after saving', '',
  ['menu', 'action', 'wait:301', 'right', 'restart'],
  { metadata: 'flickscreen 2x1', resume: true, checkpoint: '.P..' });
add('checkpoint title continuation preserves zoomscreen checkpoint viewport', '',
  ['menu', 'action', 'wait:301', 'right', 'restart'],
  { metadata: 'zoomscreen 2x1', resume: true, checkpoint: '.P..' });
add('opening a title message resets flickscreen on the empty board', '',
  ['action', 'wait:301', 'action', 'wait:151', 'right'],
  { metadata: 'flickscreen 2x1', title: true, resume: true, level: 1,
    levels: 'P...\n\nmessage Middle\n\nP...' });
add('final message resets flickscreen when returning to title', '',
  ['action', 'wait:151', 'action', 'wait:301'],
  { metadata: 'flickscreen 2x1', level: 1, levels: 'P...\n\nmessage Last' });
const recordedMove = '\nPlayer move 13579\n';
const addRecording = (name, rules, inputs, extra = {}) => {
  const game = source(rules, extra.metadata, extra.levels).replace('sounds\n', 'sounds\n' + recordedMove);
  fixtures.push({ name, inputs, ...extra, source: game });
};
addRecording('new game title confirmation clears recorded sounds immediately', '',
  ['right', 'menu', 'action', 'wait:301', 'right']);
addRecording('continue confirmation retains sounds until the board opens', '',
  ['right', 'menu', 'action', 'wait:301', 'right'], { resume: true, checkpoint: '.P..' });
addRecording('message advancement clears recorded sounds after loading', '[ right Player ] -> win',
  ['right', 'wait:501', 'action', 'wait:151', 'right'], { levels: 'P...\n\nmessage Middle\n\nP...' });
addRecording('startup sounds clear before same-frame realtime recording', '[ Player ] -> [ right Player ]',
  ['menu', 'action', 'wait:301', 'wait:101'], { metadata: 'run_rules_on_level_start\nrealtime_interval 0.1', levels: 'P......' });
add('message title continuation round-trips an empty saved checkpoint', '',
  ['action', 'wait:301', 'menu', 'action', 'wait:301', 'action', 'wait:151'],
  { title: true, resume: true, level: 1, checkpoint: '.P..', levels: 'P...\n\nmessage Middle\n\nP...' });
add('a saved empty checkpoint can restore a board level', '',
  ['action', 'wait:301', 'menu', 'action', 'wait:301', 'storage:0', 'menu', 'action', 'wait:301', 'right', 'wait:501'],
  { title: true, resume: true, level: 1, checkpoint: '.P..', levels: 'P...\n\nmessage Middle\n\nP...' });
module.exports = fixtures;
