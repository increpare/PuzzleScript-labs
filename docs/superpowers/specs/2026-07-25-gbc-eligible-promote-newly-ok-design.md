# GBC eligible corpus: validate and promote newly OK titles

Status: Approved (design conversation 2026-07-25).  
Date: 2026-07-25.

Parent / related:
- [`2026-07-25-gbc-specialized-any-layer-coupled-codegen-design.md`](./2026-07-25-gbc-specialized-any-layer-coupled-codegen-design.md)
- Ledger note: `docs/performance/gbc-optimization-ledger.md` (good_games cull audit after any/layer-coupled)
- Builder: `scripts/build_gbc_eligible_roms.py` (`ELIGIBLE_GAMES`)
- Bench twin list: `scripts/bench_gbc_eligible_solutions.py` (`ELIGIBLE_GAMES`)

## 1. Problem

Milestone A (any / layer-coupled specialized emit) moved the cull-audit
**export OK** count for `src/tests/good_games` from **14 → 35**. Production
`ELIGIBLE_GAMES` is still the original 14. The ledger already says expand only
after ROM/size validation on newly OK titles.

## 2. Goal

**One-shot promote:** validate every structurally OK, not-yet-eligible title
with a full cartridge build, then append all passers to the production eligible
list so `make gbc_eligible` covers them.

**Success bar:**

1. Fresh cull export audit of `good_games` (same gate as the ledger).
2. Candidates = audit OK − current `ELIGIBLE_GAMES`.
3. For each candidate: `export-gbc --cull-oversize-levels` + GBDK ROM link
   succeeds, `specialized_turn` retained, ROM ≤ 512 KiB.
4. Passers are added to both `ELIGIBLE_GAMES` copies (builder + solution bench).
5. `make gbc_eligible` is green for the full expanded set.
6. Ledger records promoted slugs and ROM-fail reasons for non-promoted OK titles.

## 3. Non-goals

- Host solution-replay wins as a promote gate (follow-up scoreboard only).
- Milestone B (property/aggregate bindings) or other language unlocks.
- Changing cull policy or retiring `--cull-oversize-levels` for eligible.
- New promotion framework / `PROMOTION_CANDIDATES` staging list.
- Interpreter fallback when specialized exceeds bank limits (shipping policy
  remains specialized-or-fail for these features).

## 4. Promote gate (chosen)

| Check | Required |
|-------|----------|
| Cull export OK | Yes |
| GBDK ROM build success | Yes |
| `specialized_turn: true` in manifest | Yes |
| ROM ≤ 512 KiB | Yes |
| Host specialized replay win | No (later) |

Failed ROM candidates stay out of `ELIGIBLE_GAMES` with an honest ledger row
(reason from build log / size check).

## 5. Approach

**One-shot promote (chosen).** Reuse `scripts/build_gbc_eligible_roms.py` /
firmware `build-rom` path already used for the 14. No staged candidate list;
no new long-lived promote script required for this batch (ad-hoc validation
commands or a short-lived helper in-tree is fine if it keeps the report tidy).

Rejected alternatives:

- **Staged `PROMOTION_CANDIDATES`:** safer if GBDK is flaky; more ceremony than
  needed for a single validated batch.
- **Scripted atomic promoter:** good long-term; overkill for this promotion.

## 6. Work items

1. Re-run `scripts/audit_gbc_good_games_export.py --cull` (or equivalent) and
   capture the OK set.
2. Diff against current `ELIGIBLE_GAMES` → candidate list + slugs.
3. ROM-build each candidate under `build/gbc/eligible/<slug>/` (same layout as
   today). Collect pass/fail + specialized + `rom_bytes`.
4. Update:
   - `scripts/build_gbc_eligible_roms.py` `ELIGIBLE_GAMES`
   - `scripts/bench_gbc_eligible_solutions.py` `ELIGIBLE_GAMES` (keep in sync)
   - Makefile help strings that hard-code “14”
   - `docs/performance/gbc-optimization-ledger.md` promote table
5. `make gbc_eligible` → full `rom-build-report.json` /
   `specialized-scoreboard.json` green for N = 14 + promoted.

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Export OK but specialized bank overflow at link | Do not promote; ledger reason |
| Cull removes every board for some “OK” misclassify | Treat as fail; fix audit class if needed |
| Twin `ELIGIBLE_GAMES` lists drift | Edit both in the same change |
| Long GBDK wall-clock | `--continue` / parallel where safe; report partial |

## 8. Out of scope follow-ups

- Host replay scoreboard on the new titles.
- Promoting titles that need Milestone B or multi-row / dynamic replacements.
- Raising 32-object / 6 movement-layer limits.
