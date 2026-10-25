# Object and Layer Lexical Names Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then independent spec and quality review. Continue in the vanilla port worktree
> after source-rule syntax recovery is reviewed.

**Goal:** Close the known Unicode primary-name dependency before further source
rule compilation, preserving authored words and precise native name membership.

**Architecture:** Apply the existing whole-line lowercase/authored-range mapping
to object headers and collision-layer names. Keep authored words separate from
effective lexical name values, just as legend and rule lexical views do. Resolve
language identities from those lexical values, retaining canonical object and
source provenance identities.

**Tech Stack:** Strict TypeScript, SourceLexicalToken, lowercaseSourceView,
existing declaration/game-data/syntax native oracles.

## Files and contract

- Add `definitionNames: readonly SourceLexicalToken[]` to `SourceObject` and
  `SourceCollisionLayer` in `typescript/src/source-model.ts`.
- Produce those names in `typescript/src/source-reader.ts` with the mapped
  whole-physical-line lowercase view. Preserve authored `primaryName`, `aliases`,
  layer `names`, physical text, comments and spans. The first effective object
  name is the concrete primary; later names are object aliases.
- Use lexical values/words in `typescript/src/declarations.ts` for concrete name
  registration, aliases, accepted-name evidence and layer lookup. Keep all prior
  source-order, duplicate, namespace and ownership recovery contracts.
- Update native source/declaration test projections to check lexical identity
  separately from authored normalization. A lexical name need not equal its
  SourceWord.normalized value. Provenance must still point to the exact authored
  word attached to that lexical token; do not weaken canonical identity checks.
- Add `typescript/test/unicode-object-names.test.mjs` with native-backed source,
  declaration, game-data and rule-syntax comparisons.

Object primary lexing accepts a Unicode letter/number/underscore prefix of the
lowercased physical line. Midline aliases accept non-whitespace/non-parenthesis
text. Generated lowercase units may therefore become a primary suffix alias.
Layer names are the Unicode letter/number/underscore runs native recognizes on
that lowercased view, with the same original source mapping.

## Test-first sequence

- [x] Reproduce the known object named `İ` (U+0130): native creates concrete `i`
  and combining-dot alias U+0307, while the current resolver creates `i`+U+0307
  as one concrete name. Observe native-backed failure before implementation.
- [x] Reproduce primary `ΟΣ'Α`: native concrete name is `οσ`, using whole-line
  casing context, whereas the raw authored prefix `ΟΣ` normalizes to `ος`.
- [x] Add lexical header/layer fields and compute values through the existing
  mapping helper. Keep SourceWord's law `normalized===spelling.toLowerCase()`.
  Reuse existing authored word identities for equal spans; generated partial
  lexical tokens may share one complete authored code-point span.
- [x] Update resolver registration and layer iteration to use `token.value` for
  names and `token.word` for provenance/diagnostics. Keep first accepted keys,
  last namespace definitions, alias promotion, layer order and duplicates.
- [x] Strengthen source/declaration oracle identity checks to inspect lexical
  source tokens. Compare all478 existing simulation source/declaration/game-data
  fixtures unchanged. Preserve312 source-fixture span checks and all790 actual
  compiler-input lexical comparisons.
- [x] Test stable astral names, Greek context across punctuation/comments,
  explicit ASCII aliases, duplicate names, repeated layer assignments and
  expansion within a layer name. Use ordinary ASCII map aliases to isolate
  declaration semantics; separately verify the generated combining-dot alias.
- [x] Re-run the exact pending syntax fixture in
  `test/repros/legend-unicode-expansion-report.txt`: replace Player→İ, Crate→𐐀,
  Wall→ΟΣ throughout movementSource with
  `[ > İ | ^ 𐐀 | v ΟΣ ] -> [ İ | 𐐀 | ΟΣ ]`.
  Native must ignore unknown rule token `i`+U+0307 and preserve pending-qualifier
  recovery and invalid-cell-count outcome; matching declarations must now make
  the independent syntax pass agree. Do not add its unknown full token as a name.
- [x] Add focused provenance/canonical-identity corruption checks where new
  lexical values differ from authored normalization. Freeze the authored AST and
  retain native producer guards in all candidate comparisons.
- [x] Run strict build, new Unicode tests, source/declaration/game-data/syntax
  focused suites and full npm test. Do not rerun the long gameplay corpus or edit
  native source/hash files. If a separate reader grammar recovery gap appears,
  report the exact native case before expanding this bounded task.
- [x] Obtain spec then quality approval; update the repro report/README from
  pending to fixed for these specific cases and commit the bounded change.

This repairs an established upstream declaration dependency of rule syntax. It
does not replace the later full compiler-diagnostic acceptance gate.

Reviewed implementation: `d8d349cf`, README correction `ae8b3c47`. Spec and
quality reviews pass; strict build and all 901 package tests pass. Focused Unicode
coverage contains 22 native-backed cases. No native sources or hashes changed.
