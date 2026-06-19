# PuzzleScript+MIS Engine Bridge Design

## Summary

Vendor the permitted `bvoq/puzzlescriptmis` source into this repository as a standalone openFrameworks app under `tools/puzzlescriptmis-app/`, keep its front-end as the application shell, and replace its incomplete PuzzleScript parser/runtime with the native PuzzleScript-labs compiler and engine.

The first milestone is intentionally narrow: get normal PuzzleScript source loading, compiling, rendering, editing, and play working through our engine inside the PuzzleScript+MIS app. Solver, generator, and transformation-language parity are deferred until the engine bridge is stable.

## Goals

- Preserve the existing PuzzleScript+MIS openFrameworks interface and interaction flow as much as possible.
- Link the app against the PuzzleScript-labs native compiler/runtime in-process.
- Compile `.txt` PuzzleScript source with `puzzlescript_compiler`.
- Run play state through `puzzlescript_native`.
- Expose enough game metadata to the existing UI: objects, names, colors, sprites, levels, messages, current state, undo/restart/load-level, and player input.
- Keep file saving user-driven. The app should not write the edited game source unless the user explicitly saves.
- Disable transformer/generator entry points with a clear not-yet-wired state in the first milestone so compile/play integration stays focused.

## Non-Goals

- No VS Code plugin work.
- No web rewrite.
- No attempt to preserve the old PuzzleScript+MIS parser, engine, solver, or generator internals.
- No first-milestone port of the PuzzleScript+MIS transformation language.
- No first-milestone solver or generator integration.
- No automatic source-file rewrite on compile, play, or level editing.

## Architecture

The vendored PuzzleScript+MIS app remains the outer application. Its openFrameworks event loop, drawing code, editor layout, level browser, and input handling stay recognizable.

The core replacement happens behind an adapter layer called `NativeGameBridge`. The bridge owns native compiler/runtime handles and presents UI-facing operations that resemble the old `Game` struct closely enough for the existing front-end to migrate incrementally.

The native side should be linked as libraries, not invoked as subprocesses:

- `puzzlescript_compiler` for source parsing, diagnostics, and runtime lowering.
- `puzzlescript_native` for compiled game metadata, full-state creation, stepping, undo, restart, level loading, messages, hashes, object sprites, and colors.

The old PuzzleScript+MIS parser and engine can remain in the vendored source temporarily as reference code while call sites move onto `NativeGameBridge`, but they are not the production core.

## Adapter Responsibilities

`NativeGameBridge` should provide a small, explicit surface:

- Compile source text and retain diagnostics.
- Report whether a compiled game is playable.
- List levels and message screens.
- Load a level by index.
- Step the current play state for PuzzleScript inputs.
- Undo, restart, and advance levels.
- Expose current mode: level, message, or title.
- Query board width, height, and cell contents for rendering.
- Query object metadata for drawing: name, layer, colors, sprite pixels.
- Convert between native state snapshots and the UI's level-editor representation.

The bridge should avoid exposing raw native internals to openFrameworks UI code. UI code should ask the bridge for snapshots and commands; the bridge should own lifetime and conversion details.

## Data Flow

1. The app loads or edits a PuzzleScript `.txt` source.
2. The bridge compiles the source through `puzzlescript_compiler`.
3. Diagnostics are converted into editor-visible messages with line numbers where available.
4. On successful compile, the bridge creates a native full state from the compiled game.
5. The UI renders levels and objects by querying bridge snapshots.
6. Player input is translated to `ps_input` and stepped through `puzzlescript_native`.
7. Undo, restart, level switching, and message progression call native runtime APIs through the bridge.
8. If the user edits a level, the bridge updates the in-memory editor representation. Source-file persistence still waits for an explicit save action.

## Generator And Transformer Handling

PuzzleScript+MIS's transformation language is valuable and likely more expressive than the current PuzzleScript-labs generation recipe format. It should be treated as a later compatibility target, not replaced casually.

For the first milestone, transformer/generator entry points should be disabled with a clear "not yet wired to native engine" state. The engine bridge should not depend on solving the transformation-language port.

Later work can add a native `TransformProgram` compiler that preserves the user-facing PuzzleScript+MIS transform syntax while using native data structures internally.

## Error Handling

PuzzleScript source compile errors should appear in the existing editor error area, with the best available line number and message. Native exceptions or C API errors should be converted into plain diagnostics rather than escaping into the UI loop.

Runtime operations should fail closed. If level loading, stepping, or snapshot conversion fails, the app should keep the previous usable state and display an error instead of leaving partially updated UI state.

Transformer/generator errors are out of scope for the first milestone except for clearly communicating that those features are not yet wired to the native backend.

## Threading

The first milestone should keep compile/play operations on the main app flow unless a compile operation proves slow enough to require backgrounding. The bridge should be designed so future solver/generator jobs can run on worker threads using immutable compiled-game handles and cloned state snapshots.

No worker thread should call openFrameworks drawing/input APIs or mutate UI state directly.

## Testing

The implementation plan should include focused checks at three levels:

- Native library checks already present in PuzzleScript-labs, to confirm the compiler/runtime still pass their existing tests.
- Bridge-level tests or small harnesses that compile a known game, load a level, step inputs, and inspect board snapshots.
- Manual app smoke tests in the openFrameworks shell: load a simple game, compile, view sprites/levels, move, undo, restart, switch levels/messages, and save only when requested.

The first milestone is complete when a representative PuzzleScript game can be opened in the PuzzleScript+MIS app, compiled by the native backend, displayed by the existing UI, and played through normal inputs without depending on the old PuzzleScript+MIS engine.
