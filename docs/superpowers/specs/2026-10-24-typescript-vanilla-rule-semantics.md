# Vanilla source-rule semantics

Authority: official vanilla revision `5a94bde1a5127a3a45306ea28598eba2874d446d`.
This contract describes ordinary rule data and ordering; no masks, caches,
generated functions or pruning belong in the reference implementation.

## Ordered passes

Native `rulesToArray` and `loadFile` establish this order:

1. Parse syntax, commands and source-group membership; expand selector families
   and retain only the first selector for a nondirectional rule.
2. Normalize redundant negative requirements using the original named terms.
3. Emit a variant per retained orientation; resolve relative qualifiers.
4. Reverse Up/Left rows into Down/Right only when the LHS has no ellipsis.
5. Expand aggregate names, then substitute synonyms.
6. Expand and infer movement families.
7. Expand and infer properties.
8. Infer stationary intent for spawned objects, except in late rules.
9. Normalize duplicate variants, retaining the last equal variant in its source group.
10. Validate/lower predicates and replacements; collect early/late groups.
11. Assign rigid groups and loop maps from surviving groups.

Abort flags have native phase boundaries. A syntax invalid flag does not skip
the early-negative pass; native then processes the first orientation through
relative conversion, reversal and aggregate expansion before checking that flag
and returning. A movement ambiguity sets invalid but does not skip subsequent
movement inputs, property inference or spawn inference. Native loadFile checks
that flag only after the complete rule-expansion pipeline, before deduplication
and lowering. The final compiler must preserve those diagnostic checkpoints
rather than treating every pass's abortsCompilation result as an immediate stop.
Within orientation/name processing, native completes relative conversion, row
reversal, aggregate expansion and synonym substitution for ONE variant before
visiting the next. The source orchestrator must retain that interleaving when
exceptions or syntax-invalid recovery can make later operations unreachable.
Expose aggregate expansion separately from synonym substitution so the initial
invalid checkpoint can stop between them. An invalid first variant must not
rotate a later InPlace selector or substitute synonyms before returning.

Preserve ordered terms until lowering. Aggregate expansion replaces its first
member in place and appends other members at the cell's end. For example,
`horizontal Pair vertical C`, with `Pair = A and B`, becomes
`horizontal A, vertical C, horizontal B`, affecting subsequent variant order.
Separate normalized synonym/property/aggregate namespaces are required. A unified
preferred-name lookup or unordered object sets cannot replace them. Property
aliases retain distinct inference names even when their members are identical.

Distinguish direct pass inputs from reachable source behavior. In particular,
native loadFile reports missing player/background declarations, then returns null
when no collision layers were parsed, before generateExtraMembers or rule lowering.
A crash produced by manually bypassing that guard does not require a lowerer
compatibility branch. Whole-source assembly must preserve the earlier return.

Rule-body name membership is separate from those normalized meanings. Native
adds current object/legend registrations to its accepted-name set on entering
SOUNDS. The final compiler sees registrations before the latest SOUNDS entry,
including for rules captured earlier; without SOUNDS it sees no names. A later
definition can change an already accepted property's meaning without making a
new name available. Preserve this boundary for malformed section order.

The early negative-requirement pass occurs after syntax has already decided
whether a rule is directional. It diagnoses contradictory RHS requirements,
removes matching verbatim RHS exclusions, and removes LHS exclusions covered by
known occupied layers with disjoint objects. Occupancy recognizes concrete names,
single-layer properties and aggregates, but deliberately does not follow synonyms.
Preserve ordered deletion behavior: the RHS loop advances after deleting a term,
whereas the LHS loop revisits the shifted position. Use ordinary sets and terms;
the native acceleration representation is unnecessary.

Malformed duplicate layer assignments can leave a writable orphan identity selected
by an unlayered name. Preserve that identity in ordinary lookup sets, distinct from
the current same-name object. Its orphanedFrom link supplies current-definition
intent for random spawns and player input; it has no physical layer membership.
Concrete unlayered RHS terms still use recovery layer zero. Never-match or
empty-set approximations would lose observable random, player and win behavior.

Its placement affects random selection and spawn intent. With Player/Wall/Crate
on one layer, `random horizontal [Player no Wall|Player no Crate]->message row`
followed by `+ [Player]->message single` has three random candidates on a PP board
after duplicate normalization. Replacing positive Player with its synonym retains
the exclusions until later and yields four candidates. Late generic removal would
collapse the latter incorrectly. A conflicting `Player=Other` synonym can also
make early exclusion removal change whether an RHS Crate becomes stationary.

## Orientation and movement

A rule is directional if an LHS row has multiple cells or either side contains
relative qualifiers. Otherwise retain only its first selector/default direction.
The default order is Up, Down, Left, Right. Resolve relative movement before
reversing Up/Left rows; do not rotate it again after reversal. A first term named
`...` in any LHS cell prevents reversal, even under malformed recovery. This
name check is distinct from lowering's ellipsis-qualifier check.
Parallel/perpendicular retain distinct inference identities
from equivalent horizontal/vertical selectors.

Two invalid-source failure boundaries stay explicit in the typed pipeline.
An InPlace selector with a relative qualifier has no native rotation and throws
TypeError. A normalized empty aggregate makes native atomization emit undefined
names, then full native compilation throws TypeError in rulesToMask. The typed
name pass raises TypeError directly for the empty aggregate, keeping term names
as actual strings. It preserves the failure category, while exact intermediate
undefined data, host exception text and error ordering for that malformed case
remain outside this bounded stage's parity claim. All ordinary corpus outputs
are still compared exactly; full compiler diagnostics remain a later gate.

Movement inference expands the first ambiguous term in every eligible LHS cell
of a partial variant, then processes resulting branches. This creates duplicate
paths. Substitute a chosen movement locally on the RHS for the same entity and
family; then infer globally for a unique entity/family occurrence; then infer
across entities when the family has one LHS expansion occurrence. A remaining
RHS family makes the compiler state invalid.

`moving` includes Action; `orthogonal` does not. For
`[ horizontal A | vertical B ]`, duplicate normalization leaves this order:
left/up, right/up, left/down, right/down. The same two qualifiers in one cell
produce left/up, left/down, right/up, right/down. A generic Cartesian product
would change random selection.

## Properties

- Retain a single-layer property as Any when every RHS use has the same property
  in its corresponding LHS cell. It changes layer intent without choosing an object.
- Expand multi-layer properties, including local `[P] -> [P]` uses.
- A transported RHS use forces all LHS occurrences of that property name to expand.
- Each LHS cell chooses independently. Multi-layer `[P | P] -> [P | P]`
  produces AA, AB, BA, BB. Coexisting members may match separate variants.
- Exactly one expanded LHS cell permits global RHS inference. Multiple source
  cells plus an unmatched RHS occurrence is ambiguous and produces no variants.
- `no P` expands to negative terms for every member. `random P` is excluded from
  inference and remains a random spawning choice.

First-member runtime capture does not express vanilla's variant behavior.

## Lowering and semantic normalization

Concrete LHS terms become required/forbidden objects and layer movement conditions.
Retained single-layer properties become Any object sets plus known-layer intent.
Only static predicates and edits enter the runtime. A concrete RHS addition
replaces its collision layer; retained properties preserve the object and change
intent. Random RHS names form one distinct candidate union in object-choice order.
Unqualified versus stationary intent remains distinct. Spawn-stationary inference
considers possible LHS objects including negative terms, and skips late rules.

Detect overlapping positive layer terms before converting to sets: even two
aliases of one object can cause native rejection. RHS layer conflicts diagnose
while retaining conflicting writes. Native impossible-rule removal can affect
which group member supplies its random flag, so this validation has observable
behavior beyond optimization.

Native duplicate identity includes source line, flags, ordered terms and commands;
direction participates only for a multi-cell LHS. Keep the last equal variant
within a source group. Separate `+` source lines remain distinct random candidates.
Preserve the earlier native negative-term normalization before comparison. A direct
comparison of ordered records replaces the cached native printable representation.

## Groups, rigid and loops

`+` shares only group identity, not late/rigid/random flags. Loop markers do not
reset the previous ordinary rule. Split early/late rules before choosing each
group's first surviving rule as its random policy. Any surviving rigid member
makes its early group rigid. Use actual surviving schedule indexes for ownership.
Keep issue #1206's explicit rigid merge behavior.

Pair loop markers by source position; nesting and splitting a `+` group diagnose.
Build independent early/late loop maps from each loop's final surviving group
back to its first. Empty groups must not occupy schedule slots.

## Explicit zero-step recovery boundary

Native lexing diagnoses a `moving` rule prefix, but compilation salvages its
Action orientation. A non-ellipsis row in that variant tests every cell of its
pattern at one board position, visiting origins in row-major order. Replacements
also write repeatedly to that same position. A row containing an ellipsis has
no zero-step search matches; an unbounded zero-step gap loop would never terminate.
Test fixed-gap rechecks separately against native row predicates.

Reproducer: separate layers for Background, Player, Alpha, Beta;
`X = Player and Alpha and Beta`; rule `moving [ Alpha | Beta ] -> win`;
level `XX` / `XX`. Native variants are Down(Beta,Alpha), Down(Alpha,Beta),
Right(Beta,Alpha), Right(Alpha,Beta), Action(Alpha,Beta). Action matches coordinates
(0,0), (1,0), (0,1), (1,1), with zero spatial step. Adding an ellipsis yields no
Action matches. Model this explicitly instead of pretending it is cardinal.

Primary implementation evidence: `compiler.js` directionalRule/rulesToArray,
rewriteUpLeftRules, atomizeAggregates, concretizeMovingRule,
concretizePropertyRule, inferSingleLayerProperties, rulesToMask,
removeDuplicateRules, arrangeRulesByGroupNumber, generateRigidGroupList,
generateLoopPoints; `engine.js` applyRuleGroup and generated row search functions.
