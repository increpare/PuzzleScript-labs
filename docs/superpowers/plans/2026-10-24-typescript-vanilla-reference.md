# Independent vanilla PuzzleScript reference port

**Status:** Complete. All implementation, review and verification gates pass.
See `2026-10-25-typescript-completion-audit.md` for the final requirement/evidence
matrix. The sections below retain the development sequence and component history.

## Objective

Port vanilla PuzzleScript into a separate TypeScript package, removing optimized
representations and machinery so source behavior can be understood directly.
The JS editor/player remain intact. A partial runtime or source reader does not
complete this objective.

## Authority

Use official `increpare/PuzzleScript` revision
`5a94bde1a5127a3a45306ea28598eba2874d446d`. The worktree's tracked source tree is
that exact revision. `typescript/oracle-source.json` pins every source/test file
loaded by the native host. The oracle rejects mismatched source hashes.

The earlier labs prototype is preserved separately; its historical replay numbers
are not evidence of vanilla parity. Vanilla has no input-specialization feature.
The native suite at this pin passes all 790 tests (478 simulations, 312 compilation
tests). No production JS changes are part of the port.

## Sequence

1. Audit the existing independent reader, declaration resolver and non-rule game
   data against vanilla. Compare all 478 simulation sources and preserve all 312
   compilation fixtures with valid spans. Supplement the corpus with native
   recovery cases. Require spec review then quality review.
2. Adapt test-only gameplay decoders to the actual vanilla compiled schema. Check
   every native semantic field, reject unsupported fields, retain deliberate
   broken-candidate tests, and run all 478 per-move/AGAIN replays. Preserve exact
   RNG state, commands/source identity, sound/persistence order, histories,
   restart/checkpoint state, screens, levels and final recorded expectations.
3. Compile source rules independently: name meanings, orientation, relative and
   aggregate movements, properties/inference, commands, groups and loop markers.
   Preserve vanilla's ordered concrete inference and retained single-layer
   property predicates. Once those passes are reviewed, remove runtime
   property/aggregate capture bindings, inferred sinks and conditional alternatives
   inherited from labs: the vanilla adapters always supply empty fields for them.
   Manual tests for those extra features do not justify keeping them in the
   reference surface. Then lower named variants into ordinary object/movement
   conditions and edits. Favor small named semantic passes; no masks, generated
   code, pruning or caches. See the vanilla-runtime-surface plan for the cleanup.
4. Compile source assets and integrate diagnostic behavior, including recovery,
   source locations, counts, ordering and native abort/dedup conventions. Check
   all 312 compilation fixtures independently.
5. Add a standalone source-to-trace command. Run the complete 478-source corpus
   using TS-compiled data and TS session execution with native producers disabled.
   Review the oracle boundaries and simplify any remaining inherited machinery.
   Retain ordinary single-layer property predicates and edits that vanilla
   actually produces, and verify the earlier runtime cleanup remains complete.

## Current checkpoint

The independent source/declaration/game-data comparison runs all 478 sources;
reader preservation checks cover 312 compilation fixtures. The user approved the
vanilla gameplay-adapter migration. The full strict suite passes 1,582 tests at
the source-trace delivery checkpoint; all 74 focused session checks also pass.
See `typescript/test/VANILLA-ADAPTER-AUDIT.md` for its exact native schema and
coverage boundaries. The complete 478-game standalone replay passed with 20,034
session observations/candidate operations and 525 level loads, exit status zero.
It uses native-compiled game data, so independent source-to-session parity remains
unfinished. The source/data oracle now checks
actual native win outcomes before projecting objects. Reviewed malformed-declaration
recovery now represents the writable orphan of an overwritten first assignment
as an explicit object linked to its current declaration. Aggregate/player conditions,
random spawns, intent, movement and sounds preserve that identity; the original
unavailable/Never approximation is removed. The newly constructed reproducer and
native validation are recorded in `typescript/test/repros/orphaned-object-bug-report.md`.
Legend Unicode
expansion now uses explicit lexical-token-to-authored-word mapping. Reviewed
object/layer lexical names fix the confirmed dotted-I expansion and contextual
Greek sigma cases, preserving authored words, spans and canonical identities.
Their exact coverage is recorded in
`typescript/test/repros/legend-unicode-expansion-report.txt`.
The reviewed independent rule lexical view compares actual native parser inputs
for all 790 fixtures: 20,226 rules, 335,458 tokens and 1,082 message positions.
It preserves authored evidence separately from effective compiler-line casing.
Reviewed independent syntax recovery matches all 478 sources: 16,754 native
captures, 16,577 retained ordinary rules, 176 loops and 216 raw syntax diagnostics,
including 27 undefined-SFX warnings at their command visits. Both ordinary and malformed section
ordering preserve native SOUNDS name snapshots. Quality review also checked 8,000
deterministic malformed token combinations against native recovery. Reviewed early
negative requirements now match all 478 sources (16,577 rules and 39 pass-only
diagnostics), preserving raw-name distinctions, ordered deletion and explicit
unlayered lookup recovery. Quality review also compared 1,500 additional boundary
probes. Reviewed orientation and ordered name expansion now match every source:
16,577 rules produce 25,985 variants, with zero new name diagnostics. Explicit
InPlace-relative and empty-aggregate TypeError boundaries are documented; the
empty-aggregate case fails earlier than native lowering and does not claim exact
malformed intermediate output or error ordering. Reviewed movement inference
matches every source: 25,985 named inputs produce 30,005 ordered outputs, including
duplicate paths, with zero movement errors or aborts. Reviewed property inference
produces 106,273 ordered variants across all 478 sources, with zero property
diagnostics. Spawn intent matches those same variants and qualifiers, preserving
raw-name priority and actual layers contributed by every LHS qualifier. Reviewed
runtime cleanup removes the unused labs capture/sink/conditional surface. The
51 unsupported-only tests are gone; native-backed tests, shared static behavior,
unknown-field rejection and #1206 remain. A fresh bounded session replay passed
22 fixtures, 783 observations and 24 loads, including InPlace recovery. The
complete native-compiled replay above predates this cleanup. Reviewed semantic
duplicate normalization now matches all 478 sources: 106,273 expanded variants
become 99,448 ordered survivors, retaining last-record identities and source-group
boundaries. Reviewed direct lowering matches all 478 sources: 99,448 inputs become
99,327 lowered rules, with 251 retained overlap records and 143 raw diagnostics.
Independent spec and quality reviews pass, including actual source-lowered orphan
application, RNG, player, win and movement checks. Reviewed schedule formation now
removes the overlaps and produces 99,076 final rules, in 11,072 early and 4,481
late groups. The corpus has 39 rigid groups, 75 explicit merge transitions and
89 semantic loop entries. Raw schedule diagnostics are zero for these 478 sources;
focused malformed fixtures check diagnostic ordering and recovery. Both reviews
independently pass 47 schedule tests, including all sources and 9,455 actual native
rigid replacement transitions for one through thirty groups. The joined source
rule compiler is now independently spec- and quality-reviewed. Its explicit
passes preserve native abort checkpoints, canonical declarations and complete
rule diagnostics: all 478 sources produce the same 99,076 final rules and 398
ordered raw rule diagnostics. Actual seeded random execution preserves three
versus four application candidates, full RNG state and commands. Focused source
execution also preserves #1206's one retry and unmatched third-group ban, and
writable orphan identities. Both reviewers freshly passed the 40 joined compiler
tests and 155 syntax tests; one also checked 225 additional malformed SFX records.
Reviewed assets now match all 478 sources: 12,196 canonical appearances, 304,900
explicit pixels, 22,867 colors, three raw asset diagnostics and no display
diagnostics. Static copies of all fourteen palettes and aliases match exactly.
Source recovery uses named object-reading parts and separate working rows;
authored words/rows remain intact while accepted metadata, suffix aliases,
continued colors and replacement sprites retain canonical source evidence.
Both reviewers independently rebuilt and passed focused checks, original
reproducers and all 293 existing compilation fixtures for which actual loadFile
returns a state. Those fixtures have 3,090 appearances, 77,250 pixels and eight
asset/two display diagnostics; their game data also agrees. Native parser
diagnostics are now independently spec- and quality-reviewed at 13f106f6 and
the test-only offset guard fix ad6f8e5e. All 312 compilation sources match 268 raw
calls, 244 recorded issues and three stopping positions. All 478 game sources
match 265 raw/recorded issues, including 14 errors and no stops. The authored
reader now shares the lexical authority and no longer resolves declarations to
parse rule names. Authored and effective metadata/message literals stay separate.
Fresh spec review also passes 279 retained component checks; final focused
spec/quality reviews both pass strict build and 35 parser checks. All 21 native
hashes and whitespace checks pass. A parent AST scan finds no bitwise, packed
numeric array, BitVec, Function or eval operations across the 41 source files;
this structural check supplements rather than replaces semantic tests.
Whole-source compiler assembly is now independently spec- and quality-reviewed
at `a3a971d3`, `f4592d09` and `ca4660fe`. The 90-line public operation sequences
ordinary domain passes with immediate diagnostic collection and native stop
checkpoints. All 312 compilation sources match exact native semantics, outcomes
and 899 raw/728 recorded issues: 293 formed, 16 Invalid, three Stopped, 284
Accepted and nine Declined. All 478 simulation sources are Accepted, matching
673 raw/642 recorded issues, 21 errors and 99,076 final rules. Neither corpus
throws. Test-only review fixes reject unknown semantic tags/fields and malformed
source identities; the final 87 affected checks retain both source gates. The
pure compiled-game comparator also preserves an installed native session. All
21 hashes and whitespace pass; 42 production files have no bitwise, BitVec,
numeric typed-array, Function or eval operations. The source-compiled session
adapter is now reviewed at `48936d6c` and `c37859dd`: it runs the exact independently
compiled game, binds only test correspondence identities, rejects unknown state
variants and preserves complete native compiler data before semantic comparison.
All existing replay checks remain, and the six bounded filters pass 21 fixtures,
778 observations and 23 loads. Both reviews pass 74 focused checks. The final
complete replay started at 2026-10-24 22:27:26 UTC, exec session 29095, log
`/private/tmp/typescript-source-session-corpus.log`. It completed with exit status
zero, observed at 23:22:20 UTC: all 478 fixtures, 20,034 observations/operations
and 525 level loads pass. Every fixture was visited in original order, without
skips, input trimming or native-data fallback. Standalone
source-to-trace delivery is now reviewed at `4b3bc691`: a 21-line direct example,
newly written Mouse mail game and 161-line CLI/view, with 13 meaningful tests.
Both reviewers independently repeat those checks and strict no-emit checking.
The isolated 89-file proof runs both programs with no native source, adapters or
node_modules. The final full suite passes 1,582/1,582, the focused checks 82/82,
all six example/trace commands and 21 hashes pass. The README now describes the
public source API and actual commands. The final whole-port review approves
`a60f874b` with no findings after inspecting production models/algorithms/compiler,
oracle boundaries, CLI and documentation, and independently running strict
checking and the source example. Complete replay and the final requirement audit
now pass; no implementation or verification gate remains open.

## Completion gate

Source must compile and run using only the TypeScript package. Domain state must
remain objects, cells, unnamed layers, coordinates and named movements. All 478
source-to-session differential replays and 312 compilation fixtures must pass,
with strict types, examples, source maps, documentation and independent reviews.
Those requirements are now satisfied; the final audit records their evidence.

## Diagnostic integration evidence

The following native audits established the baseline before integration. The
exact 312-fixture gate is now passed by the reviewed whole-source compiler.
Parent originally audited the
existing fixtures through the native parser with loadFile's actual post-token
`errorCount > 5` check: 268 raw issue calls become 244 recorded messages after
native deduplication. Three fixtures stop in parsing: `cake monster` at line 30,
column 6; `In the legend, define new items using the equals symbol` at line 93,
column 5; and `can strew dots around the prelude lol #1008` at line 8, column 2.
This covers the parser phase only; it is not a TypeScript parity result.

The raw native evidence is saved in
`/private/tmp/puzzlescript-native-parser-diagnostic-audit.json`. Preserve the
post-token checkpoint, deduplication, warning counts and later phase reachability
when integrating diagnostics. A parser-only traversal beyond that checkpoint
must not expand the source compiler's required recovery behavior. The companion
accepted-object audit and its two existing-fixture differences are documented in
the source-assets plan.

A second audit invokes actual native loadFile on all 312 existing sources, with
function-call phase instrumentation and no gameplay loading. It returns 293
states, 16 nulls and 3 undefined parser-cap exits, with no exceptions. There are
894 raw issue calls and 723 recorded messages after native deduplication. The
compile wrapper's final no-levels check, summary and state loading are explicitly
excluded. Full raw evidence is in
`/private/tmp/puzzlescript-native-loadfile-diagnostic-audit.json`.

Raw calls by native phase: parser 268, source preflight 26, generateExtraMembers
28, generateMasks 6, levelsToArray 8, rulesToArray 293, rulesToMask 196,
arrangeRulesByGroupNumber 9, collapseRules 8, generateRigidGroupList 1,
processWinConditions 5, checkObjectsAreLayered 13, twiddleMetaData 19,
generateLoopPoints 6, generateSoundData 6 and formatHomePage 2. These counts are
an integration baseline, not a TypeScript parity result. Compare actual native
output; the older recorded fixture expectations permit extra messages and contain
only 548 expected strings, so matching those strings alone is insufficient.

Do not treat any diagnostic error as an immediate abort. Native parser-cap exits
occur at its post-token check; explicit rule invalid flags have their own later
checkpoints. Eight fixtures still yield a loadFile state with more than five
errors from later phases; compile's wrapper then declines to install that state.
The source compiler/session boundary must state which of these operations it
models and preserve each reached phase and recorded diagnostic accordingly.

The reviewed joined rule oracle also passes all 302 existing compilation sources
whose actual loadFile reaches rule compilation. This compares final rule semantics
and complete raw rule diagnostics, including the native rule-invalid result. The
other ten sources are the three parser-cap exits and seven no-layer preflight
exits; bypassing those checks would test unreachable behavior. Scratch evidence
is in `/private/tmp/puzzlescript-existing-compiler-rule-audit.json`. Some fixture
names repeat, but all repeats share the same reachability classification. This
does not compare the earlier parser, declaration or asset diagnostics, the later
non-rule diagnostics, or the whole-source compilation result.

A companion non-rule data audit passes all 293 existing compilation sources for
which actual loadFile returns a state. It compares canonical declarations,
levels, actual native win outcomes, sounds, metadata and restore policies through
the existing independent game-data oracle. The 19 sources that stop before a
state is returned are excluded rather than forcing unreachable later phases.
Evidence is saved in
`/private/tmp/puzzlescript-existing-compiler-game-data-audit.json`. This is semantic
data evidence only; exact diagnostic streams remain the next integration work.

Actual parser visits on the 478 simulation sources produce 265 raw and recorded
issues across 104 sources, including 14 errors and no parser-cap exit. Evidence
is in `/private/tmp/puzzlescript-native-simulation-parser-diagnostic-audit.json`.
These games run despite their parser errors; whole-source assembly must not turn
any nonzero parser error count into an immediate failure. The parser-diagnostics
implementation plan records both the 312-fixture and 478-source baselines.

The actual compile wrapper has also been audited on all 312 originals, with only
setGameState stubbed to observe installation without gameplay or persistence.
It preserves loadFile's 293 formed states, 16 nulls and three parser exits, and
adds five urgent no-line `No levels found.  Add some levels!` errors. Its exact
stream is 899 raw calls and 728 recorded issues, with no exceptions. 284 formed
states reach installation; nine formed states are declined after the final
error-count check. Evidence is in
`/private/tmp/puzzlescript-native-compile-diagnostic-audit.json`. The next
whole-source compiler plan is `2026-10-24-typescript-source-compiler.md`; its
result must distinguish formed-but-declined games from explicit invalid/stopped
compilation, and must not call a zero-error-only policy vanilla parity.

The same actual compile audit on all 478 original simulation sources forms and
installs all 478 states, with no exceptions. It records 673 raw calls, 642 issues
after deduplication and 21 total errors. Raw phase counts are parser 265, extra
members 7, rulesToArray 255, lowering 143, metadata 2 and sounds 1. Evidence and
the scratch reproducer are in
`/private/tmp/puzzlescript-native-simulation-compile-diagnostic-audit.{cjs,json}`.
This is the historical native integration baseline. The completed whole compiler
matches it exactly, and the complete source-compiled session replay now passes.
