# Anonymous Game 500ms Optimization Experiments

Source assessment: `docs/solver-forensics/2026-07-03-anonymous-game-500ms-optimization-plan.md`
Artifact directory: `build/solver-forensics/anonymous-js-first-500ms/experiments/`
Game: `ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt`

## X1 Static Opt

- Command: static-opt all with parity at 500ms.
- Solved count: 1/54 playable levels.
- step_ms: about 25651-25653ms across reruns.
- removed_inert_rules: 108 in the master-side run.
- removed_cosmetic_objects: 15.
- removed_collision_layers: 6.
- Optimization gated: no.
- Decision: parity was clean and layers were removed, but this did not improve the 500ms solve count for this game.

## X2 Rule Hotspots

- Command: level 13 with step profile and per-rule hotspot counters.
- Reviewed run: status=timeout, generated=168, expanded=42.
- Top-10 hotspot coverage: 8.403ms / 195.174ms match time and 12.099ms / 134.540ms apply time.

| key | line | try_apply_calls | changed | match_ms | apply_ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| line:1188&#124;group:1188&#124;direction:right&#124;rule:483 | 1188 | 168 | 0 | 0.022 | 5.943 |
| line:1245&#124;group:1245&#124;direction:down&#124;rule:802 | 1245 | 168 | 0 | 0.527 | 2.998 |
| line:1193&#124;group:1193&#124;direction:right&#124;rule:522 | 1193 | 316 | 75 | 1.039 | 1.064 |
| line:1067&#124;group:1067&#124;direction:down&#124;rule:98 | 1067 | 336 | 168 | 0.923 | 0.556 |
| line:1193&#124;group:1193&#124;direction:down&#124;rule:519 | 1193 | 316 | 3 | 1.199 | 0.075 |

Decision: hotspots were diffuse enough that uniform rule-loop cost, codegen, and stride/compaction explanations remain live.

## X3 Again Multiplier

- Command: 500ms run with `PUZZLESCRIPT_SOLVER_AGAIN_PROFILE=1`.
- process_input_calls: 12207.
- generated: 12205.
- again_passes: 2.
- again passes per generated step: 0.000164.
- Decision: defer P6 again-settling reduction; `again` is not a meaningful multiplier in this measured run.

## X4 Guidance Parity

- Levels checked: 3, 19, 31, 63, 81.
- JS solved levels: 3/5 (60.0%).

| level | status | elapsed_ms | expanded | generated | solution_length |
| ---: | --- | ---: | ---: | ---: | ---: |
| 3 | solved | 36174 | 4490 | 17957 | 106 |
| 19 | timeout | 120001 | 22047 | 88188 | 0 |
| 31 | timeout | 120001 | 20508 | 82032 | 0 |
| 63 | solved | 90584 | 15035 | 60137 | 20 |
| 81 | solved | 92 | 10 | 37 | 10 |

## X5 Movement-Aware Prune Prototype

- Flagged simulation command: `PUZZLESCRIPT_INCREMENTAL_PRUNE=1 PUZZLESCRIPT_MOVEMENT_AWARE_PRUNE=1 node src/tests/run_tests_node.js`.
- Result: 752 passed, 1 failed.
- Failing simulation fixture: `Karamell`.
- Root cause: Karamell's movement-propagation group still needs later fixpoint iterations after the line 448 rule writes movement. The relevant `readMovements` masks for lines 444 and 446 do not overlap that write mask, so the movement-aware guard pruned rules that still needed to run.
- Master-side paired comparison note: a later smoke comparison passed, but the full 250ms solver corpus comparison still failed with 47 reported regressions, mostly baseline-solved levels timing out with pruning on.
- Decision: rejected/blocked. No movement-aware prune code landed.

## X6 Adaptive Step-Cost Probe

- Artifact: `build/solver-forensics/anonymous-js-first-500ms/experiments/js-adaptive-step-cost-500ms.json`.
- Single-game solved count: 1/54 playable levels.
- generated: 11721.
- expanded: 2931.
- step_ms: 25799.377940000082.
- adaptive_step_cost_triggered: 2909.
- Active/applicable results: 54 active rows recorded the probe field; 48 triggered at least once.
- Corpus follow-up at 500ms: baseline solved=706, adaptive solved=703; no newly solved levels, three baseline-solved levels became timeouts.
- Decision: keep as an explicit probe only. Do not make it default without a refreshed corpus run showing flat-or-better solve count and reduced timeouts.

## Decisions

- P2 movement-aware prune: not accepted as implemented.
- P3 adaptive strategy: continue as an explicit probe; the corpus follow-up regressed 706 -> 703 solved at 500ms.
- P6 again-settling reduction: defer; X3 measured only 2 again passes over 12205 generated steps.
- Refresh corpus baseline before default changes: yes.
