# MIS95 Canonicalize Implementation Plan

> Execute inline in this session; preserve concurrent sprite-editor changes.

**Goal:** Tools → Canonicalize replaces the source as one undoable edit.

**Architecture:** Extend the existing emitter with optional display names and
compact headings. A separate workbench tools bundle compiles, canonicalizes,
emits and validates source. The controller applies successful output through
the existing source/document history paths.

**Tech Stack:** Browser JavaScript, shared canonicalizer, esbuild, CodeMirror 6,
Node assertions and Playwright.

- [x] Add failing emitter checks in `src/tests/decanonicalize_node.js` for
  optional names, name collisions, compact headings and semantic round trips.
- [x] Extend `src/js/decanonicalize_core.js` without changing default output;
  keep renaming confined to definitions/rules, never level map rows or metadata.
- [x] Add `src/js/mis/mis_tools_entry.js` with `canonicalize(source)`, validating
  input/output and restoring engine state in `finally`.
- [x] Build the tools alongside the optimizer in
  `scripts/build-mis-optimizer.mjs`; load semantic compilation and the tools
  bundle in `src/mis.html`.
- [x] Add a failing real-browser test in `src/tests/mis_tools_browser.cjs` for
  menu ordering, replacement, immediate edits, keyboard/document undo and redo,
  and invalid source preserving text/history.
- [x] Wire Tools → Canonicalize in `src/js/mis/mis_win95.js` and
  `src/js/mis/mis_app.js`; show source, apply with the existing isolated
  CodeMirror transaction, and compile synchronously.
- [x] Document the command in `docs/mis95.md` and add regression checks to
  `make mis_tests`.
- [x] Run `node src/tests/decanonicalize_node.js`, the tools browser test,
  `node src/tests/mis_editor_browser.cjs`, `make mis_tests` and the web build.
  Stop temporary test servers afterward. Review the final diff and record
  verification results.

Validation completed: emitter and tools Node tests; Chrome canonicalization and
existing editor regression tests; `make mis_tests`; MIS web build; final code
review. The MIS suite exits successfully with existing Node 25 localStorage
shim warnings in the core/rule-goal harnesses. Preferred player-glyph collisions
and validation isolation have dedicated regression coverage.

## Sprite modes follow-up

- [x] Add failing checks for preserved artwork, dominant pixel colours,
  transparent cells, duplicate palette colours, ties, and absent sprite grids.
- [x] Pass representative object visuals and the original default background
  to the emitter. Resolve palette colours to lowercase hex for stable output.
- [x] Add optional grid stripping and dominant-colour selection to object emission.
- [x] Add the second menu command and pass its mode through the controller.
- [x] Verify both menu actions and undo/redo in Chrome; run emitter, tools and
  MIS regression tests, build web assets, review the change and stop the test server.

Sprite follow-up verified: tools and emitter Node tests, both commands with
Chrome undo/redo checks, full MIS suite and web build. Review findings for
explicit transparency and equivalent short/full hex colours are fixed and
covered by regression cases.
