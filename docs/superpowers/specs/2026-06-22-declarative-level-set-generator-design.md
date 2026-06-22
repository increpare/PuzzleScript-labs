# Declarative Level-Set Generator Design

## Summary

A headless, unattended tool that takes a PuzzleScript game plus a **declarative
spec file** and emits a **complete, runnable PuzzleScript game** whose `LEVELS`
section is filled with generated, solver-verified levels. The spec is a list of
`===`-delimited **blocks**; each block fixes a set of *axes* (e.g. dimensions,
object counts) and exposes *free knobs* as ranges the sampler may wiggle to
maximize difficulty. Within each block the tool keeps the `take` hardest
solvable boards, scored by **MIS difficulty**. The tool **runs until the user
kills it**, sweeping the blocks in repeated **passes**; within a pass each block
generates until an **inactivity timeout** `τ` elapses with no improvement, and
`τ` **doubles each pass** so the search grows ever more patient. Output is
written **atomically
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
  `take`, `weight` headers; a `prob P` per-cell rule; and a `choose N-M` count
  range.
- Per-block generation: keep each block's `take` hardest **distinct** solvable
  boards, mined by repeated round-robin passes with a per-block inactivity
  timeout that doubles each pass.
- Run unattended **until the user stops it** — no time budget; the latest atomic
  write is always a usable game.
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
weight: 2              # optional (default 1) — relative share of global effort
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

### 2. Scheduling: round-robin passes with a doubling inactivity timeout

The tool **runs until the user kills it** — there is no time budget. Because the
output is rewritten atomically after every improvement (§4), stopping it at any
moment yields a valid game with the best levels found so far.

Generation proceeds in **passes** over the blocks **in file order**. Each block
carries resumable state that is **saved between passes**: its kept set (top-`take`
distinct boards), its RNG position, its dedupe set, and its current **inactivity
timeout** `τ`.

A pass visits each block in turn and, for the current block:

1. Resumes that block's generator and keeps sampling → solving → maybe retaining,
   using the existing `--jobs` worker parallelism.
2. A board is an **improvement** when it enters the block's kept set: a new
   distinct board while `take` is unfilled, or a harder board displacing the
   weakest keeper. Each improvement rewrites the output (§4) and **resets the
   block's inactivity timer**.
3. When `τ` elapses with **no improvement**, the block is done for this pass. Its
   `τ` **doubles** (`1m → 2m → 4m → …`), its state is saved, and the sweep moves
   to the next block.

After the last block the sweep loops back to the first — every block now more
patient by one doubling — and repeats **forever** until killed. Dedupe is
**global** across blocks, so the final game never repeats a board.

This doubling inactivity timeout is the *only* deepening mechanism, and it
governs **generation persistence only**: how long to keep rolling the dice on a
block before moving on. It is deliberately **independent of the per-board solver
timeout** (`--solver-timeout-ms`) — a fixed budget for solving one board that
does **not** change between passes.

Reuses the existing sampling, solving, dedupe, and event machinery; the new
pieces are the pass loop with per-block `τ`, per-block (`take`) retention instead
of one global top-K, and the resumable per-block state.

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

The assessment's **per-board solver budget** (wall-clock `--solver-timeout-ms`,
and the `max_expanded` cap that bounds it) is a **fixed** setting for the whole
run — it is *not* escalated by the scheduler. A board the assessment cannot solve
within that budget is simply dropped (it never enters a kept set).

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
    [--inactivity-start 1m] [--solver-timeout-ms N] [--jobs auto|N] [--seed N]
```

- `--out` is required (output is always a file, never stdout/in-place; the input
  game is never modified).
- **No time budget:** the process runs until killed (`SIGINT`/`SIGTERM`); the
  latest atomic write is the result. On signal it finalizes the in-progress
  write and exits cleanly.
- `--inactivity-start`: the initial per-block inactivity timeout `τ₀` (default
  `1m`); doubles each pass. A block's `weight` scales its `τ₀`.
- `--solver-timeout-ms`: fixed per-board solver budget, independent of `τ` and
  unchanged across passes.
- Existing flags (`--seed`, `--jobs`, `--dedupe-max`) carry over.

## Data Flow

```
spec file ──parse──> [block₁ … blockₙ]   (each: synth W×H grid + program + state{kept, rng, dedupe, τ})
loop forever (until killed):
  for block b in file order:
     resume b
     until τ_b elapses with no improvement to b's kept set:
        sample b ──solve(MIS four-lane, fixed --solver-timeout-ms)──> {solved | unsolved}
        if solved and it improves b's kept set (new distinct, or harder than weakest keeper):
           retain; re-render full game ──atomic rename──> <out>; reset b's idle timer
     τ_b *= 2 ;  save b's state ;  next block
```

## Keeper Validity

- A candidate is eligible only if the MIS solver **solves** it within the fixed
  `--solver-timeout-ms` (a solution must exist to print). Difficulty = four-lane
  min expanded.
- A candidate left **unsolved** within that budget (unsolvable, or simply too
  slow) is dropped. The next pass's larger `τ` buys more *sampling attempts*, not
  a larger solver budget — the two are independent.
- Keep the `take` highest-difficulty **distinct** boards per block (global
  dedupe across blocks). An **improvement** is a new distinct board while `take`
  is unfilled, or one harder than the weakest current keeper.
- Optional per-block `min-difficulty: N` floor to suppress trivial boards is a
  noted future knob, not required for v1 (hardest-N keeping already pushes
  trivial boards out unless nothing harder solved).

## Error Handling

- Spec parse error (bad header, malformed rule, bad duration) → fail fast with
  line number before any generation.
- A block that has produced no solvable board yet simply contributes no levels to
  the current output; it is retried every pass (with a larger `τ`).
- Unsolved samples (unsolvable or over the solver timeout) are counted (existing
  counters) and dropped.
- **Signals:** on `SIGINT`/`SIGTERM`, finish the in-progress atomic write and
  exit cleanly (0).
- Output write failure (temp create / rename) → abort with a clear error rather
  than risk a truncated game file.

## Testing

1. **Parser:** multi-block split; header parsing; `prob`, `choose N-M`,
   `dimensions`; duration parsing (`1h30m` → ms).
2. **Semantics:** `prob P` fires on ≈P fraction of matching cells (statistical
   over many samples); `choose N-M` always yields a count in `[N,M]`.
3. **Difficulty parity:** generator's MIS difficulty for a fixed board equals the
   MIS app's for the same board (shared `difficulty` module).
3b. **Scheduler:** a block ends its pass after `τ` of no improvement and `τ`
   doubles for the next pass; an improvement resets the idle timer; per-block
   state (kept set, RNG, dedupe, `τ`) round-trips across passes.
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
  `take`, optional `weight`; free knobs expressed as ranges (`prob P`,
  `choose N-M`).
- **Scheduling:** runs **until killed** (no time budget). Round-robin passes over
  blocks in file order; each block generates until its per-block **inactivity
  timeout** `τ` elapses with no improvement, then `τ` **doubles** for the next
  pass. Per-block state (kept set, RNG, dedupe, `τ`) is saved/restored between
  passes.
- **Solver timeout:** a fixed per-board budget (`--solver-timeout-ms`),
  independent of `τ` and unchanged across passes.
- **Diversity model:** author-enumerated blocks (manual cells); difficulty
  maximized within each cell; no auto-grid sweep.
- **Difficulty metric:** MIS four-lane min, for both ranking and the comment.
- **Ordering:** blocks in file order (author-controlled progression); within a
  block, ascending difficulty (easy→hard).
- **Output:** a complete game written to a required `--out` file (input game
  untouched); `LEVELS` replaced by generated levels; per-level difficulty +
  solution comments.
- **Solution encoding:** `U/D/L/R/A`, grouped in runs of 4 separated by spaces.
- **Crash-safety:** atomic temp-file + rename after each keeper.

## Open Questions (for spec review)

- Initial inactivity timeout `τ₀` default (`1m`?), and whether the per-block
  `weight` multiplier earns its keep for v1 or is over-engineering.
- Optional efficiency: retire (skip) a block that yields zero improvement across
  K consecutive passes, so the ever-growing `τ` isn't burned idling on a config
  that's genuinely exhausted.
