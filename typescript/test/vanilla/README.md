# Pinned vanilla PuzzleScript test oracle

These are unmodified sources from local vanilla commit
`7417d78a75b5a07402071e21e0c171a76ef8871d` on `codex/comment-rule-capture`,
based on [upstream `caa90212`](https://github.com/increpare/PuzzleScript/commit/caa902120185b354f8b9bdb7bf67a9424be0665d),
provided under the accompanying upstream [MIT license](LICENSE).

They are test fixtures for the separate TypeScript reference implementation.
The labs engine in the repository's top-level `src/` is a different implementation
and is not the authority for these comparisons. Production TypeScript and the
examples do not import this directory.

`../../oracle-source.json` records the upstream revision and SHA-256 hashes for
all 22 source files here, including the original simulation/error fixtures and
the input/output source used by session compatibility tests. `../native-host.cjs`
checks every hash before loading any oracle code. Other test adapters read these
same files when discovering producers or executing isolated native functions.

To refresh this oracle intentionally, copy files from a selected vanilla commit,
update the manifest, and repeat compiler and per-move differential validation.
Do not edit these files to match the candidate or substitute the labs sources.
