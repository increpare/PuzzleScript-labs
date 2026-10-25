# Static-analysis dynamic soundness audit

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, with failing oracle tests before implementation.

**Goal:** Find counterexamples to static certificates during real play, report claim coverage and explicit omissions, and exercise every playable level in the cached gallery corpus.

**Architecture:** Keep expensive checks in test-only modules. A shadow-level reference interpreter uses real lowered match/replacement code, always rechecks tuples, and never uses wake pruning or single-rule rescan certificates. Instrument actual rule/group invocations and stable replay boundaries. Record a coverage inventory independently of test success. Run each gallery game in an isolated, bounded child process and save deterministic reproductions and source hashes.

**Approved scope:** The user approved the proposed certificate-to-oracle mapping, within-turn checks, explicit skips, and all-level seeded gallery pass. Existing replay contracts remain in place. Runtime probes can falsify claims on exercised states; passing finite traces does not prove universal soundness.

## Tasks

- [x] Add a failing test that injects false match-interaction, self-disabling,
  idempotence, group single-pass, split, skip-mask, permanence and setup claims.
  Verify the oracle catches them, including movement-only churn with no final
  object change. Assert shadow probes restore the real board, movement, RNG,
  command queue and side effects.
- [x] Implement `src/tests/lib/static_analysis_intra_turn_oracle.js`: capped
  tuple enumeration, reference rule/group application, disposable shadow level,
  exact rule mapping, stable-boundary/setup tracking, restoration handling,
  per-certificate counts and explicit budgets/skips. Integrate opt-in probes into
  `runSimulationWithStaticChecks`, including startup rules and counterfactual
  replay isolation. Keep production engine behavior unchanged.
- [x] Add `src/tests/static_analysis_dynamic_coverage.js`: enumerate tag paths
  and fact families from reports; classify them as runtime checked, structural,
  partial or unchecked using an explicit registry. Unknown claims must be
  reported as unchecked, never silently considered covered. Test unknown tags,
  zero observations, restoration, and probe-budget reporting.
- [x] Add `src/tests/run_static_analysis_gallery_audit.js`: verify manifest
  source hashes, enumerate all playable levels, generate forward-only and mixed
  undo/restart seeded traces, run existing plus intra-turn contracts, save
  per-game progress, failures with source/level/seed/inputs, claim counts and
  skips. Bound child execution and support filtering/resume. Test manifest
  rejection and a tiny multi-level corpus with a message level.
- [x] Run the new adversarial tests and existing replay/analysis suites. Run
  every cached gallery level, investigate actual counterexamples, and preserve
  any soundness repair as a minimized regression before changing the analyzer.
- [x] Update soundness notes and Make targets with commands, exact coverage,
  exclusions and observed results. Run appropriate verification and a code review.

## Verification commands

`node src/tests/static_analysis_intra_turn_node.js`

`node src/tests/static_analysis_dynamic_coverage_node.js`

`node src/tests/run_static_analysis_gallery_audit_node.js`

`make static_analysis_tests`

`node src/tests/run_tests_node.js`

Gallery output belongs in `build/static-analysis-gallery-audit-2026-10-25/`;
durable findings belong in `docs/solver-forensics/` and soundness notes.

## Completed verification

18 oracle regressions passed with normal execution, unconditional group
execution, and match-interaction shortcuts disabled. The full analysis suite,
473 recorded intra-turn replays (15 expected analysis-unavailable), all 794
engine/compiler tests, and 625 synthetic rule pairs on 6,875 boards passed.
The gallery runner tests cover source hashes, all levels, seeded no-random
checks, configuration-sensitive resume, and actual watchdog interruption,
continuation and finalization. Final review found no remaining actionable issue.

The selected complete gallery runs cover all 1,571 playable levels in 141
analyzable cached games, 6,284 traces and 470,066 inputs. Cyber-Lasso remains
analysis-unavailable. Vertebrae uses a documented 100-probe override after the
1,000-probe game deadline; Rose uses a longer trace deadline. Neither timeout
was silently counted as a pass. No new static counterexample was found; two
old harness bugs were fixed. Program-flow and win-relevance facts remain
explicitly unchecked by general runtime oracles. See the dated forensic report.
