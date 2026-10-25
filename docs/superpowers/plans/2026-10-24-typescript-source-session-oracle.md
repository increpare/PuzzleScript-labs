# Source-Compiled Session Oracle Implementation Plan

**Status:** Completed and independently reviewed. The complete 478-game
source-compiled replay passes with exit status zero; final totals are below.

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> then parent-managed spec and quality review. Begin after the whole-source
> compiler is reviewed. Do not dispatch child agents from this task.

**Goal:** Run every candidate session from independently TypeScript-compiled
source while retaining the existing native per-input and AGAIN comparisons.

**Architecture:** Compile the original source string under native producer
guards. Compare the complete compiled domain game against the already installed
native state, then bind the independently created object/rule identities to the
test adapter's comparison IDs. Native decoding supplies expected observations;
the candidate game comes exclusively from compileSource. Keep this boundary
explicit and confined to test adapters.

**Tech Stack:** Existing strict TypeScript compiler/runtime, Node tests, native
hash-pinned oracle and corpus runner. Production game representations do not
change in this task.

## Existing state and authority

Official vanilla source is pinned to
`5a94bde1a5127a3a45306ea28598eba2874d446d`; all 21 hash checks remain required.
Keep #1206, explicit orphan objects, native random ordering, movement restoration
and the reviewed removal of labs runtime captures/sinks/conditional edits.

The current createSessionOracle in `test/legacy-session-oracle.cjs` loads the
native game and calls `decodeSessionGame(state, types)`. replayPaired then uses
decoder.game as its candidate game. That proves runtime parity with native game
data, not independent source-to-session compilation. The old full 478-fixture
run has 20,034 observations/operations and 525 loads; it also predates the runtime
cleanup. A bounded post-cleanup replay is documented separately. Neither is the
final required source-compiled replay.

Current comparisons are valuable and must stay intact: return flags, boards,
all pending movements, rigid marks, complete RNG state, queued commands and their
rule identities, created/destroyed objects, sounds and sound-history distinction,
ordered persistence/effect events, complete undo history, restart/checkpoint
targets, viewport, messages/screens, level seeds/loads, title transitions and
recorded corpus final boards/sounds. Existing producer guards and deliberately
broken runtime tests must continue to fail appropriately.

## Required boundary

createSessionOracle receives compileSource and SourceCompilationKind among its
existing type/operation imports. Its default path compiles source independently;
the full `node test/corpus.cjs --session` operation must exercise that path. Do not
silently fall back to native data when compilation or correspondence fails.
Retaining an explicitly named historical native-data utility is optional; no
new mode or fallback is required for the default source-compiled task.

Use precisely the same string on both sides. The existing session adapter appends
one newline to fixture.source before native compile; pass that exact augmented
string to compileSource as well. Source/compiler fixtures elsewhere compare
their original strings without this session-specific augmentation.

Inside compareFixture:

1. Reset and compile/load the native session as before.
2. Construct the native observation decoder, retaining its expected game only
   for complete semantic validation and its native rule/object correspondence.
3. Capture the native initial session observation. Compile the source under
   compiler/parser/gameplay/generated-method/RNG producer guards, then require
   SourceCompilationKind.Accepted. Nonzero diagnostics alone are not rejection.
4. Call the reviewed whole-compiler's pure semantic comparison against this
   already installed native state. Do not call another oracle factory or reload
   native-host: loadPuzzleScript recreates globals and browser/storage shims.
   Do not recompile native merely to manufacture comparison data.
5. Check that candidate compilation has not changed the native initial state,
   RNG, effects, saved values or level-seed consumption.
6. Bind source-created identities to comparison IDs and pass the exact returned
   SessionGame to replayPaired. Keep every input and AGAIN comparison and game
   immutability check already present.

The whole-compiler adapter exposes host-free
`createCompiledGameComparator(types)` and
`compareCompiledGame(types, fixture, nativeState, candidateResult, levelLines?)`
from `test/legacy-source-compiler.cjs`. They return `{ objectIds, nativeRules }`,
mapping candidate runtime objects to native IDs and candidate executable rules
to actual native rules after complete semantic validation. Reuse this relation
instead of independently reconstructing it by names. Supply the explicit enum
imports needed by this comparator, in addition to the existing runtime types.
The optional levelLines argument is unnecessary in ordinary session reuse:
native grid lineNumber survives, while native message objects discard their
line; the comparator validates that message source evidence against the authored
document rather than fabricating a native message line.

## Identity correspondence

The binding is a test-only relation, not a conversion of native rules into the
candidate. Validate complete semantic counts/fields before adding identities.

- Native observation objects retain their native address-indexed identities.
  Add canonical source runtime objects to the same object-ID lookup. Ordinary
  objects correspond to the current native declaration; the one reachable
  orphan corresponds to native slot zero and must link to the same current
  authored declaration. Name equality alone is insufficient for this case.
- Do not invent a source identity for unreachable obsolete native slots. Do not
  filter unknown candidate objects from runtime fields. The complete compiler
  comparison already rejects canonical-but-unassigned objects in executable
  fields; preserve that guard. Any unknown state object must fail canonicalization.
- Pair rules by phase, group and rule ordinal after exact semantic comparison,
  including random group policy, predicates, edits, commands, directions, rigid
  ownership and loops. Add source executable identities to the same rule-ID map
  used for native queued-command sources. Source line alone is not rule identity.
- Every candidate executable rule must map to its actual canonical authored
  SourcePatternRule in compilation.outcome.ruleSources. Require exact map
  cardinality, no stale/extra keys and matching authored line evidence.
- Assert candidate game/object/rule identities are independently created rather
  than reusing native-decoded values. Modify the adapter's correspondence maps;
  do not rewrite the candidate graph to substitute native data.

`legacy-session-data.cjs` already exposes objectIds, but ruleIds currently lives
inside its closure. Exposing that test-only map is sufficient if it keeps the
existing canonicalFrame identity checks intact. A focused
`test/source-session-data.cjs` can own binding and pure semantic checks; do not
spread this logic through production runtime code or introduce an ID abstraction
in GameObject/ExecutableRule.

The binding itself can remain a direct adapter operation:

```javascript
const correspondence = compareCompiledGame(types, fixture, nativeState, result);
for (const [object, id] of correspondence.objectIds) {
  assert.notEqual(object, decoder.objects[id]);
  decoder.objectIds.set(object, id);
}
for (const [rule, nativeRule] of correspondence.nativeRules) {
  const decodedRule = decoder.execution.rules.get(nativeRule);
  assert.ok(decodedRule);
  assert.notEqual(rule, decodedRule);
  assert.ok(decoder.ruleIds.has(decodedRule));
  decoder.ruleIds.set(rule, decoder.ruleIds.get(decodedRule));
}
const sourceDecoder = { ...decoder, game: result.outcome.game };
```

Keep complete comparison and canonical-source checks before this operation; do
not use correspondence as a reason to skip semantic validation. decoder remains
the expected-observation adapter, and result is the independently produced source
compilation. Native rules are keys only in test correspondence/guard operations;
they never replace candidate executable rules.

## Files and test-first steps

Modify `test/legacy-session-oracle.cjs`, `test/legacy-session-data.cjs`,
`test/session-oracle.test.mjs` and `test/corpus.cjs`. Add a focused source-session
ownership/corruption suite at `test/source-session-oracle.test.mjs`. A focused
binding adapter is optional if it makes the boundary clearer. The whole-compiler semantic
helper is reused directly; any small factoring there must preserve its reviewed
complete-field checks and avoid host loading. Parent owns plans and README.

- [x] Add a default-boundary test that is RED with the current decoder-fed
  oracle. Import the real compileSource and enums and include them in the same
  type bag already used by session-oracle.test.mjs. Observe exactly one source
  compilation and the exact game passed to candidate creation:

```javascript
const compilations = [];
const games = [];
const oracle = createSessionOracle({
  ...types,
  compileSource(source) {
    const result = compiler.compileSource(source);
    compilations.push(result);
    return result;
  },
  createSession(game, ...args) {
    games.push(game);
    return session.createSession(game, ...args);
  },
});
const fixture = {
  name: 'source compilation owns the session game',
  source: movementSource({ rules: '', level: 'P...' }),
  inputs: [3, 'undo', 'restart'], seed: 'source-session',
};
oracle.compareFixture(fixture);
assert.equal(compilations.length, 1);
assert.equal(compilations[0].document.source, fixture.source + '\n');
assert.equal(compilations[0].outcome.kind, compiler.SourceCompilationKind.Accepted);
assert.equal(games[0], compilations[0].outcome.game);
```

Here types is the explicit existing model/command/win/session imports, compiler
is the source-compiler module and session is the session module; no native data
is added to that type bag.

- [x] Implement source compilation, complete semantic comparison and identity
  binding. Keep the native initial observation unchanged through these steps.
  Make this initial test GREEN before migrating every session test.
- [x] Make all existing session-oracle tests use source compilation by default.
  Preserve orphan sounds, multiword restore, random quiet probes, AGAIN,
  checkpoint event ordering, wins, messages, history and generated/RNG guards.
- [x] Add deliberate compiler corruption: omit a player member with no movement
  inputs; alter a predicate/edit while retaining plausible initial board;
  remove/change a source-map entry. Complete semantic/identity validation must
  reject each before relying on gameplay differences. Assert compiler attempts
  to call native parser/compiler/installed-state functions fail under guards.
- [x] Verify the candidate never receives decoder.game, native arrays or native
  object/rule identities. Keep mutation checks over the entire candidate game.
  Reject unknown semantic fields and correspondence IDs instead of filtering.
  Guard supported tags before projecting tagged values; an unknown tag must not
  fall through to an ordinary variant. Apply explicit field/tag checks at the
  candidate session result/state/frame/command/effect boundaries as well as the
  compiled game. Known locally scoped bans and known effects checked elsewhere
  may remain intentionally excluded from a particular snapshot, but unrecognized
  fields or effect tags must fail. Add one unknown-effect corruption with an
  otherwise correct board/state, proving effect processing cannot silently drop
  a future semantic variant.
- [x] Migrate corpus imports and output label so `--session` identifies
  source-compiled standalone sessions. Keep fixture filtering and every existing
  comparison; do not omit a source, trim inputs or disable AGAIN draining.
- [x] Run strict build and focused source/session/compiler/oracle tests, followed
  by the bounded existing random/rigid/ellipsis/AGAIN/undo/restart corpus filters.
  Run full npm test once when changes settle, check all 21 hashes and whitespace,
  self-review and commit only explicit owned source/test files. Report DONE/SHA,
  exact counts/logs and API boundaries for parent spec then quality review.

From `typescript/`:

```sh
npm run build
node --test test/session-oracle.test.mjs test/source-session-oracle.test.mjs test/source-compiler.test.mjs
node test/corpus.cjs --session random
node test/corpus.cjs --session 'rigid body test 2'
node test/corpus.cjs --session ellipsis
node test/corpus.cjs --session 'again + message combo'
node test/corpus.cjs --session 'undo test'
node test/corpus.cjs --session 'restart test'
npm test
git diff --check
```

The source-compilation ownership test and all corruption checks are mandatory.

## Final corpus gate after review

Parent runs the complete source-compiled `node test/corpus.cjs --session` after
both reviews approve the adapter. All 478 fixtures, every input/AGAIN observation
and recorded expectations must pass. Record actual totals, exit status and log.
If it fails, preserve the first actual failing source/input and fix the relevant
boundary using the native oracle. No skips, expected failures or native-data
fallbacks satisfy this gate.

The run can be slow because reference execution is deliberately direct. Retain
its real tool/process handle and log; an observation timeout is not process
completion or failure. Re-poll the same live handle and never restart solely
because a wait expired. Standalone CLI/examples and final documentation/review
remain separate required work for the overall port.

## Reviewed adapter checkpoint and final run

Implemented at `48936d6c`, with the test-only native-data preservation fix at
`c37859dd`. Independent spec and quality reviews approve both changes. The
ownership regression goes from zero compiler calls to exactly one and observes
the exact returned game passed to session creation. Every existing session test
now uses independent compilation. Native compilation supplies observations and
test correspondence only; the source game is never rewritten with decoded data.

Strict build and 111 focused checks pass, including exact whole-source compiler
gates. The six bounded filters pass 21 fixtures, 778 observations and 23 loads.
The implementation full suite passes 1,568/1,568 with no failures, cancellations
or skips. Its shell wrapper encountered zsh's reserved `status` variable after
npm completed; the full passing summary was independently checked. The subsequent
test-only fix freshly passes 74/74 affected tests, plus random/restart replays.
All 21 hashes and whitespace checks pass. Logs use `/tmp/source-session-*.log`.

Quality review's coordinated sound corruption now fails: changing both native
and candidate restart sounds from source `restart 100` to 999 is rejected before
the semantic comparator can read the changed reference. Full installed native
compiler data, running-session observations, saved values, seeds and host
identities are protected around candidate compilation. Guard restoration and a
fresh replay after a rejected compilation are independently verified.

The final complete source-compiled run started at 2026-10-24 22:27:26 UTC:
`node test/corpus.cjs --session`. Exec session 29095 completed with exit status
zero, observed at 23:22:20 UTC. All 478 fixtures pass, with 20,034 observations,
20,034 candidate operations and 525 level loads. Every fixture was visited in
original order; every recorded input/AGAIN step and final expectation remained
enabled. The run was never restarted or duplicated.

Log: `/private/tmp/typescript-source-session-corpus.log`.
Verified result: `/private/tmp/typescript-source-session-corpus-result.json`.
Log SHA-256: `15c2d5b145178be14578882e7b34fb94e05e6c9ced55c12580e43afe30be8a0e`.
This is the independent source-to-session gate, not the earlier native-data run.
