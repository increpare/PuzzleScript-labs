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

1. **Invent for the prompt.** Candidates must **write or modify RULES, OBJECTS, and/or COLLISIONLAYERS** so the puzzle *is* the prompt — not a Microban reskin. Recolor-only is a failed evening.
2. **Prompt-native object names.** Do **not** ship `Crate`/`Target` for an octopus/eggs/shells theme. Rename and redesign: e.g. `Octopus`, `Shell`, `Nest`, `Reef` (plus `Background`). Wire them through LEGEND, COLLISIONLAYERS, RULES, WINCONDITIONS, smoke LEVELS, and `levels.spec.gen`.
3. **`mechanic_intent` required** when `candidates` is non-empty — one sentence naming the rule/object/layer delta. Example: `"Shells keep sliding after a push until they hit Reef; win by covering every Nest with a Shell"`.
4. **Runner rejects** (defaults):
   - vanilla single-push Sokoban win (`reject_vanilla_sokoban`)
   - OBJECTS set that is only Background/Player/Wall/Crate/Target (`reject_stock_sokoban_objects`)
   - no object/layer delta vs nearest seed (`require_structural_delta`, `min_structural_score: 1`)
   - rule fingerprint too close to nearest seed (`min_novelty_score: 1`)
5. **Do not seed only Microban / sokoban_basic** unless the prompt asks for classic Sokoban. Prefer mechanic kinship, or author a tiny custom seed that already has the intended objects/rules.
6. **Safe-mode off** when candidates exist. `failed_mutate` is correct if every candidate is a paint-job — rewrite objects/rules; do not flip `allow_safe_mode` / `reject_*` to cheat.

## Evening checklist

1. **Prompt → mechanic sketch** — Before touching files, write 3–5 bullets: new objects, layering, core rules, win condition, one twist that fits the fiction.
2. **`mechanic_intent`** — Compress that sketch into one sentence for `spec.json`.
3. **Author candidates from scratch-ish** — Start from a seed only as a template for file structure. Immediately replace OBJECTS / COLLISIONLAYERS / RULES / WIN / LEGEND for the prompt. Keep smoke levels tiny but exercise the *new* rule.
4. **Match the generator** — `levels.spec.gen` `choose`/`prob` patterns must use the **same object names** as the selected candidate (e.g. `shell`/`nest`/`octopus`/`reef`, not `crate`/`target`/`player`/`wall` unless those are truly your names).
5. **Seeds** — 1–3 from `src/demo`, `src/tests/solver_tests`, `src/tests/good_games` for kinship; avoid all-Sokoban sets for non-Sokoban prompts.
6. **`levels.spec.gen` must create diverse boards** — Not “same 2 goals on a bigger empty pad”:
   - Place **obstacles** (`prob … -> [ reef ]` / `wall`) every band.
   - **Vary counts** across bands (1 nest vs 2–3; optional extra shells; different `choose` ranges).
   - At least one band should force a different *recipe* (glyph multiset), not only dimensions.
   - Runner **preflight-lints** `.gen` (obstacles, varied `choose`, object-name alignment) and aborts before mining if it fails.
7. **Candidate portfolio diversity** — With 2+ candidates, cover **≥2 non-push rule kinds** (e.g. `slide` + `pull`, or `action` + `late_transform`). Four slide clones → `failed_mutate` / `portfolio_diversity`.
8. **Smoke must exercise the twist** — Candidate LEVELS solutions must use Action when Action rules exist, and need enough length for slide/pull/late (not a 2-step walk onto a nest).
9. **Band contracts (recommended)** — Optional `band_contracts` in `spec.json` (per-band `min_obstacles`, `min_glyph_counts`) so publish gates reject empty padding upgrades.
10. **Thematic gameplay, not ice-Sokoban with new nouns** — If the prompt has hunters / night / ink / magnets / time, put that in RULES. A single slide+cover loop is the default trap.
11. **Compile while drafting** — `build/native/puzzlescript_cpp compile <candidate> --diagnostics`.
12. **Gray-cube test** — If the puzzle is unchanged with gray cubes and the names Crate/Target, rewrite.
13. **Launch** — `make gameforge JOB=build/gameforge/jobs/<id>`.

Publish gates also require `recipe_diversity`, `obstacles`, and optional `band_contracts`. Empty-room curricula will not go `publishable`.

## Mutation caps

Honor `max_rule_candidates`, `max_rules_added`, `max_rules_removed`. Prefer **adding** prompt-specific rules/objects over tiny tweaks to stock Sokoban. Avoid realtime/random-heavy games when solver coverage is weak.

Selection: `selection_policy: max_novelty` ranks by combined rule + structural score among candidates that pass the gates above.

## Overnight

Do **not** babysit. Read `out/report.json` / `design_log.md` in the morning (novelty/structural rejection lines are listed).

## Morning triage

1. `report.json` first — never claim publishable without gate evidence.
2. If `failed_mutate` with `stock_sokoban_objects` / `structural_delta` / `vanilla_sokoban` — author real objects+rules for the prompt and relaunch.
3. Incomplete curriculum — narrow retry (samples, bands, `.gen` names), not a blank restart.

## References

- [reference.md](reference.md)
- [design spec](../../../docs/superpowers/specs/2026-08-11-make-puzzlescript-game-skill-design.md)
- [implementation plan](../../../docs/superpowers/plans/2026-08-11-make-puzzlescript-game-skill.md)
