# Gameforge reference

## Publish gates (all required for `publishable`)

| Gate | Pass condition |
|------|----------------|
| `compile` | `out/game.txt` compiles cleanly (`puzzlescript_cpp compile … --diagnostics`, no `error` in output) |
| `solved_set` | Every kept level has a non-empty recorded solution |
| `curriculum` | At least `min_levels_per_band` levels in each `spec.bands` entry |
| `non_trivial` | Every solution length ≥ `min_solution_length` (default **5**) |
| `anti_dupe` | No near-duplicate boards (same dimensions, cell agreement ≥ `near_dupe_threshold`, default **0.92**) |
| `win_exercised` | Solutions exercise win via play (not already-won start states) |
| `theme_shell` | Title; author/prelude/message; legend covers level glyphs; sprites for all objects |
| `design_log` | `out/design_log.md` present |

## Report statuses

| `report.status` | Meaning | Runner exit code |
|-----------------|---------|------------------|
| `publishable` | All gates passed; ship `out/game.txt` | 0 |
| `playable_incomplete` | Compiles + some solved levels; curriculum/gates incomplete | 1 |
| `mechanic_only` | Mechanic selected; level mining failed | 1 |
| `failed_mutate` | No candidate or seed passed compile/smoke | 2 |
| `error` | Invalid job package, tooling crash, or missing binaries | 2 |

## CLI: `tools/gameforge/run.js`

```text
node tools/gameforge/run.js <jobDir> [--cpp BIN] [--generator BIN] [--simplify BIN] [--solver BIN]
```

Defaults (under repo root): `build/native/puzzlescript_cpp`, `puzzlescript_generator`, `puzzlescript_simplify`, `puzzlescript_solver`.

**Makefile launch:**

```bash
make gameforge JOB=build/gameforge/jobs/<id>
```

**Tests:**

```bash
make gameforge_unit_tests      # schema + gates (no native bins)
make gameforge_smoke_tests     # end-to-end smoke fixture
make gameforge_tests           # both
```

## Default curriculum bands

| Band | Dimensions |
|------|------------|
| `tiny` | 3×2 |
| `small` | 4×3 |
| `medium` | 5×4 |

Default `min_levels_per_band`: **1**. Generator blocks use Sokoban-shaped `choose` rules; see `tools/gameforge/lib/curriculum_gen.js`.

## Default `spec.json` fields

| Field | Default |
|-------|---------|
| `wall_clock_ms` | 28800000 (8 h) |
| `max_rule_candidates` | 8 |
| `max_rules_added` / `max_rules_removed` | 3 / 3 |
| `per_solve_timeout_ms` | 2000 |
| `min_solution_length` | 5 |
| `near_dupe_threshold` | 0.92 |
| `smoke_level_count` | 1 |
| `generator_samples` | 200 |
| `generator_jobs` | `"auto"` |
| `selection_policy` | `"max_novelty"` |
| `min_novelty_score` | `1` |
| `min_structural_score` | `1` |
| `reject_vanilla_sokoban` | `true` |
| `reject_stock_sokoban_objects` | `true` |
| `require_structural_delta` | `true` |
| `allow_safe_mode` | `true` iff `candidates` is empty; else `false` |
| `mechanic_intent` | **required** when `candidates` is non-empty |

### Selection / novelty / structure

Candidates must compile + smoke, then pass `evaluateCandidateMechanic`:

- not vanilla single-push Sokoban
- OBJECTS not limited to Background/Player/Wall/Crate/Target
- structural delta vs nearest seed (new object names and/or changed COLLISIONLAYERS) ≥ `min_structural_score`
- rule/win fingerprint novelty ≥ `min_novelty_score`

Among survivors, `max_novelty` ranks by combined rule+structural score. Rejections go to `design_log.md` / `candidateRejections`.

## Example `spec.json`

```json
{
  "prompt": "ice crates on a frozen lake",
  "mechanic_intent": "IceBlock slides after push until Wall; Skater pushes; win all Pad on IceBlock",
  "seeds": ["seeds/sokoban_basic.txt"],
  "candidates": [
    "candidates/c0_ice_slide.txt",
    "candidates/c1_crack_tiles.txt"
  ],
  "selection_policy": "max_novelty",
  "min_novelty_score": 1,
  "min_structural_score": 1,
  "reject_vanilla_sokoban": true,
  "reject_stock_sokoban_objects": true,
  "require_structural_delta": true,
  "allow_safe_mode": false,
  "wall_clock_ms": 28800000,
  "max_rule_candidates": 8,
  "max_rules_added": 3,
  "max_rules_removed": 3,
  "per_solve_timeout_ms": 2000,
  "min_solution_length": 5,
  "near_dupe_threshold": 0.92,
  "smoke_level_count": 1,
  "min_levels_per_band": 1,
  "generator_samples": 200,
  "generator_jobs": "auto",
  "bands": [
    { "name": "tiny", "dimensions": "3x2" },
    { "name": "small", "dimensions": "4x3" },
    { "name": "medium", "dimensions": "5x4" }
  ]
}
```

Paths in `seeds` and `candidates` are relative to the job directory. CI smoke fixture (`tools/gameforge/fixtures/smoke_job/`) lowers `min_solution_length` to **1** and `wall_clock_ms` to **15000** for fast runs.

## Job layout

```text
build/gameforge/jobs/<id>/
  spec.json
  seeds/
  candidates/
  levels.spec.gen
  selected/game.txt      # written by runner
  run/                   # generator/simplify scratch
  out/
    game.txt
    report.json
    design_log.md
```
