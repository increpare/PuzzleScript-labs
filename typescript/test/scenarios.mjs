export function movementSource({
  rules = '[ > Player | Crate ] -> [ > Player | > Crate ]',
  level = 'PC.',
  sounds = '',
  metadata = '',
} = {}) {
  return [
    'title TypeScript movement comparison', metadata,
    'objects',
    'Background', 'black', '',
    'Player', 'white', '',
    'Crate', 'red', '',
    'Wall', 'blue', '',
    'legend',
    '. = Background', 'P = Player', 'C = Crate', '# = Wall', '',
    'sounds', sounds, '',
    'collisionlayers', 'Background', 'Player, Crate, Wall', '',
    'rules', rules, '',
    'winconditions', '',
    'levels', level, '',
  ].join('\n');
}
