# VS Code PuzzleScript Level Studio Design

## Goal

Build a coherent PuzzleScript+MIS-style Level Studio inside the existing VS Code extension. The Studio should let a designer keep the normal VS Code text editor for `game.txt`, then use an adjacent webview to browse/edit levels, solve/replay them, run long generation batches, inspect candidates, and adopt generated levels back into the open document.

The first host is the VS Code plugin. The UI should still be structured as a webview core talking through host adapters, so a standalone app can reuse the same product model later.

## Product Shape

The Studio opens from a command such as `PuzzleScript: Open Level Studio` while a PuzzleScript-looking document is active. `.txt` files are first-class PuzzleScript files for this workflow; `.ps` and `.puzzlescript` remain supported.

The VS Code editor remains the code editor. The Studio webview opens beside it and has two top-level tabs:

- **Levels:** level browser, glyph-based board editor, solver run/replay, and effort metrics.
- **Candidates:** generation recipe controls, long-running generation batch state, timeout promotion queue, live top candidates, replay/adopt controls, and solved top-3 sidecar logging.

All source edits apply to the open VS Code document buffer, not directly to disk. Unsaved document contents are the source of truth for solving and generation. The user saves to disk through normal VS Code save behavior.

## Initial UI Layout

The Studio webview should use a quiet, tool-like layout that fits beside a VS Code editor.

Levels tab:

- left rail: playable level list with status badges
- center: glyph board editor and paint palette
- right inspector: compile status, solver controls, latest solve metrics, and replay scrubber

Candidates tab:

- left rail: recipe editor and run controls
- center: live candidate grid, sorted by solved effort score with a separate timeout/unknown area
- right inspector: selected candidate metadata, solution replay, adopt/insert controls, and generation progress counters

The webview should preserve the user's selected level, selected candidate, and current tab while the panel remains open. It does not restore that UI state after the panel is closed.

## Architecture

The extension host owns privileged operations:

- reading and editing the active VS Code document buffer
- spawning native solver/generator binaries
- writing temporary source/spec files for native commands
- appending sidecar logs
- cancelling running jobs
- forwarding structured progress/results/errors to the webview

The webview owns UI state and interaction. It should not call native binaries directly.

Proposed modules:

- `LevelStudioPanel`: opens the webview, routes messages, observes the active document, and disposes/cancels jobs.
- `LevelStudioCore` webview assets: Levels and Candidates tabs, state model, controls, and rendering.
- `PuzzleScriptDocumentModel`: derives playable levels, source ranges, legend glyphs, diagnostics, and editable level text from the current document. It should reuse existing extension intelligence and generator-core helpers where possible.
- `SolverRunner`: writes the current in-memory document to a temp file, invokes `puzzlescript_solver`, parses JSON output, and returns status, solution, effort metrics, and errors.
- `GeneratorScheduler`: manages the live generation batch, timeout promotion, ranking, progress, and cancellation.
- `GeneratedLevelsLog`: appends solved top-3 candidate snapshots to `<game>.generatedlevels.txt`.

Message flow:

```text
webview action
  -> extension host service
  -> document edit, native process, temp file, or sidecar append
  -> structured message back to webview
```

## Levels Tab

The Levels tab lists playable levels from the active document's `LEVELS` section. Selecting a level shows a glyph-based board editor.

Editing model:

- Paint using glyphs that map cleanly through the `LEGEND` section.
- Edits replace the selected level text in the open VS Code document buffer.
- The first version is glyph-based only. It does not need object/layer toggling.
- If a cell cannot be represented by a single known glyph, preserve the source text and warn rather than making a lossy edit.

Solver workflow:

- Solve the selected level using the current in-memory document text.
- Show `solved`, `timeout@budget`, `exhausted`, or compile/error states.
- Show solution inputs, solution length, effort score, and raw metrics such as `expanded`, `generated`, and `uniqueStates` when available.
- Replay a solution with a board scrubber. This is replay/inspection, not a breakpoint debugger.

## Candidates Tab

The Candidates tab is a live generation workbench, not a restored history browser.

A generation batch starts from one exact snapshot:

- current in-memory source text
- selected source level
- recipe text
- solver settings
- generation options
- seed

If the user changes source text, selected board, recipe, or generation settings while a batch is running, the current batch stops and a fresh batch starts from the new snapshot.

Jobs run only while the VS Code webview/extension session is open. Closing the app/window stops active jobs. Live candidate state is not restored on reopen.

## Candidate Evaluation And Ranking

Each generated candidate gets a stable `level_hash` and is deduped within the current batch.

Initial evaluation uses a cheap solver budget. Solved candidates enter a solved ranking by **effort score**. For v1, the effort score is the native solver's `uniqueStates` metric, with raw metrics shown alongside it.

Timeouts are valuable and should not be discarded. They remain visible in the Candidates tab and are automatically promoted through larger solver budgets.

Timeout promotion:

- Use budget tiers such as `1s -> 5s -> 30s -> 2m`.
- Keep a bounded promotion queue so one hard candidate cannot gridlock generation.
- Prioritize by solver effort plus simple diversity.
- Diversity is the grid cell difference count against already-promoted or already-kept candidates in the same generation batch. Width and height are expected to match inside a generation group.

This is an anytime/progressive budget scheduler. It does not require solver frontier checkpoint/resume in v1. A later native solver could add true checkpointing without changing the product model.

## Sidecar Generated-Level Log

Generated candidates are not all written to disk. The sidecar log is an append-only record of notable solved candidates.

Path:

```text
<game>.generatedlevels.txt
```

For a source file named `game.txt`, this produces `game.generatedlevels.txt` beside it.

Append rule:

- Only solved candidates are logged.
- A candidate is appended exactly once when it first enters the current batch's top 3 solved candidates.
- Deduplicate by `level_hash`; never append the same generated level twice.
- Timeout candidates are never logged unless a later promoted evaluation solves them and they enter the solved top 3.

Each appended block should include:

- timestamp
- batch id or run id
- source file basename
- source level index
- recipe snapshot or compact recipe summary
- solver strategy and budget at solve time
- effort score
- raw solver metrics
- solution inputs
- `level_hash`
- generated level text

Use a plain text block that is easy to paste back into a PuzzleScript file:

```text
===== GENERATED LEVEL <timestamp> =====
source_file: game.txt
batch_id: <id>
source_level: <zero-based index>
level_hash: <hash>
rank_when_logged: <1..3>
effort_score: <uniqueStates>
solver_status: solved
solver_strategy: <strategy>
solver_budget_ms: <budget>
solution_length: <n>
solution: up right down ...
expanded: <n>
generated: <n>
unique_states: <n>
recipe:
  <recipe lines indented two spaces>
level:
<generated level rows>

```

The sidecar is not automatically imported into the Candidates tab on reopen. It is an artifact for external reading/searching/editing.

## Native Tool Integration

The Studio should use current in-memory document contents, not only saved disk files. Runners write temporary files from the VS Code document buffer before invoking native tools.

The existing generator runner pattern already does this and should be reused where possible.

Expected binaries:

- `build/native/puzzlescript_solver`
- `build/native/puzzlescript_generator`

If binaries are missing, show the resolved path and a build command such as `make build_solver` or `make build_generator`.

The current native generator ranks solved candidates by `uniqueStates` and emits top-K JSON. The Studio design extends the host-side scheduling/ranking behavior to include timeout promotion and solved top-3 sidecar logging. Native generator changes may still be useful later if streaming candidate events are needed.

For v1, timeout promotion and top-3 logging live in the extension host scheduler. The native generator can stay as the candidate producer and first-pass evaluator unless implementation discovers that streaming per-candidate events require a small native JSON-lines/progress extension.

## Error Handling

- If the current document does not compile, show diagnostics and disable solve/generate actions until compilation succeeds.
- Solver timeout is a normal candidate state, not an error.
- Invalid generator recipes show a recipe error while preserving the last valid displayed candidates until a new run starts.
- Native process failures show stderr and the command/binary path that failed.
- Document edits during generation cancel the current batch and start a new batch from the new snapshot.
- Closing the webview cancels running jobs.

## Testing

Extension unit tests:

- `.txt` PuzzleScript detection and Studio command eligibility
- playable level extraction and range replacement
- glyph-to-level-text edits
- sidecar log path derivation
- solved top-3 append behavior and `level_hash` dedupe
- restart-on-edit behavior for live batches
- solver/generator JSON parsing and progress event parsing

Webview/model tests:

- candidate ranking by effort score
- timeout promotion tiers
- bounded promotion queue behavior
- diversity by grid cell difference count
- solved top-3 log trigger exactly once per candidate

Existing native tests remain the gates for solver/generator correctness:

- `make solver_smoke_tests`
- `make generator_smoke_tests`
- relevant solver parity/determinism tests when native behavior changes

Manual VS Code smoke:

1. Open a PuzzleScript-looking `game.txt`.
2. Open Level Studio beside the editor.
3. Edit a glyph in the Levels tab and verify the VS Code document becomes dirty.
4. Solve the selected level and replay the solution.
5. Start a generation batch.
6. Confirm solved top-3 candidates append once to `game.generatedlevels.txt`.
7. Edit the source/recipe and confirm the running batch restarts from the new snapshot.

## Non-Goals For V1

- Standalone app packaging.
- Full in-webview PuzzleScript code editor.
- Breakpoint/debugger replacement.
- Object/layer-based board editing.
- Restoring Candidates tab history from `game.generatedlevels.txt`.
- Logging every generated candidate.
- True solver frontier checkpoint/resume.
- Human difficulty modeling beyond transparent solver effort metrics.

## Later Extensions

- Standalone host using the same webview core and host adapter concepts.
- Native streaming JSON-lines candidate events if host-side scheduling becomes awkward or inefficient.
- True solver checkpoint/resume for timeout promotion.
- Object/layer board editing for cells that do not map cleanly to a single glyph.
