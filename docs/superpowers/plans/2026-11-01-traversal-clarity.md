# Traversal and orchestration clarity

Goal: make the existing conceptual representations easy to follow through the
compiler and turn calculation. Preserve pinned vanilla behavior, including
duplicate variant order, recovered-input boundaries, live writes and retry
effects. No new runtime representation, generic expansion framework or change
to the JS engine.

## Work

1. Collect property source cells once, then resolve RHS uses in authored order.
   Replace the append/splice expansion loop with an explicit pending queue and
   completed variants. One property site branches at a time; an empty choice
   erases that branch. Retain raw name identity and corresponding-cell checks.
2. Give movement expansion an explicit queue. Every eligible cell branches from
   the unchanged parent, using its first family term. Preserve duplicate paths.
   Express RHS inference as entity/family source-cell evidence, followed by the
   distinct single-family-event fallback. Keep family identities distinct.
3. Share recorded-gap coordinate traversal between row rechecking and cell
   replacement. Keep search separate. Rechecking validates gaps; unchecked
   replacement preserves its existing lazy errors and reads each cell live.
4. Name rigid retry restoration and state exactly what it restores and retains.
   Audit compiler and scheduling orchestration for useful naming/sequence fixes,
   without moving native diagnostic checkpoints.
5. Update the reading guide, review the whole path, run strict compatibility and
   generated per-operation tests, and integrate into local master.

## Completion gates

- [x] Property traversal and ordered expansion are explicit; focused source,
      order, empty-choice and recovered-shape tests pass.
- [x] Movement traversal and the two inference scopes are explicit; focused
      ordering, duplicate-site, ambiguity and family-identity tests pass.
- [x] Fixed-gap traversal is shared; live overlapping writes, zero-step rows,
      multiple gaps and checked/unchecked malformed tuples remain covered.
- [x] Rigid restore ownership is named; retry, random, command, sound,
      diagnostics and attempt-limit tests pass.
- [x] Independent specification review passes, followed by quality review; a
      final readability audit finds the scoped debt addressed without replacing
      it with abstraction overhead.
- [x] Strict build and full TS/semantic fixture suite pass against unchanged
      pinned vanilla authority; generated per-operation campaign has no mismatch.
- [x] Reading docs and verification evidence describe the final implementation.
- [ ] Local master integration, primary build/smoke and clean status verified;
      no push and no leftover test servers/processes.

## Verification

Before refactoring, run relevant existing behavioral tests. Add boundary tests
only for meaningful gaps found during inspection. Run focused tests after each
slice; wait for stable sources before the full suite or oracle campaign. Do not
change oracle schemas, expectations, hashes or quirks to make comparisons pass.

The pre-change focused baseline passed 247 tests. After compiler/retry changes,
the same selection plus the new recovered short-RHS movement case passed 248
tests (`/private/tmp/ps-traversal-focused.log`). The implementer's broader
movement/property/turn/compiler selection passed 216 tests, including all three
492-source intermediate corpus comparisons. The final movement scan cleanup was
rebuilt and its 64 focused cases passed again.

Independent specification and then quality reviews approved the compiler/retry
slice. They checked FIFO completion equivalence, the two movement evidence
scopes, empty property branches, raw name and cell identities, diagnostic/recovery
boundaries and exact retry field retention. Remaining row/cell loops express
actual cell-local semantics; no additional wrapper/type was needed.

The nearby compiler/scheduler audit retained the existing direct sequencing and
native diagnostic checkpoints. The compiler's formerly generic `finish` helper
now names property/spawn inference. Scheduling already directly shows random
candidate selection, deterministic settling and loop jumps; no rewrite is needed.

The recorded-row slice added eight API-boundary tests before production edits;
the matching/rules baseline passed all 70 cases. After extraction, the strict
build and 254 focused matching, application, turn, session and oracle tests
passed (`/private/tmp/ps-recorded-row-focused.log`). An independent parent rerun
of matching/rules/turn passed 103 cases
(`/private/tmp/ps-traversal-runtime-check.log`). Runtime specification review
approved checked validation, lazy unchecked errors, live reads and unchanged
match search.

Runtime quality review and a fresh whole-goal readability audit approved the
scoped result. That audit caught an obsolete reading-guide tail still describing
the two runtime changes as future ideas; it was corrected and re-reviewed.

The generated campaign used seed `traversal-clarity-2026-11-01`, 256 requested
cases, two workers and 15-second per-case limits. All 256 passed, with 1,744
per-operation comparisons and 256 level loads; there were no exclusions,
comparison failures, oracle exceptions, process failures or timeouts. It covered
255 unique sources, 52 unique compiled rule sets and 248 unique boards across
property pushing, live multirow writes, random/rigid and session/AGAIN families.
Report: `/private/tmp/ps-traversal-campaign.json`.

The final strict build passed. The full TypeScript and semantic-fixture suite
passed **2,160 tests, zero failures/skips**, in approximately 198 seconds:

```sh
npm --prefix typescript run build
node --test --test-concurrency=4 typescript/test/*.test.mjs src/tests/semantic-fixtures/fixtures.test.cjs
```

Log: `/private/tmp/ps-traversal-full.log`. The unchanged authority is vanilla
`57f9f6cba69f6aa52ed738d5aee1d709d0037648`. Comparisons include all 492 simulation
sources and 335 compilation sources, 30,121 movement variants, 106,392
property/spawn variants and 99,192 final executable rules. No oracle producer,
adapter, schema, manifest, expectation or quirk setting changed.

Local integration and primary-checkout smoke verification are pending.
