# Static Analyzer Extension Proposals

Written 2026-07-03. A compiler-theory review of the JS static analyzer
(`src/tests/ps_static_analysis.js`, ~2.7k lines; entry
`src/tests/run_ps_static_analysis.js`), proposing new tagging and analysis
families. "Useful" here means any of: faster execution, better rule
compilation, new solving approaches, or intrinsically interesting facts about
games. The JS analyzer has feature parity with the native one
(`native/src/solver/static_analysis.*`), so everything below is described
against the JS code; parity items should follow once proven.

Companion plans: `2026-07-03-anonymous-game-500ms-optimization-plan.md` (JS
engine/solver) and `2026-07-03-native-interpreter-optimization-plan.md`
(C++ interpreter). Several proposals below exist precisely to close soundness
gaps those plans flagged (P2/N3 movement-aware pruning, N9 group scheduling,
macro-action legality).

## 1. What the analyzer does today (baseline inventory)

Don't re-propose these; build on them.

**IR (`psTagged`):** objects, properties (OR-classes), collision layers,
winconditions, levels (with per-level object presence,
`tagObjectLevelPresence`), and rule sections (early/late) → groups → rules,
where each rule carries structured lhs/rhs term lists, direction, and
per-rule tags.

**Tags:** per rule — `command_only`, `inert_command_only`, `object_mutating`,
`writes_movement`, `movement_only`, `reads_action`, `has_again`,
`solver_state_active`, plus read/write object and movement key sets
(`tagRuleObjectTags`). Per game — `has_action_input`, `has_again`,
`has_random`, `has_rigid`, `has_autonomous_tick_rules`, etc.

**Fact families** (`factDerivers`, each fact carries
proved/candidate/rejected + proof + blockers + evidence):

- `mergeability` — object pairs observationally indistinguishable → merge
- `movement_action` — ACTION-input-unnecessary proofs; movement reachability
  from action input
- `count_layer_invariants` — object count preserved / object static / layer
  static
- `transient_boundary` — objects provably absent at end of turn
- `rulegroup_flow` — intra-group wake edges, connected components, split
  candidates, per-rule rerun masks
- `program_flow` — global rule→rule wake edges, again rules
- `winflow` — rule→wincondition wake edges

The wake-edge enablement algebra (`ruleMayEnableRule`,
`movementWriteMayEnableRead`) already models polarity: presence writes vs
`object_absent` reads, movement writes including `moving`/`orthogonal`
expansion, and **stationarity** (movement removal is modeled as writing
`:stationary`, `ruleFlowWrites` ~line 2187). This is more precise than what
the engines' runtime masks consume — a theme below.

**Soundness infrastructure:** runtime contract checking along recorded traces
(`run_static_analysis_runtime_contracts_node.js`), randomized fuzzing
(`fuzz_static_contracts.js` — found the cosmetic/undo scope issue), corpus
audit runners, JS/native parity runner, `STATIC_ANALYSIS_SOUNDNESS.md`.

**Consumers:** solver-scoped optimization passes
(`src/tests/solver_static_opt.js`: inert/cosmetic/cosmetic-rules/merge/action),
engine input specialization, solver heuristics (static-dead-cell cache),
native codegen tiers.

## 2. Framing: what kind of language is this?

PuzzleScript is a guarded rewriting system over a bounded grid with a fixed
control skeleton (input seed → early-rule fixpoint with ordered groups and
startloop/endloop → movement resolution → late rules → win check → `again`
re-entry). That puts it at the intersection of several well-studied
formalisms, each of which donates analysis machinery:

- **Production systems / term rewriting** → confluence (critical pairs),
  termination (ranking functions), subsumption, orthogonality
- **Petri nets** (forget geometry, keep object multisets) → place invariants,
  conservation laws, deadlock analysis
- **Dataflow analysis** → read/write sets, reaching definitions, dead code,
  available expressions (≈ incremental match caching)
- **Abstract interpretation** → per-level reachable object universes, count
  intervals, region reachability
- **Planning theory** → landmarks, relaxed reachability, partial-order
  reduction, symmetry/bisimulation quotients

The existing fact families are mostly dataflow-shaped. The biggest untapped
value is in the Petri-net and planning-shaped analyses (solving) and in
exporting the analyzer's existing precision to the engines (execution).

## 3. Proposed analyses

Each entry: what it computes → theory → consumers → difficulty/soundness.
IDs `S1…` for reference from other plans.

### A. Export precision the analyzer already has (execution speed, low risk)

- **S1 — Certified engine wake masks.** Compile per-rule read/write sets
  *with polarity and stationarity* (already computed in
  `ruleFlowReads`/`ruleFlowWrites`) down to the engines' bitvec mask format,
  as a certified artifact: readObjects⁺/readObjects⁻, readMovements incl.
  stationary, writeObjects set/clear, writeMovements set/clear. Today the
  engines' incremental-prune guards (JS `engine.js:3092`, native
  `core.cpp:5108`) are movement-blind partly because the runtime masks don't
  distinguish these cases soundly. This is the missing soundness half of
  plan items P2/N3. Theory: classic def-use with polarity. Difficulty: low —
  plumbing, not new analysis. Soundness: contract-checkable (fuzz harness
  asserts "rule never fires when its wake mask says it can't").
- **S2 — Group scheduling certificates.** Extend `rulegroup_flow` (which
  already computes wake edges, components, rerun masks) with two derived,
  engine-consumable certificates: (a) `single_pass_safe` — no rule's writes
  can enable itself or an earlier rule in the group → the fixpoint loop's
  quiescence-confirmation pass is provably redundant (halves match work for
  such groups; plan N9a); (b) `group_skip_mask` — the sound version of the
  disabled JS "A.2 outer-loop group skip" (`engine.js:3154`): a group may be
  skipped when cumulative turn writes don't intersect its certified read
  set *and* it has no forceAlwaysRun/command/again semantics. Moving the
  proof from engine heuristics into audited facts is what makes it safe to
  enable. Difficulty: low-medium. Soundness: same contract pattern as S1.
- **S3 — Direction-instance reachability.** Rules expand ×4 directions at
  compile time; many instances are dead (they require a movement
  object×direction combination nothing can ever produce). The
  `movement_action` family already computes movement reachability from
  action input; generalize to a full object×direction movement-reachability
  fixpoint seeded by player inputs and all rule movement writes, then tag
  each direction-expanded rule instance `reachable: false` where provable.
  Consumers: rule-list shrinking in both engines (beyond input
  specialization), codegen. Difficulty: medium. Soundness: fuzzable
  ("instance never fired across corpus + random traces").

### B. Per-level specialization (execution + compilation)

- **S4 — Per-level reachable object universe.** Combine per-level seed
  presence (`tagObjectLevelPresence`) with a creation closure (object X
  creatable only by rules whose own requirements are reachable — a reaching
  definitions fixpoint) to compute, per level: objects that can never exist.
  Consumers: (a) per-level rule dead-code elimination — rules requiring
  unreachable objects are dead for that level; (b) per-level stride/layer
  compaction (plan P5/N8) with a proof instead of a global cosmetic
  argument; (c) smaller hash footprints. Games with level-specific mechanics
  (common in the corpus; the forensics game has 251 objects, most unused per
  level) should shrink dramatically. Theory: reaching definitions + DCE.
  Difficulty: medium. Soundness: contract "object never appeared in level L"
  is directly checkable on traces.
- **S5 — Static scenery closure and region graph.** Extend
  `count_layer_invariants`' `object_static` to a derived-immobility closure
  per level (object movable only by rules dead-in-L per S4 → static in L),
  then compute the level's static blocking geometry and its connectivity
  region graph under an over-approximated player-move relation. Consumers:
  the A3 static-dead-cell heuristic cache (formalized as a shared fact
  family instead of solver-local code), region-isolation heuristics,
  unsolvability screens (player region disjoint from all win targets →
  reject). Difficulty: medium. Theory: abstract interpretation over a
  reachability lattice.

### C. Rewriting-theory structure (compilation, parallelism)

- **S6 — Confluence / parallel-apply certificates per group.** For each
  rule, decide whether distinct matches within one pass can overlap in their
  read/write footprints (critical-pair check over pattern geometry: LHS
  window vs RHS writes). Orthogonal (non-overlapping) systems are confluent:
  match order is irrelevant → the engine can apply all matches of a rule in
  one pass without re-matching between applications (today `tryApply`
  re-checks every match after the first), and codegen can emit vectorized /
  parallel application. Theory: orthogonal TRS ⇒ confluence. Consumers: both
  engines' apply loops, native codegen, even GPU experiments. Difficulty:
  medium-high (geometry-aware overlap reasoning). Soundness: differential
  testing — parallel vs sequential apply must produce identical boards.
- **S7 — Fixpoint termination measures.** For self-enabling rules
  (propagation chains like the forensics game's `blocked` flooding),
  identify a monotone measure (e.g., "cells lacking flag F that can receive
  it" strictly decreases) proving the group fixpoint terminates in ≤ cells
  iterations and, more usefully, licensing *worklist evaluation*: seed a
  dirty frontier and extend it locally rather than rescanning the grid per
  iteration. Theory: ranking functions / size-change termination; chaotic
  iteration with worklists is exactly how Datalog engines evaluate this.
  Consumers: the fixpoint rescan pathology identified in both engine plans
  (F1/mechanism 2). Difficulty: high to do generally; a "flag-flooding"
  special case (RHS = LHS + one monotone flag) covers the common pattern
  cheaply. Interesting-to-know even unconsumed: which games have provably
  terminating rule loops vs rely on the 200-iteration cap.
- **S8 — Subsumption, duplication, and vacuity.** Rule R2 is dead if an
  earlier same-group rule R1 subsumes it (R1's LHS weaker or equal, effect
  identical) or if R2's LHS is unsatisfiable (requires X present and absent;
  requires two objects sharing a collision layer in one cell; requires an
  object that no level seeds and no rule creates — subsumed by S4 globally).
  Theory: subsumption lattices from resolution/production systems.
  Consumers: rule-count reduction, and **author diagnostics** — "this rule
  can never fire" is one of PuzzleScript's most requested lint features.
  Difficulty: low-medium for the syntactic cases. Soundness: "never fired
  across corpus traces" audits.

### D. Petri-net / counting abstractions (solving)

- **S9 — Linear conservation invariants (P-invariants).** Forget geometry:
  each rule becomes a multiset delta on object counts (machinery exists in
  `ruleCountEffectObjects`). Compute the left null space of the delta matrix
  → linear invariants Σaᵢ·count(objᵢ) = const, and one-sided variants
  (non-increasing/non-decreasing) already partially covered by
  `count_layer_invariants`. Consumers: (a) **unsolvability certificates** —
  if win requires `SOME X` but every reachable state satisfies
  count(X)=0 by invariant, reject the level without search; (b) **admissible
  heuristic ingredients** — a win needing N objects-on-targets where a
  conserved resource bounds production rate gives sound lower bounds;
  (c) dead-state pruning — a state violating "count(Key) ≥ remaining locks
  on any win path" can be cut *with proof*. Theory: Petri net place
  invariants via integer linear algebra (small matrices; objects ≤ ~300,
  rules ≤ ~1000). Difficulty: medium — the delta extraction exists; the
  linear algebra is textbook. Soundness: invariants are universally
  quantified → perfect fit for the existing fuzz contract harness.
- **S10 — Transport schema classification (mechanic fingerprinting).**
  Classify rule groups against a small library of schemas: *walker* (player
  moves into empty), *pusher* (Sokoban push), *puller*, *faller* (gravity via
  again), *spawner*, *transformer*, *connector* (snake growth), *rider*
  (ice/conveyors), *counter-gate* (keys/locks). The structured
  object/movement signatures (`structuredObjectSignature`) are the matching
  substrate. Emit `game.tags.mechanic_profile`. Consumers: (a) per-game
  heuristic routing with evidence (the JS `auto` router does this
  syntactically today); (b) **macro-action legality** — corridor-move and
  tunnel macros are sound iff mechanics ⊆ {walker, pusher} with no
  autonomous ticks (the solver plans' "do not do yet" items become "do,
  where certified"); (c) Sokoban dead-square analysis eligibility (S11);
  (d) corpus cartography — how many games are Sokoban variants? Genuinely
  interesting. Difficulty: medium; incremental (each schema is independent).
  Soundness: schema claims are behavioral → validate by trace contracts
  (e.g., "pusher: crate cell delta always equals player delta when
  adjacent").
- **S11 — Derived deadlock analysis.** Where S10 certifies a pusher schema:
  compute per-level dead squares (corner/wall cells from which no pushable
  can reach any win target — standard Sokoban preprocessing) and freeze
  patterns, as facts. Consumers: solver pruning with certificates (the
  current heuristics only *penalize* dead regions; a proved fact allows hard
  pruning), difficulty estimation. Theory: relaxed backward reachability on
  the abstracted transport relation. Difficulty: medium once S10 exists.

### E. Planning-theory analyses (solving)

- **S12 — Win-relevance backward slice.** `winflow` has rule→win edges;
  close them transitively backward through `program_flow` wake edges to get
  the set of rules that can appear on any causal chain into a win condition.
  Rules outside the slice are solver-irrelevant *even if state-active* —
  a strict generalization of cosmetic-rules (which requires cosmetic
  mutation targets). Consumers: solver-scoped rule pruning; also ranks rules
  for codegen layout (hot = win-relevant). Theory: program slicing /
  relevance analysis. Difficulty: low — the graphs exist; the subtlety is
  keeping indirect enablement (a "useless" rule may unblock a relevant one —
  the wake edges capture exactly this). Soundness: solver-scoped parity runs
  (status/solution equality), same as existing passes.

  Status update (2026-07-10): the JS and native solver consumers are live
  behind explicit `win-relevance` options. A native smoke run exposed a proof
  gap not represented by rule def-use edges: movement writers can change
  spatial relationships through engine movement resolution even when their
  written marker is absent from the win condition. The fact now includes all
  `writes_movement` rules as conservative roots and publishes
  `movement_root_rule_ids`. A real-game native regression canary and JS
  smoke parity/replay pass with this repair. The repaired native smoke result
  removes 235 rules across 17/50 games and improves generated-state throughput
  +26.9%, but remains opt-in pending full-corpus parity.
- **S13 — Landmarks.** From the win conditions, regress through the wake
  graph: facts (object reaches a target class, rule R must fire at least once)
  that hold on *every* solution. Even the cheap "rule landmarks" version
  (cut vertices in the backward slice) yields: admissible landmark-counting
  heuristics (LM-count is the workhorse of classical planning), solver
  progress measures, and unsolvability when a landmark is unreachable
  (S9/S5 feed this). Difficulty: medium-high; start with rule landmarks,
  not fact landmarks. Theory: Hoffmann-Porteous-Sebastia landmarks.
- **S14 — Effect locality and commutation (partial-order reduction).**
  Compute per-input static *effect radius*: the maximum board region a
  single turn can modify, as a function of the player position(s) (walker
  games: radius 1-2; global-transform games: unbounded). Where two
  consecutive inputs have provably disjoint, non-interacting effect regions
  they commute → the solver can canonicalize input order (sleep sets /
  stubborn sets), collapsing large duplicate subtrees. This is the sound
  route to POR that the solver plans deferred. Theory: POR from model
  checking; the analyzer's job is the static independence relation.
  Difficulty: high; gate on S10 (locality only certifiable for local
  schemas). Interesting-to-know regardless: the corpus split
  local-vs-global-effect is a fundamental structural datum.
- **S15 — Solver-hash projection (bisimulation-lite).** Extend
  `transient_boundary` and cosmetic analysis into a certified *hash
  projection mask*: state components (objects, movement remnants, message
  flags) that cannot influence any future observable (win status or
  win-relevant rule behavior, per S12's slice). Solver deduplicates on the
  quotient → strictly fewer duplicate states. Theory: bisimulation quotient
  approximated by static dependency closure. Consumers: JS+native solver
  visited-set; effectiveness varies per game but cost is near-zero at
  runtime. Difficulty: medium. Soundness: subtle (the cosmetic/undo scoping
  lesson — memory notes record this class of bug); ship behind parity gates.

### F. Interesting-to-know (cheap, no engine consumer required)

- **S16 — Turn-phase automaton visualization.** Partition rules by phase
  eligibility (input-seeded only / movement-phase / late / again-tail) and
  emit the phase schedule as a fact. Cheap given existing tags; makes game
  architecture legible, feeds the explorer UI
  (`build_static_analysis_explorer.js`), and is the natural precursor to
  phase-specialized rule lists in the engines.
- **S17 — State-space size and difficulty statics.** Per level: movable
  entity count × placements upper bound, branching estimate, landmark-count
  lower bound on solution length (from S13). Consumers: corpus curation,
  solver budget/portfolio ordering, generator feedback
  (`src/search/difficulty.*` on the native side already gestures here).
- **S18 — Canonical mechanic clustering.** Combine S10 fingerprints with the
  existing canonicalizer (`canonicalizer_node.js`) to cluster the corpus by
  mechanics rather than text similarity. Zero engine value; high curiosity
  value; useful for building balanced benchmark slices (the solver plans
  repeatedly need "a representative 50-game slice" — this defines one).

## 4. Priority shortlist (tied to the existing optimization plans)

| Rank | Item | Primary payoff | Unblocks |
| --- | --- | --- | --- |
| 1 | S1 certified wake masks | engine prune soundness | P2/N3 (both engine plans' top algorithmic item) |
| 2 | S2 group scheduling certs | skip/single-pass groups | N9, JS A.2 re-enable |
| 3 | S4 per-level object universe | per-level rule DCE + stride compaction | P5, N8 |
| 4 | S9 linear invariants | unsolvability + admissible bounds | new solver capability, cheap |
| 5 | S10 mechanic fingerprints | strategy routing + macro legality | unfreezes "do not do yet" macro items |
| 6 | S12 win-relevance slice | solver rule pruning beyond cosmetic | extends existing pass family |
| 7 | S15 hash projection | duplicate-state reduction | solver visited-set |
| 8 | S6 confluence certs | parallel apply, codegen | longer-term engine work |
| 9 | S13/S14 landmarks/POR | heuristics + tree pruning | after S10/S12 |
| 10 | S8/S16-S18 | lint + cartography | authoring & curation |

## 5. Validation architecture (applies to every family)

The existing pattern is exactly right; keep it mandatory:

1. Every fact ships as proved/candidate/rejected with machine-readable proof
   and blockers (existing `fact()` shape).
2. Every *universal* claim gets a runtime contract asserted along recorded
   traces (`run_static_analysis_runtime_contracts_node.js`) and randomized
   traces (`fuzz_static_contracts.js`) before any engine consumes it.
3. Every *solver-scoped* claim (S12, S15, per-level DCE) is validated by
   paired solve runs (status/solution parity), like `--solver-opt-parity`.
4. JS and native analyzers stay in lockstep via the existing parity runner
   (`run_native_static_analysis_parity_node.js`); implement JS-first.
5. Randomness scoping: `has_random` currently gates several families
   game-wide. New families should scope randomness per-object/per-rule
   (which objects can a random rule touch?) rather than per-game — the
   forensics game has 3 random rules that poison analyses for 248 unrelated
   objects.

## 6. Closing observation

The analyzer's wake-edge algebra is already *more precise than anything the
engines consume* — polarity and stationarity are modeled in
`ruleFlowReads`/`ruleFlowWrites` but the runtime prune guards use coarse
movement-blind masks. The cheapest large win in this whole document is not a
new analysis at all: it is compiling existing analyzer facts into certified,
contract-tested runtime artifacts (S1/S2). After that, the highest-novelty
items are the Petri-style invariants (S9) and mechanic schemas (S10), which
open solver capabilities (unsolvability proofs, admissible bounds, sound
macros) that no amount of runtime optimization can reach.
