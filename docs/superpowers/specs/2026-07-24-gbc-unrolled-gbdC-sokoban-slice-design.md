# GBC unrolled GbdC emission — Sokoban vertical slice

Status: Approved for planning (design conversation 2026-07-24).
Date: 2026-07-24.

Parent: [`2026-07-24-gbc-specialized-turn-codegen-design.md`](./2026-07-24-gbc-specialized-turn-codegen-design.md)

## 1. Problem

The GBC “specialized” turn path is plumbed (banked entry, façade, exporter,
oracle harness) but still calls `ps_gbc_facade_apply_groups` — a table-driven
rule walker. That adds ROM (~+17% linked code on eligible games) without beating
the interpreter on host solution replays.

Desktop `compact_turn_codegen` (`NativeCpp`) already emits unrolled per-game
match/apply code. GbdC must do the same, not wrap the walker.

## 2. Scope (this slice only)

**In:**
- Retarget early (and late, if any) rule emission for `src/demo/sokoban_basic.txt`
  so `generated_specialized_turn.c` contains concrete rule loops/checks/writes.
- Façade stays for cell object/movement get/set only.
- Shared `ps_gbc_resolve_movements` remains.
- Host oracle parity (interpreter vs specialized) including a crate-push fixture.
- Assert specialized output does **not** call `ps_gbc_facade_apply_groups`.

**Out:**
- Eligible-14 unroll (follows after Sokoban proof).
- Replacing movement resolution with specialized code.
- Cart/mGBA timing as a gate (nice-to-have later).
- Guaranteeing a host speedup on Sokoban (one rule; may be noise-dominated).

## 3. Approach

**Dialect remap of existing compact-turn emit (not a Sokoban-only special case).**

Where `NativeCpp` emits `compact_turn_cell_objects_*` / `MaskWord*` accessors,
GbdC emits `ps_gbc_facade_get_objects` / `ps_gbc_facade_set_objects` (and the
movement equivalents) with `uint32_t` masks (GBC v1: ≤32 objects).

`emitCompactTurnBackend` / GbdC specialized entry stops calling
`ps_gbc_facade_apply_groups` for early/late; it calls generated static functions
(or inlined bodies) produced from the same rulegroup walk as NativeCpp.

## 4. Turn control (Sokoban)

```text
ps_gbc_specialized_apply_turn_phases(session, direction, commands, out_changed)
  clear movements / pending_again
  seed player movement (existing façade / single-player bake-in)
  early = emitted_rulegroups(...)     // NEW — no apply_groups
  moved = ps_gbc_resolve_movements(session)   // shared
  late  = emitted_rulegroups(...) or false    // Sokoban: empty / no-op
  *out_changed = seeded || early || moved || late
  return true
```

Win / message / again / undo snapshot remain in `ps_gbc_step` →
`ps_gbc_finish_turn` (unchanged).

## 5. Correctness & measurement

| Check | Gate |
|-------|------|
| Host oracle | Specialized ≡ interpreter on Sokoban replay including crate push |
| Structural | Grep/assert: no `ps_gbc_facade_apply_groups` in generated specialized C for Sokoban |
| Regressions | Existing `puzzlescript_gbc_*` smokes still pass |
| Speed | Host before/after on Sokoban solution — informational; speedup not required to land |

## 6. Risks (slice-specific)

| Risk | Mitigation |
|------|------------|
| Emitter change breaks NativeCpp | Gate all GbdC substitutions on `target == GbdC`; keep NativeCpp tests green |
| Partial port (match without apply) drifts | Oracle on push fixture; emit match+apply together for the one Sokoban rule |
| “No speedup” misread as failure | Document success as oracle + no walker; treat µs delta as secondary |

## 7. Follow-on (not this slice)

After Sokoban lands: unroll early/late for eligible games; re-run multi-level
solution-bench compare; then cart timing for games that show host wins.

## 8. Success criteria (done when)

1. `export-gbc` of `sokoban_basic` emits specialized turn **without**
   `ps_gbc_facade_apply_groups`.
2. Specialized oracle smoke PASS with crate-push coverage.
3. Ledger note: structural win + optional host timing numbers (even if flat/noisy).
