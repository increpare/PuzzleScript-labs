const completeGame = `title Parser Fixture
author PuzzleScript
background_color darkblue
text_color #Ff00aA

( outside ( inside ) outside )
OBJECTS
Player P
red #Ff00aA
00000
0...0
0.0.0
0...0
00000

Background B
black
.....
.....
.....
.....
.....

LEGEND
Hero = Player
Movers = Player or Background
Pair = Player and Background

SOUNDS
Player move up 123
startgame 456

COLLISIONLAYERS
Background
Player

RULES
[ > Player | Background ] -> [ > Player | Background ] sfx0
late [ Player ] -> [ Player ]

WINCONDITIONS
all Player on Background

LEVELS
PB
BP
`

const lineOfLength = length => "title " + "x".repeat(length - "title ".length)

export const parserCases = [
  {name: "all-sections", source: completeGame},
  {
    name: "mixed-case-object",
    source: "ObJeCtS\nPlayer\n#Ff00aA\n.....\n.....\n.....\n.....\n.....\n"
  },
  {name: "nested-comment", source: "( outside ( inside ) outside )\nOBJECTS\n"},
  {
    name: "incomplete-and-malformed",
    source: "title\nOBJECTS trailing junk\nPlayer\nnot-a-colour\n(..\nLEGEND\nBad =\nRULES\n[ Player | ->\n"
  },
  {
    name: "blank-lines-and-adjacent-styles",
    source: "\n\nOBJECTS\nPixel\nred\n00000\n00000\n00000\n00000\n00000\n\n"
  },
  {name: "line-at-9999", source: lineOfLength(9_999) + "\nOBJECTS\n"},
  {name: "long-line-cutoff", source: lineOfLength(10_001) + "\nOBJECTS\nPlayer\nred\n"}
]
