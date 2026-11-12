'use strict';
// Exhaust all seven control flags across eight rule families and four timing/
// viewport profiles. Sources and event streams are constructed without reading
// either runtime's output; failures remain ordinary differential failures.
const fs = require('node:fs');
const path = require('node:path');
const base = fs.readFileSync(path.join(__dirname, '../examples/push.ps'), 'utf8');
const flags = ['require_player_movement', 'run_rules_on_level_start', 'noaction',
  'noundo', 'norestart', 'norepeat_action', 'throttle_movement'];
const profiles = [[], ['realtime_interval 0.1', 'again_interval 0.1', 'key_repeat_interval 0.15'],
  ['realtime_interval 0.25', 'again_interval 0', 'key_repeat_interval 0', 'flickscreen 2x1'],
  ['realtime_interval bad', 'again_interval bad', 'key_repeat_interval bad', 'zoomscreen 3x1']];
const families = [
  ['push and message', '[ > Player | Crate ] -> [ > Player | > Crate ]\n[ action Player ] -> message Pause', 'PC.#'],
  ['replacement and message', '[ action Player ] -> [ Crate ] message Changed', 'P...#'],
  ['random and again', '[ action Player ] -> [ randomdir Player ] again\n[ stationary Player ] -> [ right Player ] again', 'P...#'],
  ['checkpoint and forced restart', '[ action Player ] -> checkpoint message Saved\n[ right Player ] -> restart', 'P...#'],
  ['cancel and checkpoint', '[ action Player ] -> [ randomdir Player ] cancel message Rejected\n[ right Player ] -> checkpoint', 'P...#'],
  ['partially blocked players', '[ action Player ] -> [ right Player ]', 'P#.P.'],
  ['message and explicit win', '[ action Player ] -> win\n+ [ action Player ] -> message Pause', 'P...#'],
  ['realtime and message restart', '[ stationary Player ] -> [ right Player ] sfx0\n[ action Player ] -> restart message Restarted', 'P...#'],
];
const sounds = ['titlescreen 111', 'startgame 222', 'startlevel 333', 'endlevel 444',
  'endgame 555', 'showmessage 666', 'closemessage 777', 'undo 888', 'restart 999',
  'cancel 54321', 'sfx0 12345', 'Player move 87654', 'Player cantmove 76543',
  'Crate create 65432', 'Crate destroy 45678'].join('\n');
const construct = (seed, index) => {
  const family = index % families.length;
  const mask = Math.floor(index / families.length) % (1 << flags.length);
  const profile = Math.floor(index / (families.length * (1 << flags.length))) % profiles.length;
  let word = 2166136261;
  for (const ch of seed + ':' + index) word = Math.imul(word ^ ch.charCodeAt(0), 16777619) >>> 0;
  const draw = n => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % n; };
  const [name, rules, board] = families[family];
  const metadata = flags.filter((_, bit) => mask & (1 << bit)).concat(profiles[profile]);
  const level = draw(3), title = draw(2) === 1, resume = draw(2) === 1;
  const checkpoint = resume && draw(2) ? '.P..' : undefined;
  const inputs = title ? ['action', 'wait:301'] : [];
  inputs.push('right', 'action', 'wait:150', 'wait:1', 'repeat:action', 'wait:101', 'undo',
    'restart', 'menu', 'up', 'action', 'wait:301', 'action', 'wait:151', 'right', 'wait:501');
  const choices = ['up', 'left', 'down', 'right', 'action', 'undo', 'restart', 'menu',
    'repeat:action', 'repeat:right', 'storage:none', 'storage:0', 'storage:1', 'storage:0:.P..',
    'wait:0', 'wait:0.5', 'wait:100', 'wait:150', 'wait:151', 'wait:300', 'wait:301', 'wait:500', 'wait:501', 'wait:1000'];
  for (let n = 0; n < 28; n++) inputs.push(choices[draw(choices.length)]);
  return { name: 'metadata interactive ' + index + ' ' + name + ' mask ' + mask + ' profile ' + profile,
    seed: seed + ':' + index, level, title, resume, checkpoint, inputs,
    source: metadata.join('\n') + '\n' + base.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', rules)
      .replace('sounds\n', 'sounds\n' + sounds + '\n')
      .replace('levels\nPC.#', 'levels\n' + [board, 'message Interlude', board].join('\n\n')) };
};
module.exports = { construct, flags, profiles, families: families.map(([name]) => name) };
