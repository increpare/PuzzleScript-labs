# Vanilla quirks: corpus impact

Which recorded games play differently when a quirk switch (see
[README](README.md#quirk-switches)) is turned off. Measured 2026-10-25 against the
478 simulation fixtures pinned in `test/vanilla/`.

```sh
npm --prefix typescript run quirk-impact -- [--jobs N] [--json OUT] [name filter]
```

Each game is replayed with vanilla quirks, then with one switch off at a time,
then with all off. A game "changes" if any observation differs: compilation
outcome and messages, or after any input or AGAIN step the level, screen, board,
sounds, saves, wins or the input's modified flag. The full run took 2 h 10 min on
9 workers.

## Results

| Switch turned off | Games that change | Why |
| --- | --- | --- |
| `columnMajorMovementOrder` | **11** | Movement order decides which mover wins a contested cell |
| `restoreKeepsMovements` | 0 | Needs movements pending at undo/restart; only a late `randomdir` leaves any |
| `lateMovementsCarryOver` | 0 | No corpus game uses `randomdir` in a late rule |
| `combinedMovementsStayPut` | 0 | Two movements on one layer only arise from a carried-over late movement |
| `rigidOwnerOrdinalMerge` | 0 | 34 games use rigid; no recorded input makes the merged owner matter |
| `lhsRandomDirIsUpAndLeft` | 0 | No corpus game uses `randomdir` on a rule's left-hand side |
| `uniformCanReachOne` | 0 | A draw of exactly 1 has probability 2^-56 |
| All off | 11 | The same 11 games; nothing else changes |

Games that depend on column-first movement order, with the first input that
differs:

| Game | First difference |
| --- | --- |
| ellipsisPropagationBug1 | input 0 |
| ellipsisPropagationBug2 | input 0 |
| collapse simple | input 5 |
| collapse long | input 4 |
| gallery: collapsable sokoban | input 5 |
| WITCH LIFTER | input 4 |
| 2D whale world | input 6 |
| Being Alan Hazelden | input 14 |
| Closure | input 45 (AGAIN step 1) |
| Oh No My Dog Is About To Swallow A Piece Of Chocolate | input 69 |
| legend of zokoban | input 100 |

Example (ellipsisPropagationBug1, first input): two MoveGuides, one moving down
and one moving right, can each move into a cell the other is leaving. Visiting
columns first resolves them in the opposite order from visiting rows first, so the
final board differs.

## What this means

- **Column-first movement order is language semantics, not a quirk.** Published
  games depend on it. It should stay, documented as a rule, with no switch.
- **The other six change no recorded game.** Three of them (restore, late
  carry-over, combined movements) are one chain. A late `randomdir` is the only
  source of movements pending between turns, so it is the only way to reach the
  restore bug and the Up+Down combination.

## Limits

- "0 games" means no recorded input sequence observes a difference. It doesn't
  mean the quirk is unreachable: the hand-made reproducers in `test/repros/` do
  observe each one.
- The baseline is this port with vanilla quirks, which matches vanilla on every
  input. Later level loads use deterministic seeds here (vanilla uses fresh random
  ones), and every configuration sees the same seeds.
- Error-recovery behavior for malformed source is not switchable and not measured.
