# Native Certified Single-Pass Groups Design

## Goal

Measure the native interpreter's redundant rule-group confirmation work, then
allow the solver to skip that work only for groups carrying the JS analyzer's
existing `single_pass_safe` certificate.

The corpus preflight found 6,163 rule groups across 184 games. Of 1,540
multi-rule groups already described by `rulegroup_flow`, 733 groups (47.6%)
covering 3,761 expanded rule instances are certified single-pass safe. The
remaining 4,623 single-rule groups are outside this first consumer because the
analyzer does not currently emit group-flow facts for them.

## Checkpoint 1: Measurement

Add behavior-neutral native runtime counters for:

- rule-group invocations;
- rule-group passes through the fixpoint loop;
- confirmation passes entered after an earlier pass changed state;
- rule visits performed during those confirmation passes.

Expose the counters through the existing C API snapshot, solver
`--profile-runtime-counters` output, and `native_runtime_counters_node.js`
schema checks. A focused fixture must exercise one changing pass followed by a
no-change confirmation pass and assert nonzero confirmation counts.

Run the counters on `smoke-50` and the wide four-word benchmark. Continue to
the consumer only when confirmation visits are a material share of total rule
visits on at least one named slice. Record a negative result and stop if the
share is negligible.

## Checkpoint 2: Certificate Consumer

Extend the static-analysis hint manifest with early/late group IDs whose
`rulegroup_flow.value.single_pass_safe` value is true. Keep JS analysis as the
source of truth; do not infer the certificate from native runtime masks.

The native hint loader maps the stable `early_group_N` and `late_group_N` IDs
to per-section group indexes. Unknown, malformed, duplicated, or out-of-range
IDs are ignored conservatively. No certificate is active without an explicit
solver option.

Add `--solver-certified-single-pass-groups`. For a certified non-random group,
`applyRuleGroup` executes its ordinary first pass and returns immediately
instead of entering another fixpoint pass. Random, rigid, semantic-command,
and force-always groups remain uncertified by the analyzer and therefore use
the existing loop.

The option applies only to the interpreted native solver path. Specialized
rule-group and full-turn implementations remain unchanged.

## Correctness

Analyzer fixtures continue to define the certificate. Add native tests for:

- a forward-only group that is certified and produces the same state with the
  option enabled;
- a backward-enabling group that is not certified and still reaches its
  fixpoint;
- absent or malformed hints, which leave behavior unchanged;
- source manifests whose group IDs do not map to a native group index.

Run JS/native solver parity, simulation tests, solver determinism, static
analysis runtime contracts, native static-analysis parity, and canonical
solution replay. Any status, solution, or final-state mismatch rejects the
consumer.

## Performance Decision

Benchmark baseline/candidate pairs with counters disabled on `smoke-50` and
the wide four-word portfolio. Report solved splits, generated-state
throughput, step time, rule visits, and confirmation visits removed. Keep the
consumer explicit unless repeated pairs show positive throughput outside the
slice's noise band with no semantic regressions.

Do not fold group-skip masks, single-rule-group certification, group splitting,
or JS runtime consumption into this experiment. Those are separate follow-ups
after the native single-pass result is known.
