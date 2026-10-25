# Static Analysis Soundness Notes

Durable record of the soundness scope and known limitations of the JS static
analyzer (`src/tests/ps_static_analysis.js`, front-ended by
`compileSemanticSource` in `src/canonicalize.js`). This is the canonical place
for these decisions — there is no repo-root `TODO.md` (an old, unrelated solver
`TODO.md` was deleted in commit `07d73fb3`; do not cite it).

## Setup rule certificates

Rule tags `self_disabling`, `persistent_guard`, `idempotent_effect`, and
`setup_only` distinguish a local rewrite from a whole-program lifetime claim.
They are derived independently of fact-family filtering. Each `rule_setup`
fact has the same four boolean tags; its status refers specifically to
`setup_only`. A rejected setup fact can still certify local self-disabling or
idempotence through those boolean tags.

The first proof supports concrete-object, fixed-width single-row patterns.
Synonyms and compiler-expanded concrete alternatives work after normalization;
unresolved object sets, multiple independent pattern rows, ellipses and movement
gates remain unproved. RHS `stationary` assignments are allowed: the compiler
inserts them for unguarded object creation. Positive RHS movement is excluded.
Commands, random selection and rigid groups block idempotence and setup proofs.

`self_disabling` means that a successful replacement falsifies at least one
read at exactly the same pattern cell. `persistent_guard` means at least one
effect is irreversible during committed forward play. For unguarded writes it
can describe a lasting effect even though the rule still matches. Permanence
uses **all** rule writers and erasers, including cosmetic and late rules, plus
movement origins and player input. Preserved object count is not permanence:
relocation can reopen a setup opportunity.
Movement is tracked conservatively by collision layer, since a replacement can
inherit its predecessor's cardinal movement without an explicit RHS write.

`idempotent_effect` concerns an exhaustive invocation in isolation. Concrete
assignments that cannot enable new match tuples leave a fixed point; external
rules and movement resolution are outside that claim. It does not imply group
idempotence or justify changing group repetition.

`setup_only` is conditional: a permanent disabling witness, or permanent
idempotent effects, must combine with eligibility that becomes invariant after
already-proved setup dependencies settle. The least fixed point leaves cyclic
dependencies unproved. Fact values contain `guards` (zero-based row and cell,
object name, established `present` boolean, and `persistent` boolean),
`setup_dependencies` (rule ids), `retirement` (`after_setup_quiescence` when
proved, otherwise null), and `scope`
(`forward_play_between_state_restorations`). Blockers and evidence identify
unproved conditions and interfering rule ids. These are analyzer facts only;
no engine or solver consumer currently retires rules using them.

The idempotent retirement route also checks transient movement effects. A
seemingly redundant `stationary` write can keep clearing another rule's `action`
state every turn and suppress an action-sensitive consumer. Every RHS
stationary layer, including compiler-injected writes, must therefore be unable
to receive positive movement or action. This additional check is unnecessary
when permanent disablers make the entire pattern impossible after setup.

Quiescence must actually be reached and committed. Without
`run_rules_on_level_start`, setup can start on the first input; a dependency
chain in reverse source order can require several turns. Random selection,
rigid rollback and the engine's bounded loop iteration are not an initialization
guarantee. Undo, restart, level load and snapshot restoration require any future
consumer to reconsider retirement from the restored board. A global mutable
"this rule already ran" flag would be unsound for solver branches too.

The analyzer is designed to **never over-claim**: a `proved` fact / a positive
tag is meant to hold for every reachable runtime state. The runtime-contract
suite (`run_static_analysis_runtime_contracts_node.js`) is the dynamic oracle —
it runs the real engine over recorded traces and checks each claim at every turn
boundary. The notes below document the exact scope in which two classes of claim
are sound, and why two coverage exclusions are intentional rather than bugs.

## 1. Cosmetic claims are solver-scoped (unsound under undo)

**Tags:** object `cosmetic`, rule `cosmetic` (and the projection / rule-suppression
optimizations that consume them).

**The decision:** cosmetic projection (dropping a cosmetic object from the board)
and cosmetic-rule suppression (deleting a rule whose only effects are cosmetic)
are sound for **forward solver search only**. They are **not sound under `undo`**.

**Why undo breaks it:** the engine pushes an undo state whenever `level.objects`
changed during a turn. A turn whose *only* effect is a cosmetic change still
pushes an undo state. Suppressing that rule (or projecting that object) therefore
changes the **depth of the undo stack**. A later `undo` then restores a
*different* turn than it would have in the unoptimized game, and that divergence
can surface in non-cosmetic state. So any consumer that can issue `undo` — or
otherwise observe undo-stack depth / turn-history length — must not rely on these
tags. Solver search never issues undo, so the tags are sound for it.

**How this is enforced in the oracle:**
`run_static_analysis_runtime_contracts_node.js` gates all cosmetic/merge
projection replays on
`checkSolverProjectionReplays = !hasUndoInput && noRandomProved` (around line
1609). Undo-bearing traces skip cosmetic-object projection, cosmetic-rule
suppression, cosmetic-rule optimizer, and merge projection parity checks.
`static_analysis_adversarial_node.js` (the `cosmetic_undo_solver_scope` fixture)
asserts that an undo-bearing trace produces `cosmeticRuleProjectionChecks === 0`,
locking the scope in.

**Where the scope is disclosed to consumers:** the `cosmetic` object and rule
specs in `static_analysis_claim_descriptions.json` carry an explicit `SCOPE:`
clause and a structured `scope` field.

## 2. Random games are intentionally excluded from cosmetic/merge verification

The `noRandomProved` half of the gate above means a game that uses randomness
(`random` rules, `randomDir` RHS movement, `random` object writes) receives
**zero runtime verification** of its cosmetic-object, cosmetic-rule, and merge
projection claims.

This is **intentional and not closable**, even though a seed is recorded:

- A cosmetic/merge optimization is allowed to *change which random draws happen*
  (e.g. by removing a rule application that would have consumed the RNG). Once
  the draw sequence diverges, the end state diverges too. Replaying with a fixed
  seed and demanding end-state equality would therefore fail for a *correct*
  optimization — we would be testing seed-stability, not cosmetic-ness.
- The whole point of "cosmetic" is that the difference does not matter to the
  solver. On a random game we explicitly do **not** want to care whether an
  optimization changes the post-optimization random state.

So the analyzer still *emits* cosmetic tags for random games (they remain valid
solver hints), but the runtime suite does not attempt parity replays for them.
The tag specs disclose this exclusion.

## 3. The analyzer rejects games the real engine rejects

`compileSemanticSource` runs the semantic compile pipeline (`compileSemantic`),
which stops after `rulesToArray` and historically did **not** run `rulesToMask`.
`rulesToMask` is where the real engine performs several rule-level validations
(same-cell "can't overlap" check, RANDOM-on-LHS, ellipsis pairing/placement,
unlayered objects, etc.). Skipping it meant the analyzer would happily produce
`status: ok` facts for games the real engine rejects at compile time — vacuous
claims about a program that can never run.

**Resolution:** the static checker now runs a full-engine validation pass
(`validateCompileSource` in `src/canonicalize.js`, backed by the runtime's
`compileValidate`) on a throwaway state, and `analyzeSource` returns
`status: 'compile_error'` whenever it reports errors (`errorCount > 0`).
`compileValidate` runs every `loadFile` pass that can shape the
rule/object/win-condition model the analyzer reasons about — `rulesToMask`
(same-cell "can't overlap", RANDOM-on-LHS, ellipsis pairing/placement,
unlayered objects), `collapseRules` (the "can never overlap, rule can never
match" LHS check), `generateRigidGroupList`, `processWinConditions`, and
`checkObjectsAreLayered` — in `loadFile` order, on its own re-parsed state
(`rulesToMask` is destructive: it overwrites rule cells with `CellPattern`
objects, so it cannot run on the state used for analysis).

The gate deliberately **stops at `checkObjectsAreLayered`**. `loadFile`'s
remaining tail — `twiddleMetaData`, `generateLoopPoints`, `generateSoundData`,
`formatHomePage`, and `addSpecializedFunctions` — is **not** run. Those passes
only diagnose presentation, audio, and metadata (level dimensions, loop-bracket
pairing, sound declarations, homepage colors) or emit pure codegen; none of it
feeds the analyzer's model. Crucially, the real engine still **plays** a game
whose only errors come from them: such a game keeps `errorCount` within
`MAX_ERRORS` and `loadFile` returns a non-null state, so `compile()` reaches
`setGameState`. Rejecting on those diagnostics would therefore refuse games the
engine accepts and the analyzer can soundly analyze. So the gate's accept set is
scoped to the model-relevant passes — it is **not** "the engine emits zero
diagnostics" (the engine itself plays many games with non-fatal warnings/errors).

Verified across the bundled corpora (static_analysis_testdata + solver_tests +
demo, plus the runtime-contract corpus): no valid game is rejected (no false
positives) and no engine-invalid game was hiding in the corpus. The only test
games this gate newly rejected were two inline fixtures that had relied on the
missing validation (a same-cell overlap spawn in `ps_static_analysis_node.js`
and a same-layer `[ action Player Flag ]` match in
`static_analysis_adversarial_node.js`); both were corrected to engine-valid
sources.

This closes the gap described in the labs `rulesToMask` overlap audit (commit
`d0b19420`).

## 4. Match interaction tags describe other locations within one rule invocation

Rule tags `may_invalidate_other_matches` and `may_enable_other_matches` are
conservative possibility flags: **false is the certificate**; true means the
interaction is possible or has not been ruled out. They refer to distinct
tuples of cell locations for the same concrete compiled rule. They exclude the
tuple just applied, which can consume its own match (`[ A ] -> [ B ]`).

The initial proof covers exactly one cell total: one bracket containing one
non-ellipsis cell. Replacements affect only that cell, so they cannot change
the object or movement predicates at any other cell. It also covers rules
without RHS replacements: they write no cells and queue commands separately.
For multi-cell rules containing only concrete object terms, the analyzer also
compares possible object additions/removals with positive and negative match
reads. Movement reads and writes are compared by collision layer: any object
write on a movement-read layer is treated as possibly changing its movement.
The flags can differ. A write that only satisfies a positive read can enable
another match without invalidating an existing match; a write that only
violates a negative read can invalidate without enabling. Properties,
aggregates, random RHS terms and dynamic directions remain conservative.

The live compiler can inspect lowered object and movement masks directly. It
applies the same polarity check to more rule forms, while treating random
choices and dynamic property/aggregate sinks as uncertain. It omits later
match rechecks only where its `may_invalidate_other_matches` result is false.
When exactly one rule is active in a non-random rule group, a false
`may_enable_other_matches` result can eliminate later group scans if its
replacement is fixed and either the rule has one isolated match cell or it
also cannot invalidate other matches. The isolated-cell case cannot affect
another tuple. In the multi-cell case neither certificate permits a change
to any match predicate, so the fixed replacements reach a fixed point after
one scan only if overlapping tuples also have compatible replacement writes.
Fixed constants alone do not suffice: `right [ A | A ] -> [ right A | left A ]`
on `AAA` repeatedly changes the middle cell. The lowered compiler checks for
conflicting set/clear assignments between pattern cells before certifying the
singleton rescan fast path. Other rules in a group may affect one another, so their group still
iterates. Collecting all matches first means new matches are not visited
within the same scan.

`[ A ] [ B ]` is not a single-cell rule: different Cartesian-product tuples
can share a cell. Ellipsis matches can also overlap. `[ A | A ] -> [ B | B ]`
on `AAA` can invalidate a collected match; `[ A | no A ] -> [ A | A ]` on
`A..` can create a new match absent from the original collection.

The compiled JavaScript interpreter consumes the invalidation certificate to
omit redundant rechecks of previously collected matches. It consumes the
enabling certificate to avoid later scans of a one-rule group. Fusing scanning
and application would additionally require stable scan bookkeeping and the
existing match order. Neither flag permits applying every match of a random
rule, changing RNG consumption, or bypassing bindings or queued commands.
Single-cell rules can still re-enable each other when grouped together, and a
randomized replacement can still change again at the same cell; those cases
retain the existing group loop.
`rulegroup_flow.single_pass_safe` is a separate certificate.

## 5. Rule-group independence includes replacement conflicts

The group graph covers both predicate interference and write/write interference.
`[ > Player | Crate ] -> [ > Player | > Crate ]` expands to directional rules
that need not enable one another's LHS, yet opposing players can overwrite the
same crate movement until the group hits its 200-pass guard. Such rules belong
to one component and cannot receive a single-pass certificate.

Object effects include provisional writes before movement resolution, expanded
properties and collision-layer siblings. Movement effects include assignments,
implicit clears and all five bits on affected collision layers. A write that
can invalidate a predicate also connects components. The winflow/program-flow
wake graphs keep their separate enabling-only interpretation.

Single-pass safety additionally requires a proof against conflicting writes
from overlapping tuples of each rule. The semantic analyzer conservatively
rejects multi-cell state writers. This does not by itself prevent splitting
independent components: a component may still require internal repetition.
Random/dynamic replacements, observable commands, rigid rules and force-always
rules retain conservative blockers. Single successful replays are not proof
of independence on arbitrary boards or after other rules assign movement.

Group-skip masks apply only to an already clean group. They cover replacement
outputs as well as LHS reads: changing a RHS-only movement can require a rule
to rewrite it even though its match predicate never changed. These masks do
not establish convergence and do not permit skipping a first evaluation.
