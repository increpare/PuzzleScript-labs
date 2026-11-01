# Explicit property layer types implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Parent owns independent oracle projection/negative-control adaptations and final integration.

**Goal:** Make property membership and layer meaning one explicit typed record.

**Architecture:** Final declaration normalization builds `RuleProperty` records.
Inference, negatives, lowering and spawns switch on their required domain cases.
Only test adapters translate back to the native legacy comparison view.

**Tech Stack:** Strict TypeScript, numeric discriminated unions, existing native
declaration/property/compiler oracles and Node tests.

## 1. Baseline and contract (implementation agent)

- [ ] Add `typescript/test/property-layer-types.test.mjs` using the strict temporary
  `.mts` pattern. Import `PropertyLayerKind`, `PropertyLayerAnalysis`, `RuleProperty`
  and `RuleVocabulary` from `declaration-model`. Reject missing required analysis,
  SingleLayer without layer, layer on Unlayered, Unresolved without references,
  and the obsolete dictionary. Include valid positive examples and narrowing.
- [ ] Run `node --test typescript/test/property-layer-types.test.mjs`; save the
  expected missing-API failure before production edits.
- [ ] Add semantic assertions to existing declaration/property tests using the
  design's exact case meanings, including empty normalization and unlayered
  inference-versus-lowering distinction. Confirm meaningful red first.

## 2. Production model (implementation agent)

- [ ] In `declaration-model.ts`, export the five numeric analysis cases and required
  `RuleProperty` payload. Replace property arrays with records; remove the old map.
- [ ] In `declarations.ts`, construct ordered property records after final name
  normalization and analyze raw concrete member layers once with a named helper.
- [ ] In `rule-properties.ts`, use alternatives and explicitly select local cases;
  preserve transported-property behavior, duplicate paths and empty branches.
- [ ] In `rule-negatives.ts`, retain namespace priority and distinct SingleLayer
  versus Unlayered recovery/diagnostic behavior without undefined values.
- [ ] In `rule-lowering.ts` and `rule-spawns.ts`, read alternatives and explicit
  layer analysis; do not introduce a catch-all layer-zero recovery.
- [ ] Migrate owned model-facing tests and run build/type/declaration/property
  checks. Do not edit parent-owned adapters or native fixtures. Report stable API
  and readiness; no commit and no full/exhaustive gameplay replay.

## 3. Independent comparison projection (parent)

- [ ] Adapt candidate-only projection in `legacy-declaration-oracle.cjs`, requiring
  the new plain vocabulary/property/analysis schemas. Preserve native expected
  single-layer entries, including present undefined, and all ordering comparisons.
- [ ] Independently validate every analysis case from canonical raw concrete member
  identities/layers so nonlocal/unresolved/empty corruption cannot disappear in
  the native absent-entry projection.
- [ ] Adapt `legacy-rule-properties.cjs` provenance counts to alternatives.
- [ ] Migrate `declaration-oracle.test.mjs` corruption controls to the new record
  shape, preserving order/member/unlayered failures and adding wrong-kind and
  false-layer negative controls. Native producers remain unchanged.

## 4. Review and integration (parent)

- [ ] Request spec review then correctness/readability review; resolve findings.
- [ ] Run the complete strict suite and fresh bounded differential sample. Update
  reading guides and the full goal checklist with actual evidence only.
- [ ] Commit and fast-forward clean local master; build and run focused integration
  checks. Preserve unrelated local work and keep the overall goal active.
