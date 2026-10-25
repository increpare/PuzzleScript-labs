# MIS95 canonicalization

Add Tools immediately after Run, with Canonicalize and Canonicalize (strip
sprites) commands. Each command
replaces the current source, including edits still waiting for the editor's
compile debounce, as one undoable edit. Show and focus the Game source panel.
Both editor undo/redo and the existing document undo/redo controls must work.

Use semantic canonicalization and the existing PuzzleScript emitter. Retain
levels and mechanics, omit decorative section separators, and preserve original
object names and casing where unambiguous. Merged objects use one representative
name. Avoid collisions with generated properties, aggregates and level glyphs.
Canonicalize retains the original palette and sprite of each surviving object's
representative, including the default background if semantic reduction removes
the original background. Colours are emitted as resolved hexadecimal values so
artwork does not depend on stripped palette metadata.

Canonicalize (strip sprites) uses the same reduction, but emits one colour per
object and omits all sprite grids. Count actual pixel colours, combining equal
palette colours (including equivalent short/full hex) and ignoring both `.` and
explicitly transparent pixels. Ties use palette order; an
entirely transparent sprite uses its first palette colour. Sounds, descriptive
metadata and message text remain omitted in both modes.

Validate the input and emitted source before replacement; errors leave the text
and undo history untouched and show an error toast. Compilation for this tool
must restore the active engine state. Existing canonical JSON and default
decanonicalizer output remain unchanged.

Test semantic round trips, names and name collisions, compact headings, live
editor replacement, pending edits, both undo paths and rejected invalid input.
