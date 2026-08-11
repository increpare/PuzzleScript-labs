# Make PuzzleScript Game Skill Design

Status: approved for spec review  
Date: 2026-08-11  

**Implementation plan:** `docs/superpowers/plans/2026-08-11-make-puzzlescript-game-skill.md`

## Summary

A **project Cursor skill** plus a **durable overnight job runner** (“gameforge”) that turns a natural-language prompt into a **publish-bar PuzzleScript game** (`.txt`). The evening agent drafts a job package; the runner executes long compile/mutate/generate/solve/simplify loops without a live chat session; the morning agent triages a structured report and either accepts the game or proposes a narrow retry.

Mechanics invention is **hybrid**: start from corpus seeds, allow budgeted free mutation with rollback, and fall back to safe-mode remix when mutation fails. Level solvability uses the existing declarative generator, native solver/MIS difficulty path, and level simplifier. Mid-run LLM calls and VS Code Level Studio hosting are out of scope for v1.

## Motivation

PuzzleScript authoring has asymmetric difficulty: sprites and object sets are easy for an LLM; rules are brittle; **solvability** is the hard gate. This repo already has the missing pieces for an agent workflow:

- Large solvable corpus (`src/tests/solver_tests`, `src/tests/good_games`, `src/demo`)
- Compiler diagnostics
- Native solver and portfolio/MIS difficulty assessment
- Declarative multi-block level-set generator (`puzzlescript_generator` + `.gen` specs)
- Level simplifier (`puzzlescript-simplify`)

What is missing is an **orchestration contract**: a skill that knows how to use these tools, and a runner that can own an overnight search with crash-safe artifacts and explicit publish gates.

## Goals

- Full games from a prompt: theme/mechanics → objects → rules → levels → polish shell.
- Hybrid rule invention: corpus seed + budgeted mutation + safe-mode fallback.
- Overnight batch: given prompt + budgets, leave a durable process running; wake to a finished game or a failure report.
- Strict publish bar (see Publish Gates): curriculum, non-trivial solutions, anti-dupes, win exercised, theme shell, design log.
- Two-layer operation: interactive agent drafts and reviews; runner owns long search.
- Reuse existing binaries and pipelines; do not invent new solver/generator algorithms in v1.

## Non-Goals (v1)

- VS Code Level Studio / PuzzleScript+MIS UI as the primary host.
- Mid-run LLM calls during the overnight phase.
- Guaranteeing subjective “fun” beyond structural publish gates (taste is morning review).
- Auto-expanding generator range cross-products beyond what the declarative generator already supports.
- Supporting realtime/random-heavy games when solver coverage is weak (skill must refuse or safe-mode).

## Architecture

```text
[Evening agent + skill]
   -> writes job/ (spec.json, seeds/, candidates/, levels.spec.gen, budgets)
        |
        v
[Durable runner: gameforge]
   phases: validate/select candidates → theme check → gen levels → simplify → publish gates
   atomic artifacts under job/run/ and job/out/
        |
        v
[Morning agent + skill]
   -> reads report.json + final game.txt → accept / narrow retry
```

### Skill vs runner

| Layer | Owns |
|---|---|
| Skill (`.cursor/skills/make-puzzlescript-game/`) | Trigger conditions; seed ranking; authoring mutation **candidates** and `.gen` curriculum; writing `spec.json`; morning triage; never invent solvability claims |
| Runner (`tools/gameforge/` or equivalent) | Validate/select candidates; theme polish if needed; long level mining; simplify; gate evaluation; atomic `out/` writes; resume after kill |

### Existing tool wiring

| Concern | Tool |
|---|---|
| Compile / diagnostics | Existing Node compile path used by tests (or native compile equivalent — one primary path pinned in implementation; keep parity) |
| Level mining | `build/native/puzzlescript_generator` + declarative `.gen` |
| Solve / verify / difficulty | Generator built-in solve path and/or `puzzlescript_solver`; replay-to-win required |
| Simplify | `puzzlescript-simplify` |
| Launch | Makefile target e.g. `make gameforge JOB=...` |

## Job package

One overnight run = one directory, e.g. `build/gameforge/jobs/<id>/`:

| Artifact | Role |
|---|---|
| `spec.json` | Prompt, budgets, gate thresholds, seed list, mutation policy |
| `seeds/` | Copied corpus games used as starting points |
| `candidates/` | Rule-mutation attempts (full `.txt` + compile/smoke log) |
| `selected/game.txt` | Winning mechanics + theme before level mining |
| `levels.spec.gen` | Declarative multi-block generator curriculum |
| `run/` | Generator/solver/simplify logs, keepers, checkpoints |
| `out/game.txt` | Best publishable (or best-effort) game so far |
| `out/report.json` | Machine-readable morning triage |
| `out/design_log.md` | Human-readable tries/rejects |

### Budgets in `spec.json` (v1 knobs)

- Wall-clock limit (mostly level mining)
- `max_rule_candidates` — how many full candidate games the evening agent may leave in `candidates/`
- `max_rules_added` / `max_rules_removed` — per-candidate mutation caps (enforced at triage/select)
- Per-solve timeout
- Generator samples / pass inactivity behavior (aligned with existing generator semantics)
- Min levels per difficulty band
- `min_solution_length` (default 5)
- Near-dupe similarity threshold

## Phase pipeline

**Mutation authorship is front-loaded.** Because v1 forbids mid-run LLM calls, the evening agent (via the skill) writes up to `max_rule_candidates` complete candidate `.txt` files into `candidates/` before launching the runner. The overnight runner does **not** invent new rule text; it validates, selects, themes (if still needed), and mines levels.

Phases run in strict order:

1. **Seed** — Evening agent picks 1–3 corpus games; copies into `seeds/`.
2. **Author candidates** — Evening agent applies budgeted mutations (see Mutation policy) and writes `candidates/*.txt`, each with intended smoke levels embedded or listed in `spec.json`.
3. **Validate / select mechanic** (runner) — Compile each candidate; run smoke + non-degenerate checks (player can move; win not already true at start; at least one rule fires on smoke). Keep the first passing candidate (or best by a simple score). If none pass → **safe mode**: use best seed as `selected/game.txt`.
4. **Theme** — Ensure sprites, legend glyphs, colors, title/prelude/messages align to prompt (evening agent should usually have done this; runner only checks/fills gaps that do not require creative invention — else leave notes for morning).
5. **Generate levels** — Runner writes/runs declarative `.gen` blocks (easy→hard axes); reuse existing keep/`take` + MIS difficulty; run until wall-clock budget or curriculum filled.
6. **Simplify** — Run simplifier on keepers; drop any that break the solution-length invariant.
7. **Publish gates** — Evaluate gates; only then mark `status: publishable`.
8. **Stop** — On budget exhaustion or success; always leave a valid report + best artifact.

The runner never deletes the last good checkpoint. Killing the process leaves the latest atomic `out/` rewrite intact.

## Mutation policy (v1)

Applied by the **evening agent** when authoring `candidates/` (within budget):

- Rename objects
- Recolor / rewrite sprites
- Add at most `max_rules_added` rules; remove at most `max_rules_removed` rules
- Tweak win conditions
- Swap one collision-layer membership

**Forbidden** without falling back to safe mode:

- Unbounded rule rewrites
- Realtime / random-heavy games when solver coverage is weak (skill flags and refuses or safe-modes)

The runner records accept/reject + reason for each candidate in `design_log.md`.

## Publish gates

All required for `report.status = publishable`:

1. **Compile** — Clean compile of `out/game.txt` (errors fail; known-benign warnings configurable).
2. **Solved set** — Every kept level has status `solved` with a recorded input sequence that replays to win.
3. **Curriculum** — At least one keeper in each configured band (bands from `spec.json`, e.g. via block dimensions/counts).
4. **Non-trivial** — No kept level with solution length below `min_solution_length`.
5. **Anti-dupe** — Reject near-isomorphs within the set. v1 metric: same dimensions + high cell-occupancy overlap and/or identical normalized object-count signature (exact threshold pinned in implementation plan).
6. **Win exercised** — Smoke or solution traces show win conditions becoming true via play, not already-true start states.
7. **Theme shell** — Title; at least one author/prelude or message; legend glyphs cover all level objects; sprites present for all objects.
8. **Design log** — Lists seeds, rejected mutations (reason), generation stats, gate pass/fail.

### Report statuses

| `report.status` | Meaning |
|---|---|
| `publishable` | All gates passed; `out/game.txt` is the deliverable |
| `playable_incomplete` | Compiles + some solvable levels, but curriculum/gates incomplete |
| `mechanic_only` | Rules/theme selected; level mining failed |
| `failed_mutate` | No viable mechanic within budget (even safe-mode seed failed smoke) |
| `error` | Tooling crash / missing binaries / invalid job package |

## Skill protocol

**Location:** `.cursor/skills/make-puzzlescript-game/SKILL.md` (+ short `reference.md` for gates/CLI).

**Triggers:** User asks to make/generate/author a PuzzleScript game from a prompt, especially overnight / unattended / publishable.

**Evening:**

1. Interview lightly only if the prompt is empty (theme + vibe); otherwise draft the job immediately.
2. Rank corpus seeds from `src/tests/solver_tests`, `src/tests/good_games`, and `src/demo` by mechanic family + theme keywords (v1: filename + title/prelude grep + optional hand-tagged family map in the skill).
3. Author up to `max_rule_candidates` mutated games into `candidates/` (compile locally while drafting; drop obvious failures).
4. Emit `spec.json`, `levels.spec.gen`, smoke level refs, and budgets.
5. Launch the runner; do not babysit the overnight loop in chat.

**Morning:**

1. Read `report.json` first, then `design_log.md`.
2. If `publishable`: present game path + 3–5 level difficulty/solution highlights; optional light polish only.
3. If incomplete: propose a **narrow retry** (raise samples, loosen one gate, swap seed, or extend wall-clock) — do not restart from a blank prompt unless mutate failed.
4. Never claim publishable without gate evidence in the report.

## Testing

- **Unit:** Job schema validation; gate evaluator on fixture reports.
- **Smoke:** Tiny job (seconds, microban-like seed, one generator block, low samples) must reach `playable_incomplete` or better and write atomic `out/`.
- **Golden:** Fixed seed + fixed mutation budget produces deterministic candidate ordering and stable report fields.
- **CI scope:** Pipeline integrity only — no claim of corpus-wide creative quality.

## Repo touchpoints

| Path | Role |
|---|---|
| `docs/superpowers/specs/2026-08-11-make-puzzlescript-game-skill-design.md` | This design |
| `.cursor/skills/make-puzzlescript-game/` | Agent skill |
| `tools/gameforge/` (proposed) | Durable runner + schema + gate evaluator |
| `Makefile` | `gameforge` launch/resume target |
| `build/gameforge/jobs/` | Job artifacts (generated, not source) |

Exact runner path may move during implementation planning; the job schema and phase contract are the stable interface.

## Alternatives considered

1. **Pipeline skill + job orchestrator (chosen)** — Best fit for overnight + strict publish bar; reuses generator/solver/simplifier.
2. **Corpus-remix factory** — Highest success rate, weak invention; retained as runner **safe mode** when mutation budget is 0 or mutate fails.
3. **LLM-in-the-loop genetic search** — Mid-run model calls; deferred (expensive, flaky, harder to reproduce).

## Open implementation details (non-blocking)

These are pinned in the implementation plan, not redesigns:

- Exact anti-dupe similarity function and thresholds
- Primary compile entrypoint (Node vs native) for the runner
- Default curriculum band definitions for a “standard” overnight job
- Smoke-level embedding format (inline LEVELS in each candidate vs separate smoke fixtures in `spec.json`)
- How aggressively the runner may auto-fix theme-shell gaps without creative invention (vs deferring to morning)
