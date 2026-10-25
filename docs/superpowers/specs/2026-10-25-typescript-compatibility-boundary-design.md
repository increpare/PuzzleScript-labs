# Explicit vanilla compatibility and execution order

The user approved this cleanup after reviewing eight representation leaks and
copied implementation details. Exact behavior remains the default, including
rigid issue #1206 and the reported restore bug. No corrected-semantics mode or
generic engine/profile framework is introduced.

## Design

`typescript/src/compatibility-vanilla-5a94bde1.ts` owns the exceptions specific to
the pinned vanilla revision: restore retention addresses and selection, rigid
ordinal merging and owner transitions, LHS randomdir's conjunction, special
self-colliding movement combinations, and the random-direction upper boundary.
Its functions have narrow domain inputs and explicit names. Ordinary compiler
and runtime functions delegate only at the relevant exception, rather than
hiding an engine behind a compatibility facade. Layout dependence remains real
and is documented as such.

Compatibility-owned interfaces declare the existing rigid-transition and restore
policy fields. Domain game interfaces extend these explicitly; their runtime
shape stays unchanged, preserving the independent adapters. Nullable rigid
ownership is defined in the compatibility module and named in the domain model.

`scan-order.ts` defines coordinate generators for rows, columns and oriented
matching. Movement, input and level compilation explicitly choose column order;
horizontal and InPlace matching choose rows, and vertical matching chooses
columns. These are observable execution orders, independent of board storage.

Cells remain sets of present objects. Collision layers govern blocking and
compiler diagnostics; accepted conflicting writes may coexist. Document that
contract and preserve a source-compiled, diagnosed conflict regression. Do not
add an invariant that vanilla does not enforce.

Remove the redundant consecutive-failure counter. Preserve group iteration
limits, command effects, random draws, tuple order, sound order and all existing
compatibility behavior.

## Alternatives and validation

Merely renaming helpers leaves the dependency unexplained. A selectable clean
engine would change the agreed scope. The selected boundary exposes the exact
historical dependency while keeping common algorithms direct.

Add tests for ordered coordinate sequences, the versioned compatibility API,
restore boundaries and nullable rigid ownership. Existing independent oracle
tests remain authoritative and are not relaxed. Run the strict full suite,
focused per-move corpus replays and standalone source/trace examples. Inspect the
final diff for accidental semantic changes and keep native fixtures unchanged.
