# Final frontend audit implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the small domain cleanup, with parent-owned semantic witnesses and independent final review.

**Goal:** Finish the conceptual frontend with explicit domains and justified transforms.

**Architecture:** Reuse the authoritative accepted syntax and finite vocabularies.
Remove compiler acceptance guesses and private parse-result sentinels. Document
observable normalization behavior using real source and controlled experiments.

**Tech Stack:** Strict TypeScript, Node tests and the pinned native per-move oracle.

## 1. Domain cleanup (implementation agent)

- [x] Extend the strict rule-pass temporary `.mts` contract to reject index11 on
  SourceRuleCommandKind.SoundEffect while accepting0 and10. Watch the unused
  expect-error directive fail against the current number field.
- [x] Add focused metadata tree-consumption and dimension native comparisons in
  `typescript/test/frontend-domain-boundaries.test.mjs`. Include unknown/empty
  accepted tree entries, coordinate failures/nonpositive mixtures and reporter
  interruption order; observe old duplicate filtering red before production.
- [x] Export a readonly finite sound-effect lookup from `source-sound-syntax.ts`,
  reuse it in `source-rules.ts`, type `source-model.ts` command index SoundIndex
  and remove the projection assertion in `rule-syntax.ts`. No native changes.
- [x] Remove unused Message `legacyPayload` from source-model/source-rules and
  migrate obsolete reader assertions, retaining authored evidence and actual
  compiler text. Add a type guard against reintroducing the false mirror.
- [x] Remove duplicate metadata vocabulary/acceptance checks in source-game-data;
  replace NaN failure state in coordinate parsing with number|null, retaining
  diagnostics/order and domain validation.
- [x] Build/run focused contracts, source sound/rule/metadata/compiler checks and
  report a stable handoff. No commit or exhaustive gameplay replay.

## 2. Observable transformation witnesses (parent)

- [x] Add `typescript/test/frontend-transformations.test.mjs` with real source
  fixtures independently checked by the existing full per-move native oracle.
- [x] Add clearly labeled counterfactual typed graph experiments for edit/RNG
  ordering, selector traversal, duplicate random selection and local-property
  live overlap. Confirm they change board/RNG/effects rather than only schema.
- [x] Inventory every retained frontend transformation in a concise reading
  document, linking its source, semantic rationale and evidence. Remove any
  remaining optional optimizer machinery revealed by the audit.

## 3. Independent closure (parent)

- [x] Resolve whole-frontend audit findings; re-review actual final code and tests.
- [x] Request independent final correctness/readability review against the entire
  goal checklist, including small-helper ergonomics and honest remaining quirks.
- [x] Run complete strict suite, bounded per-move sample and required focused
  checks; update README/READABILITY and the audit with actual evidence.
- [x] Commit/integrate into clean local master and verify the primary checkout.
  Preserve unrelated local commits; no automatic push or worktree cleanup while
  active work depends on it.
- [x] Verify the completion gate: the full checklist, reviews and integration pass;
  report the concrete improvements and verification without overclaiming future
  correctness outside covered behavior.

## Final verification audit

- Domain red: unused `@ts-expect-error` clauses proved arbitrary sound indices and
  the message mirror were still accepted. Metadata tree cases proved the old
  compiler dropped accepted renamed keys and empty values. The corrected domain
  code passed **409 focused tests** and an additional native diagnostic-order check.
- Valid Unicode alias evidence exposed the old reader adapter's stale projection:
  authored HELLO differed from actual native ELLO. Positive failed first, then
  passed with candidate projection using effective text; a corruption control
  rejects authored substitution. Logs:
  `/private/tmp/ps-final-message-oracle-red.log` and `-green.log`.
- Final domain file: **42 tests**, including 27 full native compiler dimension
  cases, exact coordinate/aggregate/interruption order, accepted-tree authority,
  SFX boundaries/context and diagnosed contradictory-rule removal.
- Four real source witnesses independently pass the full source/per-move native
  oracle. Their four separate counterfactual graphs produce different actual
  boards, with seed `frontend-0`; **8 tests passed**. Probe:
  `/private/tmp/ps-frontend-transform-probe.jsonl`; permanent tests:
  `typescript/test/frontend-transformations.test.mjs`.
- Combined focused domain/witness/type boundary run: **51 passed**;
  `/private/tmp/ps-final-frontend-boundaries.log`.
- Complete final strict suite: **2,114 passed**, no failures; log:
  `/private/tmp/ps-final-frontend-full.log`. All pinned 335 compilation fixtures,
  492 simulation sources and 99,192 executable rule comparisons remain covered.
- Final generated differential campaign: **128 games**, **919 observations and
  operations**, **128 loads**, no exclusions, mismatches, oracle exceptions,
  process failures or timeouts. Seed: `final-frontend-audit-2026-11-01`; report:
  `/private/tmp/ps-final-frontend-campaign.json`.
- Whole-frontend audit identified and re-reviewed all four domain/model gaps;
  re-review independently passed all 50 new domain/witness cases and approved
  the full criteria. A fresh completion reviewer inspected scanner, authored
  bindings, declarations/assets, names/property analyses, rule stages/scheduling,
  final production diff and witness/oracle integrity, finding no remaining
  actionable correctness or readability blocker. Both conditioned closure only
  on parent verification, final evidence updates and integration.
- Native code/producers/expected data remain independent. The reader adapter's
  projection is corrected and strengthened with a negative control. Experimental
  graphs never supply oracle input/expected data. Original JS and unrelated
  prepared-AGAIN runtime work remain untouched. No exhaustive gameplay replay,
  preview server or automatic push was started.
- Integration completed at code checkpoint `5d9addf4`. The clean primary master
  checkout built successfully and passed **66 focused integration checks**;
  `/private/tmp/ps-final-frontend-master-smoke.log`. All required checklist items
  and independent review gates are satisfied; the active goal can be recorded
  complete after this verification record is integrated.
