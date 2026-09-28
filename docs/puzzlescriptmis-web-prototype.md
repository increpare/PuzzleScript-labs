# PuzzleScript+MIS web prototype

A browser version of the PuzzleScript+MIS mixed-initiative level designer. It
follows the UX pass on `tools/puzzlescriptmis-app`. The page uses the real
PuzzleScript JavaScript engine for editing and playtesting. Solving and
generating run in Web Workers, by default on the **native C++ compiler and
solver compiled to WebAssembly**, with the JS engine solver as a fallback
(**Solver** menu, or `?backend=js|native`).

## Running it

Workers can't start from `file://`, so serve `src/` over HTTP:

```sh
python3 -m http.server 8000 --directory src      # or: npx http-server src
# open http://localhost:8000/mis.html
# or load a specific game: /mis.html?demo=demo/microban.txt
```

The page opens with the last autosaved session, or the Sokoban demo. Use
**Open…** or drag and drop to load your own `.txt` file.

## What it does

| Area | Behaviour |
| --- | --- |
| Files | Open, drop or pick a demo. **Save** (Ctrl+S) downloads the game, with the transform and tile locks tucked into trailing `(MIS … MIS end)` comments. The file stays valid PuzzleScript, and reopening it restores both. The session is also autosaved to `localStorage`. |
| Source | CodeMirror with PuzzleScript highlighting. It recompiles as you type. Errors are listed per line, and the board keeps the last version that compiled. |
| Board | Painting is layered: each object replaces only what shares its collision layer. Right-drag erases the top object, Alt-click picks up a tile, and Shift-drag replaces the whole tile. A stroke becomes one source edit and one undo step. Object combinations with no glyph get a new legend line automatically. |
| Lock | Paint locked tiles. Transforms never change a locked tile. |
| Play | Playtest in place (arrows/WASD, X, Z, R). |
| Level strip | Thumbnails with a solvability chip for every level, solved in the background. Editing rules re-checks them all, so broken levels show immediately. |
| Status | Solvable, unsolvable or unknown; move count (proven shortest when BFS finishes, otherwise `≈`); effort bar. **Watch solution** animates it. **Blind mode** hides all of this until you reveal it. |
| Transformer | Starting points are derived from the game itself: shuffle the movers found in RULES, add/remove wall-like objects, swap pairs from `all X on Y`, backward design, or a mix. **Peek** shows one unsolved sample instantly. |
| Suggestions | Ranked by hardest, hardest + diverse, longest, or hard with few pieces. Hover to preview (changed tiles outlined), ▶ to watch, 📌 to pin, click to adopt. *Continue from pick* hill-climbs from each adopted suggestion. |
| Throughput | Candidates tried and rate; solved/unsolvable/timeout split; repeat rate; **harder than current per minute** (the thesis's usefulness measure); current solver budget; warnings when the transform runs dry or finds nothing solvable. |
| History | Each level has a branching history: go back to any step, and new edits branch from there. |
| Simplify / Tighten | Remove every object the puzzle doesn't need, or add a wall-like object wherever it's harmless. Both keep the BFS shortest solution length exactly the same, like `native/src/search/simplify.cpp`. |

## Transform language

PuzzleScript rewrite rules plus the MIS `choose` / `option` / `or`
extensions (see the Help tab in the page):

```
[Target no Crate] -> [Target Crate]           (apply everywhere)
option 0.4 [Wall] -> []                        (each match, p = 0.4)
choose 5 [Wall] -> [Crate]                     (5 random matches)
choose 2-6 [Wall] -> []                        (a random count in a range)
choose 20 option 0.4 [Wall] -> []
or option 0.6 [no Wall no Crate] -> [Wall]     (weighted alternatives)
choose 1 [Crate][Target] -> [][]               (separate tiles)
choose 9 horizontal [Player | no Wall] -> [ | Player]
```

## Solver backends

| | Native (WebAssembly), default | JavaScript |
| --- | --- | --- |
| Code | `native/src/wasm/mis_wasm.cpp` over the native compiler, solver, `search/difficulty.cpp` and `search/simplify.cpp` | `MISCore.solve` / `assess` / `simplify` stepping the JS engine |
| Effort metric | The native MIS app's: portfolio primary, then capped greedy / weighted A* / BFS; minimum over the lanes | A* primary, then capped greedy / BFS; minimum over the lanes |
| Speed in Chromium | ~42k states/s per worker | ~29k states/s per worker |

Both backends share the transform language, board handling and UI. The worker
checks that native and JS object tables match for each game and falls back to
JS if they don't, or if the wasm files are missing. Effort numbers aren't
comparable across backends, so results are cached per backend.

Rebuild the wasm (the built files are committed in `src/js/mis/wasm/`):

```sh
source /path/to/emsdk/emsdk_env.sh
make mis_wasm                      # native/wasm/build_mis_wasm.sh
make mis_tests                     # core + native adapter checks
make mis_backend_bench             # JS vs wasm solver comparison
```

Profiling and speed numbers: `docs/benchmarks/2026-09-27-mis-wasm-backend.md`
(backends) and `docs/benchmarks/2026-09-27-mis-generator-profile.md` (the
generator from engine to product, and what changed as a result).

## Generator

`src/js/mis/mis_generator.js` is shared by the workers and
`src/tests/mis_generator_profile_node.js`. For each candidate it runs one
assessment: a primary search, plus the difficulty lanes only when the candidate
could make the shortlist. The generator doesn't prove shortest solutions: the
app proves the suggestion cards on screen instead, on its background worker,
and shows ≈ until then. Each candidate's solver budget starts at 7× the current level's own
solve time and is capped at 20× it (at least 1 s, at most 5 s). It grows
toward the solve times of admitted candidates, so slow candidates can't eat
the run.

Step size adapts automatically: a bandit scales every `choose` count by ⅛–2×
toward whatever has been finding harder-than-current levels fastest. The meter
shows the current choice.

The app runs `hardwareConcurrency − 1` generator workers (`?genWorkers=N`)
and pauses level-health checks while generating.

## Difficulty

MIS effort is the number of states the solver explored: the minimum over
several search strategies, as in the original MIS. It measures what the solver
finds hard, not what a human does. Small levels work best, which matches the
thesis's findings.

## Code

- `src/mis.html`: layout and styles.
- `src/js/mis/mis_core.js`: game model, level ⇄ source mapping, transform
  language, solver, presets and simplify. Runs on the page and in workers.
- `src/js/mis/mis_worker.js`: assess, simplify and generation loops, on either backend.
- `src/js/mis/mis_native.js`: adapter for the WebAssembly native solver (board ⇄ layer-cell grids).
- `src/js/mis/wasm/`: built `mis_native.js` / `mis_native.wasm` (`native/wasm/build_mis_wasm.sh`).
- `src/js/mis/mis_app.js`: the page controller.
- `src/js/mis/mis_shims.js`: headless stand-ins for the graphics/input
  scripts.
- `src/tests/mis_core_node.js`: Node checks for the core and the native adapter.
- `src/js/mis/mis_generator.js`: instrumented generation loop (adaptive step size).
- `src/tests/mis_backend_bench_node.js`: JS vs wasm solver benchmark (`--dump-grids` feeds `native/wasm/mis_wasm_bench_native.cpp` for x86).
- `src/tests/mis_generator_profile_node.js`: per-phase / per-state / harder-per-minute generator profile (`make mis_generator_profile`).
- `src/tests/mis_generator_seed_survey_node.js`: builds the generator benchmark set and runs the generators over it (see below).
- `src/tests/mis_generator_bench_node.js`: the generator benchmark score, comparing versions side by side (`make mis_generator_bench MIS_BENCH_REF=<commit>`).

## Generator benchmark set

Two frozen files, built from `src/tests/solver_tests`:

- `src/tests/mis_generator_seeds.json`: every level the native solver solves
  in under 500 ms (716 levels, 116 games). Built with `… seeds`.
- `src/tests/mis_generator_bench_seeds.json`: the benchmark subset (319
  levels, 103 games). Built with `… cull <survey.json>` from a survey of every
  generator on every seed. The cull drops levels with effort ≤ 10 (too trivial
  to improve on), levels with a hung run, and levels no generator made harder.
  It then keeps at most 4 levels per game (the **cap**), spread over the
  game's difficulty range: the easiest, the hardest and evenly spaced levels
  between. The rule and each game's generators are recorded in the file.

Runs have a candidate budget, not a fixed time: each generator runs until it
has judged 30 candidate levels, taking at least 3 s and at most 15 s. Slow
games get the time they need to be judged fairly.

Run every generator on every benchmark level (~1 h on 4 threads; see
`docs/benchmarks/2026-09-27-mis-generator-bench.md`):

```sh
node src/tests/mis_generator_seed_survey_node.js survey \
  --seeds src/tests/mis_generator_bench_seeds.json --seed 11 --out bench_survey.json
node src/tests/mis_generator_seed_survey_node.js report bench_survey.json
```

Not yet ported from the UX pass: rule-coverage constraints ("the solution must
use rule N") and user-weighted costs (`COST n`).
