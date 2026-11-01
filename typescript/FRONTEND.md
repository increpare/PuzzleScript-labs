# Reading the source compiler

The reference compiler uses ordinary source tokens, objects, unnamed collision
layers, movements, cells and rule transactions. Its typed stages describe what
has actually been established. Source recovery remains explicit where vanilla
accepts malformed text; the compiler does not reconstruct another grammar from
raw words.

```text
source visits → accepted definitions + authored evidence
rules: source qualifiers → oriented qualifiers → atomic movement success
       → property source links → ordered member construction
       → stationary inference → executable transactions
```

Accepted declarations own their assets and exact source tokens. Final name
normalization is a distinct operation with its own overwrite and enumeration
rules. Sounds, win conditions and metadata acceptance come from the source walk.
Compilation resolves names and domain settings, rather than accepting syntax
again. Message commands retain authored text/span evidence and actual effective
compiler text; SFX indices use a shared finite 0..10 vocabulary.

Each property has ordered alternatives and an explicit layer analysis. Source,
oriented and atomic rule qualifiers are separate finite types. Invalid movement
results keep their families for property diagnostics; only successful atomic
results reach lowering. Property inference preserves that movement guarantee,
while legitimately retaining local, random and recovered names.

[Object-source resolution](src/rule-object-sources.ts) receives candidate rule-cell
addresses and a target address. It returns Resolved(cell), Missing or
Ambiguous(cells), with corresponding-cell preference and full row/cell identity.
It knows no concrete member, layer or expansion policy. The property pass first
expands negatives and resolves RHS source links, then chooses members in the
existing work order and constructs RHS terms from per-cell selections. Local
predicate retention and concrete expansion use the same source relationship.
Only construction knows which members were selected; diagnostics still follow
expansion so empty branches can remove otherwise unresolved uses.

## Transformations with observable behavior

Several operations originated in the optimized JavaScript compiler. Their
observable effects belong to the reference behavior. There are no bitsets,
generated match functions, stringified-rule caches or packed layer fields in
these frontend stages.

| Operation | Conceptual role and observable consequence | Evidence |
| --- | --- | --- |
| Whole-line lowercasing and authored offset mapping | Names and message search use native effective text; authored words keep exact UTF-16 spans. Contextual casing and expansion can change values/positions. | `rule-lexing`, Unicode object/legend tests, source parser stopping-cursor tests |
| Source registration and final name normalization | Source-time lookup, later overwrites, source-order members and final aliases have different precedence. Duplicate alternatives and dictionary order survive. | declaration frontend/native tests, accepted-declaration oracles |
| Default selectors and nondirectional first-selector retention | The retained selector controls traversal even for one-cell patterns. | selector witness below, rule syntax/native tests |
| Relative movement orientation | Forward, rotations, parallel and perpendicular become explicit oriented directions/families. | oriented-rule/native tests, rule-pass contracts |
| Up/Left fixed-row normalization | Down/Right row execution fixes the order of RHS writes and random draws. Ellipses retain their direction and gap traversal. | Up witness below; ellipsis orientation/native tests |
| Early exclusion checking and trimming | Diagnose contradictions/redundancies and preserve native recovery before alias/property expansion. Namespace priority and warning order matter. | early-negative/native tests, compiler pass-order negative controls |
| Aggregate atomization, then synonym substitution | Ordered member slots, duplicates and substitution boundaries determine later inference and diagnostics. | rule-name tests and swapped-pass rejection |
| Movement-family choices and inference | Ordered alternatives plus source-cell evidence determine what a remote RHS family can infer. Equal values do not replace unique-site evidence. | movement/native tests, ambiguity continuation and strict type contracts |
| Property source links and ordered member construction | Corresponding-cell or unique-source relationships are resolved before member selection. One local predicate scans occurrences in board order; separate variants scan in alternative order. | pure source/type contracts, cross-row/empty-branch native checks, local-property witness and unique-multirow-transfer |
| Spawned stationary inference | A newly supplied layer must not inherit a previous object's movement. Possible LHS layers, property membership and unlayered recovery determine the result. | property/spawn/native tests |
| Keep-last duplicate normalization per contiguous source group | Random selection observes candidate multiplicity and order. Equality does not cross source lines or independent group boundaries. | duplicate witness below, duplicate/native boundary tests |
| Diagnosed impossible-rule removal | Report the native contradiction warning and omit the unsatisfiable rule from the accepted schedule. This is explicit compiler recovery. | full-compiler contradiction witness |
| Lowering and transaction construction | Static predicates, required/forbidden movements, ordered writes, whole-set clearing and additions determine execution. | every lowered-field oracle, semantic interaction fixtures |
| Source groups, loops, late and rigid scheduling | Source order and loop/group ownership determine repetition, RNG and retry behavior. | schedule/native tests and per-move rigid/loop fixtures |
| Palette, level, background and metadata compilation | Resolve accepted domain values, canonical objects and ordered background selection. Coordinate validation keeps native numeric/recovery rules with explicit failure results. | asset/game-data/native oracles, domain boundary tests |

Inference evidence is ordinary compiler data about source choices and cells. It
is not a runtime binding, cache or generated representation. Native malformed
recovery has named boundaries (`NativeLegendExpression`, native-name lookup,
effective message cursor and compatibility policy); it is not silently encoded
in ordinary objects or layer masks.

## Four behavioral witnesses

[frontend-transformations.test.mjs](test/frontend-transformations.test.mjs)
independently compiles each real source with vanilla and compares every session
observation. It also runs clearly labeled counterfactual typed game graphs.
Those graphs never supply candidate oracle input or expected native data.
The counterfactuals show the observable difference rather than just a different
compiler array shape. All use seed `frontend-0`.

| Retained behavior | Actual board after one input | Counterfactual result |
| --- | --- | --- |
| Normalize two equal `random right right [ > Player ] -> [ Crate ]` variants, starting at `PP..` | `C.P.` | Duplicated candidates select the other player: `PC..` |
| Execute `up [ Player \| Player ] -> [ random Choice \| random Choice ]`, where Choice is Crate or Wall, on two vertical Players | Crate above Wall | Source-Up edit order swaps the same two draws: Wall above Crate |
| Retain the first selector of `random [ Player ] -> [ Crate ]` on a 2×2 Player board | Bottom-left becomes Crate | Keeping the later Right selector instead chooses top-right |
| Keep Item as a local predicate in the existing Blue-Red-Blue overlap fixture | `B.bP` (Blue survives and is marked) | Ordered concrete variants produce `bR.P` (Red survives and is marked) |

Here `.` is background, `P` Player, `C` Crate; uppercase Red/Blue include Mark.
The overlap source and hand-explained expected moves live in
[local-property-overlap.ps](../src/tests/semantic-fixtures/interaction-matching/local-property-overlap.ps)
and its fixture manifest. The independent full-compiler contradiction check in
[frontend-domain-boundaries.test.mjs](test/frontend-domain-boundaries.test.mjs)
also confirms warning order, accepted compilation and the empty schedule.

## Validation and limits

The native parser/compiler source corpus checks diagnostics, recovery, source
identities and every executable rule field. Strict temporary TypeScript programs
test rejected domain assignments, including nested collections and composed
helpers. Bounded generated campaigns compare complete sessions per move. These
tests establish the covered behavior; readability also receives an independent
whole-frontend audit. The reading guides and audit plan record actual results.

Runtime prepared-AGAIN reuse belongs to separate work and remains outside this
frontend audit. Runtime historical quirks remain in explicit compatibility
policy. Neither changes the compiler's conceptual representation.
