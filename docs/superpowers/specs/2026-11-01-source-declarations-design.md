# Conceptual source declarations

The next porting slice removes declaration interpretation from the lexical
walker. Its purpose is readable language concepts and stronger types, rather
than faster lookups or a new wrapper around the old parser state.

## Responsibilities

A source-declaration module owns ordered registrations of objects, aliases,
properties and aggregates. Numeric enum discriminants make each payload explicit:
an alias has one target, a property has alternatives and an aggregate has
constituents. Authored references and already-expanded members remain distinct.
Lookup returns a discriminated result with required fields for its kind, replacing
`FoundName.entry?` and its non-null assertions.

Source-order lookup and the final compiler namespace are distinct language
operations. Source declaration existence prefers object, aggregate, property,
then alias; source expansion follows object, alias chain, aggregate, then property.
Keep those precedence rules explicit. Ordered registrations retain duplicate
aliases, repeated members and overlapping namespaces, which affect behaviour.

The module also owns source-time collision-layer membership: expanding properties,
rejecting aggregates, checking Background isolation, and preserving the order and
multiplicity of duplicate-layer warnings. Layers remain unnamed. Rule and level
vocabularies are captured at their existing section checkpoints.

The lexical walker owns cursor movement, section/layout visits, comment handling,
sprite/color scanning and issue collection. Its declaration calls report issues
synchronously so a cap can interrupt before the next mutation. No deferred batch
of diagnostics may replace this ordering.

Inherited native Object.prototype names are an explicit compatibility helper.
They can participate in malformed-source lookup but do not become actual
registrations, canonical objects or vocabulary snapshot entries.

## Legend recovery

Share the self-reference removal and resulting-kind mechanics currently duplicated
between source-time registration and `recoverLegendExpression`. Keep recovery's
source evidence and interruption order. Native can revisit and mutate the same
working expression after comments; compiler diagnostics intentionally retain
every authored self-reference. Those reporting policies remain distinct.

Do not force the raw authored legend view to share effective recovery classification.
Do not add a second cached namespace to the document while retaining both old
reconstruction paths. Transporting accepted registrations into canonical compiler
construction is a later slice unless this implementation can replace the old
preparation expansion completely and clearly.

## Clarity checks

The walker must no longer perform recursive declaration lookup, compound-member
expansion or layer membership validation. The new code should read in terms of
objects, targets, alternatives, constituents and layer members. Preserve language
order with direct loops and arrays; add no bitsets, generated functions, lookup
caches or optimizer shortcuts. Reject impossible declaration payloads through the
TypeScript type system.

## Verification

Use the pinned vanilla parser under `typescript/test/vanilla/`, never Labs' parser,
as the oracle. Add focused tests for source precedence, aliases, duplicate members,
snapshots, source spans and interruption before mutation. Preserve all native
diagnostic and compiled-data comparisons. Run the complete TypeScript suite,
including all 827 source comparisons, plus a bounded generated per-move sample.
The previous exhaustive runtime replay was expensive and is unnecessary as a gate
for this source-only slice; do not restart that unbounded extra run.
