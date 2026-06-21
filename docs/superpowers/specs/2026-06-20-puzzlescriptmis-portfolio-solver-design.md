# PuzzleScript+MIS Portfolio Solver Design

## Summary

Replace the PuzzleScript+MIS app's current generated-level scoring search with the PuzzleScript-labs native portfolio solver, called in-process through a reusable native API.

The generator already runs one worker thread per generator. Each worker should keep using its own native solver context, but the solve performed inside that context should be the single-thread adaptive portfolio solver rather than the temporary bounded BFS currently implemented in `NativeGameBridge::solveLayerGrid`.

## Goals

- Use the real native portfolio solver for generated candidate levels.
- Keep the app's current parallelism model: one generation worker owns one solver context.
- Run the portfolio solver single-threaded inside each worker by setting portfolio jobs to one.
- Return the data the generator already needs: solved/exhausted/timeout, effort score, solution inputs, and optional strategy metadata for diagnostics.
- Avoid spawning solver subprocesses or duplicating solver heuristics in the PuzzleScript+MIS bridge.
- Keep the existing PuzzleScript+MIS transformation-language flow unchanged except for replacing the scoring solver.

## Non-Goals

- No UI redesign.
- No change to the generation language syntax.
- No nested solver parallelism inside a generator worker.
- No per-candidate command-line solver invocation.
- No attempt to remove the old PuzzleScript+MIS transformation engine in this slice.

## Architecture

The native solver code should gain a small reusable library-facing boundary. The current CLI solver in `native/src/solver/main.cpp` owns the portfolio search implementation, but PuzzleScript+MIS needs to call it from the app process.

The implementation should extract or wrap the portfolio search behind a native C++ interface, then expose a C API in `native/include/puzzlescript/puzzlescript.h`. The C API should accept:

- a compiled `ps_game`;
- a level index;
- candidate board contents in the same layer-cell-object-id layout already used by `ps_full_state_set_layer_cell_object_ids`;
- solve options including timeout, strategy, portfolio job count, and compact-search flags.

The C API should return an owned solve result containing:

- status: solved, exhausted, timeout, or error;
- expanded/generated counts;
- elapsed time;
- solution inputs when solved;
- strategy and heuristic labels for logging/debugging.

`NativeGameBridge::solveLayerGrid` should become a thin caller of that API using strategy `portfolio` and `portfolioJobs = 1`. The existing per-worker `CandidateSolverContext` remains the app-level concurrency boundary.

## Data Flow

1. A PuzzleScript+MIS generator worker creates one `CandidateSolverContext`.
2. The context owns a cloned native game/bridge so solver state is not shared with the UI bridge or other workers.
3. For each generated candidate, the worker converts the candidate state to a native layer grid.
4. `NativeGameBridge::solveLayerGrid` calls the new native solver API with a per-candidate timeout.
5. The native solver seeds the initial full state from the candidate grid and runs the single-thread adaptive portfolio search.
6. The result is converted back to `CandidateSolveResult`.
7. The generator records solved candidates with effort score and solution inputs, and treats timeout/exhaustion as unsolved for ranking/logging purposes.

## Search Semantics

The default generated-level solve strategy should be the adaptive portfolio solver with one portfolio job. This preserves the solver's single-thread behavior while letting each generator worker run independently.

The effort score should continue to be based on solver work, primarily expanded node count. A timeout is not a solved result; it should not be inserted into the generated-level list as solved, but the generator can keep searching new candidates normally.

## Error Handling

Native solver API failures should return an error status and message rather than throwing across the C boundary. The PuzzleScript+MIS bridge should convert those failures into an unsolved candidate result and preserve the message for logs.

Timeout, exhausted search, and solver errors should remain distinct in the native result so later UI/logging work can explain what happened.

## Testing

The implementation should start with a failing bridge or C API test proving generated-level solving goes through the portfolio path rather than the temporary BFS path. A minimal assertion can check returned strategy metadata for a solved fixture.

Existing generated-candidate tests should still verify:

- a known solvable candidate returns solved with non-empty solution inputs;
- a known blocked candidate does not report solved;
- two worker-owned solver contexts can solve concurrently.

The final verification should include the native CMake tests touched by the bridge and an openFrameworks app build.
