# Zero-step Rule Scan Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then independent spec and quality reviews. Continue in the vanilla port worktree.

**Goal:** Represent the native recovery-only Action rule orientation as an explicit
zero-step scan, preserving matching, rechecks and repeated writes.

**Architecture:** Append `Direction.InPlace` without changing existing enum values.
It describes a rule scan, separate from player `Movement.Action`. Direct coordinate
helpers return `{x:0,y:0}`. Match origins remain row-major. Wildcard searches have
an explicit no-matches compatibility case rather than an endless gap search.

**Tech Stack:** Strict TypeScript, existing Board/RulePattern/ExecutableRule data,
numeric enums, Node tests and the pinned vanilla native host.

## Files

- Modify `typescript/src/model.ts`, `matching.ts`, `captures.ts`, `rules.ts` where
  direction stepping occurs. Share a small named direction helper only if it
  clearly removes duplication without broadening this change.
- Modify `typescript/test/legacy-patterns.cjs` to decode native orientation16 as
  `Direction.InPlace`; numeric/native encoding knowledge remains test-only.
- Add focused native-backed tests in `typescript/test/zero-step.test.mjs` and
  extend matching/rule tests where ordinary domain construction is clearer.

## Test-first sequence

- [x] Compile this source through the pinned host and record the salvaged fifth
  orientation and expected lexical diagnostic. Use the existing movementSource
  helper, separate Player/Crate layers, `X = Player and Crate`, a2x2 X board and
  `moving [ Player | Crate ] -> sfx0`. Native's unexpected-direction console
  message must be captured as expected evidence, not hidden as a passing assertion.
- [x] Add a failing test decoding the fifth variant and comparing direct ordered
  matches. Expected starts are `(0,0),(1,0),(0,1),(1,1)`; every row term tests the
  same cell. Observe failure before adding the enum/step mapping.
- [x] Append the enum member and implement direct zero offsets in all relevant
  coordinate helpers. Choose horizontal-style origin order explicitly for InPlace.
- [x] Add a failing ellipsis search test for one and two gaps. Compare native's
  empty candidate result, then implement the explicit InPlace wildcard rejection.
  Do not use a zero-step loop bounded only by board position.
- [x] Compare native fixed-gap row rechecks separately; do not infer their result
  merely from the empty search result. Both true/false predicates must remain finite.
- [x] Add a replacement test with two pattern cells writing one location, checking
  order, live-cell rechecks and full resulting state. Add a source-cell capture
  address test if the existing helper accepts InPlace rules.
- [x] Run strict build, new focused tests, matching/capture/rule/application oracle
  tests, then `npm --prefix typescript test`. Keep native files/manifest unchanged.
- [x] Require spec then quality review, fix material findings and commit the
  bounded change. The source-rule compiler remains the next task.

See `../specs/2026-10-24-typescript-vanilla-rule-semantics.md` for the exact native
pipeline, semantics and evidence. Full compiler diagnostics and other invalid
source recovery remain separate completion gates.

Implemented in `643fce67`. Strict build and all 679 package tests pass; independent
spec and quality reviewers approved the change. The spec reviewer also ran 85
focused tests and a strict no-emit check. Native source and oracle hashes remain
unchanged.
