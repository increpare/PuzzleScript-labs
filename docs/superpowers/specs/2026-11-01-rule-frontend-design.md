# One authoritative rule parse

The TypeScript reference currently interprets each rule twice: `source-rules.ts`
builds an authored tree, then `rule-syntax.ts` tokenizes the physical line again
and builds the tree used by compilation. The two recovery grammars disagree.
The approved first frontend change removes this overlap before tackling the
declaration work still embedded in `source-lexical.ts`.

## Boundaries

`rule-lexing.ts` scans a rule's captured source once, preserving authored words,
effective lowercase values, UTF-16 spans and the vanilla comment capture. It
also owns the explicitly documented legacy message cursor. Token values and
authored spellings remain distinct for Unicode casing.

`source-rules.ts` parses those tokens once into the rule stored in the source
document. Rows, cells, terms and commands are authoritative for compilation.
The complete token stream retains malformed or unconsumed evidence; a second
authored grammar is unnecessary. Recovery distinguishes a retained errored rule
from a discarded rule, and records the compilation-abort condition separately.

The parser receives an explicit contextual vocabulary: final accumulated SOUNDS
name registrations and accepted sound-event names. This is a PuzzleScript
grammar dependency, not object/property resolution. Existing per-line name
registrations remain solely for comment/message scanning. Later SOUNDS headings
can affect earlier rules, so grammar parsing uses the completed context.

`rule-syntax.ts` consumes the parsed tree and reports its issues at the existing
Rules checkpoint. It projects source terms/commands to domain enums without
scanning text or recognizing brackets again. The supplemental duplicate-property
warning depends on the final resolved property namespace, including promoted
aliases; one explicit conditional note preserves its position in issue order.

Expansion and lowering retain their existing pass order. Neither the JS engine
nor the pinned vanilla oracle changes. Source rule identity and spans continue
through executable-rule mappings.

## Compatibility and scope

Preserve rule grouping against the last retained ordinary rule, malformed bracket
recovery, late-movement suppression, diagnostic text/order/counts/caps, Unicode
normalization and message cursor quirks. Reader-only assertions describing the
old alternate grammar must instead assert authoritative recovery and raw evidence.
Do not relax native comparisons to accommodate a candidate change.

This slice does not claim the whole source frontend is clean. Declaration lookup,
legend expansion and layer validation remain entangled in the lexical walker;
their extraction is the next independent slice.

## Validation

Add boundary tests showing compilation consumes the parsed structure without
reading raw rule text, preserves term/command provenance and defers the property
note until resolution. Run canonical lexer and grammar oracle tests, all 335
compiler fixtures and all 492 simulation sources, then the complete TypeScript
suite and a bounded generated differential campaign. No browser/UI tests belong
in this repository.
