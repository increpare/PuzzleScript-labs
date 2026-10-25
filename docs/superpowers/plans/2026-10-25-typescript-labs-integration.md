# TypeScript reference integration into labs master

> **For agentic workers:** Execute the following packaging steps inline. The user
> has requested a push to `increpare/PuzzleScript-labs/master` in `typescript/`.

**Goal:** Publish the completed vanilla TypeScript reference without changing the
labs JavaScript implementation or the primary checkout's uncommitted work.

**Architecture:** Restore only `typescript/` and the port's development documents
from `272c3193` onto a branch based on labs master. Keep the unmodified vanilla
oracle in `typescript/test/vanilla/`, with upstream provenance, license and hashes.
All native adapter source reads must refer to that fixture directory.

**Tech stack:** Existing TypeScript package, Node test runner and Git.

## Packaging and verification

- [x] Verify the vanilla branch: `npm --prefix typescript test` passes 1,582 tests.
- [x] Commit the requested movement report and accepted-recovery clarification.
- [x] Restore the package and its documents onto a branch based on `origin/master`.
- [x] Add `typescript/test/oracle-packaging.test.mjs`: load the native host inside a
  test and assert its returned `srcDir` is `new URL('./vanilla/', import.meta.url)`.
  Run `node --test typescript/test/oracle-packaging.test.mjs` and observe failure
  because the labs source does not match the pinned vanilla hashes.
- [x] Copy every manifest source, plus `src/js/inputoutput.js` and `LICENSE`, from
  commit `5a94bde1a5127a3a45306ea28598eba2874d446d` to the fixture directory. Add the
  input/output source hash to `typescript/oracle-source.json`.
- [x] In `typescript/test/native-host.cjs`, change `srcDir` to
  `path.join(__dirname, 'vanilla')`. In test adapters, replace `../../src` paths
  with `vanilla` paths relative to `typescript/test/`. Keep every native source
  file byte-identical to its upstream version and retain all producer guards.
- [x] Run the packaging test again. Update `typescript/README.md`, the adapter
  audit and the completion audit to explain fixture packaging and the unchanged
  production implementation. Add provenance to `test/vanilla/README.md`.
- [x] Run `npm --prefix typescript test`, the source example, and trace example.
  Verify all 22 hashes, exact byte equality with upstream Git objects, no remaining
  native reads from labs `src/`, and no changes outside the package and port docs.

Release procedure: commit, refresh labs master, integrate any newer commits,
push a normal fast-forward update to `origin/master`, and verify its remote SHA.
Fast-forward the primary checkout only if its existing uncommitted changes can
be preserved; do not reset, stash or overwrite that work.

## Verified integration evidence

- Full strict build and suite: **1,583 passed**, zero failed/skipped/cancelled,
  exit zero; `/private/tmp/typescript-labs-integration-test.log`.
- Packaging regression: RED on labs `src/js/bitvec.js` mismatch, GREEN after
  relocation. Every native source byte matches the pinned upstream Git object.
- Source example and CLI trace exit zero. All six player and crate positions
  match the documented Right/Undo/Restart/Right/Right sequence.
- `typescript/src/` is identical to reviewed vanilla branch commit `272c3193`.
  Labs `src/` is unchanged. Only the package and its development documents are
  included in the integration.

No TypeScript production behavior changes are part of this integration. The
previous complete 478-game differential replay remains evidence for that same
production code; the packaging suite verifies the relocated, identical oracle.
