# JS-First Solver Forensics Report Design

## Status

Approved design. This is a planning artifact for a solver-performance dossier,
not an implementation plan and not a solver change.

## Context

We have a hard single-game case:

```text
/Users/stephenlavelle/Documents/google_gist_scraper/dumpprocessed/ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt
```

The current best run for that game is `c++ hda-weighted-astar x8 compiled`.
Saved output under
`build/solver-timeout-curve-ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f-30000ms-hda-compiled/`
shows only a handful of levels solved even with a long timeout. Existing full
corpus timeout-curve artifacts under `build/solver-timeout-curve/` show that
the same solver family performs much better on the general corpus. This makes
the game useful as a microscope for solver weaknesses.

The next report is meant for a more powerful and expensive reviewer. It should
give that reviewer raw evidence, our best interpretation, and enough open space
to propose different hypotheses.

## Goal

Produce a JS-first solver forensics report centered on the anonymous game at a
500ms timeout, with native solver data used as calibration.

The report should help a reviewer answer:

- How unusual is this game's 500ms behavior compared with the general corpus?
- Which levels are solved, near-misses, high-expansion timeouts, or runtime
  hotspots?
- Does the evidence point more toward search ordering, heuristic weakness,
  runtime stepping cost, state storage/hash/frontier overhead, no-op action
  waste, or unusual game/rule structure?
- Which optimization hypotheses are most worth trying first?
- Which hypotheses are only our current interpretation and should be challenged?

## Non-Goals

- Do not optimize the solver as part of this task.
- Do not make JS or C++ behavior changes while producing the report.
- Do not treat our ranked hypotheses as exhaustive.
- Do not rely only on the compiled native solver; JS and C++ interpreted runs
  must remain visible.
- Do not commit large generated build artifacts unless separately requested.

## Approach

Use JS as the primary microscope because it is the fastest place to prototype
and instrument search/runtime ideas. Use native runs as a calibration layer so
the report does not overfit to JS-only behavior.

The report should distinguish three evidence classes:

- Fresh single-game evidence from current HEAD.
- Fresh corpus evidence from current HEAD, if rerun cost is acceptable.
- Existing corpus artifacts, clearly labeled with path and provenance.

When a saved artifact is reused, the report must say so explicitly rather than
implying it came from the current run.

## Measurement Matrix

### Primary JS Runs

Run the anonymous game as a one-file corpus at 500ms.

Required JS variants:

- Baseline JSON with normal timing buckets and `--no-solutions`.
- Step profile with `PUZZLESCRIPT_SOLVER_STEP_PROFILE=1`.
- No-op probe with `PUZZLESCRIPT_SOLVER_NOOP_PROBE=1`.
- CPU-profile-ready run with `PUZZLESCRIPT_SOLVER_DETAIL_TIMING=0`.

Preferred repeat policy:

- Baseline JS: run 3 repetitions if time permits.
- Step profile/no-op/cpu-ready: one run each unless variance is obviously
  misleading.

### Native Calibration Runs

Run the anonymous game at 500ms for:

- C++ interpreter portfolio.
- C++ interpreter HDA weighted A* x8.
- C++ compiled compact-turn portfolio.
- C++ compiled compact-turn HDA weighted A* x8.

The native data should answer whether the same levels are hard across runtimes
and whether compiled compact turns change the diagnosis.

### Corpus Calibration

Use full-corpus data for the same solver families when available:

- JS interpreter.
- C++ interpreter portfolio.
- C++ interpreter HDA weighted A* x8.
- C++ compiled compact-turn portfolio.
- C++ compiled compact-turn HDA weighted A* x8.

Existing candidate artifact:

```text
build/solver-timeout-curve/
```

If these artifacts are reused, include the saved paths and a note that they are
historical. If freshness is required, rerun a 500ms-focused corpus pass rather
than a long curve.

## Output Artifacts

Primary committed artifact:

```text
docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md
```

Generated raw artifacts should live under:

```text
build/solver-forensics/anonymous-js-first-500ms/
```

Expected generated files:

- JS baseline JSON files.
- JS step-profile JSON.
- JS no-op-probe JSON.
- JS cpu-profile-ready JSON and optional CPU profile note.
- Native calibration JSON files.
- Summary CSV or JSON tables used by the report.
- Optional level-triage table generated from the raw JSON.

The report must include an artifact index with exact commands and output paths.

## Report Structure

### 1. Executive Summary

One page of high-signal findings:

- How many anonymous-game playable levels JS solves within 500ms.
- How that compares to the general corpus.
- What the largest measured bottlenecks are.
- Which levels deserve attention first.
- Which candidate hypotheses seem most promising.

### 2. Single-Game vs Corpus Calibration

Tables for 500ms, and optionally 1000ms for context:

- Anonymous game, JS and native solver families.
- General corpus, same solver families.
- Ratio of solved playable levels.

This section should make clear whether the anonymous game is an outlier in
solve rate, expansion rate, step cost, or all three.

### 3. Per-Level Triage

Group levels into:

- Solved under 500ms.
- Near misses.
- High-expansion timeouts.
- High-step-cost timeouts.
- High-heuristic-cost timeouts.
- Levels with high no-op or duplicate-state behavior.
- Levels where JS and native disagree in status or relative difficulty.

Each row should include enough fields to inspect quickly:

- Compiler level index.
- Source line number when compiler metadata is already available; omit it rather
  than blocking the report on source-map work.
- Status.
- Elapsed time.
- Expanded and generated nodes.
- Step, heuristic, clone/snapshot/hash/queue buckets.
- No-op and changed-step counters.
- Native status summary.

### 4. JS Runtime Breakdown

Summarize the JS timing buckets:

- `step_ms`
- `heuristic_ms`
- `clone_ms`
- `snapshot_ms`
- `hash_ms`
- `queue_ms`
- `reconstruct_ms`

Summarize step profile:

- Rule match.
- Rule apply.
- Early rules.
- Late rules.
- Movement.
- Command queue.
- Win check.

Summarize no-op behavior:

- Step no-op ratio.
- Changed-step ratio.
- Blocked-target predicate true positives and false positives.
- Any per-level no-op outliers.

### 5. Native Calibration

Show C++ interpreted and compiled behavior at a level sufficient to compare:

- Which levels native solves that JS does not.
- Which levels JS solves that native does not, if any.
- Whether compiled compact turns mainly improve per-step runtime or also change
  search outcomes.
- Whether HDA changes the diagnosis by parallelizing search rather than solving
  the root branching/heuristic issue.

Native deep profiling is not the primary report goal unless it contradicts the
JS diagnosis.

### 6. Open Hypothesis Space

For each major symptom, separate:

- Observed fact.
- Our current interpretation.
- Alternative explanations.
- Questions for the reviewer.

The report should explicitly invite the reviewer to reject our interpretation.
Candidate categories to leave open:

- Heuristic improvements.
- Macro-actions or move abstraction.
- Partial-order reductions.
- Pattern databases or state abstraction.
- Rule-structure classification.
- Per-game or per-level strategy selection.
- Sound no-op proof systems.
- JS-first runtime experiments.
- Native compact/runtime specialization.
- Search algorithms beyond current weighted A*/HDA/portfolio variants.

### 7. Candidate Optimization Hypotheses

Rank hypotheses, but frame them as candidates rather than conclusions.

Each hypothesis should include:

- Evidence from the anonymous game.
- Relevant corpus comparison.
- Expected payoff.
- Correctness risks.
- Whether it should be prototyped in JS or C++.
- Required verification gates.

### 8. Artifact Index

List every command and file used in the report.

For each artifact, record:

- Command.
- Output path.
- Whether it is fresh or historical.
- Timeout.
- Solver family.
- Git commit or commit note if available.

## Data Flow

1. Stage the anonymous game into a one-file corpus under the report build
   directory.
2. Run JS evidence collection variants against that staged corpus.
3. Run native calibration variants against the same staged corpus.
4. Load existing or fresh corpus calibration JSON.
5. Generate summary tables from raw JSON.
6. Write the Markdown report from the summarized evidence.
7. Preserve raw JSON and CSV under `build/solver-forensics/...`.

## Error Handling

- If a solver run fails to compile the game, record compile diagnostics and stop
  the affected branch of analysis.
- If one solver family fails but others succeed, the report should include the
  failure as evidence rather than silently dropping it.
- If an artifact is historical or from an unknown commit, label it as such.
- If a run has high timeout variance, prefer reporting ranges over single
  exact values.
- If JS and native disagree, preserve the disagreement and avoid forcing a
  single explanation without evidence.

## Verification

The report-production workflow should verify:

- The anonymous staged corpus contains exactly one game file.
- JS baseline JSON parses and has expected result counts.
- Native JSON parses and has expected result counts.
- Solver result rows can be grouped by `game` and `level`.
- Report tables are generated from raw JSON, not manually retyped.
- Any stated solved counts match the underlying JSON.
- Any solution annotations used for examples are replay-verified before being
  cited.

Recommended smoke checks before considering the report complete:

```text
node src/tests/js_solver_instrumentation_pack_node.js
node src/tests/native_solver_instrumentation_pack_node.js
node src/tests/analyze_native_solver_instrumentation_pack_node.js
```

Additional checks may be added in the implementation plan if new helper scripts
are introduced.

## Review Gates

After this design is approved, the next step is to write an implementation
plan. That plan should decide:

- Whether to reuse existing JS/native instrumentation helpers directly or add a
  thin report-specific wrapper.
- Whether to rerun full corpus calibration or reuse existing artifacts.
- Which exact commands define the fresh evidence pack.
- How much of the report table generation should be scripted.

No solver optimization work should start until the report exists and has been
reviewed.
