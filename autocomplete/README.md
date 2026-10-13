# PuzzleScript autocomplete model: corpus pipeline

Work order: `docs/plans/2026-10-13-autocomplete-model-handoff.md`. Design rationale:
`docs/plans/2026-10-13-puzzlescript-autocomplete-model-proposal.md`.

Everything under `pipeline/` and `eval/` is Node (it reuses the engine through
`src/canonicalize.js`); `train/` is Python. Data lives outside the repo.

## Running Phase 0

Paths come from the environment or from `autocomplete/.env` (git-ignored):

```
PS_AC_CORPUS=D:\Projects\google_gist_scraper
PS_AC_DATA=D:\Projects\ps_autocomplete_data
```

Run from the repo root, in this order (times are for the full corpus on the owner's
16-core machine):

| Step | Command | Reads | Writes | Time |
|---|---|---|---|---|
| 3.2 ingest | `node autocomplete/pipeline/ingest.js` | `<corpus>/dump/*.json` | `<data>/raw/manifest.jsonl`, `raw/text/<id>.txt`, `raw/ingest_stats.json` | 1 min |
| 3.3 compile filter | `node autocomplete/pipeline/compile_filter.js [--workers N] [--timeout MS] [--resume]` | manifest, text | `<data>/compile.jsonl`, `compile_report.json` | 14 min |
| 3.4 dedup | `node autocomplete/pipeline/dedup.js` | manifest, compile.jsonl, text, `src/demo/` | `<data>/lineages.jsonl`, `dedup_report.json` | 2 min |
| 3.5 split | `node autocomplete/pipeline/split.js [--seed N]` | lineages, manifest, text | `<data>/splits.json` | seconds |
| 3.6 samples | `node autocomplete/pipeline/build_samples.js [--seed N] [--fim-rate R]` | splits, compile.jsonl, text, `configs/context.json` | `<data>/samples/{train,val}.jsonl`, `samples_stats.json` | 6 min |

Tests: `node --test autocomplete/tests/*.test.js` (26 tests; the directory form of
`node --test` does not work on Windows). The engine suite
`node src/tests/run_tests_node.js` must stay green; Phase 0 touched `src/canonicalize.js`
only to export a parser-only pass (`parseSourceState`) that survives the parser's
too-many-errors abort.

## What each module does

- `pipeline/paths.js`: resolves the corpus and data directories.
- `pipeline/ingest.js`: reads the raw gist API JSON, takes `script.txt`, strips BOM,
  normalises line endings, replaces `author`/`homepage` values with placeholders in the
  stored text (so names never enter a sample), drops gists under 200 bytes, over 1 MB
  (none) or truncated, and flags non-PuzzleScript text as junk. Id is `<owner>_<gistid>`.
- `pipeline/compile_filter.js` + `compile_worker.js`: runs `validateCompileSource` on
  every non-junk file in child processes. The parent watches each child's stdout and
  kills/respawns it when a file takes longer than the timeout (10 s), recording that
  file as `timeout`. Also records the `no-levels` and `mechanics` canonical hashes for
  files that compile. Output is appended incrementally, so `--resume` continues a run.
- `pipeline/dedup.js`: builds lineages. Exact key (comments stripped, whitespace
  collapsed) and `no-levels` canonical hash are unioned freely. Near-duplicate matching
  (MinHash, 128 perms, 5-token shingles over code sections only, LSH 16x8) is applied
  between clusters by comparing each cluster's latest revision, at Jaccard 0.8 within
  one owner and 0.9 across owners, so early template-derived saves of unrelated games do
  not chain together. Lineages matching a shipped demo (exact or no-levels) are flagged.
- `pipeline/split.js`: drops demo lineages, shuffles with a seeded PRNG (seed 20261013),
  cuts 90/5/5 by lineage. Train keeps the latest revision plus up to two earlier ones at
  least 20% apart by line-multiset distance; val and test keep the latest only.
- `pipeline/context.js`: the one context builder shared by training, eval and the
  editor. Contract is documented at the top of the file: target removed first, symbol
  header and suffix built from the document without it, levels trimmed to three blocks
  plus messages with the cursor's block protected, prefix/suffix windows in source order
  under a 6000-char budget, PSM and SPM rendering with contiguous weighted spans.
- `pipeline/symbols.js`: the symbol table for the header, from the editor's parser
  state or from text. Objects keep original casing; legend names are lowercase because
  the parser does not record their case.
- `pipeline/build_samples.js`: one causal sample per file (levels trimmed, no header)
  plus a FIM sample at rate 0.5 (split point half at a line boundary, half at a random
  char; target = rest of line 50%, next 2-8 lines 25%, 1-200 chars 25%; PSM/SPM
  alternate). Loss weights per span: level map rows 0.2, author/homepage 0, markers and
  header 0, everything else 1, all x0.3 for files that do not compile.

Sample row: `{id, kind: causal|fim_psm|fim_spm, section, text, spans: [{start, end,
kind, section, weight}]}`. Spans are contiguous and cover `text` exactly; the Python
side maps token offsets onto them.

## 3.1 Corpus inspection (2026-10-13)

`D:\Projects\google_gist_scraper` holds the scraper's raw output and several earlier
passes:

| Directory | Count | Notes |
|---|---|---|
| `dump/` | 48,301 JSON (50,064 entries) | Raw GitHub gist API responses. `data.files.script.txt`, `owner.login`, `created_at`, `history`. No `fork_of`; `history` is length 1 for 97% of gists. The editor's share button makes a fresh gist each time, so gist ids do not chain revisions. 4,345 gists appear under two file names (e.g. `ANONYMOUS_BATCH_OLD_*`, `PEDROPSI_DATABASE_*`); ingest keeps one. |
| `dumpprocessed/` | 44,037 | Extracted scripts; 39,256 distinct gist ids. 39,006 of those are in the new manifest; 250 are not (truncated, tiny, or missing `script.txt`); the manifest has 4,112 gist ids this folder lacks. |
| `dumpprocessed_nodupes/` | 33,338 | Byte-identical dedup. |
| `dumpprocessed_compiles/` | 30,072 | Compiled under an older `compile_cli.js`. |
| `dumpprocessed_classified/` | 16,462 groups | Grouped by `mechanics` canonical skeleton. Largest: `1723 simple-block-pushing-game`. |

Ingest from `dump/`: 43,686 kept (median 4,207 bytes, p95 29,781, max 902 KB, total
435 MB), 845 flagged junk, 13 truncated, 5 under 200 bytes, 251 with no `script.txt`,
0 over 1 MB.

## 3.7 Phase 0 report

| Stage | Count |
|---|---|
| Gists in `dump/` | 48,301 |
| Kept after ingest | 43,686 |
| Junk (not PuzzleScript) | 845 |
| Compile ok / warnings / errors / timeout | 26,578 / 9,705 / 6,343 / 215 |
| Exact duplicates removed | 7,876 |
| Clusters after exact + no-levels keys | 23,556 |
| Near-duplicate merges (36,646 candidate pairs) | 7,376 |
| Lineages | 16,180 |
| Lineages matching a shipped demo (dropped) | 68 lineages, 3,321 files |
| Lineages after demo removal | 16,112 |
| Largest lineage | 2,228 files (demo: the default template with only levels/title changed; 2,226 share one no-levels hash) |
| Largest non-demo lineage | 103 files ("THE SCRIPTNESS", one owner) |
| Lineage size histogram | 1: 8,819; 2-5: 6,056; 6-20: 1,205; 21-100: 96; >100: 4 |
| Train / val / test lineages | 14,500 / 806 / 806 |
| Train / val / test files | 15,520 / 806 / 806 |
| Train / val / test chars | 104.2M / 4.9M / 5.9M |
| Train files compile ok / warnings / errors / timeout | 9,959 / 3,048 / 2,451 / 62 |
| Test files compile ok / warnings / errors / timeout | 509 / 166 / 127 / 4 |
| Train samples (fim rate 0.5) | 15,520 causal + 7,803 FIM, 104.3M chars |
| Val samples | 806 causal + 406 FIM, 5.0M chars |
| Train FIM split points by section | objects 2,897; rules 1,357; legend 984; levels 938; collisionlayers 555; prelude 424; sounds 380; winconditions 268 |

Compile throughput: 51 files/s on 15 workers (mean 251 ms per file, which is three
engine passes: validate plus two canonical hashes). Below the handoff's "tens per second
per core", acceptable for a 14-minute one-off.

Top ten lineages by size (title of the latest revision):

| Size | Title | Owners | Demo |
|---|---|---|---|
| 2,228 | Puzzles | 672 | sokoban_basic_zoomscreen |
| 222 | Heroes of Sokoban | 16 | heroes_of_sokoban |
| 115 | blank template | 28 | blank |
| 103 | THE SCRIPTNESS | 1 | |
| 93 | Midas | 15 | midas |
| 91 | "Buran" Mission | 3 | |
| 81 | POTHOLE REPAIRMAN | 1 | |
| 79 | Mantis 0.64 | 1 | |
| 75 | Cat,Fish and Pickle | 33 | nekopuzzle |
| 65 | "La Ira Del Arte" | 1 | |

Agreement with the existing mechanics classification: 2,056 lineages span more than
one mechanics hash (revisions that changed rules, expected), and 466 mechanics groups
span more than one lineage (distinct games with the same rule skeleton, or lineages the
merge rule kept apart). 252 non-demo lineages share a mechanics skeleton with a demo.

Hand inspection of twelve clusters (six of size 6-100, five of size 2, the largest
non-demo one): every one was a single owner with a consistent title, no-levels hash
count 1-4, and line-multiset distance from the latest revision between 0.01 and 0.68.
Long-lived single-author projects ("knight sokoban" 25 files, "THE SCRIPTNESS" 103)
have the widest spread; nothing looked like two games glued together. The largest
cluster is the untouched default template under 548 different titles ("my game" 731,
"simple block pushing game" 376) and is correctly flagged as a demo.

Decision for the owner: 16,112 non-demo lineages is well above the proposal's 5k
threshold, so the small from-scratch model (Rung 1) is viable on this corpus. 55% of
lineages are singletons.

## Caveats found on the way

- **Fork drift in the error histogram.** The most common compile errors are
  "Unrecognised stuff in the prelude" (8,728), "Sprites must be 5 wide and 5 high"
  (2,431 + 982) and objects named `v`, `[`, `|`, `]`, `^`, `>` (about 6,000). These
  are PuzzleScript forks with extra prelude keys and larger sprites, and older games
  that predate newer keywords. They are kept as "broken" at weight 0.3; a later pass
  could whitelist fork prelude keys instead.
- **`validateCompileSource` skips the diagnostic tail** (dimensions, loop brackets,
  sound declarations, homepage), so "ok" here is slightly more permissive than the
  browser. Expected, see the handoff section 2.
- **Legend names in the symbol header are lowercase**; the parser only records the
  original case of objects.
- **Owner `unknown`** (anonymous gists) covers 400 of the 2,228 files in the template
  cluster and appears throughout; it is treated as one owner for the cross-owner
  threshold, which is conservative (fewer merges).

## Environment

GPU: NVIDIA GeForce RTX 4080 SUPER, 16 GB. Python 3.13 with a CPU-only torch; a CUDA
build is needed before Phase 1.5/2 (not installed during Phase 0). Node 22.12.
