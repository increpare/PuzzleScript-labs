# Frontend clarity completion checklist

The active goal covers the TypeScript lexer, parser and compiler as a whole.
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
- [ ] Each grammar construct has one authoritative recovered interpretation.
  Rules already have this boundary; sounds and win conditions still need it.
  Authored-invalid evidence remains available without becoming a second grammar.
- [ ] Scanner modes and their transitions are named, section-specific states.
  Shared `tokenIndex` values such as -4/-1/0/1/2 and section-enum arithmetic no
  longer stand in for unrelated language concepts.
- [ ] Property layer analysis distinguishes layered, unlayered, nonlocal and
  unresolved cases explicitly rather than using Map presence plus undefined.
- [ ] Rule-pass input/output types express the actual guarantees of orientation,
  movement expansion and property resolution. Lowering handles valid qualifiers
  exhaustively instead of silently treating unsupported ones as no movement.
- [ ] Each retained frontend transformation is justified by observable language
  behaviour, ordering or diagnostics. Optional optimizer shortcuts are removed;
  native representation quirks are confined to named compatibility boundaries.
- [ ] Documentation describes the actual data flow and remaining exceptions.
  An independent final audit finds no outstanding issue against these criteria.

## Current evidence and scope

Current production frontend code has no bitsets, packed cell arrays or generated
matchers. Source-time declaration types and the single rule grammar are already
in place. Major remaining work is listed above; mere module splitting is not a
substitute for those changes.

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
