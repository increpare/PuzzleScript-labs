# Oriented Rule Names Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then spec and quality reviews. Begin after the early negative pass is reviewed.

**Goal:** Express native orientation, relative movement and aggregate/synonym
expansion as ordered, named rule records.

**Architecture:** Two pure functions turn RuleSyntax into oriented rules, then
expand names without choosing movements or property members. Keep source, groups,
commands and term evidence, including repeated equal variants. No matcher data,
packed representation, inference, pruning or deduplication belongs in this pass.

**Tech Stack:** Strict TypeScript, numeric Direction/RuleQualifier enums,
readonly named terms and existing ordered declaration vocabulary.

## Files and API

- Add `OrientedRule extends RuleHeader` to
  `typescript/src/source-rule-model.ts`, with readonly `direction: Direction`,
  `lhs: NamedRuleRows` and `rhs: NamedRuleRows`. It has one orientation rather
  than the syntax record's list of selectors.
- Create `typescript/src/rule-orientations.ts` exporting:

  ```ts
  export function orientRules(rules: readonly RuleSyntax[]): readonly OrientedRule[];
  ```

- Create `typescript/src/rule-names.ts` exporting:

  ```ts
  export function expandRuleNames(
    rules: readonly OrientedRule[],
    declarations: ResolvedDeclarations,
  ): { readonly rules: readonly OrientedRule[]; readonly diagnostics: readonly SourceDiagnostic[] };
  ```

- Add `typescript/test/legacy-oriented-rules.cjs` and
  `typescript/test/oriented-rules.test.mjs`.

## Native contract

1. Emit every syntax selector in order, including repeated selectors and InPlace.
   Directionality was decided before early negative removal; never decide again.
2. Resolve relative movement on both sides using that original orientation.
   Right maps `^ v < >` to Up Down Left Right; Up maps to Left Right Down Up;
   Down maps to Right Left Up Down; Left maps to Down Up Right Left.
   Parallel becomes HorizontalParallel for Left/Right and VerticalParallel for
   Up/Down. Perpendicular becomes VerticalPerpendicular for Left/Right and
   HorizontalPerpendicular for Up/Down. Keep these distinct from ordinary axis
   families for subsequent inference. Retain all other qualifiers verbatim.
3. If any LHS cell's FIRST term has name `...`, retain Up/Left and row order.
   Otherwise change Up to Down or Left to Right and reverse each LHS row plus
   its corresponding RHS row if present. Do not reverse extra unmatched RHS rows
   or relative movements a second time. Native checks the first term name, not
   any ellipsis qualifier anywhere in the cell; malformed cases retain this rule.
4. Expand aggregate names on both sides, using ruleNames.aggregates. Replace
   each aggregate term by its first member in place; append remaining members
   at the END of the cell, retaining qualifier and origin. Iterate appended
   terms too, matching native's ordered expansion. Diagnose `No aggregate`
   with the exact native message but retain its expansion. Do not turn terms
   into sets or choose canonical object meanings at this stage.
5. Substitute synonyms exactly once using ruleNames.synonyms. Native visits
   each LHS cell and only its corresponding RHS cell; preserve this boundary for
   malformed shapes. Keep raw ordered name strings for later inference.

The native `moving` prefix can emit InPlace. With a relative qualifier the native
relative lookup throws TypeError; it has no Action orientation entry. Preserve
that failure category explicitly rather than invent a rotation. Give the typed
function a clear TypeError message; host-specific JS property-access wording is
not a language diagnostic. Test native/candidate failure independently and record
the native observation. Valid InPlace rows without relative qualifiers survive.

### Verified malformed empty-aggregate boundary

Starting from movementSource, omit the `P = Player` alias, add legend lines
`Pair = Player and Player` then `Player = Pair`, and use
`right [Player]->[Player]`. Both resolvers terminate with empty Pair and Player
aggregate lists. Native syntax accepts Player; atomization emits actual undefined
names with no diagnostic. Full native compilation subsequently throws TypeError
in rulesToMask while reading toUpperCase. The typed pass instead throws an explicit
TypeError when it encounters an empty aggregate. Keep ordinary term names truthful;
do not emit undefined, invent a member or widen every later pass for this case.

This preserves the full-compilation failure category but fails earlier. Exact
intermediate output, host exception wording and error ordering for this malformed
case are not claimed by this bounded stage; the final diagnostic gate remains
pending. Compare ordinary intermediate outputs exactly for every corpus fixture,
and test this exceptional boundary separately against native whole compilation.
Inputs must remain unchanged when either explicit failure is thrown.

The same cycle with the P alias retained made native declaration normalization
nonterminate before orientation. Keep cycle probes isolated with fixed child
timeouts; do not imitate nontermination or change the previously reviewed
declaration normalization guard in this task.

## Test-first sequence

- [x] Start with an API/native-backed failing test before implementation.
- [x] Native oracle parses actual tuples, runs generateExtraMembers,
  generateMasks, native syntax and early-negative normalization, and snapshots
  inputs. Then explicitly emits native deep-cloned orientation variants and calls
  convertRelativeDirsToAbsolute, rewriteUpLeftRules, atomizeAggregates and
  rephraseSynonyms. Capture only new name-expansion diagnostics. Candidate uses
  independent readSource/resolveDeclarations/recoverRuleSyntax/early negatives;
  freeze all candidate inputs and guard every native producer during execution.
- [x] Check every cardinal orientation and relative qualifier, both sides,
  parallel/perpendicular identities, multiple rows, missing RHS rows and InPlace.
- [x] Check LHS ellipsis reversal prevention, including the malformed case where
  an ellipsis is not the first term. Rely on syntax recovery, not a hand-corrected
  term layout, for source-backed cases.
- [x] Check repeated selectors remain repeated and source/group/flag/command
  identities stay unchanged. `up up left [A|B]->[A|B]` yields Down(B,A),
  Down(B,A), Right(B,A). A nondirectional row retains the selector already chosen
  by syntax even if early negatives removed its only special term.
- [x] Check aggregate append order with Pair=A and B, AliasC=C:
  `up left [> Pair vertical AliasC|^ Player]->[< Pair|v Player] again`.
  Expected Down row begins Left Player then Up A, Vertical C, Up B; Right row
  begins Down Player then Left A, Vertical C, Left B. RHS is likewise resolved
  before reversal. Commands and evidence remain attached to the original rule.
- [x] Check `right [parallel Pair perpendicular Player]->[horizontal Pair vertical Player]`
  retains HorizontalParallel A, VerticalPerpendicular Player,
  HorizontalParallel B, with ordinary Horizontal RHS qualifiers.
- [x] Check aggregate aliases, property aliases, same-name namespace collisions,
  duplicate aggregate members, late qualifiers, random object terms, undefined
  member recovery and exact No-aggregate diagnostics. Do not chase synonyms
  transitively or simplify repeated terms.
- [x] Compare all 478 simulation sources, including the exact number/order of
  intermediate variants and raw diagnostics, with no later movement/property
  expansion or deduplication. Verify corruptions such as early dedup, sorted
  aggregate members, alias-before-aggregate and rotation-after-reversal fail.
- [x] Strict build, focused tests including preceding passes, full npm test,
  diff whitespace check. Do not rerun the long gameplay corpus or change native
  files/hashes. Report new native crashes or nonterminating malformed aggregate
  cases before expanding scope.
- [x] Obtain spec then quality approval and commit the bounded stage.

Next: movement family expansion/inference, property expansion/inference and
spawn-stationary inference. Equal intermediate variants remain essential until
the later source-group deduplication pass retains their last occurrences.

Reviewed implementation: `14f24f79`. Spec and quality reviews pass, as do strict
build and all 1,008 package tests. Focused orientation/name tests pass 50 cases;
the combined preceding-stage suite passes 341 cases. All 478 sources compare
16,577 rules and 25,985 ordered variants exactly, with zero new name diagnostics.
The documented invalid-source failure boundaries have bounded native/candidate
probes. Native production sources and hashes are unchanged.
