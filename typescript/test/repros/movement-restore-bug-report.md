# Undo and restart leave pending movements behind when movement storage spans multiple words

Undo and restart restore the visible board but can leave pending movements from
the discarded turn. Those movements execute on the next input. `restoreLevel`
clears only `level.n_tiles` entries of an array that can be longer than that.

This is a **newly constructed, valid-source reproducer** made while developing
the TypeScript reference port. It was not found in an existing game. Confirmed
against unmodified vanilla PuzzleScript at
[`5a94bde1a5127a3a45306ea28598eba2874d446d`](https://github.com/increpare/PuzzleScript/commit/5a94bde1a5127a3a45306ea28598eba2874d446d)
using the Node test host, with no compilation errors or warnings. Browser keyboard
steps below describe the equivalent inputs; browser rendering was not tested.

## Reproducer

```text
title Pending movement survives undo and restart

objects
Background
black

Player
white

Spare1
red

Spare2
red

Spare3
red

Spare4
red

Spare5
red

Dust
yellow

legend
. = Background
P = Player
D = Dust

sounds

collisionlayers
Background
Player
Spare1
Spare2
Spare3
Spare4
Spare5
Dust

rules
late [ Dust ] -> [ randomdir Dust ]

winconditions

levels
P..
.D.
...
```

The five unused objects provide separate collision layers, bringing the total to
eight. Every object is assigned to exactly one layer. The compiler accepts
`randomdir` in late rules; this source does not trigger the error for ordinary
movement directions in late rules.

## Steps and observed behavior

1. Compile and load the game. Player starts at the top left; Dust is in the centre.
2. Press Right. Player moves right. Dust stays in the centre, with a random
   movement left pending by the late rule.
3. Press Undo (Z). Player returns to the top left and the board looks like a fresh
   level, but Dust's movement is still pending.
4. Press Action (X). Dust moves one cell in the pending direction.

Repeat from a fresh load, replacing Undo with Restart (R): the same problem
occurs. As a control, load the game fresh and press Action immediately: Dust
stays in the centre on that first input.

Dust has an empty neighbouring cell in every direction, so this difference does
not depend on which random direction was chosen.

## Expected behavior

Undoing the first move, or restarting, should discard that move's pending
movements. The first Action input after restoration should leave Dust in the
centre, just as the first Action input after a fresh load does.

This expectation does not require undo to restore the random generator. It is
about movement state surviving restoration, before another random choice is made.

## Verified native state

For a deterministic run, compile with seed `late-restore`. The Node host used
`processInput(3)` for Right, `DoUndo(false, true)` for Undo, `DoRestart()` for
Restart, and `processInput(4)` for Action. Each branch starts with a fresh load.
Coordinates below are zero-based `(x, y)`.

| Input sequence | Player | Dust | Pending movement at Dust's original cell |
| --- | --- | --- | --- |
| Fresh load | (0, 0) | (1, 1) | None |
| Right | (1, 0) | (1, 1) | Right |
| Right, Undo | (0, 0) | (1, 1) | Right, incorrectly retained |
| Right, Undo, Action | (0, 0) | (2, 1) | Consumed; Dust moved |
| Right, Restart | (0, 0) | (1, 1) | Right, incorrectly retained |
| Right, Restart, Action | (0, 0) | (2, 1) | Consumed; Dust moved |
| Fresh load, Action | (0, 0) | (1, 1) | Right, newly assigned after movement resolution |

Immediately after Right, and unchanged after either restoration:

```text
level.n_tiles        = 9
STRIDE_MOV           = 2
level.movements.length = 18
level.movements[9]   = 64   // Dust's pending Right movement
all other entries   = 0
```

## Cause

- [Movement allocation](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/engine.js#L939)
  creates `level.n_tiles * STRIDE_MOV` entries.
- [Stride calculation](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/compiler.js#L123)
  sets `STRIDE_MOV = Math.ceil(layerCount / 5)`, which is 2 here.
- [Same-size restoration](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/engine.js#L1036)
  clears only entries 0 through 8. Dust is at tile index 4, on layer index 7;
  its movement is in the second word for that tile, array entry 9. That entry is
  outside the cleared prefix.
- Both [Undo](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/engine.js#L1204)
  and [Restart](https://github.com/increpare/PuzzleScript/blob/5a94bde1a5127a3a45306ea28598eba2874d446d/src/js/engine.js#L1158)
  call this restoration function. The next turn reads the surviving movement and
  resolves it before applying late rules again.

The partial clear requires `STRIDE_MOV > 1`, and an outstanding movement in the
uncleared suffix. Restoring different board dimensions takes the separate array
rebuild path. With `STRIDE_MOV === 1`, the existing loop covers the whole array.

## Possible correction

Clear the whole movement array in the same-size branch, for example with
`level.movements.fill(0)`, rather than stopping at `level.n_tiles`.

As an isolation check, explicitly clearing the whole movement array immediately
after Undo or Restart prevents Dust from moving on the following Action input.
No production JavaScript was changed. The TypeScript port currently preserves
the existing behavior for compatibility.
