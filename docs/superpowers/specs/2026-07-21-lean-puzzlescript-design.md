# Lean PuzzleScript runtime (IR parity smoke)

Status: design approved, pending implementation plan.
Date: 2026-07-21.

## 1. Goals, scope, and non-goals

### Primary goal

Add an **executable** Lean 4 runtime that loads the same JS-exported IR and simulation fixtures already used by the C++ parity path, steps a small whitelist of `testdata.js` simulation cases, and matches the expected end state.

Correctness is established by execution against the JS oracle artifacts. Without executability, the Lean model cannot be trusted.

### Secondary goal

Keep Lean types and transition functions proof-friendly so later theorems can underwrite static analysis and optimizer soundness (for example: cosmetic / inert rule elimination). Proofs are **not** required in the first milestone.

### Fidelity bar

- **JS is the primary behavioral reference** for fixtures and everyday parity. Lean should match `expected_serialized_level` for every whitelisted simulation fixture in the normal case.
- **Do not deliberately encode JS bugs in Lean.** Unlike the C++ port’s bug-for-bug policy, if Lean work surfaces incorrect JS (or C++) behavior, **report it** (issue / note) and prefer the corrected semantics in Lean rather than copying the bug.
- Practical handling when a whitelist case hits a real JS bug: file the report, document the case, and either fix the oracle side or temporarily drop/waive that case with an explicit rationale — do not silently “pass” by imitating the bug.
- Other divergences (unsupported feature, Lean implementation mistake) remain Lean bugs or explicit unsupported-feature failures — not an excuse to invent new PuzzleScript dialect semantics.

### In scope (v1)

- Lake project under `lean/` (Lean 4).
- Decode a **subset** of exported IR sufficient for the whitelist.
- Session stepper: apply fixture inputs and compare final serialized level.
- Whitelist file naming a handful of simple cases from the JS simulation suite (`testdata.js` / `make tests_js` simulation tests).
- Makefile target `lean_parity_smoke` that depends on existing `js-parity-data` and runs the Lean checker.
- Short `lean/README.md` documenting toolchain (`elan` / `lake`) and how to run the smoke target.

### Out of scope (v1)

- Lean parser or compiler from PuzzleScript `.txt` source.
- Full simulation corpus or diagnostics / error-message corpus.
- Sound-event parity (optional later; not a v1 gate).
- Proofs, extraction to C/JS, solver, player/UI.
- Replacing JS or C++ as oracles.
- Making Lean part of default `make tests` / required CI (optional / gated until Lean is a documented optional dependency).

### Non-goals (near term)

- Performance competitive with C++ or JS.
- Full IR schema coverage on day one.
- Changing the JS oracle, fixture exporter, or C++ runtime to accommodate Lean.

## 2. Architecture

### 2.1 Data flow

Lean reuses the existing C++ parity export pipeline. **No modifications to `js_oracle` or other JS sources are required for v1.**

```
testdata.js
    │
    ▼
src/tests/js_oracle/export_native_fixtures.js   (existing)
    │
    ├── build/js-parity-data/ir/<fixture>.json
    ├── build/js-parity-data/traces/<fixture>.json
    └── build/js-parity-data/fixtures.json
    │
    ▼
lean/  (new Lake package)
    ├── PuzzleScript.IR            decode needed IR subset
    ├── PuzzleScript.Runtime       session state + step
    ├── PuzzleScript.Serialize     level string for comparison
    └── PuzzleScript.ParitySmoke   whitelist runner (lake exe)
    │
    ▼
make lean_parity_smoke
```

Node is used only to produce fixtures (already true for C++). Lean does not call Node at runtime; it only reads files. JS stays the oracle.

### 2.2 Repository layout

| Path | Purpose |
|---|---|
| `lean/` | Lake package root (`lakefile.lean`, `lean-toolchain`, sources). |
| `lean/PuzzleScript/` | Library modules (`IR.lean`, `Runtime.lean`, `Serialize.lean`, …). |
| `lean/Main.lean` or `lean/ParitySmoke.lean` | Executable entry for the smoke runner. |
| `lean/parity_whitelist.txt` | One fixture name per line (names from `fixtures.json` / `testdata.js`). |
| `lean/README.md` | Toolchain + `make lean_parity_smoke`. |

Makefile integration:

- Depend on existing `js-parity-data` / `$(JS_PARITY_MANIFEST)` (same as C++ parity).
- Invoke `lake exe` (or equivalent) with the fixture directory and whitelist path.
- Do not add Lean to the default `tests` aggregate in v1.

### 2.3 Runtime shape

- **`Game`**: immutable structure decoded from exported IR (objects, collision layers, rules, win conditions, and whatever else the whitelist requires).
- **`Session`**: mutable gameplay state (board/occupancy, level index as needed, `again` / command flags as required by whitelist games, RNG only if a whitelisted case needs it).
- **`step`**: `Game → Session → Input → Except String Session` (or an equivalent explicit error type).
- **Serialization**: produce the same `serialized_level` string format the fixtures already store as `expected_serialized_level`.
- Prefer pure functions and explicit state threading so later proofs can quantify over transitions.

### 2.4 Growth path

1. Widen `parity_whitelist.txt` as IR/runtime coverage grows.
2. Optionally compare per-input snapshots from exported traces for differential debugging.
3. Add theorems over the same `Game` / `Session` / `step` definitions to support static analysis and optimizer soundness.
4. Only after runtime coverage is boring: consider a Lean frontend (parser/compiler). That is a separate design.

## 3. Components, testing, and errors

### 3.1 Components

| Component | Responsibility |
|---|---|
| `PuzzleScript.IR` | Parse JSON IR for the fields the whitelist needs. Reject unsupported-but-required features with a clear error. |
| `PuzzleScript.Runtime` | Apply inputs through rule application, movement, and `again` (and other mechanics only as whitelist cases demand). |
| `PuzzleScript.Serialize` | Emit fixture-comparable level strings. |
| `PuzzleScript.ParitySmoke` | Load manifest + whitelist; for each case load IR + inputs + expectation; replay; report pass/fail. |
| `parity_whitelist.txt` | Explicit allowlist. Start with a few simple Sokoban-like cases from the JS simulation suite. |

### 3.2 Testing

Primary gate:

```bash
make lean_parity_smoke
```

This should:

1. Ensure `build/js-parity-data` exists via the existing export target (no new JS exporter).
2. Build/run the Lean parity executable against that directory and the whitelist.
3. Exit non-zero on any failure.

Success criterion for a case: final `serialized_level` equals `expected_serialized_level` from the exported fixture/trace.

Sound parity is out of scope for v1. Per-input snapshot diffs are a useful debugging follow-on, not a v1 requirement.

### 3.3 Error handling

- Missing fixture, IR decode failure, or unimplemented feature required by a whitelist case → hard fail with fixture name and reason.
- Level mismatch → hard fail with expected vs actual (and fixture id).
- No silent skips inside the whitelist. If a case needs unimplemented semantics, remove it from the whitelist until supported.

### 3.4 Toolchain

- Lean 4 via `elan`, project pinned with `lean/lean-toolchain`.
- Document minimum steps in `lean/README.md`.
- v1 treats Lean as an optional developer dependency: the target fails clearly if `lake` is missing rather than being required for all contributors.

## 4. Relationship to existing ports

| Implementation | Role |
|---|---|
| JavaScript (`src/`) | Primary reference and fixture source via `js_oracle`; bugs discovered via Lean should be reported, not enshrined. |
| C++ (`native/`) | Production native compiler/runtime; full corpus parity consumer of the same fixtures (still tends toward JS bug-for-bug). |
| Lean (`lean/`) | Executable formal model; smoke parity on a whitelist; prefers correct semantics when JS is wrong; future proof surface for analysis/optimization. |

Lean is a peer consumer of fixture data, not a replacement for JS or C++.

## 5. Future work (explicitly deferred)

- Proofs that justify static-analysis / optimizer rewrites (cosmetic closure, inert command-only rules, etc.).
- Broader corpus coverage and trace-level differential debugging.
- Diagnostics corpus in Lean.
- Lean parser/compiler from source.
- Optional CI job when Lean is available.

## 6. Open decisions resolved in this design

| Question | Decision |
|---|---|
| Executable vs proofs-only? | Both long-term; executable first (parity), proofs later. |
| Bootstrap strategy? | Runtime-first from exported IR (like early native M1/M2). |
| v1 success bar? | Handful of JS simulation suite cases match end state. |
| Fixture source? | Existing `export_native_fixtures.js` / `js-parity-data` pipeline; no JS changes for v1. |
| Approach? | Lean runtime over exported IR/fixtures (not trace-only revalidation, not full Lean compiler). |
| Match JS bugs? | No — report them; prefer correct semantics in Lean (differs from C++ bug-for-bug policy). |
