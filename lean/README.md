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

The interpreter targets parity with JS `processInput` / `applyRules` / `resolveMovements` / `checkWin` for whitelisted simulation fixtures. Unsupported IR still fails closed at load time.

**Supported (high level)**

- Object/movement masks (`STRIDE_OBJ` / `STRIDE_MOV` from IR)
- Player input `0`–`4`, plus trace tokens `undo`, `restart`, `tick` (`processInput(-1)`)
- `any_objects_present` and `any_movements_present` on cell patterns
- Null / missing `replacement` on LHS cells (no-op replacement)
- Multi-row rule patterns; single-ellipsis rows (`ellipsis_count` 0 or 1 per row)
- Rule `commands`: `win`, `cancel`, `restart`, `again` (with post-turn `again` loop), `sfx*` ignored for board parity
- `beginloop` / `endloop` via `loop_point` / `late_loop_point` maps
- Win conditions with `aggr1` / `aggr2` aggregate matching; `player_mask.aggregate` for movement
- Undo stack and `restart_target` from prepared session IR
- Level advance on win (skips message screens)

**Still unsupported (fail closed at IR load unless noted)**

- `rigid` rules and rigid movement rollback
- `is_random` / `randomdir` rules (needs `prepared_session.random_state`)
- Nonempty `property_bindings` / `aggregate_bindings`
- Nonempty `layer_coupled_movement_masks`
- Two-ellipsis rows per pattern (`ellipsis_count` 2)
- Title/message gameplay, sounds in serialized output

Current whitelist size: see `parity_whitelist.txt` (grow only from `parity_clean_candidates.txt`).

## Next candidates

Remaining clean-corpus gaps are mostly **rigid**, **random**, **property/aggregate bindings**, **layer-coupled movement**, and **double-ellipsis** rules — plus a tail of **serialization mismatches** to debug case-by-case.
