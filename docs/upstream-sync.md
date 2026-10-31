# Vanilla PuzzleScript sync

The authoritative checkpoint is [`.upstream-sync.json`](../.upstream-sync.json).
Vanilla `master` has been reviewed through **`57f9f6cb` (30 October 2026)**;
the port was made on 31 October onto Labs `7828b7ec`.

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

## Verification

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
