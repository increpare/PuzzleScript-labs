# CodeMirror 6 migration ledger

This ledger classifies every PuzzleScript-specific marker in the vendored CodeMirror 5 editor before any of those files are removed. Statuses are updated only after the named verification has passed.

| CM5 modification or owned integration | Existing location | CM6 replacement | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic hex colours | `src/js/codemirror/codemirror.js:72` | parser-token decoration using the existing contrast algorithm | `token-presentation.test.mjs` plus dynamic-colour screenshot | candidate-verified in Chromium, Firefox, Playwright WebKit, and actual Safari 26.3; zero-tolerance Chromium visual parity verified |
| Historical 29px gutter | `src/js/codemirror/codemirror.js:4403` | scoped CM6 gutter CSS | per-browser geometry JSON plus screenshot | candidate-verified against the frozen Chromium, Firefox, and WebKit measurements |
| Search/replace shortcut changes | `src/js/codemirror/codemirror.js:6827`, `:6845` | explicit PuzzleScript CM6 search keymap | shortcut JSON plus search browser test | exact PC/Mac binding inventory and candidate behaviour verified in Chromium, Firefox, Playwright WebKit, and actual Safari 26.3 |
| Mouse-created multi-selection disabled | `src/js/codemirror/codemirror.js:7505` | single-selection state/config | pointer browser test | candidate pointer test verified in Chromium, Firefox, and Playwright WebKit |
| Per-line `( line )` comments | `src/js/codemirror/comment.js:63`, `:88` | CM6 state command | command unit test | verified for cursor, selections, blank lines, multiple ranges, selection geometry, and one-step undo |
| CM6-style combined search panel backport | `src/js/codemirror/search.js:4` | stock `@codemirror/search` panel with scoped presentation CSS | search browser test plus screenshot | stock panel, permanent insensitive guard, literal/regexp/word/replace/wrap edge cases verified in Chromium, Firefox, Playwright WebKit, and actual Safari 26.3; candidate presentation matches the frozen CM5 pixels |
| PuzzleScript semantic autocomplete | `src/js/codemirror/anyword-hint.js:24` and helper body | PuzzleScript-owned pure completion function plus CM6 source | golden and browser autocomplete tests | golden corpus and candidate browser behaviour verified in Chromium, Firefox, Playwright WebKit, and actual Safari 26.3; candidate popup bounds and pixels verified |
| Lightweight non-editor stream provenance | `src/js/codemirror/stringstream.js:3` | `src/js/puzzlescript-stream.js` | StringStream comparison plus engine suite | verified: official/local stream parity and 750/750 engine tests |
| Midnight token theme | `src/css/midnight.css` | shared `src/css/editor-theme.css` selectors for CM5 and CM6 | representative and dynamic-colour screenshots | candidate-verified in light and dark themes with zero Chromium pixel differences |
| Active line, wrapping, and page geometry | `src/css/codemirror.css`, `src/css/midnight.css`, `src/css/layout.css` | scoped `src/css/editor-cm6.css` | per-engine geometry plus active-line, wrapped, empty, and full-page screenshots | candidate-verified: exact numeric geometry in Chromium, Firefox, and WebKit and zero Chromium pixel differences |

The `anyword-hint.js:24` match is example homepage text rather than a CM5 core modification, but the surrounding helper is a PuzzleScript-owned critical integration and is therefore retained in the ledger. The `stringstream.js:3` match is provenance rather than an editor customization; it is tracked because the file must move out of the deleted CM5 directory without changing parser behaviour.

## Pre-cutover gate record — 2026-08-14

- `npm run check:codemirror`: passed; checked-in IIFE and source map are current.
- `npm run test:codemirror`: passed, 69/69.
- `node src/tests/run_tests_node.js`: passed, 750/750 with 0 failures and 0 errors.
- `npm run test:codemirror-browser`: passed in Playwright 1.62.1 with 35 passed and 19 intentional baseline-only skips across Chromium 151.0.7922.34, Firefox 153.0, and WebKit revision 2336.
- Edge project: configured as `channel: "msedge"`. The explicit candidate run could not start because `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` is absent on this host. A real Edge pass remains mandatory before CM5 deletion.
- Safari application: passed in actual Safari 26.3 / platform build 25D125 through Apple `safaridriver`. The candidate run verified one CM6/no CM5 editor, application shell, exact 29px gutter and 16px editor typography, identical light/dark geometry, wrapping, dynamic colours, autocomplete and acceptance, permanently case-insensitive search/replace, per-line comments, line movement, SOUND/LEVEL callbacks, image paste and focus restoration, source drop, and compile/run. SafariDriver injects a separate refocus after its pointer sequence; event-boundary instrumentation verified that the LEVEL handler itself dispatched `blur` and `focusout` after preventing mousedown, while the Playwright WebKit interaction test verifies the final unfocused state.
- `node compile.js`: passed twice from build number 1838. The build-number file was restored to byte-for-byte clean after each run. The build deterministically refreshed the previously stale `src/standalone_inlined.txt` to SHA-256 `dd6128b1f53c01ea9f3a399c57c7e296f1a2e5e2d9a9fd56ead99e795501d203`; every semantic difference traces to committed source changes (`b6219e93`, `3a8f0a0e`, `ce4eca0b`, and `0cf86671`), and the refresh is committed as `e5dc8935`.
