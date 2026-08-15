# CodeMirror 6 performance and fidelity report

## Outcome

This report records the conservative CM6 optimization pass completed on
2026-08-15. The result is substantially better than the pre-optimization CM6
editor for autocomplete, exact distant navigation, search/focus activity, and
heap use, while retaining PuzzleScript's stream parser and frozen CM5 layout.
It does not claim that every approved performance target passed:

- Installed Chrome passes the unthrottled 16.7 ms key and autocomplete p95
  targets. Installed Safari passes autocomplete but its 19 ms key p95 misses the
  16.7 ms target.
- Whole-document synchronous replacement remains about 22 ms in both browsers,
  so the required 2x improvement over pre-optimization CM6 did not occur. The
  faster reset-only experiment was rejected because it removed visible token
  decorations in both Chromium and WebKit.
- The final Chrome 4x CPU-throttled probe measured 26.09999990463257 ms key p95
  and 17.699999809265137 ms autocomplete p95. It therefore demonstrates useful
  behavior under throttling, but not a one-frame p95 headroom pass.

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
`visible`. Chrome's empty page-error array covers navigation through measurement.
Safari attaches its listener after the editor mount/foreground checks and before
harness injection, so its empty array covers every warmup and measured sample,
not earlier page initialization; mount failure is checked separately.

## Installed Chrome timings

Values are exact committed JSON `median / p95` milliseconds.

| Scenario | Frozen CM5 | Pre-optimization CM6 | Optimized CM6 |
| --- | ---: | ---: | ---: |
| Key to next paint | 7.2500001192092896 / 8.799999952316284 | 10.950000047683716 / 11.599999904632568 | 9.199999809265137 / 10.099999904632568 |
| Autocomplete visible | 1.5 / 3.6000001430511475 | 58.300000071525574 / 59.19999980926514 | 5.3999998569488525 / 6.600000381469727 |
| 100 API edits | 22.34999990463257 / 24 | 35.65000009536743 / 37.40000009536743 | 28.949999809265137 / 30.5 |
| Replace document, synchronous | 5.399999976158142 / 6.900000095367432 | 22.450000047683716 / 22.899999856948853 | 22.5 / 22.899999618530273 |
| Replace document, settled | 5.799999952316284 / 60.90000009536743 | 32.64999997615814 / 40.799999952316284 | 30.699999809265137 / 39 |
| Load, distant jump, exact style | 121.99999988079071 / 171.09999990463257 | 64.5 / 68.40000009536743 | 60.09999990463257 / 67.2999997138977 |
| Cursor, focus, and search settled | 4.75 / 65.89999985694885 | 57.35000002384186 / 60.5 | 11.599999904632568 / 13.600000381469727 |

The final optimized Chrome capture was written at
`2026-08-15T16:45:52.220Z`. Its 4x CPU capture, retained as diagnostic evidence
rather than a committed baseline, measured 22.700000047683716 /
26.09999990463257 ms for key-to-paint and 15.049999952316284 /
17.699999809265137 ms for autocomplete.

Chrome heap values are exact `median / p95` MiB:

| State | Frozen CM5 | Pre-optimization CM6 | Optimized CM6 |
| --- | ---: | ---: | ---: |
| Initial mount | 3.057697296142578 / 3.0577239990234375 | 3.933156967163086 / 3.9344215393066406 | 3.8925552368164062 / 3.8947486877441406 |
| Large document | 5.18183708190918 / 5.18218994140625 | 7.948541641235352 / 8.0015869140625 | 6.7791900634765625 / 6.783245086669922 |

The optimized initial median is about 1.273x CM5 and the optimized large-source
median is about 1.308x CM5, both within the approximately 1.5x contract. Both
are also below their pre-optimization CM6 medians.

## Installed Safari timings

Values are exact committed JSON `median / p95` milliseconds.

| Scenario | Frozen CM5 | Pre-optimization CM6 | Optimized CM6 |
| --- | ---: | ---: | ---: |
| Key to next paint | 16 / 24 | 17.000000000000227 / 25 | 17 / 19 |
| Autocomplete visible | 5 / 6 | 66 / 69 | 5 / 5.0000000000009095 |
| 100 API edits | 28.50000000000091 / 32 | 24 / 25 | 23 / 25 |
| Replace document, synchronous | 7 / 9 | 21.99999999999909 / 22 | 21.99999999999909 / 22 |
| Replace document, settled | 7 / 10 | 42.99999999999818 / 44.00000000000364 | 40 / 41 |
| Load, distant jump, exact style | 122.5 / 128 | 67 / 69.00000000000364 | 66 / 68 |
| Cursor, focus, and search settled | 12 / 13 | 60 / 62.000000000007276 | 17 / 19.999999999992724 |

The final optimized Safari capture was written at
`2026-08-15T16:52:07.513Z`. Safari's paint measurements are frame-quantized:
the optimized key median equals the approximately 17 ms pre-optimization
median, and the p95 improves from 25 ms to 19 ms, but 19 ms still fails the
16.7 ms contract. Relative to CM5, the optimized median is 1 ms slower while
the p95 is 5 ms faster. SafariDriver exposes no repeatable JavaScript heap API,
so no Safari heap result is claimed.

## Contract decisions

| Contract item | Result | Evidence |
| --- | --- | --- |
| Key-to-paint p95 below 16.7 ms | **Chrome pass; Safari fail** | Chrome 10.099999904632568 ms; Safari 19 ms. Structural dirty tracking avoids per-key document stringification and decoration identity tests reject unrelated rebuilds. |
| Ordinary autocomplete below 16.7 ms | **Pass** | Chrome 6.600000381469727 ms and Safari 5.0000000000009095 ms p95. Native activation uses `activateOnTyping: true` and `activateOnTypingDelay: 0`; the fixed 50 ms normal path is gone. |
| Exact distant jump materially faster than CM5 | **Pass** | Chrome median 121.99999988079071 to 60.09999990463257 ms; Safari 122.5 to 66 ms. Exact token-style assertions reject approximate state. |
| Whole-document synchronous replacement at least 2x faster than pre-CM6, with settled improvement | **Fail** | Chrome sync 22.450000047683716 to 22.5 ms and Safari remains 21.99999999999909 ms; both are effectively unchanged. Chrome settled improves to 30.699999809265137 / 39 ms and Safari to 40 / 41 ms, but the required synchronous improvement did not occur. |
| Reuse token decorations for non-document activity | **Pass** | Identity tests cover cursor, selection, focus, search-panel activity, and completion selection. Chrome cursor/search median drops from 57.35000002384186 to 11.599999904632568 ms; Safari drops from 60 to 17 ms. Search Replace and Replace All remain document transactions. |
| Heap below pre-CM6 and approximately no more than 1.5x CM5 | **Pass** | Chrome optimized initial/large medians are 3.8925552368164062 / 6.7791900634765625 MiB, below pre-CM6 and about 1.273x / 1.308x CM5. |
| Checked IIFE below 100 KiB Brotli | **Pass** | 100162 bytes at Brotli text mode, quality 11; the limit is 102400 bytes. |

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
scripts are excluded from all three editor rows. The pre-CM6 row is the checked
IIFE at commit `a69c0216`; the optimized row is the final checked IIFE.

| Editor artifact as checked/loaded | Raw bytes | Comparison-only gzip level 9 | Brotli text q11 |
| --- | ---: | ---: | ---: |
| Frozen CM5 editor script stack | 486750 | 125674 | 103286 |
| Pre-optimization CM6 IIFE (`a69c0216`) | 781124 | 184594 | 149497 |
| Optimized CM6 IIFE | 360272 | 116369 | 100162 |

Only the optimized CM6 Brotli value is a production sidecar. The historical
Brotli values apply the final production settings for comparison; neither
historical surface was delivered that way. The raw comparison also reflects
the important packaging difference: CM5 and the pre-CM6 IIFE were readable
source artifacts, whereas the optimized checked IIFE is esbuild-minified.

For the historical minified-plus-gzip comparison, all three inputs were also
run through the repository's pinned Terser 5.17.1 defaults before compression:

| Terser-normalized editor artifact | Minified raw bytes | Gzip level 9 | Brotli text q11 |
| --- | ---: | ---: | ---: |
| Frozen CM5 editor script stack | 215084 | 69724 | 60919 |
| Pre-optimization CM6 IIFE (`a69c0216`) | 354100 | 112504 | 96507 |
| Optimized CM6 IIFE | 359080 | 114173 | 97682 |

This normalized table preserves the approved historical comparison: CM5 is
about 68.1 KiB gzip and pre-CM6 is about 109.9 KiB. It also shows that the
optimized runtime is not smaller than CM5 and is slightly larger than pre-CM6
under a second Terser pass; the production win is the deterministic minified
IIFE and its 100162-byte Brotli sidecar, not a claim of beating CM5's size.

The final release `combined.css` is 16519 raw bytes, 3906 bytes at comparison
gzip level 9, and 3345 bytes at production Brotli text quality 11.

The release retains every raw original, generates no `.gz` files, and produced
206 `.br` sidecars. `npm run verify:release-compression` decompressed every
sidecar and compared it byte-for-byte with its original. The bundle's committed
SHA-256 is
`d7d599262c154e96148e1aafa55a9979901956acf8feaab0abe5ab32551b346c`;
the source map is
`d462a373a2c68c38eb131e2f1d72fb32c0edbcd90f9925252d8b49129e80aa43`.

A real Apache 2.4.62 smoke test, with `mod_rewrite`, `mod_mime`,
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
  blacklisted and localhost binding allowed, the same suite passed 179/179.
- `node src/tests/run_tests_node.js`: passed 750/750 with 0 failures and 0
  errors.
- `npm run test:codemirror-browser`: passed 144 with 45 intentional
  baseline-only/engine-specific skips across Chromium, Firefox, and WebKit.
- Release compilation: passed at preserved four-byte build number `1838`;
  checked bundle, source map, and standalone hashes remain deterministic.
- `npm run verify:release-compression`: passed all 206 Brotli sidecars, with no
  gzip sidecars.
- Fresh isolated Apache 2.4.62 HTTP smoke: passed negotiation, MIME, `Vary`,
  identity/q=0, and missing-sidecar fallback contracts.
- Installed Chrome and Safari: final performance JSON reports visible foreground
  state. Chrome observed no page errors from navigation onward, and Safari
  observed none during the complete warmup/measurement window; direct product
  geometry inspection passed as described above.
