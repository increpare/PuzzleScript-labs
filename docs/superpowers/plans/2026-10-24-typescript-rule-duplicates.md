# Rule Duplicate Normalization Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then spec and quality reviews. Begin after property/spawn inference and the
> planned vanilla runtime surface cleanup are reviewed.

**Goal:** Preserve native duplicate normalization and its random candidate weights
through direct comparisons of ordinary rule records.

**Architecture:** Scan each contiguous source-group block backward, keeping the
last equal variant. Compare typed fields directly; no printable-string cache,
hash key, mask or pruning machinery is needed. Preserve surviving rule identities.

**Tech Stack:** Strict TypeScript, OrientedRule records, numeric qualifiers,
ordinary ordered arrays and command data.

## Files and API

- Create `typescript/src/rule-duplicates.ts`:

  ```ts
  export function normalizeRuleDuplicates(
    rules: readonly OrientedRule[],
  ): readonly OrientedRule[];
  ```

- Add `typescript/test/legacy-rule-duplicates.cjs` and
  `typescript/test/rule-duplicates.test.mjs`.

## Native equality and ordering

Native cacheRuleStringRep/printCellRow/removeDuplicateRules are the authority.
The cache is test-only; the candidate compares the meaning those functions encode.

- Compare source physical line number, late/rigid/random flags, ordered LHS/RHS
  row/cell/term structure and ordered commands. Message text and sound index are
  significant; do not compare just command kind.
- Compare direction ONLY when ANY LHS row has more than one cell. Relative
  qualifiers alone do not make direction participate in duplicate identity.
- Compare each term's qualifier and name, except native printing omits the name
  when the qualifier is Ellipsis. Preserve that exception explicitly. Root's
  native probe `[> ... Player]->win` recovers Forward/name `...` followed by
  Ellipsis/name `player`; malformed ellipsis terms can therefore have real
  differing names before lowering discards them. Do not assume the names agree.
- Origins, authored source object identity and private inference evidence do not
  distinguish variants. Surviving records must retain their original identities.
- Reset comparisons at each contiguous sourceGroup boundary, matching native's
  backward scan. Keep the LAST equal variant and return survivors in original
  forward order. Separate source lines remain distinct candidates even under `+`.
- Do not sort terms/members, compare sets, remove impossible rules or repeat
  early-negative cleanup here. This is a semantic normalization before lowering.

## Test-first sequence

- [x] Observe a missing API/native-backed test fail before implementation.
- [x] Native oracle independently parses original source and runs its full rule
  expansion through movement/property/spawn inference, then snapshots records,
  caches native printable representations and removes duplicates. Candidate runs
  typed preceding stages independently and invokes this pass under native producer
  guards. Freeze inputs and check exact outputs and selected-record identities.
- [x] Cover repeated selectors, equivalent reversed orientations, one-cell versus
  multi-cell direction identity, several single-cell rows, flags and commands.
- [x] Cover duplicate property/aggregate members, duplicate movement paths,
  property aliases, repeated ordered terms, origins and differing source lines.
- [x] Check the malformed Ellipsis/name exception with actual source input where
  possible and explicitly labelled independent stage-boundary edits otherwise.
  Keep malformed source failure probes in bounded child processes.
- [x] Test backward keep-last and contiguous-group boundaries using independently
  constructed native/candidate boundary fixtures; do not derive native records
  from the candidate or treat artificial fixtures as source corpus evidence.
- [x] Re-run the random-weight precursor with Player/Wall/Crate on one layer:

  ```text
  random horizontal [Player no Wall|Player no Crate]->message row
  + [Player]->message single
  ```

  Concrete positives lose the negatives early and normalize to one two-cell row
  variant; positive AliasPlayer retains negatives before synonym substitution and
  keeps two different row variants. On board PP these represent three versus four
  application candidates including the single-cell rule. Assert retained ordered
  rules now; full source-to-session random traces remain a later integration gate.
- [x] Deliberate corruptions must detect keep-first, global versus contiguous
  group scope, set-based term equality, direction always/never compared, ignored
  command payload, treating Ellipsis names as significant, mutation and native calls.
- [x] Compare all 478 simulation sources after every typed preceding stage, with
  exact survivor counts, order, source/group/flags/commands and preserved evidence.
- [x] Strict build, focused preceding/new tests, full npm test, whitespace check.
  No native source/hash changes or long gameplay replay rerun at this stage.
- [x] Obtain spec then quality approval and commit the bounded pass.

Next: validate/lower named rules into direct object predicates and cell edits,
then form surviving early/late groups, rigid ownership and loop schedules.

## Reviewed checkpoint

Implementation `7165e1fb` passed independent spec and quality reviews. The
complete package passed 1,154 tests, including 62 new duplicate tests. Spec
review freshly passed strict noEmit, emitted build and all 456 focused compiler
tests. Quality review freshly emitted to a temporary tree and passed all 62
new tests. All 478 source pipelines match exactly: 106,273 spawned variants
become 99,448 ordered survivors. Native source and all 21 pinned oracle hashes
remain unchanged. The implementation uses direct ordered comparisons and a
backward contiguous-group scan, preserving survivor identities without caches.
