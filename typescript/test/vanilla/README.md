# Pinned vanilla PuzzleScript test oracle

These are unmodified sources from
[increpare/PuzzleScript at `57f9f6cba69f6aa52ed738d5aee1d709d0037648`](https://github.com/increpare/PuzzleScript/commit/57f9f6cba69f6aa52ed738d5aee1d709d0037648),
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
