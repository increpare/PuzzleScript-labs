# CodeMirror 6 performance improvement plan

## Status

Approved design. Implementation is deferred to a separate implementation plan and remains isolated in the existing CodeMirror 6 worktree.

## Context

PuzzleScript now uses CodeMirror 6 (CM6) through `StreamLanguage`, with the existing `codeMirrorFn` stream parser as its sole language parser. The migration deliberately preserves the CodeMirror 5 (CM5) editor's layout, typography, wrapping, autocomplete results, token colours, shortcuts, search behavior, and parser-dependent interactions.

The compatibility implementation is correct and already has one substantial CM6 advantage: distant large-file viewports acquire correct stateful highlighting rather than retaining an approximate cached parser state. Its runtime profile nevertheless contains several avoidable costs introduced by the adapter rather than required by CM6.

The performance work must be conservative. It will use supported CM6 fast paths, retain the stream-parser architecture, and accept the full Brotli-compressed CM6 bundle as the delivery baseline. It will not pursue a Lezer grammar, a worker parser, a CM6 fork, or a private checkpoint-frequency modification.

## Current baseline

The following medians were measured in installed Chrome 151.0.7922.138 using the frozen CM5 comparison page and the current CM6 product editor:

| Scenario | CM5 | Current CM6 |
| --- | ---: | ---: |
| Key to next paint | 4.5 ms | 4.2 ms |
| Autocomplete visible | 1.1 ms | 52.9 ms |
| 100 API edits | 18.0 ms | 32.7 ms |
| Replace a 129,721-character document | 2.8 ms | 22.2 ms |
| Load, distant jump, and correct styled viewport | 130.1 ms | 78.6 ms |
| Initial editor heap | 2.44 MiB | 3.32 MiB |
| Large-document heap | 5.59 MiB | 8.86 MiB |
| Editor-specific minified plus gzip | 68.2 KiB | 110.8 KiB |

The full CM6 JavaScript is approximately 96.6 KiB with Brotli. A bare CM6 view/state bundle is already similar in compressed size to the complete CM5 editor and addons, so beating CM5's total size would require disproportionately risky feature splitting or a vendor fork. The approved size goal is instead to keep the full production CM6 JavaScript below 100 KiB Brotli while improving runtime behavior.

## Hard invariants

- `codeMirrorFn` remains the only PuzzleScript tokenizer/parser.
- No handwritten or generated Lezer grammar is permitted.
- No worker parser, second state index, regex highlighter, or duplicate grammar is introduced.
- CM6 exclusively controls checkpoint placement, storage, reuse, invalidation, and scheduling.
- CM6's checkpoint interval is not patched, wrapped, or made configurable locally.
- The existing exact autocomplete results, dynamic colours, per-line comments, always-case-insensitive search, image paste, source drop, clickable `SOUND`/`LEVEL` tokens, shortcuts, error reporting, and history behavior remain compatible.
- Layout, font, line geometry, wrapping, gutters, panels, and surrounding page geometry remain visually identical. The existing tolerance for selection rendering remains.
- CM6 package versions remain exact pins and the browser bundle remains a deterministic checked-in IIFE.
- There is no production CM5/CM6 runtime switch.
- Every optimization is isolated and benchmarked. A change is removed if it compromises correctness, reproducibility, or visible responsiveness.

## Performance contract

“Clearly superior” is defined by real editing workflows rather than requiring CM6 to win every synthetic microbenchmark.

- Large-file typing must remain within one 60 Hz animation frame at the 95th percentile and must not perform work proportional to the entire document for each character.
- Ordinary autocomplete must open or update within one animation frame, with the current fixed 50 ms delay removed from the normal typing path.
- Distant jumps must retain exact stateful highlighting and remain materially faster than CM5.
- Cursor movement, focus, and search UI activity must not rebuild unrelated PuzzleScript token decorations.
- Whole-document replacement must improve by at least two times relative to the current CM6 result without changing selection, history, or callbacks.
- Large-document heap use must fall from the current result and remain no more than approximately 1.5 times the CM5 measurement.
- Production CM6 JavaScript must remain below 100 KiB Brotli.
- Chrome and Safari are the required real-browser performance and visual gates. Edge is explicitly out of scope for this work. Automated Firefox behavior tests may continue to run.
- Work may not be moved from a measured operation into a later visible pause merely to improve the reported number.

## Considered approaches

### 1. Supported CM6 fast paths

Remove redundant application work, use CM6's immutable document representation and native typing activation, retain exact parser prefixes conservatively, and rebuild view decorations only for relevant changes.

This is the chosen approach. It is composed of independently testable changes using public CM6 APIs, except for the already isolated and version-pinned read of StreamLanguage checkpoint state required by autocomplete.

### 2. Worker or separately indexed parser state

Maintain another parser-state index or move parsing to a worker. This would duplicate parser coordination, complicate synchronous autocomplete and diagnostics, and risk disagreement with the compiler's parser state. It is rejected.

### 3. Fork or patch CM6 internals

Patch checkpoint frequency, autocomplete scheduling, or bundle internals. This could expose additional tuning controls but would create an ongoing vendor-maintenance burden and violate the conservative requirement. It is rejected.

## Design

### 1. Semantic editor adapter and dirty tracking

The application-facing editor boundary will describe PuzzleScript operations rather than reproduce CM5 methods mechanically. CM6 offsets, `EditorState`, transactions, and effects remain private.

The adapter will provide these semantic operations:

- `getValue()` for compilation, saving, sharing, exporting, and other callers that genuinely need a source string.
- `replaceDocument(text)` for a normal undoable whole-document transaction.
- A benchmark-gated `resetDocument(text)` for loading a new document with empty history in one state installation.
- A temporary `setValue(text)` compatibility alias for `replaceDocument(text)` while call sites are migrated.
- `markClean()`, `isDirty()`, and `onDirtyChange(boolean)` for editor-owned clean-state tracking.
- `replaceSelection(text)`, `focus()`, `blur()`, and the required event-routing DOM accessor.
- `revealLine(line, {cursor, y})` for atomic cursor placement and supported CM6 scrolling.

The current change path converts the complete CM6 document rope to a string in the update listener and then converts it again in `checkEditorDirty`. This document-sized work will be removed from keystrokes.

CM6 will keep the clean snapshot as an immutable `Text` value and compare it with the current document using `Text.eq`. The application will receive only clean/dirty transitions, not a full source string. Undoing exactly to the clean document must clear `SAVE*`; redo must restore it. A full string is created only when a caller invokes `getValue()`.

The CM5 comparison adapter may implement the same semantic contract with strings. No CM6 type crosses the application boundary.

### 2. CM6 checkpoint ownership and long-line rollback

CM6 continues to own all real stream-parser checkpoints. The integration does not modify their approximate 512-character target, create competing checkpoints, or expose checkpoint controls through the adapter.

PuzzleScript retains one separate compatibility safety mechanism for pathological lines. CM6's StreamLanguage stops tokenizing a single logical line after approximately 10,000 characters, but it can retain parser mutations made while reading only that prefix. PuzzleScript's wrapper restores the state from before such a line so a partially read line cannot corrupt the section, comment, object, or rule state of all following lines.

The wrapper currently creates this rollback snapshot at the start of every line. Since `StringStream` exposes the complete logical line, the wrapper will create it only when the line is longer than the 10,000-character cutoff. Ordinary lines carry no rollback state. CM6's own checkpoint copies remain unchanged.

Tests must cover line lengths immediately below, at, and above the cutoff, as well as editing, jumping, undoing, and resuming around those lines.

### 3. Exact-prefix invalidation

PuzzleScript parser state is global, so an edit can affect every later line. The exact-prefix gate remains responsible for preventing autocomplete, interactions, and final token presentation from consuming approximate viewport state.

Today every document edit resets the known exact prefix to position zero. Instead, an edit will preserve exactness through the start of the earliest changed logical line. Everything from that line onward is invalid. This boundary is safe for nested comments, section changes, definitions, rule state, inserted or removed newlines, and line-number-dependent parser state because the text and parser state entering that line are unchanged.

CM6 will reuse its own valid tree fragments and checkpoints before the boundary and parse forward. Existing decorations will be mapped through the edit while exact replacements are prepared. The scheduler will not dispatch a no-op exact-prefix effect when the requested prefix is already exact.

Parser-dependent interactions never consume approximate state. When necessary, they advance parsing from CM6's latest safe checkpoint, using bounded synchronous work and the existing idle continuation.

### 4. Autocomplete activation

The existing PuzzleScript suggestion calculation, parser-state input, result ordering, casing, replacement ranges, tags, annotations, option layout, and key bindings remain authoritative.

The current CM6 integration disables native typing activation and calls `startCompletion` after each eligible key release. CM6 deliberately delays explicit starts by 50 ms, which accounts for the measured regression.

The normal path will use supported native activation:

- Enable `activateOnTyping`.
- Set `activateOnTypingDelay` to zero.
- Record the initiating key so the existing PuzzleScript excluded-key behavior remains intact.
- Treat mobile, virtual-keyboard, and IME input without a conventional key code as eligible.
- Suppress the legacy keyup call when CM6 already observed a real `input.type` transaction.

The explicit keyup path remains only as a compatibility fallback for eligible events that do not produce native typing activation, including reopening completion after Backspace or Delete and legacy paste/cut paths. That rare path may retain CM6's 50 ms explicit-start delay. CM6 internals and artificial typing transactions are not used.

Completion continues to require exact parser state. Rapid typing must not display results from an obsolete document version. Tests cover excluded punctuation, Backspace/Delete, paste, composition/IME, German keyboard-sensitive cases, rapid multi-character entry, and every existing completion-navigation shortcut.

### 5. Token presentation and dynamic colours

The custom decoration layer remains because PuzzleScript produces arbitrary parser style identities and dynamic hex colours that cannot be represented by a fixed highlight theme without losing information.

Visible token decorations will be rebuilt only when:

- The editor is mounted with exact syntax available.
- The viewport moves to different text.
- Exact parsing advances far enough to replace mapped decorations for the current viewport.
- The document or language is deliberately reset or reconfigured.

The existing `DecorationSet` will be reused unchanged for cursor movement, selection, focus/blur, autocomplete selection, and search UI transactions that do not change the document. Search Replace and Replace All are normal document-changing transactions and follow the edit path.

On a document change, prior decorations are immediately mapped through the change. When the viewport becomes exact, they are replaced with newly generated marks. The integration must not intentionally install an empty intermediate set or reintroduce an unstyled frame.

Decoded classes and dynamic-colour decoration objects will be cached per editor and per encoded parser style. The current contrast-adjustment algorithm, CSS classes, inline styles, and duplicate-range protection remain unchanged.

### 6. Programmatic edits, reset, and navigation

Normal commands remain normal CM6 transactions. This includes `replaceSelection`, image paste, search replacement, line movement, comments, undo, and redo.

`replaceDocument(text)` remains undoable and retains the present callback, cursor, scroll, and history semantics. Calls that currently perform `setValue(newSource)` followed immediately by `clearHistory()` may use `resetDocument(text)` instead. The reset operation constructs one `EditorState` with the new document, cursor at the beginning, unchanged extensions, and empty history, then installs it once, scrolls to the beginning, and emits one application-level document/dirty notification.

The reset path is conditional on evidence. It is added only if, after the shared dirty-tracking and decoration improvements, an isolated benchmark shows that it materially beats the existing two-operation sequence and visual tests show no styled flash. Calls that preserve history are never silently converted to resets.

Console error navigation will use one semantic `revealLine` call. CM6 can place the cursor and request `EditorView.scrollIntoView(position, {y: "center"})` in one dispatch, replacing the current sequence of three line scrolls followed by a cursor transaction. Line clipping stays inside the adapter.

### 7. Bundle and delivery

The checked-in bundle remains a minified esbuild IIFE with an external committed source map. Dependencies remain exact pins. `build:codemirror` writes the artifacts and `check:codemirror` verifies byte-for-byte reproducibility. There is no runtime module loader, CDN, or server-side build requirement.

The release build will generate Brotli sidecars for JavaScript, CSS, HTML, and text files using text mode and maximum compression quality. It will stop generating gzip sidecars. Original uncompressed files always remain present.

Both `.htaccess` files will:

- Serve a matching `.br` sidecar only when `Accept-Encoding` contains `br`.
- Set `Content-Encoding: br` while preserving the original MIME type.
- Merge `Vary: Accept-Encoding`.
- Fall back to the uncompressed original when Brotli is not accepted or the sidecar is missing.

Obsolete CM5 editor CSS and addons will be removed from the production page only after confirming that no remaining rule contributes to layout parity. CM5 artifacts required by frozen comparison fixtures remain outside the production dependency path.

Build verification will decompress every generated `.br` file and compare it byte-for-byte with its original. HTTP smoke tests cover Brotli responses, raw fallback, MIME types, `Vary`, and missing sidecars.

## Verification and rollout

Implementation remains in `.worktrees/codemirror6-streamlanguage-design` on `codex/codemirror6-streamlanguage-design`. The work will be staged as separate, reviewable commits in this order:

1. Add benchmark instrumentation and capture fresh baselines.
2. Introduce the semantic adapter and structural dirty tracking.
3. Restrict long-line rollback copying and retain the safe exact prefix.
4. Switch autocomplete to immediate native activation with fallback.
5. Gate and cache token-decoration rebuilding.
6. Add the measured document-reset path if justified.
7. Add Brotli delivery and remove confirmed-obsolete production assets.

After every stage:

- Run parser, autocomplete, command, search, interaction, adapter, and bundle unit tests.
- Run Chromium, Firefox, and WebKit automation.
- Compare Chrome and Safari layout, fonts, wrapping, search, autocomplete, scrolling, and token interactions.
- Repeat the no-unstyled-frame regression test.
- Record the isolated benchmark effect and remove changes that do not help.

Benchmark sources include the small default source, a representative real game, the existing approximately 130 KiB stress document, and long-line fixtures around the 10,000-character boundary. Scenarios include normal and rapid typing, completion opening/updating/deleting/accepting, distant jumps with intervening edits, search navigation and replacements, 100 API edits, undoable replacement, history-clearing reset, and heap use.

Measurements use warmups, repeated runs, medians, and 95th percentiles. Chrome four-times CPU throttling is used where it provides a useful headroom gate. The final report will show frozen CM5, pre-optimization CM6, and optimized CM6 side by side, including raw, comparison-only gzip, and production Brotli sizes.

An optimization may not land if it changes parser output, completion results, shortcuts, history behavior, dynamic colours, token actions, or the agreed visual geometry. Any unavoidable difference returns to design review rather than being accepted during implementation.
