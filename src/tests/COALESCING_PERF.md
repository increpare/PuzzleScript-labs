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

## 2026-05-17 phase 3a command-bearing movement coalescing

Baseline: `5eded7fb` (`major optimization of amalgamation`).
After: this commit.

Commands used for the focus runs:

```sh
node src/tests/run_solver_tests_js.js src/tests/solver_tests \
  --solver-focus-manifest <manifest> \
  --timeout-ms <manifest timeout> \
  --strategy portfolio \
  --quiet --json --no-solutions
```

Primary profile:

| Group | Timeout | Result | Compile ms | Solver elapsed ms | Step ms | Expanded | Generated |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `solver_focus_group.json` | 500 ms | 6 solved / 44 timeout / 0 errors -> 8 solved / 42 timeout / 0 errors | 294.4 -> 272.1 (-7.6%) | 23938 -> 23286 (-2.7%) | 19450.7 -> 18783.9 (-3.4%) | 231655 -> 225636 (-2.6%) | 1131894 -> 1101306 (-2.7%) |
| `solver_focus_long_group.json` | 2000 ms | 47 solved / 3 timeout / 0 errors -> 46 solved / 4 timeout / 0 errors | 248.9 -> 282.1 (+13.3%) | 47650 -> 52896 (+11.0%) | 38323.3 -> 43146.3 (+12.6%) | 473622 -> 478018 (+0.9%) | 2320522 -> 2342450 (+0.9%) |

The first long-focus sample moved several near-timeout targets across the
deadline in both directions, so it was repeated once. The repeat was neutral:
`solver_focus_long_group.json` stayed at 48 solved / 2 timeout / 0 errors and
measured 48884 -> 48829 elapsed ms (-0.1%), with step time 39265.6 -> 39325.2
ms (+0.2%).

Largest primary speedups:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `sokobond demake.txt` L20 | timeout at 500 ms | solved at 70 ms | status win |
| `solver_focus_group.json` | `take heart lass.txt` L19 | 256 ms | 112 ms | -144 ms |
| `solver_focus_group.json` | `the_saga_of_the_candy_scroll.txt` L55 | timeout at 500 ms | solved at 420 ms | status win |
| `solver_focus_long_group.json` | `dollyban.txt` L7 | 1784 ms | 1137 ms | -647 ms |
| `solver_focus_long_group.json` | `dollyban.txt` L9 | timeout at 2000 ms | solved at 1484 ms | status win |

Largest primary positive elapsed deltas:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `manic_ammo.txt` L10 | 286 ms | 375 ms | +89 ms |
| `solver_focus_group.json` | `heroes_of_sokoban_3.txt` L10 | 435 ms | 457 ms | +22 ms |
| `solver_focus_long_group.json` | `heroes_of_sokoban_2.txt` L8 | 708 ms | timeout at 2000 ms | status loss |
| `solver_focus_long_group.json` | `heroes_of_sokoban_2.txt` L17 | 1195 ms | timeout at 2000 ms | status loss |
| `solver_focus_long_group.json` | `karamell.txt` L1 | 953 ms | 1633 ms | +680 ms |

Concrete rule-count probes:

| Game | Total rules | Notes |
| --- | ---: | --- |
| `paint everything everywhere.txt` | 159 -> 115 | line 249 slide rules drop from 12 -> 1 for each command-bearing movement rule shape |
| `Wand Spinner.txt` | 51 -> 51 | no phase-3a hit |
| `constellationz.txt` | 4 -> 4 | no phase-3a hit |
| `match three billiards.txt` | 33 -> 33 | already optimized by earlier coalescing |
