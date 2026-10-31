# Vanilla quirks: current defaults and historical corpus impact

The active reference is vanilla `57f9f6cba69f6aa52ed738d5aee1d709d0037648`,
with 492 simulation fixtures. Its defaults match that revision:
`rigidOwnerOrdinalMerge`, `lhsRandomDirIsUpAndLeft` and `lateMovementsCarryOver`
are off; the other four switches remain on. See [README](README.md#quirk-switches).

The measurements below are **historical**, taken on 2026-10-25 against the previous
`5a94bde1a5127a3a45306ea28598eba2874d446d` pin and its 478 simulation fixtures.
They have not been rerun against the refreshed corpus.

```sh
npm --prefix typescript run quirk-impact -- [--jobs N] [--json OUT] [name filter]
```

The current runner replays each game with current vanilla defaults, then toggles
one switch from its default at a time, then turns all switches off. This permits
research opt-ins for historical bugs that current vanilla has fixed. A game
"changes" if any observation differs: compilation
outcome and messages, or after any input or AGAIN step the level, screen, board,
sounds, saves, wins or the input's modified flag. The historical run turned each
then-enabled switch off and took 2 h 10 min on 9 workers.

## Historical results at 5a94bde1

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

## Interpretation of the historical results

- **Column-first movement order is language semantics, not a quirk.** Published
  games depend on it. It should stay, documented as a rule, with no switch.
- **The other six change no recorded game.** Three of them (restore, late
  carry-over, combined movements) are one chain. A late `randomdir` is the only
  source of movements pending between turns, so it is the only way to reach the
  restore bug and the Up+Down combination.

## Changes at the refreshed pin

- Rigid ownership now stays with the first group that marked a layer. The old
  ordinal merge remains an explicit research opt-in.
- LHS `random` and `randomdir` produce compiler errors and remove the whole rule.
  The historical LHS `randomdir` interpretation requires its research switch.
- Movement qualifiers in late rules, including `randomdir`, produce compiler
  errors. Enabling the carryover switch does not make that syntax valid. Runtime
  carryover/restore tests use an explicitly artificial historical schedule.
- Speculative AGAIN turns cannot save a checkpoint or write persistence.

These changes invalidate using the historical late-`randomdir` reproducers as
examples of current valid gameplay. Their reports retain the earlier measurements
with the original authority clearly labelled.

## Limits of the historical measurement

- "0 games" means no recorded input sequence observes a difference. It doesn't
  mean the quirk is unreachable: the hand-made reproducers in `test/repros/` do
  observe each one.
- The historical baseline used this port's then-current vanilla quirks. Later
  level loads used deterministic seeds (vanilla uses fresh random ones), and every
  configuration saw the same seeds. It is not a new replay of the refreshed pin.
- Error-recovery behavior for malformed source is not switchable and not measured.
