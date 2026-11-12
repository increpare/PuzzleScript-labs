'use strict';
// Source construction only. Choices do not consult either engine, and none of
// the resulting observations are recorded as expected outcomes.
const { renderProgram } = require('../../typescript/test/exploration/program.mjs');
const crypto = require('node:crypto');

exports.construct = function(program, campaignSeed, index) {
  let state = 1;
  for (const ch of campaignSeed + ':frontend:' + index) state = (state * 31 + ch.codePointAt(0)) % 2147483647;
  const pick = values => { state = state * 48271 % 2147483647; return values[Math.floor(state / 2147483647 * values.length)]; };
  const aliases = [['Player', 'Actor'], ['Crate', 'Block'], ['Color', 'ΟΣ'],
    ['Mark', program.family === 'push-property' ? 'checkpoint' : 'Flag']].filter(() => pick([false, true]));
  const rules = program.rules.map(rule => aliases.reduce((rule, [name, alias]) => rule.replace(new RegExp('\\b' + name + '\\b', 'g'), alias), rule));
  const seed = program.seed + pick(['', ':é', ':😀', ':ΟΣ']);
  const sourceObjects = program.objects.map((object, objectIndex) => {
    const twoColors = pick([false, true]);
    const colors = twoColors ? object.color + pick([' ', '', '\t', ' ']) + object.color : object.color;
    const name = object.name + pick(['', ' Tag' + objectIndex]);
    const rows = pick([false, true]) ? [] : Array.from({ length: 5 }, (_, row) => {
      const pixels = Array.from({ length: 5 }, () => pick(twoColors ? ['0', '1', '.'] : ['0', '.'])).join(pick(['', ' ', '\t']));
      return (row === 2 && pick([false, true]) ? '(sprite comment)\n' : '') + pixels;
    });
    return [name, colors, ...rows].join('\n') + pick(['\n', '\n\n']);
  }).join('');
  let source = renderProgram({ ...program, seed, rules });
  source = source.replace(/\nobjects\n[\s\S]*?\nlegend\n/, () => '\nobjects\n' + sourceObjects + '\nlegend\n');
  source = source.replace('\nsounds\n', () => '\n' + aliases.map(([target, alias]) => alias + ' = ' + target).join('\n') + '\n\nsounds\n');
  const metadata = ['run_rules_on_level_start', 'noaction', 'noundo', 'norestart'].filter(() => pick([false, false, true]));
  metadata.push(...pick([[], ['flickscreen 2x2'], ['zoomscreen 1e2x2']]));
  source = metadata.join('\n') + '\n' + source;
  const indent = pick(['', '\t', ' ']);
  source = source.split('\n').map(line => line ? indent + line : line).join('\n');
  const identity = crypto.createHash('sha256').update(source.replace(/^\s*title[^\n]*$/m, 'title Generated case')).digest('hex');
  return { source, seed, identity };
};
