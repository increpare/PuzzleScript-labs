# Solver invariant audit — 6 September 2026

The existing analyser already supplies most of the basic facts a general PuzzleScript solver needs. The largest opportunities are to use them at a more useful granularity, extend them from individual objects to relationships and spatial possibilities, and preserve their meaning across execution backends. Another object-tag analyser would duplicate work.

This is a source audit and a fresh static coverage survey at revision `67b0fbf121a31883fbfd0f5547aa91080b53cb0d`. It does **not** claim new solver speedups. Previously recorded performance results below are historical experiments, not reruns. “Missing” means no general implemented certificate/consumer was found in the inspected analyser, solver, and search paths; some ideas already appear in planning documents or specialized prototypes.

## Fresh coverage

The bundled solver corpus contains 184 source files and 1,346 playable levels. All 184 analysed successfully. Message entries are excluded from the playable-level count.

| Existing information | Coverage in this survey | Interpretation |
|---|---:|---|
| Conserved counts of non-static object types | 115 games | Opportunities for compact representations and necessary goal conditions |
| Non-static types whose counts can change in only one direction | 130 games | Existing `quantity.never_increases` / `never_decreases` tags; monotonic counts are already implemented |
| Proved conserved sums across transformations | 15 games | Current implementation discovers unit-coefficient sums of one-for-one transformation components |
| Proved transient objects | 45 games | Boundary storage opportunities; the objects can still be essential during a turn |
| ACTION proved unnecessary | 78 games | 45 already declare noaction; 33 have potential additional action elimination |
| Cosmetic hash-projection objects without a random-mechanics blocker | 73 games | Eligibility, not proof of benefit or universal applicability |
| Mergeability candidates | 81 games | Candidates, not a blanket certificate to merge all identified pairs |
| Win-irrelevant active rules | 55 games / 675 rules | Existing backwards relevance analysis |
| Per-level impossible object types | 123 games / 784 levels | An over-approximation of possible types excludes these types completely |
| Impossible non-static object types | 646 levels | Particularly interesting for eliminating inactive mechanics |
| Potentially smaller object-word stride after ideal removal/remapping | 97 levels with 32-bit words; 25 with 64-bit words | Upper-bound eligibility only; codegen, structural roles, masks and initialization still need validation |
| Certified single-pass multi-rule groups | 733 / 1,540 groups | Broad static eligibility; says nothing about the cost of the passes removed |

Raw per-game/per-level evidence includes source hashes and exclusions in [the survey JSON](C:/Users/Anwender/Documents/puzzlescript-labs/.codex_tmp/solver-generator-improvements/docs/benchmarks/2026-09-06-invariant-consumer-survey.json). The accompanying [survey script](C:/Users/Anwender/Documents/puzzlescript-labs/.codex_tmp/solver-generator-improvements/src/tests/audit_solver_invariant_coverage.js) reproduces the survey from the repository root. Its default output is a build artifact; the dated output path was supplied explicitly for this audit.

Concrete survey leads: the potential native 64-bit stride reductions occur in **a distant sunset**, **easyenigma**, and **seize the flag**. Existing conserved-sum facts already identify the horizontal/vertical player forms in **BIAXIAL INVASION OF SATURN**, six ball forms and two hand forms in **a distant sunset**, and numerous transformation pairs in **castlecloset**. These are useful mechanically varied starting points; the survey does not establish a performance gain for them.

## What existing facts buy us

### 1. Static objects and layers: less work per state

Static means fixed occupancy, not just a conserved number. This supports immutable geometry caches, precomputed matching locations, shared immutable state, and omitting constant information from per-state storage or hashes. Static occupancy does **not** imply irrelevance: a static object can block movement or be a goal operand.

Already used: native heuristic construction analyses static objects and caches eligible target geometry; JS has static hash filtering; native compact code generation separately compacts movement lanes that can never receive movement. Existing distance-field version caches also avoid rebuilding unchanged dynamic fields, so caching itself is not a new proposal.

Important limit: removing bits that are identical in every reachable state does not reduce the number of distinct states. It can save copying, hashing, matching and memory. Omitting a whole word or movement lane is more promising than adding a mask operation to every word without shrinking storage.

### 2. Count conservation and one-way quantities: resource reasoning

Already calculated: individual counts, `never_increases`, `never_decreases`, and some conserved sums across object transformations. Runtime contracts check these quantities. I found no general consumer that turns these report families into a goal-feasibility solver or a resource abstraction in the main search paths.

Useful consumers include:

- Prove an initial level impossible: if the only win route requires `NO A`, the count of A is conserved, and it starts positive, that route is impossible.
- Prove a branch impossible: if A can never increase, its count is now zero, and every winning route needs `SOME A`, no continuation can win.
- Encode a proved unique token by a position rather than a full occupancy plane, when this actually reduces state storage and reconstruction cost.
- Track the combined stock of transforming objects instead of treating each visual/type state as unrelated.

These examples require checking alternate explicit `win` commands, resets, level transitions and the actual filter semantics. A property is a set of alternatives; an aggregate is a conjunction. Counts of objects and counts of cells matching a filter are not interchangeable. `ALL A ON B` can also become true when no A remains.

Checking a conserved quantity on every state reached by the correct engine will never prune anything: every such state already satisfies it. The useful question is whether a winning continuation can satisfy the invariant and the goal together.

### 3. Per-level object universes: specialize the problem actually being solved

The existing analysis starts from initial object types and repeatedly admits creations whose positive requirements might be available. It deliberately forgets spatial arrangement, quantities, and many incompatibilities. “Reachable” here means *not ruled out*, not proven constructible. “Unreachable” is the useful exclusion.

This is a strong near-term consumer opportunity. Remove rules that require an impossible type, simplify properties and negative tests, eliminate unused layers, and build a smaller execution plan for the current level. No direct production solver consumer of this report family was found. Native and JS input specialization already exclude some rules using movement reachability, so measure the additional exclusion beyond that baseline.

The 784 eligible levels should not be read as 784 stride reductions: the ideal word-count estimate only changes in 97 JS/25 native-64 levels. Rule elimination may still help the other levels.

For generated boards, derive the universe from each candidate's actual starting state and permitted initialization/reset behaviour. Never reuse the embedded demonstration level's universe just because both levels belong to the same game. Cache a specialized plan by its certified assumptions, not an unchecked level number.

### 4. Cosmetic objects, transients, mergeability and relevance: smaller search spaces

Cosmetic projection can merge states that differ in information irrelevant to future winning behaviour. This can reduce *how many states* are explored, not just bytes per state. Transients are different: if guaranteed absent at every stored boundary, their omission generally saves representation work rather than merging additional reachable boundary states.

Already used: JS opt-in passes remove inert rules, cosmetic objects/rules, merge candidate object types, and apply win-relevance slicing. JS and native CLI have solver-hash projection. These consumers have different gates; the fact envelope itself can say `candidate` while containing separately justified, scoped sub-results. Checking only the outer status is not a sufficient generic consumption policy.

Win relevance already roots semantic commands, movement writers and writers on moving objects' collision layers. The latter two are intentionally conservative. The source comments explicitly retain these roots until implicit engine dependencies are modelled more precisely. This makes a more precise movement/collision dependency model an identifiable extension, not a new relevance algorithm.

The historical corrected native win-relevance experiment recorded +6.2% full-corpus throughput and 743 to 747 solves, but retained opt-in status because of search-order regressions and external hint delivery. This is evidence of value and a reminder that a semantics-preserving reduction can alter a bounded heuristic search's behaviour.

Scope matters: cosmetic projection is for forward search, not gameplay with observable undo history. Random draw order can connect otherwise cosmetic activity to later behaviour. Transient information may be omitted at a stable boundary but must still participate in mid-turn execution.

### 5. Action/movement reachability, wake masks and group flow: avoid execution

Already present:

- Global ACTION-unnecessary reasoning and a JS optimization consumer.
- Input-specific rule sets in JS and native execution/code generation.
- Certified per-rule read/write wake masks and group skip masks.
- Rule interaction edges, rerun masks, connected components and a single-pass condition.

The single-pass condition excludes backwards/self wake edges and blocks random groups, rigid rules, semantic commands and force-always rules. It means a later change cannot require an earlier rule or the same rule to be reconsidered within that group. It does not authorize reordering arbitrary rules or removing an enclosing program loop.

Historical JS certified wake pruning paid roughly 7.87 million movement-overlap probes for 124,794 skips on smoke-50 and regressed. Historical native single-pass consumption removed 1.76 million confirmation visits but moved raw throughput from 87.007 to 86.861 states/ms. Neither result rules out a better consumer.

There is a concrete alternative already in this repository: the **Game Boy exporter has its own `groupSinglePassSafe` certificate**, encodes it into groups and passes it to specialized code emission. Generated execution can set the pass limit to one or omit looping code. Desktop native interpretation and the ordinary compact-turn group generator still contain repeat-until-unchanged loops.

A fresh attempt should compare the two certificate implementations, share or cross-check their semantic facts, and specialize desktop group functions at compile time. Measure time spent in eligible confirmation passes and savings in mask rebuilding/scratch maintenance. A stronger proof might additionally support those savings, but single-pass alone does not justify deleting every rebuild. The GBC proof uses a narrower representation/export domain; it is evidence and a starting point, not a drop-in desktop implementation. Broadening the proof after per-level specialization is another distinct experiment.

### 6. Winflow: update only what could have changed

The analyser already supplies rule-to-win-condition wake dependencies, and the runtime-contract harness tests cached win truth. No direct solver use of that report family was found in the inspected production paths.

A consumer could maintain unsatisfied-cell counts or dirty goal conditions from actual changed cells. It must include built-in movement, not just successful rule applications, and restore/invalidate caches on search-state restoration. Existing target-distance versioning provides a useful implementation pattern. This is a per-node cost optimization whose priority depends on measured win-check cost.

## Where the backends differ

| Path | Relevant current behaviour |
|---|---|
| JS solver harness | Can request selected analyser families; static optimization, projection and certified wake pruning are mostly explicit flags |
| Native solver CLI | Derives native static/projection facts; can read external JS hints; win relevance is an opt-in external-hint consumer |
| Generator/MIS shared C API | Uses the same native search implementation, but seeded searches pass no external static hints and disable solver hash projection; native heuristic fallback still analyses static objects, and normal runtime optimizations still apply |
| Desktop native compiler | Uses movement-lane analysis and input specialization; ordinary generated group execution still loops |
| GBC exporter/generated runtime | Has additional native single-pass and single-player certification; this is separate from the desktop solver path |

Thus “implemented in C++” does not establish that the generator uses a given optimization. A useful shared per-game/per-level solver plan should carry existing facts with source identity, assumption scope, and backend-specific consumers. JS can remain the development/reference producer without making production C++ generation invoke JS for every candidate.

## Missing or materially incomplete certificates

### A. State-dependent future possibilities and irreversible phases

Extend the existing initial-level universe into an occasional *remaining future universe*. After the last object capable of producing A disappears, A and everything requiring A may become permanently unavailable. Conversely, once an irreversible switch changes a mode, its old rules may become permanently irrelevant.

Use this to switch to a smaller rule plan, detect missing goal prerequisites, and simplify subsequent analysis. Cache plans by certified phase/universe. Recompute at relevant irreversible events, not on every expansion. The new certificate must cover restart/checkpoint semantics, automatic turns and all creation routes; current board absence alone is insufficient.

This is my first new-analysis candidate: it directly extends existing machinery and applies to collection, destruction, transformations, switches and resource games.

### B. Spatial and relational reachability

The current universe says which *types* may appear anywhere. We need conservative facts about *where* a type can appear and which combinations can coexist: an object can never enter a region, a mode can never coexist with another mode, a required local pattern can never form.

Infer transport and transformation possibilities from actual rules, with built-in movement/collision included. Teleportation, pulling, propagation, growth and destruction become edges/effects in that model. Unknown effects widen the possibilities rather than exclude real solutions.

Uses: impossible-goal detection, stronger static matching exclusions, precise movement/collision relevance, and useful distance/abstract-goal estimates. Collision-layer mutual exclusion already exists; additional cross-layer, across-cell and global mutual exclusions are the extension. For example, a conserved unique token that alternates between two types implies they cannot both exist, even if they occupy different layers or locations in the source schema.

This has the strongest general route from invariants to substantially fewer expanded states.

### C. Certified small goal abstractions

Build a small transition system over quantities, modes, necessary predicates or region memberships selected using the existing relevance graph. Every real full-turn transition must be represented in the abstraction, and every concrete winning state must map to an abstract winning state.

Distances to an abstract goal then provide a lower bound when abstract edge costs do not exceed concrete input costs. Abstract impossibility can safely reject a state. A table over a few mode/resource variables can distinguish essential preparation from superficial geometric progress.

This is fundamentally different from adding another Manhattan-distance term. It uses the game's rules and win logic, so it applies to transformations and switches as naturally as placement games. Pattern databases and abstraction heuristics are established general-planning techniques; [Fast Downward's evaluator documentation](https://www.fast-downward.org/latest/documentation/search/Evaluator/) distinguishes admissibility, consistency and safe dead-end detection.

PuzzleScript needs a careful adapter: an input can fire many rules, move many objects, repeat groups and drain `again`. Treating every rule firing as a separate unit-cost input would create invalid distance bounds. Negative conditions, `ALL` vacuity and alternate explicit wins also belong in the abstract semantics. Start bounded and coarse; fall back rather than interpret an incomplete model as exhaustion. Combining tables by maximum is safer than summing them without a cost-partition argument.

### D. Weighted, modular and relational quantity invariants

Current linear discovery joins one-for-one transformation pairs and emits coefficient-one sums. It is not a general linear-invariant solver.

Examples of extensions:

- If the only relevant conversion is `2 A -> B`, infer `count(A) + 2*count(B) = K` where the actual rule effects support it.
- If a quantity only changes by two, preserve its parity.
- Infer at-most-one/exactly-one across sets of types or a certified region.
- Prove a predicate remains true, such as a particular switch being permanently activated; global object-count monotonicity alone cannot prove fixed-cell persistence.

These support resource infeasibility, finite-domain state encodings and the abstractions above. Derive candidate equalities from effect vectors and then check every possible effect, including overwrites, property alternatives and resets. Count arithmetic must never assume one match or one rule firing per input. The general-planning precedent is [Fox and Long's invariant inference work](https://arxiv.org/abs/1105.5451); adapting it to this engine is proposed work.

### E. Reversible, unobservable transitions and general macros

Prove that a class of intermediate transitions changes only an internal variable, is reversible, and preserves the same available meaningful exits and winning behaviour. Search its closure once and expand the exits. Ordinary walking is one example, but cycling a harmless selector or moving a cursor between interaction sites can fit too.

Existing static/count facts and the specialized push prototypes do not establish this general certificate. A walking step may tick another mechanism, consume randomness, change a counter or win by itself. Those effects must be retained. For shortest-input solutions, preserve path costs and enough internal position information; one representative and unit-cost macro edges are insufficient.

Potential payoff is very large on applicable games; proof and coverage risk are correspondingly high. I would build it after full-turn abstractions and spatial facts, not start by naming crates and targets.

### F. Commuting actions, independent components and symmetry

Two actions commute only if both orders stay applicable, lead to equivalent full states, and do not lose an intermediate win or change relevant side effects. Then partial-order reduction can avoid redundant orderings. Existing independent **rule-group** components do not imply independent **player actions**: the same direction affects every player, and automatic rules run globally.

Likewise, geometric or symbolic symmetry can canonicalize equivalent states only if it preserves transitions, goals, immutable geometry and the required mapping of inputs. Two objects of the same type already lack individual identity in the board representation; there is no extra token-permutation factor waiting to be removed there. Existing mergeability addresses another subset of symmetry.

Both approaches are worth retaining on the roadmap, but are less attractive first projects: the raw action alphabet is small and global effects weaken independence. [Fast Downward's pruning documentation](https://www.fast-downward.org/latest/documentation/search/PruningMethod/) provides established completeness-preserving stubborn-set methods and an option to stop paying pruning overhead when the measured reduction is too small. Applying them here requires proofs about whole turns or certified macros, not merely non-overlapping rule writes.

## Recommended experiments

1. **Consume per-level universes and existing resource facts.** First measure dead rules beyond input specialization; then build a small specialized plan and goal-feasibility filter. Separate up-front analysis cost, per-state speed and expansions avoided. Include generated candidate startup and reset handling.
2. **Revisit desktop single-pass code generation.** Use the existing JS and GBC certificates as references, specialize certified groups without per-visit proof dispatch, and select benchmark cases by eligible confirmation *time*. Old failures are baselines to explain, not permanent exclusions.
3. **Add future-universe/phase facts and spatial/relational reachability.** These are the best foundations for general dead-end detection and meaningful abstractions.
4. **Prototype one small certified rule-aware goal abstraction.** Use several mechanically different games, retain generic search fallback, and report common-timeout work as well as solves.
5. **Develop macro equivalence, action independence and symmetry once the transition model supports them.** Keep these independent experiments rather than bundling speculative gains.

Every hard reduction needs a declared guarantee: preserving winning reachability, preserving minimum input count, or merely guiding search. Exhaustive small-state comparisons must check false exhaustion and missed goals as well as replaying found solutions. Replay validates successes; it cannot reveal a solution that pruning removed. Differential checks should include the JS engine, native interpreter and generated backend, with stable-boundary state including relevant randomness/control state. Generated levels need the same guarantees, but need not share the source levels' counts or reachable object universe.

The focused analyser and runtime-contract test suites passed during this audit. The 184-game survey checked analysis availability and coverage, not every invariant along every possible execution. No solver behaviour was changed and no performance gain is claimed by this report.

## Source anchors at the audited revision

- [Fact families, count analysis, universe closure, flow and relevance derivation](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/src/tests/ps_static_analysis.js#L562). Particularly count tags at 1937, linear sums at 1370, universe at 2328, flow at 3233 and relevance at 3450.
- [JS optimization consumers](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/src/tests/solver_static_opt.js#L3) and [optional solver analysis flags](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/src/tests/run_solver_tests_js.js#L462).
- [Native hint consumers](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/native/src/solver/main.cpp#L605), [seeded generator search](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/native/src/solver/main.cpp#L4119) and [native static heuristic fallback](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/native/src/solver/heuristics.hpp#L122).
- [Native interpreter group execution](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/native/src/runtime/core.cpp#L5580) and [ordinary desktop compact-turn emission](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/native/src/compiler/compact_turn_codegen.cpp#L4268).
- [GBC native single-pass certificate](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/native/src/gbc/exporter.cpp#L1080) and [specialized group emission](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/native/src/compiler/compact_turn_codegen.cpp#L9037).
- [Historical solver experiments and rejected consumers](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/src/tests/JS_SOLVER_NEXT.md#L71), [soundness scope](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/src/tests/STATIC_ANALYSIS_SOUNDNESS.md#L16), and [runtime contracts](https://github.com/increpare/PuzzleScript-labs/blob/67b0fbf121a31883fbfd0f5547aa91080b53cb0d/src/tests/run_static_analysis_runtime_contracts_node.js#L384).
