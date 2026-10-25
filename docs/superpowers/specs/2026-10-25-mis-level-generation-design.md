# MIS95 per-level generation and board sizing

Approved direction: generation belongs to each level. The current board, transform editor and suggestions follow selection; background generation continues independently. User approved implementation on 25 October 2026. Use the existing workbench and transform language.

## Interaction

- New… beside Duplicate asks for width and height, remembers the previous dimensions, inserts an ordinary background-filled level after the current level, and selects it. Duplicate copies that level’s transform, locks and rule goals without stealing its generator or results.
- In Edit mode, visible handles outside the board allow grid-snapped edge/corner resizing. Preview dimensions while dragging; commit once on release; Escape cancels; arrows on focused handles resize by one cell. New cells contain background. Cropping and locks are undoable with the board.
- Generate toggles only the current level. A corner thumbnail button indicates generating/paused and pauses/resumes that level without selecting it. The selection highlight continues to mean viewing. Run offers Stop all generation; a global status reports active levels.
- Each level owns its transform/preset, locks/goals, suggestions, pins and session. New/Duplicate inherit the current transform. A Use for all levels command copies the current transform explicitly. Caption identifies the current level.
- Suggestions preserve Watch/Pin/adopt and add Add as new level. Continue from pick affects only the adopted level’s session. Viewing/playtesting another level never restarts jobs.

## Execution and recovery

One bounded pool of at most GEN_WORKERS workers serves all active levels. Round-robin scheduling preserves search state across slices and does not create a worker pool per level. In-flight messages carry job/revision identity and are ignored after invalidation. Per-level failures pause that job. Runtime solves remain cooperative and a single engine turn may overrun a slice.

Board/lock/transform/goal changes restart only the affected level. Rule/backend changes invalidate all affected solver sessions and stale results. Source insertions made by the UI remap level metadata; arbitrary structural source edits fail closed rather than attach jobs to the wrong level. New rules never display old solved results as current.

Bound candidate dedupe/cache and saved collections for long runs. Save source, per-level transforms, retained suggestions/pins and session intent periodically. Restore collections with generation paused and offer Resume; do not unexpectedly start CPU work after opening a file. File metadata retains transforms/locks/goals and backward compatibility with existing MIS comments.

## Verification

Core tests cover dimensions/background, asymmetric resize/crop/column-major mapping, multiword cells, lock translation, source round trips, invalid dimensions. Pool tests cover bounded workers, fair multi-job slices, pause/resume, stale messages and failure isolation. Browser checks exercise two simultaneous level jobs, switching levels, scoped transforms/cards/pause, New/Duplicate/resize undo, Add as new level, recovery, keyboard controls, and web build assets. Existing MIS/core/editor/rule-goal/UI tests remain required; desktop packaging smoke uses isolated data.
