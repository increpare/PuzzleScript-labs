# Static-analysis dynamic audit — 2026-10-25

No new static-analysis counterexample was found within the bounded checks below.
The investigation did reproduce and fix two pre-existing bugs in the runtime
test harness. Passing these finite tests does not prove every playthrough.

| Sweep | Exercised coverage | Result |
| --- | --- | --- |
| Cached gallery | 141 analyzable games, all 1,571 playable levels, 6,284 seeded traces, 470,066 generated inputs | No certificate violations in the selected complete runs |
| Recorded playthroughs | 473 cases, with the new intra-turn oracle enabled | Passed; 15 expected analysis-unavailable cases |
| Synthetic programs | 625 distinct ordered rule pairs on 11 authored boards: 6,875 cases | Passed |
| Engine/compiler regressions | 473 simulations and 321 compiler/error cases | 794 passed; zero failures/errors |

The gallery corpus contains 142 cached sources: 140 verified and two provisional
attributions. Cyber-Lasso is rejected by the existing compiler validation gate.
These are the manifest's cached revisions; its gallery inventory hash differs
from this checkout. The [JSON snapshot](2026-10-25-static-analysis-dynamic-audit.json)
records provenance, source hashes, configurations, per-game counts and the full
claim inventory.

## New checks

The test-only reference path always rechecks match tuples and repeats groups;
it bypasses the engine's scheduling shortcuts. It compares optimized rule
invocations with the reference and checks:

- Group splitting, single-pass safety and skipping a previously clean group,
  including movement state and convergence before collision resolution.
- Match enabling/invalidation, self-disabling and isolated idempotence.
- Individual cell creation/destruction, including intermediate effects cancelled
  by another row in the same tuple.
- Persistent guards and setup retirement across committed turns, including each
  AGAIN step, with lifetime observations reset on state restoration.

Eighteen focused regressions deliberately inject false certificates, exercise
restoration and shadow-state isolation, and check the two harness repairs.
They also pass with incremental pruning disabled and with match-interaction
optimizations disabled.

Selected gallery observations include 71,000 split checks, 43,235 single-pass
checks, 425,465 group-skip checks, 8,635 post-quiescence setup checks and 1,523,746
rule/reference parity comparisons. These counters are aggregate observations;
they do not establish coverage of every individual certificate instance.

## Harness bugs fixed

1. **The winflow recorder missed isolated-cell replacements.** The engine's
   fast path calls the cell replacement directly, bypassing `applyAt`. Recording
   `tryApply` as well now observes those changes, while retaining `applyAt`
   recording for random groups. This explained false winflow failures in Chaos
   Wizard and Gobble Rush.
2. **End-of-game board identity was wrong for per-level checks.** Finishing the
   final level resets `curlevel` to zero while retaining the previous board.
   The harness applied level-zero unreachable-object claims to that retained
   board. Text/title screens now exclude those per-level checks. Coin Counter
   and Maera Public Works exposed the problem.

## Limits and run selection

The normal gallery configuration uses two seeds per level in each of forward
and mixed undo/restart modes, up to 80 inputs per trace, 1,000 intra-turn probes
and 128 tuples per enumeration. Forward traces also exercise deterministic
solver projection checks. Explicitly seeded deterministic games now receive
alternate-seed no-random checks.

The initial bounded run reached a ten-minute game deadline in Vertebrae and a
30-second trace deadline in Rose. Neither was counted as a pass. All 216
Vertebrae traces then passed with a 100-probe budget. All eight Rose traces
passed with the original 1,000-probe budget and a 120-second trace deadline.
The final aggregate selects one complete result per game, using identical
source/harness hashes and seeds. It does not duplicate traces or source counts.

The registry explicitly leaves **`program_flow` and `win_relevance` unchecked**
by general playthrough oracles. Other limits remain visible in the counts:
probe/tuple exhaustion, rigid lifetime exclusions, direct random-group
applications and individual groups that differ after compiler duplicate
removal. Cosmetic/merge parity excludes random games and undo-bearing traces.
The reference shares lowered engine primitives; it independently checks their
scheduling, rather than implementing a second parser/compiler.

## Reproduction

```
make static_analysis_tests
node src/tests/run_static_analysis_runtime_contracts_node.js --intra-turn
make static_analysis_synthetic_audit
make static_analysis_gallery_audit STATIC_ANALYSIS_GALLERY_AUDIT_ARGS='--manifest /path/to/gallery/manifest.json --out build/gallery-audit'
```

The gallery runner saves logs, per-game coverage, exact failing seeds/inputs and
copies of failing sources. Its parent watchdog continues later traces after a
case timeout. `--resume` verifies configuration, source manifest, executed code,
Node version and relevant environment before reusing results.

Raw runs for this audit are under
`build/static-analysis-gallery-audit-2026-10-25/`: `complete/` is the initial
bounded run, `vertebrae-all-levels/` and `rose-all-levels/` are the documented
overrides, and `verified/summary.json` is their deduplicated aggregate.
