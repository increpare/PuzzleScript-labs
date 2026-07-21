# Lean PuzzleScript

Executable Lean 4 runtime that replays JS-exported parity fixtures. It does **not** call Node at runtime; it loads IR and traces produced by the existing C++ parity export pipeline.

## Running the smoke test

Install [elan](https://github.com/leanprover/elan) so `lake` is on your `PATH` (typically `export PATH="$HOME/.elan/bin:$PATH"`). From the **repository root**:

```bash
make lean_parity_smoke
```

This target depends on **`make js-parity-data`** (builds `build/js-parity-data/` from the simulation corpus). No PuzzleScript JS source changes are required for the smoke test itself.

If `lake` is missing, the Makefile prints an install hint and exits non-zero.

## Manual run

```bash
make js-parity-data
cd lean && lake build parity_smoke
lake exe parity_smoke --fixtures ../build/js-parity-data --whitelist parity_whitelist.txt
```

Requires Lean 4 as pinned in `lean-toolchain`.

## Expanding the whitelist

From the repo root (with `lake` on `PATH`):

```bash
python3 scripts/lean_parity_expand.py --write-whitelist
```

This runs `parity_smoke` on each clean candidate not already whitelisted and appends passing names to `lean/parity_whitelist.txt`. Use `--verbose` to print per-case results.

### Process hygiene (important for agents)

`lake exe parity_smoke` spawns a grandchild binary. A plain Python `subprocess` timeout only kills `lake`, leaving hung `parity_smoke` processes behind.

- Always launch via `scripts/lean_parity_expand.py`, `scripts/lean_parity_bisect.py`, or `make lean_parity_smoke` (they use `scripts/lean_parity_run.py`).
- Those entrypoints take an exclusive flock on `/tmp/puzzlescript-lean-parity.lock` so expand/smoke/bisect do **not** stack concurrent runs.
- On timeout they kill the **entire process group** (`SIGTERM` then `SIGKILL`).
- Do **not** launch bare `lake exe parity_smoke` in long agent loops without that helper.
- Do **not** start a second expand/smoke while one is already running.

## Whitelist (clean kernel only)

Active cases (one name per line, must match `fixtures.json` exactly):

`lean/parity_whitelist.txt`

Only whitelisted cases are executed.

**Admission rule:** new whitelist entries must come from the clean-compile candidate list:

`lean/parity_clean_candidates.txt`

Regenerate with:

```bash
make lean_clean_sim_candidates
# or: node scripts/lean_clean_sim_candidates.js
```

Clean means the fixture’s source JS-compiles with **`errorCount == 0` and no warnings** (`errorStrings` empty). Warning/error-era legacy games stay on the JS/C++ corpora, not Lean.

## Fidelity policy

**JavaScript is the everyday reference** for what the fixtures expect. If Lean work surfaces incorrect JS (or C++) behavior, **report it to the maintainers** — do not silently ignore or paper over the discrepancy. Fix the oracle when appropriate, or temporarily waive the case with an explicit rationale.

## Supported runtime subset

The interpreter targets parity with JS `processInput` / `applyRules` / `resolveMovements` / `checkWin` for whitelisted simulation fixtures. Unsupported IR still fails closed at load time. The clean corpus whitelist is currently complete (`parity_whitelist.txt`).

**Typed representation (abstract-view prep + T1 edges)**

- Index wrappers: `TileIdx`, `LayerIdx`, `ObjectId` (`PuzzleScript/Ids.lean`)
- `Dir4` — sole up/down/left/right ↔ bit bridge (`Dir4.lean`); Runtime direction sites use it
- `RuleDir` — rule scan bitfield wrapper; `InputToken` is `| move Dir4 | action | undo | restart | tick`
- Public Board accessors: `cellObjWordsAt` / `cellMovWordsAt` (private loops may still use Nat)
- Closed `Command` inductive — IR parses fail closed; `Rule.commands` / turn queues are `Array Command`
- T3: `Rule.isCommandOnly` / `Rule.syntacticInertCommandOnly` from compiled cell replacement masks
- T2: `Game.objectLayers : Array LayerIdx`, `PropertyAlias` uses `ObjectId`/`LayerIdx`, `Game.validObject` / `validLayer`
- Views over mask `Board`: `occ` / `movAt` / `neighbor` / `wellFormed` (`View.lean`)
- Bridge lemmas for the inert fragment: `BoardViewEq`, `againEligible_*` (`Abstract.lean`)
- §4.0: again-eligibility uses **object-mask delta** (`objectsChanged` / `againEligible`), not “command fired”

**Executable path**

- Mask `Board` + `Runtime` remain authoritative for `parity_smoke` (abstract views are not the replay engine)
- Player input `0`–`4`, plus `undo` / `restart` / `tick`
- Rule commands: `win`, `cancel`, `restart`, `checkpoint`, `again`, `message`, `sfx0`–`sfx10`
- Rigid / random / bindings / layer-coupled / ellipsis-2 as needed by the clean whitelist

## Next

Inert prune soundness (`dropInert` / `boardWinEquiv`) on top of `Abstract.lean` — see
`docs/superpowers/specs/2026-07-21-lean-post-parity-abstract-inert-design.md`.
