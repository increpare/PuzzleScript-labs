# JS Sibling Bigram Priors Design

Date: 2026-07-11
Status: approved design
Roadmap item: T4 / TX3 sibling move-ordering priors

## Objective

Test whether solutions from other levels in the same PuzzleScript game can
improve JS solver search order without changing search completeness, state
semantics, or the default solver configuration.

The experiment consumes a prior solver-results JSON artifact and reorders each
expanded node's existing actions using input bigram counts learned from solved
sibling levels. The target level's own solution must never contribute to its
prior.

This is an opt-in experiment. A positive result can justify a later online
per-game curriculum; a negative result should be recorded and the runtime
consumer removed.

## Evidence

The native solution archive currently contains 131 annotated games. A
leave-one-level-out audit found 102 games with at least two solved levels,
covering 734 held-out levels and 18,727 solution inputs.

- Fixed `right` first-choice accuracy: 29.3%.
- Sibling unigram accuracy: 28.7%.
- Sibling bigram accuracy: 40.2%, with 99.5% context coverage.
- Sibling trigram accuracy: 42.2%, with 97.3% context coverage.

The unigram result rejects a game-wide static action order. The small trigram
gain does not justify carrying two inputs of path context in the first
consumer. Bigram ordering is the smallest version with a meaningful held-out
signal.

## Alternatives Considered

### External leave-one-level-out priors

Recommended. Load an existing solver-results artifact, aggregate solved
siblings separately for every target, and use the resulting bigram table during
search. This is reproducible, requires no extra solve budget in the candidate
run, and makes target exclusion directly testable.

### Online per-game curriculum

Solve easy levels first, learn from them, then retry hard levels. This is closer
to a future production workflow, but it mixes prior quality with level
scheduling and additional CPU budget. It should follow only if the isolated
ordering signal is positive.

### Native-first integration

Attach the same consumer to the C++ solver. This would be closer to the fastest
runtime, but it adds C++ JSON ingestion and duplicate search plumbing before
the search hypothesis is validated. The JS harness is the cheaper falsification
surface.

## Command-Line Contract

Add one option to `src/tests/run_solver_tests_js.js`:

```text
--solver-sibling-priors PATH
```

`PATH` points to a solver JSON document with a top-level `results` array. A
usable training result has:

- string `game`;
- non-negative integer `level`;
- `status` equal to `solved`;
- non-empty `solution` array containing recognized input tokens.

Malformed top-level input is a command error. Individual unusable results are
ignored and counted in manifest telemetry. Duplicate `(game, level)` solved
records are rejected because silently combining repeated samples would weight
some siblings more heavily.

The artifact is loaded once before corpus execution. Worker processes in
`--jobs` mode receive the same option and load the same immutable artifact.

## Prior Construction

Introduce a focused helper module under `src/tests/` that owns parsing,
validation, target exclusion, and action ordering. The main solver runner
should only request a prior for `(game, level)` and ask it to order actions for
a context token.

For every target `(game, level)`:

1. Select solved results with the same `game` and a different `level`.
2. Count transitions from a synthetic start context to the first input.
3. Count transitions from each input to its following input.
4. Store counts by context and action token.

Recognized tokens are `up`, `left`, `down`, `right`, and `action`. A solution
containing an unrecognized token is ignored as a training sample rather than
partially consumed.

No prior is attached when the target has no usable solved sibling.

## Search Integration

The consumer applies to the ordinary single-mode search and adaptive portfolio
search. It does not alter naive or push-space search in this experiment.

At expansion time:

- root node context is the synthetic start token;
- every other node context is the input stored on that node;
- actions are ordered by descending sibling transition count;
- equal counts preserve the solver's existing action order;
- a missing context preserves the existing action order exactly.

Ordering must not mutate the shared baseline actions array. Precompute the
small set of context-specific ordered arrays once per target, then select one
by context during expansion.

Only successor generation order changes. Priorities, heuristic values,
visited-state handling, duplicate detection, replay verification, timeout
logic, and the action set remain unchanged.

## Telemetry

Each result should expose enough data to distinguish an inactive prior from an
active but ineffective one:

- `sibling_prior_enabled`;
- `sibling_prior_training_records_ignored`;
- `sibling_prior_training_levels`;
- `sibling_prior_contexts`;
- `sibling_prior_ordered_expansions`;
- `sibling_prior_fallback_expansions`.

Totals aggregate the numeric fields. Default runs report disabled/zero values.
The benchmark artifact path remains external provenance and is not repeated in
every level result.

## Tests

Use test-driven development.

Helper tests must first fail for:

- target-level exclusion;
- sibling-only game isolation;
- start-context and ordinary bigram counts;
- stable tie ordering;
- missing-context fallback;
- rejection of duplicate solved records;
- ignoring malformed or unsupported training samples.

An integration test should run a small synthetic game twice with a tiny prior
artifact and prove:

- no option preserves baseline behavior and zero telemetry;
- the option changes the first relevant expansion order;
- the found solution replays;
- malformed top-level input fails clearly.

Existing solver smoke, determinism, and replay checks remain required.

## Measurement Plan

### Preflight slice

Build a deterministic manifest from games that contain both solved and unsolved
levels in the training artifact. Use the existing 250 ms native full-corpus
artifact as training data, excluding each target by construction.

Run fresh serial baseline/candidate pairs with the JS solver at 500 ms. Compare:

- solved count and gained/lost targets;
- generated and expanded states;
- `step_ms` and wall time;
- prior activation and fallback coverage;
- replay validity for every candidate solution.

The preflight graduates only if the candidate has a positive solve delta or a
repeatable reduction in generated work on timeout targets without a meaningful
solve regression.

### Full corpus

If the preflight graduates, run at least two paired serial full-corpus samples
at 500 ms. The existing solve-count noise band applies. Report each pair,
per-level gains/losses, aggregate work, and the union of solves rather than
only a pooled total.

### Decision

Keep the option only when repeated evidence shows useful search impact. It
remains explicit unless full-corpus repeats are positive and replay-clean.
Otherwise remove the consumer and retain the design, measurements, and roadmap
decision as negative evidence.

## Scope Boundaries

This experiment does not include:

- macro mining;
- trigram or longer contexts;
- online curriculum scheduling;
- persisted learned priors as a product feature;
- native solver integration;
- heuristic or queue-priority changes;
- enabling sibling priors by default.
