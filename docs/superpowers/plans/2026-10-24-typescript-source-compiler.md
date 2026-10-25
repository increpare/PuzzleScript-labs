# Whole Source Compiler Implementation Plan

**Status:** Completed and independently reviewed. The final whole-port result is
recorded in `2026-10-25-typescript-completion-audit.md`; this plan retains the
development sequence and evidence from its compiler checkpoint.

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> followed by parent-managed spec and quality reviews. Start after the source
> parser is reviewed. Do not dispatch additional agents from this task.

**Goal:** Compile a complete vanilla source game independently, preserving actual
compiler diagnostics and native acceptance decisions, with readable domain data
and source links suitable for the later standalone command and session oracle.

**Architecture:** Compose explicit language operations in native order. Reuse the
reviewed parser, canonical declarations, assets, rule passes and game data. Split
their existing composed helpers only where the native diagnostic order requires
it. Keep ordinary arrays, Sets, Maps and numeric enum outcomes; do not introduce
a stage registry, masks, generated functions, native calls or optimized indexes.

**Tech Stack:** Strict TypeScript and Node's existing test runner. Native compiler
execution belongs solely in hash-pinned, guarded test adapters.

## Authority and concrete acceptance evidence

Official source remains `5a94bde1a5127a3a45306ea28598eba2874d446d`.
The production JS files are unchanged. TypeScript stays in `typescript/`.
Preserve #1206 and the explicit orphan-object compatibility behavior.

The reviewed independent components already compare all 478 game sources. The
joined rule compiler additionally passes all 302 compilation fixtures that
actually reach native rules. Assets and non-rule data pass all 293 compilation
fixtures for which native loadFile returns a state. Preserve those semantic
checks while integrating their diagnostics.

The actual native compile wrapper has now been audited on all 312 original
compilation fixtures. Only setGameState was stubbed, to observe installation
without executing gameplay or persistence. Actual parser/compiler/logging ran.
Evidence: `/private/tmp/puzzlescript-native-compile-diagnostic-audit.json`.

- loadFile yields 293 formed states, 16 nulls and three parser-cap exits.
- There are 899 raw issue calls and 728 recorded issues, with no exceptions.
- 284 formed states reach setGameState. Nine formed states are declined because
  the final recorded error count exceeds five.
- Five formed states have no levels; compile adds an urgent no-line error:
  `No levels found.  Add some levels!` before its final error-count decision.
- Parser errors alone do not imply failure: the 478 simulation sources contain
  14 parser errors and still run. Do not invent an error-free acceptance policy.

The older loadFile-only evidence has 894 raw calls and 723 recorded issues. It
excludes those five wrapper errors. The stored fixture expectations contain only
548 strings and allow additional messages, so satisfying that subset is not the
exact diagnostic gate. Build a live native adapter and compare all raw visits,
all recorded issues, error counts and outcomes on the original sources.

The same actual native compile audit on all 478 original simulation sources
forms and installs all 478 games, with no exceptions. Its stream has 673 raw
calls, 642 recorded issues and 21 recorded errors in total. Raw phase counts are
parser 265, extra members 7, rulesToArray 255, lowering 143, metadata 2 and sounds
1. The four non-asset extra-member errors are three background layer conflicts
and the existing `a = b and b #393` aggregate overlap. The remaining three are
the already reviewed sprite warnings. Metadata and sound calls are warnings.
Evidence and reproducible scratch audit are saved at
`/private/tmp/puzzlescript-native-simulation-compile-diagnostic-audit.{cjs,json}`.
These are native baselines for the whole compiler, not TS integration results.

## Public operation and source evidence

Create `typescript/src/source-compiler.ts` with `compileSource(source: string)`.
Use the parser result's existing top-level document/rawDiagnostics/diagnostics/
errorCount convention and one numeric-enum outcome union. Distinguish four
semantic outcomes:

1. Accepted: native would install the formed game, even with up to five errors.
2. Declined: a game was formed, but native's final count prevents installation.
3. Invalid: the explicit no-layer or invalid-rule checkpoint returns no game.
4. Stopped: the parser token cap or global recorded-issue cap prevents completion;
   retain the stop reason and the parser cursor when applicable.

Accepted names the compiler's installation decision. It does not promise that
malformed source has a usable level: native can still accept a no-levels state
after emitting its urgent error. Keep that distinction visible in the type name.

Accepted and Declined carry the same formed compilation data: SessionGame,
canonical ResolvedDeclarations, object sprites, palette, display colors,
effective metadata and `ReadonlyMap<ExecutableRule, SourcePatternRule>`. Source
rules must be actual entries in the returned document. Object and rule keys
must be the exact identities used by the returned game. Assets do not give the
orphan object a fabricated authored sprite. Invalid/Stopped do not expose an
apparently usable game. Avoid redundant boolean flags or null fields mirroring
the outcome tags. The caller should be able to narrow one outcome and pass its
game directly to createSession.

Use this small result shape (imports refer to the existing domain modules):

```typescript
export enum SourceCompilationKind { Accepted, Declined, Invalid, Stopped }
export enum SourceCompilationStopReason { ParserErrors, IssueLimit }
export interface CompiledSourceData {
  readonly game: SessionGame;
  readonly declarations: ResolvedDeclarations;
  readonly sprites: ReadonlyMap<GameObject, ObjectSprite>;
  readonly palette: ColorPalette;
  readonly displayColors: {
    readonly backgroundColor: string;
    readonly textColor: string;
  };
  readonly metadata: ReadonlyMap<string, string | Dimensions>;
  readonly ruleSources: ReadonlyMap<ExecutableRule, SourcePatternRule>;
}
export type SourceCompilationOutcome =
  (CompiledSourceData & {
    readonly kind: SourceCompilationKind.Accepted | SourceCompilationKind.Declined;
  }) |
  { readonly kind: SourceCompilationKind.Invalid } |
  {
    readonly kind: SourceCompilationKind.Stopped;
    readonly reason: SourceCompilationStopReason;
    readonly cursor?: SourcePosition;
  };
export interface SourceCompilationResult extends SourceIssueCollection {
  readonly document: SourceDocument;
  readonly outcome: SourceCompilationOutcome;
}
```

Keep source text, authored spelling and source spans unchanged. Effective
metadata and accepted tokens already describe native lexical casing/recovery.
Do not derive semantics from an independently reparsed normalized source.

## Native order to express directly

The orchestration must visibly follow these operations. Native names here
identify evidence boundaries, not a requirement to retain native terminology.

1. parseSource, including its post-token errorCount > 5 checkpoint.
2. Raw accepted-name preflight: player existence, then background existence.
3. No collision layers: emit the native no-line error and return Invalid.
4. generateExtraMembers: palette and object appearance diagnostics, glyph
   aggregate conflicts, ordered legend normalization diagnostics, missing
   assigned objects and default-background checks.
5. generateMasks: player lookup diagnostic; the TS implementation uses ordinary
   object sets and does not generate masks.
6. levelsToArray: grid/message construction and native level diagnostics.
7. rulesToArray: syntax, early negatives, orientation/names, movements,
   properties and spawn intent, with the reviewed invalid checkpoints.
8. Native invalid rules return Invalid here, retaining all earlier diagnostics.
9. Semantic duplicates and direct lowering (rulesToMask diagnostics).
10. Early and late group arrangement, then early and late ellipsis validation,
    then rigid groups and explicit #1206 merge transitions.
11. Win conditions; then the late check for unlayered concrete objects.
12. Effective metadata conversion and screen dimensions.
13. Loop validation and early/late loop scheduling.
14. Sounds; then text/background display color checks and homepage formatting.
15. Wrapper no-levels error, urgent=true, no displayed line.
16. Final count determines Accepted versus Declined. An ordinary warning with
    no displayed line still counts as an error, matching the shared collector.

Do not concatenate resolveDeclarations().diagnostics into this stream. That API
also contains authored advice and parser/late-layer messages with different text
and timing. Factor useful semantic operations and produce each native issue at
its actual boundary. Preflight checks accepted raw namespaces, not whether a
preferred resolved name is usable. Existing source sound-name snapshots remain
authoritative for parser/rule SFX behavior.

Similarly, do not concatenate all compileSourceRules diagnostics before all
compileGameData diagnostics. Win/layer/metadata checks occur between rigid work
and loops. compileGameData currently performs levels, metadata, sounds and win
conditions in a different order. Preserve its existing convenience API while
factoring named operations used by the whole compiler. Preserve compileSourceRules
and compileRuleSchedules as convenience compositions of the same factored work.

Where old data-helper diagnostics duplicate parser-owned messages (ragged rows,
duplicate metadata), prefer removing that duplicate advice and moving its test
assertion to parseSource. Preserve the semantic/recovery test itself. Do not add
a parallel "native diagnostics" mode just to retain obsolete helper wording.
Existing generic sound/win/background messages also differ in punctuation or
capitalization; compare the actual native message bytes, including its trailing
space on unknown win operands. Missing-background grid messages and long level
messages belong to actual levelsToArray behavior, not a blanket validation pass.

All issues enter the shared collector in order, retaining message bytes,
displayed line (including native zero and no-line), severity, urgency and
countsAsError. Deduplicate only by native display identity. Preserve the global
101st recorded issue and stop without exposing later diagnostics or a game.
If a helper would throw after this native stopping boundary, ensure collection
interrupts that helper rather than executing unreachable malformed recovery.

## Files and bounded implementation steps

Likely production files:

- Create `typescript/src/source-compiler.ts` for the public result and explicit
  orchestration.
- Modify `declarations.ts` or add a focused declaration-compilation helper to
  expose the actual extra-members, player-lookup and late-layer diagnostic
  boundaries without rebuilding canonical objects.
- Modify `source-game-data.ts` to expose levels, wins, metadata, sounds and
  restore policies as named operations while keeping compileGameData composed.
- Modify `source-rule-compiler.ts` and `source-rule-schedules.ts` to separate
  rule expansion/lowering, groups/rigid formation and loop scheduling, keeping
  existing compositions and canonical rule identity intact.
- Extend `source-diagnostics.ts` only if immediate global-cap interruption needs
  a small typed reporting operation; no compiler event bus.
- Add `typescript/test/legacy-source-compiler.cjs` and
  `typescript/test/source-compiler.test.mjs`.

- [x] First write the public-operation test and demonstrate RED because
  source-compiler is absent. Use a small source with Background, Player, two
  unnamed collision layers, one movement rule and a grid level. Assert one
  Accepted outcome, canonical object membership, source-rule identity and a
  createSession call using only the returned game.

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource, SourceCompilationKind } from '../build/source-compiler.js';
import { createSession } from '../build/session.js';

const source = `title Clear example
OBJECTS
Background .
Black

Player P
White
LEGEND
SOUNDS
COLLISIONLAYERS
Background
Player
RULES
[ > Player ] -> [ > Player ]
WINCONDITIONS
LEVELS
P.`;

test('compile source to a canonical game with authored rule links', () => {
  const result = compileSource(source);
  assert.equal(result.outcome.kind, SourceCompilationKind.Accepted);
  assert.deepEqual(result.rawDiagnostics, []);
  assert.equal(result.errorCount, 0);
  const { game, declarations, ruleSources } = result.outcome;
  const player = declarations.objects.find(object => object.name === 'player');
  assert.ok(player);
  assert.ok(game.player.objects.has(player));
  for (const schedule of [game.earlyRules, game.lateRules]) {
    for (const group of schedule.groups) for (const rule of group.rules) {
      const authored = ruleSources.get(rule);
      assert.ok(result.document.rules.includes(authored));
      assert.equal(authored.originalLine.span.start.line, rule.sourceLine);
    }
  }
  const session = createSession(game, { seed: 'source example' }, {
    nextLevelSeed: () => 'source example',
  });
  assert.ok(session.state.execution.board.rows[0][0].objects.has(player));
});
```

Run from `typescript/`:

```sh
npm run build
node --test test/source-compiler.test.mjs
```

The initial failure must be the missing source-compiler module/API, before its
implementation. After implementation, the public-operation test must pass before
using this same operation in the native adapter comparisons.

- [x] Add a live native compile adapter. Instrument raw logIssue calls while
  invoking its original body, wrap loadFile only to observe null/undefined/state,
  and stub setGameState solely to observe the final acceptance decision. Keep
  compiling and logger resets exactly native, including wrapper no-levels.
  No gameplay initialization or diagnostic summary HTML is candidate output.

The comparator's projection must include exactly these native logIssue fields:

```javascript
const viewIssue = issue => ({
  message: issue.message,
  line: issue.reportedLine === undefined
    ? issue.span?.start.line ?? null : issue.reportedLine,
  severity: issue.severity,
  countsAsError: issue.countsAsError,
  urgent: issue.urgent ?? false,
});
```

Compare raw and recorded arrays independently. In the native wrapper, append a
recorded issue only if the original logIssue increased errorStrings.length; do
not replace the native deduplication algorithm with the candidate collector.
The native test host's UnitTestingThrow rethrows the global issue-cap exception.
The adapter may classify that exact known stopping condition while retaining its
recorded prefix; rethrow other exceptions. Do not replace loadFile or its parser
with a hand-written traversal to make the whole-compiler comparison pass.
- [x] Add the exact all-312 test and run it RED before implementing ordering.
  Assert 293 formed states, 16 Invalid, three parser-cap Stopped outcomes,
  284 Accepted and nine Declined formed games; raw/recorded totals 899/728.
  Compare each issue and count per source, not totals alone.
- [x] Factor the existing operations and implement compileSource with visible
  sequential calls in the order above. Keep each previously reviewed composed
  helper working by invoking those same factored operations. Reuse one canonical
  declaration result and one set of executable rules throughout.
- [x] Add all-478 source compilation comparisons of complete game semantics,
  canonical assets/metadata, source identity and exact native diagnostics/counts/
  acceptance. Assert all478 Accepted, raw673/recorded642/errors21 totals in
  addition to each exact per-source comparison. This is compiler parity only;
  full per-move replay remains later.
- [x] Add focused original-source tests for a nonzero-error Accepted game, a
  no-layer Invalid game, invalid rules after level diagnostics, a formed Declined
  game, urgent NoLevels, metadata versus loops/sounds/display ordering, and
  immediate global issue-cap interruption. Prefer existing fixtures for these
  boundaries and label any newly constructed input explicitly.
- [x] Prove independence by disabling actual native parser/compiler/engine
  producers during candidate compilation. Freeze candidate inputs where useful;
  reject unknown semantic projection fields. Corrupt one issue, acceptance tag,
  canonical rule field and source-map identity in separate deliberate tests and
  verify the comparator rejects each. Do not silently drop unassigned objects or
  source-less rules to make projection agree.
- [x] Run strict build, focused new/compiler/declaration/data/assets/rule suites,
  then npm test once. Preserve all 21 native hashes and git diff --check. Record
  exact counts, logs, public API, remaining host-exception limits and self-review.

```sh
npm run build
node --test test/source-compiler.test.mjs test/source-parser.test.mjs test/source-game-data.test.mjs test/source-assets.test.mjs test/source-rule-compiler.test.mjs test/source-rule-schedules.test.mjs test/source-oracle.test.mjs
npm test
git diff --check
```

Expected: exact live per-fixture comparisons, all focused/full tests green,
unchanged native hashes and no whitespace errors. Record the real final test
count rather than assuming the previous checkpoint's 1,443 count.

- [x] Stage only explicitly owned production/test files and commit. Parent owns
  this plan, main plan and README; coordinate before any git staging/commit.
  Report DONE with SHA and evidence. Parent then requests independent spec review
  and, only after approval, quality review.

## Completion boundary

This task is complete when both reviews approve independent whole-source
compilation and the exact native diagnostic gate. At this checkpoint, standalone
source-to-trace examples, the source-compiled session oracle and the complete 478
per-move/AGAIN replay were still required. They now pass; see the final audit.

## Reviewed result

Implemented at `a3a971d3`; test-only oracle hardening at `f4592d09` and
`ca4660fe`. Independent spec and quality reviews approve the final checkpoint.
The public compiler remains a direct sequence of language operations; native
parser/compiler/gameplay producers are disabled during candidate compilation.

All 312 original compilation sources match exact native semantics, diagnostics
and outcomes: 293 formed games, 16 Invalid, three parser Stopped, 284 Accepted,
nine Declined, 899 raw calls and 728 recorded issues. All 478 simulation sources
are Accepted, with 673 raw calls, 642 recorded issues, 21 errors and 99,076 final
rules. No source in either corpus throws. The implementation full suite passes
1,494/1,494; later test-only hardening freshly passes 87/87 affected compiler/data
checks, including both complete source gates. All 21 native hashes remain equal.

Oracle regression probes reject unknown tags/fields, malformed source maps,
unassigned executable identities and game data attached to stopped outcomes.
The host-free semantic helper preserves a real installed native session and
returns object/rule correspondence without reloading its host. The final
LevelKind probe rejects 999 at both schema and projection boundaries, while valid
Grid/Message behavior and StartLevel sounds remain correct.

Implementation evidence: `/private/tmp/typescript-source-compiler-full.log`.
Final spec evidence: `/private/tmp/typescript-source-level-kind-spec.j4QVo8/`.
Final quality evidence: `/private/tmp/typescript-source-level-kind-quality.xq3vh4io/`.
The explicit malformed InPlace-relative and empty-aggregate host-failure
boundaries remain documented; this does not claim universal malformed grammar
or intermediate-output equivalence. The later source-compiled session replay and
standalone source-to-trace gates now pass; see the final completion audit.
