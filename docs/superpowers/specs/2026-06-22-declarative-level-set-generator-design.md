# Declarative Level-Set Generator Design

## Summary

A headless, unattended tool that takes a PuzzleScript game plus a **declarative
spec file** and emits a **complete, runnable PuzzleScript game** whose `LEVELS`
section is filled with generated, solver-verified levels. The spec is a list of
`===`-delimited **blocks**; each block fixes a set of *axes* (e.g. dimensions,
object counts) and exposes *free knobs* as ranges the sampler may wiggle to
maximize difficulty. Within each block the tool keeps the `take` hardest
solvable boards, scored by **MIS difficulty**. Output is written **atomically
and incrementally**, so a run killed at 4am still leaves a valid game containing
whatever was found.

This is an **extension of the existing native `.gen` generator**
(`native/src/generator/main.cpp`), not a new pipeline. The MCTS interactive app
(`tools/puzzlescriptmis-app`) is untouched.

## Motivation

Today the `.gen` generator pins one fixed `INIT LEVEL` grid and exact `choose N`
counts, optimizes for the single hardest board (global top-K), and emits JSON.
The interactive MIS app is the "fancy interface" for hand-driving generation.

We want a *third mode*: hand the tool a game + a small config describing a
**diverse family of level cells**, leave it running overnight, and wake up to a
playable game. Diversity is achieved structurally — the author enumerates blocks
that span the config space (small/large boards, few/many crates, …) — while
difficulty is maximized *locally within each cell*. The config axes therefore
act as **proxies for difficulty**: a 4×4/3-crate elite is inherently gentler
than a 10×10/5-crate elite, so an easy→hard spread falls out for free without an
explicit difficulty-binning heuristic.

## Goals

- A declarative, multi-block spec language extending `.gen` with: `dimensions`,
  `take`, `time` headers; a `prob P` per-cell rule; and a `choose N-M` count
  range.
- Per-block generation: run each block to its own `time` budget; keep its `take`
  hardest **distinct** solvable boards.
- Rank and report difficulty using the **MIS four-lane metric** (min expanded
  across portfolio / Greedy / Weighted A\* / BFS), matching the MIS app.
- Emit a **complete runnable game** to a specified output file: the input game's
  source verbatim with its `LEVELS` section replaced by the generated levels.
- Each generated level is preceded by comments carrying its **difficulty** and a
  **replayable solution input sequence**.
- **Incremental, crash-safe** output: rewrite the output file atomically after
  each new keeper lands.

## Non-Goals

- Auto-sweeping ranges into a grid. The author enumerates cells manually as
  blocks; the tool does not expand `dimensions: 4x4,5x5` into a cross-product.
- Changes to the MCTS interactive app or its transform language.
- `INIT LEVEL`-style pre-placed scaffolding combined with `dimensions` (v1
  synthesizes a blank background grid; templated scaffolding is deferred).
- An LLM / Claude in the generation loop. This is a deterministic CLI; Claude's
  role is to *author spec files* and *review output*, not to generate at runtime.
- Multi-cell `prob` rules (v1 `prob` is single-cell LHS → single-cell RHS).

## Spec Language

A spec file is one or more **blocks** separated by lines containing only `===`
(a leading/trailing separator is allowed and ignored). Each block has a header
section and a rule section, separated by a blank line. Parenthetical
`(...)` comments follow PuzzleScript convention and are ignored.

```
===
dimensions: 3x2        # required — synthesize a 3-wide, 2-tall all-background grid
take: 3                # optional (default 1) — keep the 3 hardest solvable boards
time: 1h30m            # optional (default: --time-ms global) — budget for THIS block
name: tiny rooms       # optional — label used in output comments

prob 0.3 [] -> [ wall ]                                    (~30% of cells become walls)
choose 2-4 [ no wall ] [ no wall no crate ] -> [ target ] [ crate ]
choose 1 [ no wall no crate ] -> [ player ]
===
```

### Header keys

| Key | Required | Meaning |
|---|---|---|
| `dimensions: WxH` | yes | board width × height; synthesizes a W×H grid filled with the game's background object |
| `take: N` | no (default 1) | number of hardest distinct boards to keep from this block |
| `time: <dur>` | no | per-block wall-clock budget; `1h30m`, `45m`, `90s` (h/m/s suffixes). Total run ≈ sum of block budgets |
| `name: <text>` | no | human label echoed into the level comment |
| `seed: N` | no | block seed for reproducibility; otherwise derived from the global `--seed` |

### Rule kinds

Rules apply **top-to-bottom**; each rule observes the board state produced by the
rules above it (identical to existing `.gen` semantics — `prob wall` runs first,
then crates avoid walls, then the player avoids both).

| Form | Semantics |
|---|---|
| `prob P [lhs] -> [rhs]` | For each cell matching `[lhs]`, independently apply `[rhs]` with probability `P` (P ∈ [0,1]). **New.** |
| `choose N [lhs...] -> [rhs...]` | Pick exactly `N` disjoint placements where the LHS cell-tuple matches; apply the RHS tuple. Existing behavior. |
| `choose N-M [lhs...] -> [rhs...]` | Pick a random integer `k ∈ [N, M]`, then choose `k` placements. **New** (the `N-M` range; `choose N` is the `M=N` case). |
| `... or ...` | Alternatives between whole `lhs -> rhs` clauses. Existing behavior (see `sokoban_transform_pairs.gen`). |

Cell-pattern syntax (`[ no wall no crate ]`, etc.) is unchanged and reuses the
existing parser.

## Architecture

### 1. Parser extensions (`native/src/generator/main.cpp`)

- Split input into blocks on `===` lines.
- Parse header `key: value` lines into a per-block config struct (`dimensions`,
  `take`, `time`, `name`, `seed`).
- Synthesize the init grid from `dimensions` (W×H of the game's background
  object) instead of requiring an `INIT LEVEL` ASCII block.
- Extend the rule parser with `prob P` and the `choose N-M` range. `prob`
  produces a per-cell Bernoulli application step in `applyProgram`.
- Parse human durations (`1h30m`) into milliseconds.

### 2. Per-block orchestration

Run blocks **sequentially**. Each block:

1. Builds its synthesized init grid and program.
2. Samples for its `time` budget, using existing `--jobs` worker parallelism
   *within* the block.
3. Solves each sample with the shared MIS core; scores by MIS difficulty.
4. Maintains a per-block top-`take` of **distinct** boards (existing `hashLevel`
   dedupe), with **global** dedupe across blocks so the final game has no
   repeated boards.

The existing top-K / dedupe / event machinery is reused; the change is that
top-K is now per-block (`take`) and bounded by a per-block time budget.

### 3. MIS difficulty (shared)

The four-lane assessment currently lives in the MIS app bridge
(`tools/puzzlescriptmis-app/src/native_bridge/DifficultyAssessment.cpp`). To use
the *same* metric here without duplication, **extract the assessment routine
into shared `native/src/`** (e.g. `native/src/search/difficulty.{hpp,cpp}`) and
have both the generator and the MIS bridge call it. The core already supports
the `max_expanded` cap (added in the multi-difficulty design), which is the
primitive the supplemental lanes need.

Keeper ranking and the reported difficulty both use
`min(expandedPortfolio, expandedGreedy, expandedWeightedAStar, expandedBfs)` over
the lanes that solved.

### 4. Output writer

A module that renders a complete game from (input game source, accumulated
keepers):

- Take the input game's source text **verbatim** and replace its `LEVELS`
  section with the generated levels. All other sections (objects, legend,
  collisionlayers, rules, winconditions, sounds, …) pass through unchanged.
- **Ordering:** blocks in file order (author-controlled progression); within a
  block, ascending difficulty (a natural ramp).
- **Per-level comments** precede each level:
  ```
  (block: tiny rooms (3x2)  difficulty: 1840  seed: 81923)
  (solution: UUDL RARU LULA)
  ```
- **Solution encoding:** reuse `compactSolution` (`up→U down→D left→L right→R
  action→A`), then group characters in **runs of 4 separated by spaces**. If the
  game has `noaction`, `A` never appears.
- **Atomic incremental write:** after each new keeper is accepted (and on block
  completion), re-render the full output game to a temp file and `rename()` over
  the target. A kill at any point leaves a valid, playable game.

### 5. CLI

```
puzzlescript_generator <game.txt> <spec.gen> --out <generated_game.txt> \
    [--seed N] [--solver-timeout-ms N] [--jobs auto|N] [--time-ms N]
```

- `--out` is required (output is always a file, never stdout/in-place; the input
  game is never modified).
- Per-block `time:` in the spec is authoritative for budget; `--time-ms` acts as
  an optional global cap.
- Existing flags (`--seed`, `--jobs`, `--solver-timeout-ms`, `--dedupe-max`)
  carry over.

## Data Flow

```
spec file ──parse──> [block₁ … blockₙ]
for each block (sequential):
   synth init grid ──sample(applyProgram)──> candidate board
   candidate ──solve(MIS four-lane)──> difficulty, solution
   keep top-`take` distinct (global dedupe)
   on new keeper ──> re-render full game ──atomic rename──> <out>
```

## Keeper Validity

- A candidate is eligible only if the MIS solver **solves** it within
  `--solver-timeout-ms` (a solution must exist to print).
- Difficulty = four-lane min expanded.
- Keep the `take` highest-difficulty **distinct** boards.
- Optional per-block `min-difficulty: N` floor to suppress trivial boards is a
  noted future knob, not required for v1 (hardest-N keeping already pushes
  trivial boards out unless nothing harder solved).

## Error Handling

- Spec parse error (bad header, malformed rule, bad duration) → fail fast with
  line number before any generation.
- A block that produces no solvable board within its budget → emit nothing for
  that block, log a warning, continue to the next block.
- Unsolvable / timed-out samples are counted (existing counters) and skipped.
- Output write failure (temp create / rename) → abort with a clear error rather
  than risk a truncated game file.

## Testing

1. **Parser:** multi-block split; header parsing; `prob`, `choose N-M`,
   `dimensions`; duration parsing (`1h30m` → ms).
2. **Semantics:** `prob P` fires on ≈P fraction of matching cells (statistical
   over many samples); `choose N-M` always yields a count in `[N,M]`.
3. **Difficulty parity:** generator's MIS difficulty for a fixed board equals the
   MIS app's for the same board (shared `difficulty` module).
4. **Output validity (key test):** the produced game **compiles and runs** in the
   engine, and **each embedded solution actually solves its level** when
   replayed (the comment's input sequence wins the level).
5. **Crash-safety:** kill mid-run → output file parses and runs as a valid game
   with a subset of levels.
6. **Smoke:** extend the existing generator smoke / preset benchmark with a
   multi-block spec.

## Relation to Prior Work

- **Extends** the native `.gen` generator (`native/src/generator/main.cpp`):
  same sampling (`applyProgram`), solving, dedupe, and event machinery.
- **Reuses** the four-lane difficulty from
  `2026-06-22-puzzlescriptmis-multi-difficulty-design.md`, promoting it into
  shared `native/src/` so the generator and MIS app share one implementation.
- **Does not** alter the MCTS interactive app.

## Approved Decisions

- **Spec shape:** `===`-delimited blocks; per-block `dimensions` (axes, fixed),
  `take`, `time`; free knobs expressed as ranges (`prob P`, `choose N-M`).
- **Diversity model:** author-enumerated blocks (manual cells); difficulty
  maximized within each cell; no auto-grid sweep.
- **Difficulty metric:** MIS four-lane min, for both ranking and the comment.
- **Output:** a complete game written to a required `--out` file (input game
  untouched); `LEVELS` replaced by generated levels; per-level difficulty +
  solution comments.
- **Solution encoding:** `U/D/L/R/A`, grouped in runs of 4 separated by spaces.
- **Crash-safety:** atomic temp-file + rename after each keeper.

## Open Questions (for spec review)

- Within-block ordering: ascending difficulty assumed — confirm you don't want
  hardest-first or file-discovery order.
- Whether `--time-ms` global cap should hard-stop a run that exceeds the summed
  block budgets, or only apply when a block omits `time:`.
