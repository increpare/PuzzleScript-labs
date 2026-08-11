# Make PuzzleScript Game Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a durable Node `gameforge` runner plus a Cursor skill that turns an evening-authored job package into an overnight, publish-gated PuzzleScript game.

**Architecture:** Front-load creative mutation into `candidates/` (evening agent). The runner only validates/selects, mines levels via `puzzlescript_generator`, simplifies via `puzzlescript_simplify`, evaluates publish gates, and writes atomic `out/` artifacts. The skill teaches evening packaging and morning triage.

**Tech Stack:** Node.js (no new deps), existing native binaries (`puzzlescript_cpp`, `puzzlescript_generator`, `puzzlescript_simplify`, `puzzlescript_solver`), Makefile, Cursor project skill under `.cursor/skills/`.

**Spec:** `docs/superpowers/specs/2026-08-11-make-puzzlescript-game-skill-design.md`

---

## Pinned decisions (from spec open items)

| Item | Decision |
|---|---|
| Compile entrypoint | `build/native/puzzlescript_cpp compile <game> --diagnostics` (exit ≠ 0 or stderr/stdout containing `error` line ⇒ fail). Replay/win checks use JS `compileGameFile` from `src/tests/run_solver_tests_js.js` only in gate/smoke helpers that need the engine. |
| Anti-dupe | Same width×height and cell agreement ≥ `near_dupe_threshold` (default `0.92`) over all cells. |
| Default curriculum bands | Three generator blocks: `tiny` 3×2, `small` 4×3, `medium` 5×4 (Sokoban-shaped choose rules); `min_levels_per_band: 1`. |
| Smoke format | Each candidate is a full game; its `LEVELS` section’s first playable level(s) are smoke. `spec.json` lists `smoke_level_count` (default 1). |
| Theme gaps | Runner checks theme shell gates only; does not invent sprites/text. Failures become `playable_incomplete` / gate failures for morning. |

---

## File map

| File | Responsibility |
|---|---|
| `tools/gameforge/lib/spec.js` | Load/validate `spec.json`; defaults |
| `tools/gameforge/lib/levels.js` | Parse LEVELS rows, solutions from generator comments, signatures |
| `tools/gameforge/lib/gates.js` | Pure publish-gate evaluation → status + failures |
| `tools/gameforge/lib/select.js` | Compile/smoke/select candidate → `selected/game.txt` |
| `tools/gameforge/lib/generate.js` | Spawn generator with wall-clock; copy keepers |
| `tools/gameforge/lib/simplify.js` | Spawn `puzzlescript_simplify` |
| `tools/gameforge/lib/report.js` | Atomic `out/report.json` + `design_log.md` + `game.txt` |
| `tools/gameforge/run.js` | CLI: `node tools/gameforge/run.js <jobDir>` |
| `tools/gameforge/fixtures/smoke_job/` | Tiny deterministic job for CI smoke |
| `src/tests/run_gameforge_unit_node.js` | Unit tests (schema, gates, anti-dupe) |
| `src/tests/run_gameforge_smoke_node.js` | End-to-end smoke (needs native bins) |
| `.cursor/skills/make-puzzlescript-game/SKILL.md` | Agent protocol |
| `.cursor/skills/make-puzzlescript-game/reference.md` | CLI + gate checklist |
| `Makefile` | `gameforge` / `gameforge_tests` targets |

---

### Task 1: Job spec schema + defaults

**Files:**
- Create: `tools/gameforge/lib/spec.js`
- Create: `src/tests/run_gameforge_unit_node.js`

- [ ] **Step 1: Write the failing unit test**

```javascript
// src/tests/run_gameforge_unit_node.js
'use strict';
const assert = require('assert');
const path = require('path');
const { loadSpec, DEFAULT_SPEC } = require('../../tools/gameforge/lib/spec');

function testLoadSpecDefaults() {
  const spec = loadSpec({
    prompt: 'ice crates',
    seeds: ['src/demo/microban.txt'],
    candidates: ['candidates/c0.txt'],
  });
  assert.strictEqual(spec.min_solution_length, 5);
  assert.strictEqual(spec.near_dupe_threshold, 0.92);
  assert.strictEqual(spec.smoke_level_count, 1);
  assert.strictEqual(spec.min_levels_per_band, 1);
  assert.ok(spec.wall_clock_ms > 0);
  assert.deepStrictEqual(spec.bands.map((b) => b.name), ['tiny', 'small', 'medium']);
}

function testRejectMissingPrompt() {
  assert.throws(() => loadSpec({ seeds: ['a.txt'] }), /prompt/);
}

testLoadSpecDefaults();
testRejectMissingPrompt();
console.log('run_gameforge_unit_node: ok');
```

- [ ] **Step 2: Run test — expect FAIL** (module missing)

```bash
node src/tests/run_gameforge_unit_node.js
```

Expected: `Cannot find module .../tools/gameforge/lib/spec`

- [ ] **Step 3: Implement `tools/gameforge/lib/spec.js`**

```javascript
'use strict';

const DEFAULT_SPEC = {
  wall_clock_ms: 8 * 60 * 60 * 1000,
  max_rule_candidates: 8,
  max_rules_added: 3,
  max_rules_removed: 3,
  per_solve_timeout_ms: 2000,
  min_solution_length: 5,
  near_dupe_threshold: 0.92,
  smoke_level_count: 1,
  min_levels_per_band: 1,
  generator_samples: 200,
  generator_jobs: 'auto',
  bands: [
    { name: 'tiny', dimensions: '3x2' },
    { name: 'small', dimensions: '4x3' },
    { name: 'medium', dimensions: '5x4' },
  ],
};

function loadSpec(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('spec must be an object');
  }
  if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) {
    throw new Error('spec.prompt is required');
  }
  if (!Array.isArray(raw.seeds) || raw.seeds.length === 0) {
    throw new Error('spec.seeds must be a non-empty array');
  }
  if (!Array.isArray(raw.candidates)) {
    throw new Error('spec.candidates must be an array (may be empty for safe-mode)');
  }
  const spec = Object.assign({}, DEFAULT_SPEC, raw, {
    bands: Array.isArray(raw.bands) && raw.bands.length ? raw.bands : DEFAULT_SPEC.bands,
  });
  return spec;
}

function loadSpecFile(fs, filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return loadSpec(raw);
}

module.exports = { DEFAULT_SPEC, loadSpec, loadSpecFile };
```

- [ ] **Step 4: Run test — expect PASS**

```bash
node src/tests/run_gameforge_unit_node.js
```

Expected: `run_gameforge_unit_node: ok`

- [ ] **Step 5: Commit**

```bash
git add tools/gameforge/lib/spec.js src/tests/run_gameforge_unit_node.js
git commit -m "feat(gameforge): add job spec loader with publish defaults"
```

---

### Task 2: Level parsing + anti-dupe

**Files:**
- Create: `tools/gameforge/lib/levels.js`
- Modify: `src/tests/run_gameforge_unit_node.js`

- [ ] **Step 1: Add failing tests**

```javascript
const {
  parsePlayableLevels,
  cellAgreement,
  filterNearDupes,
} = require('../../tools/gameforge/lib/levels');

function testParseSolutionComment() {
  const src = [
    '=======',
    'LEVELS',
    '',
    '(difficulty: 12)',
    '(solution: UURRDDLL)',
    '####',
    '#P.#',
    '#*C#',
    '####',
    '',
  ].join('\n');
  const levels = parsePlayableLevels(src);
  assert.strictEqual(levels.length, 1);
  assert.deepStrictEqual(levels[0].solution, ['up','up','right','right','down','down','left','left']);
  assert.strictEqual(levels[0].rows.length, 4);
}

function testNearDupeFilter() {
  const a = { width: 3, height: 2, rows: ['abc', 'def'] };
  const b = { width: 3, height: 2, rows: ['abc', 'def'] };
  const c = { width: 3, height: 2, rows: ['abx', 'def'] };
  assert.strictEqual(cellAgreement(a, b), 1);
  assert.ok(cellAgreement(a, c) < 1);
  const kept = filterNearDupes([a, b, c], 0.92);
  assert.strictEqual(kept.length, 2); // a kept, b dupe of a, c kept
}

testParseSolutionComment();
testNearDupeFilter();
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `tools/gameforge/lib/levels.js`**

Parse `LEVELS` like `src/tests/run_simplify_smoke.js` (skip messages; read `(solution: …)` compact UDLRA comments; collect row blocks). Export:

- `parsePlayableLevels(source) -> [{ rows, solution, bandHint? }]`
- `levelDims(level) -> { width, height, rows }`
- `cellAgreement(a, b) -> number in [0,1]` (0 if dims differ)
- `filterNearDupes(levels, threshold) -> levels` (stable: keep first, drop later dupes)

Compact map: `U up, D down, L left, R right, A action`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add tools/gameforge/lib/levels.js src/tests/run_gameforge_unit_node.js
git commit -m "feat(gameforge): parse levels and filter near-duplicate boards"
```

---

### Task 3: Publish gate evaluator (pure)

**Files:**
- Create: `tools/gameforge/lib/gates.js`
- Modify: `src/tests/run_gameforge_unit_node.js`

- [ ] **Step 1: Add failing tests for statuses**

```javascript
const { evaluatePublishGates } = require('../../tools/gameforge/lib/gates');

function testPublishable() {
  const report = evaluatePublishGates({
    spec: loadSpec({
      prompt: 'x',
      seeds: ['s'],
      candidates: [],
      bands: [
        { name: 'tiny', dimensions: '3x2' },
        { name: 'small', dimensions: '4x3' },
      ],
      min_levels_per_band: 1,
      min_solution_length: 5,
    }),
    compileOk: true,
    theme: {
      hasTitle: true,
      hasAuthorOrPreludeOrMessage: true,
      legendCoversLevelGlyphs: true,
      spritesForAllObjects: true,
    },
    designLogPresent: true,
    levels: [
      {
        band: 'tiny',
        width: 3,
        height: 2,
        rows: ['###', '#P#'],
        solution: ['left', 'left', 'left', 'left', 'left'],
        solved: true,
        winExercised: true,
      },
      {
        band: 'small',
        width: 4,
        height: 3,
        rows: ['####', '#P.#', '####'],
        solution: ['right', 'right', 'right', 'right', 'right'],
        solved: true,
        winExercised: true,
      },
    ],
  });
  assert.strictEqual(report.status, 'publishable');
  assert.deepStrictEqual(report.failures, []);
}

function testTrivialFails() {
  const report = evaluatePublishGates({
    spec: loadSpec({ prompt: 'x', seeds: ['s'], candidates: [], min_solution_length: 5,
      bands: [{ name: 'tiny', dimensions: '3x2' }] }),
    compileOk: true,
    theme: {
      hasTitle: true,
      hasAuthorOrPreludeOrMessage: true,
      legendCoversLevelGlyphs: true,
      spritesForAllObjects: true,
    },
    designLogPresent: true,
    levels: [{
      band: 'tiny', width: 3, height: 2, rows: ['###', '#P#'],
      solution: ['left'], solved: true, winExercised: true,
    }],
  });
  assert.strictEqual(report.status, 'playable_incomplete');
  assert.ok(report.failures.some((f) => /min_solution_length/.test(f)));
}

testPublishable();
testTrivialFails();
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `evaluatePublishGates(input)`**

Return `{ status, failures: string[], gateResults: { [name]: boolean } }`.

Status rules (first match wins for coarse status, but always collect all failures):

1. If `!compileOk` → failures += `compile`; if no levels ⇒ `error` if `input.toolError`, else `mechanic_only` when `input.selectedOk`, else `failed_mutate`.
2. Else evaluate gates: `compile`, `solved_set`, `curriculum`, `non_trivial`, `anti_dupe`, `win_exercised`, `theme_shell`, `design_log`.
3. If all pass ⇒ `publishable`.
4. Else if any `levels` with `solved` ⇒ `playable_incomplete`.
5. Else if `input.selectedOk` ⇒ `mechanic_only`.
6. Else ⇒ `failed_mutate`.

Gate details:

- `solved_set`: every level `solved === true` and `solution.length >= 1`
- `curriculum`: for each `spec.bands[i].name`, count levels with `band === name` ≥ `min_levels_per_band`
- `non_trivial`: every solution length ≥ `min_solution_length`
- `anti_dupe`: `filterNearDupes(levels, threshold).length === levels.length`
- `win_exercised`: every level `winExercised === true`
- `theme_shell`: all four theme booleans true
- `design_log`: `designLogPresent`

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add tools/gameforge/lib/gates.js src/tests/run_gameforge_unit_node.js
git commit -m "feat(gameforge): pure publish-gate evaluator"
```

---

### Task 4: Candidate compile + select

**Files:**
- Create: `tools/gameforge/lib/select.js`
- Create: `tools/gameforge/lib/compile.js`
- Modify: `src/tests/run_gameforge_unit_node.js` (mockable compile)

- [ ] **Step 1: Failing test with injected runner**

```javascript
const { selectCandidate } = require('../../tools/gameforge/lib/select');

function testSelectFirstPassing() {
  const calls = [];
  const result = selectCandidate({
    jobDir: '/tmp/job',
    spec: loadSpec({ prompt: 'x', seeds: ['seeds/a.txt'], candidates: ['candidates/bad.txt', 'candidates/good.txt'], smoke_level_count: 1 }),
    candidatePaths: ['/tmp/job/candidates/bad.txt', '/tmp/job/candidates/good.txt'],
    seedPaths: ['/tmp/job/seeds/a.txt'],
    compileFile: (p) => ({ ok: !p.endsWith('bad.txt'), errors: p.endsWith('bad.txt') ? ['boom'] : [] }),
    smokeCheck: (p) => {
      calls.push(p);
      return { ok: true, reasons: [], winExercised: true };
    },
    copyFile: () => {},
  });
  assert.strictEqual(result.status, 'selected');
  assert.ok(result.selectedPath.endsWith('good.txt'));
  assert.strictEqual(calls.length, 1);
}

function testSafeModeSeed() {
  const result = selectCandidate({
    jobDir: '/tmp/job',
    spec: loadSpec({ prompt: 'x', seeds: ['seeds/a.txt'], candidates: ['candidates/bad.txt'] }),
    candidatePaths: ['/tmp/job/candidates/bad.txt'],
    seedPaths: ['/tmp/job/seeds/a.txt'],
    compileFile: (p) => ({ ok: p.includes('seeds'), errors: [] }),
    smokeCheck: (p) => ({ ok: p.includes('seeds'), reasons: [], winExercised: true }),
    copyFile: () => {},
  });
  assert.strictEqual(result.status, 'safe_mode');
  assert.ok(result.selectedPath.includes('seeds'));
}

testSelectFirstPassing();
testSafeModeSeed();
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`compile.js`:

```javascript
function compileFileNative(bin, gamePath, spawnSync) {
  const r = spawnSync(bin, ['compile', gamePath, '--diagnostics'], { encoding: 'utf8' });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const ok = r.status === 0 && !/\berror\b/i.test(text);
  return { ok, errors: ok ? [] : [text.trim() || `exit ${r.status}`] };
}
```

`select.js` `selectCandidate(deps)`:

1. For each candidate path: compile → smokeCheck → on success copy to `jobDir/selected/game.txt`, return `{ status:'selected', selectedPath, rejections:[...] }`.
2. Else try each seed the same way → `{ status:'safe_mode', ... }`.
3. Else `{ status:'failed_mutate', rejections }`.

`smokeCheck` default implementation (used by runner, not unit test): parse playable levels; take first `smoke_level_count`; for each, require compile already ok; use injected `solveLevel(gamePath, levelIndex, timeoutMs)` returning `{ solved, solution }`; fail if `!solved` or `solution.length === 0` (already won / empty); `winExercised = solution.length >= 1`.

Wire default `solveLevel` in Task 6/8 via `puzzlescript_solver --json` for a single level if supported, else JS replay harness. **Pin for implementation:** use Node:

```javascript
const { compileGameFile, replaySolutionOnCurrentCompiledState } = require('../../src/tests/run_solver_tests_js');
```

only inside `tools/gameforge/lib/smoke_js.js` (created in Task 5) — not in unit tests.

- [ ] **Step 4: Run unit tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add tools/gameforge/lib/compile.js tools/gameforge/lib/select.js src/tests/run_gameforge_unit_node.js
git commit -m "feat(gameforge): select first compiling smoke-passing candidate"
```

---

### Task 5: JS smoke helper (engine-backed)

**Files:**
- Create: `tools/gameforge/lib/smoke_js.js`
- Test: extend unit tests with a micro fixture string written to temp file **or** skip if too heavy — prefer a tiny committed fixture.

- [ ] **Step 1: Add fixture** `tools/gameforge/fixtures/smoke_job/seeds/microban_snip.txt`

Copy a minimal solvable Microban-like game (player, crate, target, wall, background) with one trivial smoke level that is **not** already won, solution length ≥ 1. Use content adapted from `src/demo/microban.txt` first level only + required sections (objects/legend/collision/rules/win/levels).

- [ ] **Step 2: Implement `smokeCheckJs(gamePath, { smoke_level_count, per_solve_timeout_ms })`**

Algorithm:

1. `compileGameFile(gamePath, { quiet: true })`.
2. For level indices `0 .. smoke_level_count-1` that are playable:
   - If win already true on load (inspect engine win after load — if `winning` or win check API available; else treat solver empty immediate win as fail): reject `win_already_true`.
   - Run bounded BFS/solve via existing corpus solver entry if exported; **simplest v1:** spawn `puzzlescript_solver` with `--timeout-ms` and parse JSON for that level index.
3. Return `{ ok, reasons, winExercised }`.

Pin solver CLI invocation (confirmed against current `--help`):

```bash
build/native/puzzlescript_solver "$game" --timeout-ms 500 --jobs 1 --strategy bfs --json --level N
```

`--level N` is  the playable level index. Prefer also passing `--game` basename if required by the CLI when the path is a single file rather than a corpus dir — confirm with a one-off invocation during Task 5.

- [ ] **Step 3: Manual smoke**

```bash
make build_solver
node -e "const s=require('./tools/gameforge/lib/smoke_js'); console.log(s.smokeCheckJs('tools/gameforge/fixtures/smoke_job/seeds/microban_snip.txt',{smoke_level_count:1,per_solve_timeout_ms:1000,solverBin:'build/native/puzzlescript_solver'}))"
```

Expected: `{ ok: true, ... }`

- [ ] **Step 4: Commit fixture + helper**

```bash
git add tools/gameforge/lib/smoke_js.js tools/gameforge/fixtures/smoke_job/seeds/microban_snip.txt
git commit -m "feat(gameforge): engine/solver-backed candidate smoke checks"
```

---

### Task 6: Generator + simplify orchestration

**Files:**
- Create: `tools/gameforge/lib/generate.js`
- Create: `tools/gameforge/lib/simplify.js`
- Create: `tools/gameforge/lib/curriculum_gen.js` — writes `levels.spec.gen` from `spec.bands` if missing

- [ ] **Step 1: Implement `writeDefaultSokobanGenSpec(spec, outPath)`**

For each band, emit a block like `src/tests/generator_presets/sokoban_levelset_tiny.gen` with that band’s dimensions, `take: min_levels_per_band`, `name: band.name`, and standard choose rules for player + crate/target. Separate blocks with `===`.

- [ ] **Step 2: Implement `runLevelSetGenerator({ generatorBin, gamePath, specPath, outPath, timeMs, samples, jobs, seed })`**

```javascript
spawnSync(generatorBin, [
  gamePath, specPath,
  '--out', outPath,
  '--time-ms', String(timeMs),
  '--samples', String(samples),
  '--jobs', String(jobs),
  '--seed', String(seed || 1),
], { encoding: 'utf8' });
```

Return `{ ok: status===0, stdout, stderr }`. Caller enforces wall clock by passing remaining `timeMs`.

- [ ] **Step 3: Implement `runSimplify({ simplifyBin, inPath, outPath, timeoutMs })`**

Match Makefile:

```bash
build/native/puzzlescript_simplify "$IN" --out "$OUT" --simplify-timeout-ms "$MS"
```

(Confirmed: `puzzlescript_simplify <in.ps> --out <out.ps> [--solver-timeout-ms N] [--simplify-timeout-ms N]`.)

- [ ] **Step 4: Commit**

```bash
git add tools/gameforge/lib/generate.js tools/gameforge/lib/simplify.js tools/gameforge/lib/curriculum_gen.js
git commit -m "feat(gameforge): wrap generator and simplify CLIs"
```

---

### Task 7: Report writer + atomic out/

**Files:**
- Create: `tools/gameforge/lib/report.js`

- [ ] **Step 1: Implement `writeArtifacts(jobDir, { gameSource, report, designLogMarkdown })`**

- Write `out/game.txt.tmp` then `rename` → `out/game.txt`
- Same for `report.json` and `design_log.md`
- `report` must include: `status`, `failures`, `gateResults`, `selected`, `candidateRejections`, `levelSummaries`, `timestamps`

- [ ] **Step 2: Implement `appendDesignLog(lines)` helper used during phases**

- [ ] **Step 3: Commit**

```bash
git add tools/gameforge/lib/report.js
git commit -m "feat(gameforge): atomic out/ artifact writer"
```

---

### Task 8: Runner CLI + Makefile

**Files:**
- Create: `tools/gameforge/run.js`
- Modify: `Makefile` (help + targets)
- Create: `tools/gameforge/fixtures/smoke_job/spec.json`
- Create: `tools/gameforge/fixtures/smoke_job/levels.spec.gen`
- Create: `tools/gameforge/fixtures/smoke_job/candidates/.gitkeep` (safe-mode: empty candidates)

- [ ] **Step 1: Implement `run.js` phase loop**

```javascript
#!/usr/bin/env node
'use strict';
// Usage: node tools/gameforge/run.js <jobDir> [--cpp BIN] [--generator BIN] [--simplify BIN] [--solver BIN]
```

Phases:

1. Load `spec.json` via `loadSpecFile`.
2. Resolve bins (defaults under `build/native/`).
3. `selectCandidate` with real compile/smoke; on `failed_mutate` write report and exit 2.
4. Ensure `levels.spec.gen` (generate default if absent).
5. `runLevelSetGenerator` into `run/generated_game.txt` with `timeMs = min(remaining, spec.wall_clock_ms)`.
6. `runSimplify` → `run/simplified_game.txt` (if simplify fails, keep generated).
7. Parse levels; assign `band` by matching level comment `name:` / dimensions to `spec.bands`; mark `solved` from solution comments; `winExercised = solution.length >= 1`.
8. Theme shell scan (regex/heuristic on source: `title`, `author`/`prelude`/message, legend vs level glyphs — best-effort; set booleans).
9. `evaluatePublishGates`; `writeArtifacts`.
10. Exit 0 iff `publishable`, else exit 1 for incomplete, 2 for failed_mutate/error.

- [ ] **Step 2: Fixture job**

`tools/gameforge/fixtures/smoke_job/spec.json`:

```json
{
  "prompt": "smoke microban",
  "seeds": ["seeds/microban_snip.txt"],
  "candidates": [],
  "wall_clock_ms": 15000,
  "generator_samples": 30,
  "per_solve_timeout_ms": 500,
  "min_solution_length": 1,
  "bands": [
    { "name": "tiny", "dimensions": "3x2" }
  ],
  "min_levels_per_band": 1
}
```

Note: smoke job intentionally lowers `min_solution_length` to 1 so CI can reach `playable_incomplete` or `publishable` quickly. Production skill defaults stay at 5.

Copy seed into fixture; provide one-block `levels.spec.gen`.

- [ ] **Step 3: Makefile targets**

```makefile
.PHONY: gameforge gameforge_unit_tests gameforge_smoke_tests gameforge_tests

gameforge_unit_tests:
	$(NODE) src/tests/run_gameforge_unit_node.js

gameforge:
	@if [ -z "$(JOB)" ]; then echo "Usage: make gameforge JOB=build/gameforge/jobs/<id>"; exit 2; fi
	@$(MAKE) build_solver build_generator build_simplify
	$(NODE) tools/gameforge/run.js "$(JOB)" \
	  --cpp $(PUZZLESCRIPT_CPP) \
	  --generator $(PUZZLESCRIPT_GENERATOR) \
	  --simplify $(PUZZLESCRIPT_SIMPLIFY) \
	  --solver $(PUZZLESCRIPT_SOLVER)

gameforge_smoke_tests: build_solver build_generator build_simplify
	$(NODE) src/tests/run_gameforge_smoke_node.js

gameforge_tests: gameforge_unit_tests gameforge_smoke_tests
```

Add `PUZZLESCRIPT_CPP` if not already defined (path `$(BUILD_DIR)/native/puzzlescript_cpp`).

- [ ] **Step 4: Implement `src/tests/run_gameforge_smoke_node.js`**

Copy fixture to a temp job dir under `os.tmpdir()`, run `run.js`, assert:

- `out/report.json` exists
- status is `publishable` **or** `playable_incomplete` (not `error` / `failed_mutate`)
- `out/game.txt` compiles via `puzzlescript_cpp compile --diagnostics`

- [ ] **Step 5: Run**

```bash
make gameforge_tests
```

Expected: unit ok; smoke reaches playable_incomplete or publishable.

- [ ] **Step 6: Commit**

```bash
git add tools/gameforge Makefile src/tests/run_gameforge_smoke_node.js
git commit -m "feat(gameforge): overnight runner CLI, Makefile, smoke job"
```

---

### Task 9: Cursor skill

**Files:**
- Create: `.cursor/skills/make-puzzlescript-game/SKILL.md`
- Create: `.cursor/skills/make-puzzlescript-game/reference.md`

- [ ] **Step 1: Write `SKILL.md`**

Frontmatter:

```yaml
---
name: make-puzzlescript-game
description: >-
  Authors PuzzleScript games from a prompt via corpus seeds, budgeted rule
  mutation candidates, and the durable gameforge overnight runner (generator,
  solver, simplify, publish gates). Use when the user asks to make, generate,
  or author a PuzzleScript game, especially overnight/unattended/publishable.
---
```

Body must include:

1. Evening checklist: prompt → pick 1–3 seeds from `src/demo`, `src/tests/solver_tests`, `src/tests/good_games` → write `build/gameforge/jobs/<id>/` with `spec.json`, `seeds/`, `candidates/` (≤ `max_rule_candidates`), `levels.spec.gen` → `make gameforge JOB=...`
2. Mutation caps from spec; compile candidates while drafting
3. Do not babysit overnight
4. Morning: read `out/report.json` first; never claim publishable without gates; narrow retry protocol
5. Link to `reference.md` and the design spec path

Keep it concise (skill token budget).

- [ ] **Step 2: Write `reference.md`**

- Gate list (8 gates)
- Report statuses table
- CLI flags for `tools/gameforge/run.js`
- Default band dimensions
- Example `spec.json`

- [ ] **Step 3: Commit**

```bash
git add .cursor/skills/make-puzzlescript-game
git commit -m "feat(skills): add make-puzzlescript-game overnight authoring skill"
```

---

### Task 10: Docs cross-link + final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-make-puzzlescript-game-skill-design.md` — add “Implementation plan” link at top
- Modify: `Makefile` help text if missing from Task 8

- [ ] **Step 1: Add plan link to spec**

```markdown
**Implementation plan:** `docs/superpowers/plans/2026-08-11-make-puzzlescript-game-skill.md`
```

- [ ] **Step 2: Full verify**

```bash
make gameforge_tests
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-make-puzzlescript-game-skill-design.md Makefile
git commit -m "docs: link gameforge skill plan and verify make gameforge_tests"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Two-layer evening/morning | 9 |
| Front-loaded candidates | 4, 8, 9 |
| Safe-mode seed fallback | 4 |
| Generator level mining | 6, 8 |
| Simplify | 6, 8 |
| Publish gates (8) | 3, 8 |
| Report statuses | 3, 7 |
| Atomic out/ | 7 |
| Design log | 7, 8 |
| Makefile launch | 8 |
| Unit + smoke tests | 1–3, 8, 10 |
| Cursor skill | 9 |
| No mid-run LLM / no Level Studio | respected (no tasks) |

---

## Self-review notes

- Anti-dupe, compile entrypoint, bands, smoke format pinned above (no TBDs).
- Solver uses `--level N` (confirmed). Task 5 still verifies single-file game path vs corpus-dir invocation.
- Theme scan is heuristic by design; creative theme fill stays with the evening agent.
