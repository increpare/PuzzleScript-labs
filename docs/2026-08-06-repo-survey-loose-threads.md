# Repo-wide survey: loose threads worth pursuing

Date: 2026-08-06
Scope: whole `PuzzleScript-labs` tree — JS engine, native C++ port, Lean
formalization, GBC/GBA/ESP32 firmware, hardware (card / pocket card / p4),
tooling, docs, branches, working tree, disk.

Method: read-only inspection plus a small number of cheap, non-timing checks
(one full JS test-suite run, three single-game compiles, `merge-tree` dry runs,
a retention dry-run). **No performance benchmarking was run**, deliberately —
benchmarks in this repo have a documented ±7–20 solve noise band and must not
be run while other work is in flight. Every performance number quoted below is
read from a checked-in document, not measured in this pass.

---

## 0. TL;DR

Nine parallel tracks. Attention has migrated hardware-ward since roughly
2026-07. Nothing is broken — the JS suite is green (753/753 in 8.6 s) — but
several finished pieces of work are sitting outside `master`, and several
explicitly-scoped projects are paused with their blockers already diagnosed.

Three highest-value moves, in order:

1. **Land the finished work** — the closed GBC optimization branch and the
   dirty pocket-card working tree. Both are complete; both are one bad
   checkout from evaporating.
2. **Compact-turn compiler support analysis** — the largest documented
   throughput lever in the repo, with a scoped blocker and an existing
   parity oracle to gate it.
3. **Write the Rec-3 "what does the pipeline optimize for" page, then expose
   one analyzer feature in the editor** — the only thread that converts labs
   work into puzzlescript.net value.

---

## 1. Attention timeline

Last commit on `master` touching each track:

| Track | Last master commit | Note |
|---|---|---|
| `hardware/` | 2026-08-06 | today; pocket card |
| `firmware/gbc` | 2026-07-28 | launcher paging |
| `lean/` | 2026-07-22 | `skipCellWrites` no-op proof |
| `src/js/` | 2026-07-10 | **the shipping engine** |
| `native/` | 2026-07-07 | |
| generator / MIS | 2026-06-23 | declarative level-set mode |

The engine that actually runs at puzzlescript.net has been static for ~4 weeks
while everything downstream of it grew substantially. That is not wrong on its
own, but it is the frame for §4 below.

---

## 2. Finished work that never landed

### 2.1 `codex/gbc-extended-optimization` — 37 commits, ~12k lines, program closed

The plan doc on that branch reads **"Status: closed after the complete standing
gate."** The 2026-07-30 closure section records a full rerun from fresh isolated
outputs:

- 17/17 native GBC tests
- 753/753 JavaScript tests
- 46/46 eligible ROMs
- the 46-game production-cart checker
- nine-game autotest cart smoke + standalone sound/render/undo hardware smoke
- two fresh 46-game benchmark-cart sweeps reproducing identical weighted
  metrics (36/46 successful games, 848 user-visible turns, 507.532 weighted
  logic ticks/turn, 724.519 weighted combined interaction ticks/turn) and both
  worst-ten orders

Retained deliverables: reproducible harness path resolution and cart/codegen
metrics (Task 0), honest interaction render telemetry (Task 1), and a per-game
cartridge timing scoreboard with an exact libmGBA runner (Task 7). Rejected
items were fully removed with "no source remains" recorded for each, and the
rejections are documented with their regression numbers.

Diffstat is dominated by tooling and tests:
`bench_gbc_cart_solutions.py` (+666) and its test (+413),
`check_gbc_cart.py` (+650) and its test (+938),
`gbc_cart_object_aliases.py` (+385) and its test (+438),
`report_gbc_cart_metrics.py` (+320) and its test (+415),
plus build/benchmark script work — 28 files, +11,979 / −149.

**Merge state: 2 conflicts, both doc files** —
`docs/performance/gbc-extended-optimization-plan-2026-07-27.md` and
`docs/superpowers/plans/2026-07-27-gbc-extended-optimization.md`, both add/add
because master landed partial copies. No code conflicts.

This is the single largest body of completed, gated, documented work outside
`master`.

### 2.2 The dirty working tree on `master`

58 paths dirty right now. Two distinct things mixed together:

**(a) A coherent, tested source fix** in
`hardware/pocket_card/electronics_pipeline/handoff.py` (+43/−7) with matching
additions in `tests/test_handoff_export.py` (+17): the handoff snapshotter
previously required a literal `BLENDER` header on `.blend` inputs, which
rejects modern Blender's zstd- and gzip-compressed `.blend` files. The change
generalizes `_snapshot_regular` from `required_prefix` to `required_prefixes`,
adds `_BLENDER_FILE_MAGICS = (b"BLENDER", zstd, gzip)`, keeps the two options
mutually exclusive, and updates all three call sites plus the error message.
Looks finished.

**(b) A full regenerated pocket-card PCB export set.** KiCad renamed the gerber
outputs to a `.gbr` extension, so ~20 old-extension files show as deleted and 9
new ones are untracked, alongside new `erc.json`, `validation.json`,
`source_manifest.json`, `BOM_JLCPCB.csv`, `pocket_card_controller.pdf`, and
modified `BOM.csv` / `CPL.csv` / `drc.json` / `.step` / gerber zip. Several
stale one-off artifacts (`drc2.json`, `drc3.json`, `temp.stl`,
`exported_placed.*`, `*_placed.*`, `.dsn`, `.ses`, `.kicad_prl`) are deleted.

The memory note `concurrent-sessions-clobber-main-checkout` records that this
checkout has been clobbered before. **This is the most perishable item in this
document.** It needs a decision (commit (a) and (b) separately; decide whether
`case/out/pcb/` generated output should be tracked at all) before any other
session touches the tree.

### 2.3 Two idle recent pocket-card branches

- `codex/pocket-card-satin-abs` — 10 commits, SLA resin lookdev presets and
  render-graph validation. **Merges clean.** Has untracked render outputs in
  its worktree (`morning_material_gallery/`, two `.blend` + two `.png`).
- `codex/pocket-card-dpad-petals` — 24 commits, petal D-pad from spec through
  profile, cap geometry, travel-relief interference proofs, transactional
  export publication, and a finished shell export audit. **2 conflicts**:
  `Makefile` and `hardware/pocket_card/case/README.md`.

Also present and correctly handled: `pocket-card-surface-treatment` (37) is
fully contained in `codex/archive-pocket-card-texture-wip-20260804` (38 = same
plus one archive commit), so that one is properly parked, not lost.
`explore/center-speaker-swap` (12 commits, 2026-08-03) has **25 conflicts** —
it has genuinely diverged and needs a decision (rebase or abandon) rather than
a merge.

---

## 3. Documented open threads, ranked by stated payoff

### 3.1 Compact-turn compiler parity — biggest lever, not started

`src/tests/COMPACT_TURN_COMPILER_PARITY_HANDOFF.md`, marked **"open project,
not started."**

The claim, from that doc: the native solver's compact-turn fast path executes a
turn directly on `PersistentLevelState` with no `FullState` materialization,
and when it engages it is **~2–2.75× faster on `step`** — where `step` is
**82–90% of all solver time**. That makes it far larger than any other
single lever recorded anywhere in the repo (PR #3's clock/allocator work was
~2–4%).

It is off because of correctness, not build infrastructure:

- `compactNativeTurnSupportForGame()` is a **stub that ignores the game and
  claims support**.
- Compiler mode has **no bridge fallback**, so any unsupported rule feature
  produces wrong results with no safety net.
- On a 4-game probe, `--compact-turn-mode=compiler` **silently miscompiled 2 of
  4 games** — `solved` became `exhausted` while exploring a different, smaller
  state graph.

The project is therefore (a) a real per-rule support analysis so unsupported
games take the interpreter bridge, and (b) kernel coverage for the features
that currently diverge. The automated parity oracle to gate both already
exists. Note this cuts against strategy Rec. 4 ("compiled tiers = frozen
calibration ceiling") — worth resolving that tension explicitly before
starting, rather than discovering it halfway.

### 3.2 Native solver Phase 2 — port the proven JS winners

`native/SYNC_WITH_JS_PLAN.md`, measured 2026-06-12.

Parity of the compiler and runtime is *fine* — 469/469 simulation corpus,
274/274 diagnostics corpus. The drift is entirely in the **search layer**: one
hardcoded heuristic (`winconditions`, `native/src/solver/main.cpp:1297`)
against JS's ~33 heuristics, the `auto` per-condition router, the A3 dead-cell
cache, D2 region isolation, and exact version-keyed field caches. Native still
wins on raw throughput (62.2% vs 53.5% of corpus at 1 s) purely by being 4–5×
faster per step.

The plan is unusually well-sized because the JS ledger already says which items
are proven: port A3 (+14 solves in JS at 250 ms), D2 (+1–4), `auto` as default,
exact version-keyed caches, then profile before porting search bookkeeping. It
also lists what **must not** be ported (C1/C1b portfolio blending, phase-split,
D1/D4/D7, stale distance-field caching, occupancy no-op predicates at 38%
false-positive). Estimated 1–2 weeks.

### 3.3 Native Phase 0/1 — stale gates and a short drift list

- `simulation_tests_cpp_js_parity` (the 32-bit per-turn trace diff, described
  as the deepest gate) is recorded as **state unknown** and has not been
  re-baselined since 2026-06-12.
- Message-classification divergence: 4 levels classified `skipped_message` by
  native but playable by JS (`car crash` 1, `cratopia` 3).
- The `no X no X` duplicate-negation warning exists JS-side with no native
  counterpart fixture.
- **Already done, doc not updated:** the `a distant sunset` JS tokenizer bug
  (keyword-glyph object names `^`, `|`, `>`) is fixed. Verified this pass —
  `node src/tests/compiler_keyword_names_node.js` passes, and the fixture
  asserts `sprt_1_1 ^` compiles. The plan estimated this at ~100 solvable
  levels and corpus-denominator alignment; that credit is already banked.
- Phase 3 asks for a single `make parity` umbrella target. It does not exist —
  there are `solver_parity_smoke`, `compact_turn_native_parity`,
  `js_parity_tests`, `simulation_tests_cpp_js_parity`,
  `native_static_analysis_parity_tests`, `lean_parity_smoke`,
  `rule_plan_parity_tests` and others as separate targets.

### 3.4 GBC follow-ups the closure explicitly split out

Both have their binding constraints already measured, which makes them cheap
to restart:

- **WRAM phase-overlay design** — gates roadmap Tasks 2 and 3. Production
  static WRAM is at **5,922 / 6,144 bytes**, 222 below the standing 6 KiB
  gate, so renderer staging and a larger composition cache cannot be added as
  independent static arrays. The original whole-render bank bracket is invalid
  because renderer code occupies switchable bank 1.
- **Same-bank compact-facade sharing canary** — the retained inventory found a
  90,250-byte stress-bound opportunity but proved no cluster directly
  shareable under current ownership; production sharing was moved to this
  separately approved canary with no ABI change.
- 8 MB cartridge is correctly deferred: 1,747,047 physical payload bytes remain
  through bank 255, and `SWITCH_ROM_MBC5_8M` neither tracks `CURRENT_BANK` nor
  supports ordinary SDCC `BANKED` calls, so it is not an 8 MB generated-call
  ABI. Reopen only below 256 KiB forecast headroom.

### 3.5 Lean track — complete and quiet

`lean/PARITY_LEFTOVERS.md`: **320 / 320** unique clean names covered,
`make lean_parity_smoke` green, "No open leftovers." All twelve `feature/lean-*`
branches are fully merged into master. The track has arrived somewhere and
stopped. There are three unexecuted design notes
(`lean-post-parity-abstract-inert`, `lean-type-hardening-next-proposal`,
`lean-wellformed-preservation`) if it's worth restarting; otherwise this is a
clean place to leave it.

---

## 4. Strategy recommendations written but never executed

`docs/solver-forensics/2026-07-03-project-strategy-recommendations.md` is the
designated roadmap and is candid about its own status. Rec. 1 (measurement
layer) was built — bench store, slice manifests, paired-run tool, freshness
checks are all live in `src/tests/solver_bench*`. Three others have no
corresponding work:

### 4.1 Rec. 3 — the one-page statement of what the pipeline optimizes for

The doc argues the repo's real product is automated generation/evaluation of
PuzzleScript games, with solving as the evaluation inner loop — so the
strategic metric is **evaluated games per CPU-hour at acceptable discrimination
quality**, not "levels solved at 500 ms". It notes that *every plan in the
directory implicitly assumed the latter*, and asks for one page re-deriving
solver targets from the actual consumer. That page was never written. The
generator has not been touched since 2026-06-23.

Consequences it flags if the reframing holds: unsolvability certificates become
as valuable as solutions; difficulty-estimate quality matters as much as solve
count; budget should be per game *family*, not per level.

### 4.2 Rec. 7 — author-facing features (the highest-leverage unexplored thread)

The analyzer already computes what PuzzleScript authors ask for: S8 "this rule
can never fire" lint (the doc calls it "one of PuzzleScript's most requested
lint features"), difficulty estimates, solvability auto-playtest in the editor.

Verified this pass: **none of the labs analyzer or solver surface is exposed in
`src/editor.html`.** A year of analyzer and solver work is entirely trapped
inside the lab harnesses.

This is the only thread that converts labs work into puzzlescript.net value,
and it runs both ways — authors using the lint become volunteer QA for
analyzer soundness, which is exactly the evidence the certificate architecture
(Rec. 2) needs.

### 4.3 Rec. 7b — publish a solving benchmark

Grid-rewriting games are a genuinely good search domain: deterministic, fully
observable, mechanically diverse, with a built-in difficulty dial. Releasing a
corpus slice + harness + baseline table would draw planning/search researchers
into doing T-series work. The doc notes this is cheap *once Rec. 1 exists*,
because the benchmark is the measurement layer, published — and Rec. 1 now
exists.

### 4.4 Rec. 1's unfinished half — artifact retention

The retention tooling was built and has **never been applied**. Dry run this
pass:

```
make solver_bench_retention_plan   →   keep 9, remove 85
```

85 of 94 tracked artifact trees are `expired_unreferenced`, the oldest 55 days.
`make solver_bench_retention_apply` reclaims them.

---

## 5. Entropy / housekeeping

### 5.1 Disk

21 GB working directory:

| Path | Size |
|---|---|
| `.worktrees` | 8.9 G |
| `build` | 5.4 G |
| `native/build` | 101 M |
| `src` | 103 M |
| `build-32` | 29 M |
| `.codex_tmp` | 17 M |
| `build-gbc-release` | 6.5 M |

All are correctly gitignored. `build/` holds 123 entries; the retention plan
above clears 85 of them.

### 5.2 Branches and worktrees

**46 branches besides master. 29 are fully merged into master** (0 commits
ahead) and are deletable. 17 carry unmerged work; of those, the live ones are
covered in §2 and the rest are experiment branches whose results are already
recorded in `JS_SOLVER_NEXT.md` or the strategy doc's §8 status table (e.g.
`codex/solver-tx4-js-lane-union`, `codex/certified-wake-prune-consumer`,
`codex/solver-tx3-sibling-priors` — all documented as rejected/backed out, so
the branches are history rather than pending work).

**8 worktrees**, 6 of them on branches that are already merged or belong to
closed programs (`lean-parity-smoke`, `lean-skip-cell-writes`,
`gbc-any-layer-coupled`, `gbc-followups-batch`,
`gbc-inline-match-apply-sokoban`, and `gbc-extended-optimization` once §2.1
lands). Note `.worktrees/gbc-inline-match-apply-sokoban` shows the *main*
checkout's dirty pocket-card paths, which is a symptom worth understanding
before pruning.

### 5.3 Upstream drift

`upstream` = `increpare/PuzzleScript`. Labs is **1,944 ahead / 16 behind**
(upstream's last commit 2026-06-21). The `src/js` divergence is ~3,400 lines
across compiler.js (+2,233) and engine.js (+1,428).

Of the 16 upstream commits:

- **`dba35572`** added two error-message tests *specifically to pin a labs
  divergence* — titled "Property inferred overwrite regression in
  puzzlescript-labs", expecting
  `Rule matches object types that can't overlap: "OBJA" and "OBJA".` for
  `[ Thing ] -> [ Thing ObjA ]` and `[ Thing ] -> [ ObjA Thing ]` where
  `Thing = ObjA or ObjB`.

  **Checked this pass: labs already emits both errors correctly**, via the
  `compile(["restart"], source)` path the error-message harness uses, with
  both `lazyFunctionGeneration` true and false. The behaviour is right; only
  the regression test is missing. Importing the two entries into
  `src/tests/resources/errormessage_testdata.js` is a few minutes and closes
  upstream's recorded concern with a real gate. Labs has 283 error tests to
  upstream's 276, and these two are the *only* upstream-only entries.

- **`cef90d4e`** "fix replace function cache key" — upstream found that
  `rigidGroupIndex` was baked into the generated replace function but absent
  from its cache key, allowing incorrect cross-game cache hits. **Labs has
  independently fixed the same class of bug more thoroughly**: `engine.js`
  around line 2057 appends `,lc<LAYER_COUNT>` and `,rg<rigidGroupIndex>` to
  the key, with a comment explaining exactly that hazard. No action needed —
  recorded here so nobody re-litigates it.

- **`9f7b42e2`** (#1163 vertical tab compiler hang, `eatWhile(/[ \t]/)` →
  `eatSpace()`) and **`247c097d`** (#1128 comments-inside-rules error) are
  both already present in labs.

- **`57d2d518`** "tidy-up of compiler.js and parser.js" and **`fda0543b`**
  "simplify parser.js" are pure refactors. These are the real cost: they touch
  exactly the two files where labs has diverged most, and reconciliation gets
  harder every month. Worth deciding soon whether labs ever merges upstream
  again or formally forks.

### 5.4 Surface area

148 harness scripts in `src/tests/`, 209 targets in a 166 KB `Makefile`.
The strategy doc flagged this as evidence for Rec. 1 back in July. Noted, not
urgent, and probably only worth attacking as a side effect of the retention
work.

### 5.5 Specs without plans

40 design docs in `docs/superpowers/specs/` have no matching plan file. Most
are either superseded, folded into a sibling plan, or hardware iterations that
landed directly. A few look like genuinely unstarted product-shaped ideas
worth a triage pass:

- `2026-06-23-level-transform-design.md` — maximize/minimize named legend
  entries, the inverse of the shipped level simplifier; explicitly aimed at
  remix/generator output.
- `2026-07-21-puzzle-processing-unit-design.md` — a "PPU": tick-latency- and
  die-area-optimized hardware engine with JS-oracle-identical results, FPGA as
  proving ground. Large, speculative, and interesting; unrelated to the
  handheld console work.
- `2026-06-20-puzzlescript-js-cpp-modular-refactor-design.md`,
  `2026-06-13-supercharged-js-solver-design.md`,
  `2026-06-17-compact-turn-mini-vm-design.md`.

---

## 6. Verification log for this pass

What was actually executed, so the claims above are auditable:

| Check | Result |
|---|---|
| `node src/tests/run_tests_node.js` | 753 passed, 0 failed, 0 errors, 8.63 s; `solver_random_replay_node` passed |
| `node src/tests/compiler_keyword_names_node.js` | ok (confirms §3.3 distant-sunset item done) |
| `compile()` on upstream's two divergence fixtures | labs emits the exact expected error in both, under both lazy-generation settings |
| `grep` of `src/js/engine.js` replace-function key construction | labs includes `lc`/`rg` in the key (§5.3) |
| `git merge-tree` vs master for 8 live branches | gbc-extended-optimization 2 (docs only), dpad-petals 2, satin-abs 0, center-speaker-swap 25, others 1–3 |
| `make solver_bench_retention_plan` | keep 9, remove 85 |
| `du -sh` on build dirs | 21 G total, breakdown in §5.1 |
| branch/worktree enumeration | 46 branches, 29 fully merged; 8 worktrees |
| `git rev-list` vs `upstream/master` | 1,944 ahead / 16 behind |

No benchmarks, solver runs, native builds, ROM builds, or renders were
executed.

---

## 7. Suggested order of work

**Now, before anything else touches the tree:**

1. Triage and commit the dirty working tree (§2.2) — split the `handoff.py`
   fix from the regenerated PCB exports, and decide whether `case/out/pcb/`
   generated output belongs in git at all.
2. Merge `codex/gbc-extended-optimization` (§2.1) — two doc conflicts.
3. Merge `codex/pocket-card-satin-abs` (clean) and resolve the two trivial
   conflicts on `codex/pocket-card-dpad-petals`.

**Cheap follow-ups, any time:**

4. `make solver_bench_retention_apply`; prune the 29 merged branches and the
   worktrees on closed programs.
5. Import upstream's two error-message tests (§5.3); update
   `native/SYNC_WITH_JS_PLAN.md` to mark the distant-sunset item done.

**Then pick one, and only one, per Rec. 6's "one plan in flight":**

6a. **Compact-turn support analysis + bridge fallback** (§3.1) — if the goal
    is solver throughput. Resolve the tension with Rec. 4 first.

6b. **Native solver Phase 2** (§3.2) — if the goal is the production runner.
    Better-scoped, lower-risk, evidence-ordered.

6c. **Rec. 3 page + one analyzer feature in the editor** (§4.1, §4.2) — if the
    goal is that any of this becomes visible outside the lab. This is the one
    with no technical blocker and no measurement dependency, and the one
    nobody has started.
