# GBC inline match/apply codegen — Sokoban host speed win

Status: Approved for planning (design conversation 2026-07-24).
Date: 2026-07-24.

Parent: [`2026-07-24-gbc-specialized-turn-codegen-design.md`](./2026-07-24-gbc-specialized-turn-codegen-design.md)  
Prior slice: [`2026-07-24-gbc-unrolled-gbdC-sokoban-slice-design.md`](./2026-07-24-gbc-unrolled-gbdC-sokoban-slice-design.md)

## 1. Problem

Sokoban specialized turns no longer call `ps_gbc_facade_apply_groups`, but they
still interpret baked `ps_gbc_specialized_patterns[]` through shared
`pattern_matches` / `apply_replacement` helpers. That is a second interpreter,
not desktop-style codegen. On host solution replay it is ~2× slower than the
GBC table interpreter.

Desktop `compact_turn_codegen` already emits literal mask checks via
`emitCompactInlinePatternMatchTest`. GbdC must reuse that path (dialect remap),
not grow the packed-pattern mini-runtime.

## 2. Goal & gate

**Goal:** Retarget desktop inline match (and a matching inline apply emitter) to
GbdC so Sokoban specialized rule bodies contain literal present/missing and
clear/set operations through the façade get/set API.

**Success gate:** Host specialized mean ms/turn **strictly less than** host
interpreter on `native/tests/fixtures/gbc_sokoban_basic_solution.txt` (33 moves),
with ≥20 iterations for noise, oracle still green.

**Non-goals (this slice):**
- Inlining façade cell storage / strides (option B)
- Specializing `ps_gbc_resolve_movements`
- Eligible-14 unroll
- Cart/mGBA timing as a gate (ledger-only if convenient)

## 3. Approach

**Dialect remap of desktop inline emitters (not Sokoban-only hardcode).**

Teach `emitCompactInlinePatternMatchTest` (and a new or branched **inline apply**
emitter) to emit GbdC when `CompactCodegenTarget::GbdC`:

| Concern | NativeCpp | GbdC |
|---------|-----------|------|
| Object/movement load | `MaskWord*` via `compact_turn_cell_*` | `uint32_t` via `ps_gbc_facade_get_*` |
| Mask literals | `MaskWord` array words | single `0x..U` (v1: ≤32 objects) |
| Store / dirty | compact-turn setters | `ps_gbc_facade_set_*` + `ps_gbc_facade_mark_dirty` |

Desktop apply today often goes through helper calls (`compactPatternApplyCall` /
simple-replacement fast paths). This slice adds a shared **inline apply emit**
(or a GbdC branch of the simple-replacement path) so match and apply are both
literal in specialized rule bodies.

`emitGbcSpecializedTurn` stops emitting the packed pattern table and shared
match/apply helpers. Rule scan/control may remain GBC-shaped for this slice, but
every cell match and replacement body must come from the dialect-aware emitters.
Seed + `ps_gbc_resolve_movements` stay as today.

All substitutions gated on `target == GbdC`; NativeCpp output and tests unchanged.

## 4. Turn control (unchanged shell)

```text
ps_gbc_specialized_apply_turn_phases(...)
  clear movements / pending_again
  seed player movement
  early = rule functions with INLINE match/apply   // NEW shape
  moved = ps_gbc_resolve_movements(session)
  late  = rule functions or no-op
  *out_changed = seeded || early || moved || late
```

Win / message / again / undo remain in `ps_gbc_step` → `ps_gbc_finish_turn`.

## 5. Emitted shape (Sokoban)

Match (per pattern cell that `compactPatternCanInlineMatch`):

```c
uint32_t tile_0_objects = ps_gbc_facade_get_objects(session, tile_0);
if ((tile_0_objects & 0x10U) != 0x10U) matched = false;
uint32_t tile_0_movements = ps_gbc_facade_get_movements(session, tile_0);
if ((tile_0_movements & 0x1U) != 0x1U) matched = false;
```

Apply: literal clear/set on objects/movements, façade set, dirty if objects
changed — **not** `ps_gbc_specialized_apply_replacement(pattern*)`.

**Structural asserts** on Sokoban `generated_specialized_turn.c`:
- Absent: `ps_gbc_specialized_patterns`, `ps_gbc_specialized_pattern_matches`,
  `ps_gbc_specialized_apply_replacement`, `ps_gbc_facade_apply_groups`
- Present: `ps_gbc_facade_get_objects` / `set_objects` with hex mask literals
  inside rule bodies

## 6. Correctness & measurement

| Check | Gate |
|-------|------|
| Oracle | specialized ≡ interpreter on crate-push replay + full solution |
| Structural | asserts in §5 |
| NativeCpp | existing compact-turn / simulation tests stay green |
| Speed | specialized mean ms/turn &lt; interpreter (solution, ≥20 iters) |
| Ledger | before/after host numbers; note real inline codegen |

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Dialect edits regress NativeCpp | Gate on `target == GbdC`; run compact-turn tests |
| Inline apply drifts from façade semantics | Emit match+apply together; oracle on push + solution |
| Host still not faster after inline | Stop and reassess; do not silently expand to storage inline in this slice |

## 8. Follow-on (not this slice)

Eligible-14 via the same emitters; façade storage inline if host win is still
insufficient; cart/mGBA solution-replay for games that win on host.

## 9. Success criteria (done when)

1. Sokoban specialized C has literal inline match/apply (structural asserts pass).
2. Oracle PASS (crate-push + full solution).
3. Host specialized mean ms/turn &lt; interpreter on the 33-move solution.
4. Ledger entry records the before/after numbers.
