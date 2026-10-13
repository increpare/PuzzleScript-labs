const sprite = "00000\n0...0\n0.0.0\n0...0\n00000\n"
const objects = `OBJECTS
PlayerCharacter
red
${sprite}
Crate_Up
blue
${sprite}
Crate_Down
blue
${sprite}
Crate_Left
blue
${sprite}
Crate_Right
blue
${sprite}
Background
black
${sprite}
`
const legend = objects + "\nLEGEND\nHero = PlayerCharacter\nMovers = PlayerCharacter or Crate_Up\n"
const sounds = legend + "\nSOUNDS\nsfx0 123\n"
const collisionLayers = sounds + "\nCOLLISIONLAYERS\nBackground\nPlayerCharacter\n"
const rules = collisionLayers + "\nRULES\n"
const winConditions = rules + "\nWINCONDITIONS\n"
const levels = winConditions + "\nLEVELS\n"

const expected = {
  "prelude-metadata": {
    from: {line: 0, ch: 0}, to: {line: 0, ch: 2},
    list: [{text: "title", extra: "My Amazing Puzzle Game", tag: "METADATA"}]
  },
  "prelude-colour": {
    from: {line: 0, ch: 17}, to: {line: 0, ch: 19},
    list: [{text: "red", extra: "", tag: "COLOR-RED"}]
  },
  "object-colour": {
    from: {line: 51, ch: 0}, to: {line: 51, ch: 1},
    list: [{text: "red", extra: "", tag: "COLOR-RED"}]
  },
  "object-name-generation": {
    from: {line: 9, ch: 0}, to: {line: 9, ch: 3},
    list: [{
      text: "Crate_Down\nred\n00000\n0...0\n0.0.0\n0...0\n00000\n\n" +
        "Crate_Left\nred\n00000\n0...0\n0.0.0\n0...0\n00000\n\n" +
        "Crate_Right\nred\n00000\n0...0\n0.0.0\n0...0\n00000\n\n",
      extra: "",
      tag: "comment"
    }]
  },
  "legend-directional-expansion": {
    from: {line: 51, ch: 0}, to: {line: 51, ch: 3},
    list: [{
      text: "Crate = Crate_Up or Crate_Down or Crate_Left or Crate_Right",
      extra: "",
      tag: "NAME"
    }]
  },
  "sound-object-name": {
    from: {line: 55, ch: 0}, to: {line: 55, ch: 3},
    list: [{text: "PlayerCharacter", extra: "", tag: "NAME"}]
  },
  "collision-layer-original-case": {
    from: {line: 58, ch: 0}, to: {line: 58, ch: 3},
    list: [{text: "PlayerCharacter", extra: "", tag: "NAME"}]
  },
  "rule-directions": {
    from: {line: 62, ch: 0}, to: {line: 62, ch: 2},
    list: [
      {text: "right", extra: "", tag: "DIRECTION"},
      {text: "rigid", extra: "", tag: "DIRECTION"}
    ]
  },
  "rule-commands": {
    from: {line: 62, ch: 43}, to: {line: 62, ch: 45},
    list: [{text: "restart", extra: "", tag: "COMMAND"}]
  },
  "rule-mirror": {
    from: {line: 63, ch: 0}, to: {line: 63, ch: 1},
    list: [
      {text: "down", extra: "", tag: "DIRECTION"},
      {
        text: "down [ > PlayerCharacter | Crate_Down ] -> [ > PlayerCharacter | > Crate_Down ]",
        extra: "",
        tag: "EXTENDED_AUTOCOMPLETE"
      }
    ]
  },
  "win-conditions": {
    from: {line: 64, ch: 0}, to: {line: 64, ch: 2},
    list: [{text: "some", extra: "", tag: "LOGICWORD"}]
  },
  "levels-message": {
    from: {line: 66, ch: 0}, to: {line: 66, ch: 3},
    list: [{text: "message", extra: "", tag: "MESSAGE_VERB"}]
  },
  comment: {from: {line: 62, ch: 2}, to: {line: 62, ch: 4}, list: []},
  "empty-word": {from: {line: 62, ch: 0}, to: {line: 62, ch: 0}, list: []},
  "mid-word-edit": {from: {line: 0, ch: 0}, to: {line: 0, ch: 2}, list: []}
}

function atEnd(name, source) {
  const lines = source.split("\n")
  const line = lines.length - 1
  return {name, source, cursor: {line, ch: lines[line].length}, expected: expected[name]}
}

export const autocompleteCases = [
  atEnd("prelude-metadata", "ti"),
  atEnd("prelude-colour", "background_color re"),
  atEnd("object-colour", objects + "\nNewObject\nr"),
  atEnd("object-name-generation", "OBJECTS\nCrate_Up\nred\n" + sprite + "\nCra"),
  atEnd("legend-directional-expansion", objects + "\nLEGEND\nCra"),
  atEnd("sound-object-name", legend + "\nSOUNDS\nPla"),
  atEnd("collision-layer-original-case", sounds + "\nCOLLISIONLAYERS\nPla"),
  atEnd("rule-directions", rules + "ri"),
  atEnd("rule-commands", rules + "[ PlayerCharacter ] -> [ PlayerCharacter ] re"),
  atEnd("rule-mirror", rules + "up [ > PlayerCharacter | Crate_Up ] -> [ > PlayerCharacter | > Crate_Up ]\nd"),
  atEnd("win-conditions", winConditions + "so"),
  atEnd("levels-message", levels + "mes"),
  atEnd("comment", rules + "( ri"),
  atEnd("empty-word", rules),
  {name: "mid-word-edit", source: "title", cursor: {line: 0, ch: 2}, expected: expected["mid-word-edit"]}
]
