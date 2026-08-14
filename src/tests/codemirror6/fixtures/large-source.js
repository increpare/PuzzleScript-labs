const prelude = `OBJECTS
Player
red
.....
.....
.....
.....
.....

LEGEND

SOUNDS

COLLISIONLAYERS
Player

RULES

WINCONDITIONS

LEVELS
`

const levelRow = "P".repeat(80) + "\n"

export const largeSource = prelude + levelRow.repeat(1_600)
export const distantPosition = largeSource.length - 41
export const distantLineText = "P".repeat(80)
