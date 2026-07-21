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

## Whitelist

Fixture names (one per line, must match `fixtures.json` exactly) live in:

`lean/parity_whitelist.txt`

Only whitelisted cases are executed; everything else in the export is ignored.

## Fidelity policy

**JavaScript is the everyday reference** for what the fixtures expect. The Lean runtime aims to match those expectations for correct games. If you find a real JS engine bug while comparing, **report it** (and fix JS if appropriate)—**do not** encode the bug in Lean to make the smoke test pass.

## Supported runtime subset (v1)

The interpreter is intentionally small. Unsupported IR features fail closed with a clear error.

**Supported**

- Object/movement masks with `STRIDE_OBJ` / `STRIDE_MOV` from IR (`game.strides`)
- Player input dirs `0=up, 1=left, 2=down, 3=right, 4=action` (same as JS `processInput`)
- Rules with: no ellipsis, no `is_random`, no `rigid`, empty `property_bindings` / `aggregate_bindings`, no `any_objects_present` / `any_movements_present` / layer-coupled movement terms, empty `commands`
- Single-row patterns (`patterns.length = 1`) of adjacent `cell_pattern` cells
- Rule groups + `loopPoint` style “keep applying group until quiescence” for non-looping games (Sokoban has trivial loop points)
- Movement resolution for non-rigid games (collision: destination blocked if same layer occupied)
- Late rules (Sokoban has none — hook is present)
- Win conditions of the form used by Sokoban (`quantifier` + two filters)
- `again` only if a future whitelist case needs it; current Sokoban cases do not

**Unsupported in v1 (fail closed)**

- Ellipsis, rigid, random / randomdir, property/aggregate bindings, beginloop/endloop complexity beyond what’s needed, undo/restart as special cases beyond fixture inputs, sounds, title/message screens

## Next candidates

Cases that are still useful but **outside** the v1 subset should stay off the whitelist until the runtime grows (or the fixture is simplified), not by expanding the interpreter ad hoc.

- **`rule grouping test`** — uses `any_objects_present` in a cell pattern; rejected with `any_objects_present not supported`.
