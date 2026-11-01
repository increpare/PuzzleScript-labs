# Rule Frontend Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Track completion below.

**Goal:** Parse each rule once and make that source tree authoritative for compilation.

**Architecture:** Scan into source-mapped tokens, parse with explicit final language vocabulary, then validate/project the stored syntax before existing expansion and lowering. Preserve native recovery and diagnostic checkpoints.

**Tech Stack:** Strict TypeScript, Node's test runner, pinned vanilla compiler/session oracles.

---

## Task 1: Establish the boundary contract

- [x] Read both existing rule grammars, scanner, reader and compiler consumers.
- [x] Create `codex/typescript-rule-frontend` in the existing isolated worktree.
- [x] Run the unchanged baseline: build plus rule-syntax, rule-lexing, source-parser
  and source-reader tests (271 pass).
- [x] Verify final lexical SOUNDS registrations equal the compiler's existing
  registration calculation across all 827 original corpus sources (0 mismatches).
- [ ] Add `typescript/test/rule-frontend.test.mjs` covering canonical token identity,
  final contextual vocabulary, deferred property diagnostics, and compilation
  without physical text reads. Run it against the old implementation and retain
  evidence that the new boundary is absent.

## Task 2: Replace the overlapping grammars

- [ ] In `source-lexical.ts`, expose copied final rule-name and sound vocabulary.
- [ ] In `rule-lexing.ts`, introduce a scanner taking source-line/capture inputs;
  keep `compilerRuleTokens(rule)` as a read-only accessor over stored tokens.
- [ ] In `source-model.ts`, describe the single recovered AST, parse status and
  ordered issues. Keep source words and effective Unicode values distinct.
- [ ] Replace `source-rules.ts`'s alternate authored grammar with the existing
  native recovery semantics, recording source evidence and contextual issues.
- [ ] Wire `source-reader.ts` to the completed vocabulary and last retained rule.
- [ ] Replace `rule-syntax.ts`'s raw-token grammar with tree projection and issue
  reporting. Resolve the explicit duplicate-property note here.
- [ ] Build and run focused frontend tests. Investigate any native mismatch;
  do not alter oracle producers, expectations or comparisons.
- [ ] Update reader-only tests for intentional removal of alternate recovery,
  asserting raw token evidence wherever a malformed fragment is not retained.

## Task 3: Review and verify the complete slice

- [ ] Independently review architecture compliance, then correctness/readability.
- [ ] Run `npm --prefix typescript test`, including exact compiler corpus tests.
- [ ] Run `npm --prefix typescript run explore -- --seed rule-frontend-2026-11-01
  --cases 128 --jobs 4 --out /private/tmp/ps-rule-frontend-findings
  --json /private/tmp/ps-rule-frontend-campaign.json`.
- [ ] Update `typescript/README.md` and `typescript/READABILITY.md` with the actual
  boundaries and remaining declaration work.
- [ ] Check diff/working-tree scope, commit verified changes locally and report
  results with any limitations. Do not push unrelated local AGAIN work.
