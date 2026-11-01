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
different members. [expandRuleProperties](src/rule-properties.ts#L34)'s
`firstSite` leaves a single-layer property local unless transported to another
RHS cell. [lowerRules](src/rule-lowering.ts#L41) records its members in
`anyObjects`; [matchesCell](src/matching.ts#L5) requires one at each cell.
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
and uppercase colors contain Target. `transported` detects the new RHS location.
`expandRuleProperties` emits Red then Blue variants in property-member order;
its single expanded LHS occurrence supplies that variant's member to the RHS.
This is compile-time inference, not a runtime variable shared by every Item.
[matchTuples](src/matching.ts#L112) combines independently located bracket rows.
The first successful tuple removes Player's action request; live rechecks reject
the remaining tuples, so Red transfers before the spatially earlier Blue.

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

`k` is Relay and `x` is Spent. [findMatches](src/matching.ts#L58) records a start
coordinate and ordered gaps in each [RowMatch](src/rule-model.ts#L26). Recursive
loops enumerate the first gap before the second, each from zero upward. Red at x0
uses relay x2 and target x3, gaps `[1, 0]`; its write clears the source, spends x2
and fills x3. Blue must use relay x5 and target x6, gaps `[3, 0]`.

[tryApplyRule](src/rules.ts#L185) finds candidates once per rule invocation.
[applyRuleAt](src/rules.ts#L118) checks later tuples with
[matchesRow](src/matching.ts#L92) against the current state before writing.
It visits pattern cells in order, passing each current cell to
[applyCellEdits](src/replacement.ts#L24). A recorded source, relay or endpoint
may no longer qualify. With one relay, Blue stays stranded despite unused targets.
This ordering is language execution logic, not a storage compatibility exception.

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
[applyTurnRules](src/turn-rules.ts#L71) restores `retrySnapshot`, retaining bans,
failure sounds and **current RNG**. The color rule runs again; failed-attempt
creations are discarded. Late rules follow successful movement resolution.

The four draws select Red, Blue, Red, Red. With the current
[`againProbeHasSideEffects`](src/compatibility.ts#L15) policy, the probe consumes
the first two draws and restores its board; the real continuation consumes the
next two and commits Red. Only that actual creation (731) and sfx0 (730) play.
This speculative RNG consumption is a compatibility quirk. The prepared-AGAIN
optimization remains useful: [sameRuleInput](src/session.ts#L86) rejects this
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
changes no objects. [step](src/session.ts#L280) suppresses probe command audio
and guards `checkpoint(work)` with `options.probe !== true`. No checkpoint or
persistence write is installed. This guard reflects the fixed pinned revision,
including the quiet-probe path that reaches this line.

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
The Red probe's restart branch in `step` adds history even though the probe
does not call [restart](src/session.ts#L161). Its later modified-board branch
adds then pops another snapshot through [undo](src/session.ts#L148), leaving
the first one. The actual second draw commits Blue and plays creation 752.
Retained probe history and forbidden probe checkpoints are distinct policies.
The manifest's undo operations explicitly ignore duplicate boards.

## Prioritized clarity improvements

The frontend now takes priority over the runtime suggestions below. Its first
slice gives rules one authoritative parse: [rule-lexing.ts](src/rule-lexing.ts)
scans source-mapped tokens, [source-rules.ts](src/source-rules.ts) builds the
recovered source tree, and [rule-syntax.ts](src/rule-syntax.ts) validates/projects
that tree without reading rule text. [rule-frontend.test.mjs](test/rule-frontend.test.mjs)
blocks text access during compilation and changes a parsed row to verify that
the compiler consumes it. The native syntax/compiler corpora guard recovery,
grouping, contextual names, Unicode evidence and diagnostic timing.

The next frontend slice should extract declaration registration and semantic
checks from `source-lexical.ts`, keeping section/layout scanning explicit. Rule
vocabulary is now a named input to parsing, which makes that later extraction
possible without reintroducing a second rule grammar.

1. **Name the session probe policy inside `step`.** Extract helpers for rollback
   and commands that name retained history, RNG/events and committed effects.
   Keep the prepared result and full input check. Readers could locate each
   policy without tracing every early return. Guards: dead-probe-checkpoint,
   again-restart, rigid-again, and prepared-AGAIN reuse/random-fallback tests.
2. **Name property analysis before expanding variants.** Give the local predicate,
   transported use and unique inferred source explicit analysis results instead
   of requiring readers to connect `transported`, `firstSite` and `expandedCells`.
   Preserve expansion order. Guards: local-property-overlap and
   unique-multirow-transfer expose the different meanings of repeated Item.
3. **Share fixed-gap coordinate traversal.** `matchesRow` and `applyRuleAt`
   separately advance through a recorded row. A helper yielding pattern indices
   and coordinates would clarify gaps while retaining live reads and ordered writes. Guards:
   two-ellipsis-relay-live and cross-layer-row-overlap protect stale matches and
   multiple writes to the same cell.
4. **Name rigid retry restoration.** A helper in `applyTurnRules` could name the
   restored board/events and retained bans, failure sounds, message and RNG.
   Guards: rigid-again, rigid-checkpoint and rigid-cancel protect the distinction
   between attempt rollback and later session restoration.
