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

## 2026-05-17 phase 3b single-cell preserved property coalescing

Baseline: `64e6a712` (`Allow command-bearing movement coalescing`).
After: this commit.

This is intentionally narrower than the original sketch: preserved
layer-coupled properties are only skipped in single-cell rules. A multi-cell
`at the hedges of time` rule uses the expansion order of a preserved `Mark`
property to choose a single `Highest` marker, so multi-cell preserved properties
stay on the old expansion path.

Commands used for the focus runs:

```sh
node src/tests/run_solver_tests_js.js src/tests/solver_tests \
  --solver-focus-manifest <manifest> \
  --timeout-ms <manifest timeout> \
  --strategy portfolio \
  --quiet --json --no-solutions
```

| Group | Timeout | Result | Compile ms | Solver elapsed ms | Step ms | Expanded | Generated |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `solver_focus_group.json` | 500 ms | 5 solved / 45 timeout / 0 errors -> 9 solved / 41 timeout / 0 errors | 337.5 -> 243.6 (-27.8%) | 23600 -> 23133 (-2.0%) | 19036.1 -> 18776.7 (-1.4%) | 224066 -> 247051 (+10.3%) | 1097625 -> 1207927 (+10.0%) |
| `solver_focus_long_group.json` | 2000 ms | 48 solved / 2 timeout / 0 errors -> 47 solved / 3 timeout / 0 errors | 257.5 -> 272.3 (+5.7%) | 50588 -> 47629 (-5.8%) | 40642.8 -> 38638.6 (-4.9%) | 466353 -> 475450 (+2.0%) | 2284018 -> 2329683 (+2.0%) |

Largest speedups:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `manic_ammo.txt` L10 | timeout at 500 ms | solved at 361 ms | status win |
| `solver_focus_group.json` | `paint everything everywhere.txt` L9 | timeout at 500 ms | solved at 423 ms | status win |
| `solver_focus_group.json` | `take heart lass.txt` L19 | 171 ms | 113 ms | -58 ms |
| `solver_focus_long_group.json` | `constellationz.txt` L6 | 1834 ms | 1122 ms | -712 ms |
| `solver_focus_long_group.json` | `Yellow Box.txt` L35 | 1807 ms | 1140 ms | -667 ms |

Largest positive elapsed deltas:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `SWIMMING TIME.txt` L2 | timeout at 500 ms | timeout at 501 ms | +1 ms |
| `solver_focus_long_group.json` | `S-tercourse.txt` L23 | solved at 1878 ms | timeout at 2000 ms | status loss |
| `solver_focus_long_group.json` | `heroes_of_sokoban_2.txt` L17 | 1260 ms | 1368 ms | +108 ms |
| `solver_focus_long_group.json` | `witch lifter.txt` L1 | 652 ms | 721 ms | +69 ms |
| `solver_focus_long_group.json` | `Put the logs in the water, elephant.txt` L22 | 775 ms | 842 ms | +67 ms |

Concrete rule-count probes:

| Game | Total rules | Notes |
| --- | ---: | --- |
| `paint everything everywhere.txt` | 115 -> 105 | line 266 late preserved-`crate1` paint rule drops from 6 -> 1 |
| `Wand Spinner.txt` | 51 -> 51 | no phase-3b hit |
| `constellationz.txt` | 4 -> 4 | no phase-3b hit |
| `match three billiards.txt` | 33 -> 33 | already optimized by earlier coalescing |

## 2026-05-17 phase 3c multiple same-cell properties

Baseline: `b6cfe0da` (`Preserve safe single-cell coupled properties`).
After: this commit.

This phase adds pairwise layer-disjoint validation for multiple same-cell
properties in the movement and property-rewrite coalescers. The checked-in
focus games did not contain a new rule-count hit for this shape; coverage comes
from focused synthetic fixtures.

Commands used for the focus runs:

```sh
node src/tests/run_solver_tests_js.js src/tests/solver_tests \
  --solver-focus-manifest <manifest> \
  --timeout-ms <manifest timeout> \
  --strategy portfolio \
  --quiet --json --no-solutions
```

| Group | Timeout | Result | Compile ms | Solver elapsed ms | Step ms | Expanded | Generated |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `solver_focus_group.json` | 500 ms | 9 solved / 41 timeout / 0 errors both before and after | 233.6 -> 259.9 (+11.3%) | 23102 -> 23130 (+0.1%) | 18718.7 -> 18750.8 (+0.2%) | 250856 -> 251325 (+0.2%) | 1226115 -> 1228510 (+0.2%) |
| `solver_focus_long_group.json` | 2000 ms | 49 solved / 1 timeout / 0 errors both before and after | 253.2 -> 239.1 (-5.5%) | 45792 -> 44733 (-2.3%) | 37043.4 -> 36201.6 (-2.3%) | 476258 -> 475058 (-0.3%) | 2333673 -> 2327684 (-0.3%) |

Largest speedups:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `Vexatious Match 3.txt` L8 | 186 ms | 183 ms | -3 ms |
| `solver_focus_group.json` | `sokobond demake.txt` L20 | 71 ms | 68 ms | -3 ms |
| `solver_focus_long_group.json` | `constellationz.txt` L6 | 1080 ms | 638 ms | -442 ms |
| `solver_focus_long_group.json` | `witch lifter.txt` L1 | 711 ms | 621 ms | -90 ms |
| `solver_focus_long_group.json` | `pushit.txt` L1 | 1799 ms | 1730 ms | -69 ms |

Largest positive elapsed deltas:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `paint everything everywhere.txt` L9 | 415 ms | 450 ms | +35 ms |
| `solver_focus_group.json` | `heroes_of_sokoban_3.txt` L10 | 444 ms | 446 ms | +2 ms |
| `solver_focus_long_group.json` | `mazezam.txt` L55 | 1041 ms | 1060 ms | +19 ms |
| `solver_focus_long_group.json` | `SWIMMING TIME.txt` L2 | 1260 ms | 1277 ms | +17 ms |
| `solver_focus_long_group.json` | `dollyban.txt` L9 | 1394 ms | 1408 ms | +14 ms |

Concrete rule-count probes:

| Game | Total rules | Notes |
| --- | ---: | --- |
| `paint everything everywhere.txt` | 105 -> 105 | no phase-3c hit |
| `Wand Spinner.txt` | 51 -> 51 | no phase-3c hit |
| `constellationz.txt` | 4 -> 4 | no phase-3c hit |
| `match three billiards.txt` | 33 -> 33 | already optimized by earlier coalescing |

## 2026-05-17 phase 3d mixed movement/rewrite coalescing

Baseline: `85e8bf7c` (`Coalesce disjoint same-cell properties`).
After: this commit.

This phase accepts conservative mixed rules containing both layer-coupled
movement terms and property-to-object rewrite terms. The checked-in focus games
did not contain a new rule-count hit for this shape; coverage comes from a
focused mixed-rule fixture.

Commands used for the focus runs:

```sh
node src/tests/run_solver_tests_js.js src/tests/solver_tests \
  --solver-focus-manifest <manifest> \
  --timeout-ms <manifest timeout> \
  --strategy portfolio \
  --quiet --json --no-solutions
```

| Group | Timeout | Result | Compile ms | Solver elapsed ms | Step ms | Expanded | Generated |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `solver_focus_group.json` | 500 ms | 9 solved / 41 timeout / 0 errors -> 8 solved / 42 timeout / 0 errors | 281.4 -> 282.0 (+0.2%) | 23264 -> 23229 (-0.2%) | 18883.0 -> 18707.0 (-0.9%) | 241641 -> 240700 (-0.4%) | 1181240 -> 1177641 (-0.3%) |
| `solver_focus_long_group.json` | 2000 ms | 48 solved / 2 timeout / 0 errors -> 49 solved / 1 timeout / 0 errors | 256.7 -> 238.8 (-7.0%) | 46368 -> 45792 (-1.2%) | 37327.7 -> 37066.9 (-0.7%) | 468292 -> 474971 (+1.4%) | 2293780 -> 2327262 (+1.5%) |

Largest speedups:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `the_saga_of_the_candy_scroll.txt` L55 | 451 ms | 407 ms | -44 ms |
| `solver_focus_group.json` | `heroes_of_sokoban_3.txt` L10 | 486 ms | 443 ms | -43 ms |
| `solver_focus_long_group.json` | `constellationz.txt` L6 | 1140 ms | 632 ms | -508 ms |
| `solver_focus_long_group.json` | `pushit.txt` L1 | 1942 ms | 1739 ms | -203 ms |
| `solver_focus_long_group.json` | `gem soketeer.txt` L17 | timeout at 2000 ms | solved | status win |

Largest positive elapsed deltas:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `alternatey.txt` L4 | 110 ms | 187 ms | +77 ms |
| `solver_focus_group.json` | `Vexatious Match 3.txt` L8 | 181 ms | 202 ms | +21 ms |
| `solver_focus_group.json` | `15 push pull levels.txt` L21 | solved at 495 ms | timeout at 500 ms | status loss |
| `solver_focus_long_group.json` | `kreiseln.txt` L5 | 830 ms | 1873 ms | +1043 ms |
| `solver_focus_long_group.json` | `Wand Spinner.txt` L29 | 968 ms | 1060 ms | +92 ms |

Concrete rule-count probes:

| Game | Total rules | Notes |
| --- | ---: | --- |
| `paint everything everywhere.txt` | 105 -> 105 | no phase-3d hit |
| `Wand Spinner.txt` | 51 -> 51 | no phase-3d hit |
| `constellationz.txt` | 4 -> 4 | no phase-3d hit |
| `match three billiards.txt` | 33 -> 33 | already optimized by earlier coalescing |
