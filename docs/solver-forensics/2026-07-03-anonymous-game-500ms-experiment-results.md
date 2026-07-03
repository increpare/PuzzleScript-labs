# Anonymous Game 500ms Optimization Experiments

Source assessment: `docs/solver-forensics/2026-07-03-anonymous-game-500ms-optimization-plan.md`

Generated artifacts live under `build/solver-forensics/anonymous-js-first-500ms/experiments/`.

## X1 Static Opt

- Command: static-opt all with parity at 500ms.
- Solved: 1/54 playable levels.
- Step ms: 25651.4.
- Generated: 12381.
- Removed inert rules: 108.
- Removed cosmetic objects: 15.
- Removed collision layers: 6.
- Optimization gated: no.
- Decision: parity is clean and the pass removes layers, but this single-game run does not show a major 500ms solve-count gain by itself.

## X2 Rule Hotspots

- Command: level 13 with step profile and per-rule hotspot counters.
- Level 13 status: timeout, generated=144, expanded=36, step_ms=477.4.
- Top rules by match+apply time:
- 1. key=1478:1478:8, line=1478, try_apply_calls=29000, changed=1, match_ms=3.3, apply_ms=6.2.
- 2. key=1476:1476:8, line=1476, try_apply_calls=28800, changed=0, match_ms=3.6, apply_ms=5.7.
- 3. key=1477:1477:2, line=1477, try_apply_calls=28800, changed=0, match_ms=3.2, apply_ms=6.0.
- 4. key=1475:1475:2, line=1475, try_apply_calls=28800, changed=0, match_ms=3.3, apply_ms=5.9.
- 5. key=1439:1439:2, line=1439, try_apply_calls=18400, changed=0, match_ms=1.7, apply_ms=3.7.
- Decision: continue P2; the hotspot profile shows many repeated unchanged rule attempts.

## X3 Again Multiplier

- Command: 500ms run with `PUZZLESCRIPT_SOLVER_AGAIN_PROFILE=1`.
- process_input_calls: 12083.
- generated: 12081.
- again_passes: 2.
- again passes per generated step: 0.000.
- Decision: drop P6 for this game; `again` is not a meaningful multiplier in the measured run.

## X4 Guidance Parity

- Levels checked: 3, 19, 31, 63, 81.
- JS solved levels: 3/5.
- Level 3: status=solved, elapsed_ms=35955, expanded=4490, generated=17957, solution_length=106.
- Level 19: status=timeout, elapsed_ms=120001, expanded=21306, generated=85224, solution_length=0.
- Level 31: status=timeout, elapsed_ms=120002, expanded=19849, generated=79396, solution_length=0.
- Level 63: status=solved, elapsed_ms=98943, expanded=15035, generated=60137, solution_length=20.
- Level 81: status=solved, elapsed_ms=104, expanded=10, generated=37, solution_length=10.
- Decision: level 3 supports the report's throughput diagnosis because JS expansion count is close to the cited native count. Levels 19 and 31 remain search-hard or throughput-hard enough to time out at 120s.

## Current Decision

- Do not land P2 movement-aware prune in this batch. A smoke comparison passed, but the 250ms full solver corpus paired comparison regressed many baseline-solved levels to timeout with pruning on.
- Keep P3 adaptive strategy as an explicit probe, not a default.
- Do not pursue P6 again-settling reduction for this game.
- Refresh corpus JS before making corpus-level claims or defaulting any behavior.
