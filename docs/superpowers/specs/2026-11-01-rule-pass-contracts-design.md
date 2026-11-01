# Honest rule-pass qualifier contracts

This continues the approved frontend clarity goal. The same full qualifier type
currently crosses orientation, movement inference, property inference and
lowering. `qualifierMovements` silently turns unsupported qualifiers into an empty
movement list. Replace this with finite stage domains and exhaustive lowering,
without changing runtime record schemas or adding stage brands.

## Finite domains

Keep numeric `RuleQualifier` identities unchanged. Define small union aliases:

- AbsoluteMovementQualifier: Up, Down, Left, Right, Action.
- AtomicQualifier: absolute movements, Unspecified, Stationary, No, RandomObject,
  RandomDirection and Ellipsis.
- SourceMovementFamily: Horizontal, Vertical, Orthogonal, Moving.
- MovementFamily: source families plus the four internal parallel/perpendicular
  families produced by orientation.
- RelativeQualifier: Forward, Backward, Counterclockwise, Clockwise, Parallel,
  Perpendicular.
- SourceQualifier: atomic, source families and relative qualifiers.
- OrientedQualifier: atomic and oriented movement families.

Parameterize only the existing term/cell/rows shape and a directed-rule shape by
their qualifier type. `RuleSyntax` rows and authored `qualifierValue` use
SourceQualifier. `OrientedRule` uses OrientedQualifier; `MovementRule` uses
AtomicQualifier. These are structurally different finite domains, not aliases of
the same broad record. One qualifier parameter is enough; do not add left/right
side parameters for unused precision. Preserve all fields and source identities.

## Transitions and errors

Orientation visits all terms and returns OrientedRule, including recovered extra
RHS rows. Keep InPlace direction and its existing relative-lookup failure. The
four internal family identities cannot enter through authored source syntax.

Movement expansion returns its existing runtime fields, but the existing boolean
discriminates them statically: `abortsCompilation:false` has MovementRule[], while
`true` has OrientedRule[] with unresolved RHS families allowed. Keep the entire
invalid variant family and native diagnostic order. Narrow expansion families
and choices to their actual finite sets. Replace the catch-all choices([])
pattern with an exhaustive family classifier plus family-only choice lookup.

After producing diagnostics, return the broad invalid case when diagnostics are
present. Otherwise prove the produced records atomic with exhaustive structural
predicates and `every`; throw an internal invariant error if that proof fails.
Do not assert an entire array to the narrower type or discard invalid variants.

Property inference preserves its qualifier parameter. A new same-shaped
PropertyResolvedRule alias would imply more than is true: local single-layer and
unlayered properties, random-object properties, recovery names and malformed
extra RHS cells can remain. Its postcondition is relational: surviving ordinary
properties need no further transported-property expansion. Document and test
that instead of introducing a new concrete-name AST or runtime brand.

Implicit stationary inference may add Stationary, so its generic output is
`DirectedNamedRule<Q | RuleQualifier.Stationary>[]`. Duplicate normalization
preserves the exact input record type because it filters original records; its
standalone tests deliberately include qualifiers from earlier stages.

## Compiler sequence and lowering

Branch on movement validity before a small shared generic finishing helper. That
helper always runs property inference, appends its diagnostics and runs spawned
stationary inference. The invalid branch runs it, then returns null. The success
branch retains the atomic type and then handles the existing final syntax-invalid
empty-selector check. Preserve the earlier syntax checkpoint after aggregate
expansion. Checking the movement flag after property inference cannot narrow
already-created unrelated variables; do not use casts to hide that problem.

`lowerRules`, `LoweredRule.namedRule` and `lowerSourceRules` accept MovementRule.
Movement conversion must handle its actual input union exhaustively, with
Unspecified explicitly giving no requested movement. Existing No, Ellipsis,
Stationary and RandomObject handling stays at its semantic call sites. Relative
qualifiers and movement families cannot silently become no movement. Use a small
exact helper union or explicit exhaustive cases, with a never-checked failure for
impossible runtime inputs.

## Verification and oracle boundaries

Strict negative contracts reject relative oriented terms, internal source-only
misuse, family/relative movement rules, broad/invalid movement results passed to
lowering and loss of atomic guarantees through property/spawn/duplicates. Positive
contracts demonstrate the ordinary successful pipeline without assertions.

Keep all native schemas and fields unchanged. The standalone lowering oracle
bypasses the compiler checkpoints; add an explicit successful-movement precondition
before it lowers candidate output. Its existing fixtures and all 492 original
sources contain no residual movement ambiguity. Preserve invalid movement /
property continuation coverage in the property and compiler suites; do not drop
their malformed or stage-boundary fixtures. Existing rule/compiler tests check
the exact movement→property→spawn order and that lowering is never visited after
movement invalidity.

Run focused stages/contracts, spec then quality review, the complete strict suite
and a bounded differential sample. No native behavior or normalization is being
redesigned in this slice. Up/Left rewriting, local-property retention and duplicate
normalization remain separate transformation-audit candidates. Movement/property
choice evidence and spawned-stationary inference carry language semantics.
