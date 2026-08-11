---
name: make-puzzlescript-game
description: >-
  Authors PuzzleScript games from a prompt via corpus seeds, budgeted rule
  mutation candidates, and the durable gameforge overnight runner (generator,
  solver, simplify, publish gates). Use when the user asks to make, generate,
  or author a PuzzleScript game, especially overnight/unattended/publishable.
---

# Make PuzzleScript Game

Use this skill for prompt → overnight job → publish-gated `.txt` game. Creative mutation happens in the evening; the runner validates, mines levels, and evaluates gates without a live chat session.

## Evening checklist

1. **Prompt** — Capture theme/vibe; skip long interviews unless the prompt is empty.
2. **Seeds** — Pick 1–3 corpus games from `src/demo`, `src/tests/solver_tests`, or `src/tests/good_games` (filename/title/prelude grep for mechanic family + keywords).
3. **Job package** — Write `build/gameforge/jobs/<id>/`:
   - `spec.json` — prompt, budgets, gate thresholds, seed/candidate paths
   - `seeds/` — copied corpus games
   - `candidates/` — up to `max_rule_candidates` full `.txt` mutation attempts (may be empty → safe-mode seed fallback)
   - `levels.spec.gen` — declarative multi-block curriculum (or let the runner write defaults from `spec.bands`)
4. **Compile while drafting** — `build/native/puzzlescript_cpp compile <candidate> --diagnostics` for each candidate; drop obvious failures before launch.
5. **Launch** — `make gameforge JOB=build/gameforge/jobs/<id>` (build native bins first if needed).

## Mutation caps

Honor `spec.json` limits: `max_rule_candidates`, `max_rules_added`, `max_rules_removed`. Allowed: rename/recolor objects, tweak sprites, bounded rule add/remove, win tweaks, one collision-layer swap. Refuse or safe-mode realtime/random-heavy games when solver coverage is weak.

## Overnight

Do **not** babysit the runner in chat. It selects a candidate, mines levels, simplifies, evaluates gates, and writes atomic `out/` artifacts. Killing the process is safe — read the latest `out/report.json`.

## Morning triage

1. Read `out/report.json` first, then `out/design_log.md`.
2. **Never claim publishable** unless `report.status === "publishable"` and all eight gates in `gateResults` are true.
3. **`publishable`** — present `out/game.txt` + 3–5 level/solution highlights; optional light polish only.
4. **Incomplete** — propose a **narrow retry**: raise `generator_samples`, extend `wall_clock_ms`, loosen one gate, swap seed, or add one candidate — do not restart from a blank prompt unless `failed_mutate`.
5. **`failed_mutate` / `error`** — inspect `candidateRejections` and tooling paths; fix job package or binaries, then relaunch.

## References

- Gate checklist, statuses, CLI, defaults: [reference.md](reference.md)
- Design spec: [docs/superpowers/specs/2026-08-11-make-puzzlescript-game-skill-design.md](../../../docs/superpowers/specs/2026-08-11-make-puzzlescript-game-skill-design.md)
- Implementation plan: [docs/superpowers/plans/2026-08-11-make-puzzlescript-game-skill.md](../../../docs/superpowers/plans/2026-08-11-make-puzzlescript-game-skill.md)
