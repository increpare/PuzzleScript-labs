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

- [ ] Matching author: six error-free games and at least eighteen hand-authored
  cases covering property binding with live overlap, multirow aliases and one/two
  ellipses. Explain every board and non-obvious iteration/order decision.
- [ ] Session author: six error-free games and at least eighteen cases covering
  rigid RNG retries and AGAIN with checkpoint, cancel, restart and undo. Explain
  draw order; explicitly declare Labs overrides where cached RNG differs.
- [ ] Verify each family with `verify-native.cjs FILTER` and the TypeScript
  semantic test file. Do not edit exports or central guide concurrently.
- [ ] Parent reviews semantics, exports with `export.cjs`, verifies original
  testdata prefix, then runs all authored cases in vanilla, TS and Labs.

## Task 2: Source model and deterministic generator

**Files:** Create `typescript/test/exploration/program.mjs`, `generate.mjs`, and
`typescript/test/exploration.test.mjs`.

- [ ] Test a hand-written model rendering a complete error-free game; test that
  distinct object sets get distinct legal glyphs and the model remains unchanged.
- [ ] Test `generateProgram(seed, index)` returns identical models across repeated
  calls and shuffled indices; different indices vary rules/boards, not just titles.
- [ ] Implement ordinary arrays/names for objects, properties, layers, rule text,
  cell occupants and inputs. Require rectangular nonempty boards and defined
  object identities, and render background/legend explicitly.
- [ ] Implement bounded families: pushing/property transfer, live multirow/ellipsis,
  random groups/rigid retries, and session commands/AGAIN. Choose small dimensions,
  initial placements, rule variants, seeds and short tapes deterministically.
- [ ] Run the new tests; keep native/candidate PRNG implementations out of case
  construction and test no mutation of model inputs.

## Task 3: Independent checker and isolated runner

**Files:** Create `typescript/test/exploration/check.mjs`, `worker.mjs`,
`process.mjs`, and `typescript/bin/explore.mjs`.

- [ ] Test an ordinary model is compared through compilation and every session
  observation; a deliberately wrong candidate modified flag must fail comparison.
- [ ] Test candidate-only compiler diagnostics are failures, never invalid-case
  exclusions. Shared invalid programs are counted separately.
- [ ] Implement `createProgramChecker(overrides = {})` using complete source
  compiler comparison first and the existing session oracle second. Keep native
  producer guards active. Report phase/category and preserve assertion evidence.
- [ ] Test a child exceeding its budget is terminated and classified timeout;
  malformed/no worker output is a process failure, never a pass.
- [ ] Implement bounded child I/O, deterministic indexed worker scheduling,
  seed/start/count/jobs/timeout options, and JSON/PS finding output. Save authority,
  original program, tape, seed and error, never a generated expected board.
- [ ] Add `explore` npm wiring, usage docs and a small successful CLI smoke run.

## Task 4: Reduction and saved-case replay

**Files:** Create `typescript/test/exploration/shrink.mjs`; extend exploration
tests and CLI.

- [ ] Test actual oracle failure from the intentionally wrong candidate can be
  reduced while remaining error-free; removing the final triggering input must
  stop reproducing. Label this control as an injected test fault.
- [ ] Test reduction never changes seed, never mutates the original, never accepts
  another failure category, and reports budget exhaustion/fixed point honestly.
- [ ] Implement monotone simplifications: input/rule chunks, rows/columns, optional
  cell occupants and object/property declarations with dependent references.
- [ ] Implement `--replay FILE` and `--shrink FILE` with bounded attempts/time;
  saved reduced JSON and `.ps` retain provenance and original failure signature.
- [ ] Verify CLI replay of a generated valid case and meaningful negative controls.

## Task 5: Campaign, reports and readability

**Files:** Update semantic guide, TypeScript README/package scripts and this
audit; add a focused readability walkthrough.

- [ ] Run `explore --seed interactions-2026-10-31 --cases 4096 --jobs 4` with saved
  logs/findings under `/private/tmp`. Count actual comparisons, exclusions,
  failures/timeouts, observation totals and meaningful unique source hashes.
- [ ] Investigate any real discovery before changing implementation. Reduce and
  save it, distinguish source recovery/native crashes from port discrepancies,
  author explicit regressions and Markdown reports when supported by evidence.
- [ ] Walk selected new games through property inference, live replacement and
  session/rigid rollback code. Document confusing boundaries and concrete future
  simplifications; preserve the current engine and cache implementation.
- [ ] Run the full TypeScript and Labs suites, generated-export checks and diff
  checks. Independent spec and quality review must pass before integration.
- [ ] Commit the task and integrate into local master without publishing the
  existing unrelated local cache commits.
