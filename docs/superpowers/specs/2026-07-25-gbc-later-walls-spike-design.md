# GBC Later Walls Spike Design (2026-07-25)

**Status:** Active spike under `gbc-followups-batch` (unsupervised).  
**Depends on:** Milestone B for the property-shaped subset of dynamic replacements.

## Walls (post Milestone A cull audit)

| Class | Approx count | Gate |
|-------|-------------:|------|
| board cull-all | 54 | Level size policy, not codegen |
| object_count (>32) | 27 | `exporter.cpp` `PS_GBC_MAX_OBJECTS` + cell bytes / WRAM |
| multi-row rules (>2 rows) | 4 (was 25) | `validateRule` `kMaxRowCount=2`; 2-row via `emitGbcSpecializedTwoRowRule` |
| dynamic replacements | 19 | `gbcReplacementDynamicAllowed` |
| other / invalid layer | ~18 | Mixed |
| ellipsis | 3 | Explicit v1 reject |
| movement layers (>6) | 3 | Movement layout limit |

## Priority for this batch

1. **Dynamic replacements** after Milestone B lands inferred property/aggregate apply — likely largest OK-count win among codegen walls.
2. **Multi-row** — desktop compact-turn uses heap scratch; GBC needs a bounded static plan. Spike only unless a tiny 2-row fixture emits cleanly.
3. **object_count >32** — architectural (mask width). Document only unless a 33–40 soft path is obvious (unlikely this session).
4. **cull-all** — product policy (keep 10×9); out of codegen.

## Success for the spike

- Measurable drop in one audit class after a landed change, **or**
- A written “next lever” with file anchors if the wall is too large for this batch.

## Non-goals

- Raising board cull dimensions.
- Ellipsis / rigid / random in this batch.
