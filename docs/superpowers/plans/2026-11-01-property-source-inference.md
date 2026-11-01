# Property source inference implementation plan

> **For agentic workers:** Execute the approved model with red/green helper
> contracts, preserved compiler oracles and independent specification/quality
> review. The user approved the source relationship model with “That sounds
> clear, yes.” Existing local integration authorization applies; no push.

**Goal:** Make object-source inference independent of rule expansion strategy.

**Architecture:** Resolve each RHS property use to its corresponding LHS cell,
otherwise its sole eligible LHS cell, otherwise Missing or Ambiguous. Resolution
knows cell addresses only. Rule construction separately chooses property members
and applies the source links to copied RHS terms after ordered expansion.

**Tech stack:** Strict TypeScript, Node tests, pinned vanilla 57f9f6cb and the
existing independent compiler/per-operation oracles.

## Approved boundary

```typescript
interface RuleCellAddress {
  readonly rowIndex: number;
  readonly cellIndex: number;
}
enum ObjectSourceKind { Resolved, Missing, Ambiguous }
type ObjectSource =
  | { readonly kind: ObjectSourceKind.Resolved; readonly cell: RuleCellAddress }
  | { readonly kind: ObjectSourceKind.Missing }
  | { readonly kind: ObjectSourceKind.Ambiguous; readonly cells: readonly RuleCellAddress[] };
```

`resolveObjectSource(candidates, targetCell)` takes no layer, chosen member or
expansion strategy. It prefers a candidate at the target address, then counts
distinct source addresses using both indices. Repeated terms in one cell remain
one source; different cells agreeing on a member do not become one source.

Property names remain distinct even with equal member lists. Negative property
expansion precedes candidate collection, and random-object terms supply no
source. Keep the existing single-layer/unlayered expansion decisions outside
the resolution type. Do not change movement inference in this slice.

## Files and steps

### 1. Baseline and semantic feasibility

- [x] Reuse the clean isolated worktree on branch
  `codex/typescript-property-sources`, based on `caaeea09`.
- [x] Build and run the focused property/movement/type baseline: **135 passed**.
  Log: `/private/tmp/ps-property-sources-baseline.log`.
- [x] Independently review deferred RHS construction against the native compiler.
  Finite native normalization removes property-to-property alternatives. A
  read-only probe checked all **827 sources**, **3,564 normalized properties**,
  **19,029 alternatives**, with zero violations or resolver failures.

The finite-normalization argument does not claim behavior for hand-built cyclic
dictionaries where native normalization itself would not terminate. Preserve
the explicit missing-LHS-cell TypeError boundary in standalone recovered-stage
tests; do not silently turn malformed shape into an empty source collection.

### 2. Source-cell helper and type contracts

Files: new `typescript/src/rule-object-sources.ts`,
`typescript/test/object-sources.test.mjs`,
`typescript/test/object-source-types.test.mjs`.

- [x] Add tests before implementation and observe missing exports/module red.
- [x] Implement the three-case resolver and `sameRuleCell` using direct loops,
  ordinary addresses and numeric enum tags. Preserve candidate order and input
  ownership; no generic framework or value-based consensus.
- [x] Verify local preference, unique remote source, Missing, ordered ambiguity,
  repeated addresses, different bracket rows, different cells and frozen inputs.
- [x] Verify strict temporary TypeScript programs require each case's payload
  and reject reading a resolved cell from Missing. Build and **11 checks pass**.
- [x] Independently review actual helper and its contracts.

### 3. Integrate source analysis with rule construction

Files: `typescript/src/rule-properties.ts`,
`typescript/test/rule-properties.test.mjs`.

- [x] Add source-compiled characterization fixtures for unique cross-row source,
  repeated terms in one cell, same cell indices in distinct rows, and empty
  branches suppressing Missing/Ambiguous RHS diagnostics. Run against the old
  implementation before integration; keep native expected data unchanged.
- [x] After the existing negative sweep, collect property-specific LHS candidate
  addresses and RHS use records `{property, targetCell, source}`. Resolve all
  uses with the helper, preserving RHS term order and raw property identity.
- [x] Derive the need for concrete expansion from the source links: any remote,
  Missing or Ambiguous use requires member choices. Existing property-layer
  analysis supplies the other expansion conditions.
- [x] Preserve first eligible property/cell selection, append/remove worklist
  order and duplicate alternatives. Replace firstMember/expandedCells summaries
  with ordered selections `{property, sourceCell, member}` per variant.
- [x] Construct RHS rows once from their original terms and resolved links.
  A selected source supplies its member; an unexpanded local source remains a
  property predicate. Resolution itself has no predicate-versus-choice cases.
- [x] Diagnose remaining remote properties after all variants are constructed.
  Empty branches can erase the family first. Preserve native last-ambiguity
  selection, messages, source spans, qualifier domains, origins and recovery.
- [x] Run focused native property/spawn and rule-pass checks, including complete
  ordered sequences, immutability and corruption controls. Preserve the missing
  corresponding-LHS-cell TypeError category.
- [x] Independently review specification compliance and then code quality.

### 4. Verify, document and integrate

- [x] Run the full strict suite once source is stable:

  ```sh
  npm --prefix typescript run build
  node --test --test-concurrency=4 typescript/test/*.test.mjs src/tests/semantic-fixtures/fixtures.test.cjs
  ```

- [x] Run a reproducible 256-game per-operation campaign:

  ```sh
  node typescript/bin/explore.mjs --seed property-source-inference-2026-11-01 --cases 256 --jobs 2 --timeout-ms 15000 --out /private/tmp/ps-property-sources-findings --json /private/tmp/ps-property-sources-campaign.json
  ```

- [x] Reuse the authored local-property-overlap and unique-multirow-transfer
  full-session witnesses, which run in the strict semantic suite. Do not repeat
  the unrelated expensive recorded AGAIN audit from the previous slice.
- [x] Update `typescript/READABILITY.md` and `typescript/FRONTEND.md` to explain
  source resolution followed by construction. Record actual verification here,
  keeping the prior turn audit and historical replays distinct.
- [ ] Commit verified work and fast-forward local master. Build and run focused
  primary-checkout integration checks. Preserve unrelated commits, native
  references, expected fixtures, runtime code and JavaScript implementation.

## Review requirements

The pure helper must be understandable without reading rule expansion. The
property pass must show which LHS cell supplies each RHS use without requiring a
reader to decode occurrence counters. Source data never leaks into executable
rules or terms. Compatibility is checked by independent native producers, not
by having the candidate derive its expected output.

## Execution evidence

- Helper/type red: missing module/exports before implementation. The new
  three-case helper and strict negative payload/readonly contracts pass
  **11 tests**. It receives no layer, property name or chosen member.
- Six additional source-compiled characterization cases passed the original
  property implementation before integration: unique cross-row source,
  repeated terms in one source cell, different rows sharing a cell index,
  corresponding-cell preference, and empty-branch suppression of both Missing
  and Ambiguous diagnostics. The focused property file passed **77 checks**.
  Log: `/private/tmp/ps-property-sources-characterization.log`.
- After integration, **152 focused checks passed**, including movement/property
  oracles, source contracts and finite rule-pass contracts. Log:
  `/private/tmp/ps-property-sources-focused.log`.
- Independent design audit validated finite native normalization and the
  recovery/ordering boundaries. Independent implementation specification and
  code-quality reviews approved the actual helper, source links, construction,
  tests and native behavior without actionable source findings.
- Documentation review approved the source/selection distinction, local
  preference, normalization scope and unchanged movement inference. Its one
  stale optional-work sentence was corrected to name only runtime helpers.
- Code checkpoint: `9db4f91b`. Full strict suite: **2,151 passed**, no failures,
  about 257 seconds with four workers. Log:
  `/private/tmp/ps-property-sources-full.log`.
- The unchanged native property oracle compares all **492 play-source fixtures**,
  **30,121 incoming movement variants**, **106,392 complete property variants**
  and their **106,392 spawned-stationary variants**, including sequence,
  qualifiers, raw names, diagnostics, source origins and ownership. The full
  suite also preserves all **335 compilation fixtures** and **99,192 final
  executable-rule comparisons**.
- Generated campaign: **256/256 passed**, **1,780 observations/operations**,
  **256 loads**, **250 distinct sources**, **35 rule sets**, **234 boards**.
  Zero exclusions, discrepancies, oracle exceptions, process failures or
  timeouts. Seed: `property-source-inference-2026-11-01`. Report:
  `/private/tmp/ps-property-sources-campaign.json`.
- Native producers/expectations/hashes and all runtime/JavaScript code are
  unchanged. No new bit representation, generated matcher or runtime binding
  was introduced. No preview server or unrelated recorded-AGAIN replay was run.
