# Coalescing Performance Notes

## 2026-05-17 property rewrite coalescing

Baseline: `eae1a1d2` (`Implement layer-coupled movement coalescing`).
After: this commit.

Commands used for the focus runs:

```sh
node src/tests/run_solver_tests_js.js src/tests/solver_tests \
  --solver-focus-manifest <manifest> \
  --timeout-ms <manifest timeout> \
  --strategy portfolio \
  --quiet --json --no-solutions
```

Each focus group was run once on the baseline worktree and once on the updated
worktree. Solver timings have normal millisecond-level jitter, so the small
positive target deltas below should be treated as noise unless they repeat.

| Group | Timeout | Result | Compile ms | Solver elapsed ms | Step ms | Expanded | Generated |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `solver_focus_group.json` | 500 ms | 8 solved, 42 timeout, 0 errors both before and after | 246.0 -> 240.9 (-2.1%) | 23252 -> 23197 (-0.2%) | 18985.8 -> 18871.6 (-0.6%) | 242956 -> 245572 (+1.1%) | 1187629 -> 1200441 (+1.1%) |
| `solver_focus_long_group.json` | 2000 ms | 48 solved / 2 timeout / 0 errors -> 49 solved / 1 timeout / 0 errors | 244.0 -> 253.7 (+4.0%) | 47015 -> 44656 (-5.0%) | 38229.8 -> 36213.1 (-5.3%) | 475810 -> 471950 (-0.8%) | 2331305 -> 2312157 (-0.8%) |

Largest focus-group speedups:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `paint everything everywhere.txt` L9 | 497 ms | 454 ms | -43 ms |
| `solver_focus_group.json` | `the_saga_of_the_candy_scroll.txt` L55 | 436 ms | 428 ms | -8 ms |
| `solver_focus_long_group.json` | `constellationz.txt` L10 | 1625 ms | 814 ms | -811 ms |
| `solver_focus_long_group.json` | `constellationz.txt` L6 | 1136 ms | 646 ms | -490 ms |
| `solver_focus_long_group.json` | `gem soketeer.txt` L17 | timeout at 2000 ms | solved at 1949 ms | status win |

Largest positive elapsed deltas:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `manic_ammo.txt` L10 | 372 ms | 375 ms | +3 ms |
| `solver_focus_group.json` | `Vexatious Match 3.txt` L8 | 183 ms | 185 ms | +2 ms |
| `solver_focus_group.json` | `take heart lass.txt` L19 | 110 ms | 111 ms | +1 ms |
| `solver_focus_long_group.json` | `paint everything everywhere.txt` L9 | 463 ms | 488 ms | +25 ms |
| `solver_focus_long_group.json` | `paint everything everywhere.txt` L17 | 697 ms | 716 ms | +19 ms |
| `solver_focus_long_group.json` | `push.txt` L19 | 742 ms | 760 ms | +18 ms |

The targeted non-focus regression fixture for the repeated property rewrite rule
compiles `match three billiards.txt` from 463 concrete rules down to 33. A
compile-only toggle probe measured 32.3 ms before and 17.6 ms after (-45.4%).
