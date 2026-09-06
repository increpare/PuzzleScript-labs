# Native movement buffer reuse

Retain this change: five paired comparisons show **2.7% less time for identical
solver work**, **3.2% less time for full replay**, and **2.4% less time for Chaos
Wizard generation**. These are modest measured gains, not a claim of more levels
solved or a general generator speedup. The rejected future-rule filter remains
removed.

## Change and safety boundary

The production change is confined to `native/src/runtime/core.cpp`. Ordinary
movement previously allocated source, original-source, destination and moving-
entity vectors for each attempted move, plus a movement vector in the tile loop.
Blocked moves copied three object vectors before discovering the collision.

The runtime now checks destination occupancy before copying. Successful attempts
reuse existing replacement buffers for source/destination objects, and the tile
and failure scans reuse the existing movement buffer. Sound matching reads the
original board before either write; the separate moving-entity vector is needed
only for debug output. Both output masks are prepared before mutation, preserving
the action case where source and destination are the same cell.

Rule replacement and movement resolution execute in separate phases. Movement
setters and audio collection do not invoke replacement. Replacement overwrites
its temporary buffers before reading them on its next invocation, so these
buffers can share storage without sharing live values. Existing level-reset
handling retains their capacity. `Scratch` has no additional fields.

No rules, group boundaries, input eligibility, movement ordering, player-count
assumptions, search priorities or state keys are changed. The change benefits the
native interpreter and interpreter fallback paths; emitted whole-turn kernels
are unchanged. No new flag or per-level analysis is introduced.

## Rejected probes before this change

Two rule-group bookkeeping variants failed the timing gate and were removed:

- Removing active-rule counting and consecutive-failure tracking entirely gave
  replay **9,695.9 -> 9,879.8 ms**. It also removed the all-inactive shortcut:
  mask-rebuild calls increased **2,969,370 -> 3,117,404**.
- Retaining that shortcut with an early-stop active-rule scan still gave replay
  **10,067.0 -> 10,092.8 ms**, with no convincing general generation improvement.

An initial movement version added three buffers to `Scratch`. Its replay was
neutral (**10,943.0 -> 11,013.2 ms**), although Chaos Wizard generation improved
in three pairs. The retained implementation reuses existing buffers instead.
We do not attribute the timing difference to speculative copies: ordinary solver
node snapshots already avoid copying replacement scratch, and again probes
restore snapshots in place. Avoiding extra storage is a design benefit; the
performance claim rests on the measurements below.

The compact probe record includes every pair and binary hashes:
`docs/benchmarks/2026-09-06-movement-prior-probes.json`.

## Measurements

Baseline is freshly built revision `e8fa3354`, after removal of the unsuccessful
future-rule filter. Both builds use MSVC 19.44 Release and 64-bit mask words, with
matching build configuration. Measurements alternate separate processes after
one warmup per binary. Native compilation/building and other heavy tests are not
run concurrently with timed comparisons. Process wall includes PuzzleScript
compilation, setup and output; it excludes building the C++ executables.

### Fixed solver work

`solver_fixed_work_bench` calls the actual candidate-level solver C API. It runs
BFS with the same seed and a **2,000-expansion cap** on every playable level in
Cake Monsters, Chaos Wizard, Drop Swap and Midas. A 60-second wall deadline is
only a guard: reaching it before the expansion cap fails the benchmark. Solved
results undergo the C API's normal replay validation.

The comparator requires identical per-level statuses, expanded/generated/unique/
duplicate counts, maximum frontiers and complete solutions. All five pairs match
across **78 levels**: **19 solved, 59 capped**, **126,069 expanded** and **571,245
generated** states per run. Capped searches are not claimed solved.

| Pair | Baseline, ms | Updated, ms |
| --- | ---: | ---: |
| 1 | 8,178.5 | 8,480.4 |
| 2 | 8,552.0 | 8,272.5 |
| 3 | 8,442.6 | 8,119.8 |
| 4 | 8,611.3 | 8,303.4 |
| 5 | 8,505.6 | 8,259.6 |
| Median | 8,505.6 | 8,272.5 |

That is **2.74% less median process time**, with four of five pairs faster. The
slower first pair is retained. A longer 10,000-expansion pilot completed one
matching pair at **41,268.6 -> 38,285.4 ms (7.23% less time)**. Its following pair
was deliberately interrupted to bound experiment duration; only the complete
pair is retained, and it is not the repeated-gain claim.

### Replay and generation

The replay workload is the full 470-case built-in simulation corpus, repeated
twice with one worker. All **940 checks** pass in both binaries in every run.
All five pairs are faster: median **11,078.5 -> 10,722.9 ms (3.21% less time)**.
Both sides visit **8,614,606 rules** and apply **7,154,630 replacements**. This gain
comes from executing the same work more cheaply, not omitting rules.

Generation uses generic remix, 200 samples, one worker, seed 11 and 10 ms
per-search limits. Every run completes 200 samples without interrupted
assessments. These search limits can change exploration/keepers as throughput
varies, so generator comparisons are separate from the fixed-work proof above.

| Game | Baseline median, ms | Updated median, ms | Identical retained outputs across runs |
| --- | ---: | ---: | --- |
| Cake Monsters | 1,618.7 | 1,614.7 | No |
| Chaos Wizard | 1,091.5 | 1,065.8 | Yes |
| Drop Swap | 1,266.0 | 1,270.8 | Yes |
| Midas | 1,933.0 | 1,920.5 | Yes |

Chaos Wizard improves in all five pairs, with **2.36% less median time** and
identical output. Midas also improves in all five pairs, but by only **0.65%** at
the median. Cake Monsters and Drop Swap are effectively neutral/noisy. No broad
generator multiplier or improvement in keeper quality is claimed.

### Time-limited portfolio results: no solve-count gain

Three separate 250 ms portfolio pairs on these four games give solved counts
**40 -> 40**, **41 -> 36**, and **40 -> 40**, with zero errors. Median process time
is **11,386.3 -> 11,434.8 ms**. The adverse second pair is retained. The fixed-work
comparison was added because these runs could not establish a throughput or
solve-count improvement; they do not justify claiming stronger search behavior.

## Validation and limits

- A new player-API regression covers multiple movers, chain resolution, action
  aliasing, a blocked player alongside movement on another layer, movement and
  failure sound identity/order, undo, restart and horizontal/vertical level
  reloads. It repeats with 130 extra objects/layers to exercise multiword masks.
  It passes in both 32-bit and 64-bit mask builds.
- Existing player API, generated-solution replay and compiled-backend linkage
  checks pass. The fixed-work comparisons additionally check complete search
  results across all 78 levels.
- The separate direct JS-reference harness is **467/470** in both binaries.
  Both Two Worlds cases and Rose have identical baseline mismatches. This harness
  is not claimed fully green; its concurrent verification runs are not timing
  evidence.
- Performance evidence is from one Windows host and these workloads. The full
  MIS GUI and other platforms were not rebuilt. The native C API used by
  candidate assessment is covered; emitted native turn kernels are not sped up.

## Reproduction and artifacts

Build `puzzlescript_cpp`, `puzzlescript_generator` and `solver_fixed_work_bench` in
matching configurations. To reproduce the baseline fixed-work executable, use
an isolated `e8fa3354` checkout and copy only the benchmark source and its CMake
target declaration into it; keep its runtime unchanged. Place the four exact
source files listed above in a corpus directory. Artifact source hashes identify
the inputs.

```
node src/tests/compare_native_runtime.js BASELINE_BIN_DIR UPDATED_BIN_DIR runtime.json 5 all
node src/tests/compare_native_fixed_work.js BASELINE_BENCH UPDATED_BENCH CORPUS_DIR fixed.json 5 2000
```

Raw paired results and binary hashes:

- `docs/benchmarks/2026-09-06-movement-runtime.json`
- `docs/benchmarks/2026-09-06-movement-fixed-work.json`
- `docs/benchmarks/2026-09-06-movement-fixed-work-pilot.json`
- `docs/benchmarks/2026-09-06-movement-timed-solver.json` (all outcomes/solutions and
  aggregate timers retained; repetitive per-level configuration/timers omitted)

Input-specific whole-ruleset turn code remains a separate unimplemented
experiment. Failure of the small group-counting probes does not settle its value.
Any such change must meet the same end-to-end performance gate before inclusion.
