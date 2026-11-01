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
- [x] Add failing semantic tests for the new source-declaration API, then demonstrate
  their expected failure before implementing it.

## Task 2: Implement conceptual registration

- [x] Create `typescript/src/source-declarations.ts` (and a focused compatibility
  helper if needed). Use required kind-specific fields for alias targets and
  compound members, source-order operations and explicit lookup precedence.
- [x] Replace lexical declaration/expansion/layer closures with calls to the new
  module. Keep cursor/layout and synchronous issue collection in the walker.
- [x] Share self-reference removal and kind selection with `source-legend.ts`,
  preserving distinct authored syntax and reporting policies.
- [x] Test source snapshots, duplicate-member order, invalid recovery and cap
  interruption against the pinned parser.
- [x] Verify type-level rejection of impossible declaration payloads.

## Task 3: Review and integrate

- [x] Obtain independent spec review, then correctness/readability review.
- [x] Run `npm --prefix typescript test`; retain the exact 827-source compiler and
  parser comparisons and all producer guards.
- [x] Run a bounded generated differential sample on the final build:
  `node typescript/bin/explore.mjs --seed source-declarations-2026-11-01 --cases 128
  --jobs 4 --out /private/tmp/ps-declarations-findings
  --json /private/tmp/ps-declarations-campaign.json`.
- [x] Update the reading guide and audit with the actual conceptual boundary and
  any remaining duplicate compiler preparation work.
- [x] Commit verified changes, integrate locally and run focused integration checks.
  Preserve unrelated local work; do not publish it.

## Verification audit

- Complete strict suite: **1,937 tests pass**, zero failures; log
  `/private/tmp/ps-source-declarations-full.log`.
- Exact native compiler comparison: **335 compilation fixtures**, **492 simulation
  sources**, **99,192 executable rules**. Acceptance, diagnostics, error counts and
  stopping decisions retain the existing totals; focused log
  `/private/tmp/ps-source-declarations-compiler.log`.
- New coverage: **13** direct registration/recovery/layer tests, **21** independent
  native parser/declaration boundary cases and **one** TypeScript contract test.
  The contract includes positive payloads plus expected rejection of missing or
  array-valued alias targets, wrong compound payloads, inherited registrations
  and unsupported fields after discriminant narrowing.
- The shared recovery initially removed matching operator words even when no
  operand referred to the declaration. Native fixture #819 and new independent
  OR/AND-name cases caught this. Restoring the operand-trigger guard preserves
  the exact old behaviour; both new cases passed after failing first. Logs:
  `/private/tmp/ps-declarations-operator-name-red.log` and the focused suite.
- Independent spec and correctness/readability reviews approved without actionable
  findings. The quality reviewer independently ran all 35 new focused checks.
- Final generated sample: **128 games**, **920 observations/operations**, **128
  level loads**, zero exclusions, mismatches, exceptions or timeouts. Includes
  128 unique sources, 44 rule sets and 123 boards; each generator family completed
  32 games. Report `/private/tmp/ps-declarations-campaign.json`.
- The source walker delegates semantic registration, reference expansion, vocabulary
  captures and layer checks. Mutable positional recovery is explicitly confined
  to `NativeLegendExpression`; compiler preparation still reconstructs its initial
  namespace and is the next duplication to replace. No cached document namespace,
  optimizer, packed representation or generated code was added.
- No exhaustive gameplay replay or test server was started for this slice.
