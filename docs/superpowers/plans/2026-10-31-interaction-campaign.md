# PuzzleScript interaction campaign implementation plan

> **For agentic workers:** Use the subagent-driven-development skill for the two
> independent fixture families; the parent implements and integrates the coupled
> generator/checker/reducer pipeline. Keep all edits in this isolated worktree.

**Goal:** Add readable interaction regressions and reproducible differential
exploration with bounded reduction, then run and audit a substantial campaign.

**Architecture:** Existing authored fixture loader/exporter and unchanged native
compiler/session oracles remain authoritative. New test-owned modules represent,
render, generate, check and shrink complete source games. A CLI isolates each
case in a timed child and saves findings without recording expected outcomes.

**Tech Stack:** Node ESM/CJS, node:test, existing TypeScript build and pinned JS
oracle. No new runtime dependencies or browser tests.

## Task 1: Authored interactions

**Files:** Create `src/tests/semantic-fixtures/interaction-matching.json` and
`interaction-session.json`, plus their `.ps` sources in corresponding folders.

- [x] Matching author: six error-free games and at least eighteen hand-authored
  cases covering property binding with live overlap, multirow aliases and one/two
  ellipses. Explain every board and non-obvious iteration/order decision.
- [x] Session author: six error-free games and at least eighteen cases covering
  rigid RNG retries and AGAIN with checkpoint, cancel, restart and undo. Explain
  draw order; explicitly declare Labs overrides where cached RNG differs.
- [x] Verify each family with `verify-native.cjs FILTER` and the TypeScript
  semantic test file. Do not edit exports or central guide concurrently.
- [x] Parent reviews semantics, exports with `export.cjs`, verifies original
  testdata prefix, then runs all authored cases in vanilla, TS and Labs.

## Task 2: Source model and deterministic generator

**Files:** Create `typescript/test/exploration/program.mjs`, `generate.mjs`, and
`typescript/test/exploration.test.mjs`.

- [x] Test a hand-written model rendering a complete error-free game; test that
  distinct object sets get distinct legal glyphs and the model remains unchanged.
- [x] Test `generateProgram(seed, index)` returns identical models across repeated
  calls and shuffled indices; different indices vary rules/boards, not just titles.
- [x] Implement ordinary arrays/names for objects, properties, layers, rule text,
  cell occupants and inputs. Require rectangular nonempty boards and defined
  object identities, and render background/legend explicitly.
- [x] Implement bounded families: pushing/property transfer, live multirow/ellipsis,
  random groups/rigid retries, and session commands/AGAIN. Choose small dimensions,
  initial placements, rule variants, seeds and short tapes deterministically.
- [x] Run the new tests; keep native/candidate PRNG implementations out of case
  construction and test no mutation of model inputs.

## Task 3: Independent checker and isolated runner

**Files:** Create `typescript/test/exploration/check.mjs`, `worker.mjs`,
`process.mjs`, and `typescript/bin/explore.mjs`.

- [x] Test an ordinary model is compared through compilation and every session
  observation; a deliberately wrong candidate modified flag must fail comparison.
- [x] Test candidate-only compiler diagnostics are failures, never invalid-case
  exclusions. Shared invalid programs are counted separately.
- [x] Implement `createProgramChecker(overrides = {})` using complete source
  compiler comparison first and the existing session oracle second. Keep native
  producer guards active. Report phase/category and preserve assertion evidence.
- [x] Test a child exceeding its budget is terminated and classified timeout;
  malformed/no worker output is a process failure, never a pass.
- [x] Implement bounded child I/O, deterministic indexed worker scheduling,
  seed/start/count/jobs/timeout options, and JSON/PS finding output. Save authority,
  original program, tape, seed and error, never a generated expected board.
- [x] Add `explore` npm wiring, usage docs and a small successful CLI smoke run.

## Task 4: Reduction and saved-case replay

**Files:** Create `typescript/test/exploration/shrink.mjs`; extend exploration
tests and CLI.

- [x] Test actual oracle failure from the intentionally wrong candidate can be
  reduced while remaining error-free; removing the final triggering input must
  stop reproducing. Label this control as an injected test fault.
- [x] Test reduction never changes seed, never mutates the original, never accepts
  another failure category, and reports budget exhaustion/fixed point honestly.
- [x] Implement monotone simplifications: input/rule chunks, rows/columns, optional
  cell occupants and object/property declarations with dependent references.
- [x] Implement `--replay FILE` and `--shrink FILE` with bounded attempts/time;
  saved reduced JSON and `.ps` retain provenance and original failure signature.
- [x] Verify CLI replay of a generated valid case and meaningful negative controls.

## Task 5: Campaign, reports and readability

**Files:** Update semantic guide, TypeScript README/package scripts and this
audit; add a focused readability walkthrough.

- [x] Run `explore --seed interactions-2026-10-31 --cases 4096 --jobs 4` with saved
  logs/findings under `/private/tmp`. Count actual comparisons, exclusions,
  failures/timeouts, observation totals and meaningful unique source hashes.
- [x] Investigate any real discovery before changing implementation. Reduce and
  save it, distinguish source recovery/native crashes from port discrepancies,
  author explicit regressions and Markdown reports when supported by evidence.
- [x] Walk selected new games through property inference, live replacement and
  session/rigid rollback code. Document confusing boundaries and concrete future
  simplifications; preserve the current engine and cache implementation.
- [x] Run the full TypeScript and Labs suites, generated-export checks and diff
  checks. Independent spec and quality review must pass before integration.
- [x] Commit the task and integrate into local master without publishing the
  existing unrelated local cache commits.

## Completed evidence

- Added thirteen complete games and sixty-three authored cases: matching 7/33,
  session 6/30. All new sources compile with zero diagnostics. Canonical boards
  were reasoned before execution; independent review checked the derivations.
- Corrected two undo/RNG explanations during review and added replay cases that
  visibly distinguish consumed draws. Added a two-ellipsis relay/live-write game.
- Entire authored corpus: 65 games / 203 cases, 563 per-input observations. Native,
  independently compiled TypeScript and Labs-specific expectations all pass.
- Generated campaign: seed `interactions-2026-10-31`, indices 0–4095, four jobs,
  1,024 cases per family. All 4,096 passed, with 28,859 observations/operations and
  4,096 level loads; no exclusions, mismatches, exceptions or timeouts. Distinct
  source/rule-set/board counts: 4,027 / 104 / 3,566. The committed JSON report is
  `typescript/test/exploration/campaign-2026-10-31.json`.
- All thirty exploration tests pass. Negative controls detect compiler-only
  diagnostics, wrong flags/boards/RNG/history, native producer calls, worker
  timeouts, malformed reports and failed campaign accounting. A real injected
  return-flag mismatch reduces to one cell, no rules and one input; removing the
  last input stops reproducing. These controls are not real engine discoveries.
- Compiler reduction retains native error-free compilation, observed before
  candidate execution. Session reduction requires complete compiler agreement.
  This resolves the original plan's ambiguity about shrinking compiler failures.
- Check budgets include original validation and all candidate checks. The CLI
  does not validate the original twice. Search deadlines are checked between
  bounded worker calls; final confirmation has its own worker budget. The guide
  explicitly distinguishes this from a hard wall deadline or global minimum.
- Complete strict suite: 1,890 tests passed. Complete Labs suite: 1,039 passed,
  plus random solver replay, stale frontier, sparse paths and cached-AGAIN RNG
  checks. Existing compiler/oracle comparisons and all native fixture hashes stay
  intact. Production TypeScript, JS and native engine files are unchanged.
- Independent spec and quality review approved the authored fixtures. Exploration
  review found no false-green path; its remaining wiring/budget documentation
  points were implemented and rechecked. `typescript/READABILITY.md` records four
  source walkthroughs and concrete next refactors, without changing the engine.

Logs: `/private/tmp/ps-interactions-campaign{.log,.json}`,
`ps-interactions-full-ts.log`, `ps-interactions-full-labs.log`,
`ps-exploration-final-focused.log` and the red/green control logs under
`/private/tmp/ps-exploration-*`.

Final checks: the public npm command passed 16 generated cases and wrote a nested
JSON report; all 203 native fixtures and the generated-export check pass. All
updated documentation links resolve and pre-existing testdata bytes are identical.
Final independent exploration spec/quality review passes with no actionable
findings, including independently regenerated source/rule/board variety counts.
