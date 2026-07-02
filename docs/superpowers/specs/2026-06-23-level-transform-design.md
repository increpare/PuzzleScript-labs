# Level Transform Design (maximize / minimize)

Status: proposed.
Date: 2026-06-23.
Branch context: builds on the shipped level simplifier
(`docs/superpowers/specs/2026-06-23-level-simplifier-design.md`) and the same
native search/solver stack.

## 1. Background

The simplifier removes redundant objects while preserving BFS optimal solution
length. Remix and generator output often needs the **inverse** or **targeted**
adjustments:

- **Minimize** named clutter (`Void`, `Crate`, …) without touching walls.
- **Maximize** static geometry (`Wall`) to tighten open levels.
- **Maximize** dynamic objects where safe.

Users should specify **lists of legend names** rather than a single “remove
everything” pass:

```text
--minimize Void,Crate
--maximize Wall
```

This document defines a **level transform** primitive that generalizes
`simplifyLevel()` with explicit maximize and minimize targets, sharing the same
soundness gates (replay + capped BFS optimal-length check).

## 2. Goals and non-goals

### Primary goal

A standalone `puzzlescript-transform` binary (and library API) that loads any
PuzzleScript game, runs configured minimize/maximize passes on every solvable
playable level, and writes a complete output game file.

### Hard invariants (unchanged from simplifier)

- Transformed level must remain solvable.
- `BFS(transformed).length == BFS(original).length`.
- Baseline BFS must complete within timeout or the level is skipped unchanged
  (`complete = false`).
- Non-deterministic games (random rules / randomDir / random entity) are never
  transformed — fail closed, emit unchanged.

### Success metrics

| Metric | Target |
| --- | --- |
| Optimal length preserved | 100% on accepted transforms |
| User-specified object counts move in intended direction | Minimize ↓, maximize ↑ |
| False acceptions (alternate optimal length) | 0 (BFS gate) |
| Wall-fill on remix samples | Visually tighter levels without corridor edits when gates reject path placements |

### Non-goals (v1)

- Solution-envelope / off-path filters for maximize (deferred — v1 uses
  **layer-vacant only**; see §4.3).
- Custom pass ordering (`--pass minimize:…` then `--pass maximize:…`) — fixed
  minimize→maximize pipeline only.
- Bounding-box crop, difficulty preservation, graph isomorphism.
- `--maximize-scope` / `:offpath` suffixes (noted in §10).
- Generator keeper hook (same deferral as simplifier).
- JS / editor integration.

## 3. Equivalence criterion

Same as simplifier **Goal A**: **BFS optimal input count unchanged**.

- **Minimize trial:** clear `(layer, x, y)` for a matching object.
- **Maximize trial:** place a concrete object on `(layer, x, y)` on that
  object’s collision layer.

Accept only if replay of the reference solution still wins **and** capped BFS
reports the same optimal length.

## 4. Algorithm

### 4.1 Baseline

Identical to simplifier §4.1:

1. Layer grid from `LevelTemplate`.
2. Uncapped (timeout-bounded) baseline BFS → `optimalLength`, `baselineExpanded`.
3. `trialMaxExpanded` derived from baseline × `bfsExpandedFactor` (min floor 64).
4. Reference solution from portfolio solve is used for **replay** and **trace
   classification** only; baseline BFS sets authoritative optimal length.

### 4.2 Name resolution

CLI lists contain comma-separated **legend names** (case as in source):

```text
--minimize Void,Crate
--maximize Wall,Beam
```

Each name resolves to one **transform target**:

| Field | Meaning |
| --- | --- |
| `name` | Original legend string |
| `objectIds` | Concrete object id(s) to place/remove (aggregates expand to member objects; pick lowest id for maximize placement) |
| `layer` | Collision layer of the primary object (for maximize vacancy check) |
| `mode` | `minimize` or `maximize` |

Resolution reuses compiled-game tables (`objectsById`, `aggregateMaskTable`,
`synonymMaskTable`, `propertyMaskTable`) — same semantics as the legend section.
Resolution failure for a name → hard error at startup (do not silently skip).

**Player protection:** objects in `game.playerMask` are never minimize targets,
regardless of list contents.

### 4.3 Candidate rules (v1)

#### Minimize target `T`

A **deletion candidate** is each occupied cell `(layer, x, y, objectId)` where
`objectId` is in `T`'s resolved id set.

No “vacancy” concept — if the object is present on that layer cell, it can be
tried for removal.

#### Maximize target `T`

An **addition candidate** is each cell `(x, y)` where:

> **`T`'s collision layer is unoccupied** (`layerGrid[offset] == -1`).

Objects on other layers at the same `(x, y)` are ignored. No solution-trace
filter in v1 — **including cells on the main path** — because the replay + BFS
gates reject placements that block the puzzle or change optimal depth.

This matches the user-facing rule: *“just restricting to cells where that layer
isn't already occupied by something.”*

#### Trace envelope (minimize only)

Reuse simplifier trace classification for **minimize** passes when
`useTraceBatch = true` (default):

- Outside-envelope → batch (+ bisect on failure).
- Inside-envelope → single forward pass.

**Maximize** v1: no batch/bisect by envelope — single forward pass over all
layer-vacant cells (ordering §4.5). Batch maximize can be added later if needed.

### 4.4 Pass pipeline

For each playable level (after baseline succeeds):

```
1. minimizeTargets = expand(--minimize list in order)
   for each target in minimizeTargets:
       run minimize to fixed point on that target   // repeat until zero accepts

2. maximizeTargets = expand(--maximize list in order)
   for each target in maximizeTargets:
       run maximize to fixed point on that target
```

**Fixed point:** repeat the phase-1/phase-2 loop until a full pass makes zero
acceptances.

Default when lists omitted:

| CLI | Behaviour |
| --- | --- |
| neither list | no-op (`objectsChanged = 0`, level unchanged) |
| `--legacy-simplify` or `make simplify` shim | equivalent to minimize-all-non-player, no maximize (current simplifier) |

### 4.5 Ordering heuristics

**Minimize (inside-envelope):** reuse simplifier §4.3 ordering.

**Maximize:** try layer-vacant cells in deterministic order:

1. Sort by `(layer, y, x)` ascending.
2. Optional tie-break: cells farther from player spawn last (cheap Manhattan
   distance) — improves wall-fill aesthetics without excluding path cells.

Correctness does not depend on order.

### 4.6 Trial gates

Same two gates as simplifier §4.4, evaluated on the **current working board**:

1. **Replay** reference solution (solver mode).
2. **Capped BFS** — solved and `length == optimalLength`.

Counters: `replayRejections`, `bfsRejections`, `bfsCalls`, `candidatesTried`.

### 4.7 Semantics

**Minimize:** set target layer cell to empty (`-1`); rebuild `LevelTemplate`.

**Maximize:** set target layer cell to chosen `objectId`; rebuild
`LevelTemplate`. Lower-layer objects (Background, Void, Target, …) remain.

## 5. API

New module: `native/src/search/transform.hpp` / `transform.cpp`.

Shared internals with `simplify.cpp` (extract to `transform_common.cpp` or
anonymous namespace in one translation unit):

- `bfsSolve`, `replaySolutionWins`, `buildSolutionTrace`, `tryModifySet`,
  `bisectRemove` (minimize batch path).

```cpp
namespace puzzlescript::search {

struct TransformTarget {
    std::string legendName;
    std::vector<int32_t> objectIds;
    int32_t layer = -1;
};

struct TransformOptions {
    std::vector<TransformTarget> minimize;
    std::vector<TransformTarget> maximize;
    int64_t bfsTimeoutMs = 5000;
    uint64_t bfsMaxExpanded = 0;
    double bfsExpandedFactor = 2.0;
    bool useTraceBatch = true;
};

struct TransformResult {
    LevelTemplate level;
    int32_t optimalLength = -1;
    int64_t baselineExpanded = -1;
    int32_t objectsAdded = 0;
    int32_t objectsRemoved = 0;
    int32_t candidatesTried = 0;
    int32_t replayRejections = 0;
    int32_t bfsRejections = 0;
    int32_t bfsCalls = 0;
    bool complete = false;
};

TransformResult transformLevel(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& referenceSolution,
    const TransformOptions& options);

// Shim — current simplifier behaviour.
inline TransformOptions legacySimplifyOptions() {
    TransformOptions opts;
    // minimize all non-player occupied cells (special sentinel or empty maximize)
    opts.minimize = {TransformTarget{.legendName = "*"}};
    return opts;
}

SimplifyResult simplifyLevel(...); // delegates to transformLevel + maps result

} // namespace
```

The `*` minimize sentinel means “all objects except player mask” (current
simplifier candidate set).

## 6. Binary and Makefile

### 6.1 `puzzlescript-transform`

```text
puzzlescript-transform <in.ps> --out <out.ps>
    [--minimize NAME[,NAME...]]
    [--maximize NAME[,NAME...]]
    [--legacy-simplify]          # mutually exclusive with explicit lists
    [--solver-timeout-ms N]      # default 2000 (consider raising to 30000)
    [--transform-timeout-ms N]   # per-trial BFS cap timeout; default 5000
    [--bfs-expanded-factor F]
```

Per-level stdout:

```text
level 3: removed 12, added 45, optimal 24
level 5: skipped (unsolved)
```

### 6.2 `puzzlescript-simplify` / `make simplify`

Keep as a **thin alias**:

- `puzzlescript-simplify` → `puzzlescript-transform --legacy-simplify`
- `make simplify` unchanged; optionally document `make transform` wrapper.

### 6.3 Output serialization

Reuse simplifier output path:

- Supplemental legend glyphs when co-located cells need new glyphs
  (`ensureSupplementalGlyphs`).
- Preserve original source rows when `objectsAdded + objectsRemoved == 0`.
- Emit updated `(solution: …)` after re-assess.
- Patch `LEGEND` when supplemental glyphs added.

## 7. Performance

Same trial cap story as simplifier §7: per-trial BFS capped at
`max(64, baselineExpanded × factor)`; cap hit ⇒ reject trial.

Maximize may require more trials than minimize on large open levels (many
layer-vacant cells). Wall-fill on a 16×15 remix level is O(cells × gates) in
the worst case; acceptable for offline post-processing.

## 8. Testing

### Unit (`native/tests/transform_level.cpp`)

1. **Minimize Void** — whaleworld-style micro-level; void count decreases.
2. **Maximize Wall** — open level; wall count increases; optimal length same.
3. **Maximize on path rejected** — wall placement that would block solution →
   BFS or replay rejects; wall not added.
4. **Minimize blocking crate** — same as simplifier blocking test.
5. **Pipeline** — minimize Void then maximize Wall; both counters > 0.
6. **Legacy simplify shim** — matches existing `simplify_level` tests.
7. **Idempotency** — second transform with same options changes zero objects.

### Smoke

Extend or mirror `run_simplify_smoke.js` → `run_transform_smoke.js` with
`--minimize Void --maximize Wall` on a remix fixture.

## 9. Relationship to simplifier spec

| Simplifier | Transform |
| --- | --- |
| Minimize all non-player | `--legacy-simplify` or `minimize=*` |
| Maximize | not supported |
| Named lists | `--minimize` / `--maximize` |
| Trace batch | minimize only (v1) |

The simplifier spec remains the reference for gate correctness and expansion-cap
soundness. This spec adds maximize semantics and named-target filtering only.

## 10. Future extensions

- **`--maximize-scope offpath`** or **`Wall:offpath`** — exclude solution trace
  envelope for static objects; dynamic objects remain layer-vacant everywhere.
- **Auto static heuristic** — infer off-path maximize from rule movement analysis.
- **Batch maximize** outside envelope (mirror minimize phase 1).
- **Bounding-box crop** after minimize+maximize wall fill.
- **Generator `--transform-on-keep`** hook (same coupling concerns as simplify).
- **Raise default `SOLVER_TIMEOUT_MS`** in Makefile once transform is primary
  remix tool.

## 11. Resolved decisions

| Question | Decision |
| --- | --- |
| Pass order | Minimize each target to fixed point, then maximize each target to fixed point |
| Maximize candidate (v1) | Layer vacant for target object only |
| Path / envelope filter (v1) | None — gates enforce safety |
| Minimize candidate | Occupied cells matching named legend target |
| Name syntax | Comma-separated legend names; compiler resolution |
| vs simplifier binary | New `transform`; simplify is alias |
| Equivalence | BFS optimal length (Goal A) |
