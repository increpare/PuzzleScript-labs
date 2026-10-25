# Independent Source Rule Compiler Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then parent-managed spec and quality reviews. Begin after source schedule
> construction is reviewed. Do not dispatch further agents from this task.

**Goal:** Join the independently reviewed semantic passes into an actual source
rule compiler with native abort boundaries and complete rule diagnostics.

**Architecture:** Consume authored source and ONE canonical declaration result.
Return schedules/rigid data or a native-invalid result. Ordered small passes stay
visible in the orchestration. Keep reader/declaration/game-data diagnostics out
of this rule-only API; whole-source integration collects those separately.

**Tech Stack:** Strict TypeScript, SourceDocument, ResolvedDeclarations, existing
named rule passes, direct lowering and source schedules.

## Files and API

Create `typescript/src/source-rule-compiler.ts`:

```ts
export type CompiledRuleData = Pick<TurnRulesGame,
  'earlyRules' | 'lateRules' | 'rigid' | 'rigidMerges'>;
export function compileSourceRules(
  document: SourceDocument, declarations: ResolvedDeclarations,
): { readonly data: CompiledRuleData | null; readonly diagnostics: readonly SourceDiagnostic[] };
```

Split the aggregate and synonym operations in `typescript/src/rule-names.ts`
into separately callable pure passes. Keep expandRuleNames as the useful composed
operation for existing callers; its ordinary outputs and evidence stay identical.
The orchestrator needs the aggregate-only result for the native invalid checkpoint.
Do not add a stopBeforeSynonyms boolean option or duplicate the expansion code.

Expose `orientRule(rule: RuleSyntax, direction: Direction): OrientedRule` from
`typescript/src/rule-orientations.ts`, factoring the existing single-variant
operation rather than duplicating it. Keep orientRules as the ordered wrapper.
The orchestrator must be able to visit one selector without evaluating a later
InPlace selector before the first variant's invalid checkpoint.

Complete undefined-SFX warning emission in `typescript/src/rule-syntax.ts` at
its actual command visit, using the native parser's sound-definition membership.
The old bounded syntax oracle intentionally filtered these warnings. Remove that
filter when integration is implemented, and compare them in their original
interleaved positions. Add any necessary sound lexical view as ordinary authored
evidence linked to effective tokens, not a call into the JS parser. Native
processRuleString checks the first token of parsed sound records, including
recovery records; later semantic validity of a sound is a different question.

Parent's native syntax audit confirms 27 currently filtered undefined-SFX warnings
across six existing simulation fixtures. They include chaos wizard, gallery:
Spikes 'n' Stuff, der Hydra Krypta, Xorro The Chaos Warden, and the two existing
sound/inert-rule regressions. Raw evidence is in
`/private/tmp/puzzlescript-native-undefined-sfx-audit.json`. Adding these warnings
should change the all-478 raw syntax diagnostic count from 189 to 216 without
changing any compiled rule behavior. Compare their original interleaved positions.

Add `typescript/test/legacy-source-rule-compiler.cjs` and
`typescript/test/source-rule-compiler.test.mjs`. Native rulesToArray then the
actual remaining native rule phases are the authority. Parse original text
independently on each side. Keep native source hash and unsupported-field guards.

## Orchestration and abort behavior

1. Recover all syntax/commands/loop markers and collect their diagnostics.
2. Run early negatives for ALL recovered syntax rules, even if syntax invalid.
3. Visit retained orientations in rule/selector order. For ONE variant, resolve
   relative directions, reverse rows, expand aggregates, then check syntax invalid.
   If invalid, return data=null immediately BEFORE synonyms or later variants.
   If no oriented variant exists, retain invalid state through the final check.
4. Otherwise substitute synonyms for that variant, then continue the next variant.
   Do not orient every variant before processing earlier aggregate diagnostics:
   a later InPlace-relative TypeError can be unreachable after the first invalid
   variant. Retain explicit malformed failure boundaries already documented.
5. Run all movement inputs and collect diagnostics. A movement ambiguity does
   not stop later movement inputs, property inference or spawn inference.
6. Run property inference for all movement variants, then all spawn inference.
7. If syntax or movement invalid, return data=null now, BEFORE duplicates/lowering.
   Property ambiguity drops its input variants but does not set native invalid.
8. Normalize duplicates, lower all rules, then form surviving schedules. Return
   earlyRules/lateRules, rigid and rigidMerges with diagnostics in native order.

Use explicit local variables for stages. Do not introduce a generic pipeline
framework, event bus, opaque pass registry, caches or generated operations. Do
not resolve declarations again inside this function. Preserve canonical objects,
source spans and original command identity throughout successful compilation.

Keep the later whole-source diagnostic interleaving visible as a composition
requirement: native visits group/collapse/rigid work, then win conditions, layering
checks and metadata, then loop points. This rule-only API returns all rule
diagnostics in their relative native order; later assembly must preserve the
intervening non-rule phases rather than merely concatenate two flat result lists.

## Test-first sequence

- [x] Observe a missing API native-backed test fail before implementation.
- [x] Compare successful ordinary source compilation and every actual final
  semantic predicate/edit/group/loop/rigid field using independent native adapters.
- [x] Cover syntax invalid with early-negative diagnostics, first orientation
  aggregate diagnostics, a later unreachable InPlace-relative failure, and no
  oriented variants. Cover movement-invalid continuation through property/spawn,
  ensuring no duplicate/lowering diagnostics execute after the final invalid check.
- [x] Cover SFX warnings among other syntax diagnostics, known/unknown effects,
  repeated SOUNDS sections, malformed records and first-token membership recovery.
  Update the existing syntax oracle to compare the warnings rather than filtering.
- [x] Re-run full random precursor from original concrete versus alias sources
  on PP: obtain THREE versus FOUR actual application candidates. Compare seeded
  random execution and resulting RNG/commands with native, rather than only
  asserting inferred variant records. Preserve #1206 source-game behavior.
- [x] Freeze source/declarations and check no mutation, canonical object/command
  identities and complete native producer guards during candidate compilation.
  Use focused corruptions for skipped/unreachable passes and ordering errors.
- [x] Compare all 478 original simulation sources against actual native final
  rule schedules and complete raw rule diagnostics, not just stage projections.
- [x] Strict build, focused compiler suites, full npm test, whitespace/native hash
  checks. Self-review and commit; obtain independent spec then quality approval.

## Reviewed checkpoint

Implementation `22df8696` passes independent spec and quality review. Both reviewers
freshly passed strict compilation, 40 joined-compiler tests and 155 syntax tests.
All 478 sources produce 99,076 final rules and 398 ordered raw rule diagnostics;
the syntax pass now includes all 216 raw diagnostics. The full package passed
1,366 tests. Whitespace and all 21 native source hashes are clean.

Actual seeded execution compares the three-versus-four random candidate case for
twelve seeds per spelling, including full RNG state and command identity. Typed
source execution preserves #1206's one retry and ban of the unmatched third group,
and the writable orphan case. Oracle corruptions reject an extra canonical but
runtime-unassigned authored object rather than silently dropping it in projection.
The empty-selector final invalid boundary remains explicit; ordinary authored
bracket rules supply selectors, so this boundary is documented with direct stage
evidence rather than an invented source fixture. An additional independent native
audit of 225 malformed/comment/whitespace SFX records found no membership mismatch.

Next: join the rule data with existing non-rule source data using the same
declarations, add source-to-trace entry point, compile assets and complete exact
whole-compiler diagnostic behavior before the final source-compiled corpus gate.
