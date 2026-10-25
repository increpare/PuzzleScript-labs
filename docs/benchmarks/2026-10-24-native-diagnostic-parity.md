The native compiler now passes all **321 diagnostic fixtures**, up from 196.
The 125 exposed failures were fixed in the compiler; expected answers are still
read only by the test runner. The production compiler has no fixture lookup.

The changes implement the missing source-validation stages: rule syntax and
recovery, movement/property inference, collision-layer overlaps, contradictory
and redundant negations, random spawning, ellipses, rule groups and loops.
Object colors, background definitions, legend aliases, map glyphs, win
conditions, sound declarations and metadata formatting are also checked in the
reference compiler's phase order. The old parser's fixture-shaped rule spot
checks were replaced with general token validation for arbitrary identifiers.
Obsolete partial rule validators were removed.

The C API retains warning severity for unanchored warnings. The JS-compatible
test runner counts them as errors because JS `logWarningNoLine` increments
`errorCount`; this historical behavior is separate from warning presentation.
Failure output now prints actual diagnostics for count-only differences too.
Neither the expected-message subsequence comparison nor its error-count
requirement was relaxed.

All fixtures pass in three independent variants: source comments change source
identity, a temporary working directory contains poisoned expected answers,
and four ordinary object/property identifiers are renamed throughout source
and expected diagnostic names. Required Player/Background names, title lengths,
glyphs and level messages are preserved; static win-condition help examples
remain unchanged. These checks prevent fixture identity or specific object
names from substituting for semantic validation.

Run the direct corpus and independent variants with:

```sh
puzzlescript_cpp test diagnostics-corpus src/tests/resources/errormessage_testdata.js --progress-every 0
node src/tests/native_diagnostic_regressions_node.js /absolute/path/to/puzzlescript_cpp
```

Both checks are registered in CTest. Two older unit expectations were corrected
to the current JS behavior: keyword aliases produce warnings while remaining
usable glyphs, and repeated-negation diagnostics use the current wording and
uppercase object names. The glyph test still lowers its game successfully.

Validation covered all 117 registered native checks, including 280
`host_known_good` solution-cache replays. The full run passed the other 115
checks in 277.22 seconds; the two corrected unit expectations passed after
rebuilding and rerunning them. The complete diagnostic corpus and independent
variants also passed in a focused four-check rerun. All 794 ordinary JS
fixtures and the random-replay, stale-frontier and sparse-path checks passed.

This establishes parity for the current diagnostic fixtures and these source
variations. It does not claim that every possible invalid program produces
identical diagnostics in both compilers.

The final landing keeps this diagnostic repair, its native build/test
prerequisites and the validated JS stale-frontier fix. Starting-board solver
specialization and shared kernels remain experimental on
`codex/solver-specialization-validation` at `a1692895`; those two feature
commits are excluded from master.
Their runtime gains were small and mixed, so the extra feature complexity was
not adopted. Their code and benchmark measurements remain on that branch.

After excluding those features, a fresh Release build passed all 113 remaining
native checks in 281.96 seconds, including the 280 solution-cache replays and
the complete diagnostic corpus and independent variants.
