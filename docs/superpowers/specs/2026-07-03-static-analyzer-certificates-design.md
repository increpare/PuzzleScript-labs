# Static Analyzer Certificates Design

## Summary

Implement the first, analyzer-only milestone from
`docs/solver-forensics/2026-07-03-static-analyzer-extension-proposals.md`.
This milestone covers S1, S2, and S12 as certified static-analysis facts:

- S1: expose the analyzer's precise rule read/write model as signed wake-mask
  facts.
- S2: extend `rulegroup_flow` with conservative group scheduling certificates,
  starting with `single_pass_safe`.
- S12: derive a solver-scoped `win_relevance` slice from existing `program_flow`
  and `winflow` facts.

The milestone does not change engine, solver, or native runtime behavior. It
ships facts, documentation, and extensive fixtures so later optimization work
has a reviewed contract to consume.

## Goals

- Add machine-readable analyzer facts that are conservative enough for future
  runtime or solver consumers.
- Reuse the existing wake-edge algebra in `ps_static_analysis.js` rather than
  inventing a parallel rule model.
- Add comprehensive fixture coverage for every new fact field.
- Document every fixture field in `static_analysis_claim_descriptions.json`.
- Keep native parity and runtime consumption explicitly deferred until the JS
  facts are fixture-backed and stable.

## Non-Goals

- Do not enable engine inner-loop movement-aware pruning.
- Do not enable outer-loop group skipping.
- Do not add solver rule-pruning passes.
- Do not modify native static analysis.
- Do not change generated `bin/` output.

## Architecture

All implementation work lives in the JS static-analysis and testdata stack:

- `src/tests/ps_static_analysis.js` derives the new facts.
- `src/tests/static_analysis_claim_descriptions.json` documents fixture fields.
- `src/tests/static_analysis_testdata_runner.js` generates and validates
  fixture projections.
- `src/tests/static_analysis_testdata/` gains new fixture directories or fields.

The core analyzer representation remains `ps_tagged`. Rules, groups, win
conditions, and existing fact families keep their current identifiers and shape.
New facts reference existing rule ids and win ids so fixture rows can map them
back to source lines and text.

## S1: Certified Wake Masks

Add a new fact family named `certified_wake_masks`.

It emits one proved fact, `rule_wake_masks`, with a value shaped for audit and
future runtime conversion:

```json
{
  "rules": [
    {
      "rule_id": "early_group_0_rule_0",
      "reads": {
        "object_present": ["Player"],
        "object_absent": ["Wall"],
        "movement": ["Player:right"]
      },
      "writes": {
        "object_present": ["Crate"],
        "object_absent": ["Player"],
        "movement": ["Player:stationary"]
      }
    }
  ]
}
```

The read side comes from `ruleFlowReads(rule)`. The write side comes from
`ruleFlowWrites(psTagged, rule)`. Movement entries use the existing
`Object:movement` string convention already used by rule tags. The value must
include `stationary` when the analyzer proves a movement clear can wake a
stationary-sensitive read.

The fact is analyzer-level, not a runtime bitvec mask. Runtime conversion is
deferred because object/movement-key facts need careful over-approximation for
layer aliases, movement clearing, and existing compiler masks.

## S2: Group Scheduling Certificates

Extend existing `rulegroup_flow` facts with:

```json
{
  "single_pass_safe": true,
  "single_pass_blockers": []
}
```

`single_pass_safe` is proved when all of these hold:

- The group has at least one `rulegroup_flow` fact.
- No rule writes can enable itself or an earlier rule in the same group.
- The derived rerun masks are empty for every rule.
- The group is not random.
- No rule in the group is rigid.
- No rule queues semantic commands.
- No rule needs force-always behavior.

The result is conservative. It is valid for future optimization work that wants
to skip a redundant quiescence-confirmation pass, but this milestone only
reports the certificate.

`group_skip_mask` remains deferred. It depends on the S1 mask contract and
runtime cumulative-write tracking, both of which need a separate rollout.

## S12: Win Relevance

Add a new fact family named `win_relevance`.

It emits one proved fact, `win_relevance`, whose value contains:

```json
{
  "rule_ids": ["early_group_0_rule_0"],
  "root_rule_ids": ["early_group_0_rule_0"],
  "relevant_rule_ids": ["early_group_0_rule_0"],
  "irrelevant_rule_ids": [],
  "wake_edges": [
    {
      "from": "early_group_0_rule_0",
      "to": "early_group_0_rule_1",
      "reasons": ["object_presence"]
    }
  ],
  "win_wake_edges": [
    {
      "from": "early_group_0_rule_0",
      "to": "win_0",
      "reasons": ["object_presence"]
    }
  ],
  "semantic_root_rule_ids": []
}
```

The relevance algorithm:

1. Start with root rules that directly wake a win condition through `winflow`.
2. Add solver-visible semantic-command rules as roots: `cancel`, `again`,
   `restart`, `win`, and `checkpoint`.
3. Walk backward through `program_flow` wake edges until no new predecessors are
   found.
4. Mark every solver-active rule outside that backward closure as
   `irrelevant_rule_ids`.

The slice is intentionally an over-approximation. Existing `program_flow` is
global and phase-insensitive, so it may keep more rules than strictly needed.
That is safe for future solver pruning because false relevance only loses an
optimization opportunity.

## Testing Strategy

Testing is a core part of this milestone. Every new field must have fixture
coverage before it is considered complete.

### Certified Wake Mask Fixtures

Add `src/tests/static_analysis_testdata/certified_wake_masks/` with fixtures
covering:

- Positive object-present reads and writes.
- Negative object-absence reads and absent writes.
- Exact movement reads and writes.
- `moving` and `randomdir` movement expansion.
- Movement clearing represented as `stationary`.
- Property or object-set terms that expand to multiple concrete objects.

### Rulegroup Flow Fixture Updates

Extend existing `rulegroup_flow` fixtures to assert `single_pass_safe` and
`single_pass_blockers`. Coverage must include:

- A forward-only group that is single-pass safe.
- A backward wake edge that blocks the certificate.
- A self wake edge that blocks the certificate.
- A movement wake edge that blocks the certificate.
- Random, rigid, semantic-command, and force-always blockers.
- A group with no certificate opportunity that remains rejected or blocked.

### Win Relevance Fixtures

Add `src/tests/static_analysis_testdata/win_relevance/` with fixtures covering:

- A rule that directly wakes a win condition.
- An indirect causal chain into a win condition.
- A rule relevant only through an object-absence wake edge.
- A rule relevant through a movement win edge.
- Semantic-command root rules.
- A state-active rule that is not in the win slice.

### Verification Commands

The implementation plan should run at least:

```bash
node src/tests/static_analysis_testdata_runner_node.js
node src/tests/ps_static_analysis_node.js
node src/tests/run_ps_static_analysis.js src/tests/static_analysis_testdata --summary-only --no-ps-tagged
```

If runtime-contract code is touched for shadow assertions, also run:

```bash
node src/tests/run_static_analysis_runtime_contracts_node.js
```

## Safety And Rollout

The rollout order is:

1. `single_pass_safe` on `rulegroup_flow`.
2. `certified_wake_masks`.
3. `win_relevance`.

Each step should land with tests before the next step starts. The facts may be
useful immediately for corpus auditing, but consumers must not rely on them in
this milestone.

Future phases can consume these certificates in this order:

1. Add JS runtime shadow contracts for S1 and S2.
2. Enable JS engine optimizations behind explicit environment flags.
3. Add solver-only pruning based on `win_relevance` with parity gates.
4. Port proved JS facts to native static analysis.

## Success Criteria

- Analyzer JSON includes `certified_wake_masks` and `win_relevance`.
- Existing `rulegroup_flow` facts include `single_pass_safe` and blockers.
- Fixture schemas document every new field.
- Fixture runner validates all new and extended expectations.
- Targeted analyzer tests pass.
- No engine, solver, or native behavior changes.
