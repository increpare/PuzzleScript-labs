# Anonymous Game 500ms Optimization Experiments

Source assessment: `docs/solver-forensics/2026-07-03-anonymous-game-500ms-optimization-plan.md`
Artifact directory: `build/solver-forensics/anonymous-js-first-500ms/experiments/`
Game: `ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt`

## X1 Static Opt

- Command: Task 4 Step 2 static-opt parity run.
- Solved count: 1/54 playable levels.
- step_ms: 25653.385.
- removed_cosmetic_objects: 15.
- removed_collision_layers: 6.
- Optimization gated: no.

## X2 Rule Hotspots

- Command: Task 4 Step 4 level-13 rule-hotspot run.
- Level 13: status=timeout, generated=168, expanded=42.

| key | line | try_apply_calls | changed | match_ms | apply_ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| line:1188&#124;group:1188&#124;direction:right&#124;rule:483 | 1188 | 168 | 0 | 0.022 | 5.943 |
| line:1245&#124;group:1245&#124;direction:down&#124;rule:802 | 1245 | 168 | 0 | 0.527 | 2.998 |
| line:1193&#124;group:1193&#124;direction:right&#124;rule:522 | 1193 | 316 | 75 | 1.039 | 1.064 |
| line:1067&#124;group:1067&#124;direction:down&#124;rule:98 | 1067 | 336 | 168 | 0.923 | 0.556 |
| line:1193&#124;group:1193&#124;direction:down&#124;rule:519 | 1193 | 316 | 3 | 1.199 | 0.075 |

## X3 Again Multiplier

- Command: Task 4 Step 3 again-profile run.
- process_input_calls: 12207.
- generated: 12205.
- again_passes: 2.
- again passes per generated step: 0.000164.

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

## Decisions

- P2 movement-aware prune: continue; hotspot evidence confirms repeated rule-loop work worth attacking with the movement-aware prune prototype.
- P3 adaptive strategy: continue as an explicit probe; long-run JS solved native-proved levels 3, 63, and 81, while levels 19 and 31 still timed out at 120000ms.
- Refresh corpus baseline before default changes: yes.
