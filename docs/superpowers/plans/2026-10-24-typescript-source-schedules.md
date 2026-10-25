# Source Rule Schedules Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> followed by parent-managed spec then quality review. Begin after direct lowering
> is reviewed. Do not dispatch additional agents from the implementation task.

**Goal:** Form surviving early/late rule groups, rigid compatibility and loop maps
from independently lowered rules and authored loop markers.

**Architecture:** Keep source-group identity through validation, then assign
runtime early/late indices only after overlapping variants have been removed.
Schedules contain ordinary executable rules and Maps. Preserve the known rigid
attribution bug as explicit compatibility data using actual early group indices.

**Tech Stack:** Strict TypeScript, LoweredRule, RuleSchedule, SourceLoopMarker,
ordinary arrays/Maps and existing direct runtime execution.

## API and files

Create `typescript/src/source-rule-schedules.ts`:

```ts
export function compileRuleSchedules(
  rules: readonly LoweredRule[], loops: readonly SourceLoopMarker[],
): {
  readonly early: RuleSchedule;
  readonly late: RuleSchedule;
  readonly rigid: boolean;
  readonly rigidMerges: RuleGame['rigidMerges'];
  readonly diagnostics: readonly SourceDiagnostic[];
};
```

Add `typescript/test/legacy-source-schedules.cjs` and
`typescript/test/source-rule-schedules.test.mjs`. Native arrangeRulesByGroupNumber,
collapseRules, generateRigidGroupList and generateLoopPoints define the behavior.
The native side runs original source through all preceding native stages and
retains raw diagnostics separately at each boundary. The candidate runs only its
typed pipeline with native producers disabled and one canonical declaration result.

## Surviving groups and validation order

- Split early/late rules and collect each by numeric sourceGroup order. Retain
  variant order within each group. Empty groups disappear before assigning any
  runtime index. A group's random policy is its FIRST surviving rule's flag.
- Remove overlapping-layer variants by native's forward deletion process. Keep
  ordered unique overlap name pairs across the WHOLE source group, not separately
  by source line. Before each deletion inspect current adjacent source lines.
  Diagnose when the deleted variant has no same-line neighbour left (or empties
  the group), using native wording and accumulated pair formatting. Preserve the
  first pair, comma/and placement and truncation after the fourth pair with etc.
  Do not validate surviving variants as if overlapping ones never existed earlier.
- Perform this conflict removal for all early groups, then all late groups.
  Only afterwards validate surviving ellipses, early groups then late groups.
- For each row, an ellipsis beyond the second reports the native error. An
  adjacent ellipsis among the first two reports the native warning. The native
  else-if means a third adjacent ellipsis reports the count error only. Retain
  executable rules despite these diagnostics; do not introduce a new abort flag.
- Reuse original commands, objects and pattern data. Construct new executable
  rule records when assigning rigid ownership, preserving their identities within
  schedules and subsequent command source references.

## Rigid ownership compatibility

- Enumerate EARLY surviving groups containing any individually rigid member.
  A non-rigid member of a rigid-containing group still has rigidGroup=null.
  The native lookup is keyed by sourceGroup: apply it to every individually rigid
  early OR late rule, including a late rule sharing an early rigid source group.
  A rigid late rule with no such early mapping receives null.
- rigid is true whenever the early rigid list is nonempty. More than 30 rigid
  groups reports the exact error at the FIRST rule of the 31st rigid group.
  Preserve the maps/records rather than adding an early diagnostic return.
- Preserve issue #1206 exactly. The old engine combined ONE-BASED rigid ordinals
  using binary OR before resolving the result back to an early group. The
  resulting group can be an unmatched third group or absent (null). Candidate
  runtime must continue storing actual early group identities and explicit
  transitions, never packed ownership values.
- Isolate the historical calculation in a clearly documented compiler helper.
  A direct arithmetic recursion makes the compatibility rule explicit without
  bitwise operators or a hidden cell representation:

  ```ts
  function combineLegacyOrdinals(first: number, second: number): number {
    if (first === 0 && second === 0) return 0;
    return Math.max(first % 2, second % 2)
      + 2 * combineLegacyOrdinals(Math.floor(first / 2), Math.floor(second / 2));
  }
  ```

  Call it only with positive one-based rigid ordinals when building the explicit
  map. Resolve combined ordinal minus one through the actual early rigid group
  list, using null when absent. This is an isolated documented bug compatibility
  calculation; no object/movement/cell masks or runtime ordinal ownership appear.
  Keep runtime cell-wide guards, null behavior and retry bans untouched.

## Loops

- Read markers in authored order. At even positions diagnose unexpected EndLoop;
  at odd positions diagnose nested StartLoop. An odd marker count reports the
  native missing-EndLoop error at the last marker, then appends a synthetic closing
  position at that SAME line for schedule construction without mutating input.
- Build early and late loop maps independently. A source group crossing a start
  or end marker reports the exact native middle-of-rule error at the START line.
  The end-boundary test is else-if, so there is at most one such error per group
  per loop. Use current surviving first/last rule lines, not original syntax bounds.
- A group is inside when its FIRST rule line is between the inclusive loop bounds.
  Target the first included group; only the LAST included group gets the backedge.
  Empty loops create no map entry. Preserve overwrites across adjacent/recovered
  loop pairs. Native undefined map slots carry no backedge and can be omitted from
  the ordinary typed Map; compare the semantic maps after omitting those slots.
- Keep diagnostics in native order: marker validation/repair, all early loop
  construction, then all late construction. Preserve physical source evidence.

## Test-first sequence

- [x] Observe a missing API native-backed test fail before implementation.
- [x] Cover numeric source-group ordering, interleaved early/late members, empty
  groups, changing first-survivor random policy and mixed rigid/non-rigid groups.
- [x] Cover ordered conflict pair accumulation across source lines, duplicate
  pairs, partial versus total erasure, truncation and diagnostic sequencing.
- [x] Cover ellipsis counts and adjacency after conflict removal, InPlace rules,
  commands and ordered executable identity.
- [x] Compare every rigid transition for 1 through 30 rigid groups against native
  ownership behavior; include holes in actual early indices, null and third-group
  results, individual late sharing, the limit diagnostic and #1206 source repro.
- [x] Cover adjacent/empty loops, separate early/late members, middle-of-plus-group
  markers, odd/nested/unexpected markers and recovered overwrites.
- [x] Freeze all input; test canonical/source/command identity and independent
  producer guards. Deliberate corruptions must fail on each substantive semantic
  boundary, not merely helper syntax.
- [x] Compare all 478 source fixtures through the complete candidate source rule
  pipeline against actual native schedules, rigid transitions and raw diagnostics.
- [x] Strict build, focused compiler tests and full npm test; whitespace and
  unchanged native hashes. Self-review, commit, then independent spec/quality gates.

Next: integrate source compilation, source assets and exact diagnostic collection,
then run the standalone source-compiled complete differential session corpus.

## Reviewed checkpoint

Implementation 6c794c91 passed independent spec then quality review. Strict build
and the full package pass 1,326 tests. Both reviewers independently passed the
47-test schedule suite, including all 478 sources and all 9,455 actual native
rigid replacement transitions for one through thirty rigid groups. The corpus
matches 99,327 lowered variants -> 99,076 final rules, 11,072 early groups, 4,481
late groups, 75 rigid transitions and 89 semantic loop entries, with zero raw
schedule diagnostics. Focused source and explicitly labeled stage-boundary cases
cover malformed recovery. All 21 pinned native hashes and whitespace checks pass.
Production JS and runtime ownership/guards remain unchanged. The only shared test
adapter change retains native loop markers that the lowering oracle discarded.

Source rule orchestration, complete whole-source diagnostic interleaving, assets,
CLI and source-compiled session replays remain later completion gates.
