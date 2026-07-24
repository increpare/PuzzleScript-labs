# GBC specialized movement resolve + win (shape-gated)

Status: Approved for planning (design conversation 2026-07-24).
Date: 2026-07-24.

Parent: [`2026-07-24-gbc-specialized-turn-codegen-design.md`](./2026-07-24-gbc-specialized-turn-codegen-design.md)  
Prior slices: [`2026-07-24-gbc-inline-match-apply-sokoban-design.md`](./2026-07-24-gbc-inline-match-apply-sokoban-design.md)

## 1. Problem

Sokoban specialized turns already own seed + early/late rules, but still call
shared `ps_gbc_resolve_movements` and, after the turn, shared `ps_gbc_won` inside
`ps_gbc_finish_turn`. On cart (PERF_BENCH, mGBA), win alone is ~37 of ~131
ticks/turn; movement is the other large shared chunk inside the specialized
phases. Snapshot / undo / commands stay shared (out of scope).

## 2. Goal & gate

**Goal:** Shape-gated GbdC emitters for specialized movement resolve and win
evaluation; fold win so `finish_turn` uses the specialized predicate when
linked. Emitters are reusable for any qualifying game; Sokoban is the first
proof.

**Success gate (Sokoban):**
1. Oracle green (crate-push + 33-move solution).
2. Structural: when gated on, specialized turn does **not** call
   `ps_gbc_resolve_movements` / `ps_gbc_won`; emits
   `ps_gbc_specialized_resolve_movements` + `ps_gbc_specialized_won`.
3. Cart PERF_BENCH ticks/turn **strictly below** current specialized baseline
   (~130.93).

**Measurement cadence (required):** every meaningful emitter change (resolve
only, won only, both + fold) gets:

1. Host oracle still green.
2. Cart PERF_BENCH via `scripts/run_gbc_benchmark.py` (mGBA Mac `.app`, ≥3
   deterministic runs; Game Boy `TIMA` ticks, not host wall clock).
3. Ledger row in `docs/performance/gbc-optimization-ledger.md`: ticks/turn,
   ms@4096Hz, walk/push interaction ticks, banked ROM Δ vs prior specialized.

Compare against the current specialized baseline, not only against the
interpreter. Whole-turn + interaction ticks are required; phase probes inside
the specialized body are nice-to-have if cheap.

**Non-goals:** snapshot/undo/commands specialization; full desktop
`compact_turn_resolve_movements` dialect remap; eligible-14 cart campaign
(ledger-only if convenient).

## 3. Eligibility (shape gate)

Specialize movement + win only when all hold; else keep shared
`ps_gbc_resolve_movements` / `ps_gbc_won`:

| Constraint | Why |
|---|---|
| Object bits ≤ 32 (single cell word) | Match current GbdC inline storage |
| Movement bytes/cell ≤ 1 (≤1 movement layer packed in `uint8`) *or* small fixed layer count with literal shifts | Avoid multi-word movement mess in v1 |
| No aggregate-player split logic required | Desktop compact-turn complexity deferred |
| Win conditions: only All / No / Some with literal filter masks (Sokoban: `all Target on Crate`) | Enough for Sokoban + many eligible games |
| Already on specialized-turn path | Same bank-1 emit file |

Note: canmove/cantmove **SFX** tables do not block specialization in this slice;
specialized resolve simply does not emit those audio side effects yet (acceptable
while sounds are out of scope).

Sokoban qualifies. Exporter records `specialized_resolve` / `specialized_won`
booleans in the export report.

## 4. Emit shape

**Movement** — `ps_gbc_specialized_resolve_movements(session)` in
`generated_specialized_turn.c`:

- Same multi-pass algorithm as core, but literal layer masks, direction shifts,
  and direct `session->board` / `movements` / `dirty_bits` (reuse existing GbdC
  storage helpers).
- When a player-masked object moves, update **player anchors at the move site**:
  - `player_cells` list when `PS_GBC_HAS_PLAYER_CELL_ANCHORS`
  - `ps_gbc_specialized_player_cell` when `PS_GBC_GENERATED_SINGLE_PLAYER_CELL`
  - Do not rely on a later full-board rescan for correctness on the hot path.
- Clear movements at end; return `moved_any`.
- `ps_gbc_specialized_apply_turn_phases` calls this instead of
  `ps_gbc_resolve_movements` when eligible.

**Win** — `bool ps_gbc_specialized_won(const ps_gbc_session*)`:

- Unrolled per-condition loops with literal `filter1` / `filter2` / quantifier
  (Sokoban: fail if any Target cell lacks Crate).
- Direct board loads.

**Win fold** — in `ps_gbc_finish_turn`:

```c
#if PS_GBC_HAS_SPECIALIZED_WON
  won = (commands WIN) || ps_gbc_specialized_won(session);
#else
  won = (commands WIN) || ps_gbc_won(session);
#endif
```

Generated export defines the real function and compile flag (same pattern as
`PS_GBC_HAS_SPECIALIZED_TURN`). Order matches today: command WIN still wins
without scanning.

## 5. Correctness & measurement

| Check | Gate |
|---|---|
| Oracle | specialized ≡ interpreter (crate-push + full solution) |
| Structural | when gated on: no `ps_gbc_resolve_movements` / `ps_gbc_won` from the specialized path (so we are actually timing the new code) |
| Cart | PERF after each of: (1) resolve only (2) won only (3) both + fold — ledger each |
| ROM | note banked Δ; stay under 512 KiB |

## 6. Risks

| Risk | Mitigation |
|---|---|
| Specialized resolve forgets a detail the shared function does (player anchors, dirty bits, clearing movements) → fast but wrong | Update anchors at the move site in the specialized emitter; oracle on crate-push + full solution; structural assert that gated games call the specialized resolve, not the shared one |
| Win fold double-evaluates or skips command WIN | Same condition order as today: `COMMAND_WIN \|\| specialized_won` |
| Shape gate too loose → wrong games specialized | Explicit eligibility; export report flags; fallback to shared |
| ROM bloat from inlined loops | Measure banked Δ each milestone; keep under 512 KiB |
| Bank-1 overflow / banked call hang | Stay in bank 1 with generated game; avoid calling non-`NONBANKED` core from other banks |

## 7. Success criteria (done when)

1. Shape-gated emitters land; Sokoban uses specialized resolve + won.
2. `finish_turn` calls `ps_gbc_specialized_won` when linked.
3. Oracle PASS.
4. Three ledgered cart benches (resolve → won → both) each recorded; final
   ticks/turn below ~130.93.
5. Spec + implementation plan documented.

## 8. Follow-on (not this slice)

Eligible-14 cart benches for games that pass the shape gate; full desktop
movement dialect remap if aggregate-player / multi-word movement games need it;
optional specialized-body phase probes.
