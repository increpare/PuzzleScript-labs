# Small executable PuzzleScript semantics fixtures

The user approved an executable language guide whose main output is new,
portable `testdata.js` fixtures, with explicit expected behavior and independent
JS/TypeScript comparisons. Explore interactions deeply and minimize discrepancies.

## Corpus format

Authored files live in `src/tests/semantic-fixtures/`: complete readable `.ps`
games in family subdirectories and one JSON manifest per family. Each manifest
is an array of games with `id`, `sourceFile`, `explanation`, `cells` and `cases`.
`cells` maps single-character expected-board glyphs to explicit lowercase object
names, including background. Cases contain `name`, `inputs`, `expected` (an array
of row strings), and optional `seed`, `level` and `expectedSounds`. A game's seed
defaults to its id, so input-prefix cases share the same random sequence.
`expectedPlayedSounds` is an optional richer assertion for audible events omitted
from legacy soundHistory. Native verification and candidate effect assertions
check it, but the portable tuple intentionally omits that extra field.

Example schema: `{"id":"example","sourceFile":"family/example.ps",
"explanation":"The behavior being tested.","cells":{"P":["background","player"],
".":["background"]},"cases":[{"name":"first move","inputs":[3],"expected":[".P"]}]}`.

Expected boards and sounds are authored, not recorded from an engine. The loader
checks schema, board shape and glyphs. A deterministic exporter encodes those
expectations in the legacy fixture format and appends a generated, delimited
section to the labs `src/tests/resources/testdata.js`; it never edits the frozen
vanilla fixtures or their hashes. Native serialization visits linear cells in
column order but inserts a newline each width cells: preserve this wire format
without confusing it with the authored expected rows.

## Verification and investigation

The JS runner executes generated entries as ordinary tests. A TypeScript test
loads the same authored manifest and feeds fixtures to the existing independent,
source-compiled per-input oracle. It also checks the authored end board and sound
expectations. Keep schema/export tests separate from semantic tests. Add negative
checks proving a wrong expected board or sound fails.

Cover inference, overlapping matches, ellipses, random rules, rigid retries,
movement contention, late rules, AGAIN, cancellation, checkpoints and history.
Distinguish agreement with pinned vanilla from divergence in the current labs
engine. Document constructed provenance, source validity, first failing input,
seed and expected/actual states for every confirmed discrepancy. Do not change
engine semantics or rewrite expected outcomes merely to make the suite green.

These are headless engine fixtures, not UI/browser tests. No browser tests are
added to this repository. The frozen vanilla authority remains unchanged.
