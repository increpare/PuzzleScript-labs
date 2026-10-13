# CodeMirror 6 performance and fidelity report

## Outcome

This report records the conservative CM6 optimization pass completed on
2026-08-15. The result is substantially better than the pre-optimization CM6
editor for autocomplete, exact distant navigation, search/focus activity, and
heap use, while retaining PuzzleScript's stream parser and frozen CM5 layout.
It does not claim that every approved performance target passed:

- Installed Chrome passes the unthrottled 16.7 ms key and autocomplete p95
  targets. Installed Safari passes autocomplete but its 18 ms key p95 misses the
  16.7 ms target.
- Whole-document synchronous replacement remains about 22 ms in both browsers,
  so the required 2x improvement over pre-optimization CM6 did not occur. The
  faster reset-only experiment was rejected because it removed visible token
  decorations in both Chromium and WebKit.
- The final Chrome 4x CPU-throttled probe measured 21.800000190734863 ms key
  p95 and 14.5 ms autocomplete p95. Autocomplete therefore retains
  one-frame p95 headroom under throttling; key-to-paint does not.

Those misses are visible below and were not hidden by changing thresholds,
discarding samples, or measuring only the synchronous part of deferred work.

## Environment and method

The installed-browser captures ran on macOS 26.3, build 25D125, with Google
Chrome 151.0.7922.138 and Safari 26.3. The automated fidelity suite uses
Playwright 1.62.1 with its Chromium, Firefox, and WebKit projects. Edge was not
run, by explicit user direction, and is not a gate for this work.

The exact editor dependency pins are:

| Package | Version |
| --- | --- |
| `@codemirror/state` | 6.7.1 |
| `@codemirror/view` | 6.43.8 |
| `@codemirror/language` | 6.12.4 |
| `@codemirror/commands` | 6.10.4 |
| `@codemirror/search` | 6.7.1 |
| `@codemirror/autocomplete` | 6.20.3 |
| `@lezer/common` | 1.5.2 |
| `@lezer/highlight` | 1.2.3 |
| esbuild | 0.28.2 |
| gzipper | 7.2.0 |

The three benchmark inputs contain exactly 448 characters (representative
source), 432 characters (completion source including the typed key), and
129721 characters (large source). Every scenario uses 5 warmups followed by 20
recorded samples. Samples are sorted without mutating the collected array. The
median is the mean of the two middle samples and p95 is sample
`ceil(20 * 0.95) - 1`, zero-based, from that sorted copy. Each scenario restores
its source, cursor, focus, history, theme, viewport, and scroll state. Visible
settling includes semantic readiness, relevant DOM mutation, and the next paint;
it is not replaced with synchronous-only timing.

Chrome measurements use the installed Chrome channel at a 1280 x 900 viewport.
The optional headroom capture applies Chrome's public
`Emulation.setCPUThrottlingRate` command at exactly 4x. Chrome heap samples use
20 fresh pages per surface, explicit garbage collection, and
`Runtime.getHeapUsage`.

Safari keeps one WebDriver session for comparability. Each ordinary scenario is
one bounded asynchronous call. The exact distant-jump scenario records one
sample per bounded call in that same session; its five warmups run only before
the first of the exact 20 samples. Scripts use indexed `arguments[n]` because
Safari's WebDriver `arguments` object is not iterable. Before harness injection,
warmups, or samples, the runner activates Safari and waits up to 30 seconds for
`document.visibilityState` to be exactly `visible`. Both final JSON files report
`visible`. Generated CM5 and CM6 benchmark pages install the same error-capture
bootstrap before any product script. It records synchronous errors and unhandled
promise rejections from initial page load through the final sample. The runner
rejects a missing, malformed, or non-empty buffer; Chrome additionally merges
its native pre-navigation page-error listener. Both final buffers are empty.

## Installed Chrome timings

Values are exact committed JSON `median / p95` milliseconds.

| Scenario | Frozen CM5 | Pre-optimization CM6 | Optimized CM6 |
| --- | ---: | ---: | ---: |
| Key to next paint | 7.2500001192092896 / 8.799999952316284 | 10.950000047683716 / 11.599999904632568 | 8.899999856948853 / 10.099999904632568 |
| Autocomplete visible | 1.5 / 3.6000001430511475 | 58.300000071525574 / 59.19999980926514 | 6 / 6.899999618530273 |
| 100 API edits | 22.34999990463257 / 24 | 35.65000009536743 / 37.40000009536743 | 28.699999809265137 / 30.700000286102295 |
| Replace document, synchronous | 5.399999976158142 / 6.900000095367432 | 22.450000047683716 / 22.899999856948853 | 22.600000143051147 / 23 |
| Replace document, settled | 5.799999952316284 / 60.90000009536743 | 32.64999997615814 / 40.799999952316284 | 31.149999856948853 / 39.80000019073486 |
| Load, distant jump, exact style | 121.99999988079071 / 171.09999990463257 | 64.5 / 68.40000009536743 | 62.5 / 70.89999961853027 |
| Cursor, focus, and search settled | 4.75 / 65.89999985694885 | 57.35000002384186 / 60.5 | 11 / 11.400000095367432 |

The final optimized Chrome capture was written at
`2026-08-15T19:04:06.516Z`. Its 4x CPU capture, retained as diagnostic evidence
rather than a committed baseline, measured
20.84999990463257 / 21.800000190734863 ms for key-to-paint and
12.999999761581421 / 14.5 ms for autocomplete.

Chrome heap values are exact `median / p95` MiB:

| State | Frozen CM5 | Pre-optimization CM6 | Optimized CM6 |
| --- | ---: | ---: | ---: |
| Initial mount | 3.057697296142578 / 3.0577239990234375 | 3.933156967163086 / 3.9344215393066406 | 3.9125308990478516 / 3.912822723388672 |
| Large document | 5.18183708190918 / 5.18218994140625 | 7.948541641235352 / 8.0015869140625 | 6.796018600463867 / 6.7981414794921875 |

The optimized initial median is about 1.280x CM5 and the optimized large-source
median is about 1.312x CM5, both within the approximately 1.5x contract. Both
are also below their pre-optimization CM6 medians.

## Installed Safari timings

Values are exact committed JSON `median / p95` milliseconds.

| Scenario | Frozen CM5 | Pre-optimization CM6 | Optimized CM6 |
| --- | ---: | ---: | ---: |
| Key to next paint | 16 / 24 | 17.000000000000227 / 25 | 16.500000000000114 / 18 |
| Autocomplete visible | 5 / 6 | 66 / 69 | 8 / 9 |
| 100 API edits | 28.50000000000091 / 32 | 24 / 25 | 26 / 27 |
| Replace document, synchronous | 7 / 9 | 21.99999999999909 / 22 | 21.99999999999909 / 22.000000000003638 |
| Replace document, settled | 7 / 10 | 42.99999999999818 / 44.00000000000364 | 42.99999999999636 / 44 |
| Load, distant jump, exact style | 122.5 / 128 | 67 / 69.00000000000364 | 64.49999999999818 / 66 |
| Cursor, focus, and search settled | 12 / 13 | 60 / 62.000000000007276 | 17 / 19.000000000007276 |

The final optimized Safari capture was written at
`2026-08-15T19:07:20.137Z`. Safari's paint measurements are frame-quantized:
the optimized key median is 0.5 ms below the approximately 17 ms
pre-optimization median, and the p95 improves from 25 ms to 18 ms, but 18 ms
still fails the 16.7 ms contract. Relative to CM5, the optimized median is
0.5 ms slower while
the p95 is 6 ms faster. SafariDriver exposes no repeatable JavaScript heap API,
so no Safari heap result is claimed.

## Contract decisions

| Contract item | Result | Evidence |
| --- | --- | --- |
| Key-to-paint p95 below 16.7 ms | **Chrome pass; Safari fail** | Chrome 10.099999904632568 ms; Safari 18 ms. Structural dirty tracking avoids per-key document stringification and decoration identity tests reject unrelated rebuilds. |
| Ordinary autocomplete below 16.7 ms | **Pass** | Chrome 6.899999618530273 ms and Safari 9 ms p95. Native activation uses `activateOnTyping: true` and `activateOnTypingDelay: 0`; the fixed 50 ms normal path is gone. Chrome's 4x diagnostic also passes this threshold at 14.5 ms p95. |
| Exact distant jump materially faster than CM5 | **Pass** | Chrome median 121.99999988079071 to 62.5 ms; Safari 122.5 to 64.49999999999818 ms. Exact token-style assertions reject approximate state. |
| Whole-document synchronous replacement at least 2x faster than pre-CM6, with settled improvement | **Fail** | Chrome sync 22.450000047683716 to 22.600000143051147 ms and Safari changes from 21.99999999999909 to 21.99999999999909 ms; both are effectively unchanged. Chrome settled is 31.149999856948853 / 39.80000019073486 ms and Safari is 42.99999999999636 / 44 ms, but the required synchronous improvement did not occur. |
| Reuse token decorations for non-document activity | **Pass** | Identity tests cover cursor, selection, focus, search-panel activity, and completion selection. Chrome cursor/search median drops from 57.35000002384186 to 11 ms; Safari drops from 60 to 17 ms. Search Replace and Replace All remain document transactions. |
| Heap below pre-CM6 and approximately no more than 1.5x CM5 | **Pass** | Chrome optimized initial/large medians are 3.9125308990478516 / 6.796018600463867 MiB, below pre-CM6 and about 1.280x / 1.312x CM5. |
| Release-equivalent runtime plus plugins below 100 KiB Brotli | **Pass** | 100606 bytes after the release-equivalent Terser pass at Brotli text mode, quality 11; the limit is 102400 bytes. |

### Reset-path rejection

The benchmark-gated one-install reset path was removed before this report. Its
isolated Chrome medians were promising: 24.65 ms versus 5.15 ms synchronous and
32.15 ms versus 10.5 ms settled for the established two-operation path versus
reset. However, the reset made parser token decorations disappear in both
Chromium and WebKit. Visual correctness was an independent mandatory condition,
so that failure decisively rejected the reset before any Safari performance
claim. The production editor retains the established replacement-plus-history-
clearing path, and the report separately records that path's failed synchronous
and settled replacement contract rather than presenting the invalid reset
microbenchmark as a production win.

## CSS and layout decisions

`codemirror.css`, `midnight.css`, `dialog.css`, and `show-hint.css` are removed
from the production editor page and from the release `combined.css` input list.
They are not deleted: the frozen CM5 comparison page explicitly injects its
four-file stylesheet whitelist. A generated CM6 proof page explicitly injects
the same files so tests can blacklist each network response independently and
then all four together.

`midnight.css` was not treated as wholly obsolete merely because the mounted
dark editor looked correct. A selector audit found seven non-CM5 selector arms:
`:root`, `body`, the three `.nocolorlink` arms, `span.cm-SOUND`, and
`.systemMessage`. Their exact declarations are retained in `editor-theme.css`
and `console.css`; this preserves the pre-toolbar colour scheme, inherited
header-link behaviour, compilation-summary colour, and clickable sound styling
outside the editor. The original global sound declaration and ordering,
including its ignored `cursor: hand`, are retained verbatim. Every other
`midnight.css` selector is CM5-scoped. A unit audit enforces both that complete
classification and declaration equality.

After that minimal extraction, blacklisting each file and all four together
produced zero differing Chromium pixels for light, dark, syntax, active gutter,
wrapping, autocomplete, search/replace, dynamic colours, empty editor, full
page, and toolbar-selected default-dark surfaces. Numeric geometry remained
equal in Chromium, Firefox, and WebKit. Cross-engine static-load tests also
blacklist every individual file and the combined set before any product script
runs; they require root `light dark`, initial body `dark`, correct light/dark
system-message colours, no-colour inheritance, and outside-editor sound colour,
pointer cursor, underline, and click dispatch. Thus each removed production
link is independently irrelevant only after the audited PuzzleScript globals
are retained. The four frozen CM5 files total 19767 raw bytes, but only those
small application declarations remain on the production path.

CM6's default `lineWrapping` uses `white-space: break-spaces`, `word-break:
break-word`, and `overflow-wrap: anywhere`, while frozen CM5 uses `pre-wrap`,
`normal`, and `break-word`. The scoped CM6 line override restores the CM5 rules,
and `min-width: 0` lets the CM6 content flex child wrap rather than expand to its
min-content width. Cross-engine tests cover ordinary words, trailing-space
hanging, tabs, an unbroken 180-character token, caret row, and selection rows.
No CodeMirror internal CSS or JavaScript was patched.

The search-panel `previous` control uses the responsive scoped margin
`max(.6em, calc(100% - 33em))`. The earlier fixed 180px value matched the 720px
snapshot but forced an extra control row at a 640px editor. The responsive rule
matches CM5 panel geometry and discrete control rows at editor widths 720, 640,
and 550 pixels in Chromium, Firefox, and WebKit.

Installed Chrome reports root `light dark` and initial body `dark`, plus exact
CM5/CM6 editor root, 29px gutter, 16px line and
line height, font stack, wrapping rules, padding, tab size, wrapped-line size,
and search-panel geometry. Its autocomplete x/width are exact; the remaining
height difference is 0.0078125px and y differs by 0.5px. Installed Safari
reports the same exact root/body schemes and exact editor root, font, 16px line
height, line, gutter, wrapping rules,
611x256 wrapped line, and 640x90.6875 search panel. All visible search controls
have exact x/y/width/height; autocomplete x/width/height are exact and y differs
by 0.3125px. The internal CM5 scroll element is wider because CM5 implements
scrollbars with negative margins; visible content, gutter, wrap width, and root
geometry are the fidelity contract. CM6's scroller has no reserved horizontal
scrollbar width.

The installed Chrome snapshot runner sees 49 shell pixels differ from the
bundled Chromium 151.0.7922.34 golden because installed Chrome is patch
151.0.7922.138. Direct serial numeric/computed-style inspection passes, so the
difference is classified as a browser patch-version rasterization artifact.
Goldens and tolerances were not updated for it.

## Bundle and delivery evidence

CM5 had no single checked bundle. For an honest side-by-side artifact
comparison, its row is the concatenation of exactly the frozen editor-only
scripts loaded by the comparison page: CM5 core, panel, active-line, dialog,
searchcursor, search, match-highlighter, show-hint, anyword-hint, comment, and
`editor-cm5.js`. Shared PuzzleScript parser, completion data, and application
scripts are excluded from every editor row. The pre-CM6 row is the checked IIFE
at commit `a69c0216`. The optimized-IIFE row is the final artifact before the
source-ownership reorganization. The current development surface loads one
generated runtime followed by directly editable PuzzleScript plugins; the
release compiler still minifies those inputs into its single application
script.

| Editor artifact as checked/loaded | Raw bytes | Comparison-only gzip level 9 | Brotli text q11 |
| --- | ---: | ---: | ---: |
| Frozen CM5 editor script stack | 486750 | 125674 | 103286 |
| Pre-optimization CM6 IIFE (`a69c0216`) | 781124 | 184594 | 149497 |
| Optimized CM6 IIFE before the runtime/plugin split | 361152 | 116794 | 100479 |
| Current generated runtime + direct plugin sources | 398874 | 123552 | 106637 |

The historical Brotli values apply the same settings for comparison; neither
historical surface was delivered that way. The raw comparison also reflects an
important packaging difference: CM5 and the current PuzzleScript plugins are
readable sources, whereas the generated runtime and the earlier optimized IIFE
are esbuild-minified. The current raw row is the exact development script stack,
not the release representation.

For the historical minified-plus-gzip comparison, all three inputs were also
run through the repository's pinned Terser 5.17.1 defaults before compression:

| Terser-normalized editor artifact | Minified raw bytes | Gzip level 9 | Brotli text q11 |
| --- | ---: | ---: | ---: |
| Frozen CM5 editor script stack | 215084 | 69724 | 60919 |
| Pre-optimization CM6 IIFE (`a69c0216`) | 354100 | 112504 | 96507 |
| Optimized CM6 IIFE before the runtime/plugin split | 359934 | 114471 | 97997 |
| Current runtime + plugins, release-equivalent Terser pass | 371095 | 117330 | 100606 |

This normalized table preserves the approved historical comparison: CM5 is
about 68.1 KiB gzip and pre-CM6 is about 109.9 KiB. It also shows that the
optimized runtime is not smaller than CM5 and is slightly larger than pre-CM6
under the release-equivalent Terser pass. The production win is a deterministic,
sub-100-KiB editor payload and clearer source ownership, not a claim of beating
CM5's size.

The final release `combined.css` is 16519 raw bytes, 3906 bytes at comparison
gzip level 9, and 3345 bytes at production Brotli text quality 11.

The reorganized release retains every raw original, generates no `.gz` files,
and produces 208 `.br` sidecars. `npm run verify:release-compression` decompressed
every sidecar and compared it byte-for-byte with its original. The checked
runtime's SHA-256 is
`655bb52e6c3ff81a31b7b723f7f6c0a0235574a338f4c1212727e4cef4fb936f`;
its source map is
`69390bf1a14197256e0d608d33ed1fdd4525dfd0b3b209274333c64be30e2d8e`.
The release-equivalent runtime-plus-plugin payload is 100606 bytes at Brotli
quality 11 with SHA-256
`2b1b5acbf048b6b42dec8c62bda1265df8169240572462604b6ee66c37e2219c`
before compression. The copied generated runtime has a 94496-byte Brotli
sidecar. The unchanged standalone source is
`dd6128b1f53c01ea9f3a399c57c7e296f1a2e5e2d9a9fd56ead99e795501d203`.
The generated runtime ends with a matching
`sourceMappingURL=codemirror6-runtime.js.map`; the build regression parses that
linked map, checks its source/content arrays, verifies the runtime entry point,
and proves directly editable plugins are absent from the generated graph.

A fresh isolated real Apache 2.4.62 smoke test against this final release, with `mod_rewrite`, `mod_mime`,
`mod_headers`, and `mod_negotiation`, verified JavaScript, CSS, HTML, and text
responses. Requests that accept Brotli received byte-equivalent compressed bodies with
`Content-Encoding: br`, the original MIME type, and `Vary: Accept-Encoding`.
Identity requests, `br;q=0`, substring lookalikes, and a resource whose sidecar
was deliberately absent fell back to the uncompressed original. Build number
1838 was preserved byte-for-byte.

## Parser architecture

`codeMirrorFn` remains PuzzleScript's sole tokenizer/parser, running through
CM6's public `StreamLanguage` compatibility layer. The Lezer packages above are
CM6 support libraries, not a PuzzleScript grammar. There is no generated or
handwritten alternative grammar, regex highlighter, worker parser, or second
parser-state index.

CM6 exclusively owns its checkpoint placement, reuse, invalidation, and
scheduling. PuzzleScript does not change checkpoint frequency. Exact-prefix
consumers advance from CM6's safe state and never accept approximate parser
state. The separate compatibility rollback snapshot remains only for a logical
line longer than CM5's 10000-character stream-highlighting cutoff, preventing a
partially consumed pathological line from mutating the state of following
lines. Ordinary lines do not create that extra snapshot.

## Verification record

The final gate intentionally excludes Edge. The user-owned malformed line in
`src/tests/codemirror6/candidate-page.test.mjs` remains untouched and unstaged;
it prevents the aggregate `npm run test:codemirror` parser from starting. The
same unit suite is therefore also run with only that protected file excluded,
without changing or copying its contents.

- `npm run build:codemirror`: passed.
- `npm run check:codemirror`: passed byte-for-byte.
- `npm run test:codemirror`: expected non-product failure at the protected
  malformed candidate test; its localhost deadline test also receives
  `listen EPERM` inside the filesystem sandbox. With only the protected file
  blacklisted and localhost binding allowed, the reorganized suite passed
  197/197.
- `node src/tests/run_tests_node.js`: passed 750/750 with 0 failures and 0
  errors.
- `npm run test:codemirror-browser`: passed 149 with 55 intentional
  baseline-only/engine-specific skips across Chromium, Firefox, and WebKit.
- Release compilation: passed at preserved exact four-byte build number `1838`
  with the generated runtime and direct plugins folded into the same single
  application script.
- `npm run verify:release-compression`: passed all 208 Brotli sidecars, with no
  gzip sidecars.
- Fresh isolated Apache 2.4.62 HTTP smoke: passed negotiation, MIME, `Vary`,
  identity/q=0, and missing-sidecar fallback contracts.
- Installed Chrome and Safari: final performance JSON reports visible foreground
  state and the generated pre-product bootstrap observed no page errors from
  initial navigation through the complete warmup/measurement window; direct
  product geometry inspection passed as described above.
- Runtime/plugin-boundary follow-up (historical baselines unchanged): two
  error-free Chrome diagnostics retained the 8.9 ms key median with 14.7 and
  13.1 ms p95, both below 16.7 ms; autocomplete and document operations were
  neutral or faster and heap movement was noise-scale. One error-free Safari
  diagnostic measured key 18/23 ms and autocomplete 6/11 ms, retaining the
  documented Safari key miss while other scenarios were neutral or faster
  within frame-scale variation. A second Safari attempt timed out in
  SafariDriver and was excluded from the evidence.
