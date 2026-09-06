# Native future-rule eligibility: implementation and measurements

The native interpreter can now omit rules whose necessary object types cannot
exist again along the current continuation. This is an opt-in experiment:
`PUZZLESCRIPT_FUTURE_RULE_PRUNE=1` must be set when compiling or loading the game.
The final measurements establish fewer rule visits, **not a repeatable overall
speedup**. Do not enable it by default on the strength of these results.

## Relationship to wake/sleep and group splitting

These analyses answer different questions. Wake/sleep asks whether changes since
the preceding pass could affect a rule's positive, negative or movement reads.
Future eligibility asks whether the rule's positive prerequisites can ever be
available again. An impossible positive prerequisite excludes a rule even when
the ordinary scheduler would initially wake it. An absent negative prerequisite
does not exclude a rule: disappearance can make a negative match succeed.

The implementation retains original groups, group order, rule order, fixed-point
passes, loop points, rigid retries, commands and existing wake/input checks. It
uses ordered eligible indices inside ordinary groups. Unaffected groups retain
direct traversal. It does not split groups or introduce a new work queue. This
avoids adding group setup overhead of the kind reported in the earlier group
splitting experiment, although it does not remove the existing setup cost.

## Proof and ownership

`native/src/runtime/future_rules.{hpp,cpp}` derives a ruleset plan from native
lowered patterns. The native source compiler and runtime-IR loader install the
same runtime-only analysis; the runtime library still links without the compiler.
This is a native implementation of the conservative creation-closure idea, not
transport of the JavaScript invariant report. It consumes neither spatial
invariants nor the exactly-one-player certificate.

Each rule contributes necessary positive objects, separate property-OR clauses,
and possible RHS creations. A fixed point starts with the current exact presence
mask and admits creations from reachable early and late rules across all inputs.
It ignores negative, spatial, movement and multiplicity requirements. Consequently
it can admit infeasible creations, but must not omit feasible ones. An unseeded
creation cycle cannot bootstrap itself. Eligible lists retain rules whose positive
requirements hold in the resulting overapproximation.

Conservative boundaries:

- Dynamic replacements admit every object type when their rule is reachable;
  property alias sinks and random-entity masks are also included. This sacrifices
  coverage rather than guessing capture semantics.
- Random groups retain their entire established candidate/RNG path.
- Any restart/checkpoint command disables filtering for the ruleset until restored
  board roots are modelled. Ordinary user undo/restart and solver restoration are
  safe because the next turn validates its exact presence key again.
- Movement preserves object types. A level transition binds a new selection on
  the next turn; startup execution and rigid retry restoration also rebind.
- Generated whole-turn/compact kernels are unchanged. Interpreted turns and
  interpreter fallback paths consume the filter; a generated group can still
  execute its original unfiltered code safely. This is not a generated-kernel
  speed claim, and it does not prune solver states or change the search heuristic.

One immutable compiled `Game` owns a bounded FIFO cache of 256 populations,
shared by generator workers. The key is exact object presence, independent of
board dimensions and geometry. Entries hold immutable closure masks and ordered
indices. Cold closure computation is synchronized to avoid duplicate worker work.
The existing runtime board-union mask supplies the key: no additional board scan
is introduced. A per-session memo bypasses hashing and locking while both the
ruleset owner and exact presence remain equal, including across level reloads.
It retains its owner to prevent stale reuse after a different compilation.
The existing native win-relevance optimizer clones and shortens rule groups after
compilation, so it rebuilds the cache after transformation. Sharing the original
cache there would leave stale rule indices and potentially skip surviving rules
or index beyond a shortened group. A combined-options regression covers removal
of an impossible rule before a surviving rule in the same group.

This meets the reuse requirement for generation: compilation builds the plan
once; repeated populations reuse results across different candidate layouts.
Distinct populations can still cause cold work and eviction. The bound is by
entry count, not bytes. There is no claim that arbitrary new populations are free.

The generator's optional `future_rule_filter` JSON field reports support,
shared-cache queries and misses. Queries exclude successful local memo hits, so
they are not a turn count. The default flag-off path allocates no closure plan.

## Correctness evidence

`native/tests/future_rule_prune.cpp` compares filtered and ordinary execution from
identical states/seeds. It checks snapshots (including RNG), result flags,
pending-again state, undo depth and restart objects; exhaustive branches also
compare audio counts and verify that child presence remains within the closure.
Restoring parent copies tests non-monotone search traversal.

- 192 exhaustive three-cell populations plus focused cases: **13,785 transitions**,
  **1,640 affected-root observations** per run. Cases cover backward wakes,
  negative matching, unseeded cycles, absence-triggered creation, ellipsis, random
  groups, late/again, cancel, startup, captures, aggregates, explicit win,
  reset/checkpoint fallback and rigid failure. A wide fixture spans multiple words
  and signed high bits. FIFO eviction, four concurrent cache readers, population
  changes, same-population reloads and changed-ruleset ownership are checked.
- All four combinations of input specialization and incremental pruning pass
  with **both 32-bit and 64-bit mask words**, MSVC Release. The generated replay
  and runtime standalone-link checks also pass in the 64-bit build.
- `native_solver_win_relevance_node.js` passes with filtering enabled, including
  the new same-group deletion regression and the existing movement/collision
  relevance canaries.
- Native source corpus: **184 games**, zero compile rejects, **37,002 transitions**,
  **291 affected-root observations**, no differential mismatch. This bounded walk
  and first-input exploration is not exhaustive game-state coverage. Counts are
  observations, not unique levels or states.
- JavaScript-compiled runtime IR for the same **184 games** also passes filtered
  versus ordinary execution: **37,157 transitions / 158 affected-root observations**
  with 64-bit words, **37,002 / 64** with 32-bit words. The loader hook itself is
  exercised. These are within-build differential checks; they do not establish
  cross-width or JS/native compiler equivalence (the samples differ).
- The native built-in simulation runner passes **940/940** checks in every timed
  run (470 cases repeated twice), filter off and on.
- The separate `run_simulation_tests_cpp_direct.js` reference harness passes
  **467/470** with either setting. Both cases named Two Worlds and the Rose case
  have identical failures on the flag-off binary. These are existing mismatches
  relative to this feature's baseline; the direct harness is not fully green.

## Timings and rejected optimism

All timings use one binary with the flag off/on, alternating serial processes
after warmups. They include compilation, startup and output. Heavy tests/builds
were not run concurrently with timing. These comparisons measure the option's
incremental effect, not the cost of the code change against its parent revision.
Raw reports include binary SHA-256 identities and counters.
The timed binaries predate the final win-relevance cache-rebuild guard; none of
these timing workloads enables win-relevance pruning. That interaction is
validated separately with the combined-options regression.

The initial version consulted the shared cache on every interpreted turn. Its
replay median looked promising: **10,973.8 -> 9,949.4 ms**. Generation was neutral
or slightly worse, including **395.2 -> 413.3 ms** for four-worker Cake Monsters.
The initial artifacts are retained rather than treating that replay result as a
confirmed gain. The final version adds the local memo and avoids eligible-index
indirection for unaffected groups.

Final full replay workload (two repetitions of 470 cases, one worker):

| Pair | Filter off, ms | Filter on, ms |
| --- | ---: | ---: |
| 1 | 9,580.9 | 9,719.1 |
| 2 | 9,452.5 | 9,608.0 |
| 3 | 9,573.3 | 9,000.7 |
| Median | 9,573.3 | 9,608.0 |

Rule visits consistently fall **8,614,606 -> 8,451,332** (163,274 fewer; 1.90%),
with exactly **7,154,630 replacements** on both sides. Two slower pairs and one
faster pair do not establish a repeatable throughput improvement. Cheap mask
rejections and bookkeeping remain a plausible explanation, not a demonstrated
profile attribution.

Final generic remix generation: 100 candidates, seed 11, 10 ms per-search budget,
three alternating pairs after warmups. Every run completes its sample budget
without interrupted assessments.

| Game / workers | Off median, ms | On median, ms | Retained outputs identical |
| --- | ---: | ---: | --- |
| Cake Monsters / 1 | 814.6 | 819.1 | Yes |
| Chaos Wizard / 1 | 529.1 | 531.3 | Yes |
| Drop Swap / 1 | 611.2 | 618.8 | Yes |
| Midas / 1 | 970.8 | 969.8 | Yes |
| Cake Monsters / 4 | 412.1 | 389.8 | No |

The single-worker results are effectively neutral/slightly worse. The 5.4%
four-worker reduction comes with scheduling-dependent keeper differences and
reverses the initial run's direction. It is not evidence of a reliable generator
gain. Time-bounded solver exploration also changes query counts. Final shared
cache misses range from 22 to 188 per run; successful reuse alone is insufficient
to establish useful speed improvement.

Artifacts:

- `docs/benchmarks/2026-09-06-native-future-rules-performance.json`
- `docs/benchmarks/2026-09-06-native-future-rules-performance-initial.json`
- `docs/benchmarks/2026-09-06-native-future-generator.json`
- `docs/benchmarks/2026-09-06-native-future-generator-initial.json`

Reproduce with `node src/tests/compare_native_future_rules.js <cpp-executable>
<output.json> 3` and `node src/tests/compare_native_future_generator.js
<generator-executable> <output.json> 3`. Run the focused CTests named
`future_rule_prune*`; run `future_rule_prune --corpus src/tests/solver_tests` for
native source coverage. For JS-compiled IR, export source files into an isolated
directory with `src/tests/js_oracle/export_ir_json.js`, then run
`future_rule_prune --ir-corpus <directory>` with the feature environment flag set.

## Next experiment: specialize turn paths by input

The compiler already computes `Rule.activeInputsMask` through
`computeInputActiveSet` in `lower_to_runtime.cpp`. The compact code generator uses
uniform-group guards and per-rule guards when its skip-opportunity threshold is
met. These still inspect `scratch.currentInputMask` at runtime; this path does
not simply emit six independently specialized whole-turn functions.

A useful experiment is to dispatch once to direction/action/tick-specific code
and omit inactive rules during code generation. Preserve the original group and
loop structure inside each path. Start with ruleset-owned input plans; avoid
recompiling each generated level or each presence population. Deduplicate equal
paths so rulesets with little input variation do not pay six times the code size.

The safety boundary is the existing conservative input-creation closure, not
syntactic deletion of rules mentioning a different arrow. Action and no-input
ticks are first-class; again ticks, startup, movement propagation, random rules,
rigid retries, late phases and debug/fallback paths need differential coverage.
Input-specific eligible index lists offer a smaller interpreter experiment,
but may reproduce the same indirection/bookkeeping problem measured here.

Measure wall time, solver expansions/solves, candidate throughput, executable
size and compilation time together. For group splitting, first measure group
mask rebuilds, scratch resets and confirmation costs. Independent components
could retain logical boundaries while sharing physical setup, but a connected
component proof alone is not a speed result. The old failed experiments remain
useful evidence about costs, not a permanent ban on better implementations.
