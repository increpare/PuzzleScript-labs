# GBC specialized multi-row rules (v1: max 2 rows)

Status: Landed spike on `gbc-followups-batch` (2026-07-25).  
Parent: [`2026-07-25-gbc-later-walls-spike-design.md`](./2026-07-25-gbc-later-walls-spike-design.md)

## Problem

Post Milestone B cull audit: **25** `good_games` fixtures fail first on
`validateRule` (`patterns.size() != 1`). Desktop compact-turn already emits
multi-row rules using heap scratch (`scratch.multiRowMatchScratch` in
`compact_turn_codegen.cpp` ~3036). GBC specialized turn must stay WRAM-bounded.

## v1 approach (landed)

| Constraint | Rationale |
|------------|-----------|
| Max **2** rows | Covers common `[ row0 ] [ row1 ]` shape; keeps tuple cartesian product bounded |
| **No ellipsis** on any row | Same as prior v1 single-row policy |
| **No property/aggregate bindings** | Milestone B capture uses per-row start tuples — follow-up |
| Static row scratch | `uint8_t row0_starts[PS_GBC_MAX_BOARD_CELLS]` + `row1_starts[...]` on stack in generated rule fn |
| Specialized-only | Interpreter `ps_gbc_rule.pattern_count` still describes one row; cart uses `PS_GBC_HAS_SPECIALIZED_TURN` |

## Architecture

```text
export-gbc
  validateRule: allow rowCount 1..2 (reject >2, ellipsis, bindings on multi-row)
  packGroups: flatten row patterns → interned sequence; record rowCount + rowPatternCounts[2]
  GbcSpecializedRuleEmit → emitGbcSpecializedTwoRowRule (when rowCount==2)
       per row: scan board → rowN_starts[]
       nested loops: cartesian product of row starts
       verify + apply each row's cells along scan delta
```

File anchors:

- `native/src/gbc/exporter.cpp` — `validateRule`, `packGroups`, `PackedRule`
- `native/src/compiler/compact_turn_codegen.hpp` — `GbcSpecializedRuleEmit.rowCount`
- `native/src/compiler/compact_turn_codegen.cpp` — `emitGbcSpecializedTwoRowRule`,
  `emitGbcSpecializedCollectFixedRowStarts`, dispatch in `emitGbcSpecializedRuleFunction`
- `native/tests/fixtures/gbc_multi_row_basic.txt` — exporter fixture
- `native/tests/gbc_exporter.cpp` — structural test

## Semantics mirrored (desktop)

Per-row fixed match collection (`ellipsisCount[row]==0`), then cartesian product of
row match lists, re-verify on tuple advance, apply replacements per row at that row's
start index — same model as `inlineMultiRowStartMatches` in compact-turn (~3036) and
`applyRuleAt` multi-row path in `runtime/core.cpp` (~5118).

Rows are **not** spatially offset; each row's start index is independent (PuzzleScript
`findMatches` / `matchCellRow` per row).

## Non-goals (this spike)

- 3+ rows, ellipsis rows, random/rigid groups
- Multi-row + property/aggregate bindings
- Interpreter/facade multi-row (`ps_gbc_rule` ABI extension)
- ROM validation batch (host export + unit tests only)

## Measurement

Cull audit (`--cull-oversize-levels`, 178 `good_games`):

| Metric | Before | After |
|--------|-------:|------:|
| `multi_row` first-fail | 25 | **4** (>2-row only) |
| export OK | (baseline) | **62** |

1. Property/aggregate capture with `rowStartExprs` (desktop `emitCompactAggregateCaptureCode`)
2. Row-pair spatial coupling if a future language subset needs it (none today)
3. Re-audit `good_games` after dynamic-replacement wall moves
