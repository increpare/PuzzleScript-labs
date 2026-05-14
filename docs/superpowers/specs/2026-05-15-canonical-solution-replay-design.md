# Canonical Solution Replay Design

## Purpose

Add a focused regression test for static-analysis solver optimizations that project away too much information.

The test answers one question: if the solver finds a solution in the static-optimized semantic canonical form of a focus level, does that exact input sequence still solve the original, non-canonical level?

This is different from comparing optimized and baseline solver results. A projected game can hide important distinctions and still look internally consistent. Replaying the projected solution in the original game catches the case where canonicalization or static optimization omitted a solver-relevant difference.

## Existing Context

The repository already has the pieces this should reuse:

- `src/tests/solver_focus_group.json` lists a checked-in focus group of reasonably quick solver targets.
- `src/tests/run_solver_tests_js.js` can solve only the focus manifest targets.
- `src/canonicalize.js` can build semantic canonical JSON with `staticOptimizations: "all"`.
- `src/decanonicalize.js` can rehydrate semantic canonical JSON into PuzzleScript source.
- `src/tests/solver_static_opt.js` owns pass parsing for `inert`, `cosmetic`, `cosmetic-rules`, `merge`, and `all`.

The new framework should be a correctness test, not a benchmark. It should fail loudly on the first unsound replay.

## Selected Approach

Create a dedicated Node harness:

```text
src/tests/run_canonical_solution_replay.js
```

Default inputs:

- Corpus: `src/tests/solver_tests`
- Focus manifest: `src/tests/solver_focus_group.json`
- Canonical mode: semantic
- Static optimizations: `all`
- Timeout: same default as the JS solver focus path unless overridden

For each focus target `(game, level)`:

1. Read the original game source from the corpus.
2. Canonicalize it with:

   ```js
   canonicalizeSource(originalSource, "semantic", {
       staticOptimizations: "all",
       sourcePath: game
   })
   ```

3. Rehydrate that canonical JSON with `decanonicalizeSemantic`.
4. Solve the same level index in the rehydrated canonical game.
5. If the canonical solve succeeds, replay the exact solution input tokens against the original game and level.
6. Fail if replay does not reach the original win condition.

The harness checks projected-solution soundness. It does not require that every focus target must solve within the timeout unless the canonical solver reports a solved result. Canonical compile failures, original compile failures, and missing focus targets are test failures.

## Replay Semantics

Replay must use the real PuzzleScript runtime path, not a reconstructed evaluator.

The harness should load the original source, jump to the target level, then apply the canonical solution tokens through the same input path used by the solver. After every input it may allow the normal engine turn/again behavior to settle exactly as the solver does. At the end, the check is the original runtime's win state for that level.

The replay check should be strict about input identity:

- `up`, `down`, `left`, `right`, and `action` are replayed as the same tokens returned by the canonical solve.
- The original replay must not search, trim, repair, or extend the solution.
- A canonical solution for a message level is ignored only if the target itself is a message level; focus targets should normally be playable levels.

Random-rule games are already excluded from the current focus-mining manifest. If a future manifest includes random behavior, the first version should fail with a clear unsupported-random diagnostic rather than silently treating nondeterministic replay as proof.

## CLI

The initial CLI should be small and scriptable:

```text
node src/tests/run_canonical_solution_replay.js <corpus>
  --solver-focus-manifest <manifest>
  --timeout-ms <n>
  --static-optimizations <pass-list>
  --strategy <solver-strategy>
  --quiet
  --json
```

Defaults:

- `--solver-focus-manifest src/tests/solver_focus_group.json`
- `--timeout-ms 500`
- `--static-optimizations all`
- `--strategy portfolio`

The JSON output should include per-target rows with:

- `game`
- `level`
- `canonical_status`
- `canonical_solution`
- `canonical_solution_length`
- `original_replay_status`
- `error`, when present

Human output should be concise and failure-oriented. A failing row must include game, level, canonical solution, and why the original replay did not solve.

## Make Target

Add a Make target:

```text
solver_canonical_replay
```

It runs the harness against `$(SOLVER_FOCUS_CORPUS)` and `$(SOLVER_FOCUS_MANIFEST)` with `$(SOLVER_FOCUS_TIMEOUT_MS)`.

The target should be independent at first. It can later be added to a broader static-analysis or solver suite after runtime is known and failures are stable.

## Tests

Use test-driven implementation.

First add a tiny fixture-level regression for the harness itself:

- a small original game where a supplied solution wins
- a supplied wrong solution fails
- the replay checker reports the failed replay with the target game and level

Then add the focus-manifest path:

- the harness loads the existing focus manifest
- it canonicalizes with static optimizations
- it solves canonical targets
- every canonical solution replays successfully against the original source

The first implementation can share solver helpers by exporting small functions from `run_solver_tests_js.js` only if that stays tidy. If exporting creates churn in that file, keep the new harness self-contained and reuse the existing PuzzleScript Node environment plus canonicalize/decanonicalize modules.

## Failure Policy

A target fails when:

- the original game cannot compile
- semantic canonicalization fails
- decanonicalization produces a source that cannot compile
- the focus manifest references a missing game or invalid level
- canonical solve returns `solved`, but original replay does not win
- replay raises a runtime error

A target does not fail solely because canonical solving times out. Timeouts should be reported so the focus set can be tuned, but the soundness property only applies to solutions the canonical solver actually finds.

## Later Work

Later improvements can add:

- pass-by-pass matrix runs for `inert`, `cosmetic`, `cosmetic-rules`, and `merge`
- replay snapshots that compare original and projected state after each input
- native solver integration, if native starts solving static-optimized canonical sources directly
- manifest mining filters that prefer targets exercising static optimization telemetry

Those are useful, but the first slice should stay centered on the exact projected-solution replay invariant.
