# TypeScript reference port completion audit

The objective is the complete separate vanilla engine port, with explicit domain
values and runnable source scripts. Completing a compiler phase or a bounded
runtime replay does not complete the objective. This audit records actual
evidence. All requirements below are proven; the component plans retain the
earlier development history.

This table records the completed vanilla-branch checkpoints. The subsequent
[labs integration](2026-10-25-typescript-labs-integration.md) places that same
production implementation in `typescript/` on labs master. Its oracle is now an
unchanged, licensed fixture under `typescript/test/vanilla/`, with an additional
hash for the input/output source (22 files in total). No labs production source
is replaced; compare the integration against labs master when checking scope.

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Separate `typescript/` package; existing vanilla JS remains intact | Diff against `5a94bde1a5127a3a45306ea28598eba2874d446d` has no paths outside `typescript/` and port plan documents; `src/` diff is empty | Proven |
| Official vanilla authority, not labs | `oracle-source.json` pins the official revision and 21 hashes; implementation and independent reviewers verify every hash | Proven |
| Objects, cells, unnamed layers, movements and actual numeric enums | `src/model.ts`, rule/session models and direct algorithms; parent AST scan of 42 modules / 6,094 lines finds no bitwise operations, packed numeric arrays, generated code, `any`, implicit clock/random calls or external production imports | Proven |
| Independent source parser/compiler, complete game/assets/source identities | Reviewed whole-source compiler at `a3a971d3`, hardened test oracle at `f4592d09` and `ca4660fe`; exact semantic and diagnostic comparison on all 790 original sources | Proven |
| Complete compilation outcomes, diagnostics and recovery on all 312 compiler fixtures | 293 formed games, 16 Invalid, three Stopped; 284 Accepted / nine Declined; exact 899 raw calls / 728 recorded issues | Proven |
| All 478 simulation sources independently compile, including native accepted errors | All Accepted; exact 673 raw / 642 recorded issues, 21 errors and 99,076 final rules | Proven |
| Ordered random behavior, rigid issue #1206 and malformed orphan identity | Reviewed inference/lowering/schedule/runtime tests and actual source-compiled focused execution; explicit compatibility data, no encoded runtime cells; complete source-compiled corpus passes | Proven |
| Honest bug provenance | `test/repros/orphaned-object-bug-report.md` explicitly says newly constructed reproducer, not an existing game/corpus; records native logical state and its validation boundary | Proven |
| Default per-move oracle uses exact independently source-compiled game | Reviewed `48936d6c` + `c37859dd`: ownership RED→GREEN, complete game comparison before identity binding, native producer guards, installed native graph/session/storage/seeds protected | Proven |
| Retain full state, RNG, command/source, sound/persistence order, histories, checkpoints, screens and every AGAIN step | Existing comparisons retained and independently reviewed; complete source-compiled run passes every recorded input/AGAIN step and original final expectation across 20,034 observations | Proven |
| Complete 478 source-compiled per-input/AGAIN replay and original final expectations | Exec session 29095 exits zero; all 478 fixtures visited in order, 20,034 observations/operations and 525 loads; log and verified result JSON recorded below | Proven |
| Tiny direct source script and source-to-trace CLI | Reviewed `4b3bc691`: 21-line direct example, newly written Mouse mail game, 161-line CLI/view, 13 meaningful behavior/standalone tests, all required inputs/outcomes/AGAIN/seeds/source links | Proven |
| Native-free standalone execution | Both reviewers repeat the 89-file isolated-tree test: only 42 JS + 42 maps, CLI/view, source game/script and minimal ESM manifest; real board assertions, no native source/tests/node_modules, temporary tree cleaned | Proven |
| Strict types, all tests and all example commands on final code | Final CLI checkpoint: strict build and full suite 1,582/1,582, exit 0; 82 focused checks and all six example/trace commands pass; no production code changes afterward | Proven |
| Debug source maps and authored PuzzleScript rule links | Parent validates all 42 `.js.map` files against actual `src/` modules, no stale build files; whole compiler validates exact executable-to-authored-rule identities; actual compiled turn tests CLI command projection | Proven |
| Documentation describes runnable final API and actual limits | README describes the public source API, actual runnable commands, model/reading map and honest boundaries; final replay result and completed plan gates are recorded | Proven |
| Independent reviews and final representation/readability audit | Every implementation phase has spec and quality approval; final whole-port review approves `a60f874b` with no findings after inspecting production models/algorithms/compiler/oracle/CLI and independently running strict checking and the source example | Proven |

Parent representation evidence: `/private/tmp/typescript-production-representation-audit.log`.
Final replay: `/private/tmp/typescript-source-session-corpus.log`; verified result
`/private/tmp/typescript-source-session-corpus-result.json`. It started at
2026-10-24 22:27:26 UTC and was observed complete at 23:22:20 UTC, exit zero.
Log SHA-256: `15c2d5b145178be14578882e7b34fb94e05e6c9ced55c12580e43afe30be8a0e`.
Parent debug-map evidence: `/private/tmp/typescript-source-map-audit.log`.
Final static audit at `04879afc`: `/private/tmp/typescript-final-static-audit.json`.
It independently checks all 21 native hashes, unchanged production/native scope,
required artifacts, zero runtime dependencies, the full passing test summary and
an actual error stack mapped back to `src/random.ts`.
Compiler checkpoint evidence: `/private/tmp/typescript-source-compiler-full.log` and
the reviewed result sections in the component plans. Session adapter evidence:
`/tmp/source-session-*.log` and independent review reports in this task.

The migration full-suite wrapper encountered zsh's read-only `status` variable
after npm completed; its full passing summary was independently checked. The
subsequent final CLI/full-suite run has a directly captured exit 0 and 1,582/1,582
passing tests: `/private/tmp/typescript-source-trace-full-test.log`.

Known malformed-source host-failure boundaries for InPlace-relative movement and
empty aggregates remain documented. The port does not claim exact malformed
intermediate output outside those verified boundaries. The trace is a state/effect
inspection view, not a browser player, persistence format or every-match log.
