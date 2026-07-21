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

## Supported runtime subset (v1)

The interpreter is intentionally small. Unsupported IR features fail closed with a clear error.

**Supported**

- Object/movement masks with `STRIDE_OBJ` / `STRIDE_MOV` from IR (`game.strides`)
- Player input dirs `0=up, 1=left, 2=down, 3=right, 4=action` (same as JS `processInput`)
- Rules with: no ellipsis, no `is_random`, no `rigid`, empty `property_bindings` / `aggregate_bindings`, no `any_movements_present` / layer-coupled movement terms, empty `commands`
- `any_objects_present` (OR within each term, AND across terms — JS `anyObjectsPresent`)
- Single-row patterns (`patterns.length = 1`) of adjacent `cell_pattern` cells
- Rule groups applied until quiescence (non-looping games)
- Movement resolution for non-rigid games (collision: destination blocked if same layer occupied)
- Late rules (hook present; many whitelist games have none)
- Win conditions (`quantifier` + two filters) and unitTesting-style level advance on win
- Current whitelist: Sokoban cases + `rule grouping test`

**Unsupported (fail closed)**

- Ellipsis, rigid, random / randomdir, property/aggregate bindings, `any_movements_present`, layer-coupled movement, beginloop/endloop complexity, undo/restart inputs, sounds, title/message screens, full `again` command loops

## Next candidates

Grow `parity_whitelist.txt` **only from** `parity_clean_candidates.txt`, feature-by-feature. Useful near-term missing pieces: property bindings, `any_movements_present`, ellipsis, rigid, or `again`.
