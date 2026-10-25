# GUI95 feedback — heatmap and text selection

## Context

- Task and project: keep MIS95 editor selections visible on heatmap lines.
- App revision: a8f102ae (static anaylsis); working tree was clean before this change (confirmed outside the sandbox).
- GUI95: installed skill at C:/Users/Anwender/.codex/skills/gui95; revision unknown.
- Platform: Windows, installed Chrome, isolated browser profile; 1360 × 900 viewport.

## Handoff summary

- Unresolved issues: none found in the browser checks.
- Reusable lesson: CodeMirror 6 draws selections below line decorations; use translucent line tints so both remain visible.
- Verification limits: installed Chrome with CSS zoom at 100%, 125%, 150% and 200%; native Electron, other browser engines and operating-system display scaling not checked.

## Finding: opaque line feedback hides text selection

- Status: fixed and verified in the browser.
- Affected control: source/transform CodeMirror 6 editors and rule playback feedback.
- Expected behavior: selection remains visible while heat, active-line, diagnostic, flash or paused-line feedback is present.
- Observed behavior: user reported heatmap painting over selection. Source inspection confirmed opaque backgrounds above CM6's selection layer. An isolated Chrome reproduction also showed opaque active-line, flash and paused-line backgrounds covering the same selection.
- Evidence: src/css/mis-win95.css; src/css/mis-console.css. Before screenshots captured in the hosting workspace's .codex_tmp/heat-selection directory.
- Attempts and outcome: replaced solid line colors with translucent equivalents that reproduce the existing colors over white. The first sandboxed browser run could not access its local server; the isolated check succeeded with elevated execution.
- Resolution: alpha-composite line feedback with the existing focused or unfocused selection background. Preserve text colors, selection geometry, and playback borders.
- Verification: baseline Chrome reproduction confirmed the defect. Focused and unfocused selections now remain visible across all four heat levels, active lines, rule flashes and paused lines; checked rendered screenshots. Keyboard selection, typing and Undo passed. Existing mis_editor_browser.cjs and mis_highlighting_browser.cjs checks passed with no page errors; git diff --check passed. Diagnostics use the same translucent-background fix; no separate diagnostic screenshot was taken. CSS zoom checks passed at 100%, 125%, 150% and 200%.
- Reusable lesson: fix decoration compositing rather than moving an opaque selection layer above the text.
