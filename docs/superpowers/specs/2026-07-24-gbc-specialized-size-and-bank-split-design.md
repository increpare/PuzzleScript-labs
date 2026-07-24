# GBC specialized turn: size shrink + bank split

Status: Approved for planning (design conversation 2026-07-24).  
Date: 2026-07-24.

Parent: [`2026-07-24-gbc-specialized-turn-codegen-design.md`](./2026-07-24-gbc-specialized-turn-codegen-design.md)  
Related: interpreter size-fallback (`e0431d40`), resolve/won specialization specs.

## 1. Problem

Among the GBC eligible-14, host export already sets `specialized_turn: true` for
all games. The active wall is **codegen size**, not missing compact-turn
features for this corpus.

- **512 KiB** = total cartridge ROM budget.
- **16 KiB per bank** = current specialized-turn bank (`#pragma bank 1`) must
  fit one bank.
- Failures observed are **per-bank**, not total ROM.

After size-fail → interpreter fallback:

| Outcome | Games |
|---------|--------|
| Specialized kept | `no-forbidden-symbols`, `pushy-v-pully-h` (+ Sokoban outside the 14) |
| Fallback | 12 games (`linked_rom_bank_or_total_over_budget`) |

Near-miss bank sizes (bytes): push-pull **16433**, i-am-a-gust **16486**,
15-push-pull **17258**, fickle-fred **17429**. Large overshoots: xorro
**~77 KiB**, slot-machine **~41**, gapfiller **~37**. Emit size scales with
rule-function count (4 for Sokoban/pushy → 62 for xorro).

Language-profile rejects (rigid / ellipsis / random / multi-row, etc.) are
**out of scope for this phase** — they are Phase 2 after size retention
improves.

## 2. Goal

**Phase 1 (this spec):** Maximize how many of the eligible-14 **keep** a
specialized turn on cart, via:

1. **1a — Shrink:** cheap single-bank wins (dedupe / shared helpers / tighter
   GbdC patterns).
2. **1b — Bank-split:** put leftover oversize specialized code across multiple
   ROM banks when still over 16 KiB after 1a.

Keep the existing size-fail → interpreter fallback as the safety net.

**Phase 2 (later, not this spec):** Widen the GBC language profile so more
games become specialization-*eligible*, toward fuller coverage beyond the 14.

## 3. Success criteria

| Gate | Pass |
|------|------|
| Retention | Maximize specialized count among eligible-14; ledger reports specialized vs fallback per game |
| Near-misses | After 1a, reclaim the ~16.4–17.5 KiB cohort when feasible without semantic change |
| Correctness | Host oracle + existing solution-replay / `check_gbc_rom` gates stay green |
| Safety | Oversize / link fail still falls back cleanly to interpreter |
| Perf trade | Prefer unlocking other specialized/playable games over protecting Sokoban micro-wins |

### Performance policy (Sokoban and peers)

- Sokoban is already fast enough (~49 ticks/turn specialized). A **small**
  regression on Sokoban is acceptable if it tips other eligible games into
  specialized / playable territory.
- A **large** Sokoban slowdown solely to squeeze other games into memory is
  **not** acceptable — prefer bank-split or keeping those games on interpreter
  fallback over gutting the Sokoban hot path.
- When measuring bank-split cost, also sample 1–2 mid-size retained games so
  cross-bank overhead is visible outside Sokoban.

Exact “small vs large” is judgment plus ledger numbers; flag any Sokoban
change that looks like a double-digit % tick regression for explicit review.

## 4. Non-goals

- New PuzzleScript language features on GBC (Phase 2).
- Handwritten SM83 for full turns.
- Sacrificing oracle / replay parity for size.
- Removing interpreter fallback.

## 5. Approach (chosen)

Hybrid:

1. Shrink until diminishing returns (target near-misses under 16 KiB; keep
   correctness gates).
2. Bank-split remaining oversize specialized turns.
3. Interpreter fallback for anything still over **total** 512 KiB or that
   fails parity / link checks.

Rejected alternatives:

- **Shrink-only** — will not fit xorro / slot / gapfiller-class emits.
- **Bank-split-only** — leaves easy near-miss bytes on the table and pays
  cross-bank cost earlier than needed.

## 6. Architecture

```text
Phase 1a — Shrink (single bank)
  compact_turn_codegen
    → reduce duplicated rule bodies (esp. input direction quartets)
    → share resolve / won / seed helpers where safe
    → tighten SDCC-hostile patterns when measured win is clear
  check_gbc_rom: still ≤16 KiB / bank, ≤512 KiB total

Phase 1b — Bank split (multi-bank specialized)
  generated_specialized_turn*.c across banks as needed
    → firmware / trampoline entry: ps_gbc_specialized_step (or equivalent)
    → bank A: early rule groups (preferred hot bank when possible)
    → bank B: late groups + resolve / won (further split if needed)
  check_gbc_rom unchanged in spirit: per-bank 16 KiB, total 512 KiB
  on fail → same interpreter fallback path as today
           (delete generated specialized sources, patch manifest, relink)
```

Preferred split boundary: **phase boundaries** (early vs late vs
resolve/won), not arbitrary function packing, so call graph and measurement
stay understandable.

## 7. Measurement cadence

Every meaningful 1a / 1b change:

1. Host oracle green for touched games (at least Sokoban + any newly retained).
2. `make gbc_eligible` (or equivalent) → update specialized vs fallback counts.
3. Cart PERF_BENCH via `scripts/run_gbc_benchmark.py` when the change can
   affect runtime (especially bank-split and any shared-helper moves).
4. Ledger row in `docs/performance/gbc-optimization-ledger.md`: retained
   count, bank sizes for near-misses / monsters, Sokoban ticks if measured.

Commit after each measured pass (existing project habit).

## 8. Rollout order

1. **1a shrink** — land incremental wins; stop when near-misses are claimed or
   further shrink is clearly diminishing.
2. **1b bank-split** — enable for remaining oversize; measure cross-bank cost.
3. Stop when 14/14 specialized **or** only total-ROM / irreducible cases remain.
4. Then separate brainstorm / spec for **Phase 2** language-profile expansion.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Shrink changes semantics | Oracle + replay before claiming retention |
| Bank-split eats speed on mid-size games | Keep hot path in one bank when possible; measure Sokoban + mid-size sample |
| Large Sokoban hit for memory-only gains | Perf policy above; prefer split / fallback |
| Total ROM still blows after split | Interpreter fallback; optional later trim of unused shared paths |
| Emit / Makefile complexity | Prefer few banks and explicit `#pragma bank` ownership in generated files |

## 10. Open follow-ups (not blocking Phase 1)

- Exact bank assignment policy if three+ banks are required for one game.
- Whether shared specialized helpers eventually live in a fixed firmware bank
  reused across games (vs per-ROM generated copies).
- Phase 2: rigid / ellipsis / random / multi-row GBC profile work.

**Next:** Implementation plan under `docs/superpowers/plans/` after written-spec
review.
