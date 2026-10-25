# Standalone Source Trace Implementation Plan

**Status:** Completed and independently reviewed. The separate complete
source-compiled replay also passes; see the final completion audit.

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then parent-managed spec and quality reviews. Begin after the whole-source
> compiler is reviewed. Do not dispatch child agents from this task.

**Goal:** Give the user a small runnable script and command that compile a source
game and show its TypeScript execution, with no native engine or test adapter.

**Architecture:** A Node `.mjs` command reads a file, calls compileSource and the
existing session operations, and formats ordinary domain values for inspection.
The compiler/runtime stay platform-independent. Add no CLI framework, rendering
application, performance machinery or production trace-event infrastructure.

**Tech Stack:** Existing strict TypeScript build, Node built-ins and generated
JavaScript/source maps. Examples and CLI need no npm runtime dependencies.

## Deliverables

- `typescript/bin/trace.mjs`: standalone source-to-session trace command.
- `typescript/examples/source-game.ps`: clearly labelled newly written small
  pushing game, using ordinary object definitions and unnamed collision layers.
- `typescript/examples/source.mjs`: readable direct compiler/session example.
- `typescript/test/source-trace.test.mjs`: focused behavioral and independence
  checks. Native oracle helpers must not be imported by the command/example.
- `typescript/package.json`: trace and example:source script entries.

Parent owns README and checkpoint plans; report exact verified commands and
example output so parent can update them. If the command needs additional files,
keep them beside the command/example with one concrete responsibility.

## Command behavior

From repository root, after the existing strict build:

```sh
node --enable-source-maps typescript/bin/trace.mjs --seed example --level 0 typescript/examples/source-game.ps right undo restart right right
```

Accept `--seed TEXT` and `--level N` before the source path; default to a fixed
documented seed and level zero. Reject missing option values, negative/noninteger
levels, unknown options and unknown input words with concise usage/errors and a
nonzero exit. Inputs are `up`, `down`, `left`, `right`, `action`, `tick`, `undo`
and `restart`, mapped explicitly to numeric Movement/session operations. No
network, browser, native source lookup, dynamic evaluation or stored-file writes.

Compile the exact file contents. Print diagnostics with their severity and source
line evidence. Run only Accepted outcomes, preserving native's acceptance of
some nonzero-error compilations. Declined/Invalid/Stopped return a nonzero exit
with their diagnostics/outcome; do not quietly use partial/native data. Surface
the existing MissingLevel runtime diagnostic when a requested level is absent.

Produce an initial trace observation and one after every requested operation.
Drain AGAIN after initial level-start work and every operation, emitting each
substep separately; guard a nonterminating run with a clear bounded error rather
than hanging indefinitely. Use explicit deterministic initial/subsequent level
seeds and print the seeds used. The command's scope is state/effect tracing, not
claiming that every successful rule match is logged.

Use plain named records: input/substep, current level and screen, board rows with
each cell's object names, requested movements with coordinates and unnamed layer
index, queued commands with canonical authored source lines, effects and history
length. Include enough explicit random state to inspect/reproduce seeded output;
do not replace it with a hash or packed integer. Render numeric enums as their
names at this output boundary. Preserve the distinction between an authored
object and its orphaned recovery identity. JSON lines are appropriate if every
Set/Map in the selected view is deliberately expressed as ordinary arrays/records;
do not stringify them to empty objects accidentally. This view is not advertised
as a complete persistence format for all engine state.

Use compilation.outcome.ruleSources for command source links, not name matching
or invented source locations. TypeScript build source maps already exist; enable
them in npm scripts and verify they still point at actual `src/` modules. These
debug maps and the game-rule source map have distinct purposes; document both.

Session operations consume their command queue before returning. The state view
must report the queue that remains, without claiming it records every executed
command. Verify command source projection using an actual compiled `applyTurnRules`
result, whose queued entries still retain their executable rule identities; a
small command-local view helper is appropriate. Do not change the production
session API or add an execution log just to make the trace display nonempty.

## Direct example

Keep `examples/source.mjs` short enough to read as a script. It should show the
public compiler narrowing, actual enum inputs, explicit seed environment and
ordinary state inspection. The core shape is:

```javascript
import { readFile } from 'node:fs/promises';
import { compileSource, SourceCompilationKind } from '../build/source-compiler.js';
import { Movement } from '../build/model.js';
import { createSession, stepSession, undoSession } from '../build/session.js';

const source = await readFile(new URL('./source-game.ps', import.meta.url), 'utf8');
const compilation = compileSource(source);
if (compilation.outcome.kind !== SourceCompilationKind.Accepted) {
  throw new Error('The example source did not compile.');
}
const { game } = compilation.outcome;
let load = 0;
const environment = { nextLevelSeed: () => 'example level ' + ++load };
let current = createSession(game, { seed: 'example' }, environment).state;
current = stepSession(game, current, Movement.Right, environment).state;
console.log(current.execution.board.rows.map(row =>
  row.map(cell => [...cell.objects].map(object => object.name))));
current = undoSession(game, current).state;
console.log('Undo history:', current.history.length);
```

The chosen source should make these observations meaningful and deterministic.
The command handles full trace formatting/AGAIN; the direct example may choose
a simple game with no AGAIN rather than hiding a substantial runner helper.

## Test-first implementation

- [x] Add the command test first and observe RED because the command is absent.
  Use a small source file and inputs right/undo/restart to assert actual board
  changes and restoration, not merely an exit-zero check.
- [x] Add the command, explicit argument/input mapping and trace projection.
  Exercise invalid compilation/outcomes and requested missing levels. Make the
  first behavior test GREEN before adding more presentation details.
- [x] Add deterministic seeded execution and AGAIN substep checks using small
  clearly labelled new source games. Verify command source-line links against
  actual authored rules, and ensure effect enums/object identities stay readable.
- [x] Add the source game and direct script, run it and record its actual output.
  Add npm scripts without changing the existing four domain-data examples.
- [x] Prove standalone execution: copy only built JS/maps, command, example
  sources/script and a minimal ESM package manifest into a fresh temporary tree.
  Do not copy native `src/`, test adapters or node_modules. Run both the command
  and direct example there and require correct observed behavior. Keep normal
  temporary-tree cleanup in tests; do not launch a preview server.
- [x] Run strict build, focused source-trace/compiler/session checks, both new
  commands and all four existing examples. Run full npm test once when settled;
  verify all native hashes and whitespace. Commit only explicit owned files and
  report DONE/SHA, exact commands/counts/logs and remaining limitations for parent
  spec then quality review. Parent owns README/plans; do not stage them.

From `typescript/` the final checks include:

```sh
npm run build
node --test test/source-trace.test.mjs test/source-compiler.test.mjs test/session.test.mjs
node --enable-source-maps examples/source.mjs
node --enable-source-maps bin/trace.mjs --seed example --level 0 examples/source-game.ps right undo restart right right
node examples/movement.mjs
node examples/matching.mjs
node examples/turn.mjs
node examples/session.mjs
npm test
git diff --check
```

The full 478-fixture source-compiled differential replay is a separate mandatory
gate. Coordinate build/test mutations with its live run; do not alter production
compiler/runtime behavior during a final replay without explicit coordination.
This command/example task alone does not complete the port.

## Reviewed result

Implemented at `4b3bc691`. Both independent spec and quality reviews approve the
six-file change. Production compiler/runtime, native source and session adapters
remain unchanged. The direct source script is 21 lines; Mouse mail is explicitly
labelled newly written. The CLI/view total 161 lines and use only Node built-ins
and the built TypeScript modules.

The behavior test was RED because the command did not exist, then GREEN with
actual push/undo/restart positions. All 13 trace tests pass, including accepted
errors, Declined/Invalid/Stopped, MissingLevel, every input mapping, deterministic
seeds/full RNG, initial/subsequent AGAIN, the 10,000-step bound, actual authored
command projection and orphan identities. Both reviewers independently repeated
13/13 and strict no-emit checking with no findings.

The standalone proof runs both programs from 89 files: 42 built JS, 42 maps,
two CLI files, two example files and a minimal ESM manifest. It copies no native
source, tests/adapters or node_modules, checks real board behavior and removes
the temporary tree. All four earlier examples and both new commands pass.
Strict build, 82/82 focused checks and the final full 1,582/1,582 suite pass with
exit zero; all 21 native hashes and whitespace checks pass.

Logs: `/private/tmp/typescript-source-trace-focused.log`,
`/private/tmp/typescript-source-trace-full-test.log`,
`/private/tmp/typescript-source-direct-example.log` and
`/private/tmp/typescript-source-trace-command.log`.
The direct script's history lengths are 0, 1, 0. For right/undo/restart/right/right,
the CLI player x positions are 1, 2, 1, 1, 2, 3 and parcel positions are
2, 3, 2, 2, 3, 4. Queues are explicitly labelled as remaining commands, not an
execution log. The separate full source-compiled replay now passes all 478 games,
20,034 observations/operations and 525 level loads with exit status zero.
