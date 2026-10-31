# Small executable PuzzleScript semantics fixtures

This collection contains **52 complete games and 140 portable gameplay fixtures**.
Each example has a readable game, a short explanation and explicitly authored
expected boards. The fixtures run on labs JS, pinned vanilla JS and the
independently compiled TypeScript reference, using vanilla checkpoint `57f9f6cb` as the shared authority. They were constructed for this work,
not extracted from existing games or recorded to bless engine output.

| Family | Games | Cases | Behaviors |
| --- | ---: | ---: | --- |
| [Inference](inference.json) | 12 | 28 | Local and unique property binding, mixed members, cross-layer inference, exclusions, movement qualifiers and all relative orientations |
| [Matching](matching.json) | 14 | 30 | Overlapping live rechecks, group fixed points/order, one/two ellipses, row boundaries, Cartesian multirow tuples and scan order |
| [History](history.json) | 11 | 27 | AGAIN probes, checkpoint/restart/cancel priority, RNG across undo, singleton draws and sound ordering |
| [Movement](movement.json) | 9 | 30 | Convoys, contention, independent layers, action/collision, required-player rollback, rigid retries and consumed random draws |
| [Random groups](random.json) | 2 | 6 | One tuple per random group, separate candidate/object draws, `+` alternatives and unmatched-input RNG consumption |
| [Error recovery](recovery.json) | 4 | 19 | Reported invalid late movements, safe continuation, undo and restart after recovery |

## Run and export

From the repository root:

```sh
# Original vanilla authority, with authored boards and sound expectations.
node src/tests/semantic-fixtures/verify-native.cjs

# Compile TypeScript independently and compare every input/AGAIN observation.
npm --prefix typescript run test:semantics

# Run the exported fixtures using the existing labs JS runner.
node src/tests/run_tests_node.js 'semantic:' --sim-only

# After deliberately editing game sources or expected values, serialize them.
node src/tests/semantic-fixtures/export.cjs
node src/tests/semantic-fixtures/export.cjs --check

# Produce a standalone vanilla-format file suitable for copying upstream.
node src/tests/semantic-fixtures/export.cjs --stdout > /tmp/semantic-testdata.js
```

`testdata.js` contains a delimited generated section appended after all existing
fixtures. The exporter preserves existing bytes and replaces only its own section.
It does not run an engine, infer expected results from source, or update the
frozen vanilla corpus and its hashes. The default TypeScript suite also checks
that the committed export matches the authored files.

To run only the standalone export on labs:

```sh
PUZZLESCRIPT_TESTDATA=/tmp/semantic-testdata.js node src/tests/run_tests_node.js --sim-only
```

All tests here are headless engine tests. UI/browser regressions belong to the
separate `puzzlescript_testdump/ui/` collection.

## Read or add an example

Each family manifest is an array of games:

```json
{
  "id": "family/example",
  "sourceFile": "family/example.ps",
  "explanation": "Why this source should produce these results.",
  "cells": {"P": ["background", "player"], ".": ["background"]},
  "cases": [{"name": "move right", "inputs": [3], "expected": [".P"]}]
}
```

Expected rows are ordinary logical rows. `cells` gives explicit lowercase object
names for each expected glyph, including background; the exporter never asks the
game compiler to interpret this map. Expected glyphs can label produced states
independently of source aliases. Seed defaults to the game id, and level defaults
to zero. A case may override `seed` or `level`. Inputs are 0=Up, 1=Left,
2=Down, 3=Right, 4=Action, plus `tick`, `undo` and `restart`.

The legacy serialized board format lists column-linear cells but inserts a line
break after each width cells. It is not a picture of the board. `fixtures.cjs`
handles that encoding; authors write normal row diagrams. The asymmetric-board
unit test independently fixes the expected wire string.

Use separate input-prefix cases when intermediate boards matter. Random examples
must explain the relevant draws and their choice intervals. An unchanged random
replacement still consumes a draw, and a non-random group containing randomdir
can draw repeatedly until that group's state stops changing. Historical movement reports spell out that sequence rather than equating a group's final direction with its first draw.

### Authority and diagnosed recovery

The ordinary `expected` and `expectedSounds` fields describe pinned vanilla
`57f9f6cb` and the independently compiled TypeScript reference. The loader and
exporter still support optional `labsExpected` and `labsExpectedSounds` for a
future intentional fork difference; no current case needs these overrides.

Upstream [#1207](https://github.com/increpare/PuzzleScript/pull/1207) rejects
`randomdir` in late rules. The four sources in [recovery.json](recovery.json)
exercised that historical acceptance bug. They now explicitly require the compiler
error `Movements cannot appear in late rules.` through the game's `expectedErrors`
array. The recovered rule drops the invalid qualifier while preserving its other
replacements. These cases check diagnosed recovery, not valid-language semantics:

- Crate and Dust have no pending movement. Ticks, undo and restart leave them in
  their original cells. A late Switch-to-Spent replacement still happens.
- Without carried Up on Player, Down moves into the empty bottom cell with no
  failure sounds. Undo then restores the already-Spent board after Action.

These expectations were authored from the rules and input history, not generated
by running an engine. The native verifier and TypeScript tests require every
reported compiler error to match an explicitly authored diagnostic; all other
sources require zero errors. The portable legacy tuple format carries boards and
sounds but has no compiler-diagnostic field. Its additional diagnostic checks
remain in this collection.

## Sounds and internal observations

`expectedSounds` is the optional portable sound-history array in `testdata.js`.
Vanilla deliberately excludes simple command sounds (`sfx0`, etc.) from that
history. Empty history does not mean silence.

For those cases, `expectedPlayedSounds` separately specifies all audible sound
seeds. It is checked by the pinned-native verifier and by explicit assertions on
TypeScript's returned effects, while the unchanged per-move oracle independently
compares actual JS and TS events. It is intentionally omitted from the portable
tuple because the existing format has no such field. Negative tests demonstrate
that wrong boards, recorded sounds and audible command sequences fail even when
the engines agree with one another.

The fixed rigid issue #1206 has an explicit supplemental assertion of the native
retry/ban sequence and TypeScript ban set: contributors 0 and 1 are retried, and
the absent Wall group 2 is never blamed. Final-board comparison alone cannot
prove which otherwise invisible group was banned. The original source-compiled
session oracle remains unchanged; its snapshots intentionally omit that ban set.

## Findings and limits

- All authored cases are checked against pinned vanilla and TypeScript. Updating
  the authority changes their canonical expectations where upstream fixed a bug.
- [Late Player randomdir](repros/late-player-randomdir.md) documents a constructed
  one-cell, two-Action crash in historical vanilla `5a94bde1`. Upstream #1207 fixes
  source acceptance. Its current runner checks the diagnostic and safe recovery.
- Historical movement word-boundary reports remain labelled with the authority
  under which those sources were accepted. Their current recovery cases do not
  establish restoration semantics for accepted games.
- Two singleton-random cases deliberately produce the concrete-random warning.
  Four recovery games deliberately report the late-movement error. Other games
  require zero compiler errors.
- A standalone tick with no prior input creates no undo entry; a history case
  explicitly tests that behavior.

These examples improve coverage; passing them is not proof that no other
discrepancies exist. Keep new discoveries minimal, record their provenance and
diagnostics, and review the intended behavior before adding expected outcomes.
