# Source Rule Syntax Recovery Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then independent spec and quality review in the vanilla port worktree. Begin
> after the rule lexical view is reviewed.

**Goal:** Independently recover effective rule syntax, commands, source groups
and loop markers, including native invalid-source recovery.

**Architecture:** Preserve the authored AST and consume its explicit compiler
token view with a small state reducer. Temporary state holds the current row,
cell and pending qualifier. Emit immutable ordered named terms rather than raw
alternating strings or runtime object predicates. Orientation and inference are
later passes.

**Tech Stack:** Strict TypeScript, numeric enums, readonly arrays, existing Command
values and SourceDiagnostic records; pinned native syntax functions in tests only.

## Files and types

- Create `typescript/src/source-rule-model.ts` for named compiler terms and syntax.
- Create `typescript/src/rule-syntax.ts` for `recoverRuleSyntax`.
- Append `SourceDiagnosticPhase.Rules` in `typescript/src/source-model.ts`.
- Add `typescript/test/rule-syntax.test.mjs` and test-only
  `typescript/test/legacy-rule-syntax.cjs`.

```ts
export enum RuleQualifier {
  Unspecified, Up, Down, Left, Right, Action, Stationary, No,
  RandomObject, RandomDirection, Horizontal, Vertical, Orthogonal, Moving,
  Forward, Backward, Counterclockwise, Clockwise, Parallel, Perpendicular,
  HorizontalParallel, VerticalParallel,
  HorizontalPerpendicular, VerticalPerpendicular, Ellipsis,
}
export interface NamedRuleTerm {
  readonly qualifier: RuleQualifier;
  readonly name: string;
  readonly origin: SourceSpan;
}
export type NamedRuleCell = readonly NamedRuleTerm[];
export type NamedRuleRows = readonly (readonly NamedRuleCell[])[];
export interface RuleHeader {
  readonly source: SourcePatternRule;
  readonly sourceGroup: number;
  readonly late: boolean;
  readonly rigid: boolean;
  readonly random: boolean;
  readonly commands: readonly Command[];
}
export interface RuleSyntax extends RuleHeader {
  readonly directions: readonly Direction[];
  readonly lhs: NamedRuleRows;
  readonly rhs: NamedRuleRows;
}
export interface RuleSyntaxResult {
  readonly rules: readonly RuleSyntax[];
  readonly loops: readonly SourceLoopMarker[];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly abortsCompilation: boolean;
}
export function recoverRuleSyntax(
  document: SourceDocument,
  declarations: ResolvedDeclarations,
): RuleSyntaxResult;
```

Term names remain language identities; do not replace properties with object sets
yet. Map `>` to Forward, `<` to Backward, `^` to Counterclockwise and `v` to
Clockwise. Retain Ellipsis as an explicit named term in this intermediate stage,
including malformed pairings. Each term's origin covers its authored evidence.

## Test-first sequence

- [x] Observe a failing API test before implementing the types/reducer.
- [x] Compare ordinary syntax with native `processRuleString`, using the final
  SOUNDS membership snapshot derived from `firstDeclarationWords`, and the
  independently normalized rule property-name namespace.
  Cover all prefix directions/families, default Up/Down/Left/Right, repeated
  selectors, flags and command order. A nondirectional rule keeps only its first
  selector; rows of multiple LHS cells or relative qualifiers on either side
  make it directional. Do not reverse rows yet. Moving includes InPlace; action
  alone is not an accepted orientation prefix. Preserve header interpretation
  order, including rejected relative prefixes and native internal axis-family
  names accepted by its direction aggregate table.
- [x] Group `+` rules by the previous non-null ordinary syntax result's source
  group. Flags do not inherit. Loop markers do not replace that previous rule.
  Preserve sequential `random +` versus `+ random` diagnoses and non-null rules
  with no directions as possible group predecessors.
- [x] Add failing recovery cases and emit these exact effective cells:

  | Source fragment | Effective syntax |
  | --- | --- |
  | `[ > up Player ] -> [ Player ]` | Ignore second qualifier; Forward Player |
  | `[ > Missing Player ] -> [ Player ]` | Ignore unknown word; Forward Player |
  | `[ > \| Player ] -> [ Player ]` | Diagnose pipe without flushing pending qualifier; one Forward Player cell |
  | `late [ > Player ] -> [ > Player ]` | Drop movement qualifiers; nondirectional default Up |
  | `[ Player \| > ] -> [ Player ]` | Drop unfinished final cell; retain earlier Player cell |
  | `[ Player -> Player ] -> [ Player ]` | Ignore inner arrow; retain two Player terms |
  | `[ Player ] -> [ Player win ]` | Retain RHS Player and extract Win command |
  | `[ Player ] -> win [ Player ]` | Retain RHS row and Win command, with warning |
  | `[ Player ] -> [ Player` | Null/rejected syntax result |
  | `[ Player ] -> [ Player ] -> [ Player ]` | Null/rejected at second outside arrow |
  | `[ > ... Player ] -> win` | Terms (Forward,"..."), (Ellipsis,"player") |

- [x] Implement pending-qualifier recovery explicitly. Unknown words, rejected
  second qualifiers, commands and rejected pipes must not clear it. Only closed
  rows enter the result. Retain original AST partial rows and Invalid rules.
  Nested brackets reset current cell but retain previously collected row cells,
  matching native; closing an unfinished cell drops that cell rather than prior
  completed cells. Track bracket balance independently from inside-row state.
- [x] Known names precede command interpretation in body syntax. Test a concrete
  `checkpoint` object versus the Checkpoint command. Convert sound/message/control
  commands to the existing Command union, with message payloads supplied by the
  reviewed compilerMessagePayload helper. Test Unicode-expanded message cursor
  and comment-capture fixtures from the preceding lexical task.
- [x] Derive the compiler's accepted-name membership from registrations before
  its final SOUNDS entry. Native populates `state.names` only on entering SOUNDS;
  the general `firstDeclarationWords` map alone includes too much for malformed
  section order. Without SOUNDS, rule name membership is empty. Test declarations
  after the last SOUNDS (excluded), repeated/later SOUNDS (included even for rules
  captured earlier), and resulting checkpoint-name versus command precedence.
  Preserve final normalized property meanings separately from this membership.
- [x] Unequal bracketed-row counts reject the rule, except command-only RHS.
  Unequal corresponding cell counts set `abortsCompilation`; keep this separate
  from ordinary error diagnostics. Late+rigid diagnoses but retains syntax.
  Exact final diagnostic formatting, abort-count gating and undefined-sound
  warning integration remain the compiler-diagnostics task; do not silently skip
  recovery tests because the native function emitted errors.
- [x] Build a native syntax oracle that records every non-null syntax result,
  source group, ordered term/command values, loop marker and invalid-state flag.
  Compare every retained rule in all 478 simulation sources, plus the explicit
  invalid cases above. Unlike the authored-source oracle, do not filter out
  errorful recovered rules. Guard native parser/compiler/token producer calls
  during candidate reading/resolution/recovery and freeze the authored AST.
- [x] Add deliberate wrong-candidate checks for lost pending qualifiers, changed
  source-group identity, inherited flags, omitted recovered rules and wrong
  message payloads. Run strict build, new focused tests, source/declaration suites
  and then full npm test. No native source/hash changes or full gameplay rerun.
- [x] Obtain spec then quality approval and commit only bounded implementation.

The next pass is `checkEarlyNegativeTerms`, immediately after this result and
before emitting orientation variants. See the vanilla rule semantics contract;
early name-sensitive exclusion removal cannot be postponed to generic dedup.

Implemented in `d51dc519`, with SOUNDS membership correction in `cba706ae`.
Strict build and all 879 package tests pass. Spec and quality reviews approved the
corrected stage; both ran 155 syntax tests, and quality review compared 8,000
additional deterministic malformed token combinations with native recovery.
The oracle compares every recovered rule, including errors, from all 478 sources.
Native property aliases are normalized before syntax diagnostics are observed.
