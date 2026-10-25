# Error recovery: unlayered random spawn creates an orphan object

**Status: accepted recovery behavior, not an engine bug.** The source has a
serious error that the compiler reports. Any behavior salvaged after that error
is acceptable; this document records the observation for compatibility, without
requiring a change to vanilla PuzzleScript.

This is a **newly constructed reproducer**, made while developing the TypeScript
reference port. It was not found in an existing game or the existing test corpus.

Confirmed against unmodified vanilla PuzzleScript at
[`5a94bde1a5127a3a45306ea28598eba2874d446d`](https://github.com/increpare/PuzzleScript/commit/5a94bde1a5127a3a45306ea28598eba2874d446d),
using the Node test host. This is malformed source: Background appears in two
collision layers and Player has no collision layer. The compiler diagnoses both,
but continues with a playable state that can create an obsolete object entry.

## Reproducer

```text
title Orphan object reproduction

objects
Background
black

Player
white

Crate
red

legend
C = Crate

sounds

collisionlayers
Background
Background
Crate

rules
[ Crate ] -> [ random Player ]

winconditions
some Player

levels
C
```

1. Compile and load level 0.
2. Observe the duplicate-layer warning and the error:
   `Object "PLAYER" has been defined, but not assigned to a layer.`
3. Execute one action input (`processInput(4)`, corresponding to X).

## Actual behavior

The source compiles far enough to execute the rule. The initially absent player
becomes detectable and `some Player` wins, although Player still has no assigned
layer or object ID.

Verified native state, with normal win handling enabled for the input:

```text
                               before input    after input
level.objects                  [6]             [1]
getPlayerPositions()           []              [0]
winning                        false           true
```

The allocated entries are (IDs and layer indices here are zero-based):

```text
id 0: background — obsolete first assignment
id 1: background — current Background object, on layer 1
id 2: crate      — current Crate object, on layer 2

Player.id    === undefined
Player.layer === undefined
```

Thus `[6]` contains current Background and Crate. `[1]` contains only the obsolete
entry, not an actual layered Player. This report verifies logical engine state;
browser rendering of that obsolete entry was not tested.

## Interpretation

The unlayered-object error is sufficient diagnosis. Execution after that error
does not establish a correctness requirement, even when a rule creates an
obsolete entry or satisfies a player win condition. This is an error-recovery
observation to preserve, not a proposed bug fix.

## Cause

- [Layer assignment](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/compiler.js#L96)
  allocates an ID for each occurrence. The second Background overwrites its current
  ID, leaving the old entry in `idDict`.
- [Object lookup construction](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/compiler.js#L2317)
  passes the unlayered Player's undefined ID to `ibitset`.
  [Its bitwise coercions](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/bitvec.js#L50)
  select entry 0, which is the obsolete Background assignment here.
- The random spawn and player lookup both use that entry. Random execution
  resolves its layer through `idDict` and the current Background definition,
  clears that layer and writes the obsolete entry. The player condition then
  recognizes it.
- [The final layering check](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/compiler.js#L3062)
  happens after rule lowering. Its error does not prevent this state from running.

This is separate from rigid ownership issue #1206. No production JavaScript
changes were made to produce or verify it.
