# C++ compiler differential fuzzing: first pass

Run on 4 November 2026 against `bdbb7f26`, after rebuilding
`build/native/puzzlescript_cpp`. **All eight native findings and the corpus loader
are now fixed**, with registered regression tests. Minimal sources are
in [`native/tests/fixtures/compiler_fuzz/`](../../native/tests/fixtures/compiler_fuzz/).

## Method and counts

I applied the existing `src/tests/monster_garden/garden.js` source mutators to
simulation and compiler-message fixtures. The first campaign compared parser
diagnostics with `collectParserPhaseDiagnostics` in JS and
`ps_compiler_parse_source` in C++. It generated 9,488 applicable sources from
12,000 deterministic attempts; 62 mutants crashed the JS parser and were
excluded. After decoding HTML entities in JS diagnostic text, 198 sources had
different diagnostic streams. No native parser crash was observed.

The second campaign compared `buildSemanticProgramSnapshot(state)` in JS with
`puzzlescript_cpp compile --emit-semantic-program`. Of 8,000 attempts, 6,317
produced a changed source, 2,630 compiled in JS with `errorCount == 0`, and
2,349 met the existing single-layer invariant on both sides. Of those, 2,206
semantic snapshots matched and 143 differed. Most differences repeated a small
number of causes; some were on already malformed base fixtures. Four JS
compilations threw. No C++ compile failure occurred in the compared subset.

As a control, the existing semantic corpus runner matched all 161 conforming
games in `src/tests/solver_tests` (23 skipped for the documented layer
invariant). The native diagnostic corpus passed all 379 fixtures after the JS
array was evaluated and serialized as JSON. Before the fix, the documented direct
command on `errormessage_testdata.js` exited with `simdjson: TAPE_ERROR`: its
loader assumed the JS file was JSON-like, while it contained backtick strings.
The repaired command now passes on the original file.

## Distinct native findings

| # | Reproducer | Observed JS / C++ behavior | Likely location |
| --- | --- | --- | --- |
| 1 | [`comment_line_splits_level.txt`](../../native/tests/fixtures/compiler_fuzz/comment_line_splits_level.txt) | A comment-only line between map rows leaves one 2×2 level in JS but produces two 2×1 levels in C++. The player would see a different level sequence. | `parser.cpp` blank-line handling around `handleBlankLine` and the stripped-comment path |
| 2 | [`malformed_rule_retained.txt`](../../native/tests/fixtures/compiler_fuzz/malformed_rule_retained.txt) | Both warn about nested `[`, but JS drops the malformed rule (0 semantic rules) while C++ emits one. This is an executable miscompile of a warned-about source. | `lower_to_runtime.cpp` rule parsing around `parseRules` |
| 3 | [`mixed_late_group.txt`](../../native/tests/fixtures/compiler_fuzz/mixed_late_group.txt) | For five authored rules, JS group numbers are `0,0,0,1,1`; C++ gives `0,0,0,1,0`. The final `+` rule joins the first early group instead of retaining its source group after a `late` rule. Both compilers warn about mixed early/late groups. | `lower_to_runtime.cpp:1471-1477`, which selects separate early/late group arrays before assigning authored group numbers |
| 4 | [`nbsp_legend.txt`](../../native/tests/fixtures/compiler_fuzz/nbsp_legend.txt), [`nbsp_metadata.txt`](../../native/tests/fixtures/compiler_fuzz/nbsp_metadata.txt) | JS accepts U+00A0 between legend tokens and after `author`. C++ loses the `Pair` alias and reports it undefined, or rejects the metadata line. This also changes semantic output for otherwise clean games. | `parser.cpp` `splitWhitespace` uses ASCII `std::isspace` |
| 5 | [`bom_trim.txt`](../../native/tests/fixtures/compiler_fuzz/bom_trim.txt) | JS trims U+FEFF from the end of a title and a `message` line; C++ stores it in both values. A `title U+FEFF` line is also treated as a value by C++ but reported as missing a value by JS. | `parser.cpp` Unicode whitespace classification and message/metadata trimming |
| 6 | [`unknown_glyphs.txt`](../../native/tests/fixtures/compiler_fuzz/unknown_glyphs.txt) | For map row `PXYZ`, JS reports missing `X`, `Y`, and `Z`; C++ reports only `X`. | `parser.cpp:1431-1453`, which stops at the first unknown glyph |
| 7 | [`two_undefined_win_names.txt`](../../native/tests/fixtures/compiler_fuzz/two_undefined_win_names.txt) | For `all Floop on Missing`, JS reports both undefined names; C++ reports only `FLOOP`. | `parser.cpp:2266-2336` win-condition token handling |
| 8 | [`metadata_value_case.txt`](../../native/tests/fixtures/compiler_fuzz/metadata_value_case.txt) | JS quotes the normalized `true` in the warning for `run_rules_on_level_start TrUe`; C++ quotes mixed-case `TrUe`. | `parser.cpp` metadata warning formatting |

The control-character mutator also found differences for U+000B and U+2028
inside object colors, legend names, and messages. For example, JS includes the
control character in the quoted invalid color, while C++ dropped it. The
additional reduced fixtures now cover these recovery and whitespace cases;
their diagnostic streams match JS after the fixes.

## Cross-port check

The 22 reduced sources and a minimized commented-rule case were also checked
against the independently built TypeScript compiler and the hash-verified vanilla
oracle at `caa902120185b354f8b9bdb7bf67a9424be0665d`. All 23 matched between
TypeScript and vanilla, including recorded diagnostics, compilation outcomes,
and complete compiled game comparisons. This exposed two shared behaviors:

| Behavior | Labs JS | TypeScript | Pinned vanilla JS |
| --- | --- | --- | --- |
| `[ Player ] -> [[ Player Flag ]` warns but leaves an executable rule | Already rejects the rule | Retains it | Retains it |
| `( [ Player ] -> [ Player Flag ] (note) ) cancel message garden` reactivates a rule inside a comment | Fixed in this change | Fixed in this change | Fixed in local vanilla |

The original behaviors were verified in gameplay: starting with only Background
and Player, pressing Action creates Flag on the affected implementations. Labs JS leaves
Flag absent for the malformed-bracket case. TypeScript reproduces both with
its default settings and with `noQuirks`; these are compiler behaviors rather
than optional runtime compatibility switches. The malformed-rule finding was
therefore a native discrepancy relative to Labs JS that also existed in the
vanilla reference and its TypeScript port.

The other original reduced cases did not exhibit the C++ map-splitting,
grouping, whitespace, trimming, or diagnostic problems in this TypeScript/
vanilla comparison. The prototype-map and Set-export findings were defects in
the JS test exporters, separate from the game compilers.

Some semantic mismatches involving `__proto__` arose in the JS oracle, whose
object-name maps used an inherited prototype. Those maps now have null
prototypes, and the regression suite includes synonym, property, and aggregate
cases. The parser snapshot exporter now also preserves names and glyphs stored
as Sets; native name lists suppress duplicates in the same insertion order.

## Fixes and verification

Lowering now reuses the diagnostic parser's structurally accepted rules and
source group identities. Early/late phase separation therefore preserves source
groups, and rules rejected for malformed brackets cannot become executable.
Comment-only lines preserve map continuity. Unicode token splitting and trimming
match JS, including U+FEFF. Parser recovery now reports every invalid map glyph
and win-condition name, keeps duplicate-object recovery in the same state as JS,
and retains raw whitespace in invalid-color diagnostics. Legend and prelude
recovery and collision punctuation are covered by additional reduced fixtures.

The CLI keeps its native JSON path and uses a bounded Node fixture exporter for
JavaScript string syntax such as backticks. It evaluates only the explicitly
requested fixture, including when invoked from an unrelated working directory.

After the fixes, all **9,488 parser mutants match** (198 differences before).
The 8,000-attempt semantic campaign now compares **2,352 conforming sources and
matches all 2,352**, with no native compilation failures. Of 6,317 changed
sources, 2,629 compile without JS errors. Four JS compilation exceptions remain
excluded as before. The former remaining disagreement was the commented-rule
reactivation bug, now corrected in every port.

### Comment capture correction across ports

For `( [ Player ] -> [ Crate ] (note) ) cancel`, closing the leading comment
reenters RULES at logical start of line. Previously, an unanchored regular
expression searched the entire physical line and rediscovered the rule inside
the outer comment, stopping at `(note)`. The suffix triggered the visit, while
the comment supplied the executable rule. WINCONDITIONS had the same whole-line
search defect.

Labs JS and vanilla now capture from the current live cursor, once per physical
line. Mixed-case source starts at the corresponding authored offset, including
Unicode lowercase expansion. TypeScript implements the same capture directly
in its lexical walk and authored reader, under both default quirks and
`noQuirks`. C++ retains valid rules and win conditions after leading nested or
multiline comments. Trailing inline comments end a body capture; ignored
suffixes cannot open comments that swallow the next line. Stray leading closes
consume logical start of line, while section headings still validate trailing
text after comments.

Vanilla's source-only local fix is `7417d78a` on
`codex/comment-rule-capture`, also applied in its ordinary checkout.
TypeScript pins the exact branch commit, with all 22 source hashes
checked against that commit. Vanilla's 16-case headless regression, exact-source
fixtures, hashes and runner are owned by
`/Users/stephenlavelle/Documents/puzzlescript_testdump/`, as requested. Vanilla
contains no added non-testdata test or runner wiring. No remote push occurred.

The full TypeScript suite passes **2,227/2,227**, Labs **1,110/1,110**, and the
current ordinary vanilla checkout **900/900** (including concurrent testdata
additions). The native reduced collection covers **30 diagnostic sources and
12 semantic sources**, including comments, Unicode offsets and recovery.
Web bundles and standalone templates were rebuilt in both JS checkouts, and
the native browser WASM was rebuilt. Its build source list now includes
`diagnostic_rules.cpp`, which lowering uses for shared rule acceptance/grouping.

Sixteen file fixtures and several inline native fixtures omitted the required
SOUNDS heading. Shared rule acceptance exposed that invalid input by dropping
their rules. Their empty SOUNDS headings are now explicit. File fixture edits
replace existing blank lines, retaining source line numbers and the intended
movement assertions.

The full native suite also exposed an independent existing runtime bug in the
live `alternatey` replay. After winning into a message level, a queued AGAIN tick
executed against the retained board; JS correctly ignored it in text mode. Native
message/title handling now discards that continuation and clears its prepared
caches. The focused regression checks interpreter and compiled compact paths,
including board, RNG, undo and audio preservation. The live trace is retained as
the end-to-end check; its expected result was not changed.

The final full native build succeeds and all **121/121 CTests** pass. Direct
native simulation replay also passes **731/731** after the runtime correction.
MIS checks pass with the rebuilt browser WASM.

The 731 native simulation cases pass. The diagnostic corpus passes all 379 cases,
including source canaries, renamed identifiers, and poisoned expected-answer
files. The existing semantic corpus still matches all 161 conforming games.

## Reproduce

From the repository root, with the C++ executable built:

```sh
node src/tests/js_oracle/export_ir_json.js native/tests/fixtures/compiler_fuzz/comment_line_splits_level.txt --snapshot-phase semantic > /tmp/ps-js.json
build/native/puzzlescript_cpp compile native/tests/fixtures/compiler_fuzz/comment_line_splits_level.txt --emit-semantic-program > /tmp/ps-cpp.json
```

Compare `semantic_program.levels` in those two JSON files. Substitute
`malformed_rule_retained.txt` or `mixed_late_group.txt` and compare
`semantic_program.rules`. For parser diagnostics, use the JS export with
`--snapshot-phase parser-diagnostics` and the native CLI with `--diagnostics`;
the latter also includes post-parser diagnostics, so compare the relevant
messages rather than raw line counts. The fixture files contain literal
U+00A0 and U+FEFF where named above.

Run the registered reduced-source regressions with:

```sh
node src/tests/compiler_fuzz_regressions_node.js build/native/puzzlescript_cpp
node src/tests/native_diagnostic_regressions_node.js build/native/puzzlescript_cpp
```

The reduced sources were observed failing before their fixes. The first command
checks parser diagnostics and semantic output against JS, plus Set/prototype
handling in the reference snapshots; both commands are registered with CTest.

The complete parser-state corpus now matches on all **1,110 sources** (731
simulation sources and 379 error fixtures). This also exposed and fixed missing
original-case metadata for hyphenated legend names, metadata left by rejected
aggregate definitions, prototype keys lost by the JS snapshot exporter, and
unescaped control characters in native parser JSON. The reduced regression
collection includes these cases.
