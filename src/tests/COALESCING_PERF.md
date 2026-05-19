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

## 2026-05-17 phase 4a late property-rewrite coalescing

Baseline: `fac365ba` (`Cache property alias layers and simplify helpers`).
After: this commit.

PuzzleScript rejects term-level movement annotations in `late` rules
(`Movements cannot appear in late rules.`), so this phase deliberately keeps the
cheap `late` guard on the movement-only and mixed movement/rewrite predicates.
Only the property-to-object rewrite predicate accepts late rules. A broad first
draft that removed all three `late` guards regressed `run_tests_node.js
--profile --breakdown` to 9.47s average; restoring the two syntactically
impossible paths brought the final result back to roughly neutral.

Validation-profile command:

```sh
node src/tests/run_tests_node.js --profile --profile-runs 5 --breakdown
```

The first narrowed sample measured 8.82s -> 8.65s, but a later single full-suite
run was slower. A paired rerun under the same current load is the safer number
to use:

| Metric | Baseline paired rerun | Final 4a paired rerun | Delta |
| --- | ---: | ---: | ---: |
| Total average | 9.49s | 9.55s | +0.6% |
| Compile | 3907 ms | 3904 ms | -0.1% |
| processInput | 6562 ms | 6629 ms | +1.0% |
| Undo | 12 ms | 12 ms | 0.0% |
| Restart | 25 ms | 25 ms | 0.0% |

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
| `solver_focus_group.json` | 500 ms | 3 solved / 47 timeout / 0 errors -> 8 solved / 42 timeout / 0 errors | 2278.6 -> 433.8 (-81.0%) | 25418 -> 23610 (-7.1%) | 20851.6 -> 19026.0 (-8.8%) | 174586 -> 181659 (+4.1%) | 858700 -> 881158 (+2.6%) |
| `solver_focus_long_group.json` | 2000 ms | 46 solved / 4 timeout / 0 errors -> 48 solved / 2 timeout / 0 errors | 337.5 -> 254.4 (-24.6%) | 52635 -> 46504 (-11.6%) | 42204.1 -> 37545.1 (-11.0%) | 470889 -> 475694 (+1.0%) | 2306704 -> 2330725 (+1.0%) |

The solver focus sample crossed several near-timeout boundaries and the planned
rule-count probes below are unchanged, so treat the large status changes as
focus-run noise rather than direct proof of a 4a solver win.

Largest speedups:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `sokobond demake.txt` L20 | timeout at 929 ms | solved at 70 ms | status win |
| `solver_focus_group.json` | `take heart lass.txt` L19 | timeout at 501 ms | solved at 118 ms | status win |
| `solver_focus_group.json` | `Vexatious Match 3.txt` L8 | timeout at 500 ms | solved at 199 ms | status win |
| `solver_focus_long_group.json` | `15 push pull levels.txt` L21 | timeout at 2000 ms | solved at 519 ms | status win |
| `solver_focus_long_group.json` | `heroes_of_sokoban_2.txt` L17 | 1938 ms | 1233 ms | -705 ms |

Largest positive elapsed deltas:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `dollyban.txt` L7 | timeout at 500 ms | timeout at 738 ms | +238 ms |
| `solver_focus_group.json` | `15 push pull levels.txt` L21 | solved at 478 ms | timeout at 500 ms | status loss |
| `solver_focus_group.json` | `dollyban.txt` L5 | timeout at 500 ms | timeout at 515 ms | +15 ms |
| `solver_focus_long_group.json` | `kreiseln.txt` L5 | 1051 ms | 1928 ms | +877 ms |
| `solver_focus_long_group.json` | `BIAXIAL INVASION OF SATURN.txt` L13 | 958 ms | 1031 ms | +73 ms |

Concrete rule-count probes:

| Game | Total rules | Notes |
| --- | ---: | --- |
| Synthetic `late [ Thing | Thing ] -> [ Good | Good ]` | 32 -> 2 | focused 4a regression fixture |
| `paint everything everywhere.txt` | 105 -> 105 | no phase-4a hit |
| `hairtug.txt` | 63 -> 63 | no phase-4a hit after preserving movement/mixed `late` guards |
| `Wand Spinner.txt` | 51 -> 51 | no phase-4a hit |
| `match three billiards.txt` | 33 -> 33 | unchanged |
| `diesinthelight.txt` | 35 -> 35 | no phase-4a hit |

## 2026-05-17 phase 4b random property-rule coalescing

Baseline: `c5581c53` (`Allow late property rewrite coalescing`).
After: this commit.

This phase removes the conservative `randomRule` guard from the three
property-preserving coalescers. Random rules still use the existing runtime
random scheduling machinery; the only intentional representation change is
that random groups count authored coalesced rules rather than alias-split
duplicates. Existing checked-in replay data did not need resimulation.

Focused synthetic rule-count probes:

| Probe | Before | After | Notes |
| --- | ---: | ---: | --- |
| `random right [ > Player | Crate ] -> [ > Player | > Crate ]` | 4 | 1 | layer-coupled movement metadata |
| random plus-group movement/rewrite pair | 5 | 2 | group size follows authored coalesced rules |
| `random [ Thing | Thing ] -> [ Good | Good ]` | 32 | 2 | property-to-object rewrite metadata |
| checked-in random solver corpus files | 0 changed games | 0 changed games | no new corpus hit for the 4b shapes |

Validation-profile command:

```sh
node src/tests/run_tests_node.js --profile --profile-runs 5 --breakdown
```

| Metric | 4a baseline | Final 4b | Delta |
| --- | ---: | ---: | ---: |
| Total average | 10.25s | 10.23s | -0.2% |
| Compile | 4233 ms | 4231 ms | -0.0% |
| processInput | 7056 ms | 7037 ms | -0.3% |
| Undo | 13 ms | 13 ms | 0.0% |
| Restart | 26 ms | 26 ms | 0.0% |

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
| `solver_focus_group.json` | 500 ms | 9 solved / 41 timeout / 0 errors -> 9 solved / 41 timeout / 0 errors | 262.4 -> 237.3 (-9.6%) | 23363 -> 23103 (-1.1%) | 18902.3 -> 18770.9 (-0.7%) | 240997 -> 249018 (+3.3%) | 1178137 -> 1217363 (+3.3%) |
| `solver_focus_long_group.json` | 2000 ms | 47 solved / 3 timeout / 0 errors -> 48 solved / 2 timeout / 0 errors | 243.3 -> 252.3 (+3.7%) | 46851 -> 46816 (-0.1%) | 37934.7 -> 37919.3 (-0.0%) | 474915 -> 475735 (+0.2%) | 2326986 -> 2331085 (+0.2%) |

Largest speedups:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `manic_ammo.txt` L10 | 431 ms | 359 ms | -72 ms |
| `solver_focus_group.json` | `the_saga_of_the_candy_scroll.txt` L55 | 477 ms | 412 ms | -65 ms |
| `solver_focus_group.json` | `alternatey.txt` L4 | 162 ms | 111 ms | -51 ms |
| `solver_focus_long_group.json` | `S-tercourse.txt` L23 | 1911 ms | 1752 ms | -159 ms |
| `solver_focus_long_group.json` | `Van-to-Mobile-Living-Space-Conversion Window.txt` L7 | 820 ms | 661 ms | -159 ms |

Largest positive elapsed deltas:

| Group | Target | Before | After | Delta |
| --- | --- | ---: | ---: | ---: |
| `solver_focus_group.json` | `15 push pull levels.txt` L21 | 487 ms | 496 ms | +9 ms |
| `solver_focus_group.json` | `paint everything everywhere.txt` L9 | 413 ms | 417 ms | +4 ms |
| `solver_focus_long_group.json` | `constellationz.txt` L6 | 633 ms | 1099 ms | +466 ms |
| `solver_focus_long_group.json` | `dollyban.txt` L9 | 1427 ms | 1655 ms | +228 ms |
| `solver_focus_long_group.json` | `gem soketeer.txt` L13 | 1245 ms | 1372 ms | +127 ms |

Native reverse-checks:

| Command | Result | Notes |
| --- | --- | --- |
| `make solver_parity_smoke` | passed | 7 solver parity smoke cases |
| `make solver_smoke_tests` | passed | 7 native solver smoke cases |
| `make simulation_tests_cpp_js_parity` | failed before and after | both 4a baseline and 4b produced 422 / 469 trace replays passing, 47 failing |

Additional verification:

| Command | Result |
| --- | --- |
| `node src/tests/run_layer_coupled_movement_node.js` | passed |
| `node src/tests/run_property_rewrite_coalescing_node.js` | passed |
| `node src/tests/run_tests_node.js` | passed, 742 / 742 |
| `node src/tests/static_analysis_testdata_runner_node.js` | passed |
| `node src/tests/run_static_analysis_runtime_contracts_node_test.js` | passed |
| `node src/tests/run_static_analysis_runtime_contracts_node.js` | passed, 469 cases plus 689 no-random replay checks |
| `node src/tests/solver_static_opt_node.js` | passed |
| `node src/tests/compare_solver_static_opt_runs_node.js --help` | exited 0 |

## 2026-05-17 phase 4c paint plus-group investigation

Baseline: `83533734` (`Coalesce random property rules`).
After: no code change.

The `paint everything everywhere.txt` plus-group at lines 255-262 is already on
the layer-coupled path. Each line has coupled movement match metadata and
coupled movement replacement metadata, so the crate property alias expansion is
not the remaining multiplier.

Probe command:

```sh
node -e '<compile paint everything everywhere and count lines 255-262>'
```

Probe result:

| Line range | Concrete rules | Coupled match metadata | Coupled replacement metadata | Interpretation |
| --- | ---: | --- | --- | --- |
| `255-262` | 4 per source line | yes | yes | property coalescing is already active |
| whole game | 105 total rules | n/a | n/a | unchanged from phases 3c/3d/4a |

The remaining `4x` is ordinary scan-direction expansion for a two-cell rule with
no explicit rule direction. Reducing that would require a separate,
semantics-sensitive optimization that proves the authored movement direction
also constrains the adjacency direction. This phase therefore lands as a
read-only finding rather than a compiler change.

Verification: the probe compiled the fixture with `errorCount === 0`; no runtime
or replay behavior changed.

## 2026-05-17 phase 4d relative-direction reachability investigation

Baseline: `3834c3a9` (`Document paint plus-group coalescing probe`).
After: no code change.

Relative movement directions do not reach the layer-coupled coalescer as raw
`>`, `<`, `^`, `v`, `parallel`, or `perpendicular` terms. The compiler pipeline
expands authored rule directions, calls `convertRelativeDirsToAbsolute(rule)`,
then calls `rewriteUpLeftRules(rule)`, and only afterwards enters
`concretizeMovingRule()` and `concretizePropertyRule()`.

This means `LAYER_COUPLED_MOVEMENT_DIRS` only needs to accept the absolute
directions plus `stationary`, `action`, and the plain object case. The existing
focused fixture `right [ > Player | Crate ] -> [ > Player | > Crate ]` already
exercises this path after `>` is converted to an absolute movement.

Probe result for `paint everything everywhere.txt` line 254:

| Source line | Concrete rules | Coupled match metadata | Coupled replacement metadata | Interpretation |
| --- | ---: | --- | --- | --- |
| `254` | 4 | yes | yes | `>` was absolutified before coalescing |

The four concrete rules again come from scan-direction expansion and the
up/left rewrite, not from relative-direction rejection. No compiler change is
needed for this phase.

Verification: source inspection of the compiler pass order plus fixture probe;
no runtime or replay behavior changed.

## 2026-05-17 phase 4e multi-cell preserved-property spike

Baseline: `d983f4cb` (`Document relative movement coalescing reachability`).
After: no code change.

I tried a temporary broad spike that allowed
`getPreservedLayerCoupledProperties()` to preserve same-position
layer-coupled properties across multi-cell and multi-row rules. The spike was
reverted.

Replay result under the spike:

| Command | Result |
| --- | --- |
| `node src/tests/run_tests_node.js "gallery game: at the hedges of time"` | passed, 1 / 1 |
| `node src/tests/run_tests_node.js` | passed, 742 / 742 |
| `node src/tests/run_layer_coupled_movement_node.js` | failed the intentional guard test that multi-cell preserved properties stay expanded |

Solver-corpus rule-count probe under the spike:

| Corpus result | Count |
| --- | ---: |
| Changed solver games | 15 / 184 |
| Largest reduction | `ponies jumping synchronously.txt`, 213 -> 101 (-112) |
| Next reductions | `pipe puffer.txt`, 150 -> 90 (-60); `Eyeball-watching flowers bloom.txt`, 114 -> 66 (-48) |
| Largest increase | `dreizack.txt`, 124 -> 168 (+44) |
| Other increases | `robotarm.txt`, 1003 -> 1015 (+12); `karamell.txt`, 123 -> 129 (+6) |

The reductions are real, especially for rules that preserve a layer-coupled
property while writing an ordinary marker such as `flow`. But the broad rule is
not monotonic: it increases concrete rule counts in several games, which means
it changes splitter interactions rather than merely deleting redundant alias
work. More importantly, split alias rules can serialize through temporary
blockers, while a single coalesced property rule batches matches across aliases.
That can be semantically relevant even when the checked-in replay corpus does
not expose it.

Outcome: do not land 4e yet. A future version needs a sharper safety condition,
probably tied to replacement locality and absence of RHS property inference,
before we should change the compiler.

## 2026-05-17 phase 4f lazy `no property` missing masks

Baseline: `47c94342` (`Document multi-cell preserved-property spike`).
After: this commit.

This phase stops expanding `no property` into a chain of `no alias_i` terms in
`expandNoPrefixedProperties()`. `getPropertiesFromCell()` now ignores `no`
terms, so missing-property constraints do not become property-splitting
drivers. Runtime masking already supports this because `rulesToMask()` reads
`state.objectMasks[propertyName]` and emits the union mask as
`objectsMissing`.

Focused fixture:

| Probe | Before | After |
| --- | --- | --- |
| `expandNoPrefixedProperties(state, ['no', 'thing'])` | `['no', 'alpha', 'no', 'beta', 'no', 'gamma', 'no', 'good']` | `['no', 'thing']` |
| `[ no Thing ] -> [ Good ]` on an empty cell | creates `Good` | creates `Good` |
| `[ no Thing ] -> [ Good ]` on `Alpha` | does not match | does not match |

Validation-profile command:

```sh
node src/tests/run_tests_node.js --profile --profile-runs 5 --breakdown
```

| Metric | 4f baseline | Final 4f | Delta |
| --- | ---: | ---: | ---: |
| Total average | 9.45s | 9.47s | +0.2% |
| Compile | 3904 ms | 3858 ms | -1.2% |
| processInput | 6502 ms | 6578 ms | +1.2% |
| Undo | 12 ms | 12 ms | 0.0% |
| Restart | 25 ms | 25 ms | 0.0% |

Solver focus:

| Group | Timeout | Result | Compile ms | Solver elapsed ms | Step ms | Expanded | Generated |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `solver_focus_group.json` | 500 ms | 9 solved / 41 timeout / 0 errors -> 9 solved / 41 timeout / 0 errors | 249.7 -> 233.3 (-6.6%) | 23130 -> 23112 (-0.1%) | 18781.8 -> 18750.7 (-0.2%) | 247538 -> 249814 (+0.9%) | 1210027 -> 1221129 (+0.9%) |
| `solver_focus_long_group.json` | 2000 ms | 49 solved / 1 timeout / 0 errors -> 49 solved / 1 timeout / 0 errors | 241.6 -> 236.7 (-2.0%) | 45568 -> 46167 (+1.3%) | 36973.5 -> 37451.7 (+1.3%) | 474865 -> 476048 (+0.2%) | 2326732 -> 2332624 (+0.3%) |

Largest focus deltas stayed in normal near-timeout noise: the 500 ms focus had
no status changes; the 2000 ms focus had no status changes. The largest long
positive elapsed delta was `constellationz.txt` L6, 641 ms -> 1112 ms; this game
has repeatedly moved around in prior focus samples without corresponding rule
count changes.

Concrete rule-count probes:

| Corpus | Result |
| --- | --- |
| checked-in solver corpus | 0 / 184 games changed rule count |

Additional verification:

| Command | Result |
| --- | --- |
| `node src/tests/run_property_rewrite_coalescing_node.js` | passed |
| `node src/tests/run_layer_coupled_movement_node.js` | passed |
| `node src/tests/run_tests_node.js` | passed, 742 / 742 |
| `node src/tests/static_analysis_testdata_runner_node.js` | passed |
| `node src/tests/run_static_analysis_runtime_contracts_node_test.js` | passed |
| `node src/tests/run_static_analysis_runtime_contracts_node.js` | passed, 469 cases plus 689 no-random replay checks |
| `node src/tests/solver_static_opt_node.js` | passed |
| `node src/tests/compare_solver_static_opt_runs_node.js --help` | exited 0 |

## 2026-05-18 phase 5a command-only rule coalescing

Baseline: `2600cf38` (`/simplify`).
After: this commit.

This phase adds `shouldCoalesceCommandOnlyRule`, a new predicate that catches
rules with `rhs.length === 0` (command-only: `cancel`, `again`, `restart`,
`win`, etc.) whose LHS contains a layer-coupled property term with disjoint
layer constraints. These rules were previously bailed out of the three
existing coalescer predicates because each required an RHS to validate.
They are now collapsed to a single `CellPattern`; no engine change is
needed because the LHS handler in `rulesToMask` already routes coupled
properties through `buildLayerCoupledMovementTerm`. The predicate defers to
the splitter when a sibling `no X` term overlaps the coupled property's
aliases, so the per-alias `X NO X` warnings keep firing for ambiguous
authoring patterns.

Focused rule-count probes (whole-game compiled rules incl. `lateRules`):

| Game | Before | After |
| --- | ---: | ---: |
| `hungry kraken.txt` | 711 | 503 |
| `Oh No My Dog Is About To Swallow A Piece Of.txt` | 373 | 257 |
| `robotarm.txt` | 1003 | 955 |
| `paint everything everywhere.txt` | 105 | 105 |
| `match three billiards.txt` | 33 | 33 |
| `easyenigma.txt` | 891 | 891 |
| `Voitex Rasteriser 2.txt` | 350 | 350 |

The three games that shrank all contain large `[ > property | … ] -> cancel`
groups whose LHS terms reference layer-coupled properties. Games where the
cancel rules only reference single-layer properties (or no cancel/again
rules at all) are unchanged.

Concrete rule-count probes:

| Corpus | Result |
| --- | --- |
| checked-in solver corpus probe | 3 / 7 sampled games changed rule count |

Additional verification:

| Command | Result |
| --- | --- |
| `node src/tests/run_property_rewrite_coalescing_node.js` | passed |
| `node src/tests/run_layer_coupled_movement_node.js` | passed |
| `node src/tests/run_tests_node.js` | passed, 742 / 742 |

## 2026-05-18 phase 5b single-row multi-cell preserved properties

Baseline: `5a450533` (`Coalesce command-only rules with coupled-property LHS`).
After: this commit.

The broad Phase 4e spike was unsafe because multi-row selector rules can use
property split order as control flow. In `gallery game: at the hedges of time`,
rules like:

```txt
late [PlayerSpr no Stop] [Mark no Crate no PlayerSpr] -> [PlayerSpr Stop] [Mark Highest]
```

rely on the concrete `Mark` aliases running in priority order. The first alias
that matches writes `Stop`, and later aliases fail their `no Stop` check. A
single coalesced `Mark` predicate would choose by spatial tuple order instead of
alias priority. Phase 5b therefore only preserves layer-coupled properties
across **single-row** multi-cell rules, and only when every changed cell contains
one of the preserved property candidates. Changed external control cells remain
on the old expansion path.

Concrete rule-count probes (whole-game compiled rules incl. `lateRules`):

| Game | Before | After |
| --- | ---: | ---: |
| `pipe puffer.txt` | 106 | 46 |
| `der hydra krypta.txt` | 360 | 336 |
| `gallery game: at the hedges of time` | 3087 | 3087 |
| `robotarm.txt` | 955 | 955 |
| `hungry kraken.txt` | 503 | 503 |
| `Oh No My Dog Is About To Swallow A Piece Of.txt` | 257 | 257 |
| `easyenigma.txt` | 891 | 891 |
| `Voitex Rasteriser 2.txt` | 350 | 350 |
| `paint everything everywhere.txt` | 105 | 105 |
| `match three billiards.txt` | 33 | 33 |

Full solver-corpus rule-count probe:

| Corpus result | Count |
| --- | ---: |
| Changed solver games | 2 / 184 |
| Rule-count decreases | 2 |
| Rule-count increases | 0 |

Solver focus comparison against the 5a baseline:

| Group | Timeout | Result | Compile ms | Solver elapsed ms | Step ms | Expanded | Generated |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `solver_focus_group.json` | 500 ms | 8 solved / 42 timeout / 0 errors -> 9 solved / 41 timeout / 0 errors | 235.5 -> 240.0 (+1.9%) | 23138 -> 23120 (-0.1%) | 18817.0 -> 18746.8 (-0.4%) | 243616 -> 249149 (+2.3%) | 1190786 -> 1218667 (+2.3%) |
| `solver_focus_long_group.json` | 2000 ms | 48 solved / 2 timeout / 0 errors -> 49 solved / 1 timeout / 0 errors | 243.3 -> 234.2 (-3.8%) | 46285 -> 44780 (-3.3%) | 37419.9 -> 36246.5 (-3.1%) | 476061 -> 474330 (-0.4%) | 2332715 -> 2324057 (-0.4%) |

Largest focus changes were still mostly near-timeout noise. The largest short
positive elapsed delta was `Vexatious Match 3.txt` L8, 183 ms -> 187 ms. The
largest long positive elapsed delta was `pushit.txt` L1, 1740 ms -> 1764 ms.

Additional verification:

| Command | Result |
| --- | --- |
| `node src/tests/run_property_rewrite_coalescing_node.js` | passed |
| `node src/tests/run_layer_coupled_movement_node.js` | passed |
| `make solver_smoke_tests` | passed, 7 cases |
| `make solver_parity_smoke` | passed, 7 cases |
| `node src/tests/run_tests_node.js` | passed, 742 / 742; Simulation 8.67s, Error messages 0.46s |

## 2026-05-18 phase 5c inferred RHS property bindings design spike

Baseline: `d52667df` (`Coalesce safe single-row preserved properties`).
After: this commit.

This spike renames the old "identity propagation" framing to **inferred RHS
property bindings**. The important semantic line is that independent LHS
property terms stay independent:

```txt
[ Prop | Prop ]
```

still means any `Prop` in the first cell and any `Prop` in the second cell.
The proposed runtime binding only applies to RHS property or movement aggregate
terms that the existing compiler already infers from a unique LHS occurrence.

No compiler/runtime optimization is enabled in this commit, so rule counts and
solver performance are intentionally unchanged. The current high-count 5c
targets remain:

| Game | Source line | Current concrete rules |
| --- | ---: | ---: |
| `hungry kraken.txt` | 598 | 108 |
| `easyenigma.txt` | 1074 | 100 |
| `easyenigma.txt` | 1075 | 100 |
| `robotarm.txt` | 366 | 80 |
| `Voitex Rasteriser 2.txt` | 271 / 276 / 281 / 286 | 72 each |

Additional verification:

| Command | Result |
| --- | --- |
| `node src/tests/run_inferred_rhs_property_bindings_node.js` | passed |
| `node src/tests/run_tests_node.js` | passed, 742 / 742; Simulation 8.07s, Error messages 0.42s |

## 2026-05-18 phase 6 step 1: unified coalescing-plan entry point

Baseline: `359beb13` (`Extract shared Node test harness`).
After: this commit.

This commit introduces a single unified entry point, `getCoalescingPlan`,
that replaces four sequential `shouldCoalesce*` short-circuits plus a
preserved-helper call inside `concretizePropertyRule`. The new entry
point returns `{ skippable, hasRewriteTerm }`; the splitter consults
`skippable` instead of the previous `preservedLayerCoupledProperties`.
The rule-level rewrite flag is renamed
`rule.propertyObjectRewriteRule` → `rule.hasInferredPropertyRewriteTerm`
to match what the runtime gate (`applyPropertyObjectRewriteClears`)
actually checks for.

Step 1 keeps the legacy predicates intact — `getCoalescingPlan`
delegates to them — so the change is a pure refactor. Step 2 (a later
commit) can inline each predicate into the walker and delete the
menagerie.

Parity validation: rule-count probe over all 184 games in
`src/tests/solver_tests/` shows bit-identical totals before vs after.
The four checked-in Node test suites pass with no fixture changes:
`run_tests_node.js` (742 / 742), `run_layer_coupled_movement_node.js`
(24 fixtures), `run_property_rewrite_coalescing_node.js` (9 fixtures),
`run_inferred_rhs_property_bindings_node.js` (4 fixtures).

## 2026-05-18 phase 6 step 2: absorb legacy predicates into the unified walker

Baseline: `dce43a4e` (`Unify coalescing dispatch into getCoalescingPlan walker`).
After: this commit.

This step inlines all five legacy coalescing entry points into the single
`getCoalescingPlan` walker and deletes them:

- `shouldCoalesceLayerCoupledMovementRule`
- `shouldCoalescePropertyObjectRewriteRule`
- `shouldCoalesceMixedPropertyRule`
- `shouldCoalesceCommandOnlyRule`
- `getPreservedLayerCoupledProperties`
- (plus the local helper `shouldAllowMultiCellPreservedLayerCoupledProperties`)

The new walker performs one structural traversal of the rule. Each cell is
visited once. Per-mode validity is tracked as a set of sticky-false flags,
and the dispatch at the end matches the legacy order
(movement → rewrite → mixed → command-only → preserved). Per-cell post-checks
(layer-disjointness via `propertyAliasLayerSet` / `layerSetsOverlap` /
`propertyRewriteTermsAreLayerDisjoint`) run per-mode against the
mode-specific tracker arrays accumulated during the walk.

Parity validation:

| Probe | Result |
| --- | --- |
| Rule-count probe across all 184 games in `src/tests/solver_tests/` | Bit-identical vs both Step 1 (`dce43a4e`) and pre-Phase-6 baseline |
| `node src/tests/run_tests_node.js` | passed, 742 / 742 |
| `node src/tests/run_layer_coupled_movement_node.js` | passed, 24 fixtures |
| `node src/tests/run_property_rewrite_coalescing_node.js` | passed, 9 fixtures |
| `node src/tests/run_inferred_rhs_property_bindings_node.js` | passed, 4 fixtures |

Net diff: `src/js/compiler.js` is `+288 / −440` lines, a `−152` line reduction.
The five legacy predicate definitions plus their shared row/cell/term
structural walks collapse into one walker with explicit per-mode
trackers and one dispatch tail. New term shapes plug in by adding a
mode arm.

## 2026-05-18 phase 6.5 R2: relax multi-cell preserved-only safety guard

Baseline: `7ce4a5e8` (`Absorb legacy coalescing predicates into the unified walker`).
After: this commit.

The legacy `getPreservedLayerCoupledProperties` enforced a per-cell safety
guard: every cell that differs between LHS and RHS must contribute at
least one preserved layer-coupled property candidate; otherwise no
property in the rule is preserved. This was added after the Phase 4e
spike (commit `47c94342`) when a broader relaxation tripped an
intentional guard test.

This commit drops that per-cell guard. The rule-level multi-cell gate
(no commands, no randomRule, no rigid, single row, multi-cell) still
applies; only the per-cell "candidate-per-changed-cell" check is removed.

Rule-count probe across all 184 solver corpus games:

| Game | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `Eyeball-watching flowers bloom.txt` | 114 | 98 | −16 |
| `puzzles.txt` | 91 | 79 | −12 |
| `Putting Bicycle Helmets on Young Children.txt` | 72 | 68 | −4 |
| `BIAXIAL INVASION OF SATURN.txt` | 58 | 57 | −1 |
| `a clear view of the sky.txt` | 56 | 55 | −1 |

Five games show reductions, zero games show increases, 179 games
unchanged. Total `−34` rules.

Behaviour parity validated via a deterministic-replay probe: each of
the 184 corpus games loaded with `compile(['restart'], src,
'phase6-replay-seed')`, then exercised with a fixed 20-input sequence
(right/down/left/up/action mix) on its first two non-message levels.
Level-state SHA-256 fingerprints compared before vs after: 182 games
identical, 0 different (2 skipped due to compile errors). The probe is
deterministic across baseline-vs-baseline reruns (verified 0 diffs).

Additional verification:

| Command | Result |
| --- | --- |
| `node src/tests/run_tests_node.js` | passed, 742 / 742 |
| `node src/tests/run_layer_coupled_movement_node.js` | passed, 24 fixtures |
| `node src/tests/run_property_rewrite_coalescing_node.js` | passed, 9 fixtures |
| `node src/tests/run_inferred_rhs_property_bindings_node.js` | passed, 4 fixtures |
| Deterministic-replay probe (184 games, 20-input sequence) | 0 behaviour diffs |

## 2026-05-19 phase 6.5 R1 / R3 / rewrite-count: negative findings

R2 landed in `559ff564`. The remaining candidate relaxations were tested
empirically and all turned out to be either zero-benefit or unsafe. No
code change shipped.

| Relaxation | Approach | Corpus rule-count | Behaviour (deterministic-replay, seeded) | Verdict |
| --- | --- | --- | --- | --- |
| R1: drop `sawMovementEffect` from movement-mode acceptance | Walker accepts movement-mode for any rule with name-matching terms in `LAYER_COUPLED_MOVEMENT_DIRS`, even with no movement effect | 0 changes (184 same) | 0 diffs (182 same, 2 compile-skip) | No corpus benefit; trips the `keeps multi-cell preserved layer-coupled properties on the expansion path` canary fixture. Not worth shipping. |
| Drop `propertyRewriteCount > 1` (rewrite-mode count gate) | Rewrite-mode fires for single rewrites as well | (not measured) | `gallery: vacuum` + `(NSFW / censored) Tugging…` simulation tests FAIL | Real semantic regression. The count gate is load-bearing for at least these recorded sessions. Not safe. |
| R3: drop mixed-mode's movement-vs-rewrite cross-check (movement-term layers may overlap rewrite-term alias / destination layers) | Walker keeps the per-cell pairwise disjointness on movement-vs-self and propertyRewriteTermsAreLayerDisjoint but drops the cross-check loop | 0 changes (184 same) | 0 diffs | Dead defensive code on the current corpus, but the check is principled (`applyPropertyObjectRewriteClears` would otherwise wipe coupled-movement bits on the rewrite property's alias layers). Kept as safety. |

Lessons:
- The walker's legacy-derived restrictions are tight to the current corpus's
  actual needs. Phase 6.5 R2 (multi-cell preserved per-cell guard) was the
  exception — that one was over-conservative.
- The deterministic-replay probe with seeded RNG (`compile(['restart'],
  src, 'phase6-replay-seed')`) is the right safety net for further
  relaxation attempts. Without seeding it produces ~9 false-positive
  diffs per run.
- Probe / corpus scripts used (cleaned up after each experiment):
  `/tmp/replay_probe_full.js` (184-game state-fingerprint diff) and
  `/tmp/corpus_rulecount.js` (per-game rule count).

## 2026-05-19 phase 7C: asymmetric LHS/RHS cell lengths

Baseline: `bc7229de` (`Document phase 6.5 R1/R3/rewrite-count negative
findings`). After: this commit.

The walker previously bailed every RHS-bearing mode when
`cell_l.length !== cell_r.length`. Phase 7C relaxes this: LHS-only tail
terms (termIndices `>= cell_r.length`) are allowed iff their direction is
`no` or `random` — constraint-only terms that the runtime LHS handler
processes via `objectsMissing.ior(state.objectMasks[name])` without
needing an RHS counterpart. Any other LHS tail term, or `cell_r.length
> cell_l.length`, still bails. Per-mode term classifiers skip the
LHS-only tail terms since they have no RHS partner to compare against.

### Solver corpus (`src/tests/solver_tests/`, 184 games)

| Game | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `Oh No My Dog Is About To Swallow A Piece Of.txt` | 257 | 181 | −76 |
| `robot arm.txt` | 967 | 907 | −60 |
| `robotarm.txt` | 967 | 907 | −60 |
| `SWIMMING TIME.txt` | 1053 | 1005 | −48 |
| `Eyeball-watching flowers bloom.txt` | 98 | 82 | −16 |
| `realtime dog mountain rescue.txt` | 190 | 182 | −8 |

6 games decreased, 0 increased, 178 unchanged. Total **−268 rules**.

### `testdata.js` (467 games)

| Game | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `vertebrae` | 11706 | 8166 | **−3540 (−30%)** |
| `gallery: season finale` | 2818 | 886 | **−1932 (−69%)** |
| `gallery:cyber-lasso` | 1728 | 1646 | −82 |
| `Oh No My Dog Is About To Swallow A Piece Of Chocolate` | 257 | 181 | −76 |
| `robotic arm` | 956 | 896 | −60 |
| `increpare game: robot arm` | 967 | 907 | −60 |
| `SWIMMING TIME!` | 1053 | 1005 | −48 |
| `gallery game: maera public works` | 178 | 162 | −16 |
| `gallery: Symbolism` | 330 | 314 | −16 |
| `Eyeball-watching flowers bloom` | 98 | 82 | −16 |
| `gallery game: Indigestion` | 423 | 409 | −14 |
| `gallery: vines` | 42 | 30 | −12 |
| `gallery: you're pulleying my leg` | 189 | 180 | −9 |
| `late beginloop/endloop test` | 41 | 33 | −8 |
| `REALTIME DOG MOUNTAIN RESCUE` | 190 | 182 | −8 |
| `gallery: i herd u liek water templs` | 64 | 60 | −4 |

16 games decreased, 0 increased, 451 unchanged. Total **−5,901 rules**.

### Behaviour parity

The seeded-RNG deterministic-replay probe (20-input sequence per
non-message level, first 2 levels per game) over the 184 corpus games
shows 0 behaviour diffs. The 742-test simulation suite (which includes
recorded play sessions for many of the high-impact testdata.js games:
vertebrae, gallery: season finale, gallery:cyber-lasso, Oh No My Dog,
robot arm, SWIMMING TIME, etc.) all pass.

### Verification

| Command | Result |
| --- | --- |
| `node src/tests/run_tests_node.js` | passed, 742 / 742 |
| `node src/tests/run_layer_coupled_movement_node.js` | passed, 28 fixtures (4 new for 7C) |
| `node src/tests/run_property_rewrite_coalescing_node.js` | passed, 9 fixtures |
| `node src/tests/run_inferred_rhs_property_bindings_node.js` | passed, 4 fixtures |
| solver-corpus rule-count probe | 6 decreases, 0 increases |
| testdata.js rule-count probe | 16 decreases, 0 increases |
| solver-corpus deterministic-replay probe | 0 behaviour diffs |

The single-hunk relaxation in `getCoalescingPlan`'s per-cell prelude
absorbs the previously load-bearing length-equality check. Combined
across both corpora, Phase 7C reduces compile-time rule output by
**−6,169 rules** in the games that benefit.

### Phase 7C runtime perf benchmark

Compile and per-input timings for the headline games, averaged over 10
compile runs and 200 turn-sequence runs (20 input tokens per sequence,
deterministic seed). Measured on a single host; absolute numbers depend
on hardware, but the deltas are stable across reruns.

| Game | Rules | Compile (ms) | Per-input (ms) |
| --- | --- | --- | --- |
| `vertebrae` | 11706 → 8166 (−30%) | 193.1 → 133.3 (**−31%**) | 1.615 → 1.490 (**−8%**) |
| `gallery: season finale` | 2818 → 886 (−69%) | 52.6 → 20.4 (**−61%**) | 0.107 → 0.061 (**−43%**) |
| `gallery:cyber-lasso` | 1728 → 1646 (−5%) | 26.3 → 26.1 (~) | 0.698 → 0.686 (−2%) |
| `SWIMMING TIME` | 1053 → 1005 (−5%) | 11.0 → 11.5 (+4%, noise) | 0.385 → 0.437 (+13%, noise) |
| `increpare game: robot arm` | 967 → 907 (−6%) | 12.1 → 9.1 (**−25%**) | 0.133 → 0.144 (+8%, noise) |
| `Oh No My Dog…` | 257 → 181 (−30%) | 8.1 → 6.6 (**−19%**) | 1.302 → 1.380 (+6%, noise) |

Compile-time savings track rule count linearly (one mask-building pass
per rule). Per-input savings are diluted by non-rule work (movement
resolution, `again` re-run loop, sound / checkpoint / state
bookkeeping); a 30% rule reduction translates to a smaller per-input
win when non-rule work dominates the turn loop. Games with the largest
rule cuts (vertebrae, season finale) show the cleanest perf wins; the
marginal cases (~5% rule cuts) land within measurement noise.
