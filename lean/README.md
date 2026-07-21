# Lean PuzzleScript

Executable Lean 4 runtime that replays JS-exported parity fixtures.

## Setup

Install [elan](https://github.com/leanprover/elan), then from repo root:

```bash
make lean_parity_smoke
```

Or manually:

```bash
make js-parity-data
cd lean && lake build parity_smoke
lake exe parity_smoke --fixtures ../build/js-parity-data --whitelist parity_whitelist.txt
```

Requires Lean 4 as pinned in `lean-toolchain`.
