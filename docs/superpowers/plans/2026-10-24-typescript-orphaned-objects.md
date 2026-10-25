# Explicit Orphan Object Compatibility Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> followed by parent-managed spec then quality review. This dependency precedes
> completing direct lowering. Do not spawn agents or edit parked lowering files.

**Goal:** Preserve a confirmed malformed-source behavior using explicit object
identity rather than silently losing a requirement or introducing packed storage.

**Architecture:** One orphan object represents the overwritten first raw layer
assignment when an unlayered name resolves to it. It points to the authored object
whose current declaration still supplies random/player intent layers. Ordinary
cells remain sets of objects; actual collision membership excludes the orphan.

**Tech Stack:** Strict TypeScript, GameObject identity, sets, canonical declarations,
existing player/cell/session operations and independently decoded native behavior.

## Evidence and scope

Use `movementSource({rules:'[ Crate ] -> [ random Player ]', level:'C'})` from
`typescript/test/scenarios.mjs`. Replace collision layers Background / Player,
Crate,Wall with Background / Background / Crate,Wall. Player becomes unlayered;
the initial Background assignment is overwritten. Actual native compilation and
processInput(-1), seed orphan-check, produces board [6] -> [1], while final
Background is id1 and Crate id2. getPlayerPositions returns [0]; errorCount is1.
The orphan is therefore writable and counts as a player. A never-match projection
or newly introduced TypeError would change native behavior. This is a constructed
invalid-source case, not a report about an existing game.

Parent asked an optional user preference question, then defaulted to the user's
established preserve-behavior preference after allowing several minutes for a
reply. If new user steering arrives, parent will coordinate any scope change.
Issue #1206 remains preserved independently.

Only the first obsolete assignment needs this source-domain identity: unlayered
object lookups select it; named concrete lookups otherwise select final objects.
Do not model arbitrary native padding or every unreachable storage hole.

## Model and declaration changes

- `typescript/src/model.ts`: add optional readonly orphanedFrom?:GameObject to
  GameObject. Ordinary literals remain {name}. An orphan has the same name as its
  source declaration but distinct identity, with an explicit link to that object.
- Add a small exported getObjectIntentLayer(collisionLayers, object) helper,
  returning number|undefined. Look for object.orphanedFrom ?? object by identity.
  This describes native getLayersOfMask following the current definition. No
  name-based fallback, id, slot, mask, encoded ordinal or generic registry.
- `typescript/src/declaration-model.ts`: expose orphanedObject:GameObject|null.
  Replace ObjectLookup wrapper/unavailable booleans with direct rawObjectLookups:
  ReadonlyMap<GameObject,ReadonlySet<GameObject>>. Final lookups already live in
  namedObjects. Remove redundant objectLookups and impossibleAggregates fields.
- `typescript/src/declarations.ts`: keep objects/objectSources as authored concrete
  declarations. Create one frozen orphan only when raw assignments exist, the
  first assignment has no final canonical identity, and an unlayered concrete
  lookup needs it. Link to the first raw object's current canonical declaration.
  Initial glyphs and collisionLayers/objectLayers exclude the orphan. Prepend it
  to objectChoiceOrder because native random choice visits it first.
- Raw unlayered lookup sets include the orphan. Final named, property and
  aggregate lookup sets propagate it as an ordinary identity. Player Any/All
  definitions retain it; remove missing-player/Never approximations for this case.
  No raw assignments still gives empty lookups without creating an orphan.
  If the first raw assignment remains canonical, retain existing fallback behavior.

## Consumers

- `typescript/src/rule-negatives.ts`: ordinary set intersection replaces the
  unavailable-flag bookkeeping. Raw concrete lookup versus final named lookup
  priority, coverage, deletion order and diagnostic wording remain identical.
  Orphan has no actual collision layer and contributes no layer coverage itself.
- `typescript/src/source-game-data.ts`: aggregate conditions retain All with the
  orphan member rather than Never. Whole-board Any includes every writable object,
  including the orphan (objectChoiceOrder), without including unlayered authored
  objects that actually resolve elsewhere. Creation/destruction sound lookup sets
  retain orphan identity. Directional sounds still follow raw concrete declarations
  and skip unlayered ones, as native does. Initial grids/glyph filling stay unchanged.
- `typescript/src/turn-rules.ts`: player position membership uses ordinary object
  identities; setting intent uses getObjectIntentLayer. Movement/collision layer
  membership remains unchanged, so an orphan is not suddenly a physical member of
  its source object's current layer. Keep ordering/sets and normal behavior intact.
- Do not remove simple Never enum variants or otherwise redesign runtime types
  unless an actual correctness dependency requires it.

## Oracle and test changes

Native code and hashes remain untouched. Current source declaration/data oracles
project non-final native entries away and call these requirements unavailable;
upgrade them to decode this explicit identity, distinguishing same-name orphan
from final object. Use native source/assignment evidence independently, not the
candidate's orphanedObject as input to the expected result.

Audit gameplay decoders used by focused orphan tests so they also keep the link
for player intent, retain unknown-field rejection and every native semantic read.
Other unreachable obsolete entries may remain outside the source-domain projection;
document that boundary and do not conflate them with the writable first orphan.

- [x] Add native-backed failing tests before implementation, including actual
  random rule application, player positions and aggregate/win outcomes on a board
  containing the orphan. Old empty+unavailable/Never expectations must be replaced
  by stronger exact identity and native outcome checks, not simply deleted.
- [x] Cover first assignment retained versus overwritten, duplicate later slots,
  multiple unlayered names sharing ONE orphan, zero raw assignments, named aliases,
  property duplicates, raw/final name collisions and immutable canonical provenance.
- [x] Cover concrete RHS fallback layer0 versus random/player current-definition
  layer, random candidate order/draw state, actual movement resolution, creation/
  destruction sounds and independent player/win checks after orphan introduction.
  Candidate edits may be constructed independently for this dependency; complete
  typed source lowering is restored and tested afterwards.
- [x] Corruptions must detect losing the orphan, substituting final same-name
  object, wrong intent layer, treating aggregate/player as Never and hiding native
  calls. Freeze inputs and keep complete independent producer guards.
- [x] Run strict build, focused declaration/data/negative/player/runtime suites and
  full npm test. Compare all478 source declarations/data/early negatives, preserving
  ordinary outputs and issue #1206. No40-minute full gameplay rerun at this boundary.
- [x] Self-review, whitespace/native hash checks and explicit owned-file commit.
  Parent obtains spec then quality approval before resuming lowering.

## Parked lowering work

`/private/tmp/puzzlescript-rule-lowering-20261024-vanilla_rule_lowering/manifest.json`
records three safely moved, uncommitted lowering files and checksums. The worktree
is clean at a88930b9. Ordinary lowering already matched all478 sources:
99,448 duplicate survivors ->99,327 lowered survivors, with251 overlap records
and143 raw lowering diagnostics. Removing those251 in the later schedule pass
will yield native's99,076 executable rules. Do not restore or edit these files;
the original lowerer resumes after this dependency is reviewed.

## Reviewed checkpoint

Implementation f595af1b passed independent spec and quality reviews. Strict build
and the full package passed 1,176 tests. Reviewers independently checked the 244
focused tests, all 478 declaration/data/early-negative comparisons, #1206 and all
21 pinned native hashes. The pre-change baseline fails both actual orphan-player
and aggregate outcome cases; the reviewed model passes them. Production JS remains
unchanged. The requested Markdown report records the newly constructed source,
native action/win observations and untested browser-rendering boundary.
