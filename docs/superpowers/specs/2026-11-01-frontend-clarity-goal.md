# Frontend clarity completion checklist

This goal covers the TypeScript lexer, parser and compiler as a whole.
Completing one refactor or matching the existing corpus is progress, not proof
that the entire frontend is now a pleasant conceptual reference implementation.

The implementation must preserve vanilla behaviour through its pinned native
oracle, source evidence and canonical identities, while removing duplicated
interpretations, optimizer machinery and representations that obscure meaning.
Use ordinary objects, arrays, sets, direct control flow and numeric discriminated
types. Collision layers remain unnamed.

## Required end state

- [x] One accepted declaration construction flows from source registration into
  canonical object construction and final name normalization. The compiler does
  not reconstruct acceptance or source-time member expansion from source words.
  Accepted object assets are per-primary rather than shared authored-container
  fields. Evidence: the accepted-declarations audit and 1,964-test full run.
- [x] Each grammar construct has one authoritative recovered interpretation.
  Rules, sounds and win conditions carry their recovered definitions directly
  into compilation. Raw sound/win word grammars and pseudo-semantic mirrors are
  removed. Authored-invalid evidence remains available. Evidence: sound/win audit,
  raw-read/tree-consumption contracts, native comparisons and 2,045-test full run.
- [x] Scanner modes and their transitions are named, section-specific states.
  Shared `tokenIndex` values such as -4/-1/0/1/2 and section-enum arithmetic no
  longer stand in for unrelated language concepts. Evidence: the scanner-state
  audit, native recovery comparisons, negative type contracts and 1,998-test run.
- [x] Property layer analysis distinguishes layered, unlayered, nonlocal,
  unresolved and empty cases explicitly. Properties carry alternatives and their
  required analysis in one record; the separate present-undefined map is removed.
  Evidence: strict type/semantic checks, independent status corruption controls,
  the property-layer audit and 2,055-test full run.
- [x] Rule-pass input/output types express the actual guarantees of orientation,
  movement expansion and property resolution. Lowering handles valid qualifiers
  exhaustively instead of silently treating unsupported ones as no movement.
  Movement validity is a discriminant; property/spawn/duplicate passes preserve
  the narrowed domain. Explicit covariance is checked through nested collections
  and helper compositions. Evidence: rule-pass audit and 2,062-test full run.
- [x] Each retained frontend transformation is justified by observable language
  behaviour, ordering or diagnostics. Optional optimizer shortcuts are removed;
  native representation quirks are confined to named compatibility boundaries.
  Evidence: FRONTEND.md inventory, four independently native-validated source
  witnesses with separate behavioral counterfactuals, and exact contradiction
  warning/accepted-schedule comparison.
- [x] Documentation describes the actual data flow and remaining exceptions.
  An independent final audit finds no outstanding issue against these criteria.
  Both the whole-frontend audit re-review and fresh completion review approved;
  final strict suite: 2,114 passed; bounded sample: 128 games/919 observations.

## Current evidence and scope

Current production frontend code has no bitsets, packed cell arrays or generated
matchers. The accepted-definition paths, explicit states/domains and semantic
transformations above are implemented and independently audited. Final cleanup
also removes duplicate metadata acceptance, the false message mirror, the sound
index assertion and private NaN failure state. The completed evidence lives in
`plans/2026-11-01-final-frontend-audit.md`; these are behavior/model changes rather
than module splitting alone.

The existing local prepared-AGAIN runtime cache belongs to separate work and sits
outside this frontend scope. Preserve it during this goal; do not remove unrelated
user changes under a broad interpretation of deoptimization.

## Verification policy

Run focused semantic and negative type checks for each boundary, then the complete
TypeScript suite with all pinned parser/compiler source comparisons and a bounded
generated per-move sample. Keep native producers and comparisons independent.
Do not restart the expensive optional exhaustive gameplay replay without a new
reason. Tests prove behaviour over their covered cases; readability and separation
also require inspection of the current implementation against this checklist.
