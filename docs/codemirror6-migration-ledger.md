# CodeMirror 6 migration ledger

This ledger classifies every PuzzleScript-specific marker in the vendored CodeMirror 5 editor before any of those files are removed. Statuses are updated only after the named verification has passed.

| CM5 modification or owned integration | Existing location | CM6 replacement | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic hex colours | `src/js/codemirror/codemirror.js:72` | parser-token decoration using the existing contrast algorithm | `token-presentation.test.mjs` plus dynamic-colour screenshot | candidate-verified in the Chromium zero-tolerance visual gate; cross-browser behaviour verification pending |
| Historical 29px gutter | `src/js/codemirror/codemirror.js:4403` | scoped CM6 gutter CSS | per-browser geometry JSON plus screenshot | candidate-verified against the frozen Chromium, Firefox, and WebKit measurements |
| Search/replace shortcut changes | `src/js/codemirror/codemirror.js:6827`, `:6845` | explicit PuzzleScript CM6 search keymap | shortcut JSON plus search browser test | exact PC/Mac binding inventory and Chromium candidate search behavior verified; cross-browser verification pending |
| Mouse-created multi-selection disabled | `src/js/codemirror/codemirror.js:7505` | single-selection state/config | pointer browser test | Chromium candidate pointer test verified; cross-browser verification pending |
| Per-line `( line )` comments | `src/js/codemirror/comment.js:63`, `:88` | CM6 state command | command unit test | verified for cursor, selections, blank lines, multiple ranges, selection geometry, and one-step undo |
| CM6-style combined search panel backport | `src/js/codemirror/search.js:4` | stock `@codemirror/search` panel with scoped presentation CSS | search browser test plus screenshot | stock panel, permanent insensitive guard, literal/regexp/word/replace/wrap edge cases verified in Chromium; candidate presentation matches the frozen CM5 pixels; cross-browser behaviour verification pending |
| PuzzleScript semantic autocomplete | `src/js/codemirror/anyword-hint.js:24` and helper body | PuzzleScript-owned pure completion function plus CM6 source | golden and browser autocomplete tests | golden corpus and Chromium candidate browser smoke verified; candidate popup bounds and pixels verified; cross-browser behaviour verification pending |
| Lightweight non-editor stream provenance | `src/js/codemirror/stringstream.js:3` | `src/js/puzzlescript-stream.js` | StringStream comparison plus engine suite | verified: official/local stream parity and 750/750 engine tests |
| Midnight token theme | `src/css/midnight.css` | shared `src/css/editor-theme.css` selectors for CM5 and CM6 | representative and dynamic-colour screenshots | candidate-verified in light and dark themes with zero Chromium pixel differences |
| Active line, wrapping, and page geometry | `src/css/codemirror.css`, `src/css/midnight.css`, `src/css/layout.css` | scoped `src/css/editor-cm6.css` | per-engine geometry plus active-line, wrapped, empty, and full-page screenshots | candidate-verified: exact numeric geometry in Chromium, Firefox, and WebKit and zero Chromium pixel differences |

The `anyword-hint.js:24` match is example homepage text rather than a CM5 core modification, but the surrounding helper is a PuzzleScript-owned critical integration and is therefore retained in the ledger. The `stringstream.js:3` match is provenance rather than an editor customization; it is tracked because the file must move out of the deleted CM5 directory without changing parser behaviour.
