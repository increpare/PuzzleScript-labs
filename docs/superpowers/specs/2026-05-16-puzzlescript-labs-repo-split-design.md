# PuzzleScript Labs Repository Split Design

## Decision

Create a separate GitHub repository named `PuzzleScript-labs` for the AI-assisted auxiliary PuzzleScript projects currently gathered on the `cpp` branch. Keep `PuzzleScript` as the canonical handcrafted web engine and site repository.

`PuzzleScript-labs` is a normal standalone GitHub repository, not a GitHub fork and not a side branch of `PuzzleScript`. It preserves useful Git history and tracks `PuzzleScript` through a local `upstream` remote.

## Goals

- Keep `PuzzleScript` quiet, handcrafted, and focused on the canonical JavaScript engine/site.
- Stop notifying watchers of `PuzzleScript` about AI experiment branches.
- Keep the C++ port, VS Code extension, Linguist preparation, static analyser, parity harnesses, and generated planning material together because they are tightly coupled.
- Allow `PuzzleScript-labs` to pull changes from `PuzzleScript` without requiring either repository to sit inside the other.
- Make provenance clear: labs is AI-assisted and experimental; PuzzleScript is canonical.

## Non-Goals

- Do not make `PuzzleScript` depend on `PuzzleScript-labs`.
- Do not put AI-generated docs or auxiliary project files into `PuzzleScript/master`.
- Do not split every auxiliary project into its own repository yet.
- Do not rewrite the labs code layout into submodules or package boundaries as part of the initial split.

## Repository Roles

### `PuzzleScript`

`PuzzleScript` remains the public canonical source for the handcrafted engine and website:

- `src/`
- `compile.js`
- documentation and site assets needed by the canonical project
- existing handcrafted development docs

It should not contain `native/`, `tools/vscode-puzzlescript/`, `tools/linguist/`, AI planning docs, generated static-analysis reports, native parity harnesses, or labs-only scripts.

At most, `PuzzleScript` may receive a short manually written pointer to `PuzzleScript-labs` if that feels useful later. This pointer is optional, and the default is to keep `master` untouched.

### `PuzzleScript-labs`

`PuzzleScript-labs` is the AI-assisted companion workspace. It is seeded from the current `cpp` branch and keeps the existing root shape so current paths continue to work:

```text
PuzzleScript-labs/
  src/
  compile.js
  package.json
  native/
  tools/vscode-puzzlescript/
  tools/linguist/
  scripts/
  docs/superpowers/
```

This repo may carry experimental edits to `src/`, native code, generated docs, analyser fixtures, benchmark tooling, and integration scripts. Those edits are not canonical unless manually reviewed and ported back to `PuzzleScript`.

## Git Relationship

Use a normal Git remote relationship:

```text
PuzzleScript-labs:
  origin   -> git@github.com:increpare/PuzzleScript-labs.git
  upstream -> git@github.com:increpare/PuzzleScript.git
```

`PuzzleScript-labs` periodically imports canonical changes:

```sh
git fetch upstream
git merge upstream/master
```

Rebase is also possible for local feature branches, but the labs default branch should prefer merges from upstream so the public history does not need regular force pushes.

## Initial Migration Shape

1. Create an empty GitHub repo named `PuzzleScript-labs`.
2. From the current local repository on `cpp`, add or switch `origin` to `PuzzleScript-labs`.
3. Add `PuzzleScript` as `upstream`.
4. Push the current `cpp` branch to `PuzzleScript-labs` as the default branch named `main`.
5. Stop pushing AI experiment branches to `increpare/PuzzleScript`.
6. Leave `increpare/PuzzleScript` branches alone unless deliberately cleaning them up later.

This preserves history, keeps current tooling paths working, and avoids GitHub watcher notifications on the canonical repository.

## Graduation Policy

Labs work graduates into `PuzzleScript` only through small, manually reviewed patches. Do not merge `PuzzleScript-labs` wholesale into `PuzzleScript`.

A graduating patch should:

- be understandable without reading labs-only docs
- avoid bringing generated planning trails into `PuzzleScript`
- preserve the handcrafted style of the canonical project
- include only tests and docs appropriate for the canonical repo

## Error Handling And Recovery

- If upstream merges conflict, resolve them in `PuzzleScript-labs`; never change `PuzzleScript` to accommodate labs-only structure.
- If labs history becomes noisy, keep it noisy in labs rather than rewriting the canonical repo.
- If a labs feature needs a cleaner boundary later, extract it inside `PuzzleScript-labs` first before considering a separate repository.
- If `PuzzleScript-labs` accidentally points at the canonical repo as `origin`, fix remotes before pushing.

## Verification

After the split, verify:

- `git remote -v` in `PuzzleScript-labs` shows `origin` as `PuzzleScript-labs` and `upstream` as `PuzzleScript`.
- Pushing a labs commit goes only to `PuzzleScript-labs`.
- `PuzzleScript/master` has no new AI-generated docs or labs directories.
- Existing labs commands still work from the repository root, especially native build/test commands and VS Code extension tests.
