# Explicit rule recovery and rich errors

> **For agentic workers:** Use superpowers:subagent-driven-development for the recovery implementation and independent specification/quality reviews. Parent owns rich inference evidence and documentation; coordinate builds after all source edits are stable.

**Goal:** Make rule retention and compilation stopping explicit, and expose structured rule-shape and inference problems without parsing diagnostic prose.

**Architecture:** Rule syntax has one structural Pattern kind and a three-case recovery result: Keep, Discard(cause), or KeepForDiagnostics(causes). Severity stays on diagnostics. Rule expansion returns Ready rules or Blocked with an actual checkpoint and diagnostic causes. Shape and inference diagnostics gain finite typed problem payloads; legacy displayed messages and primary reporting spans stay unchanged.

**Compatibility:** Preserve pinned vanilla final games, recorded messages/order/counts, acceptance and stopping, including aggregate-before-syntax-stop and property-after-movement-error checkpoints. Preserve the already approved allowance for fewer identical raw property-error repeats. Frozen native sources and manifest remain unchanged. New AST/result/diagnostic fields are intentional typed API changes and require exact adapter/schema checks.

## Recovery inventory

| Example rule | Decision | Severity/continuation |
| --- | --- | --- |
| `[ Player ] -> [ Player ] up` | Keep | Warning; ordinary compilation continues |
| `[ > up Missing Player ] -> [ Player ]` | Keep | Error diagnostics; severity does not discard it |
| `[ Player ] ] -> [ Player ]` | Discard | Warning for excess close; next rule still compiles |
| `[ Player ] ->` | Discard | Warning for unequal row counts |
| `[ Player ] -> [ Player ] -> [ Player ]` | Discard | Error for second arrow |
| `[ Player ] (cut) -> [ Player ]` | Discard | Comment hides the arrow from compiler capture |
| `right [ Player | Crate ] -> [ Player ]` | KeepForDiagnostics | Retained until the aggregate checkpoint, then blocks compilation |
| `random` | Keep | Errors and no selectors; empty schedule survives |
| `[ Player ] -> [ horizontal Player ]` | Movement failure | Property/spawn analysis still runs before compilation is blocked |

Retained patterns, including those with errors or a blocking recovery result,
become the predecessor for a following `+` group. Discarded patterns and loops
do not. Line highlighting follows syntax severity, independently of retention.

## Tasks and completion gates

- [x] Run focused baseline rule syntax/compiler/property/movement tests.
- [x] Write failing behavior/type tests for recovery cases, diagnostic cause
      identity, rule-shape counts/spans and inference source evidence.
- [x] Replace retained/abortsCompilation/Invalid-pattern combinations with
      RuleRecovery. Keep every existing source token, term and command identity.
- [x] Replace syntax abort booleans with diagnostic blockers; return a tagged
      expansion result carrying the actual stopping checkpoint and causes.
      Expose typed failures from complete and rule-only compiler entry points.
- [x] Add RuleProblem payloads for row/cell mismatches, ambiguous property and
      ambiguous movement. Preserve the old primary span/message and add exact
      target locations and source candidates as separate evidence.
- [x] Explicitly adapt existing schema guards and native projections. New fields
      are checked rather than ignored wholesale; recorded diagnostics and final
      executable fields remain strict.
- [x] Verify the recovery inventory, first movement/last property diagnostic
      selection, empty-branch suppression, source identity and stopping limits.
- [x] Independent specification review, then quality/readability review.
- [x] Strict build and full TS/semantic-fixture suite pass:

```sh
npm --prefix typescript run build
node --test --test-concurrency=4 typescript/test/*.test.mjs src/tests/semantic-fixtures/fixtures.test.cjs
```

- [x] At least 256 generated per-operation cases pass with no exclusions,
      comparison failures, oracle exceptions or timeouts.
- [x] Update frontend/readability/API docs with a concrete rich error example.
- [x] Integrate into local master, run primary build/focused smoke, verify clean
      checkouts and completed test processes. No push or preview server.

## Rich diagnostic scope

`RuleProblemKind` has four cases: RowCountMismatch, CellCountMismatch,
PropertyInference and MovementInference. The first two carry LHS/RHS counts and
authored row evidence. Property inference carries the chosen diagnostic's name,
RHS target, pure ObjectSource result and candidate locations. Movement inference
carries its entity/family, RHS target and exact-name/family source evidence;
equal selected directions never establish uniqueness. Other diagnostics keep
their existing codes, severity and source spans; no untyped context dictionary or
exception hierarchy is added.

## Evidence

The focused baseline passed 384 tests. Six rich-payload tests failed against the
old implementation with the expected missing `diagnostic.problem` assertion;
recovery behavior and type tests also failed before implementation. The first
coordinated strict build and 439 focused existing/recovery tests then passed.

The private syntax diagnostic builder now takes named options rather than six
positional arguments, preserving omitted-span fallback and explicit null. That
refinement passed strict build and 213 focused tests. Complete compiler rule
failures expose `failure.checkpoint`/`causes` directly; its flat-field schema,
identity and type contracts passed strict build and 56 focused tests.

All nine rich-evidence tests pass, including distinct entities in one family
cell, repeated properties counting once per source cell, last RHS target
selection, and oriented cell coordinates retaining authored spans after row
reversal (`/private/tmp/ps-rich-errors-final-focused.log`).

`npm --prefix typescript run example:errors` prints the unchanged native message,
row counts two versus one, exact bracket locations at 36:7 and 36:29, and the
actual AfterAggregateExpansion checkpoint. It reads typed data only.

Independent specification review approved recovery, cause identity, checkpoints,
evidence/schema validation and the flat complete failure. Independent quality
review approved source, callers, types, adapters, tests, reading docs and example,
with no actionable findings.

The generated campaign passed all 256 requested cases, 1,754 per-operation
comparisons and 256 level loads. There were no exclusions, mismatches, oracle
exceptions, process failures or timeouts. Seed `rich-rule-errors-2026-11-01`, two
workers and 15-second case limits covered 254 unique sources, 52 rule sets and
241 boards. Report: `/private/tmp/ps-rich-errors-campaign.json`.

The first full suite passed 2,194 of 2,195 tests, including every native corpus
comparison. Its sole failure was an existing Unicode regression still asserting
the removed syntax `abortsCompilation` flag. That assertion now checks the exact
blocking code, original diagnostic identity and recovered 2-versus-3 cell counts;
all 22 Unicode tests pass (`/private/tmp/ps-rich-errors-unicode.log`). Independent
quality re-review approved this test-only migration as a stronger check.

The final strict suite rerun passed **2,195 tests, zero failures/skips**, in
approximately 289 seconds (`/private/tmp/ps-rich-errors-full-final.log`). All
492 simulation and 335 compilation sources retain their final rules, recorded
diagnostics, error counts, installation outcomes and stopping behavior. Native
authority is unchanged: vanilla `57f9f6cba69f6aa52ed738d5aee1d709d0037648`.
Commit `e3fc03be` was fast-forwarded into local master. The primary checkout's
strict build, rich error example and 328 focused recovery/evidence/type/syntax/
reader/compiler/Unicode tests passed, with zero failures/skips
(`/private/tmp/ps-rich-errors-master-smoke.log`). Both checkouts were clean after
integration; this final documentation-only record completes verification. The
existing reusable worktree remains on `codex/typescript-rich-rule-errors`.
No push or preview server was started; all launched tests and campaigns completed.
