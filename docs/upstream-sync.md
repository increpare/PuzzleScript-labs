# Vanilla PuzzleScript sync

The authoritative checkpoint is [`.upstream-sync.json`](../.upstream-sync.json).
Vanilla `master` has been reviewed through **`caa90212` (3 November 2026)**;
the port was made on 3 November onto Labs `3d27de13`.

This is a selective source port. The checkpoint means every commit through that
revision has a disposition, not that Labs has the same tree or Git ancestry as
vanilla. Do not use `git merge-base` as the next-port starting point: the earlier
23 October selective port only recorded its checkpoint in
[a benchmark report](benchmarks/2026-10-23-upstream-week-ports.md).

## Next sync

From the repository root:

```sh
git fetch upstream master
SYNC_BASE=$(node -p 'require("./.upstream-sync.json").reviewedThrough')
git merge-base --is-ancestor "$SYNC_BASE" upstream/master
git log --reverse --oneline "$SYNC_BASE"..upstream/master
git diff --stat "$SYNC_BASE" upstream/master
git diff "$SYNC_BASE" upstream/master -- src/js/compiler.js src/js/parser.js src/js/engine.js
```

Review the complete commit range, including reverted changes and fixes already
implemented differently in Labs. Port final source changes onto the Labs
implementations; preserve fork extensions and tests. Import changed upstream
fixtures without replacing Labs-only cases or collapsing duplicate test names.
UI/browser tests belong to `/Users/stephenlavelle/Documents/puzzlescript_testdump/ui/`;
read that collection's `AGENTS.md` before running or editing them.

Run the core suite, relevant native and CM6 checks, build fresh standalone assets,
and verify browser behavior. Then move `reviewedThrough` to the exact fetched
revision, move the former value to `previousReviewedThrough`, set the pre-port
`labsBaseline` and `syncDate`, and update this report in the same commit. Record
any exclusions explicitly. TypeScript's immutable vanilla-reference revision is
a separate contract.

Additional branch features are recorded under `additionalPorts` in the JSON.
The local `codex/cached-again` port is described in
[cached AGAIN](cached-again.md); it does not advance the vanilla master cursor.
The local `codex/comment-rule-capture` source fix at `7417d78a` is recorded in
[the compiler fuzz report](benchmarks/2026-11-04-cpp-compiler-fuzz-findings.md).
It is also applied to the ordinary vanilla checkout; its non-testdata
regressions live in `/Users/stephenlavelle/Documents/puzzlescript_testdump/`.
TypeScript pins the exact branch commit. This port does not advance the reviewed
master cursor.

## 3 November port: `57f9f6cb..caa90212`

All 33 new commits were reviewed. The JavaScript and C++ implementations retain
Labs optimizations and extensions; TypeScript's separate immutable vanilla oracle
is refreshed to the exact reviewed head, with all 22 source/corpus hashes checked.

| Upstream commits | Disposition |
| --- | --- |
| `07047cb7`, `333785bf`, `25b8429d` | Imported gameplay coverage for overlapping properties, recovery and declaration-order behavior, preserving Labs fixtures and duplicate names. |
| `a2a22975`, `cd8dbbce` | Ported checkpoint provenance so saved/loaded checkpoint restarts skip initialization rules; fresh restarts still initialize. Adapted solver snapshots and replay wrappers. Imported restart/command coverage. |
| `ddec525b`, `446579f8` | Fixed forward aggregate resolution and rejected the closing synonym-cycle link. Native maps/recursion guards already avoid the hangs; adapted diagnostics and recovery in C++ and TypeScript. |
| `2b65e350`, `5ef36ef5` | Entirely transparent pasted sprites now declare transparent; pasted names remain unique beyond 99 objects. |
| `743b0a46` | Ported horizontal/vertical transform suffix matching. |
| `9b93f2f3` | Declared GIF encoder globals so source files work under strict mode. Labs file-drop code already scopes its variables. |
| `b1d17e8a`, `67290e18` | Ported single-test expansion and worker execution with main-thread diagnostic decoding, preserved pending-row focus/selection, and short fallback batches; adapted Labs stream and plugin-hook dependencies. |
| `65b7d0cd` | Ported actionable sound-verb/direction diagnostics across JS, C++ and TypeScript. |
| `10b95614` | Deferred initial gist/demo/file requests until editor scripts initialize; compile loaded text without waiting for unrelated images. Preserved imported-source and Labs file-query precedence. |
| `c680603e` | Controller freshness now follows physical button presses across message/level transitions. |
| `0b00eb5d` | Deferred rule restart until its message closes, retained explicit message wins, and kept speculative AGAIN command queues private. Adapted full native/TypeScript session paths. |
| `f281634e` | Ported legacy touch Undo hold/release and compatibility-click handling. |
| `d4d497b2`, `15c38ce2`, `fe815dcc` | Corrected exact-limit rule-group warning and imported loop-limit cases. |
| `83c8d761`, `4db6aabc` | Skipped empty console batches, used text line breaks, and added linked loop-jump diagnostics. |
| `5b9d6b96`, `3d450428` | Ported text/HTML diagnostic boundaries, escaped debug assembly and filenames, and inert player errors; adapted headless diagnostic decoders. |
| `3529667a` | Preserved Pushing It with reviewed local source/runtime instead of executable remote homepage markup. |
| `421b97e1`, `ae0572a2` | Ported standalone homepage URL/attribute escaping and literal display-text replacement; invalid color/rule-prefix failures no longer continue compilation. |
| `672c1001`, `cfa7a8ca`, `17bda1cf`, `caa90212` | Ported prototype-safe dictionaries, own-property color/palette checks and invalid movement-prefix diagnostics. Applied autocomplete fixes in Labs' shared CM6 engine. Native/TypeScript Maps already provide own-key storage. |
| `7b698b9a`, `5f10710e` | Rebuilt Labs generated bundles/standalone assets and native WASM rather than copying vanilla build output or release numbers. |

Imported **36 simulation** and **35 diagnostic** tuples, plus the revised existing
sound diagnostic. The wholly impossible expanded-property fixture exposed a Labs
optimization suppressing diagnostics; preserved-property coalescing now expands
that invalid case while keeping the valid fast path. Existing Labs tuples and
semantic-fixture provenance are preserved.

No upstream commits were omitted wholesale. CM5-only autocomplete edits were
adapted to the shared completion engine. Speculative AGAIN already uses isolated
scratch levels in Labs, so its command queues remain private through that design.
Native compact solver APIs retain their existing message-suppression contract.
GBA/CGB restarts now also preserve checkpoint provenance; GBA rule restarts of
fresh levels rerun initialization through the same guarded path as manual restarts.
No server deployment or public preview was started.
Standalone UI harness edits are left uncommitted in `puzzlescript_testdump`,
which already contained unrelated work; all tests, fixtures and dependencies
remain in that separate collection.

### Verification (3 November port)

- Core JavaScript: **1,110/1,110** (731 simulation, 379 diagnostics), plus
  random replay, stale frontier, sparse paths and cached AGAIN RNG checks.
  Before fixes, the imported cases reproduced five gameplay failures,
  18 diagnostic failures and a forward aggregate timeout.
- Actual browser-worker import list: **1,110/1,110** in a worker-like VM.
- CM6: **216/216**. Canonicalizer/decanonicalizer checks and **94/94**
  source round trips pass. Property rewrite coalescing and inferred RHS binding
  suites pass; **35/35** checkpoint static-analysis runtime contracts pass.
- TypeScript strict suite: **2,208/2,208**, with no skipped or cancelled tests.
  Complete compilation: **898/898 sources**, **99,254 final rules**. All **36**
  new recorded sessions pass **106** observations/operations and **38** loads.
  All six examples pass. Original TypeScript production failed **16/71** new
  compile fixtures against the refreshed oracle; the port passes all.
- Native: **731/731** gameplay and **379/379** diagnostics, including poisoned
  answers, independent source canaries and renamed identifiers. **8/8** targeted
  CTests pass, covering generated cached AGAIN and GBA/CGB checkpoint behavior.
  Native checkpoint undo now retains the session restart target; this resolves
  the prior sync's recorded failure. Startup restart/RNG ordering and AGAIN
  restart undo snapshots also match the newly imported histories. Immediate
  restart now discards its old win/checkpoint commands in the host, compact and
  CGB paths; independent review exposed and reproduced that additional edge.

- Standalone browser collection: **699 distinct selected checks** covered across
  Chromium, Firefox and WebKit (232 per browser plus three Labs file-query startup
  checks). Initial harness failures used retired CM5 inspection methods; the
  test adapters now inspect CM6's public view API and content element. WebKit
  completed the initial slow replay in 179ms, below its unchanged >200ms workload
  prerequisite. Increasing the fixture from 200,000 to 500,000 ticks made the
  workload meaningful; the complete test-page rerun passes **18/18** with the
  same frame-budget, focus, selection and fallback assertions.
- `make mis_tests` passes against the final rebuilt native WASM. Independent
  code review and an exact linked generated four-source regression run pass.
  Release/standalone assets are rebuilt from Labs sources; Brotli validation
  verifies all **447** emitted sidecars. The preserved raw Pushing It script
  matches upstream byte for byte; its valid `=======` PuzzleScript headings are
  the only exceptions to Git's conflict-marker whitespace check.

The native corpus used JSON tuples exported by the JavaScript VM, preserving
all fixture fields and semantic pushes. Its old direct JavaScript-array loader
cannot parse the current template-literal fixture source; that loader limitation
is unchanged.

Limits and retained differences:

- TypeScript's exhaustive historical-gallery session replay was stopped after
  **40 complete fixtures**, with no reported mismatch. This is not a completed
  528-game replay; the complete compilation comparison and all 36 new session
  replays did finish. See [the TypeScript audit](../typescript/UPSTREAM-2026-11-03.md).
- Vanilla's cached-diagnostic repeat-count browser assertion expects `(x2)`.
  Labs already deduplicates urgent loop errors to avoid exhausting the error
  budget. That unchanged expectation remains visibly separate from the selected
  passing browser matrix; it was not rebaselined.
- Ancillary layer-coupled tests still have the same two `no`-constraint warning
  failures on both the original and ported checkout. The standalone runtime
  contract unit suite likewise fails the same pre-existing `Player`/`player`
  label assertion on both. These are not counted as passing checks.
- Monster garden passes the five focused changed compiler/restart checks. Its
  full run reached **157/158**, with the unchanged 1ms subprocess test failing
  on `write EPIPE`; the same race was reproduced on original Labs (trial 942).
  The broad static-analysis corpus run was interrupted; only the completed
  checkpoint subset is counted above.

## 31 October port: `b44aa265..57f9f6cb`

| Upstream commits | Disposition |
| --- | --- |
| `d5a327c8` | Imported five missing gallery-game fixtures; two changed fixtures were already identical in Labs. |
| `d2c38089`, `2b1c6d30`, `941b912e`, `4e6707a0` | Ported player/footer styling, standalone hack form, `nohack`, source escaping, imported-source bootstrap, generic POST receiver and its seven tests. |
| `18b36644`, `9a51214c` | Ported desktop layout, minimum-size touch overlay fallback and release-versioned player JS/CSS URLs. |
| `8b04500e` | Restored both responsive gallery navigation bars. |
| `c69689ea` (#1206) | Fixed JS/native rigid ownership, including generated native turns; imported six multi-layer/multiword fixtures. |
| `d86185cd` (#1207) | Rejected late randomdir, preserving allowed `no`, random groups and random spawning; imported acceptance/recovery regressions. |
| `375b3be0` | CM6 already implements modifier-click links and preserves legend declaration positions. Adapted physical-line mapping to new blank-line parser behavior. |
| `636cf2d5` | Removed retired slide-out player/menu code while retaining current touch toolbar controls. |
| `5d26a2ee` (#1210) | Already present in Labs' CM6 dynamic-color plugin, including theme-sensitive cached styles. |
| `82111d80` | Narrowed keyword warnings in JS/native parsers and imported alias fixtures; primary keyword object names still warn. |
| `bf182ead` | Ported simulation/compilation browser-test tabs and stylesheet. |
| `e060ebc4`, `52837fbe` (#1186) | Ported original-case preservation, compiler-equivalent blank-line handling, and command-only RHS completion into the shared autocomplete engine used by CM6. |
| `1b0ef40c` (#1183) | Clarified selection of one collision layer; retained additional Labs fixture expectations. |
| `bd1d47fb` (#1175) | Prevented speculative JS AGAIN checkpoints. Native already returns before checkpoint handling for probes. Imported real/probe checkpoint fixtures. |
| `2ea1b651`, `b31b09cb`, `404d68d3` (#1179) | Rejected random/randomdir on the LHS and removed the complete invalid rule while preserving following rules and legal RHS randomdir. Imported diagnostics/replay cases. |
| `5e722e7b` (#1137) | Fixed keyboard/gamepad repeat insertion order, retaining fresh-press semantics. |
| `582ba015` (#1174) | Invalid zero/negative screen dimensions no longer reach viewport rendering; ported native validation too. |
| `2bf13717`, `5e7c9ca9` | Added Midwinter Springtime, its GIF/regression, and missing source links while retaining Labs gallery entries. |
| `f9ed4a24` (#1195) | Ported input timing guidance and corrected the documented default to 0.15 seconds. |
| `57f9f6cb` (#1178) | Added JS/native warning for multiple colors without a matrix, explaining the first-color fallback. |
| `6c9eb8a3`, `50c9a191`, `4b547d41`, `f1b670eb`, `fcd914ad` | External test-source migration was reverted upstream; retained final inline tuple format. |
| `49b36410`, `5a94bde1`, `beaae623` | Rebuilt Labs bundles/standalone template from resolved sources instead of copying vanilla generated assets/build numbers. |
| `1266bc75` | No matching standalone-hack document/test existed in Labs. Omitted vanilla's `/docs` ignore because Labs tracks project documentation. |

Merge-only commits add no final changes beyond their reviewed parents. The
whitespace-only `DEVELOPMENT.md` change is omitted. CM5-specific bundles, styles
and `object-links.js` are superseded by Labs' CM6 equivalents. The one-off
`server/prepare_live_import.js` hotfix targets an older vanilla live deployment
and is omitted. No server configuration or deployment was performed.

The TypeScript reference remains pinned to `5a94bde1`. Ten authored semantic cases
and three sound histories explicitly carry current-Labs overrides after #1207;
their original expectations, sources and frozen corpus remain intact for pinned
reference verification. See [the semantic fixture guide](../src/tests/semantic-fixtures/README.md).

## Verification (31 October port)

- Core JS: **976/976**, plus random replay, stale-frontier and sparse-path checks.
  Imported fixtures exposed 18 failures before the fixes.
- CM6: **216/216**. Updated the captured parser line numbers deliberately after
  empty lines began following the compiler's tokenizer path.
- TypeScript semantics: **151/151**, including all 140 historical semantic
  fixtures and 370 observations. Pinned-native verification also passes 140/140;
  historical fixture tuples remain identical to the pre-port values.
- Native diagnostics: **344/344**, including independent source canaries,
  deliberately poisoned fixture answers, and renamed identifiers.
- Native targeted CTests: **3/3**. All six rigid cases pass in both interpreter
  and linked generated kernel; the old generated kernel failed four of six.
- Native gameplay: **631/632**. The sole failure is
  `semantic: history/checkpoint-history: undo of arrival keeps checkpoint target`.
  It also fails with the original Labs fixture before this port (that history
  group passes 2/3). This existing native checkpoint/undo difference is retained
  visibly; it is not counted as a passing check or a new sync regression.
- Standalone browser collection: **264/264** candidate checks across Chromium,
  Firefox and WebKit, covering completion, editing, declaration links, player,
  export, held keys/gamepad and MIS multirow completion. Nine additional CM5
  compatibility checks pass against immutable build 1838. The original held-key
  implementation failed seven of ten Chromium scenarios before porting.
- Canonicalizer/decanonicalizer checks and **94/94** round trips pass, as do the
  static-analysis fixture runner, `make mis_tests` (including the rebuilt WASM
  backend), seven POST receiver tests, release build and Brotli verification.

The standalone UI changes are committed in `puzzlescript_testdump` as
`410c2f1`; its temporary test server was stopped. No preview or deployment was
started. The native WebAssembly solver was rebuilt from the final native sources.
