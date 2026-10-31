# Small executable PuzzleScript semantics fixtures

This collection contains **52 complete games and 140 portable gameplay fixtures**.
Each example has a readable game, a short explanation and explicitly authored
expected boards. The same fixtures run on labs JS, pinned vanilla JS and the
independently compiled TypeScript reference. They were constructed for this work,
not extracted from existing games or recorded to bless engine output.

| Family | Games | Cases | Behaviors |
| --- | ---: | ---: | --- |
| [Inference](inference.json) | 12 | 28 | Local and unique property binding, mixed members, cross-layer inference, exclusions, movement qualifiers and all relative orientations |
| [Matching](matching.json) | 14 | 30 | Overlapping live rechecks, group fixed points/order, one/two ellipses, row boundaries, Cartesian multirow tuples and scan order |
| [History](history.json) | 12 | 30 | Late timing, AGAIN probes, checkpoint/restart/cancel priority, RNG across undo, singleton draws and sound ordering |
| [Movement](movement.json) | 12 | 46 | Convoys, contention, independent layers, action/collision, required-player rollback, rigid retries, consumed random draws, restore word boundaries and colliding Up+Down requests |
| [Random groups](random.json) | 2 | 6 | One tuple per random group, separate candidate/object draws, `+` alternatives and unmatched-input RNG consumption |

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
can draw repeatedly until that group's state stops changing. The restore examples
spell out that sequence rather than equating a group's final direction with its
first draw.

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

The known rigid issue #1206 has an explicit supplemental assertion of the native
retry/ban sequence and TypeScript ban set. Final-board comparison alone cannot
prove which otherwise invisible group was banned. The original source-compiled
session oracle remains unchanged; its snapshots intentionally omit that ban set.

## Findings and limits

- Passing authored cases agree with both JS implementations and TypeScript. No
  JS/TypeScript gameplay mismatch was found in this collection.
- [Late Player randomdir](repros/late-player-randomdir.md) is a separate accepted-source
  crash, reduced to one cell and two Action inputs. Vanilla and labs throw a
  TypeError; TypeScript reports an unsupported movement combination. It is not
  included as a passing board fixture, and no engine fix was applied.
- The movement word-boundary and #1206 cases preserve previously known behavior;
  they are not claimed as new bug discoveries.
- Two singleton-random cases intentionally produce the existing concrete-random
  warning. Every exported source compiles without errors.
- Source-authoring omissions were corrected while retaining their hand-written
  outcomes. One initial history assumption was corrected after inspecting the
  contract: a standalone tick with no prior input creates no undo entry. The
  corresponding case explicitly tests that behavior.

These examples improve coverage; passing them is not proof that no other
discrepancies exist. Keep new discoveries minimal, record their provenance and
diagnostics, and review the intended behavior before adding expected outcomes.
