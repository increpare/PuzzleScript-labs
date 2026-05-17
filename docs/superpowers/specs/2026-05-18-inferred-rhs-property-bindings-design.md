# Inferred RHS Property Bindings

Status: design approved for test-harness spike.
Date: 2026-05-18.

## Goal

Phase 5c should stop Cartesian-splitting rules where a RHS property or movement
aggregate can be inferred from a corresponding LHS occurrence under existing
PuzzleScript compiler semantics.

Today the compiler materializes this inference by expanding the authored rule
into concrete rules. For example, if `Pushable = Crate or Box`, this rule:

```txt
[ > Pushable | no Pushable ] -> [ | Pushable ]
```

is compiled as separate concrete rules where the RHS `Pushable` is inferred as
`Crate`, `Box`, and so on. Phase 5c should preserve the authored rule shape and
carry the inferred RHS property binding at runtime.

This is not an equality constraint between independent LHS property terms.

```txt
[ Prop | Prop ]
```

still means any `Prop` in the first cell and any `Prop` in the second cell.
Those two LHS matches remain independent; a future coalescer must not require
them to be the same concrete object.

## Existing Inference Semantics

The current compiler has two relevant split-and-infer paths.

`concretizePropertyRule()` splits a property when the property cannot be handled
as a single-layer or preserved layer-coupled term. While splitting, if a property
has exactly one LHS occurrence, remaining RHS occurrences of the same property
are rewritten to the same concrete alias. If there is no unique LHS occurrence,
the RHS property remains ambiguous and compilation reports the existing
`can't be inferred from the left-hand side` diagnostic.

`concretizeMovingRule()` does the same style of work for movement aggregates
such as `moving`, `orthogonal`, and the scan-direction-derived
`horizontal_perp` / `vertical_perp` forms. It splits the aggregate to concrete
directions and then uses a unique LHS occurrence to rewrite matching RHS
movement aggregates.

Both passes currently encode inference by making more concrete rules. Phase 5c
should move only the inference payload to runtime; it should not change which
rules are inferable.

## Runtime Model

The proposed runtime model is:

1. Match functions remain pure predicates. They test each LHS property term
   independently, just as today.
2. Before replacements run, `Rule.applyAt()` captures inferred bindings from
   source cells in the matched tuple. This must happen before any replacement
   mutates the board.
3. `CellReplacement` receives the binding context and uses it to compute dynamic
   object set/clear masks and movement set/clear masks for RHS terms that are
   explicitly marked as inferred.
4. If a rule shape cannot be represented without changing existing inference or
   alias-priority semantics, it stays on the old expansion path.

The binding context is per rule application, not global state. It should be
small and scratch-like: source row/cell/term references, inferred object id or
layer, and inferred movement bits where needed.

## Conservative First Slice

Start with tests and metadata for the semantics, then implement runtime support
in small steps.

The first runtime implementation should prefer movement writes where the target
cell already constrains the relevant object/layer. That proves the capture and
replacement plumbing without immediately handling object creation.

Object creation into an unconstrained or `no Property` target, such as the
`hungry kraken` growth rule, is the riskiest part. The old expanded rules have
alias ordering, and repeated rule application can use earlier alias writes to
block later aliases. V1 may either emulate that ordering explicitly or
conservatively leave those rules expanded.

## Required Tests

The standalone test harness is `src/tests/run_inferred_rhs_property_bindings_node.js`.
It should cover:

- Independent LHS property terms do not become equality-bound.
- A unique LHS property occurrence can infer an ambiguous RHS property across
  cells.
- A RHS property with no LHS source still emits the existing compiler error.
- A RHS property with multiple possible LHS sources remains ambiguous.
- Future runtime-binding tests should add movement-aggregate and object-creation
  fixtures before the compiler starts preserving those rules.

## Candidate Corpus Rules

Current high-count examples that this phase is meant to reduce, once the runtime
machinery exists:

| Game | Source line | Concrete rules | Shape |
| --- | ---: | ---: | --- |
| `hungry kraken.txt` | 598 | 108 | property alias creation across cells |
| `easyenigma.txt` | 1074 / 1075 | 100 each | movement aggregate inference |
| `robotarm.txt` | 366 | 80 | property alias plus movement aggregate inference |
| `Voitex Rasteriser 2.txt` | 271 / 276 / 281 / 286 | 72 each | property alias plus direction aggregate inference |

## Non-Goals

- Do not reinterpret `[ Prop | Prop ]` as same-object matching.
- Do not alter author-facing syntax.
- Do not coalesce random, randomdir, rigid, ellipsis, or command-sensitive
  shapes until there is a test demonstrating exact old behavior.
- Do not partially coalesce object-creation cases unless alias ordering is
  explicitly preserved.
