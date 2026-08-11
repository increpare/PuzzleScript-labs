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

## Hard rules (do not skip)

1. **No paint-jobs.** A theme skin over vanilla Sokoban (`[ > Player | Crate ]` + `all Target on Crate`) is a **failed evening**. The runner rejects vanilla Sokoban and near-identical seed mechanics when `candidates` are present.
2. **`mechanic_intent` is required** in `spec.json` whenever `candidates` is non-empty — one sentence naming the *rule/win* delta (not the theme). Example: `"shells keep sliding after a push until they hit reef"`.
3. **Do not seed only Microban / sokoban_basic** unless the prompt explicitly asks for classic Sokoban. Prefer seeds whose rules already contain a related twist, or author a tiny custom seed with the intended mechanic.
4. **Every candidate must change RULES and/or WINCONDITIONS** relative to its nearest seed (add/remove/alter a rule, or change the win). Recolor/rename/sprites alone is invalid.
5. **Safe-mode is off** when candidates exist (`allow_safe_mode` defaults false). If all candidates fail novelty, the job must `failed_mutate` — do not ship a reskinned seed. Set `"allow_safe_mode": true` only for intentional level-pack remixes with empty/no novel candidates.

## Evening checklist

1. **Prompt** — Theme + intended mechanic in one breath (e.g. “octopus covers eggs; shells slide on sand”).
2. **Write `mechanic_intent`** first — if you cannot state a non-cosmetic delta, stop and invent one before picking seeds.
3. **Seeds** — 1–3 games from `src/demo`, `src/tests/solver_tests`, or `src/tests/good_games` chosen for *mechanic kinship*, not filename familiarity. Avoid all-Sokoban seed sets for non-Sokoban prompts.
4. **Candidates** — Up to `max_rule_candidates` full `.txt` files. Each must embody `mechanic_intent`. Include a smoke LEVEL that exercises the *new* rule (not just a push onto a target).
5. **Job package** — `build/gameforge/jobs/<id>/` with `spec.json`, `seeds/`, `candidates/`, optional `levels.spec.gen` (object names in `.gen` must match candidate legend names used by the generator rules).
6. **Compile while drafting** — `build/native/puzzlescript_cpp compile <candidate> --diagnostics`; drop failures.
7. **Self-check before launch** — For each candidate, mentally confirm: “Would this still be a different puzzle if all sprites were gray cubes?” If no, rewrite rules.
8. **Launch** — `make gameforge JOB=build/gameforge/jobs/<id>`.

## Mutation caps

Honor `spec.json`: `max_rule_candidates`, `max_rules_added`, `max_rules_removed`. Allowed: rename/recolor (with a real rule delta), sprites, bounded rule add/remove, win tweaks, one collision-layer swap. Refuse or avoid realtime/random-heavy games when solver coverage is weak.

Runner selection (not agent): `selection_policy: max_novelty` (default) scores candidates against seeds and picks the highest novelty that also passes compile/smoke and `reject_vanilla_sokoban`.

## Overnight

Do **not** babysit the runner in chat. Killing the process is safe — read the latest `out/report.json`.

## Morning triage

1. Read `out/report.json` first, then `out/design_log.md` (includes per-candidate novelty rejections).
2. **Never claim publishable** unless `report.status === "publishable"` and all eight gates are true.
3. **`publishable`** — present `out/game.txt` + highlights; optional light polish only.
4. **Incomplete** — narrow retry (samples, wall clock, bands, one better candidate) — do not restart from a blank prompt unless `failed_mutate`.
5. **`failed_mutate`** — usually novelty/vanilla rejection. Author a *real* rule delta; do not set `reject_vanilla_sokoban: false` or `allow_safe_mode: true` to paper over a paint-job.

## References

- Gate checklist, statuses, CLI, defaults: [reference.md](reference.md)
- Design spec: [docs/superpowers/specs/2026-08-11-make-puzzlescript-game-skill-design.md](../../../docs/superpowers/specs/2026-08-11-make-puzzlescript-game-skill-design.md)
- Implementation plan: [docs/superpowers/plans/2026-08-11-make-puzzlescript-game-skill.md](../../../docs/superpowers/plans/2026-08-11-make-puzzlescript-game-skill.md)
