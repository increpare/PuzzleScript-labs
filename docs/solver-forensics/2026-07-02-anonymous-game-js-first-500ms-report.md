# JS-First Solver Forensics: Anonymous Game at 500ms

## Executive Summary

- Game: `ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt`.
- Primary JS baseline solves 1/54 playable levels by 500ms (1.9%).
- JS generated 12189 candidate steps with 25777.6ms in stepping and 514.7ms in heuristic scoring.
- JS no-op steps are 15.6% of measured changed/no-op steps.
- Native data is included as calibration, not as the sole optimization target.
- Hypotheses below are candidates for reviewer inspection, not a closed list.

## Single-Game Solver Calibration

| Solver | Freshness | Playable | <=500ms | <=1000ms | Solved Total | Step ms | Heuristic ms | No-op % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| JS baseline run 1 | fresh | 54 | 1 (1.9%) | 1 (1.9%) | 1 | 25777.6 | 514.7 | 15.6 |
| JS baseline run 2 | fresh | 54 | 1 (1.9%) | 1 (1.9%) | 1 | 25832.0 | 497.6 | 15.5 |
| JS baseline run 3 | fresh | 54 | 1 (1.9%) | 1 (1.9%) | 1 | 25778.0 | 498.3 | 15.5 |
| JS step profile | fresh | 54 | 1 (1.9%) | 1 (1.9%) | 1 | 26142.5 | 424.4 | 15.3 |
| JS no-op probe | fresh | 54 | 1 (1.9%) | 1 (1.9%) | 1 | 25838.6 | 497.2 | 15.6 |
| JS detail timing off | fresh | 54 | 1 (1.9%) | 1 (1.9%) | 1 | 0.0 | 0.0 | 15.5 |
| C++ portfolio interpreter | fresh | 54 | 1 (1.9%) | 1 (1.9%) | 1 | 24563.9 | 97.8 | 0.0 |
| C++ HDA x8 interpreter | fresh | 54 | 1 (1.9%) | 1 (1.9%) | 1 | 159026.0 | 1304.9 | 0.0 |
| C++ portfolio compiled historical | historical | 54 | 1 (1.9%) | 1 (1.9%) | 3 | 235473.1 | 10169.5 | 0.0 |
| C++ HDA x8 compiled historical | historical | 54 | 2 (3.7%) | 3 (5.6%) | 5 | 10038400.0 | 1090440.0 | 0.0 |

## Corpus Calibration

| Solver | Freshness | Playable | <=500ms | <=1000ms | Solved Total |
| --- | --- | --- | --- | --- | --- |
| Corpus JS historical | historical | 1346 | 710 (52.7%) | 785 (58.3%) | 785 |
| Corpus C++ portfolio historical | historical | 1346 | 842 (62.6%) | 901 (66.9%) | 901 |
| Corpus C++ HDA x8 historical | historical | 1346 | 947 (70.4%) | 995 (73.9%) | 996 |
| Corpus C++ portfolio compiled historical | historical | 1346 | 917 (68.1%) | 961 (71.4%) | 961 |
| Corpus C++ HDA x8 compiled historical | historical | 1346 | 1003 (74.5%) | 1034 (76.8%) | 1035 |

## Per-Level Triage

| Category | Count |
| --- | --- |
| high_step_cost_timeout | 52 |
| js_missed_native_solved | 1 |
| solved_under_500ms | 1 |

Top generated-count levels:

| Level | Category | Status | Elapsed ms | Generated | Expanded | Step ms | Heuristic ms | Native summary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | high_step_cost_timeout | timeout | 502.0 | 504 | 126 | 481.3 | 6.8 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:501|C++ portfolio compiled historical:timeout:5017|C++ HDA x8 compiled historical:timeout:30419 |
| 24 | high_step_cost_timeout | timeout | 503.0 | 400 | 100 | 483.0 | 7.9 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:501|C++ portfolio compiled historical:timeout:5003|C++ HDA x8 compiled historical:timeout:30162 |
| 20 | high_step_cost_timeout | timeout | 501.0 | 388 | 97 | 480.0 | 9.0 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:502|C++ portfolio compiled historical:timeout:5015|C++ HDA x8 compiled historical:timeout:30378 |
| 8 | high_step_cost_timeout | timeout | 502.0 | 360 | 90 | 480.3 | 9.0 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:501|C++ portfolio compiled historical:timeout:5003|C++ HDA x8 compiled historical:timeout:30176 |
| 30 | high_step_cost_timeout | timeout | 505.0 | 344 | 86 | 484.4 | 8.6 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:501|C++ portfolio compiled historical:timeout:5003|C++ HDA x8 compiled historical:timeout:30377 |
| 5 | high_step_cost_timeout | timeout | 501.0 | 336 | 84 | 477.3 | 8.5 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:503|C++ portfolio compiled historical:timeout:5004|C++ HDA x8 compiled historical:timeout:30211 |
| 32 | high_step_cost_timeout | timeout | 503.0 | 332 | 83 | 483.9 | 7.4 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:503|C++ portfolio compiled historical:timeout:5003|C++ HDA x8 compiled historical:timeout:30171 |
| 31 | high_step_cost_timeout | timeout | 501.0 | 332 | 83 | 481.2 | 8.1 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:502|C++ portfolio compiled historical:timeout:5003|C++ HDA x8 compiled historical:solved:2850 |
| 19 | high_step_cost_timeout | timeout | 502.0 | 328 | 82 | 480.8 | 9.6 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:502|C++ portfolio compiled historical:timeout:5005|C++ HDA x8 compiled historical:solved:4944 |
| 2 | high_step_cost_timeout | timeout | 502.0 | 324 | 81 | 457.8 | 18.1 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:502|C++ portfolio compiled historical:timeout:5009|C++ HDA x8 compiled historical:timeout:30513 |
| 7 | high_step_cost_timeout | timeout | 507.0 | 316 | 79 | 487.9 | 7.5 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:502|C++ portfolio compiled historical:timeout:5017|C++ HDA x8 compiled historical:timeout:30199 |
| 25 | high_step_cost_timeout | timeout | 501.0 | 312 | 78 | 482.1 | 8.1 | C++ portfolio interpreter:timeout:500|C++ HDA x8 interpreter:timeout:502|C++ portfolio compiled historical:timeout:5010|C++ HDA x8 compiled historical:timeout:30361 |

## JS Runtime Breakdown

Baseline timing buckets:

| Bucket | ms |
| --- | --- |
| step_ms | 25777.6 |
| heuristic_ms | 514.7 |
| clone_ms | 279.5 |
| snapshot_ms | 41.2 |
| hash_ms | 65.9 |
| queue_ms | 7.8 |
| reconstruct_ms | 20.0 |

Step-profile timing buckets:

| Bucket | ms |
| --- | --- |
| step_profile_early_rules_ms | 21440.4 |
| step_profile_late_rules_ms | 4284.4 |
| step_profile_other_rules_ms | 0.0 |
| step_profile_rule_match_ms | 16102.2 |
| step_profile_rule_apply_ms | 6474.8 |
| step_profile_movement_ms | 234.2 |
| step_profile_command_ms | 106.1 |
| step_profile_win_ms | 69.5 |

No-op probe counters:

| Counter | Value |
| --- | --- |
| probe_dir_steps | 11993.0 |
| probe_noops | 1870.0 |
| probe_blocked | 11993.0 |
| probe_blocked_changed | 10123.0 |
| probe_blocked_noop | 1870.0 |

## Native Calibration Notes

- C++ interpreted and compiled rows are calibration evidence for whether JS symptoms are runtime-specific or search/semantic-level.
- HDA rows can improve solve counts by parallelizing search; they do not by themselves prove a better single-threaded heuristic.
- Historical compiled/corpus artifacts are useful yardsticks but should be refreshed before making tight regression claims.

## Open Hypothesis Space

- Observed facts are separated from interpretations so a reviewer can reject our reading.
- Consider heuristic improvements, macro-actions, partial-order reductions, pattern databases, rule-structure classification, per-level strategy selection, sound no-op proofs, JS runtime experiments, native compact specialization, and alternate search algorithms.
- Reviewer questions: Which levels suggest search-order failure rather than runtime cost? Which rule shapes invite safe abstraction? Which JS experiments can cheaply falsify the highest-payoff ideas?

## Candidate Hypotheses

- If `step_ms` dominates, prototype JS runtime reductions or macro-actions that reduce expensive `processInput` calls.
- If high-generated timeouts dominate, inspect heuristic guidance and per-level strategy selection before micro-optimizing stepping.
- If native compiled solvers solve JS misses, compare per-level statuses to separate JS implementation overhead from semantic/search difficulty.
- If no-op rates are high, look for sound proof systems or macro actions rather than unsafe skip predicates.

## Artifact Index

| Label | Path | Freshness |
| --- | --- | --- |
| JS baseline run 1 | `build/solver-forensics/anonymous-js-first-500ms/js-baseline-1.json` | fresh |
| JS baseline run 2 | `build/solver-forensics/anonymous-js-first-500ms/js-baseline-2.json` | fresh |
| JS baseline run 3 | `build/solver-forensics/anonymous-js-first-500ms/js-baseline-3.json` | fresh |
| JS step profile | `build/solver-forensics/anonymous-js-first-500ms/js-step-profile.json` | fresh |
| JS no-op probe | `build/solver-forensics/anonymous-js-first-500ms/js-noop-probe.json` | fresh |
| JS detail timing off | `build/solver-forensics/anonymous-js-first-500ms/js-cpu-ready.json` | fresh |
| C++ portfolio interpreter | `build/solver-forensics/anonymous-js-first-500ms/native-portfolio.json` | fresh |
| C++ HDA x8 interpreter | `build/solver-forensics/anonymous-js-first-500ms/native-hda-8.json` | fresh |
| C++ portfolio compiled historical | `build/solver-forensics/anonymous-js-first-500ms/historical/single-game-cpp-portfolio-compiled-5000ms.json` | historical |
| C++ HDA x8 compiled historical | `build/solver-forensics/anonymous-js-first-500ms/historical/single-game-cpp-hda-8-compiled-30000ms.json` | historical |
| Corpus JS historical | `build/solver-forensics/anonymous-js-first-500ms/historical/corpus-js.json` | historical |
| Corpus C++ portfolio historical | `build/solver-forensics/anonymous-js-first-500ms/historical/corpus-cpp-portfolio.json` | historical |
| Corpus C++ HDA x8 historical | `build/solver-forensics/anonymous-js-first-500ms/historical/corpus-cpp-hda-8.json` | historical |
| Corpus C++ portfolio compiled historical | `build/solver-forensics/anonymous-js-first-500ms/historical/corpus-cpp-portfolio-compiled.json` | historical |
| Corpus C++ HDA x8 compiled historical | `build/solver-forensics/anonymous-js-first-500ms/historical/corpus-cpp-hda-8-compiled.json` | historical |
