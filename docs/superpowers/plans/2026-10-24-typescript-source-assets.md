# Source Sprites and Colors Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> followed by parent-managed spec then quality review. Work after the source rule
> compiler is reviewed. Do not dispatch additional agents from this task.

**Goal:** Compile authored sprite/color data into explicit appearances, retaining
vanilla's palette selection, pixel values, recovery and diagnostic order.

**Architecture:** Static named palette tables are ordinary data. Object sprites
and display colors compile separately because native visits them at different
points. Keep authored words/rows unchanged and represent any effective lexical
recovery with source-linked tokens. No canvas, image cache, JS producer, bitmask
or generated operation belongs in the candidate.

**Tech Stack:** Strict TypeScript, canonical GameObject keys, arrays, Maps,
numeric enum tags, SourceDocument and independently decoded native asset data.

## Files and API

Create `typescript/src/colors.ts` with static copies of the 14 official palette
tables and their numeric aliases from pinned `src/js/colors.js`. Preserve exact
hex spelling/case, all grey/gray aliases and table values. Export ordinary typed
lookup/validation functions shared by the two asset operations below. Do not
import, evaluate or generate native source at runtime.

Create `typescript/src/source-assets.ts` with this public shape:

```ts
export enum SpritePixelKind { Transparent, Color, Invalid }
export type SpritePixel =
  | { readonly kind: SpritePixelKind.Transparent }
  | { readonly kind: SpritePixelKind.Color; readonly color: number }
  | { readonly kind: SpritePixelKind.Invalid };
export interface ObjectSprite {
  readonly colors: readonly string[];
  readonly pixels: readonly (readonly SpritePixel[])[];
}
export interface ColorPalette {
  readonly name: string;
  readonly colors: ReadonlyMap<string, string>;
}
export function compileObjectSprites(
  document: SourceDocument, declarations: ResolvedDeclarations,
): {
  readonly palette: ColorPalette;
  readonly sprites: ReadonlyMap<GameObject, ObjectSprite>;
  readonly diagnostics: readonly SourceDiagnostic[];
};
export function compileDisplayColors(
  document: SourceDocument, palette: ColorPalette,
): {
  readonly backgroundColor: string;
  readonly textColor: string;
  readonly diagnostics: readonly SourceDiagnostic[];
};
```

Add `Assets` to SourceDiagnosticPhase without changing existing enum values.
SourceSpan must remain a valid authored location. Add optional
`readonly reportedLine?: number | null` to SourceDiagnostic for explicit native
display locations: absent means span?.start.line ?? null, zero means the native
line-zero diagnostic, and null explicitly means no reported line. Palette errors
use span=null and reportedLine=0; never manufacture an invalid line-zero span.
Sprites are keyed by actual authored canonical objects from objectSources. An
orphan has no independent authored appearance; do not invent or claim a browser
rendering interpretation for it.

If effective colors or sprite rows need extra source data, add source-linked
definition tokens beside the existing authored values in `source-model.ts` and
populate them in `source-reader.ts`. Preserve colors, spriteRows, row text, glyphs
and spans as authored evidence. Native parser acceptance is the authority for
effective inputs. Do not reinterpret all invalid authored glyphs as pixels or
silently feed invalid color words to the later compiler.

Add `typescript/test/legacy-source-assets.cjs` and
`typescript/test/source-assets.test.mjs`. The independent native producer parses
original text, captures the raw objects/palette metadata, then invokes actual
generateExtraMembers and formatHomePage at their proper boundaries. Retain raw
diagnostics separately from parser diagnostics. Keep pinned hashes and reject
unknown semantic fields at each projection boundary.

## Palette selection and object compilation

- Start with arnecolors. Visit every color_palette metadata entry in source order;
  resolve numeric aliases before selecting a table. An unknown palette reports
  the native error at line zero. Despite its wording about defaulting, it leaves
  the previously selected valid palette unchanged. Test valid, invalid, valid
  repetitions explicitly; metadata's final-value Map alone loses this behavior.
- Named colors use the chosen table; valid 3/6-digit hex and transparent retain
  their effective spelling. Native validation trims values and accepts hex
  case-insensitively. A compiler-stage invalid color reports at object name line
  plus one and substitutes #ff00ff. Empty accepted color lists report at the
  object's name line and become [#ff00ff]. More than ten accepted colors reports
  before per-color validation and retains the list.
- Visit objects in native dictionary order, using canonical declaration evidence.
  Preserve all diagnostic messages, severity, physical line and countsAsError.
  Keep raw pass diagnostics; global deduplication and whole-compiler error caps
  remain the later integration task.
- A missing sprite becomes a 5-by-5 solid color-zero sprite. A present sprite
  first checks exactly five accepted rows of length five and warns otherwise.
  Native then produces a square whose width AND height are the accepted row
  count. Preserve this malformed-source behavior visibly with ordinary loops.
- Dot becomes Transparent, an accepted digit becomes Color with that numeric
  index, and a missing/non-numeric character visited by the native square becomes
  Invalid. This explicitly represents native NaN without hidden numeric sentinels.
  A digit outside the object's palette remains that color index; parser diagnostic
  parity is separate from the later numeric matrix compilation.
- Effective parser recovery needs focused native checks: invalid color chunks,
  adjacent color matches, whitespace/comments, oversized sprite rows and text
  discarded after sprite junk. Do not assume authored row text equals accepted
  native row text. If a malformed primary declaration exposes a separate reader
  recovery dependency, provide a bounded reproducer and coordinate that dependency
  before claiming whole malformed-source parity.

## Display colors

- Use the last accepted background_color and text_color metadata values. Convert
  known names through the selected palette, retaining valid raw hex/transparent.
  Defaults are exactly #000000 and #FFFFFF.
- Native validates text first, then background. Invalid values report its exact
  message at the metadata line and restore the corresponding default.
- Return values and diagnostics only. Browser DOM styles, link coloring, homepage
  URL stripping and session flags do not belong in this operation. Existing
  compileGameData already handles homepage/session values.

## Test-first sequence

- [x] Write a native-backed missing API test, run
  `node --test test/source-assets.test.mjs`, and observe the missing export failure.
- [x] Compare all 14 palettes, numeric aliases and exact values against independent
  native tables. Cover selected/repeated/unknown palettes, named/hex/transparent
  colors, default sprites and multiple authored objects.
- [x] Add raw lexical input comparisons for malformed colors and sprite rows;
  preserve authored evidence while comparing effective native inputs independently.
- [x] Cover missing colors, too many colors, color-zero defaults, transparent
  pixels, out-of-range digits, short/long/too-few/too-many rows and Invalid pixels.
  Assert exact ordered raw asset diagnostics at both compilation boundaries.
- [x] Cover foreground/background defaults, selected palette conversion, repeated
  metadata, invalid values, text-before-background errors and exact source lines.
- [x] Freeze source, declarations and palette data. Check canonical object keys,
  no mutation, no sprite for the orphan and complete native producer guards.
  Corrupt palette selection, a pixel, default dimensions and diagnostic order
  independently and ensure each meaningful comparison fails.
- [x] Compare every object appearance and display color in all 478 original
  simulation sources with native producers disabled during candidate compilation.
  Report counts and any explicit malformed recovery boundary without claiming
  the later whole-compiler 312-fixture diagnostic gate.
- [x] Run strict build, focused reader/declaration/data/asset suites and full
  `npm test`. Check whitespace and unchanged native hashes. Self-review and commit
  only owned files; parent obtains spec then quality approval.

## Reviewed checkpoint

Implementation through `20bda849` passes independent spec and quality reviews.
The final exact build passes all 1,443 package tests and 358 affected checks.
All 478 sources match 12,196 appearances, 304,900 pixels and 22,867 colors, with
three raw asset diagnostics and zero display diagnostics. All 293 existing
compilation sources that return a native state also pass asset and game-data
comparisons: 3,090 appearances, 77,250 pixels and eight asset/two display issues.
Both reviewers freshly rebuilt, ran focused tests and reproduced that 293-source
audit. All 21 pinned hashes and whitespace checks pass; native JS is unchanged.

Next: whole-source assembly and ordered diagnostic collection, standalone
source-to-trace operation and the final source-compiled session corpus gate.

## Existing-fixture recovery evidence

Parent's parser-only accepted-object audit across all 312 existing compilation
fixtures found two source-data differences, saved in
`/private/tmp/puzzlescript-compiler-object-recovery-audit.json`. This audit does
not apply loadFile's error cap and is not a whole-compiler parity claim.

- `Unknown junk in spritematrix`: authored Wall row `11A11` is accepted by native
  only through `11`, then the rest of that line is discarded. Full parser traversal
  has one error and does not hit the cap. This is a concrete existing fixture for
  effective pixel tokens beside unchanged authored glyphs.
- `cake monster`: invalid colors and repeated primaries cause further parser-only
  differences. Actual loadFile stops after its sixth error at line 30, column 6,
  before assets compile. Preserve the earlier token checkpoint when integrating
  diagnostics; do not add asset behavior for unreachable later declarations merely
  to match a parser-only traversal that bypassed this guard.

## Review recovery dependencies

Independent review found two reached input differences, now covered by native-backed
regressions. Leading junk followed by a midline comment can resume the previous
sprite row; its existing length controls oversized-row discard. An unmatched close
before a metadata key consumes logical SOL, preventing registration. Shared
`leadingContent` evidence and explicit `SourceMetadata.accepted` keep those inputs
separate from unchanged authored records. Assets and game data must use the same
accepted metadata view. The source-text and source-game-data files are included
in the necessary implementation scope.

A further confirmed row boundary requires stopping immediately when the fifth
accepted pixel completes the fifth accepted row. Any remaining same-line tokens
are native object aliases, rather than more sprite pixels. Four `00000` rows and
a fifth `000000` row therefore produce a 5-by-5 sprite and an alias `0` of the
object. Actual loadFile reaches assets with zero errors. Preserve the full authored
last row and source-linked alias evidence; verify alias lookup in declarations,
levels and rules rather than merely truncating the pixel list. Evidence is saved
in `/private/tmp/puzzlescript-fifth-sprite-row-completion-audit.json`.

That suffix alias also leaves native object reading awaiting a color line. With
no intervening blank and `Blue` on the next physical line, the existing object's
accepted colors gain blue. Actual loadFile again reaches assets with zero errors.
The bounded source is in
`/private/tmp/puzzlescript-source-assets-suffix-color-continuation.json`. Handle
this reached state dependency in the assets pass, using named object-reading
parts and an ordinary working sprite buffer as needed. Check the directly related
new-sprite/new-primary/blank transitions, preserving prior authored evidence and
native accepted appearances. A small source-objects helper is allowed if it makes
those responsibilities clearer. This does not authorize a whole diagnostic parser
or unrelated grammar expansion.

The independent whole-source parser work will handle literal title/author/homepage
casing after leading comments; it does not affect lowercased asset color inputs.
