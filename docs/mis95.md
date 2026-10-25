# MIS95

This variant is called **MIS95** and is published at
<https://www.puzzlescript.net/mis95/>. PuzzleScript+MIS was created by
**Kevin De Keyser**; MIS95 is a redesign built on his original tool and
research (<https://dekeyser.ch/puzzlescriptmis/>).

MIS95 is a browser-based mixed-initiative level designer. It
follows the UX pass on `tools/puzzlescriptmis-app`. The page uses the real
PuzzleScript JavaScript engine for editing and playtesting. Solving and
generating run in Web Workers, by default on the **native C++ compiler and
solver compiled to WebAssembly**, with the JS engine solver as a fallback
(**Solver** menu, or `?backend=js|native`).

## Solver preparation

Each worker prepares a private solver ruleset once at initialization. The shared
static analyzer considers every declared object potentially present, including
objects introduced by painting or transforms. Its game-wide tags drive inert
command and cosmetic rule removal, cosmetic object removal, equivalent immutable
object merging, ACTION elimination, and win-relevance pruning. The shared semantic
canonicalizer and source emitter then produce the source compiled by both the JS
and WebAssembly solvers. Editor source, palette, playtesting and transforms keep
their original objects; an explicit provenance map projects candidate boards into
the reduced solver representation, including merges and changes of bitset stride.
When ACTION elimination is the only reduction and the native solver independently
proves it unnecessary, native workers reuse their existing original-game solver
and replay path. This avoids extra projection and validation work for an already
optimized native ruleset.

No authored-level reachability, count, transient-boundary or setup-retirement
facts are consumed. Random games, games with compile errors, and failed solver
preparation retain their original rules. An optimized path is checked in the original
JS game before its result reaches the generator's shortlist or the UI. Native
workers also retain an unoptimized native game for ordinary-runtime validation.
A rejected replay disables that worker's optimized profile and retries with the
original JS rules. Simplify and Tighten edit original object IDs and validate their
trial solves through the same adapter.

`scripts/build-mis-optimizer.mjs` bundles the shared helpers into the checked-in
`src/js/mis/mis_optimizer_bundle.js`; rebuild it after changing those helpers.
The web, full-site and desktop builds run this bundler automatically. The bundle
has no Node or network dependencies and is included in the offline desktop app.
`make mis_tests` covers portable parity, aggregate WIN semantics, board projection,
both backends, required ACTION, editing and fallback. Run
`node src/tests/mis_optimization_browser.cjs` for paired real-worker measurements
and independent original-game replay, including deterministic transformed boards.

## Running it

Workers can't start from `file://`, so serve `src/` over HTTP:

```sh
python3 -m http.server 8000 --directory src      # or: npx http-server src
# open http://localhost:8000/mis.html
# or load a specific game: /mis.html?demo=demo/microban.txt
```

For a deployable build, `make mis_web` runs `compile.js` and writes the whole
site to `bin/`, `mis.html` included; `make mis_web_serve` serves it locally.

The page opens with the last autosaved session, or the Sokoban demo. Use
**Open…** or drag and drop to load your own `.txt` file.

**File → Export as HTML…** writes a single-file playable game, like the
PuzzleScript editor's Export: it fills `standalone_inlined.txt` (built by
`compile.js`, and copied into the MIS web and desktop builds) with the last
source that compiled, without MIS comments. The desktop app asks where to save
it and leaves the recent-files list alone. `src/tests/codemirror6/browser/mis-export.spec.mjs`
exports Microban and plays the file on its own.

## Code editors

Both the game source and transform panels use CodeMirror 6, sharing the main
PuzzleScript editor's pinned runtime, parser, token styling, completion source,
search and editing commands. MIS no longer loads a CodeMirror 5 editor.

Object/property suggestions appear as you type. Ctrl+Space opens completions
manually; arrows select, Enter or Tab accepts, and Escape dismisses the list.
Ctrl+F opens search. Each panel has its own undo history (Ctrl+Z / Ctrl+Y).
Transform completion starts in RULES context using the loaded game's actual
objects and legend; it refreshes when game definitions change, and also offers
`choose`, `option`, and `or` outside cell patterns.

Ctrl-click (Cmd-click on Mac) a level grid in **Game source** to select that
level in the main board and level list. Clicking any row of the grid works.

Draw directly in sprite grids in **Game source**. A faint underline marks each
sprite's brush colour (initially its first colour). Hold Ctrl (Cmd on Mac) and
click a colour in that sprite's palette to select it; the pointer becomes an
eyedropper. Ctrl/Cmd-left-drag paints pixels, and right-drag clears them to `.`.
Each sprite remembers its own brush, and each drag is one undo step. Ordinary
left-clicks and typing still edit the source text.

Browser regression check, with MIS already served:

```sh
node src/tests/mis_editor_browser.cjs http://127.0.0.1:8080
```

It exercises real typing, completion acceptance in both panels, manual hints,
independent undo/redo, search, renamed game objects, comments and diagnostic
navigation. Screenshots are written to `build/mis-editor-checks/`.

## Workspace controls

**Tools → Canonicalize** replaces the game source with valid PuzzleScript emitted
from its semantic canonical form, retaining each surviving object's sprite and
palette. Original object names and casing are retained where possible; merged
objects use one representative's name and artwork. In RULES, a blank line
separates rule groups (a rule and its `+` rules), loop markers included. **Canonicalize (strip sprites)**
instead gives each object its most common pixel colour and omits its sprite grid.
Transparent pixels are ignored; ties use palette order, and entirely transparent
sprites use their first palette colour. Both commands omit decorative section
separators, sounds, descriptive metadata, comments and message text, and validate
the result before applying it. Undo/Redo in the source editor or the workbench
restores the whole replacement.

The code pane and suggestions area have draggable dividers. Focus a divider
with Tab, then use its arrow keys to resize, Shift+arrow for larger steps,
Home to reset, or End for its maximum size. Escape cancels an active drag.
Sizes are remembered in this browser and clamped to the current window.
At narrow widths, the code pane moves below the level designer.

Results keep a fixed area while generation runs. Cards preserve their controls
and keyboard focus when solution proofs arrive; ranking updates pause while
hovering or focusing a card so a suggestion cannot change under your pointer.
Watch and Pin are always visible. These changes do not alter transforms,
generation parents, or solver behaviour.

UI checks (with the site already served):

```sh
node src/tests/mis_ui_browser.cjs http://127.0.0.1:8080
```

This uses installed Chrome through Playwright and saves captures in
`build/mis-ui-checks/`. It checks menus, focus, divider resizing and cancellation,
real native-solver results, and browser work areas/raster scales of 100%, 125%,
150%, and 200%. Those browser checks do not certify Windows OS display scaling.

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
| Transformer | Starting points are derived from the game itself: shuffle the movers found in RULES, add/remove wall-like objects, swap pairs from `all X on Y`, backward design, or a mix. **Auto** (the default when there are several) hands all of them to the generator, which favours whichever is finding harder levels on this level; the meter shows which. **Peek** shows one unsolved sample instantly. |
| Suggestions | Ranked by hardest, hardest + diverse, longest, or hard with few pieces. Hover to preview (changed tiles outlined), ▶ to watch, 📌 to pin, click to adopt. *Continue from pick* hill-climbs from each adopted suggestion. |
| Throughput | Candidates tried and rate; solved/unsolvable/timeout split; repeat rate; **harder than current per minute** (the thesis's usefulness measure); current solver budget; warnings when the transform runs dry or finds nothing solvable. |
| History | Each level has a branching history: go back to any step, and new edits branch from there. |
| Simplify / Tighten | Remove every object the puzzle doesn't need, or add a wall-like object wherever it's harmless. Both keep the BFS shortest solution length exactly the same, like `native/src/search/simplify.cpp`. |

## Rule gutter and rule goals

The Game source editor has a gutter column beside the line numbers. For the
current level it shows what the solution does with each rule line: a faint dot
(never fires), a grey dot (fires; the line is tinted by how often), or a black
dot (needed: every solution fires it). Lines whose rules the solver drops as
cosmetic or sound-only get a flower and can't be toggled. Hovering a mark
explains it; **Watch solution** highlights the rules that fire on each step.
Blind mode hides all of this except the goals.

A rule *fires* on a turn when it changes the level or queues a command, at
level start and in `again` ticks too. Clicking a mark cycles a goal for the
current level:

- **✓ need**: every solution fires the rule.
- **✗ ban**: no solution fires the rule, including roundabout ones. A rule that
  can fire on the way to a win, however pointlessly, breaks it; so the
  mechanic must be unreachable, or make the level unwinnable once it fires.
- then back to no goal.

Both are decided by `MISCore.ruleGoalSearch`: a breadth-first search of the
real game that tracks, per path, which needed rules have fired and whether a
banned one has (the engine's `Rule.prototype.tryApply` / `queueCommands` are
wrapped to report firing). A win reached with a needed rule unfired, or a
banned rule fired, breaks the goals and is returned as a witness. A path that
has fired every needed rule (with no bans set) is not followed further. Bans
have no such shortcut: proving one means exploring every reachable position,
so on large levels the search can run out of budget and answer *unknown*.
Turns that leave the board unchanged still count when they fire a goal rule
(bumping a wall can fire a banned `cancel` rule). The search runs on the JS
engine with the game's original rules, since the solver's reduced rules don't
keep source lines. Random games get no marks.

The solution already found answers some questions for free: a rule it never
fires isn't needed, and a rule it fires isn't banned. The generator applies
those tests first and runs the search only on candidates that pass, rejecting
any it can't prove within 2 s / 200k positions; the meter counts rejects as
"missed rule goals". Flowers use the optimizer's own cosmetic-rule lines
(`cosmeticRuleSourceLines`) plus lines whose every rule is `inert_command_only`.
Goals are saved with the game as `(MIS rule goals <level> … MIS end)` comments,
one `need …` / `ban …` line per rule, keyed by the rule's text.
`node src/tests/mis_rule_goals_node.js` checks the worker side.

## Console, trace and breakpoints

The panel under the board follows the code tab: **Transform** shows the
generator (Suggestions), **Game source** shows the console. Help leaves it as it
was. The console has three tabs, always on, with no prelude flags needed:

- **Output**: compile errors and warnings, then the playtest's events
  (messages, sounds, commands, undo, restart, solved). The line under the
  source editor only summarises ("2 errors — show in Output").
- **Compiled**: what `debug` prints in the editor, one row per source rule
  line, expanding to the rules it compiles to (a line that compiles to a single
  rule just shows that rule), with `startloop`/`endloop` markers and loop
  bodies indented. It scrolls to, and opens, the line under the source cursor.
- **Trace**: what `verbose_logging` prints, one group per playtest move
  (including its `again` turns), plus the rules run at level start and on
  restart when the game has `run_rules_on_level_start`. Hover a row to see the
  board at that moment, with pending movements drawn as arrows; click a row to
  pin it (Esc returns).

Click the margin left of a rule's line number to set a breakpoint. A playtest
move that fires that rule stops there: the board shows the state just after the
rule applied, the designer caption reads **[Break]** (as Visual C++ put
`[break]` in its title), the board banner gives the step ("step 7/9"), and the
line is highlighted. Stepping moves the trace's cursor, so its controls live on
the Trace page: a toolbar above the trace, always there and greyed out until a
move pauses (**N** next, **B** back, **C** continue to the next breakpoint in
the move, **Esc** finish), with a latched **Stop at breakpoints** button and
**Clear**. Nothing above the board appears or disappears when a move pauses;
the movement-key hint is greyed out instead. The move runs to completion before
anything is shown, and pausing is a cursor into its recorded snapshots, so
stepping back is free; the move is committed when the cursor leaves it.

The **Run** menu holds the same commands (enabled while paused), **Toggle
breakpoint** (F9), **Stop at breakpoints** (a checked item; turns them all off
without clearing them) and **Clear trace**, so stepping also works from the
keys or the menu when the Trace page isn't showing.

The console's rows look like a Windows 95 tree view: [+]/[−] boxes, dotted
connector lines, an icon column (breakpoint, current step, error, warning), a
plain Line column and plain text, with no links, italics or colour coding.
Click a row to select it; double-click it to open its line in the source.

Keyboard: the console tabs take arrows and Home/End like the code tabs. Trace and
Compiled are trees with one tab stop each: Up/Down move, Left/Right collapse and
expand, Enter pins a Trace row (or expands a Compiled line) and scrolls the
source to its line; Enter on an Output row opens its line. A focused Trace row previews the board, as hovering does.
<kbd>F9</kbd> in Game source toggles a breakpoint on the cursor's line. Pauses
and steps are announced through a polite live region (`#console-live`). The label
of the row whose board is on show is drawn as selected (navy); the paused step
uses the debugger's yellow and arrow, in the trace and in the breakpoint margin.

Breakpoints go only on rule lines. They are kept by rule text, like rule goals,
so they survive level edits and undo, and move with the rule while you type.
They are saved with the game as a `(MIS breakpoints … MIS end)` comment, one
rule per line. `src/tests/codemirror6/browser/mis-console.spec.mjs` covers the
console in the browser.

The page switches the engine's `verbose_logging` on only around playtest moves
and redirects its logging hooks (`src/js/mis/mis_console.js`); workers never load
that file. The trace keeps the last 200 moves, with board snapshots for the last 40.

## Generating several levels

Generation belongs to each level. Press **Generate** on a starting board, select
another thumbnail, and start that level too. A small navy gear in a thumbnail's
corner shows that level is generating; it is only an indicator (an earlier
clickable ▶ there read as "play this level"). To pause a level, select it and
press **Pause**. The board, transform code,
locks, rule goals, pins and suggestions follow the selected level. **Run → Stop
all generation** pauses every level. All active levels share one bounded worker
pool; changing selection does not restart their searches.

**New…**, beside Duplicate, asks for width and height and creates a background-filled
level with the current transform. Duplicate also copies locks and rule goals.
**Use for all levels** copies the current transform explicitly; afterward each
level can be edited independently. **Add** on a suggestion inserts a new playable
level while its original starting board continues generating.

In Edit mode, drag a white edge or corner handle to resize. The outline previews
the snapped dimensions; release commits one undoable change and Escape cancels.
Focused handles also accept arrow keys. Added cells contain background, and locks
move with their original cells. New/result dimensions are limited to 128 per side.

For overnight exploration, create several sizes, reuse a construction transform
such as `choose 1-3 …`, and start each level. Candidate memory and dedupe storage
are bounded. IndexedDB checkpoints retain up to 64 suggestions and 64 pins per
level, per-level transforms and the latest authored source (including an unfinished
draft). After reopening, collections are restored **paused**; select a level and press
Generate to continue with fresh samples. Search queues and RNG positions
are not restored. Normal game files retain the per-level transforms, locks and
rule goals in MIS comments; add desired suggestions as levels to include them in
the exported game.

The desktop build keeps generation active when minimized, while the computer is
awake. Browser execution depends on the tab remaining available; recovery retains
completed checkpoints if it is suspended or discarded. Rule or solver changes
invalidate old assessments. Structural edits to LEVELS in the source pause jobs
and reset positional settings rather than silently assign them to another level.

Run `make mis_levels_tests` for real-browser checks of simultaneous generation,
selection, pause, board sizing, undo, asynchronous ownership and recovery.

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

On Windows, `make mis_wasm` runs that script with MSYS2 or Git Bash (`/bin/bash`).
Running the `.sh` file on its own follows `#!/usr/bin/env bash`, and Windows often
resolves `bash` to the WSL app alias, which exits with `Bash/Service/E_UNEXPECTED`.
Install [emsdk](https://emscripten.org/docs/getting_started/downloads.html), then
`emsdk install latest` and `emsdk activate latest`. Source `emsdk_env.sh`, or
clone the SDK to `%USERPROFILE%\emsdk` — the script sources that copy when
`em++` is not already on `PATH`.

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

Each candidate applies the written transform once to the generation session's
starting board. `choose` counts are used literally: generation does not silently
scale them or use earlier candidates as parents. Hovering previews a candidate
without changing the starting board. Clicking adopts it; with **Continue from
pick** enabled, generation then restarts from that adopted board.

The generator API retains explicit experimental options `parents: "elite"`
and `adaptive: true` for benchmarks. These opt into reusing earlier candidates
and scaling `choose` counts respectively; the web application enables neither.

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
