# Static Analysis Explorer UI Refactor Design

## Context

The static analysis explorer is currently a statically generated HTML page built by `make static_analysis_explorer`. Recent work added useful data and more tabs, but the UI still feels inconsistent and difficult to understand. The main problem is not a missing individual column or label. It is that corpus browsing, object tables, rules, layers, rulegroups, rule flow, winconditions, and source annotations each use slightly different layout and interaction patterns.

The refactor should keep the output static: `build/static-analysis-explorer/index.html` remains a self-contained generated page with embedded JSON, CSS, and JavaScript. No runtime server should be required after generation.

## Goals

- Make every game-detail tab feel like part of the same report system.
- Keep each tab as its own report, with content appropriate to its domain.
- Introduce generic, reusable UI widgets rather than hand-rendering every tab.
- Make rows sortable wherever sorting is meaningful.
- Improve comprehension by giving every report a purpose, consistent summaries, typed columns, and row-level explanations.
- Preserve the corpus overview as a fast skim/outlier finder.
- Preserve source annotations, but make them part of the same selection and inspector model as the reports.

## Non-Goals

- Do not convert the explorer into a hosted app or require a web server after generation.
- Do not replace the static analyzer or change the meaning of analysis tags.
- Do not build a heavy frontend framework pipeline.
- Do not force all tabs into one identical table schema. Tabs may remain separate reports.

## Architecture

The explorer should become a small static UI system with four layers:

1. Analyzer output: `ps_tagged`, facts, source text, and compile metadata remain the source of truth.
2. Explorer model normalization: server-side summarizers produce UI-friendly data, including friendly labels, source-line ranges, previews, relations, and inspector payloads.
3. Report definitions: each report declares its title, purpose, summaries, columns, rows, default sort, notes, empty state, and inspector content.
4. Client-side widgets: reusable widgets render and interact with the normalized reports.

The client should not reverse-engineer semantic meaning from raw tags. If a row needs an explanation, relation, source mapping, or consequence, the model should provide it in a stable shape.

## Reusable Widgets

### Explorer Shell

The shell owns the top-level state:

- selected game
- active view
- active report
- corpus search/filter
- per-report sort state
- selected row/cell/source annotation
- inspector content

The shell should preserve state across tab switches where reasonable, especially active game and report sort state.

### Corpus Matrix

The corpus tab remains an overview table/matrix for scanning games. It should use the same visual treatment as report tables where possible:

- readable headers that wrap instead of cropping
- hover and cursor affordances for game-name cells
- sortable metric headers
- compact but not cramped cells
- metric cells that open inspector content
- game-name cells that navigate to the selected game

### Report Shell

Every game-detail report uses the same anatomy:

1. report header: title and one-sentence purpose
2. summary strip: consistent label/value chips
3. optional toolbar: filter, sort reset, column hints, or report-local controls
4. body: sortable table, source list, or specialized report body
5. notes/empty state: consistent placement and wording

Reports may differ in columns and rows, but not in framing, spacing, summary treatment, or interaction rules.

### Sortable Table

The sortable table widget owns:

- column sizing
- header wrapping
- sort markers
- default sort
- toggling ascending/descending
- row selection
- empty values
- typed cell rendering

Rows should be sortable by default unless a column explicitly opts out. Sorting should be stable and deterministic.

### Source Viewer

The source viewer is a specialized report body, not a separate UI style. It should use:

- the same report shell
- line-number treatment matching line columns in tables
- source annotations rendered as selectable chips
- hover/title or inspector details for compiled rules in a source rulegroup
- the same selected-row/inspector model as tables

### Inspector

The inspector is shared across corpus metrics, report rows, cells, and source annotations. It should answer:

- what is this thing?
- what did static analysis conclude?
- why is it useful or what optimization/invariant does it imply?
- where did it come from in source or compiled rules?
- what related objects, rules, layers, rulegroups, winconditions, or source lines are relevant?

The inspector should avoid raw ids as the only explanation. Raw ids may appear, but friendly labels, previews, and source context should accompany them.

## Column Types

Report definitions should use reusable column types:

- line: right-aligned source line number or `compiled`, never prefixed with `line`
- id: compact stable identifier, with a friendly preview when needed
- text/preview: wrapped text with consistent truncation and expansion through inspector
- boolean: consistent yes/blank or status chip treatment
- status: proved/candidate/rejected/unknown or report-specific status values
- count: right-aligned numeric values
- tag list: compact chips for static/cosmetic/temporary/etc.
- relation: links to related rows or source lines

These column types should make rules, layers, rulegroups, rule flow, winconditions, objects, and source annotations feel related even when their report content differs.

## Reports

The first refactor should define reports for:

- facts overview, if useful as a game-level summary
- objects
- rules
- layers
- rulegroups
- rule flow
- winconditions
- source

Objects should remain a matrix-like dense report if that works best, but it should still be rendered through shared column definitions and sort state. Rules, layers, rulegroups, rule flow, and winconditions should use the shared report table. Source should use the shared report shell with a source-list body.

## Error Handling And Empty States

Reports should have consistent empty states:

- no rows
- no source mapping available
- no rule flow candidates
- no winconditions
- no inspector selection

The wording should say what is absent and why it matters. It should not leave a blank area or show a raw empty list.

Compile-error or analysis-unavailable games are currently filtered out of the explorer model. If unavailable games are later shown, they should use the same report shell with an analysis-unavailable state.

## Static Generation

`make static_analysis_explorer` should continue to generate a static page. The generated HTML may embed:

- normalized model JSON
- report definitions or report-definition factories
- reusable UI widget JavaScript
- CSS for the report system

The refactor should not add a bundler requirement. If the script grows too large, it should be decomposed inside `src/tests/build_static_analysis_explorer.js` first, or into nearby Node modules if that is cleaner.

## Testing

Tests should cover both model shape and generated UI behavior:

- report definitions exist for expected tabs
- all report definitions use the shared shell/table/source primitives
- important columns are typed and sortable
- corpus headers and object/report headers sort rows correctly
- generated HTML includes the consistent report anatomy
- source rows include rulegroup annotations with compiled-rule details
- empty states render predictably
- generated script parses
- generated page runtime smoke can render corpus and selected game views

Existing `static_analysis_explorer_node.js` should remain the primary fixture test. Generated-page smoke checks should continue to exercise the real corpus output from `make static_analysis_explorer`.

## Acceptance Criteria

- The corpus tab is readable and sortable, with game names behaving like links.
- Every game-detail tab uses the same report header, summary strip, body frame, notes/empty-state placement, and inspector behavior.
- Rows are sortable across report tables unless explicitly disabled.
- Rules and winconditions use `Line` columns with plain line numbers.
- Rulegroups are source-facing enough to interpret: source ranges and rule previews are visible, with deeper compiled details available through inspector.
- Rule flow is a first-class report, not an unexplained bolt-on.
- Source annotations reveal the compiled rule details behind each rulegroup annotation.
- The explorer remains a static generated website.
