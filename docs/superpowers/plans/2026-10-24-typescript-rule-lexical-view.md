# Rule Compiler Lexical View Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> followed by independent spec and quality reviews in the vanilla port worktree.

**Goal:** Derive precise compiler token values and message payloads while keeping
the authored rule AST unchanged.

**Architecture:** Generalize the existing lowercase-to-authored-offset map to an
explicit source range. A small rule lexical module scans that lowercased range
and returns `SourceLexicalToken` values linked to authored `SourceWord` evidence.
An explicit message compatibility helper preserves native cursor behavior.

**Tech Stack:** Strict TypeScript, UTF-16 source spans, direct character scanning,
the existing pinned native host for test-only comparisons.

## Files and contracts

- Modify `typescript/src/source-text.ts` with
  `lowercaseSourceRange(line: SourceLine, start: number, end: number): LowercaseSourceView`.
  Its `authoredRanges` contain original line offsets, not range-local offsets.
  Lowercase the entire selected substring; per-code-point lowercase supplies only
  output length. Refactor existing `lowercaseSourceView` through the shared map
  while preserving its whole-physical-line-then-comment-mask behavior.
- Create `typescript/src/rule-lexing.ts` with these operations:

```ts
export function compilerRuleTokens(source: SourceRule): readonly SourceLexicalToken[];
export function compilerMessagePayload(
  source: SourceRule,
  tokens: readonly SourceLexicalToken[],
  messageIndex: number,
): string;
```

- Add `typescript/test/rule-lexing.test.mjs` for native-backed lexical comparisons,
  source immutability, Unicode offsets and message recovery.
- Add explicit effective full compiler-line text to `SourceRule`, produced by
  the independent reader. The native parser passes the authored line on ordinary
  entry, but an already lowercased line when it reenters after a leading comment
  or a multiline-comment resume. Keep the authored `originalLine` unchanged.

`compilerRuleTokens` uses `legacyCapturedSpan` as the selected range. Its values
must match native `tokenizeRuleLine(source.legacyCapturedText)` exactly. Brackets,
pipes and `->` delimit tokens without requiring whitespace; only the first
non-whitespace `+` is split from an adjacent word. `>Player` remains one token.
Use native ECMAScript whitespace semantics. Preserve token order and duplicates.
Each token's word covers the complete authored code points that produced its
normalized units. Preserve `word.normalized === word.spelling.toLowerCase()`;
`token.value` is the independent compiler identity.

`compilerMessagePayload` searches each token value through the effective full
compiler line lowercased as a whole, in order through `messageIndex`, then slices
that effective line at the normalized cursor and trims. Return one space for an empty
payload. This intentionally reproduces the native cursor mismatch when lowercase
expands a code point. Keep the source AST's authored payload unchanged.

## Test-first sequence

- [x] Write a failing import/API test and observe failure before implementation.
- [x] Add range mapping cases for nonzero authored offsets, dotted capital I,
  astral letters, and contextual sigma at a selected-range boundary. Verify
  authored slices/spans and all mapped normalized units.
- [x] Add the shared range map and preserve all existing legend Unicode tests.
- [x] Compare scanner values with native for adjacent brackets/pipes/arrows,
  `+right`, `++right`, repeated prefixes, `>Player`, whitespace variants and
  Unicode. Test the capture contracts explicitly:
  `[ Player ] (comment) -> [ Player ]`,
  `(comment) [ Player ] -> [ Player ]`,
  ` (comment) [ Player ] -> [ Player ]`, and
  `[ Player ] -> message Hello (literal)`.
- [x] Implement the scanner directly over the normalized range. Do not transform
  or replace `SourceRule.tokens`, `.terms`, raw text, spans or authored payloads.
- [x] Compare message payloads with native `findIndexAfterToken` and original
  substring extraction for literal parentheses, mixed case, empty text and
  `İİ [ Player ] -> message HELLO`. The last case must produce compiled `ELLO`
  while the authored AST still preserves `HELLO`.
- [x] Compare captured text and effective full-line text against actual native
  parser tuples, not values projected from the candidate. Compute expected
  payloads from native tuple[2]. Include leading/nested/multiple comments,
  whitespace before comments, multiline-comment resume and Unicode composition.
  `(comment) [ Player ] -> message HeLLo` compiles `hello` while retaining authored
  `HeLLo`. Reusing the authored line on both sides hides this recovery behavior.
- [x] Run a candidate call with native token/payload producer functions replaced
  by throwing guards. Validate every returned token's authored evidence, and
  compare all rules retained by the reader from the 478 simulation and 312
  compilation sources. Freeze input ASTs during comparisons.
- [x] Run strict build, new lexical tests, source reader/oracle tests and legend
  Unicode tests, then the full package suite. Do not rerun standalone gameplay
  replays or modify native source/hash files for this lexical-only task.
- [x] Obtain spec then quality review and commit the bounded implementation.

The next task consumes these tokens with a small syntax recovery reducer. It must
not assume that authored `SourceRule.terms` are the compiler's recovered terms,
or that an invalid authored rule is automatically discarded.

Implemented in `ccfd4b42`, with actual-parser casing/oracle correction in
`52b48355`. Strict build and all 724 package tests pass. Spec and quality review
approved the corrected stage; fresh focused checks passed 96 and 89 tests,
respectively. Actual native inputs cover all 790 fixtures, 20,226 rules, 335,458
tokens and 1,082 message positions. Native source and hash manifest are unchanged.
