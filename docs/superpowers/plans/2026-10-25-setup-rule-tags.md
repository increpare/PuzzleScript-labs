# Setup Rule Tags Implementation Plan

**Goal:** Recognize setup rules conservatively and expose auditable proof details without changing rule scheduling or solver execution.

**Architecture:** Add a focused setup-analysis module using the normalized cell IR and existing object write/movement tags. Separate local self-disabling and idempotence proofs from whole-program permanence and setup dependency proofs. Emit four boolean rule tags and a `rule_setup` fact per rule, including blockers, cell witnesses, dependencies, and a conditional retirement boundary. The analyzer's subsequent extraction into the shared runtime places the helper at `src/js/static_analysis_setup.js`, alongside `src/js/static_analysis.js`; the Node adapter remains `src/tests/ps_static_analysis.js`.

**Scope:** Fixed-width, single-row concrete-object replacements first. Properties, ellipses, multiple independently positioned rows, movement, random selection, rigid execution, and commands remain conservative where their effects prevent a proof. Setup chains are proved in dependency order. All rules participate in the interference index, including cosmetic and late rules. Retirement is conditional on committed setup quiescence and must be reconsidered after undo, restart, level reload, or snapshot restoration.

## Tasks

- [x] Add hand-reasoned table tests before implementation. Cover guarded/unguarded creation, consumed placeholders, stable and moving anchors, erasure/overwrite/movement, signed and cell-local guards, randomness, commands, rigid groups, multi-cell overlap, aliases, unsupported forms, and setup chains/cycles. Run `node src/tests/static_analysis_setup_node.js` and verify failure on missing tags.
- [x] Implement `src/js/static_analysis_setup.js`; wire tagging into `buildPsTagged` and certificates into the `rule_setup` family in the shared analyzer. Re-run the new tests and existing analyzer suite.
- [x] Document the four tags in `src/tests/static_analysis_claim_descriptions.json`, update the runner vocabulary assertion, and add hand-authored whole-source fixture pairs under `static_analysis_testdata/rule_tags/`. Keep `human_verified: false`.
- [x] Check certificates, family-filter independence, negative proof explanations, and real-engine behavior, including delayed setup and dependency chains that take multiple turns. Enumerate small boards for claimed local properties.
- [x] Run analyzer, fixture runner, explorer, optimizer, soundness/adversarial, canonical parity, runtime-contract, performance, and engine regression suites. Review the final diff for overclaims and unrelated changes before integrating the patch into the original checkout.

## Validation contract

`self_disabling` describes the applied tuple immediately after replacement. `persistent_guard` establishes an irreversible object-presence/absence witness during forward play. `idempotent_effect` requires an exhaustive deterministic command-free invocation to reach a fixed point without external interference; it does not authorize changing scheduling. `setup_only` requires a permanent disabling witness or permanent idempotent effects and eligibility that becomes invariant after already-proved setup dependencies settle. Certificates explicitly retain the quiescence condition; the tags never assert that the initial raw level has already been initialized.

## Review findings covered by regressions

- Movement can survive same-layer replacement. Permanence conservatively treats every member of a cardinal-moving collision layer as movable.
- An inferred or explicit stationary assignment can repeatedly suppress another rule's action state after object writes saturate. The idempotent retirement route checks positive movement and action interference on every RHS stationary layer. Permanent self-disabling guards remain a separate valid retirement route.
- Coverage includes 66 table cases, 24 whole-source fixture pairs, 34,560 exhaustive runtime board/movement configurations, and 21 ordinary-vs-retired forward-play replays. The explorer exposes all four tags and certificate explanations.

## Final validation

- `make static_analysis_tests` passed, including all 473 runtime-contract cases (15 intentionally analysis-unavailable), consistency, canonical parity, optimizer and explorer checks.
- `node src/tests/run_tests_node.js` passed all 794 simulation/compilation regressions and its auxiliary suites.
- `node src/tests/static_analysis_performance_node.js` passed.
- The integrated checkout passed analyzer, setup (81,019 assertions), fixture runner, explorer model/runtime and `git diff --check` checks. The `--family rule_setup` CLI smoke check proved the guarded setup fixture.
- Changes are integrated into the original checkout; unrelated work was preserved.
