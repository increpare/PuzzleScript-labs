# Explicit property layer types implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Parent owns independent oracle projection/negative-control adaptations and final integration.

**Goal:** Make property membership and layer meaning one explicit typed record.

**Architecture:** Final declaration normalization builds `RuleProperty` records.
Inference, negatives, lowering and spawns switch on their required domain cases.
Only test adapters translate back to the native legacy comparison view.

**Tech Stack:** Strict TypeScript, numeric discriminated unions, existing native
declaration/property/compiler oracles and Node tests.

## 1. Baseline and contract (implementation agent)

- [x] Add `typescript/test/property-layer-types.test.mjs` using the strict temporary
  `.mts` pattern. Import `PropertyLayerKind`, `PropertyLayerAnalysis`, `RuleProperty`
  and `RuleVocabulary` from `declaration-model`. Reject missing required analysis,
  SingleLayer without layer, layer on Unlayered, Unresolved without references,
  and the obsolete dictionary. Include valid positive examples and narrowing.
- [x] Run `node --test typescript/test/property-layer-types.test.mjs`; observe the
  expected missing-API failure before production edits.
- [x] Add semantic assertions to existing declaration/property tests using the
  design's exact case meanings, including empty normalization and unlayered
  inference-versus-lowering distinction. Confirm meaningful red first.

## 2. Production model (implementation agent)

- [x] In `declaration-model.ts`, export the five numeric analysis cases and required
  `RuleProperty` payload. Replace property arrays with records; remove the old map.
- [x] In `declarations.ts`, construct ordered property records after final name
  normalization and analyze raw concrete member layers once with a named helper.
- [x] In `rule-properties.ts`, use alternatives and explicitly select local cases;
  preserve transported-property behavior, duplicate paths and empty branches.
- [x] In `rule-negatives.ts`, retain namespace priority and distinct SingleLayer
  versus Unlayered recovery/diagnostic behavior without undefined values.
- [x] In `rule-lowering.ts` and `rule-spawns.ts`, read alternatives and explicit
  layer analysis; do not introduce a catch-all layer-zero recovery.
- [x] Migrate owned model-facing tests and run build/type/declaration/property
  checks. Do not edit parent-owned adapters or native fixtures. Report stable API
  and readiness; no commit and no full/exhaustive gameplay replay.

## 3. Independent comparison projection (parent)

- [x] Adapt candidate-only projection in `legacy-declaration-oracle.cjs`, requiring
  the new plain vocabulary/property/analysis schemas. Preserve native expected
  single-layer entries, including present undefined, and all ordering comparisons.
- [x] Independently validate every analysis case from canonical raw concrete member
  identities/layers so nonlocal/unresolved/empty corruption cannot disappear in
  the native absent-entry projection.
- [x] Adapt `legacy-rule-properties.cjs` provenance counts to alternatives.
- [x] Migrate `declaration-oracle.test.mjs` corruption controls to the new record
  shape, preserving order/member/unlayered failures and adding wrong-kind and
  false-layer negative controls. Native producers remain unchanged.

## 4. Review and integration (parent)

- [x] Request spec review then correctness/readability review; resolve findings.
- [x] Run the complete strict suite and fresh bounded differential sample. Update
  reading guides and the full goal checklist with actual evidence only.
- [ ] Commit and fast-forward clean local master; build and run focused integration
  checks. Preserve unrelated local work and keep the overall goal active.

## Verification audit

- Type-contract red failed for missing exports; semantic red exposed the old
  array/record mismatch in five declaration cases and the unlayered inference /
  lowering distinction. The implementation then passed its strict build and
  **276 focused checks**.
- Parent independent oracle run: **175 passed**, including native declarations,
  property inference, Unicode evidence and corruption controls. Log:
  `/private/tmp/ps-property-layer-oracles-initial.log`.
- Final complete strict suite: **2,055 passed**, no failures; log:
  `/private/tmp/ps-property-layer-types-full.log`.
- Bounded differential sample: **128 games**, **855 observations and operations**,
  **128 loads**; no exclusions, mismatches, exceptions or timeouts. Seed:
  `property-layer-types-2026-11-01`; report:
  `/private/tmp/ps-property-layer-types-campaign.json`.
- Spec and quality reviews approved with no actionable findings. The spec
  reviewer independently completed **279 static tests**, including all three
  492-source consumer comparisons; quality review independently passed 45 tests.
- Production has no old property-layer dictionary. Only candidate-side test
  adapters translate the explicit records to native comparison data; actual
  native producers and native expected projection remain unchanged. Status
  validation covers canonical layers and cases hidden by native dictionary
  absence. Negative controls catch false layers, invented payloads, unknown
  kinds, wrong nonlocal/empty classifications and unresolved reference order.
- No exhaustive gameplay replay or server was started. Rule-pass contracts and
  the final transformation/readability audit remain required by the active goal.
