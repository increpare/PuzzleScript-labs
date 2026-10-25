# Native Source Parser Diagnostics Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then parent-managed spec and quality reviews. Begin after source assets are
> reviewed. Do not dispatch additional agents from this task.

**Goal:** Reproduce vanilla's actual parser diagnostic visits, deduplication,
counts and stopping points while retaining the readable authored source model.
This is the parser boundary of whole-source compilation, not a second executable
rule compiler and not a claim that whole-source diagnostics are finished.

**Architecture:** Keep authored evidence separate from native accepted lexical
values. Factor existing recognition operations where useful rather than copying
the reader into a separate, subtly different grammar. Parser state should name
ordinary concepts: current section, object part, comment depth, accepted names,
sound terms and the current source cursor. Do not reproduce CodeMirror styling,
HTML rendering, globals, masks or generated operations.

**Tech Stack:** Strict TypeScript, numeric enum statuses, SourceDocument and spans,
ordered diagnostic records, simple arrays/Maps/Sets and independent native parser
execution in tests.

## Evidence and scope

Official native revision remains `5a94bde1a5127a3a45306ea28598eba2874d446d`.
The full native 790-test suite passes. All 478 ordinary source structures and
source game data already have independent semantic checks. The joined rule
compiler also passes all 302 existing compilation fixtures that reach rules.
The non-rule data oracle passes all 293 existing compilation fixtures for which
actual loadFile returns a state. Those bounded audits are saved at:

- `/private/tmp/puzzlescript-existing-compiler-rule-audit.json`
- `/private/tmp/puzzlescript-existing-compiler-game-data-audit.json`

Thus an error message difference does not, by itself, justify changing compiled
object/rule/game semantics that already agree. Preserve these checks.

Actual native parser execution, with loadFile's post-token check, emits 268 raw
issue calls and 244 recorded messages across the 312 compilation fixtures. It
stops three sources after the sixth recorded error:

- `cake monster`: line 30, column 6.
- `In the legend, define new items using the equals symbol`: line 93, column 5.
- `can strew dots around the prelude lol #1008`: line 8, column 2.

Raw evidence: `/private/tmp/puzzlescript-native-parser-diagnostic-audit.json`.
These are integration baselines, not current TypeScript diagnostic parity.
Other parser-only snapshot helpers traverse past the stopping points; do not use
those helpers as authority for reached diagnostics or downstream phase execution.

The same actual post-token traversal over all 478 simulation sources yields 265
raw and recorded issues across 104 sources, including 14 errors, with no parser
abort. Evidence is in
`/private/tmp/puzzlescript-native-simulation-parser-diagnostic-audit.json`. The
errors include duplicate declarations and one unexpected sound token; the native
games still run. A nonzero parser error count alone must not reject the game.

One confirmed accepted-value dependency belongs in this task: `title MiXeD`
retains `MiXeD`, but `(prefix)title MiXeD` and `(prefix\n)title MiXeD` both compile
to native title `mixed`. Native's later token visit sees the already-lowercased
physical line. The current authored reader/game-data path retains `MiXeD` in all
three cases. All three actual loadFile calls return states with zero errors.
Bounded sources and results are saved in
`/private/tmp/puzzlescript-leading-comment-metadata-audit.json`. Preserve
authoredValue and spelling while providing the correct accepted compiler value;
do not overwrite the authored evidence. Check the same literal-value boundary
for author/homepage. This does not affect the asset pass's lowercased color values.

The same confirmed visit boundary applies to LEVELS messages: plain
`message MiXeD` retains `MiXeD`, whereas `(prefix)message MiXeD` and a message
reentered after a multiline leading comment have effective text `mixed`, with no
native issues. Keep SourceMessageLevel.authoredText and textSpan as source
evidence, and use its text for the accepted native literal. Obtain that value
from the same lexical walk rather than a separate comment heuristic. This is a
newly constructed check found during parser self-review, not an existing game or
corpus regression; ordinary existing sources and the 293-state audit agree.

## Files and operations

Add `typescript/src/source-diagnostics.ts` for ordinary compiler issue collection.
It must retain raw calls and recorded issues in order, their displayed lines,
severity, urgency and whether they increment the error count. Expose useful small
typed operations, not a generic event bus or stage registry.

Add `typescript/src/source-parser.ts` with `parseSource(source)`, producing the
authored document, raw and recorded native parser diagnostics, error count and
an explicit complete/stopped result. A stopped result includes the actual source
cursor and reason. Use numeric enum tags. Keep the public result small and clear;
avoid several redundant boolean flags for the same status.

Read the existing reader/declaration helpers before choosing factors. Source text,
words, row text and spans remain authored evidence. The full authored document
may be retained after a parser stop, but it must not imply that later definitions
were accepted or that any later compiler phase ran. No downstream compilation is
part of this operation. Preserve the reviewed source reader API for callers that
need authored evidence rather than a native compilation decision.

The existing reader and declaration diagnostics include authored advice and
generic messages. They are not the native parser stream. Do not concatenate them
and call the result vanilla diagnostics, or use their presence as a native abort
flag. A native invalid/checkpoint result comes from actual native-equivalent
visits and counts.

Keep one shared recognition flow wherever practical; do not copy the complete
reader into a parallel grammar solely for diagnostics. A parser-owned accepted-name
table or source cursor may be factored when needed. Preserve native's separate
raw namespaces and lookup priority. Avoid constructing compiled declaration/game
data merely to obtain parser errors or continuing unreachable compiler work after
a parser stop. Existing authored reading and canonical declaration results must
still pass their independent source/data checks.

If a SourceDiagnostic needs an urgency field, add an optional typed field whose
absence means false. Existing `reportedLine` distinguishes an explicit zero,
explicit no-line and the default authored span line. Never invent an invalid span
to imitate native formatting. Keep inline native message content exact for
comparison; browser HTML/console rendering does not belong in the candidate.
Native stream offsets can index a lowercased physical line whose UTF-16 length
differs from the authored line. Use the existing source mapping helpers when
turning that cursor into an authored position; do not fabricate out-of-bounds
SourcePositions to match an effective cursor.

Add `typescript/test/legacy-source-parser.cjs` and
`typescript/test/source-parser.test.mjs`. The adapter independently parses original
text with actual codeMirrorFn token calls. It captures all issue calls and native
recorded diagnostics/counters, checking `errorCount > 5` after EACH token exactly
as loadFile does. Capture the reached cursor and state category. Do not implement
a second native parser or load the game to manufacture expected output.

## Diagnostic collection behavior

- Deduplication compares the message, displayed line and severity exactly as
  native buildErrorHtml/logIssue do. Keep messages with the same text but different
  lines or severity distinct. A non-urgent duplicate is not recorded and does not
  increment the counter. An urgent duplicate is recorded and counts normally.
- `countsAsError` is independent of severity. Native no-line warnings increment
  errorCount; ordinary line warnings do not. Preserve this quirk explicitly.
- The global diagnostic cap is more than 100 recorded issues, not raw visits.
  Preserve the ordered prefix and explicit stopping reason. The parser's separate
  more-than-five-errors check happens after a token visit, not after every issue
  and not at end of line. Multiple issues emitted in one visit are all reached
  unless the global cap itself stops that visit.
- Return semantic records, not HTML strings or mutable global logging state.
  Test-only formatting may compare native recorded strings with their lines.
  Deduplication must still distinguish all native formatting-relevant fields.

## Parser behavior to compare

Use actual native branches, rather than a list of fixture-name exceptions:

1. Comments, unmatched closes, comment continuations, trailing material after
   headings/separators, section order, repeated sections and missing headings.
2. Prelude keyword recognition, prefix/punctuation recovery, accepted values,
   duplicate value warnings with prior source lines, flag parameters, metadata
   comments and YouTube's warning. Preserve authored case-sensitive literal values
   separately from accepted values after a leading-comment continuation, as above.
3. Object primaries/aliases, keyword names, duplicate registrations, accepted
   color chunks, sprite row acceptance and out-of-range pixel diagnostics.
   Reuse reviewed assets lexical evidence; do not overwrite authored values.
4. Legend token/EOL checks, missing equals/operators/operands, mixed AND/OR,
   source-ordered names, duplicate/self/repeated references, keyword warnings,
   aggregate/property cross-kind recovery and exact prior-line references.
5. Sound name snapshots and token roles, directions, seed recognition, bad/trailing
   tokens, retained versus discarded records, whitespace and comments. Keep SFX
   syntax warning membership consistent with the reviewed rule compiler.
6. Collision layer recognition, undeclared/aggregate names, punctuation,
   background restrictions and ordered duplicate-layer warnings.
7. Rule high-level name/bracket recognition and captured compiler text. The
   existing rule syntax/compiler still owns its later diagnostics; do not emit
   those a second time during parsing.
8. Win-condition token positions and name checks; level message prefixes,
   comment handling, glyph recognition, blank levels and ragged-row warnings.

## Test-first implementation sequence

- [x] Add a native-backed missing API test and observe RED before implementation.
- [x] Implement issue collection with deliberate tests for same/different lines,
  severity, urgency, warning counts and the 100-record cap. Compare actual native
  log functions rather than a handwritten expectation alone.
- [x] Compare source parser visits incrementally by the eight ordinary concepts
  above. Keep the existing authored preservation, assets, declarations and rule
  syntax suites green as shared recognition is factored.
- [x] Compare all 312 original compilation sources: exact raw diagnostics,
  recorded diagnostics, error counts, stopping category and cursor. Require the
  audited 268/244 totals and three reached stopping points.
- [x] Compare all 478 simulation sources' parser diagnostics and completion
  results independently. Require the audited 265 raw/recorded issues, 14 errors
  and no parser abort; do not guess that the ordinary corpus has no diagnostics.
- [x] Exercise parser-limit reachability and multiple issues in one visit with
  small constructed sources, clearly labelled as new tests. Ensure the parser
  API does not invoke any native parser/compiler/gameplay producer in candidate
  execution. Freeze inputs where meaningful and reject changed diagnostics,
  dedup rules, counts, stopping positions and incorrectly reached later visits.
- [x] Strict build; relevant reader/declaration/assets/rule syntax/parser tests;
  full npm test; whitespace and pinned native hash checks. Self-review and commit
  only owned files. Obtain independent spec then quality review.

## Reviewed checkpoint

Implementation 13f106f6 passes the full strict 1,477-test suite. The sole quality
finding was a missing oracle assertion for stopped cursor offsets. Test-only
fix ad6f8e5e independently derives the authored offset, validates bounds and
rejects negative, incorrect in-bounds and out-of-bounds corruption. RED was
observed before the fix; both reviewers freshly pass strict build and all 35
parser checks afterward. Both spec and quality reviews approve the bounded task.
The initial fresh spec review also passes 279 retained component checks, including
#1206/orphan behavior. All 21 pinned native hashes and whitespace checks pass.

Implementation evidence: `/private/tmp/typescript-source-parser-final-full-test.log`,
`/private/tmp/typescript-source-parser-offset-{red,green}.log`,
`/private/tmp/puzzlescript-parser-shared-rules-audit.log` and
`/private/tmp/puzzlescript-parser-shared-data-final-audit.log`.

Next: integrate non-parser compiler diagnostics at their actual reached boundaries
and build the complete source-to-game API. Native's later errors do not reuse the
parser's five-error stopping rule. Preserve group/rigid → win/layering/metadata →
loop → sound/display order, then add the source-to-trace command and final complete
source-compiled runtime corpus gate.
