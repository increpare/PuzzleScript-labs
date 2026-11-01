# Direct movement choices implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent review and isolated oracle-adapter work. Parent owns the production algorithm and compiler integration. Do not build while another test process imports the generated module graph.

**Goal:** Enumerate each concrete movement assignment once in the order that survives vanilla's keep-last duplicate normalization, preserving final games and their behavior.

**Architecture:** Movement sites in one cell form an ordered chain: the first remaining entity/family term expands next and replaces every matching term in that cell. Different cells are independent. Vanilla enumerates all interleavings of those chains; the last interleaving drains the last cell first. Enumerate that order directly, retaining family-choice order and all source/header/origin evidence. Keep source rule inputs and selectors distinct until the existing final duplicate pass.

**Tech stack:** Strict TypeScript, ordinary arrays and loops, Node tests, frozen vanilla `57f9f6cba69f6aa52ed738d5aee1d709d0037648`.

## Compatibility contract

Final executable rules, their order, metadata/source links, displayed diagnostics,
error counts, stopping behavior and per-operation session observations remain
strictly compared with native. Native producers and the final compiler/game
projection are unchanged. Isolated intermediate-stage tests may compare native
movement paths after keep-last compaction per original named input; they must
still reject missing alternatives, wrong surviving order and changed inference.

The user explicitly allows fewer identical raw property-error visits while
requiring displayed diagnostics, error counts, stopping and game behavior to
remain identical. Normalize only identical ambiguous-property runs in the raw
oracle projection; retain distinct raw issues and recorded diagnostics exactly.

## Task 1: Establish the direct choice contract

Files: `typescript/test/direct-movement-choices.test.mjs`,
`typescript/test/rule-movements.test.mjs`, test-only native movement projection.

- [x] Confirm the focused pre-change movement/type baseline.
- [x] Write and run a failing direct-expansion test. For
      `right [ horizontal Player | vertical Crate ] -> [ horizontal Player | vertical Crate ]`,
      require exactly `Left/Up, Right/Up, Left/Down, Right/Down` (four choices).
      The current eight-result implementation must fail this assertion.
- [x] Cover within-cell family order, repeated same-cell terms, bracket-row order,
      different family identities and distinct source inputs with the native
      keep-last projection. Keep the old native eight-path witness as reference
      evidence, not the new production contract.

## Task 2: Replace expansion histories with direct choices

File: `typescript/src/rule-movements.ts`.

- [x] Scan rows and cells in reverse order, choosing the first remaining family
      term within that cell. Use the existing replacement and inference evidence.
- [x] Expand each cell's choices before visiting earlier cells. The implementation
      uses a small recursive `chooseCellMovements` function; every recursive step
      removes one entity/family pair from that cell:

```ts
partials = partials.flatMap(parent => chooseCellMovements(parent, sourceCell));
```

- [x] Remove the FIFO/all-interleavings driver. Preserve local RHS transport,
      unique entity/family source-cell inference and single-family-event fallback.
      No weights, masks, caches, sorting keys or generic expansion framework.
- [x] Run the new tests and existing finite qualifier/type contracts.

## Task 3: Adapt intermediate probes deliberately

Files: `typescript/test/legacy-rule-movements.cjs`,
`legacy-rule-properties.cjs`, `legacy-rule-duplicates.cjs`,
`legacy-rule-lowering.cjs`, `legacy-source-schedules.cjs`,
their tests, and a small shared test-only native compaction helper if needed.

- [x] Compact native movement paths per original named input before giving them
      to isolated later-stage probes. Preserve the full original native path
      producer for the reference witness and count both paths and direct choices
      when useful. Never populate expected data from candidate rules.
- [x] Replace guards that reject any Cartesian expansion with guards rejecting
      wrong surviving order, omitted choices and premature merging across input
      rules. Update only intermediate counts demonstrated by the native probe.
- [x] Resolve the raw-diagnostic contract from the user's answer. Add a concrete
      erroneous-source case with two movement cells and an ambiguous RHS property,
      guarding recorded diagnostics, rejection, stopping and allowed raw evidence.
- [x] Keep final compiler, executable-field and per-operation oracle checks strict.

## Task 4: Review and broad verification

- [x] Independent mathematical/spec review of interleaving elimination and its
      diagnostic boundary, then independent code quality review.
- [x] Strict build and all TS/semantic-fixture tests:

```sh
npm --prefix typescript run build
node --test --test-concurrency=4 typescript/test/*.test.mjs src/tests/semantic-fixtures/fixtures.test.cjs
```

- [x] Generated per-operation campaign with at least 256 cases, no exclusions or
      timeouts counted as passes; compare all final flags, RNG, history and effects.
- [x] Update `typescript/FRONTEND.md`, `READABILITY.md`, `README.md` and this record
      to explain direct choice order and any intentional diagnostic-trace change.
- [ ] Integrate into local master after passing checks; rebuild and run focused
      smoke tests there. Preserve unrelated work and do not push.

## Evidence

The focused pre-change movement/type baseline passed 70 tests. Both new direct
choice tests failed against the old implementation: eight results instead of
four, and 24 instead of eight for mixed within-cell families plus another
bracket. After replacing the driver, strict build and eight direct/type tests
passed (`/private/tmp/ps-direct-movement-red.log`,
`/private/tmp/ps-direct-movement-green.log`).

Independent derivation: a cell has a fixed chain of distinct exact-name/family
events, in first-term order. Replacing one event removes that pair and cannot
introduce another family, so every history has the same depth. Native FIFO
enumerates all interleavings of the cell chains. For each concrete assignment,
its last history drains the last cell's chain first, then earlier cells. Those
last histories all use the same chain order, so enumerating only them retains
the surviving assignment order. Distinct assignments differ in a concrete LHS
qualifier; local and distant RHS inference do not depend on cross-cell event
order. Raw identifier and family identity remain significant.

An independent read-only prototype checked eight targeted alias, aggregate,
orientation, repeated-source and same-cell-family cases against native per-input
keep-last results, including 160 native histories to 40 direct choices and 48 to
eight. Source, commands and origin identities were preserved.

The user explicitly approved fewer identical raw repeats after the concrete
eight-versus-four property-error probe; one recorded error and the native
acceptance/count/stop behavior remain required. No derivation weights or native
history fallback are introduced in production.

Adapter migration preserves actual native final compilation. Isolated stage
oracles compact native histories per named input and retain owner/identity guards.
New raw-trace controls preserve every differing line, severity, count/urgency
flag and intervening issue, and every repeat of unrelated diagnostic kinds.
The actual compilation regression has eight native raw issues and four port
issues, one recorded error, errorCount one and the same Accepted outcome.

The adapter measurement passed every source comparison. Five old aggregate
count assertions were then updated from native-verified measurements: movement
30,121 → 30,007; property/spawn 106,392 → 106,122; compilation raw issues
876 → 872. Recorded compilation issues remain 705; Accepted/Declined/Invalid/
Stopped totals remain 306/9/17/3. Duplicate survivors (99,567), lowered rules
(99,443) and final executable rules (99,192) are unchanged. A focused rerun of
the new order/trace guards passed 15 tests.

A new ordinary source game in `frontend-transformations.test.mjs` makes both
Right/Up and Left/Down Player/Crate pairs eligible for a random rule. At seed
`frontend-0`, native and the direct compiler remove the Right/Up pair and leave
`....... / #..P... / .....C.`. The separately labeled counterfactual swaps the
middle variants and leaves `..C.... / #.P.... / .......`. All 12 direct-choice
and transformation witness tests passed
(`/private/tmp/ps-direct-movement-witness.log`). Independent specification review
approved the proof, production change and native adapter boundaries. Independent
code quality and whole-slice review also approved the final implementation,
negative controls and ordinary-game witness, with no actionable findings.

The generated campaign passed all 256 requested cases, 1,791 per-operation
comparisons and 256 level loads. There were no exclusions, comparison failures,
oracle exceptions, process failures or timeouts. Seed
`direct-movement-2026-11-01`, two workers and 15-second case limits covered 255
unique sources, 52 rule sets and 238 boards across the four existing source
families. Report: `/private/tmp/ps-direct-movement-campaign.json`.

The final strict build and full TypeScript/semantic-fixture suite passed **2,173
tests, zero failures/skips**, in approximately 189 seconds. Log:
`/private/tmp/ps-direct-movement-full.log`. This verifies the revised intermediate
totals plus actual final compilation for all 492 simulation and 335 compilation
sources, including final rules, recorded diagnostics, error counts and stopping
outcomes. The frozen native sources, authority manifest and pinned revision are
unchanged. Local integration and primary-checkout smoke verification remain.
