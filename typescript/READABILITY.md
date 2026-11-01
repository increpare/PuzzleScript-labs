# Reading the engine through small games

This audit follows newly authored interaction fixtures through production code.
Boards are the manifest's readable rows. `Action` is input `4`; `tick` is null.
Session cases include AGAIN turns drained by the host. Behavior uses vanilla
`57f9f6cb` and `vanillaQuirks`.
[Cell.objects and Board.rows](src/model.ts#L40) hold object Sets in ordinary rows;
movement requests separately name a position, collision layer and Movement.

## 1. A local property is a predicate; a transported property is inferred

[local-property-overlap.ps](../src/tests/semantic-fixtures/interaction-matching/local-property-overlap.ps)
uses `Item = Red or Blue`, with both members on one collision layer:

```puzzlescript
right [ Item no Mark | Item no Mark ] -> [ Item Mark | ]
```

Its [manifest](../src/tests/semantic-fixtures/interaction-matching.json) says
`rbrbP` → tick → `R.R.P`; capitals add Mark. The two Item predicates can match
different members. [resolveObjectSource](src/rule-object-sources.ts) selects
the corresponding LHS cell for each RHS property use. Separately,
[expandRuleProperties](src/rule-properties.ts) leaves these single-layer local
properties as predicates. [lowerRules](src/rule-lowering.ts#L41) records their members in
`anyObjects`; [matchesCell](src/matching.ts) requires one at each cell.
The RHS keeps the first member, adds Mark, and empties the second cell.
Removing x1 invalidates the x1–x2 pair; x2–x3 still applies.

Contrast [unique-multirow-transfer.ps](../src/tests/semantic-fixtures/interaction-matching/unique-multirow-transfer.ps):

```puzzlescript
right [ Item Origin ] [ Target no Item ] [ action Player ] -> [ Origin ] [ Target Item ] [ Player ]
```

| Operation | Manifest row |
| --- | --- |
| Load | `b.r.ttP` |
| Action | `b.s.RtP` |
| Action again | `s.s.RBP` |

Here lowercase colors also contain Origin; `s` is bare Origin, `t` bare Target,
and uppercase colors contain Target. Source analysis resolves RHS Item at
`{rowIndex: 1, cellIndex: 0}` to the sole LHS Item at
`{rowIndex: 0, cellIndex: 0}`. It does not choose Red or Blue.
Rule construction then emits Red followed by Blue in property-member order;
each variant records the member selected at that source cell and supplies it
to the linked RHS use.
This is compile-time inference, not a runtime variable shared by every Item.
[matchTuples](src/matching.ts) combines independently located bracket rows.
The first successful tuple removes Player's action request; live rechecks reject
the remaining tuples, so Red transfers before the spatially earlier Blue.

The resolver has three outcomes:

| Result | Data carried |
| --- | --- |
| Resolved | One source cell, preferring the corresponding cell |
| Missing | No source cell |
| Ambiguous | The distinct candidate source cells, in order |

It receives candidate addresses and the target address, without layers or member
values. Repeated terms in one cell count once; equal cell indices in different
bracket rows remain distinct. Two sources choosing Red still cannot supply a
unique remote Item. Different property names also retain distinct identities
even when their member lists are equal.

In `rule-properties.ts`, negative properties are expanded before source analysis;
random-object terms supply no source. `analyzePropertyUses` records the source
cells once by property name and resolves RHS relationships in authored order.
The existing layer analysis and remote uses then determine which properties
need concrete choices. A FIFO pending queue branches at the first eligible
property site; completed variants record per-cell selections in that order.
`constructRightSide` uses those selections and source links once, preserving a
local predicate when no member was selected. There are no first-member/count
summaries or runtime bindings. Missing/Ambiguous uses are diagnosed only after
expansion, since an empty branch can erase a whole rule family first.

RHS construction relies on the final declaration vocabulary having expanded
property-to-property member references. This holds for terminating native
normalization, including the pinned source/error corpora; it does not assert
meaning for fabricated cyclic dictionaries where native normalization hangs.
Movement inference remains a separate pass with its own evidence scopes.

Movement choices are enumerated once per concrete assignment. In
`[ horizontal Player | vertical Crate ]`, they are Left/Up, Right/Up, Left/Down,
Right/Down. The last cell's choices surround the earlier cell's choices; within
one cell, families retain term order. Vanilla reaches the same four survivors by
generating eight interleaved expansion histories and keeping their last copies.
`chooseCellMovements` finishes one cell's families; `expandRuleMovements` visits
cells from last to first. There is no history queue or early merge across source
inputs. The [derivation and oracle boundary](../docs/superpowers/plans/2026-11-01-direct-movement-choices.md)
distinguish concrete choices from those redundant histories.

## 2. Two ellipses record distances, then writes use the live board

[two-ellipsis-relay-live.ps](../src/tests/semantic-fixtures/interaction-matching/two-ellipsis-relay-live.ps)
transports the same inferred Item through a consumable Relay:

```puzzlescript
right [ Item Origin | ... | Relay | ... | Target no Item ] -> [ Origin | ... | Spent | ... | Target Item ]
```

| Operation / level | Manifest row |
| --- | --- |
| Load / 0 | `rbkttkttP` |
| Tick / 0 | `ssxRtxBtP` |
| Tick / 1 (`rbktt.ttP`) | `sbxRt.ttP` |

`k` is Relay and `x` is Spent. [findMatches](src/matching.ts) records a start
coordinate and ordered gaps in each [RowMatch](src/rule-model.ts#L26). Recursive
loops enumerate the first gap before the second, each from zero upward. Red at x0
uses relay x2 and target x3, gaps `[1, 0]`; its write clears the source, spends x2
and fills x3. Blue must use relay x5 and target x6, gaps `[3, 0]`.

[tryApplyRule](src/rules.ts) finds candidates once per rule invocation.
[applyRuleAt](src/rules.ts) checks later tuples with
[matchesRow](src/matching.ts) against the current state before writing.
Both use [recordedRowCells](src/rule-path.ts) to visit concrete pattern cells
through the recorded gaps. Search remains in `findMatches`; the recorded walk
does not search again. Replacement consumes that walk lazily, passing each live cell to
[applyCellEdits](src/replacement.ts#L24). A recorded source, relay or endpoint
may no longer qualify. With one relay, Blue stays stranded despite unused targets.
This ordering is language execution logic, not a storage compatibility exception.

Rechecking validates the origin and complete gap tuple before walking. Unchecked
replacement retains the component API's recovery behavior: it ignores unused
gaps, permits negative/fractional gaps, and reports a missing gap only when the
walk reaches it. A preceding replacement error therefore still comes first.

## 3. Rigid retry restores objects, while the random stream advances

The decisive lines of [rigid-again.ps](../src/tests/semantic-fixtures/interaction-session/rigid-again.ps) are:

```puzzlescript
[ action Player ] -> [ right Player right Running ] again
rigid right [ Player Target Running ] [ Crate ] -> [ Player Target Running ] [ right Crate ]
[ Player Target Running no Done ] -> [ Player Target Running Done random Color ]
late [ Player Target Done ] -> checkpoint sfx0
```

Its [manifest](../src/tests/semantic-fixtures/interaction-session.json), with seed
`split-colors-5`, gives `PT. / C#.` → Action → `.R. / C#.`. Here `/` separates
rows; `R` contains Player, Target, Running, Done and Red. Undo returns
`PT. / C#.`; restart after that undo returns `.R. / C#.`.

Action moves Player and Running onto Target. In the no-input continuation,
[resolveMovements](src/movement.ts#L90) finds Crate blocked by Wall on their
shared layer, bans the rigid mark's group, and requests retry.
[restoreForRigidRetry](src/turn-rules.ts) restores the post-input `retrySnapshot`,
retaining bans, failure sounds, the latest message and **current RNG**. Command
entries are discarded; diagnostics accumulate outside the retry state.
The color rule runs again; failed-attempt
creations are discarded. Late rules follow successful movement resolution.

The four draws select Red, Blue, Red, Red. With the current
[`againProbeHasSideEffects`](src/compatibility.ts#L15) policy, the probe consumes
the first two draws and restores its board; the real continuation consumes the
next two and commits Red. Only that actual creation (731) and sfx0 (730) play.
This speculative RNG consumption is a compatibility quirk. The prepared-AGAIN
optimization remains useful: [sameRuleInput](src/prepared-again.ts) rejects this
probe's result because RNG has advanced. With a compatible input it reuses the
rule result, while history and effects still execute at commitment.

## 4. A checkpoint guard and a retained restart history entry differ

[dead-probe-checkpoint.ps](../src/tests/semantic-fixtures/interaction-session/dead-probe-checkpoint.ps):

```puzzlescript
[ action Player ] -> [ right Player right Running ] again sfx0
[ stationary Player Running ] -> checkpoint sfx1
```

Its manifest says `P..` → Action → `.Q.` → restart → `P..`, with only sound 760.
`Q` contains Player and Running. The probe queues checkpoint and sound 761 but
changes no objects. [observeProbe](src/session.ts) handles that observation
without ordinary command audio or checkpoint persistence. Checkpoints belong to
`finishTurn`, so even a quiet probe leaves the saved restart state intact.
This separation preserves the fixed pinned revision's behavior.

[again-restart.ps](../src/tests/semantic-fixtures/interaction-session/again-restart.ps)
instead checkpoints the pre-color board, draws a color in the continuation and
uses `late [ Red ] -> restart sfx0`. At the same seed its manifest says:

| Operation | Manifest row |
| --- | --- |
| Load | `PT.` |
| Action, including AGAIN | `.B.` |
| Undo once | `.Q.` |
| Undo twice | `PT.` |

Here `Q` contains Player, Target and Running; `B` also adds Done and Blue.
The Red probe's restart branch in `observeProbe` adds history even though the
probe does not call [restart](src/session.ts). Its later modified-board branch
adds then pops another snapshot through [undo](src/session.ts), leaving
the first one. The actual second draw commits Blue and plays creation 752.
Retained probe history and forbidden probe checkpoints are distinct policies.
The manifest's undo operations explicitly ignore duplicate boards.

## 5. A calculated turn can be inspected now and finished later

[TurnInput](src/model.ts) names None, Up, Down, Left, Right and Action.
`None` adds no player instruction; early rules, movement resolution, rigid retry
and late rules still run. Object movement remains a separate enum.

[calculateTurn](src/turn-rules.ts) is the complete simulation. Its flat
`CalculatedTurn` records input, resulting execution, player sites, retry counts
and diagnostics. It contains ordinary objects, movements, RNG, queued commands
and sound evidence, with no session history or saved checkpoint. The
[turn example](examples/turn.mjs) uses `TurnInput.Right` to produce `PC.` → `.PC`.
The original Movement|null component/session entry points remain adapters.

In [session.ts](src/session.ts), `beginTurn` chooses a reusable calculation or
calculates afresh. `installCalculation` snapshots the still-current board,
installs the result and reports diagnostics. `finishTurn` then visibly handles
required player movement, cancel, restart, board/history, audio/message, victory,
checkpoint and AGAIN in order. `WinHandling.ReportOnly` reports suppressed wins;
it does not disable victory checks.

For a deterministic walking rule which queues AGAIN:

```text
Action:  calculate x0 → x1; finish x1
         prepareAgain calculates None: x1 → x2
         observeProbe decides to continue; public board stays at x1
Tick:    validate and copy the prepared x2 calculation; finish x2
         prepare the following continuation
```

`prepareAgain` calls the same simulation through `beginTurn`, then explicitly
observes it. It never recursively calls the general turn entry point. The
vanilla policy observes on the live workspace; the private policy observes on
its own workspace and publishes diagnostics only. The earlier RNG/history
examples explain why observation can change the live workspace in vanilla.

[prepared-again.ts](src/prepared-again.ts) owns the private WeakMap association,
complete ordered-input checks and copied results. Only the public session API
looks up/retains that association. The working session carries its pending
record explicitly. A deterministic 100-turn chain needs 101 calculations;
private random preparation also reuses its draw, while vanilla's changed random
input requires the existing reevaluation path.

The additional [session witnesses](test/session.test.mjs) alter viewport/history,
restart target and win context after preparation. Actual commitment reads those
current values, while reusing only simulation. They also cover non-null public
probes, quiet natural victory and Cancel taking priority over Restart.

## 6. Recovery, severity and stopping are separate

`[ Player ] ] -> [ Player ]` has a warning and is discarded.
`[ > up Missing Player ] -> [ Player ]` has errors and is retained.
[RuleRecovery](src/rule-recovery.ts) describes Keep, Discard(cause) and
KeepForDiagnostics(causes), independently of severity. Pattern rules have one
structural kind. Every cause is the original diagnostic object from the syntax
issues, preserving source evidence and report order.

For `right [ Player | Crate ] -> [ Player ]`, the shape problem carries row
index zero, left cell count two, right count one, and the exact spans of the two
brackets. The legacy diagnostic still reports the whole line. Syntax recovery
retains this rule for early checks; compilation blocks after aggregate expansion,
before synonyms. A movement ambiguity instead blocks after property/spawn
analysis, so those later diagnostics still appear.

[RuleExpansionResult](src/source-rule-compiler.ts) distinguishes Ready atomic
rules from Blocked(checkpoint, causes). The complete compiler exposes the same
failure directly on `outcome.failure`. The [error example](examples/errors.mjs)
prints both bracket locations and `AfterAggregateExpansion` from data rather than
parsing the message.

Property and movement problems expose their exact RHS target and LHS candidate
locations. Property inference retains Resolved/Missing/Ambiguous source data.
Movement inference keeps same-entity source cells separate from family events:
two different entities in one cell are two family events. Candidate coordinates
refer to the oriented rule at the reporting pass; authored spans still point to
the original text. Empty branches suppress property diagnostics as before.

The [recovery inventory and validation](../docs/superpowers/plans/2026-11-01-rich-rule-errors.md)
cover warning/error independence, predecessor grouping, cause identity, limits,
first movement/last property selection and strict native parity.

## Frontend reading path

Rules have one authoritative parse: [rule-lexing.ts](src/rule-lexing.ts)
scans source-mapped tokens, [source-rules.ts](src/source-rules.ts) builds the
recovered source tree, and [rule-syntax.ts](src/rule-syntax.ts) validates/projects
that tree without reading rule text. [rule-frontend.test.mjs](test/rule-frontend.test.mjs)
blocks text access during compilation and changes a parsed row to verify that
the compiler consumes it. The native syntax/compiler corpora guard recovery,
grouping, contextual names, Unicode evidence and diagnostic timing.

Declaration registration, expansion and layer membership now live in
[source-declarations.ts](src/source-declarations.ts), outside the source walker.
Its numeric declaration union gives aliases a target, properties alternatives,
and aggregates constituents. A separate expansion union makes unknown names
explicit. Source registration and expansion deliberately use different precedence
orders, and the source walker receives immediate diagnostics at its cursor.
[source-declarations.test.mjs](test/source-declarations.test.mjs) checks that
language behaviour; [source-declaration-types.test.mjs](test/source-declaration-types.test.mjs)
checks that invalid payloads fail TypeScript compilation.

`prepareDeclarations` now consumes `document.acceptedDeclarations` directly.
Accepted objects own independent colors and sprite rows; bound aliases retain
their accepted owner, even when malformed authored grouping disagrees. Raw object
asset mirrors and compiler legend recovery are removed. Final compiler name
normalization remains a separate named operation because it has different
replacement and member-order rules. Guards include
[accepted-declarations.test.mjs](test/accepted-declarations.test.mjs),
[accepted-declaration-oracle.test.mjs](test/accepted-declaration-oracle.test.mjs)
and [accepted-object-oracle.test.mjs](test/accepted-object-oracle.test.mjs).

The audited frontend boundaries are tracked in the
[completion checklist](../docs/superpowers/specs/2026-11-01-frontend-clarity-goal.md).
[source-scan-state.ts](src/source-scan-state.ts) now gives each section its own
named phase vocabulary and required sound payloads. The walker separates physical
initialization, comment resumption and native line finalization, without a shared
counter or sound-token history. Heading predecessors are explicit language
relationships. [scanner-states.test.mjs](test/scanner-states.test.mjs) checks the
native recovery paths; [source-scan-state-types.test.mjs](test/source-scan-state-types.test.mjs)
rejects mixed section phases and missing payloads.

[source-sound-syntax.ts](src/source-sound-syntax.ts) and
[source-win-syntax.ts](src/source-win-syntax.ts) now carry actual accepted definitions.
Sound phases carry partial typed definitions; native EOL visits decide retention.
Win recovery consumes the native physical capture once. The reader binds tokens,
and compilation consumes these definitions without interpreting raw words.
Incomplete heads, recovered seeds and Everywhere/Named targets have explicit
types. Both authored heading checks require logical SOL, so hiding an unmatched
close cannot change ownership or discard accepted sounds.
Guards include [sound-win-syntax.test.mjs](test/sound-win-syntax.test.mjs),
[sound-win-syntax-oracle.test.mjs](test/sound-win-syntax-oracle.test.mjs) and the
negative [type contract](test/sound-win-syntax-types.test.mjs).

Rule vocabulary properties now carry `alternatives` plus an explicit
`PropertyLayerAnalysis`, rather than an array coupled to a second map. Five
numeric cases distinguish one layer, unlayered, multiple layers, unresolved and
empty. Consumers handle their own recovery cases, so unlayered inference cannot
silently become valid layer-zero lowering. Guards include
[property-layer-types.test.mjs](test/property-layer-types.test.mjs), declaration
and property semantic checks, and independent oracle controls for false layers,
wrong classifications and unresolved reference order.

Rule stages now distinguish source, oriented and atomic qualifier domains.
Movement success is statically lowerable; invalid movement retains families for
property diagnostics. Generic property/spawn/duplicate helpers preserve the
useful guarantees, without pretending all names become concrete. Explicit
covariant readonly collections enforce the nested boundaries. Guards include
[rule-pass-types.test.mjs](test/rule-pass-types.test.mjs),
[rule-pass-contracts.test.mjs](test/rule-pass-contracts.test.mjs) and native
compiler tests of the movement→property→spawn continuation before abort.
Lowering no longer silently ignores unsupported qualifiers.

The retained transformations and their observable behavior are documented in
[FRONTEND.md](FRONTEND.md). The final audit records those semantic witnesses and
the explicit domain boundaries. The
[traversal audit](../docs/superpowers/plans/2026-11-01-traversal-clarity.md)
records the subsequent property-source collection, explicit expansion queues,
movement evidence queries, shared recorded-row walk and named rigid restoration.
The later direct-choice audit replaces movement's history queue with concrete
assignment enumeration; property expansion retains its own queue.
The two-ellipsis-relay-live and cross-layer-row-overlap fixtures guard live reads
and ordered writes; component tests also preserve checked/unchecked gap behavior
and lazy error order. Rigid-again, rigid-checkpoint and rigid-cancel guard the
distinction between attempt rollback and later session restoration.
