# Frozen CodeMirror 5 comparison oracle

The production editor uses CodeMirror 6. These CodeMirror 5 core/addon files are
retained as a frozen comparison oracle for layout, shortcuts, autocomplete,
search, and other migration behavior.

Do not casually edit them. An intentional baseline-maintenance change requires
explicit review and baseline recapture in the CM5 comparison pages. PuzzleScript
files outside this frozen directory remain governed by their normal ownership.
