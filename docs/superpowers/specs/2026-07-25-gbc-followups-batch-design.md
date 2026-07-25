# GBC Follow-ups Batch Design (2026-07-25)

**Status:** Approved by operator directive (unsupervised batch; no further gates).  
**Branch / worktree:** `gbc-followups-batch` / `.worktrees/gbc-followups-batch`

## Goals (all in scope)

1. **Host solution-replay scoreboard** for the expanded 32-game `ELIGIBLE_GAMES`.
2. **Unstick the 3 ROM fails** blocked on fixed ROM bank overflow and promote if they pass the same gate as before (specialized + ≤512 KiB).
3. **Milestone B:** property/aggregate bindings (+ aggregate player as needed) in GBC specialized codegen / export validation.
4. **Later walls progress:** multi-row, dynamic replacements, and/or object_count>32 — land whatever is safely achievable; document remainder.

## Non-goals

- Host replay is still not a ROM promote gate.
- Raising object_count / movement-layer limits is architectural; only attempt if a clear minimal path appears after B.
- No ponies testdata edits.

## Attack order

| Phase | Work | Parallel? |
|-------|------|-----------|
| 1a | Wire Makefile + run `bench_gbc_eligible_solutions.py`; ledger timings | Yes |
| 1b | Diagnose fixed-bank maps for 3 fail slugs | Yes |
| 2 | Fixed-ROM shrink → re-validate → append to twin `ELIGIBLE_GAMES` | After 1b |
| 3 | Milestone B design+impl (validateRule + GBC emit) | Parallel design with 1; impl after spike |
| 4 | Dynamic replacements / multi-row / object_count — opportunistic | After B for dynamics |

## Success criteria

| Item | Done when |
|------|-----------|
| Scoreboard | `solution-bench-compare.json` for 32 games; ledger notes `with_replay_timing`; Makefile target |
| Fixed ROM | 0–3 of the fail slugs promote; ledger updated |
| Milestone B | Cull audit `property_aggregate` first-fail drops; exporter tests green; newly OK titles ROM-validated before promote |
| Later walls | Measurable audit-class reduction OR documented spike with next levers |

## Risks

- Fixed-ROM moves that regress bank-2 hangs (historical). Prefer stub reduction / `#if PS_GBC_HAS_SPECIALIZED_TURN` dead-code in `core.c` over moving `resolve_movements`.
- Milestone B correctness: require host specialized oracle / exporter tests before promote.
- Long GBDK wall-clock: `--continue`, commit intermediate docs.
