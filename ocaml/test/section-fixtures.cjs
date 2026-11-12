'use strict';
// Physical section transitions exercise registration timing and comment phases.
// Keep the complete source in each report; compare ordered diagnostics directly.
module.exports = base => {
  const fixtures = [];
  const add = (name, source) => fixtures.push({ name, source });
  const headings = ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'];
  for (const heading of headings) {
    const marker = '\n' + heading + '\n';
    for (const suffix of ['.', '?', ')', '))', ' extra', ' (comment)', '(comment) extra', 'é', '_x', '123', '😀'])
      add('heading ' + heading + ' suffix ' + suffix, base.replace(marker, '\n' + heading + suffix + '\n'));
    for (const prefix of ['(leading)', '(nested (comment)) ', ')', ') ', '(multi\nline)'])
      add('heading ' + heading + ' prefix ' + prefix, base.replace(marker, '\n' + prefix + heading + '\n'));
    add('repeated ' + heading, base.replace(marker, marker + heading + '\n'));
    add('omitted ' + heading, base.replace(marker, '\n'));
    add('separator suffix before ' + heading, base.replace(marker, '\n=== extra (unterminated\n' + heading + '\n'));
  }
  for (const [name, text] of [
    ['leading close then layer', ') Player'], ['double leading close then layer', ')) Player'],
    ['comment then layer', '(comment) Player'], ['layer interrupted by comment', 'Player(comment) Crate'],
    ['empty layer by comma', ','], ['empty layer by parentheses', '(comment)'],
    ['layer token character', 'Player ? Crate'], ['layer background conflict', 'Player Background Missing'],
  ]) add(name, base.replace('\nPlayer, Crate, Wall\n', '\n' + text + '\n'));
  for (const [name, text] of [
    ['empty', 'title'], ['leading close', ') title Title'], ['value closes', 'title Value ) Text'],
    ['flag value', 'noaction extra'], ['flag after comment', 'noaction(comment) extra'],
    ['value after comment', 'title One(comment) Two'], ['multiple comments', 'title One(a)(b) Two'],
    ['multiline comment', 'title One(a\nb) Two'], ['expanded comment', '(İ)title Original Case'],
    ['expanded surrogate', '(İ)title 😀'], ['unclosed value', 'title One(unclosed'],
    ['separator gate', '=== invalid (unclosed'],
  ]) add('metadata ' + name, text + '\n' + base);
  for (const [name, text] of [
    ['new object after name publication', 'objects\n\nGhost G\nwhite\n\ncollisionlayers\nGhost\n\nrules\n[ Ghost ] -> [ Ghost ]'],
    ['republished new object', 'objects\n\nGhost G\nwhite\n\nlegend\n\nsounds\n\ncollisionlayers\nGhost\n\nrules\n[ Ghost ] -> [ Ghost ]'],
    ['new alias after name publication', 'legend\nActor = Player\n\nrules\n[ Actor ] -> [ Actor ]'],
    ['new property after name publication', 'legend\nActor = Player or Crate\n\nrules\n[ Actor ] -> [ Actor ]'],
    ['object later than layer lookup', 'collisionlayers\nGhost\n\nobjects\n\nGhost G\nwhite\n\nlegend\n\nsounds\n\nrules'],
    ['alias later than layer lookup', 'collisionlayers\nActor\n\nlegend\nActor = Player\n\nsounds\n\nrules'],
  ]) add(name, base.replace('\nrules\n', '\n' + text + '\n'));
  for (const n of [3, 4, 5]) {
    const errors = Array(n).fill('unknown_metadata value').join('\n') + '\n';
    for (const tail of ['legend extra (unterminated', 'sounds ) extra', 'objects ) extra', 'collisionlayers extra'])
      add('error cap ' + n + ' ' + tail, errors + tail + '\n' + base);
  }
  for (const [name, block] of [
    ['alias after leading closer', 'Player\n)q\nwhite'],
    ['alias after multiline comment', 'Player(c\nd)q\nwhite'],
    ['first alias registration survives duplicates', 'Player q\n)q\nwhite'],
    ['two aliases retain their own physical lines', 'Player q\n)r\nwhite'],
  ]) add('object alias registration: ' + name, base.replace('Player\nwhite', block).replace('P = Player', 'r = Player\nq = Player\nP = Player'));
  for (const [name, from, to] of [
    ['object name and alias', 'Player\nwhite', 'Player(c)white'],
    ['color prefix interrupted', 'Player\nwhite', 'Player\nwh(c)ite'],
    ['two colors', 'Player\nwhite', 'Player\nwhite(c)red'],
    ['object aliases', 'Player\nwhite', 'Player P(c)q\nwhite'],
    ['object name interrupted', 'Player\nwhite', 'Pla(c)yer\nwhite'],
    ['sprite row interrupted', 'Player\nwhite', 'Player\nwhite\n00(c)000\n00000\n00000\n00000\n00000'],
    ['stray close after a color', 'Player\nwhite', 'Player\nwhite)red'],
    ['comment then stray close', 'Player\nwhite', '(c))Player\nwhite'],
    ['multiline name comment', 'Player\nwhite', 'Player(c\nd)white'],
    ['legend lhs interrupted', 'P = Player', 'P(c)=Player'],
    ['legend member interrupted', 'P = Player', 'P = Pla(c)yer'],
    ['legend before operator', 'P = Player', 'Actor = Player(c) or Crate\nP = Player'],
    ['legend operator interrupted', 'P = Player', 'Actor = Player o(c)r Crate\nP = Player'],
    ['layer name interrupted', 'Player, Crate, Wall', 'Pla(c)yer, Crate, Wall'],
    ['layer after comma', 'Player, Crate, Wall', 'Player,(c)Crate, Wall'],
    ['layer after stray closer', 'Player, Crate, Wall', ')Player, Crate, Wall'],
    ['rule captured before a comment', '[ > Player | Crate ]', '[ > Player(c) | Crate ]'],
    ['rule qualifier interrupted', '[ > Player | Crate ]', '[ mov(c)ing Player | Crate ]'],
    ['win prefix captured before a comment', 'no Player', 'no(c)Player'],
    ['win name interrupted', 'no Player', 'no Pla(c)yer'],
  ]) add('token comment: ' + name, base.replace(from, to));
  for (const [name, block] of [
    ['invalid color around closer', 'Player\nwh)ite'],
    ['closer splits alias tokens', 'Player P)q\nwhite'],
    ['closer after alias comment', 'Player P(c))q\nwhite'],
    ['alias on a later physical line', 'Player P(c)\n)q\nwhite'],
    ['heading consumed after a name', 'Player legend\nwhite'],
    ['heading consumed after a comment', 'Player(c)legend\nwhite'],
    ['objects heading consumed midline', 'Player objects\nwhite'],
    ['two heading words midline', 'Player objects legend\nwhite'],
    ['closer within one alias', 'Player P) Q\nwhite'],
    ['heading after colors', 'Player\nwhite(c)legend'],
    ['heading then closer suffix', 'Player objects)extra\nwhite'],
    ['leading closer then heading and suffix', ')objects)extra\nPlayer\nwhite'],
    ['heading then opening comment', 'Player objects(c)extra\nwhite'],
    ['pixels after leading closer', 'Player\nwhite\n)00'],
    ['closer inside a pixel row', 'Player\nwhite\n0)0000\n00000\n00000\n00000\n00000'],
    ['junk then comment in pixels', 'Player\nwhite\n0x(c)0000\n00000\n00000\n00000\n00000'],
    ['junk before comment at name', '?junk(c)Player\nwhite'],
    ['unicode case expansion before comment', 'Player İ(c)Q\nwhite'],
    ['empty comment after invalid color', 'Player\nwh()ite'],
    ['multiple comments after invalid color', 'Player\nwh(a)(b)ite'],
  ]) add('object lexical visits: ' + name, base.replace('Player\nwhite', block));
  for (const count of [99, 100]) {
    const warnings = Array(count).fill('===)').join('\n') + '\n';
    for (const [name, from, to] of [
      ['object aliases', 'Player\nwhite', 'Player no moving\nwhite'],
      ['metadata visits', 'title Persistent pushing', 'title A(c))'],
      ['sound visits', '\nsounds\n', '\nsounds\n)sfx0 junk\n'],
      ['rule visits', '[ > Player | Crate ]', '[ Missing Other | Crate ]'],
      ['win visits', 'no Player', 'bad Missing on Other'],
      ['level visits', 'levels\nPC.#', 'levels\n)P?'],
      ['legend visits', 'P = Player', 'P = Player missing other'],
      ['layer visits', 'Player, Crate, Wall', 'Player Background Missing'],
    ]) add('global warning cutoff ' + count + ' ' + name, warnings + base.replace(from, to));
  }
  for (const count of [4, 5]) {
    const errors = Array(count).fill('unknown_metadata value').join('\n') + '\n';
    const changed = base.replace('Background', 'Floor').replace('. = Background', '. = Floor').replace('\nBackground\nPlayer, Crate, Wall', '\nFloor\nPlayer, Background, Crate, Wall');
    add('layer diagnostics stay atomic at error ' + count, errors + changed);
  }
  add('no current layer after a leading closer', base.replace('Background\nPlayer, Crate, Wall\n\nrules', ')Player Player\n\nrules'));
  for (const count of [99, 100]) add('global warning cutoff ' + count + ' duplicate header',
    Array(count).fill('===)').join('\n') + '\n' + base.replace('\nobjects\n', '\nobjects\nobjects ) extra\n'));
  for (const count of [99, 100]) {
    const warnings = Array(count).fill('===)').join('\n') + '\n';
    add('compiler cutoff ' + count + ' long message', warnings + base.replace('levels\nPC.#', 'levels\nmessage ' + 'a'.repeat(409)));
    add('compiler cutoff ' + count + ' short sprite', warnings + base.replace('Player\nwhite', 'Player\nwhite\n00000\n00000'));
    add('compiler cutoff ' + count + ' palette', warnings + 'color_palette missing\n' + base);
  }
  for (const rule of [
    ')', '))', '(c))', ') [ Missing ] -> [ Player ]',
    '[ Missing ) Player | Crate ] -> [ Player | Crate ]',
    '[ Missing )Other | Crate ] -> [ Player | Crate ]',
    '[ Missing))Other | Crate ] -> [ Player | Crate ]',
    '[ Missing ) (c) Other ] -> [ Player ]',
    '[ Player ] -> [ Player ] ) Missing',
    '[ Player ] -> message )Literal',
    '[ Player ] -> message (Literal)',
    '[ Player ] -> message text)Literal',
  ]) add('rule lexical visits: ' + rule, base.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', rule));
  for (const count of [5, 100]) {
    const prefix = count === 5 ? Array(count).fill('unknown_metadata value') : Array(count).fill('===)');
    add('rule closer at diagnostic limit ' + count, prefix.join('\n') + '\n' + base.replace('[ > Player | Crate ]', '[ Missing ) Other | Crate ]'));
  }
  const rawVisits = [
    ['legend', 'P = Player', [
      'Actor = Missing ) Other\nP = Player', 'Actor) = Player\nP = Player',
      'Actor = Player)', 'Actor = Player) ', 'Actor = Player(c)',
      'Actor = Player(c))', 'Actor = Player(c)) ', 'Actor = Player(unclosed',
      'Actor ? junk) (c) Player\nP = Player', 'Actor = ?junk) (c) Player\nP = Player',
      'Actor = Player ?junk) (c) Crate\nP = Player', 'Actor = Player or)Crate\nP = Player',
      'Actor = Player or (outer (nested)) Crate\nP = Player',
      'Actor = Pla(c)yer\nP = Player', 'Actor = Missing (c) Other\nP = Player',
      'Actor = Player(c\nd)\nP = Player', 'Actor = Player(c\nd) Crate\nP = Player',
      'Actor = Player rules Crate\nP = Player', 'Actor = Player rules) Crate\nP = Player',
    ]],
    ['layer', 'Player, Crate, Wall', [
      'Player Missing ) Other', 'Player Missing)Other', 'Player ) Missing',
      'Player Background ) Missing', 'Player Player ) Missing',
      'Player (outer (nested)) Crate, Wall', 'Pla(c)yer, Crate, Wall',
      'Player ?junk) (c) Crate, Wall', 'Player)Crate, Wall',
      ')Player, Crate, Wall', 'Player,(c))Crate, Wall', ')', ',(c)',
      'Player 😀, Crate, Wall', 'Player 😀) Missing', 'Player İ) Missing',
      'Player(c\nd)Crate, Wall', 'Player rules Crate, Wall', 'Player rules) Crate, Wall',
    ]],
    ['win', 'no Player', [
      'bad Missing ) on Other', 'no Missing) on Other', 'no Player)',
      'no Player) ', ')no Player', 'no ?junk) (c) Player',
      'no Player ?junk) (c) Crate', 'bad Missing (c) on Other',
      '(outer (nested)) no Player', 'no Pla(c)yer', 'n(c)o Player',
      'no Player on)Crate', 'no Player on Crate)Extra',
      'no Player(c\nd) on Crate', 'no Player rules Crate', 'no Player rules)Crate',
    ]],
  ];
  for (const [family, from, variants] of rawVisits)
    for (const text of variants) add('raw visits ' + family + ': ' + text, base.replace(from, text));
  for (const count of [4, 5, 99, 100]) {
    const prefix = Array(count).fill(count < 10 ? 'unknown_metadata value' : '===)').join('\n') + '\n';
    for (const [family, from, text] of [
      ['legend', 'P = Player', 'Actor = Player wrong ) Other\nP = Player'],
      ['layer', 'Player, Crate, Wall', 'Player Missing ) Other'],
      ['layer astral', 'Player, Crate, Wall', 'Player 😀) Missing'],
      ['win', 'no Player', 'bad Missing ) on Other'],
    ]) add('raw visit cap ' + count + ' ' + family, prefix + base.replace(from, text));
  }
  for (const rule of [
    '[ Player rules Crate ] -> [ Player ]', '[ Player rules) Crate ] -> [ Player ]',
    '[ Player rules(ignored) Crate ] -> [ Player ]', '[ Player rules[ Crate ] -> [ Player ]',
    '[ Player rules+ Crate ] -> [ Player ]', '[ Player rules-> Crate ] -> [ Player ]',
    'right rules [ Player ] -> [ Player ]', ')rules [ Player ] -> [ Player ]',
    ')rules[ Player ] -> [ Player ]', '[ Player ] rules -> [ Player ]',
    '[ Player ] -> rules message (literal', '[ Player ] -> rules) message (literal',
    '[ Player ] -> message ) ) (literal', '[ Player ] -> message rules (literal',
    '[ Player ] -> message(ignored) Missing', '[ Player ] -> message )',
    '[ Player ] -> message ) ', '[ Player ] -> message (literal)\n[ Player ] -> [ Player ]',
    '[ Player (outer (nested)) Missing ] -> [ Player ]',
    '[ Player(foo) ] -> [ Player ]', '[ Player(foo ] -> [ Player ]',
    '(İ)[ Player ] -> message (literal', '[ Player ] -> message İ(literal',
    '[ Player ] -> message İ ) (literal',
  ]) add('rule raw ownership: ' + rule, base.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', rule));
  for (const sound of [
    'sfx0 rules 12345', 'sfx0 rules) 12345', 'sfx0 rules(ignored) 12345',
    'sfx0 (c) rules 12345', 'Player rules move right 12345',
    'Player move rules right 12345', 'Player move right rules 12345',
    'Player move right 12345 rules', 'Player move right rules) 12345',
    ')rules sfx0 12345', 'sfx0 nope rules 12345', 'sfx0 rules',
    'sfx0 (outer (nested)) rules 12345', 'sfx0 rules (c\nd) 12345',
    'Player move rules(ignored) 12345', 'Player move rules) 12345',
    'sfx0 12345 rules(', 'sfx0 12345 rules) (c) ',
  ]) add('sound raw ownership: ' + sound, base.replace('\nsounds\n', '\nsounds\n' + sound + '\n'));
  for (const count of [4, 5, 99, 100]) {
    const prefix = Array(count).fill(count < 10 ? 'unknown_metadata value' : '===)').join('\n') + '\n';
    add('rule raw ownership cap ' + count, prefix + base.replace('[ > Player | Crate ]', '[ Missing rules) Other | Crate ]'));
    add('sound raw ownership cap ' + count, prefix + base.replace('\nsounds\n', '\nsounds\nPlayer rules) Missing\n'));
  }
  return fixtures;
};
