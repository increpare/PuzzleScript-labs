# Source Declarations Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Track completion below.

**Goal:** Express source declarations and layer membership through conceptual typed operations, removing their interpretation from the lexical walker.

**Architecture:** Separate the cursor/layout walk from ordered source registration and lookup. Use numeric discriminated unions for declarations and lookup results, share legend recovery mechanics, and preserve synchronous native diagnostic visits.

**Tech Stack:** Strict TypeScript, Node tests, pinned vanilla parser/compiler and per-move oracles.

---

## Task 1: Establish boundaries

- [x] Read the current walker, legend recovery, declaration preparation and native adapters.
- [x] Create `codex/typescript-source-declarations` from verified local master.
- [x] Run the unchanged declaration/parser baseline: **136 tests pass**;
  `/private/tmp/ps-declarations-baseline.log`.
- [x] Independently review namespace precedence, recovery and safe extraction scope.
- [ ] Add failing semantic tests for the new source-declaration API, then demonstrate
  their expected failure before implementing it.

## Task 2: Implement conceptual registration

- [ ] Create `typescript/src/source-declarations.ts` (and a focused compatibility
  helper if needed). Use required kind-specific fields for alias targets and
  compound members, source-order operations and explicit lookup precedence.
- [ ] Replace lexical declaration/expansion/layer closures with calls to the new
  module. Keep cursor/layout and synchronous issue collection in the walker.
- [ ] Share self-reference removal and kind selection with `source-legend.ts`,
  preserving distinct authored syntax and reporting policies.
- [ ] Test source snapshots, duplicate-member order, invalid recovery and cap
  interruption against the pinned parser.
- [ ] Verify type-level rejection of impossible declaration payloads.

## Task 3: Review and integrate

- [ ] Obtain independent spec review, then correctness/readability review.
- [ ] Run `npm --prefix typescript test`; retain the exact 827-source compiler and
  parser comparisons and all producer guards.
- [ ] Run a bounded generated differential sample on the final build:
  `node typescript/bin/explore.mjs --seed source-declarations-2026-11-01 --cases 128
  --jobs 4 --out /private/tmp/ps-declarations-findings
  --json /private/tmp/ps-declarations-campaign.json`.
- [ ] Update the reading guide and audit with the actual conceptual boundary and
  any remaining duplicate compiler preparation work.
- [ ] Commit verified changes, integrate locally and run focused integration checks.
  Preserve unrelated local work; do not publish it.
