# Per-input movement flow: useful, but not a general breakthrough

Retain the stronger **compile-time eligibility analysis**, using the existing
execution paths. Robot Arm's repeated candidate-level BFS takes **9.2% less
time in seven alternating pairs**, with identical search results and complete
solutions. Full JavaScript simulation takes **2.9% less time in five pairs**.
The corpus-wide native improvement is modest and variable. The more elaborate
native rule lists and group-skipping schedules were removed after failing the
performance gate.

This is not a new search heuristic, a genre detector, or a C++-compiled turn
kernel. It improves which rules the existing interpreter considers for each
input. It makes no claim of more levels solved or better generated puzzles.

## What was already there, and what changed

Both compilers already computed six input masks: up, left, down, right, action,
and tick. They seeded movement on player layers, then took a transitive closure
over possible movement writes. JavaScript already built filtered arrays inside
each original rule group; native code already checked each rule's input mask.

The previous analysis flattened the ruleset and treated positive movement reads
as one large OR. It also treated `forceAlwaysRun` as an unconditional source of
movement writes. The replacement improves three things:

1. **Preserve AND/OR requirements.** Every mandatory movement bit must be
   possible, each OR clause needs a possible alternative, and coupled property
   alternatives must have a viable layer. One reachable bit cannot satisfy an
   entire conjunction.
2. **Follow the group graph.** Movement possibilities reach a fixed point within
   a group, propagate forward, and propagate backward through explicit loops.
   A later rule no longer activates an earlier group merely because both appear
   somewhere in the ruleset. Compile eligibility after constructing loop tables.
3. **Separate side-effect protection from matchability.** Random, rigid and
   command rules retain their runtime safeguards. Those safeguards cannot make
   an unavailable positive movement match, so impossible matches do not seed
   fictitious downstream movement.

For example, an action rule can create rightward movement, which activates a
later rightward-movement rule. If that second rule is in an earlier group, it
needs an explicit loop to see the newly created movement during this pass.
Rules without positive movement requirements remain potential roots on every
input. Autonomous rules are not assumed to be caused by a button press.

The analysis unions possibilities and never removes them. It deliberately
ignores object presence, object absence and negative/stationary movement tests:
arbitrary candidate boards, deletion and movement clearing can satisfy them.
It conservatively retains ordering alternatives and rigid retries. Late rules
remain eligible for every input; existing execution handles movement resolution,
late phases, startup, again, restart and undo. Original groups and loops remain
intact. Neither runtime core nor its data structures change.

All six analyses run once per compiled ruleset. Generated candidates reuse the
result. There is no board scan or flow analysis for each candidate, no fixed
player-count assumption, and no special meaning assigned to crates or targets.

## Static reach

All **184 solver source files** compiled. Compared with the previous closure,
**106 files** receive tighter masks. Eligible early-rule/input combinations
fall **59,352 -> 47,143**, a **20.6% reduction**, with no newly eligible pair.
These are source files, not distinct games: the corpus contains duplicate or
related versions. These counts measure static eligibility, not execution time.

Examples of before/after eligible combinations:

| Source | Before | After |
| --- | ---: | ---: |
| Hydra Krypta | 1,974 | 785 |
| Easy Enigma | 4,097 | 2,929 |
| Robot Arm, each of two corpus versions | 4,897 | 3,857 |
| Swimming Time | 5,346 | 4,397 |
| Threes | 1,861 | 1,079 |

## Measurement design and results

Baseline is revision `aed73b41`. Native builds use MSVC 19.44 Release, x64,
64-bit mask words, and matching build settings. Timings run serially, without
concurrent compilation or heavy tests. Every comparison warms both sides and
alternates their order. All complete pairs, including regressions and outliers,
are retained in `benchmarks/2026-09-06-input-flow.json`.

### Same-executable native comparison

Separate native binaries produced noisy small differences, including differences
on unchanged rulesets. A dedicated test therefore compiles each source once,
reconstructs the legacy masks, and switches only masks between completed solves
on the **same Game, at the same addresses, in the same executable**. This excludes
source compilation and initial grid preparation, reflecting repeated use of one
ruleset during generation. The actual candidate-level C API, BFS setup and normal
solution replay validation remain in the measured work.

A 60-second wall guard fails the benchmark if reached before the expansion cap.
Each observation must match warmup status, expanded/generated/unique/duplicate
counts, maximum frontier and the complete solution for every level. Capped
searches are not counted as solved.

The survey covers **1,346 playable levels**, capped at 20 expansions, with five
pairs per source. Summing each source's median gives **15,003.9 -> 14,741.3 ms
(1.75%)**. Changed sources give **13,410.6 -> 13,142.9 ms (2.00%)**; unchanged
controls give **1,593.3 -> 1,598.4 ms**. Summed pair totals are mixed:

| Pair index across sources | Legacy, ms | Flow, ms |
| --- | ---: | ---: |
| 1 | 15,160.2 | 14,671.1 |
| 2 | 15,181.4 | 16,317.8 |
| 3 | 14,826.8 | 14,631.2 |
| 4 | 15,046.1 | 14,763.1 |
| 5 | 15,146.2 | 16,095.3 |

These are source-by-source repeated measurements, not five independent whole-
corpus process runs. They do not justify a confident broad native speed claim.

Robot Arm stood out: the two corpus versions had median reductions of 14.9%
(three of five pairs faster, two large regressions) and 9.4% (five of five faster).
That result motivated a **separate validation run**, with a 100-expansion cap,
seven pairs, one Robot Arm version and two controls. The selection is explicit;
it is not an unbiased corpus speed estimate.

| Validation source | Levels | Legacy median, ms | Flow median, ms | Faster pairs |
| --- | ---: | ---: | ---: | ---: |
| Robot Arm | 3 | 6,759.0 | 6,136.4 | 7/7 |
| Chaos Wizard, changed masks | 22 | 158.5 | 162.2 | 3/7 |
| Midas, unchanged masks | 15 | 104.9 | 105.5 | 2/7 |

Robot Arm's seven raw pairs are 6685.9->6282.2, 6927.7->6136.4,
6750.4->6305.1, 6716.2->6086.7, 6759.0->6065.0, 6966.3->6073.9,
and 6981.6->6158.6 ms. This is the strongest native evidence for retaining the
analysis. Three of the usual four benchmark rulesets (Cake Monsters, Drop Swap,
Midas) have unchanged masks; their separate-binary differences cannot establish
a flow-analysis benefit.

### JavaScript and generation

Full JS simulation uses the same engine, fixture, Node binary and VM loader;
only `compiler.js` changes. All 470 cases pass in every observation. Process wall
includes source compilation and startup: **12,418.2 -> 12,060.9 ms (2.88%)**,
faster in all five pairs. Both sides execute 22,314 input calls per observation.

The four standard native generation probes use 200 remix candidates, seed 11,
one worker and 10 ms per search. They include source compilation and output and
do **not** show a general gain for analysis alone: median Cake Monsters
1610.1->1634.6 ms; Chaos Wizard 1053.5->1133.1 ms; Drop Swap 1248.1->1239.0 ms;
Midas 1919.0->1921.5 ms. Cake and Chaos outputs vary under the wall limits;
Drop Swap and Midas outputs agree. These probes are not fixed-work measurements.

Robot Arm's separate generation validation gives **8939.3->8375.4 ms (6.31%)**,
faster in all five pairs: 9012.1->8575.9, 8939.3->8369.2, 8784.8->8359.6,
8814.5->8375.4, 8982.2->8471.1 ms. All runs attempt 200 candidates without
interrupted assessments. All produce the same output, but **zero keepers** at
this short search budget. This demonstrates faster candidate evaluation in the
real generator, not better levels or more successful generation. The fixed-work
BFS comparison above is the evidence that identical search work is faster.

### Native execution machinery rejected

- Initial prebuilt per-group rule-index lists: 78-level fixed BFS median
  8442.9->8315.9 ms, only 1.5%; one whole-corpus cap-100 pair
  75611.5->73131.1 ms. The longer run was stopped after that completed pair
  to refine the analysis; no incomplete pair is used.
- Refined masks plus native rule lists: five whole-corpus cap-20 pairs improve
  16144.7->15958.7 ms (1.15%); full native replay 9816.9->9495.4 ms (3.3%,
  four of five faster). Generation medians regress on all four standard cases,
  including identical-output Chaos Wizard 1044.2->1076.0 ms. Removed.
- Skipping whole inactive groups while preserving original loop checkpoints:
  compared with the rule-list version on the statically selected Swimming Time,
  Hydra Krypta, Robot Arm and Threes corpus, cap 500. Both completed pairs are
  slower: 44676.0->46468.4 and 45243.1->45822.9 ms, despite identical results.
  The third pair was interrupted; both complete pairs remain in the evidence.
  Removed all new native scheduling tables and runtime branches.
- Analysis-only separate-binary standard fixed BFS: 9020.1->8839.4 ms median,
  but wide variation and three unchanged rulesets make it weak attribution
  evidence. This motivated the same-executable comparison above.

No explanation based on fewer rule visits substitutes for elapsed-time evidence.
One reason the static reduction need not translate into a large native gain is
already visible in `ruleCanPossiblyMatch`: the runtime cheaply rejects missing
object and required movement bits using board masks. Flow can move some of that
rejection earlier, but often it removes work that was already inexpensive.

## Correctness checks

- Focused JS eligibility and execution tests: 17 flow cases, direction/action/
  tick traces including every length-three combination in a deterministic walk.
- Focused native masks and independent length-three input sequences: 18 flow
  cases, two-player boards and a 130-extra-layer case crossing word boundaries.
  Compare against a Game copy with every early rule enabled. Verify states,
  transition flags and sound identities. Run with both 32/64-bit mask words.
- Full JS input-specialization parity: 470 cases. Full native simulation:
  470 cases. These are each engine's regression checks, not a claim that all
  pre-existing JS/native discrepancies have been resolved.
- Full JS suite: 759 passed (470 simulations and 289 compiler diagnostics),
  plus the random-replay regression.
- Mutate 48 boards in each of four rulesets (192 boards), including legal
  arbitrary layer occupants and zero/multiple players. Compare unfiltered vs
  specialized startup and 32 subsequent operations, including undo/restart:
  **6,336 state boundaries** match, with 43 zero-player and 76 multiple-player
  candidate boards. Declared objects without collision layers
  are correctly excluded from candidate placement.
- Native player API, generated-solution replay and compiled-backend linkage
  checks pass. Existing emitted kernels retain their existing behavior.

## Reproduce and interpretation

Build `input_flow_survey`, `input_flow_same_binary_bench`,
`input_flow_generated_boards` and `compiler_input_specialization_masks` with
the repository's native CMake configuration. From the repository root:

```text
input_flow_survey src/tests/solver_tests
input_flow_same_binary_bench src/tests/solver_tests 20 5
input_flow_same_binary_bench <directory-with-robot-arm-chaos-wizard-midas> 100 7
input_flow_generated_boards
node src/tests/input_flow_node.js
node src/tests/input_specialization_parity_node.js
node src/tests/compare_input_flow_js.js <aed73b41-compiler.js> <output.json> 5
node src/tests/compare_native_runtime.js <aed73b41-bin-dir> <candidate-bin-dir> <output.json> 5 generator --games-json '["robot arm"]'
```

Evidence includes source and binary hashes and complete solver outcomes, with
lossless references for repeated identical result arrays. Do not equate the
20.6% static eligibility reduction with a 20.6% speedup. The retained change has
a repeatable benefit in a complex non-Sokoban ruleset and a modest JS benefit;
the general native solver/generator breakthrough remains unproven.
