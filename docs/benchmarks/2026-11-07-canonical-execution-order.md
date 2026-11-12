# Canonical execution-order experiment

This experiment adds an **opt-in** `executionOrder: 'dependency'` projection.
The existing default projection is unchanged. It targets the property-expansion
ordering in the pinned vanilla compiler; it does not change normal Labs play.

## Why

The GPU solver discovered a Snortal path that wins in the existing canonical
source but not in the original. A reduced example has a player, a nearby obstacle,
and a farther obstacle on another collision layer. A rule replaces the player
after selecting an obstacle across an ellipsis. `Far or Near` and `Near or Far`
expand into different ordered rules: whichever alternative runs first consumes
the player. The old canonicalizer emits identical source for these two games.

Labs property coalescing can already discard this order before serialization.
The canonicalizer needs an execution-order guarantee at that earlier boundary.
Turning off the optional static optimizer does not turn off compiler coalescing.

## Projection

The semantic compiler still resolves names and aggregates, expands rule
orientations, and resolves relative directions. For this projection:

- Movement aggregate coalescing is disabled: the ordinary compiler expansion
  retains the reference's direction-choice order.
- Extra cross-layer property coalescing requires a narrow certificate. Existing
  positive terms must be preserved verbatim, predicates must remain stable, and
  new writes must assign a single constant object on each written layer. Written
  layers must not be read anywhere by the rule. Commands, rigid rules and random
  rules are excluded. Overlapping matches then agree on every write.
- Uncertified properties use ordinary ordered expansion. Properties handled as
  same-layer masks by the reference can remain compact.
- Independent rules and groups use a deterministic topological order. Edges
  preserve original order for object reads/writes, movement reads/writes and
  conflicting writes. Object resources cover collision layers, including
  implicit replacement of unnamed layer siblings. This is conservative and
  makes no assumption that different match anchors cannot overlap.
- Commands, random groups, random replacements and rigid effects are barriers.
  Phase and loop boundaries are preserved. Group IDs and loop endpoints are
  remapped after ordering; groups are not merged.
- Randomness is normalized at group scope, using the first rule's effective
  flag. All joined variants retain their candidate enumeration order, including
  `+` rules without an explicit random prefix. Redundant per-variant flag
  differences cannot change the hash after source emission.
- Object signatures omit rule ordinals for this projection, allowing independent
  rule permutations to receive the same labels. Object relabeling recomputes
  the certified order. If relevant objects still have indistinguishable label
  signatures, the projection conservatively falls back to source ordering.
  Discarded inert aliases cannot trigger this fallback. Duplicate-layer objects
  and reused group IDs likewise retain their existing schedules.

Failure to prove independence preserves original order. This is not a complete
commutativity/confluence decision procedure or a proof of all existing
canonicalizer transforms. Existing projection choices about sounds, messages,
checkpoints, inert layers and object merging remain in effect.

`executionOrder: 'source'` applies the compiler safeguards without canonical
rule reordering. `executionOrder: 'legacy'` selects the previous projection.

```sh
node src/canonicalize_cli.js game.txt --mode semantic --execution-order dependency
node src/tests/canonical_execution_order_node.js
node src/tests/compare_canonical_execution_order.js \
  --corpus src/tests/solver_tests \
  --out build/canonical-execution-order/solver --jobs 4
```

## Validation and partition comparison

The dedicated regression uses the pinned vanilla runtime independently of the
Labs compiler. It verifies the observable Far-first/Near-first win difference,
canonical source roundtrips, safe independent-group merging, retained compact
property matches, implicit layer erasure, command/random/rigid barriers,
loop/phase boundaries, source-state validation, discarded inert aliases, and
every boundary of Snortal's 33-operation portal/undo/restart recording.

The comparison runner computes previous and dependency-ordering hashes per
distinct source. `--include-source-projection` additionally records an
order-preserving-compilation control without dependency ordering. It compares partitions,
not the number of changed hash strings. A previous class splits when its members
have multiple new hashes; a new class merges when it contains multiple previous
hashes. Both can happen to the same class. Rejections and resource-limited
workers remain explicit exclusions, never passes. Exact source-byte duplicates
retain every corpus filename.

Detailed membership and counts are saved in each run's `summary.json` and
`REPORT.md`, with per-source records in `records.jsonl` and input/code provenance
in `manifest.json`. A split identifies a changed equivalence relation; it does
not establish an observable gameplay distinction for every branch. Snortal's
reduced case has an independently checked behavioral witness.

The final 184-source solver emission audit is saved as
`build/canonical-execution-order-2026-11-07/roundtrips-final.jsonl`:

- Previous projection: 158 stable source roundtrips; experimental projection: 166.
- Nine previously unstable cases become stable. Seventeen existing unstable
  cases remain, and **Seize the Flag** has a new label-stability failure.
- Seize the Flag also fails with `executionOrder: 'source'`, without dependency
  reordering. The saved comparison has 588 rules before/after emission; the
  observed differences concern object labels. This is an unresolved limit of
  the expanded projection and its existing labeling/emission machinery, not a
  claimed gameplay-equivalence result.
- The order-specific regressions pass, including every recorded Snortal
  boundary. The standard Node suite passes all 1,110 cases.
- `static_analysis_rulegroup_node.js` passes ten checks and fails its final
  singleton-overlap check on a missing sound-event field (`created`). The same
  failure reproduces with the original compiler, semantic compiler and
  canonicalizer files substituted from HEAD; it is not caused by this experiment.

These limits are why the experiment does not replace the default projection or
rewrite existing canonical caches.

## Completed small-corpus results

All 184 solver files (183 distinct byte sequences) complete without exclusions:

| Partition | Previous classes | Experimental classes | Merges | Splits |
| --- | ---: | ---: | ---: | ---: |
| Semantic, including levels | 179 | 179 | 0 | 0 |
| Mechanics, excluding levels | 176 | 176 | 0 | 0 |

The six archived Snortal files form four classes under both projections. The
solver's Snortal source grows from 81 to 93 rules. A corrected projected program
does not necessarily split a corpus class: these files do not contain the
reduced property-order-only counterexample pair.

The deliberately constructed regressions distinguish the two effects:

| Pair | Previous classes | Experimental classes |
| --- | ---: | ---: |
| Competing Far-first/Near-first property alternatives | 1 | 2 |
| Two provably independent rule groups in opposite orders | 2 | 1 |

## Completed full-corpus results

The full semantic comparison attempted all 30,072 files in
`/Users/stephenlavelle/Documents/google_gist_scraper/dumpprocessed_compiles`.
There are **30,034 comparable sources**, all byte-distinct, and **38 exclusions**:
20 baseline source rejections, 17 worker deadlines, and one memory abort.
Exclusions do not contribute to either partition. Input identities and all 23
loaded runtime-file hashes were checked against the saved provenance after the
run; the runtime did not change during the comparison.

| Partition | Previous classes | Experimental classes | New merged classes | Previous classes split |
| --- | ---: | ---: | ---: | ---: |
| Full semantic corpus | 25,008 | 25,006 | 2 | 0 |

Exactly four files participate in the two mergers:

- **Cowboy Duel Simulator 2013:** `ANONYMOUS_BATCH_OLD_7015219.txt` and
  `ANONYMOUS_BATCH_OLD_7015259.txt`. One revision moves `sfx0` from a standalone
  action rule into the body-hit rules. After the existing audio projection,
  their 81-rule programs were already identical up to object names. The new
  labeling removes that false distinction; independent rules are also reordered.
- **Try My Nums:** `YunusKongrad_516b6974ea2e172b46eeae951f23a1e4.txt` and
  `YunusKongrad_c496de4edb4a7d1d692f0d317781ffb1.txt`. One revision removes the
  `sfx3` declaration and three sound-only late rules. Their projected 32-rule
  programs likewise already matched up to names. The new labeling merges them
  without reordering either program's rules.

Thus neither observed merger demonstrates a newly discovered gameplay
equivalence from swapping rules: both repair labeling differences after audio
has already been discarded. The constructed independent-group regression
separately demonstrates the intended order-based merger.

**No stored class splits**, including the four archived Snortal classes. This
does not invalidate the Snortal fix: the corpus lacks the reduced pair differing
only in competing property-alternative order. That pair splits from one class
to two and has an independently verified gameplay difference. The solver's
Snortal projection grows from 81 to 93 rules and passes every boundary of the
recorded vanilla replay.

The complete report and exact class memberships are in
`build/canonical-execution-order-2026-11-07/gists/REPORT.md` and `summary.json`.
Per-source hashes, rules and filenames are in `records.jsonl`; `manifest.json`
records input and runner provenance. The optional source-only control was
computed for 4,934 comparable sources and is not a full-corpus partition.

Across comparable sources the projected rule total grows from **3,552,904 to
4,785,391**, about **35%**. Rule counts increase in 6,837 sources, remain equal
in 23,196, and decrease in one. This measures representation size, not runtime.

The conservative fallback can substantially enlarge the projected rule list.
For example, `ANONYMOUS_BATCH_OLD_2499868f6f67403d66228e3b9d4de133.txt`
(Trains Love Snowmen) grows from 2,429 to 38,221 projected rules. These counts
describe the canonical rule representation, not a solver-speed benchmark.
Keeping more ordered alternatives compact would require a representation and
matcher that explicitly retain the reference expansion schedule; the current
unordered set representation cannot provide that guarantee for those cases.
