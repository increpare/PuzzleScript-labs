'use strict';
// Whole interactive scenarios: source, startup mode and event stream are all
// constructed independently of either runtime's output. No goldens are saved.
const fs = require('node:fs');
const path = require('node:path');
const base = fs.readFileSync(path.join(__dirname, '../examples/push.ps'), 'utf8');
module.exports = (seed, index) => {
  let word = 2166136261;
  for (const ch of seed + ':' + index) word = Math.imul(word ^ ch.charCodeAt(0), 16777619) >>> 0;
  const draw = n => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % n; };
  const blocks = [
    '[ action Player ] -> message Pause',
    '[ action Player ] -> win\n+ [ action Player ] -> message Pause',
    '[ action Player ] -> restart message Pause',
    '[ action Player ] -> checkpoint message Pause',
    '[ action Player ] -> cancel message Pause',
    '[ action Player ] -> message',
    '[ action Player ] -> [ Crate ] message Finished',
    '[ action Player ] -> [ right Player ] again message Pause\n[ stationary Player ] -> [ right Player ] again',
    '[ action Player ] -> [ randomdir Player ] sfx0',
    '[ action Player ] -> [ Player ] sfx0\n[ right Player ] -> checkpoint',
  ];
  const family = index % blocks.length;
  const metadata = [];
  if (draw(3) === 0) metadata.push('run_rules_on_level_start');
  if (draw(3) === 0) metadata.push('realtime_interval ' + ['0.1', '0.25', 'bad'][draw(3)]);
  if (draw(3) === 0) metadata.push('again_interval ' + ['0', '0.1', '0.25', 'bad'][draw(4)]);
  if (draw(5) === 0) metadata.push(['noaction', 'noundo', 'norestart', 'norepeat_action'][draw(4)]);
  if (draw(3) === 0) metadata.push('throttle_movement', 'key_repeat_interval ' + ['0', '0.15', '-1', 'bad', '1e309'][draw(5)]);
  const board = 'P' + '.'.repeat(1 + draw(7));
  const levels = [board];
  if (draw(2)) levels.push('message Interlude');
  levels.push(board);
  const level = draw(levels.length);
  const resume = draw(3) === 0;
  const checkpoint = resume && !levels[level].startsWith('message') && draw(2) ? '.' + 'P' + '.'.repeat(board.length - 2) : undefined;
  const title = draw(2) === 1;
  const inputs = title ? ['action', 'wait:301'] : [];
  inputs.push('action', 'wait:150', 'wait:1');
  const choices = ['up', 'left', 'down', 'right', 'action', 'undo', 'restart', 'menu', 'repeat:action', 'repeat:right',
    'storage:none', 'storage:0', 'storage:1', 'storage:0:.' + 'P' + '.'.repeat(board.length - 2),
    'wait:0', 'wait:0.5', 'wait:100', 'wait:150', 'wait:151', 'wait:300', 'wait:301', 'wait:500', 'wait:501', 'wait:1000'];
  for (let n = 0; n < 28; n++) inputs.push(choices[draw(choices.length)]);
  return { name: 'generated interactive ' + index + ' family ' + family, seed: seed + ':' + index, level, resume, checkpoint, title,
    source: metadata.join('\n') + '\n' + base.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', blocks[family])
      .replace('sounds\n', 'sounds\nsfx0 12345\nshowmessage 111\nclosemessage 222\nstartlevel 333\nendlevel 444\nrestart 555\n')
      .replace('levels\nPC.#', 'levels\n' + levels.join('\n\n')), inputs };
};
