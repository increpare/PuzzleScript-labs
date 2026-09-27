# PuzzleScript+MIS web prototype

A browser version of the PuzzleScript+MIS mixed-initiative level designer. It
follows the UX pass on `tools/puzzlescriptmis-app`. It runs on the real
PuzzleScript JavaScript engine: one copy on the page for editing and
playtesting, and one per Web Worker for solving and generating.

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

## Difficulty

MIS effort is the number of states explored: weighted A* proves the level
solvable, then greedy and BFS run capped at the A* count + 6, and the effort is
the minimum over the three. It measures what the solver finds hard, not what a
human does. The JS engine explores a few thousand states per second per
worker, so small levels work best, which matches the thesis's findings.

## Code

- `src/mis.html`: layout and styles.
- `src/js/mis/mis_core.js`: game model, level ⇄ source mapping, transform
  language, solver, presets and simplify. Runs on the page and in workers.
- `src/js/mis/mis_worker.js`: assess, simplify and generation loops.
- `src/js/mis/mis_app.js`: the page controller.
- `src/js/mis/mis_shims.js`: headless stand-ins for the graphics/input
  scripts.
- `src/tests/mis_core_node.js`: Node checks for the core.

Not yet ported from the UX pass: rule-coverage constraints ("the solution must
use rule N"), user-weighted costs (`COST n`), and the native solver backend.
