# Readable TypeScript reference port

A separate, headless port of **vanilla PuzzleScript**, pinned to
[increpare/PuzzleScript at 57f9f6cb](https://github.com/increpare/PuzzleScript/commit/57f9f6cba69f6aa52ed738d5aee1d709d0037648).
The existing labs JavaScript editor and player are unchanged.

The implementation describes actual objects, cells, movements and unnamed
collision layers. It uses numeric enums, arrays, Sets, Maps and direct loops.
There are no bitmasks, packed cells or generated matchers in the production
engine, and runtime matching uses no candidate pruning or caches. Clarity takes
precedence over performance.

Exact compatibility still includes historical behavior derived from vanilla's
storage layout. Those exceptions are explicit in
[compatibility.ts](src/compatibility.ts). Its `Quirks` object includes current
compatibility behavior and research switches for bugs fixed by the pinned revision.
`compileSource(source)` uses `vanillaQuirks`, whose defaults match that revision;
`compileSource(source, { quirks: noQuirks })` gives the clean model. See
[Quirk switches](#quirk-switches).

## Try the source example

From the repository root:

```sh
npm --prefix typescript ci
npm --prefix typescript run build
npm --prefix typescript run example:source
npm --prefix typescript run trace -- --seed example --level 0 examples/source-game.ps right undo restart right right
```

The [21-line source script](examples/source.mjs) reads the newly written
[Mouse mail game](examples/source-game.ps), calls `compileSource`, starts a session,
moves right and undoes. It directly inspects `board.rows`, `cell.objects` and
`object.name`. The trace command also demonstrates restart and repeated pushing:
the player's x coordinates are `1, 2, 1, 1, 2, 3`, and the parcel's are
`2, 3, 2, 2, 3, 4`.

After building, the command also runs directly:

```sh
node --enable-source-maps typescript/bin/trace.mjs --seed example --level 0 typescript/examples/source-game.ps right undo restart right right
```

Options precede the source path. The default seed is `example` and the default
level is zero. Inputs are `up`, `down`, `left`, `right`, `action`, `tick`, `undo`
and `restart`. Later level loads use explicit seeds `example:level:1`, and so on.

The command prints JSON records for diagnostics, configuration and each state.
Boards contain named object records; movements name their directions and layer
indices. It shows effects, history length, seeds and the full random state, and
drains AGAIN into separate observations. Object labels distinguish an orphaned
recovery identity from its current declaration. This is a state/effect inspection
view. The command queue shown is what remains after the operation; session
operations consume their queues before returning.

## Public model and operations

`compileSource(source)` returns the authored document, raw and recorded
diagnostics, error count and a tagged outcome. `Accepted` and `Declined` carry the
formed game, declarations, sprites, palette, metadata and authored rule links.
`Invalid` and `Stopped` expose no game. Acceptance follows vanilla's installation
decision: some accepted games have compilation errors.

Pass an Accepted outcome's exact `game` to `createSession`. Use `Movement.Right`
and the other actual enum values with `stepSession`; use `undoSession`,
`restartSession` and `advanceSession` for the corresponding operations. The host
supplies fresh level seeds through an explicit environment. Sound and persistence
operations are returned effects. Public operations return new state; history uses
ordinary board snapshots and canonical object identities remain shared.

The four examples that construct domain data directly remain available:

```sh
npm --prefix typescript run example
npm --prefix typescript run example:matching
npm --prefix typescript run example:turn
npm --prefix typescript run example:session
```

## Reading the code

| Start with | Meaning |
| --- | --- |
| [model.ts](src/model.ts), [board.ts](src/board.ts), [movement.ts](src/movement.ts) | Objects, cells, unnamed layers, movement requests and collision |
| [rule-model.ts](src/rule-model.ts), [matching.ts](src/matching.ts) | Predicates, bracket rows, ellipses and ordered matches |
| [replacement.ts](src/replacement.ts), [rules.ts](src/rules.ts) | Direct cell edits, live writes and command production |
| [scheduling.ts](src/scheduling.ts), [turn-rules.ts](src/turn-rules.ts) | Groups, loops, rigid retries and the turn sequence |
| [session-model.ts](src/session-model.ts), [session.ts](src/session.ts) | Input, history, restart, messages, levels, effects and wins |
| [random.ts](src/random.ts) | Explicit seeded random state and draws |
| [scan-order.ts](src/scan-order.ts) | Observable coordinate order, independent of board storage |
| [compatibility.ts](src/compatibility.ts) | Current restore and movement exceptions, plus historical research switches |
| [source-compiler.ts](src/source-compiler.ts) | The complete compiler's explicit pass order |
| [source-model.ts](src/source-model.ts), [source-reader.ts](src/source-reader.ts), [declarations.ts](src/declarations.ts) | Authored source evidence and canonical names/objects/layers |
| [source-rule-compiler.ts](src/source-rule-compiler.ts) and `rule-*.ts` | Syntax, ordered movement/property inference, lowering and schedules |
| [source-assets.ts](src/source-assets.ts), [source-game-data.ts](src/source-game-data.ts) | Sprites, colors, levels, metadata, sounds and win conditions |

There are two source maps. TypeScript's generated `.js.map` files point back to
`src/` for debugging; npm's new scripts enable those maps. The compiler's
`ruleSources` Map links each executable rule identity to its actual authored
PuzzleScript rule, including cases where one source rule expands into many.
The trace uses that Map when projecting queued commands.

## Execution order and historical exceptions

Movement resolution, player input and level compilation explicitly visit columns
first. Horizontal and InPlace rule matching visits rows first; vertical matching
visits columns first. These orders can affect overlapping writes, random choices,
diagnostics and sounds. `scan-order.ts` expresses them using coordinates rather
than a cell index or memory layout.

Ordinary rule groups apply each rule in order and repeat while a rule changes
state, subject to the iteration limit. There is no failure-counter shortcut.

The compatibility module owns the layout-derived restore calculation and rigid
ownership transitions. Current vanilla keeps the first group that marks a layer;
the old issue #1206 ordinal merge is available only as a research opt-in. The
module also names the historical LHS `randomdir` Up-and-Left interpretation, the
specific self-colliding movement combinations, and the random-direction draw that
rounds to Action.
Compiler and runtime call sites use explicit `vanilla.*` names. Game interfaces
extend compatibility-owned field declarations.

### Quirk switches

| Switch | Current vanilla default | On | Off |
| --- | --- | --- | --- |
| `restoreKeepsMovements` | On | Undo/restart keep movements outside the first storage word per tile | Restoring clears every pending movement |
| `rigidOwnerOrdinalMerge` | Off | Historical issue #1206: overlapping rigid writes can blame a group that never matched | A rigid mark keeps the group that first marked it |
| `lhsRandomDirIsUpAndLeft` | Off | Historical LHS `randomdir` requires Up and Left together | Compile error; remove the whole invalid rule |
| `combinedMovementsStayPut` | On | Up+Down (or all four) is a zero-offset move that collides | Runtime error |
| `uniformCanReachOne` | On | A draw of exactly 1 indexes past the last choice (Action for `randomdir`) | Selects the last choice |
| `columnMajorMovementOrder` | On | Movement and input visit cells column by column | Row by row |
| `lateMovementsCarryOver` | Off | Historical late movement requests stay pending into the next turn | Discarded when the turn ends |

Where vanilla gives a combination no meaning, "off" reports an error instead of
inventing one. Current vanilla diagnoses every movement qualifier in late rules,
including `randomdir`; the carryover research switch does not bypass that syntax
check. Its runtime tests explicitly construct a historical late-rule schedule.
Other error-recovery behavior for malformed source is not switchable.
The compiled game records its `quirks`; hand-built games without the field use
vanilla. `npm --prefix typescript run quirk-impact` replays the recorded corpus with
each switch toggled from its default and lists the games that play differently.
[QUIRKS.md](QUIRKS.md) retains the previous pin's measured results as historical evidence.

The refreshed compiler removes an entire rule when `random` or `randomdir`
appears on its left-hand side. It also drops nonpositive viewport dimensions
after warning, and warns when a solid sprite lists unused extra colors. Parser
visits preserve original spelling through leading comments, keep editor blank
lines and copied states consistent with compilation, and suppress keyword
warnings for single-character aliases and legend names. Speculative AGAIN turns
cannot install checkpoints or emit persistence writes.

A `Cell` records the objects actually present. One object per collision layer is
not an unconditional runtime invariant: accepted source with diagnosed conflicting
writes can produce multiple occupants. The compiler reports those conflicts;
cell transactions apply their additions together. Collision layers still govern
movement blocking. A source-compiled oracle regression preserves this recovery
behavior through undo and restart.

## Verification and compatibility

The [authored semantic guide](../src/tests/semantic-fixtures/README.md) contains
small games and portable `testdata.js` fixtures with hand-specified boards,
random-choice reasoning and sound expectations. Run it with
`npm --prefix typescript run test:semantics`. Historical late-`randomdir` examples
now check diagnosed error recovery. The guide keeps their original provenance
and earlier crash evidence separate from current valid gameplay.

The pinned native oracle lives in [test/vanilla/](test/vanilla/README.md), with its
upstream license and original corpus. This lets the port live in PuzzleScript-labs
while comparing against vanilla. Tests never substitute the labs `src/` engine
for that oracle; production TypeScript and examples do not load native fixtures.

```sh
npm --prefix typescript test
npm --prefix typescript run test:corpus -- --session
```

The refreshed strict suite passes **1,768 tests**. Exact compilation comparison
covers **335 compiler fixtures**, **492 simulation sources** and **99,192 final
executable rules**, including diagnostics, stopping outcomes, authored source
evidence and declaration identities. Full source-compiled replay passes all
**492 games**, **20,076 session observations/operations** and **539 level loads**,
including every recorded input and AGAIN step. All **140 authored fixtures**
also pass, with 370 observations. Independent review found no actionable issues.
The [refresh audit](../docs/superpowers/plans/2026-10-31-typescript-vanilla-refresh.md)
records the authority and verification separately from historical runs.

Historical verification at the previous `5a94bde1` pin: the strict suite passed
**1,749 tests** and complete compilation comparison passed **312 compiler
fixtures**, **478 simulation sources** and **99,076 final rules**. At the original
completion checkpoint, the source-compiled replay passed **478 games**,
**20,034 session observations/operations** and **525 level loads**, including every
recorded input and AGAIN step. The final whole-port review found no outstanding
issues at that checkpoint. Evidence is recorded in the
[completion audit](../docs/superpowers/plans/2026-10-25-typescript-completion-audit.md).
The subsequent compatibility cleanup at that previous pin passed its 1,590-test suite and
targeted source-compiled replays of seven games, with 336 per-move observations
and nine level loads. Its independent review found no actionable issues; the
[cleanup plan](../docs/superpowers/plans/2026-10-25-typescript-compatibility-boundary.md)
records that verification separately from the earlier complete corpus run.

The default session oracle independently compiles the same source and runs that
exact returned game, with native producers disabled. Native decoding supplies
expected observations and identity correspondence only. It compares boards,
movements, complete RNG, commands and sources, sounds, persistence order, full
history, checkpoints, screens and levels after every input and AGAIN step, plus
original fixture expectations. The adapter checks that candidate compilation
leaves both the installed native game and running session unchanged. All 22
native source/test hashes in [oracle-source.json](oracle-source.json) are pinned.
Only test adapters decode native masks.

Compatibility quirks are explicit domain data. The current default fixes rigid
ownership [issue #1206](https://github.com/increpare/PuzzleScript/issues/1206);
the [historical repro report](test/repros/rigid-owner-report.txt) records both revisions.
The port retains the same-shape [movement restoration behavior](test/repros/movement-restore-bug-report.md)
and writable orphan objects from malformed declarations. The restoration report's
old late-`randomdir` source now produces a compiler error. The
[orphan-object recovery note](test/repros/orphaned-object-bug-report.md) records
accepted behavior after a serious reported source error and explicitly labels
its **newly constructed reproducer**, which was not found in an existing game or
corpus. Known malformed-source host-failure boundaries are recorded in the
[orientation recovery report](test/repros/rule-orientations-recovery-report.txt);
this does not claim exact malformed intermediate output outside those boundaries.

The implementation and component review history are in the
[vanilla port plan](../docs/superpowers/plans/2026-10-24-typescript-vanilla-reference.md).
`build/` and `node_modules/` are ignored generated/dependency directories. The
runtime and examples need no npm runtime dependencies once built.
