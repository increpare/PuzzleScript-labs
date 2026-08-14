# CodeMirror 6 stream-language migration

## Status

Approved design. Implementation is explicitly deferred to a separate plan and must take place in an isolated git worktree.

## Context

PuzzleScript currently vendors CodeMirror 5 (CM5), a set of CM5 addons, and local changes to both. The editor is unusually coupled to the language mode: `codeMirrorFn` is not merely a syntax highlighter. It incrementally constructs the semantic state used by compilation, contextual autocomplete, validation, and useful error reporting.

The migration must therefore use CodeMirror 6's (CM6) compatibility path for CM5-style stream parsers, [`StreamLanguage`](https://codemirror.net/docs/ref/#language.StreamLanguage). A handwritten, generated, or separately maintained Lezer grammar is forbidden. The Lezer tree produced internally by `StreamLanguage` is acceptable only as CM6's storage representation for tokens and copied states emitted by the existing stream parser.

The migration is also required to be visually conservative. The current editor layout, typography, wrapping, gutters, panels, token colours, and surrounding page geometry are the specification. A slightly different selection appearance is acceptable; intentional changes to layout, font, or geometry are not.

The official [CM6 migration guide](https://codemirror.net/docs/migration/) informs the editor integration, but this design does not attempt to preserve CM5's API generally. PuzzleScript will own a narrow editor adapter, and features will otherwise use native CM6 extensions.

## Baseline

Design work was isolated in:

- Worktree: `.worktrees/codemirror6-streamlanguage-design`
- Branch: `codex/codemirror6-streamlanguage-design`

Before design changes, `node src/tests/run_tests_node.js` passed 750 tests with no failures or errors.

The previous `origin/codemirror-6` prototype is reference material only. It demonstrated a bundling route and catalogued some editor behaviours, but its custom tokenizer and broad CM5 facade are not an acceptable foundation for this migration.

## Hard requirements

- `codeMirrorFn` remains the sole PuzzleScript tokenizer/parser definition.
- The compiler and editor use the same `startState`, `copyState`, `blankLine`, and `token` implementation.
- No handwritten or generated Lezer grammar is introduced.
- No second PuzzleScript grammar, regex highlighter, or editor-specific tokenizer is introduced.
- Autocomplete continues to use exact semantic parser state.
- Dynamic colours, per-line comment toggling, clickable sound/level tokens, image paste, shortcuts, source dropping, dirty state, and navigation behaviour are preserved.
- Search is always case-insensitive.
- The current editor/page layout, font, line geometry, wrapping, gutters, panels, and token colours remain visually identical, subject only to the agreed selection-rendering tolerance.
- CM6 replaces CM5 only on the feature branch after parity work is complete. There is no runtime CM5/CM6 toggle.
- The browser bundle is precompiled and checked into the repository. There is no runtime CDN or module-loader dependency.
- Supported browsers are current Chrome, Firefox, Safari, and Edge. IE and obsolete mobile browsers are out of scope.
- Vendored CM5 editor core and addons are removed only after all parity gates pass.

## Non-goals

- Rewriting, simplifying, or redesigning the PuzzleScript language parser.
- Moving compilation onto a Lezer syntax tree.
- Replacing existing compiler diagnostics with CM6 linting.
- Redesigning the PuzzleScript editor, autocomplete UI, search colours, or surrounding page.
- Providing a general CM5 compatibility facade.
- Preserving undocumented CM5 APIs that are not used by PuzzleScript.
- Adding a production runtime switch between editors.

## Existing integration inventory

### Parser

`src/js/parser.js` defines `codeMirrorFn`, whose returned object provides:

- `startState`
- deep `copyState`
- `blankLine`
- `token`
- `wordChars`

The compiler directly instantiates this parser and feeds it a `StringStream`. Its mutable state contains sections, comments, declared objects, original casing and line numbers, legend entries, sounds, rules, win conditions, levels, and partially parsed current-line data.

### Editor and application calls

The current CM5 editor supplies document access, dirty-state notification, cursor navigation, focus/blur, source replacement, history clearing, selection replacement, line scrolling, and access to its input element. Several application files currently reach through CM5 internals (`editor.doc`, `editor.display.input`); those callers must move to the PuzzleScript adapter rather than being reproduced as CM5-shaped properties.

### Local CM5 changes

Case-insensitive searches for `puzzlescript` in the vendored files identify at least these behaviours:

- Dynamic hex-colour token styling in CM5 DOM construction.
- A one-pixel line-number gutter width adjustment for historical layout parity.
- Search/replace shortcut changes.
- Mouse multi-selection disabled.
- Per-line PuzzleScript comments in the comment addon.
- The backported CM6-style search panel in the CM5 search addon.

This list is a starting ledger, not permission to delete the files. Immediately before CM5 removal, the implementation must repeat the inventory and account for every match.

## Considered architectures

### 1. Broad CM5 facade over CM6

Recreate a large portion of the CM5 editor API over `EditorView`, allowing existing editor code and addons to run with limited changes.

This resembles the previous prototype. It is rejected because the facade becomes another editor framework, obscures CM6 transaction semantics, and makes it difficult to know which behaviours are genuine CM6 features versus approximations.

### 2. Public CM6 APIs plus a separate semantic state index

Use stock `StreamLanguage` for highlighting but independently run `codeMirrorFn` to maintain a second line-by-line state index for autocomplete and token interactions.

This avoids private CM6 fields, but duplicates expensive parsing and introduces two incremental caches that may disagree. It is rejected as less conservative than sharing the states already stored by `StreamLanguage`.

### 3. Stock `StreamLanguage` plus a narrow state bridge

Pass the exact parser returned by `codeMirrorFn` to `StreamLanguage.define`. Add one isolated bridge that reads the copied stream states already attached to StreamLanguage tree chunks, then advances the same parser from the nearest checkpoint when a feature needs state at an exact position.

This is the chosen approach. It uses CM6's supported compatibility parser while confining the only private API dependency to one small, version-pinned module.

Vendoring or forking all of `StreamLanguage` remains a fallback only if the pinned upstream implementation cannot satisfy correctness tests. It is not part of the approved first implementation.

## Architecture

### 1. PuzzleScript parser core

`codeMirrorFn` remains authoritative. Compilation continues to instantiate and call it directly. The migration must not change language recognition, state mutation, parser messages, or compiler output merely to fit CM6.

The lightweight `StringStream` currently used by the player, standalone export, compiler, and Node tests remains available without loading the CM6 editor. It should be relocated out of the obsolete CM5 editor directory and described as PuzzleScript parser infrastructure. Contract tests must cover the stream methods and tab/column behaviour on which `codeMirrorFn` relies against CM6's `StringStream`.

### 2. CM6 language bridge

A small language module will:

1. Instantiate `codeMirrorFn` once for the CM6 language.
2. Supply that object to `StreamLanguage.define`.
3. Add CM6 language data such as PuzzleScript word characters and the completion source.
4. Register all parser-returned token names, including dynamic colour forms, so StreamLanguage preserves them in its flat token tree.
5. Expose exact token and copied-state queries through a narrow PuzzleScript API.

The bridge may copy and advance `codeMirrorFn` state. It may not recognize PuzzleScript syntax independently.

The internal access to `StreamLanguage.stateAfter` and `StreamLanguage.streamParser` is isolated in one compatibility file. CM6 package versions are exact pins, and focused contract tests must fail if those members or their semantics change. The implementation should include a source comment linking to the pinned upstream [`stream-parser.ts`](https://code.haverbeke.berlin/codemirror/language/src/branch/main/src/stream-parser.ts).

### 3. Exact-prefix parsing coordinator

PuzzleScript parser state is global. Starting the parser at an arbitrary viewport produces invalid semantic state. Stock StreamLanguage contains a viewport optimization that may restart more than 100,000 characters beyond its known prefix, so default background highlighting is not sufficient as a correctness guarantee.

The integration will use CM6's documented [`ensureSyntaxTree`](https://codemirror.net/docs/ref/#language.ensureSyntaxTree) and `syntaxTreeAvailable` facilities to advance a genuine prefix from the beginning or from a valid reused fragment. Initial document loading, document edits, viewport changes, autocomplete requests, and token interactions must all pass through the exact-prefix coordinator when they require parser-derived information.

Presentation code must not install token styling for a range unless the complete prefix through that range is known. On pathological documents, exact parsing may be completed in bounded work slices. Temporarily unstyled text is preferable to confidently wrong, state-dependent styling. Ordinary PuzzleScript documents should complete within the immediate parsing budget and show no visible delay.

The large-file fixture must exceed the 100,000-character StreamLanguage shortcut threshold and test immediate scrolling plus edits earlier in the file.

### 4. Token presentation

Token classes come exclusively from style names returned by `codeMirrorFn` and represented by the StreamLanguage tree. A CM6 view extension converts those token nodes to the existing stable `cm-*` classes. It does not run `codeMirrorFn` itself and does not inspect source text to infer syntax.

The presentation registry must cover every fixed token name returned by the parser. Dynamic forms such as `MULTICOLOR#...` and `COLOR-#...` retain the hex value in their StreamLanguage token identity. The decoration layer derives the inline colour style from that parser-returned identity and preserves the current contrast-adjustment algorithm and `cm-COLOR` class behaviour.

Only mark decorations that do not affect layout are allowed for token presentation. CM6's default syntax theme must not override PuzzleScript typography, font weight, spacing, or colour rules.

### 5. Autocomplete

The existing suggestion calculation in `anyword-hint.js` depends on full parser state, including section, comment nesting, object tables, sounds, partial rule state, casing, and current-line work arrays.

That calculation will be extracted from CM5 helper registration into a PuzzleScript-owned function with explicit inputs:

- Current line and cursor offset.
- Current parser token text and range.
- Exact copied parser state at the requested position.
- Previous line where directional transforms require it.

The state bridge finds the nearest valid StreamLanguage checkpoint, calls the parser's own `copyState`, and advances the same parser only across the remaining text to the cursor. Suggestions are converted to native CM6 completion objects without changing their text, case, ordering, annotations, replacement range, rendering metadata, directional transformations, or filtering.

Autocomplete continues to open after the same eligible key releases with the equivalent of `completeSingle: false`. It remains suppressed for empty words and comments. If exact state is not ready, it must defer/retry rather than synthesize suggestions from raw document text.

### 6. Native CM6 features

Features are implemented as focused CM6 extensions:

- History, selection, line numbers, wrapping, active line, and core editing commands.
- PuzzleScript per-line comment toggle.
- PuzzleScript line-up and line-down commands.
- Parser-token click handling for `SOUND` and `LEVEL`.
- PuzzleScript autocomplete source and rendering.
- Image paste and source-file drop handling.
- Dirty-state/change notification.
- Standard CM6 search.

These extensions may query the language bridge. They may not create a second tokenizer.

### 7. PuzzleScript editor adapter

The application retains a global `editor` reference, but its value is a small PuzzleScript-owned adapter rather than an `EditorView` or general CM5 facade. The planned external surface is limited to operations actually needed by application code:

- `getValue()`
- `setValue(text)`
- `clearHistory()`
- `focus()`
- `blur()`
- `replaceSelection(text)`
- `setCursor(line, column)`
- `scrollToLine(line)` or a similarly purpose-specific error-navigation method
- `getLastLine()`
- `getInputElement()` where event-routing code genuinely requires the DOM input

Names may be refined in the implementation plan, but the surface must stay purpose-specific. Existing uses of `editor.doc.lastLine()`, `editor.display.input`, `setOption`, generic `on`, and CM5 token APIs must be removed rather than emulated.

The underlying `EditorView`, transactions, extensions, and DOM remain private to the CM6 integration.

## Feature behaviour

### Search

Use the stock `@codemirror/search` extension, state, commands, match highlighting, replacement logic, and panel. Configure the panel at the top and case sensitivity off.

PuzzleScript requires search to remain always case-insensitive, including regular-expression search. The standard match-case control will therefore be hidden or disabled in an accessible way so it cannot enable case-sensitive queries. Regex, whole-word, next, previous, replace, replace-all, close, selection-as-query, wrapping, and existing platform shortcuts remain available.

PuzzleScript changes to search are limited to configuration, keymap selection, the case-sensitivity enforcement, and scoped CSS. The current CM5 backport is removed with the other CM5 addons.

### Per-line comments

`Ctrl-/` and `Cmd-/` wrap each selected nonblank line independently using the existing `( line )` format. Repeating the command removes those delimiters when all relevant lines qualify. Selection boundary behaviour, blank-line handling, padding, and undo grouping must match the current addon.

### Line movement

`Shift-Ctrl-Up` and `Shift-Ctrl-Down` move selected lines while preserving selections, document boundaries, scrolling, and single-step undo behaviour.

### Token interaction

- Clicking a `SOUND` token parses its displayed seed and calls the existing sound playback path.
- Ctrl/Cmd-clicking a `LEVEL` token blurs the editor, prevents immediate refocus, and invokes compilation for that source line.

Hit testing uses exact parser-produced token ranges or their presentation marks. It must not identify tokens with a text regex or CSS class generated independently from the parser tree.

### Image paste

Pasting a clipboard image continues to:

- Consume the top-left 5x5 pixels without resizing.
- Treat alpha below the current threshold as transparent.
- Quantize opaque pixels to at most ten colours.
- Generate the same uppercase hex palette and 5x5 digit/dot grid.
- Choose an unused `pasted_N` object name.
- Insert the object at the current selection and refocus the editor.

The image conversion algorithm is editor-independent; only its paste event and insertion plumbing move to CM6.

### Source drop, dirty state, and navigation

Dropped `.txt` and exported `.html` PuzzleScript sources load exactly as today. Dirty-state and `SAVE*` indication continue comparing the current source against the clean snapshot. Error links retain line scrolling and cursor placement. Focus and blur calls in gameplay, mobile, toolbar, and console code move to the adapter.

### Multiple selections

The local CM5 core explicitly disables mouse-created additional selections. CM6 must be configured and tested to preserve that behaviour rather than inheriting a different multi-selection gesture.

## Visual parity

The active CM5 editor is the visual specification. CM6 default styling is not accepted wholesale.

The CM6 root may carry a PuzzleScript compatibility class needed by existing outer page selectors. A scoped parity stylesheet maps current measurements to CM6's supported DOM classes without attempting to reproduce CM5's internal DOM.

The following are hard parity surfaces:

- Editor position, width, height, overflow, and relationship to toolbar, console, and game canvas.
- Monospace font stack, font size, line height, tab size, and line wrapping.
- Current four-pixel content padding.
- Line-number width and padding, including the historical one-pixel gutter adjustment.
- Light/dark editor backgrounds, token colours, active line, cursor, gutters, and search-match colours.
- Scroll position when panels open and close.
- Autocomplete dimensions, typography, padding, ordering, selected row, and coloured token previews.
- Standard CM6 search-panel layout after minimal PuzzleScript colour/spacing integration.
- Dynamic colour rendering.

Selection painting may differ slightly, as approved, provided it does not change text geometry or surrounding layout.

Baseline CM5 and candidate CM6 screenshots must be captured at identical viewport sizes and browser zoom for:

- Empty editor.
- Representative source with all syntax sections.
- Long wrapped lines.
- Active line and gutter.
- Open autocomplete.
- Open search and replace panel.
- Dynamic named and hex colours.
- Full editor page in both light and dark colour schemes.

Unexplained geometry differences block CM5 removal.

## Bundle and dependency pipeline

All CM6 and Lezer packages, plus the bundler, use exact versions recorded in `package.json` and `package-lock.json`. Version ranges such as `^` and `~` are not used for the new integration.

Readable source modules remain under a dedicated CM6 source directory. A small checked-in build script produces one browser-ready IIFE bundle and source map under `src/js`. The bundle exposes a PuzzleScript-specific factory; it does not expose CM6 as a general global API.

Required commands:

- `npm run build:codemirror` regenerates the committed bundle and map.
- `npm run check:codemirror` regenerates in a temporary location and byte-compares or otherwise deterministically verifies committed output.

Normal development, deployment, and release builds load the committed bundle directly. They do not run npm, fetch a CDN, or resolve modules in the browser.

`src/editor.html` loads the generated bundle before the small application bootstrap in `editor.js`. The existing release compiler includes the generated browser artifact rather than attempting to concatenate raw ESM sources. Player, standalone, and test builds continue to use only the lightweight parser stream support unless they actually host an editor.

## Rollout and rollback

Implementation proceeds in ordered commits:

1. Add exact dependencies, build scripts, source modules, generated bundle, and low-level contracts while CM5 remains active.
2. Add CM6 feature extensions, adapter, and parity CSS without changing the production editor selection.
3. Make one explicit branch-only switch from CM5 to CM6. Do not add a runtime toggle.
4. Correct parity issues and run all verification with dormant CM5 files still available for direct comparison.
5. Remove unused CM5 editor core, addons, and obsolete CSS in the final migration commit only after every gate passes.

The pre-switch commit is a clean operational rollback point. The dormant-CM5 phase also allows direct A/B builds from adjacent commits without shipping a toggle. If the migration is merged and later reverted, the switch and removal commits remain separable and reviewable.

Immediately before removal, repeat a case-insensitive search for `puzzlescript` across every CM5 core/addon file and extend the migration ledger. Each local modification must map to a tested CM6 behaviour or an explicit obsolete/not-applicable explanation.

## Verification gates

### Parser equivalence

- Token spans and returned style names match on representative complete, incomplete, mixed-case, commented, and malformed sources.
- `startState`, `copyState`, and `blankLine` transitions match.
- Parser states used by autocomplete contain equivalent semantic data.
- Dynamic named and hex-colour token identities survive StreamLanguage adaptation.
- Existing compiler output and parser error-message tests remain unchanged.

### Autocomplete

Golden tests cover every PuzzleScript section, comments, incomplete tokens, object casing, sound/rule state, directional rule transforms, legend generation, ordering, rendering metadata, and replacement ranges.

### Editing and interaction

- Case-insensitive literal and regex search, whole-word mode, wrapping, replacement, and shortcuts.
- Per-line comment toggling over cursors, partial selections, full lines, blank lines, and multiple ranges accepted by programmatic state.
- Line movement at document boundaries with forward and backward selections.
- Sound click and modified level click.
- Image paste conversion and insertion.
- `.txt` and `.html` source drop.
- Dirty state, save marker, focus/blur, history clearing, and error navigation.

### Large documents

A fixture larger than 100,000 characters must test:

1. Immediate scrolling beyond the exact initial parser frontier.
2. Token presentation only after exact prefix availability.
3. Correct semantic autocomplete at the distant position.
4. An edit before the viewport followed by reparse and restyling.
5. Returning to an earlier viewport without stale or approximate token classes.

### Visual and browser coverage

- Fixed baseline/candidate screenshots for every visual parity surface in light and dark modes.
- Current Chrome, Firefox, Safari, and Edge smoke coverage.
- Keyboard, mouse, clipboard, drag/drop, and focus behaviour.
- No unexplained page or editor geometry change.

### Builds

- Existing Node suite remains green; baseline is 750 passing tests.
- Editor development page smoke test.
- Release build smoke test.
- Player and standalone export smoke tests.
- Deterministic CM6 bundle check.
- No active CM5 editor reference after the switch.
- No vendored CM5 editor core/addon remains after the final removal commit.

Failure of any hard parser, autocomplete, interaction, layout, build, or browser gate prevents CM5 removal and prevents the migration from being declared complete.

## Documentation and maintenance

- Document how and when to regenerate the CM6 bundle.
- Record exact package versions and why the private state bridge is pinned.
- Update editor credits from the vendored CM5 description to the CM6 packages actually used.
- Keep the migration ledger with the change so future maintainers can see where every local CM5 modification went.
- Treat CM6 dependency upgrades as explicit maintenance changes that run the full parser-state bridge and parity test suite; they are not routine unattended version bumps.

