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
- [x] Add `typescript/test/rule-frontend.test.mjs` covering canonical token identity,
  final contextual vocabulary, deferred property diagnostics, and compilation
  without physical text reads. Run it against the old implementation and retain
  evidence that the new boundary is absent.
  Baseline: 4 expected failures and 3 passing preservation checks; log saved in
  `/private/tmp/ps-rule-frontend-red.log`.

## Task 2: Replace the overlapping grammars

- [x] In `source-lexical.ts`, expose copied final rule-name and sound vocabulary.
- [x] In `rule-lexing.ts`, introduce a scanner taking source-line/capture inputs;
  keep `compilerRuleTokens(rule)` as a read-only accessor over stored tokens.
- [x] In `source-model.ts`, describe the single recovered AST, parse status and
  ordered issues. Keep source words and effective Unicode values distinct.
- [x] Replace `source-rules.ts`'s alternate authored grammar with the existing
  native recovery semantics, recording source evidence and contextual issues.
- [x] Wire `source-reader.ts` to the completed vocabulary and last retained rule.
- [x] Replace `rule-syntax.ts`'s raw-token grammar with tree projection and issue
  reporting. Resolve the explicit duplicate-property note here.
- [x] Build and run focused frontend tests. Investigate any native mismatch;
  do not alter oracle producers, expectations or comparisons.
- [x] Update reader-only tests for intentional removal of alternate recovery,
  asserting raw token evidence wherever a malformed fragment is not retained.

## Task 3: Review and verify the complete slice

- [x] Independently review architecture compliance, then correctness/readability.
- [x] Run `npm --prefix typescript test`, including exact compiler corpus tests.
- [x] Run `npm --prefix typescript run explore -- --seed rule-frontend-2026-11-01
  --cases 128 --jobs 4 --out /private/tmp/ps-rule-frontend-findings
  --json /private/tmp/ps-rule-frontend-campaign.json`.
- [x] Update `typescript/README.md` and `typescript/READABILITY.md` with the actual
  boundaries and remaining declaration work.
- [x] Check diff/working-tree scope, commit verified changes locally and report
  results with any limitations. Do not push unrelated local AGAIN work.

## Verification audit

- Final TypeScript suite: **1,902 passed**, zero failures; log
  `/private/tmp/ps-rule-frontend-final-full.log`. Before adding the three context
  regressions, the initial full run passed 1,899 tests in
  `/private/tmp/ps-rule-frontend-full.log`.
- Exact compiler comparison: **335 compilation fixtures**, **492 simulation
  sources**, **99,192 final executable rules**; diagnostics, acceptance and
  stopping boundaries unchanged. Focused compiler log:
  `/private/tmp/ps-rule-frontend-compiler.log`.
- Focused reader/syntax/provenance/boundary run: **221 passed**; log
  `/private/tmp/ps-rule-frontend-reader-final.log`.
- Generated differential sample: **128 games**, **907 observations/operations**,
  **128 level loads**; zero exclusions, failures, exceptions or timeouts. Includes
  127 distinct source programs, 34 rule sets and 121 boards, with 32 games from
  each of the four generator families. Report:
  `/private/tmp/ps-rule-frontend-final-campaign.json` (repeated on the final build
  with the same totals).
- Independent architecture and correctness/readability reviews approved without
  actionable findings. Both reviewers also ran the eight boundary tests.
- Reader-only expectations changed where the removed authored grammar disagreed
  with canonical native recovery. Native producer guards and comparisons remain
  intact. The provenance visitor now accepts explicitly nullable native diagnostic
  spans, with a new negative control proving non-null issue spans remain checked.
- A constructed malformed-source check exposed an existing TypeScript discrepancy:
  a declared `Message` object without a preceding SOUNDS registration caused
  literal message parentheses to swallow the next physical rule. The per-line
  comment vocabulary now snapshots the actual registrations visible then, while
  grammar parsing keeps the final vocabulary. Three native-oracle cases cover
  missing, preceding and later SOUNDS headings (two failed before the fix; all
  three pass after it). Both reviewers approved the follow-up. Red/green logs:
  `/private/tmp/ps-rule-comment-context-red.log` and
  `/private/tmp/ps-rule-comment-context-green.log`.
- Extra exhaustive source-session replay was **not completed**. At least **218
  distinct original games** fully matched before stopping the expensive optional
  run. The initial serial run supplies the first 184; three disjoint partitions
  starting at index 184 supply another 11, 16 and 7. Interrupted cases are not
  counted as passes. The partition wrapper changed fixture selection only, keeping
  native producers, candidate compilation and every per-move assertion unchanged.
  No mismatch was observed; the remaining original-game playbacks remain unchecked
  in this run. Logs: `/private/tmp/ps-rule-frontend-sessions.log` and
  `/private/tmp/ps-rule-frontend-sessions-part-{0,1,2}.log`.
- All optional replay processes were stopped; no test servers were launched.
