# Garden Corpus Splicing and Structural Mutators

## Purpose

The garden mutates a fixture in isolation. Every one of its 62 mutators rewrites a
single source with no reference to any other game, so it can only ever produce
variations on 470 hand-written fixtures.

This design adds a second source. A scraped corpus of tens of thousands of real
PuzzleScript games becomes donor material, and a new crossover mutator merges a
donor into a fixture. It also adds two single-file structural mutators that
permute rules and levels.

The goal is source transformation, not engine hardening: mutations that produce
plausible, weird programs a person might actually have written.

## The corpus

Two directories, both outside the repository:

| Pool | Games | Size | Role |
| --- | --- | --- | --- |
| `dumpprocessed_compiles` | 30,072 | 283 MB | Donors. Verified against the current compiler. |
| `dumpprocessed_nodupes` | 33,338 | 319 MB | Anything, including already-broken games. |

Measured on a 60-game sample of each: the compiles pool returned 34 `ok` and 26
`compiler-warning`, with no errors and no crashes, so its guarantee still holds
against today's compiler rather than only at scrape time. The mixed pool returned
33 `ok`, 22 `compiler-warning` and 5 `compiler-error`.

Sizes are alike in both: median 3 KB, p75 7 KB, p95 23 KB, max 899 KB. One game
compiles in roughly 120 ms.

Neither pool can be committed, and neither can be assumed to exist.

## Component: corpus loading

`garden.js` gains `loadGameDir(dir)`. It lists the directory once, filters to
files at or below a size cap, sorts the surviving filenames, and returns that
array. Callers index into it with the seeded rng.

Sorting is not cosmetic. Directory iteration order is not stable across machines
or filesystems, and a garden run must reproduce exactly from its seed. Sorting
makes the donor a deterministic function of the seed and the pool.

Games are read one at a time, never all at once: 30,000 files at 283 MB will not
sit in memory.

The size cap is 64 KB. The p95 game is 23 KB, so the cap keeps almost everything
while excluding the rare 899 KB outlier, which would dominate any mutant it
entered and shrink badly.

A new repeatable `--game-dir DIR` flag supplies pools. Repeating it concatenates
the pools in the order given, each sorted internally, into one donor list. That
keeps selection a single seeded index into one deterministic array rather than a
two-step choice of pool and then game.

With no `--game-dir`, every existing behaviour is unchanged and donor-requiring
mutators report inapplicable in the ordinary way, so the garden still runs
anywhere. A directory that does not exist, or that contains no file under the
cap, is an error at argument-parsing time rather than a silent empty pool.

## Component: `merge-game`

The crossover mutator. It picks a donor B from a pool and merges it into fixture
A section by section. It is a union, not a transplant: nothing in A is replaced.

- **OBJECTS and LEGEND** — add each of B's entries whose name or glyph A does not
  already define. Comparison is case-insensitive, because PuzzleScript identifiers
  are case-insensitive; that hazard was found three separate times during the
  equivalence-oracle work.
- **RULES, LEVELS, WINCONDITIONS, SOUNDS** — append B's entries after A's.
- **COLLISIONLAYERS** — an object may appear in only one layer, so a plain append
  double-books every shared object. The mutator chooses evenly between two modes,
  via `rng.integer(2)`:
  - *filtered*: drop objects A already places from B's layer lines, yielding a
    valid game that compiles and runs;
  - *raw*: append verbatim, yielding the double-book diagnostic.
  The `detail` string records which mode fired.
- **Prelude** — keep A's and drop B's. Duplicate titles and flags are a duller
  class already covered by `duplicate-section`.

### Why the collisions are the point

Where B defines an object A already has, B's definition is skipped and B's rules
silently rebind to A's object. The result is a valid game with foreign semantics —
far more interesting than a parse error, and reachable by nothing the garden
currently does.

Merging also grows the object table and the layer list, which crosses the
32-object `STRIDE_OBJ` and 5-layer `STRIDE_MOV` boundaries in `compiler.js`. That
arithmetic is demonstrably fragile: it produced a false-positive class during the
equivalence-oracle work and forced `add-unreachable-rule` down to board-level
equivalence.

### Assumption to verify first

This design assumes merged games mostly compile. If they mostly fail for a dull
structural reason, the mutator is worth much less than it appears.

Implementation must measure this before building anything else: merge a sample of
donor-fixture pairs, compile them, and report the distribution of result kinds. If
the compile rate is low, find out why and revise before continuing. A cheap
measurement now is worth more than a finished mutator that produces noise.

## Component: structural mutators

Neither needs a donor.

- **`shuffle-rules`** — permute rule lines within the RULES section. Rule order is
  semantically significant in PuzzleScript, so this changes behaviour and must
  never declare `equivalence`. It probes rule-group formation and
  `startloop`/`endloop` pairing, which `startloop-mismatch` only pokes crudely.
- **`shuffle-levels`** — two modes: permute whole LEVELS entries, or scramble the
  rows within one level. Reaches the level loader and `curlevel` handling.

Both interact with `multi-fault`, which draws from the damaging pool; neither may
declare `equivalence`, or `multi-fault` would exclude them and the oracle could
make a false claim about a mutant containing them.

## Testing

- Unit tests for `loadGameDir`: sorted output, the size cap, a missing directory
  handled without throwing, and the same seed selecting the same donor twice.
- Per-mutator determinism and applicability tests in the existing style.
- Every mutator test compiles its mutant through the existing `workerResult`
  helper and asserts the worker returns a kind in `KNOWN_RESULT_KINDS` that is not
  `crash`. This is the standing lesson from the equivalence-oracle plan, where a
  whole class of defects shipped green because tests asserted only on mutated text.
- Seed loops carry an applied-at-least-once guard.
- Tests must not depend on the external corpus, which will be absent on other
  machines. They construct a small donor inline and pass it directly. One
  opt-in check, skipped when the directory is missing, exercises the real pool.
- A campaign over the new mutators, reporting result kinds. Findings are expected
  here — these are damaging mutators — so the check is that the garden survives
  and that no result is a `crash`.

## Out of scope

- Using corpus games as base fixtures rather than donors. This is wanted and
  should follow, but it raises questions donors do not: stable ordering across the
  whole corpus, artifact provenance for a fixture that is not in the repository,
  and the preflight cost of a 30,000-fixture campaign. It gets its own design.
- Metamorphic relations with a predictable delta, still deferred.
- Any change to the semantics-preserving family or its oracle.
