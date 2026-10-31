# Refresh the TypeScript vanilla reference to 57f9f6cb

The user approved advancing the reference after the vanilla fixes were ported
into Labs. The target is the exact `.upstream-sync.json` reviewed-through commit
`57f9f6cba69f6aa52ed738d5aee1d709d0037648`, not Labs' optimized implementation or
the separate cached-AGAIN branch.

Replace all 22 native oracle fixtures with byte-identical files from that Git
revision and update their SHA-256 manifest. Update the independent TS parser,
compiler and runtime to match changed vanilla behavior and diagnostics. Existing
research switches remain available; default `vanillaQuirks` must describe the new
authority rather than preserve fixed bugs. Rename the compatibility module to
`compatibility.ts` so its filename no longer misidentifies the reference revision.

Compiler changes: reject late movement including randomdir, remove an entire
rule with illegal random/randomdir on the LHS, preserve the revised qualifier
diagnostics, reject invalid viewport dimensions, warn about multiple solid-sprite
colors, and match parser keyword/case/line handling. Runtime changes: first rigid
ownership survives subsequent writes, and speculative AGAIN turns cannot commit
checkpoints or persistence.

Promote current semantic fixture expectations to the refreshed authority where
appropriate. Former accepted late-randomdir examples become explicitly labelled
error-recovery cases with expected compiler errors; preserve their provenance
and historical report rather than claiming they still define valid gameplay.
Update direct rigid ownership assertions to the fixed actual contributors.

Keep independent producer guards and exact comparisons. Add targeted regression
tests before implementation, run the full strict suite and compiler corpus, then
replay every recorded game against the refreshed native engine. Document the new
pin, test evidence and any remaining real mismatches. No Labs production source,
native optimized implementation, browser UI or unpublished cached-AGAIN work is
part of this update.
