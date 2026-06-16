# Compact-turn compiler-mode parity — hand-off report

**Status:** open project, not started. Scoping + evidence below.
**Author of this report:** profiling session 2026-06-17 (see also the HDA solver
profiling memory and PR #3 "perf(solver): cut HDA clock reads and pool node-state buffers").
**One-line goal:** make the native compact-turn *compiler* backend produce
**bit-identical search behaviour** to the interpreter for every supported game,
and fall back to the interpreter bridge (correctly) for the rest — so the
~2× step speedup it already delivers can actually be turned on.

---

## TL;DR

The native solver has a per-game **compact-turn** fast path that executes a turn
directly on `PersistentLevelState` (no `FullState` materialization). When it
engages it is **~2–2.75× faster on `step`** — and `step` is **82–90%** of all
solver time, so this is the single biggest throughput lever in the solver, far
bigger than the ~2–4% clock/allocator wins in PR #3.

It is **off by default** and never engages in the generic corpus binary because
it is a **build-time codegen + link** specialization (weak `extern "C"` stubs
resolve to `nullptr` unless a SPECIALIZE build links strong, source-hash-keyed
definitions in). That part is by design.

The **blocker to turning it on is correctness, not build infra.** Measured on a
4-game probe (below), `--compact-turn-mode=compiler` **silently miscompiled 2 of
4 games**: they went from `solved` to `exhausted` while exploring a completely
different (smaller) state graph. Root cause: there is **no per-rule support
analysis** — `compactNativeTurnSupportForGame()` is a stub that ignores the game
and claims support, and compiler mode has **no bridge fallback**, so any rule
feature the native kernel doesn't correctly implement produces wrong results
with no safety net.

**The project:** (a) implement a real support analysis so unsupported games take
the interpreter bridge, and (b) extend the native kernel to correctly cover the
features that currently diverge — gated by the existing automated parity oracle.

---

## Background: what compact-turn is and the two modes

Three escalating per-game specializations exist; all are codegen'd C++ linked
into a SPECIALIZE build and looked up at runtime by source hash:

| backend | what it specializes | runtime field |
|---|---|---|
| `specializedRulegroups` / compiled rules | rule-group application | `Game::specializedRulegroups` |
| `specializedFullTurn` / compiled tick | a whole turn over `FullState` | `Game::specializedFullTurn` |
| **`specializedCompactTurn`** / compiled compact tick | a whole turn **directly on `PersistentLevelState`** (no FullState materialize) | `Game::specializedCompactTurn` |

Lookup is via **weak** stubs in `native/src/runtime/compiled_rules.cpp:8-36`
(`ps_specialized_compact_turn_find_backend` / `ps_compiled_compact_tick_find_backend`),
which return `nullptr` in the generic binary. `attachLinkedCompiledRules()`
(same file, line 49) sets the pointers; they stay null unless a SPECIALIZE build
links strong definitions. Hence `compact_turn_attempts == 0` in any normal
corpus run — **expected, not a bug.**

`--compact-turn-mode` has two values (parsed in `native/src/cli/main.cpp:6310`,
sets `CompactCodegenOptions::interpreterMode`):

- **`compiler`** (interpreterMode=false): emit the **native kernel** for the turn.
  No bridge fallback. This is what `solver_focus_compact_codegen_*` uses and what
  is fast — but currently unsafe (see below).
- **`interpreter`** (interpreterMode=true, the codegen default): emit a thin
  wrapper that calls `compactStateInterpretedTurnBridge(...)` — i.e. it re-enters
  the real interpreter. Always correct, but ~no speedup (it *is* the interpreter,
  plus bridging overhead).

So today it's all-or-nothing: fast-but-sometimes-wrong, or correct-but-slow.

---

## The defect, precisely

`native/src/compiler/compact_turn_codegen.cpp`:

```cpp
CompactTurnSupport compactNativeTurnSupportForGame(const Game& game) {
    (void)game;                 // <-- ignores the game entirely
    return CompactTurnSupport{}; // default backendKind = Unsupported
}

CompactTurnSupport compactTurnSupportForGame(const Game& game, const CompactCodegenOptions& options) {
    CompactTurnSupport support = compactNativeTurnSupportForGame(game);
    support.nativeKernelStatusReason = support.statusReason;
    if (!options.interpreterMode) {            // compiler mode:
        support.backendKind = CompactTurnBackendKind::NativeKernel;  // force native, no analysis
        support.statusReason = "native_kernel";
        support.nativeKernelStatusReason = "native_kernel";
        return support;
    }
    if (options.interpreterMode && !support.supported()) {  // interpreter mode:
        support.backendKind = CompactTurnBackendKind::InterpreterBridge; // always bridges
        support.statusReason = "interpreter_bridge";
    }
    return support;
}
```

(`CompactTurnSupport` / `CompactTurnBackendKind` in `compact_turn_codegen.hpp:17-38`;
default `backendKind = Unsupported`, so `.supported()` is false by default.)

Consequences:
- **compiler mode** → always `NativeKernel`, **regardless of whether the kernel
  actually implements the game's rules correctly.** No `InterpreterBridge`
  emitted. Wrong rules ⇒ wrong turn ⇒ wrong (smaller) reachable graph ⇒ search
  exhausts without the solution it should find.
- **interpreter mode** → since the stub always reports `Unsupported`, *every*
  game bridges. Correct, but defeats the purpose.

The native kernel itself is emitted from the `compactTurnSupport.nativeKernel()`
branch at `compact_turn_codegen.cpp:2840`; the bridge from the
`usesInterpreterBridge()` branch at `:2876`
(`compactStateInterpretedTurnBridge`). Backend struct emitted at `:2886` carries
`{supported, statusReason}` and a `nativeKernel` bool.

---

## Measured evidence (the probe that exposed this)

Command (worktree, 4-game mini focus manifest, 3 runs, optimized build):

```
make solver_focus_compact_codegen_perf_report \
  SOLVER_FOCUS_MANIFEST=/tmp/mini_focus.json SOLVER_FOCUS_RUNS=3
```

Mini manifest = 4 eligible (non-random) targets pulled from
`src/tests/solver_focus_group.json`:
heroes_of_sokoban_3#10, cakemonsters#49, witch lifter#1, gem soketeer#31.

Codegen succeeded for all 4 (`compiled-rules-misses: none=0`), compact-turn
engaged (`compact_turn_attempts 0 → 17728`, **100% native hit rate**, 0 bridge).

**Aggregate (compiled / interpreted, lower = faster):**
- `step_ms` 0.184× (**−82%**), `elapsed_ms` 0.250× (**4× faster**), `wall_ms` 0.293×
- `clone` −100%, `state_capture` −100% (no FullState materialize), `heuristic` 0.186×

**But the status line gives it away:**
```
status: interpreted={"solved":12} compiled={"solved":6,"exhausted":6}
work_mismatches: generated=2 expanded=2
  witch lifter.txt#1:  generated interpreted=5734  compiled=396   (solved → EXHAUSTED)
  gem soketeer.txt#31: generated interpreted=13026 compiled=1155  (solved → EXHAUSTED)
```

Per game:

| game | result | step (interp→comp) | generated (interp→comp) | verdict |
|---|---|---|---|---|
| heroes_of_sokoban_3 #10 | solved→solved | 191.6→97.7 ms (~2.0×) | 17728→17728 (1.00×) | **correct, ~2× win** |
| cakemonsters #49 | solved→solved | 155.3→56.4 ms (~2.75×) | identical | **correct, ~2.75× win** |
| witch lifter #1 | solved→**exhausted** | 324.7→4.9 ms | 5734→396 | **MISCOMPILED** (bogus "speedup") |
| gem soketeer #31 | solved→**exhausted** | 419.7→11.6 ms | 13026→1155 | **MISCOMPILED** |

The huge "speedups" on the diverged games are illusory — the kernel just
produced a tiny wrong graph and gave up. The honest result: **~2–2.75× where
correct; wrong on half the sample.**

> ⚠️ Note: `compare_solver_focus_benchmarks.js` prints
> `goal_elapsed_ratio: pass=yes`, which is **misleading** here — two targets
> "passed" by exhausting early. The trustworthy signal is `work_mismatches`
> (`generated`/`expanded` differing) and the `status` solved/exhausted split.
> Treat any `work_mismatch` as a hard failure.

---

## Starting hypotheses for the coverage gap

Feature fingerprint of the four probe games (rule-section keyword counts):

| game | again | late | startloop/endloop | horizontal/vertical | result |
|---|---|---|---|---|---|
| heroes_of_sokoban_3 | 1 | 22 | 0 | 0 | ok |
| cakemonsters | 0 | 0 | 0 | 0 | ok |
| witch lifter | 2 | 11 | 0 | **8** | DIVERGED |
| gem soketeer | 0 | 8 | **2** | 0 | DIVERGED |

The two diverged games are the only two using:
- **`horizontal` / `vertical` directional restrictions** (witch lifter), and
- **`startloop` / `endloop` rule loops** (gem soketeer).

These are **hypotheses, not confirmed root causes** — the next person must
confirm by reducing each game to a minimal repro (see below). But they are
strong leads since the passing games use neither. `again` and `late` rules are
*not* discriminating (heroes_3 has both and is correct).

---

## Correctness oracle & reproduction

The interpreter is the ground truth, and the focus harness already diffs against
it automatically:

- `src/tests/run_solver_level_benchmark.js` runs each manifest target and records
  expanded/generated/status/timing.
- `src/tests/compare_solver_focus_benchmarks.js` diffs interpreted vs compiled
  and emits `work_mismatches` + per-target `generated_mismatch_examples`.
- `src/tests/extract_solver_focus_corpus.js` pulls just the manifest's games into
  a focus corpus for codegen, so a small manifest ⇒ small/fast build.

**Reproduce the divergence (≈5 min after first build):**

```bash
# minimal manifest with just the two diverged games (+ a passing control)
#   (filter src/tests/solver_focus_group.json targets to those games)
make solver_focus_compact_codegen_perf_report \
  SOLVER_FOCUS_MANIFEST=/path/to/mini_focus.json SOLVER_FOCUS_RUNS=3
# look for: status compiled has "exhausted", and work_mismatches > 0
```

**Tighter single-game loop** for iterating on the codegen (interpreter vs
compiler on one game, same level/timeout, compare solution + node counts):
build a SPECIALIZE solver via the `solver_focus_benchmark SPECIALIZE=true` path
with `SOLVER_FOCUS_COMPILED_RULES_ARGS="--compact-turn-only --compact-turn-mode=compiler"`
and `SOLVER_FOCUS_SOLVER_ARGS="--compact-node-storage"`, then run the same level
with and without `--compact-node-storage` and diff `--json` output. There is
also a `--compact-turn-oracle` solver flag that checks each compiled compact
turn against the interpreter at runtime — use it to localize *which turn /
which rule* first diverges.

---

## Recommended approach (milestones)

1. **Make compiler mode safe by construction.** Replace the
   `compactNativeTurnSupportForGame` stub with a real analysis that walks the
   game's rules and returns `Unsupported` for any feature the native kernel does
   not yet implement. Then have **compiler mode emit the `InterpreterBridge` for
   unsupported games instead of forcing `NativeKernel`.** This immediately makes
   compiler mode *correct everywhere* (fast where supported, bridged elsewhere),
   converting silent miscompiles into honest fallbacks. Gate with a CI check that
   `work_mismatches == 0` over the full focus manifest.

2. **Localize the two known divergences.** Use `--compact-turn-oracle` to find
   the first diverging turn in witch lifter and gem soketeer; reduce each to a
   minimal failing game (a few rules + a tiny level). Confirm whether
   `horizontal`/`vertical` restrictions and `startloop`/`endloop` loops are the
   actual culprits, or proxies for something else.

3. **Extend the native kernel** to correctly implement those features in
   `compact_turn_codegen.cpp`, removing them from the "unsupported" set as each
   reaches parity. Each addition is guarded by the oracle + the focus diff.

4. **Widen the corpus** from the focus manifest toward the full corpus, tracking
   the supported fraction and the realized aggregate speedup. Keep the bridge as
   the permanent safety net.

5. **(Separate, later) deployment model.** A corpus-wide compact-turn solver
   means codegen+compiling ~150 games into the binary (heavy build) or
   compile-on-demand per game. Out of scope until parity is proven, but worth
   keeping in mind so the support-analysis API is shaped for it.

**Definition of done for the parity milestone:** over the full focus manifest
(and ideally the full corpus), `compare_solver_focus_benchmarks.js` reports
`work_mismatches == 0` and zero `solved→exhausted` regressions, with the native
kernel covering a large, growing fraction and everything else correctly bridged.

---

## Constraints & gotchas

- **`random` games are categorically excluded** from compact-turn codegen
  (`extract_solver_focus_corpus.js` / focus manifest had 31 `random_excluded_games`).
  ~17% of the corpus (32/184). They will always use the interpreter; don't chase
  parity for them.
- **The benchmark's `pass=yes` is not a parity signal** — only `work_mismatches`
  and the solved/exhausted split are. Wire the real gate accordingly.
- Compact-turn requires `--compact-node-storage` on the solver side (it operates
  on the compact `PersistentLevelState`); that flag is already in
  `SOLVER_FOCUS_COMPACT_SOLVER_ARGS`.
- Builds are cached by manifest hash under
  `build/compiled-rules/solver-focus-<hash>/`; changing the manifest or codegen
  inputs triggers a rebuild.

## Key files

| file | role |
|---|---|
| `native/src/compiler/compact_turn_codegen.cpp` | the codegen; **`compactNativeTurnSupportForGame` stub (~:2896)**, support decision (`:2901`), native-kernel emit (`:2840`), bridge emit (`:2876`), `emitCompactTurnUnsupportedBody` (`:1684`) |
| `native/src/compiler/compact_turn_codegen.hpp` | `CompactTurnSupport` / `CompactTurnBackendKind` (`:17-38`) |
| `native/src/runtime/compiled_rules.cpp` | weak backend-lookup stubs (`:8-36`), `attachLinkedCompiledRules` (`:49`), `compactStateInterpretedTurnBridge` |
| `native/src/cli/main.cpp` | `--compact-turn-mode` parse (`:6310`), `--compact-turn-only`, compile-rules subcommand |
| `native/src/solver/main.cpp` | solver-side compact-turn use (`edge.compactTurn.handled`), `--compact-turn-oracle`, `--compact-node-storage` |
| `src/tests/run_solver_level_benchmark.js` | focus benchmark runner |
| `src/tests/compare_solver_focus_benchmarks.js` | interp-vs-compiled diff + `work_mismatches` (the oracle) |
| `src/tests/extract_solver_focus_corpus.js` | extracts manifest games for codegen |
| `src/tests/solver_focus_group.json` | the 50-target / 35-game focus manifest |
| `Makefile` | `solver_focus_compact_codegen_perf_report` / `_compare`, `solver_focus_benchmark` (SPECIALIZE path) |
