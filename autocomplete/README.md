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
| 3.4 dedup | `node autocomplete/pipeline/dedup.js` | manifest, compile.jsonl, text, `src/demo/` | `<data>/lineages.jsonl`, `dedup_report.json` | 3 min |
| 3.5 split | `node autocomplete/pipeline/split.js [--seed N]` | lineages, manifest, compile.jsonl, text | `<data>/splits.json` | 1 min |
| 3.6 samples | `node autocomplete/pipeline/build_samples.js [--seed N] [--fim-rate R]` | splits, compile.jsonl, text, `configs/context.json` | `<data>/samples/{train,val}.jsonl`, `samples_stats.json` | 6 min |

Tests: `node --test autocomplete/tests/*.test.js` (34 tests; the directory form of
`node --test` does not work on Windows). The engine suite
`node src/tests/run_tests_node.js` must stay green; Phase 0 touched `src/canonicalize.js`
only to export a parser-only pass (`parseSourceState`) that survives the parser's
too-many-errors abort (and reports it as an error, so `canonicalizeSource` still
refuses such sources).

## What each module does

- `pipeline/paths.js`: resolves the corpus and data directories.
- `pipeline/text_util.js`: nested comment stripping, section detection, title
  normalisation, the generic-title list.
- `pipeline/ingest.js`: reads the raw gist API JSON, takes `script.txt`, strips BOM,
  normalises line endings, replaces `author`/`homepage` values with placeholders in the
  stored text (so names never enter a sample), drops gists under 200 bytes, over 1 MB
  (none) or truncated, and flags non-PuzzleScript text as junk. Id is `<owner>_<gistid>`.
- `pipeline/compile_filter.js` + `compile_worker.js`: runs `validateCompileSource` on
  every non-junk file in child processes. The parent watches each child's stdout and
  kills/respawns it when a file takes longer than the timeout (10 s), recording that
  file as `timeout`. Also records the `no-levels` and `mechanics` canonical hashes for
  files that compile. Output is appended incrementally, so `--resume` continues a run
  (and recompiles rows that were junk under an older heuristic).
- `pipeline/dedup.js`: builds lineages. Files whose code equals a shipped demo (exact,
  or no-levels: only levels/metadata changed) are set aside first into per-demo
  lineages. Among the rest, the exact key (comments stripped, whitespace collapsed),
  the `no-levels` canonical hash, owner+mechanics hash and owner+non-generic title are
  unioned freely. Near-duplicate matching (MinHash, 128 perms, 5-token shingles over
  code sections only, LSH 16x8) is then applied between clusters by comparing each
  cluster's latest revision, at Jaccard 0.8 within one owner and 0.9 across owners, so
  early template-derived saves of unrelated games do not chain together.
- `pipeline/split.js`: drops demo files, shuffles with a seeded PRNG (seed 20261013),
  cuts 90/5/5 by lineage, and reports a leakage check (val/test files sharing a
  mechanics hash or owner+title with a train file). Train keeps the latest revision
  plus up to two earlier ones at least 20% apart by line-multiset distance; val and
  test keep the latest only.
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
  char, with level map rows and sprite rows down-weighted when picking the line; target
  = rest of line 50%, next 2-8 lines 25%, 1-200 chars 25%; PSM/SPM alternate). Loss
  weights per span: level map rows 0.2, author/homepage 0, markers and header 0,
  everything else 1, all x0.3 for files that do not compile.

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
435 MB), 411 flagged junk, 13 truncated, 5 under 200 bytes, 251 with no `script.txt`,
0 over 1 MB.

## 3.7 Phase 0 report

Numbers from the final run (after the review fixes below).

| Stage | Count |
|---|---|
| Gists in `dump/` | 48,301 |
| Kept after ingest | 43,686 |
| Junk (not PuzzleScript) | 411 |
| Compile ok / warnings / errors / timeout | 26,662 / 9,766 / 6,628 / 220 |
| Demo-identical files set aside before dedup (code equal to a shipped demo) | 3,259 in 73 demo lineages |
| Active files entering dedup | 40,016 |
| Exact duplicates | 6,683 |
| Owner+mechanics merges / owner+title merges | 884 / 9,132 |
| Clusters after exact, no-levels and owner keys | 13,814 |
| Near-duplicate merges (9,158 candidate pairs) | 2,096 |
| Non-demo lineages | 11,718 |
| Largest non-demo lineage | 275 files ("PuzzleGame testing", 3 collaborators) |
| Lineage size histogram (all) | 1: 5,805; 2-5: 4,343; 6-20: 1,413; 21-100: 219; >100: 11 |
| Lineages with more than one owner | 889 |
| Train / val / test lineages | 10,546 / 586 / 586 |
| Train / val / test files | 13,208 / 586 / 586 |
| Train / val / test bytes | 93.7M / 3.5M / 3.6M |
| Train files compile ok / warnings / errors / timeout | 8,314 / 2,756 / 2,085 / 53 |
| Test files compile ok / warnings / errors / timeout | 344 / 128 / 109 / 5 |
| Leakage check, val and test vs train | same owner + mechanics: 0 / 0; same owner + title: 0 / 0; same mechanics, any owner: 19 / 21 |
| Train samples (fim rate 0.5) | 13,208 causal + 6,656 FIM, 93.2M chars |
| Val samples | 586 causal + 302 FIM, 3.6M chars |
| Train FIM split points by section | objects 2,468; rules 1,224; legend 848; levels 765; collisionlayers 431; sounds 328; prelude 325; winconditions 267 |

Compile throughput: 51 files/s on 15 workers (mean 251 ms per file, which is three
engine passes: validate plus two canonical hashes). Below the handoff's "tens per second
per core", acceptable for a 14-minute one-off.

Top ten lineages by size (title of the latest revision):

| Size | Title | Owners | Demo |
|---|---|---|---|
| 2,164 | sokoban_basic_zoomscreen (the editor's default template) | 651 | yes |
| 275 | PuzzleGame testing | 3 | |
| 235 | Paint X Paint Demo | 3 | |
| 222 | heroes_of_sokoban | 16 | yes |
| 219 | Pineapple ("build a snowman v1.0", a camp project) | 32 | |
| 158 | Crates | 1 | |
| 123 | "Buran" Mission | 3 | |
| 122 | THE SCRIPTNESS | 1 | |
| 115 | blank | 28 | yes |
| 111 | Metamorphosis | 5 | |

Agreement with the existing mechanics classification: 2,633 lineages span more than
one mechanics hash (revisions that changed rules, expected), and 210 mechanics groups
span more than one lineage (distinct games with the same rule skeleton, or lineages the
merge rule kept apart). 187 non-demo lineages share a mechanics skeleton with a demo.

Hand inspection (first run: six clusters of size 6-100, five of size 2, the largest
non-demo one; final run: the five largest non-demo lineages): every cluster was one
owner, or a small group of collaborators, with a consistent title; line-multiset
distance from the latest revision ran from 0.01 to 0.68, widest in long-lived
single-author projects. The 219-file "Pineapple" lineage is 32 owners sharing one camp
project ("build a snowman v1.0", 138 of its files), which is the right grouping for
leakage purposes. Nothing looked like two games glued together.

The first run's largest cluster was 2,228 files under 548 titles, held together by one
no-levels hash: the untouched default template with only levels or title changed. It is
now set aside as demo files before dedup (see the review fixes), which is also what
stops those files from bridging every owner's first save into one cluster.

Decision for the owner: 11,718 non-demo lineages is well above the proposal's 5k
threshold, so the small from-scratch model (Rung 1) is viable on this corpus. Half of
the lineages are singletons.

## Review fixes (same day)

A fresh-context review of the first run found, and this run fixed:

- **Same-owner revisions landing in both train and test** (critical). Renames and
  recolours defeat the no-levels hash and the code shingles, so one author's revisions
  of one game split into two lineages. Dedup now also unions files with the same owner
  and the same mechanics hash, or the same owner and the same non-generic title. The
  split reports a leakage check; both owner-keyed counts are zero.
- **Junk heuristic flagged about 430 real games** that open with a multi-line comment.
  Comment stripping is now nested and multi-line; junk fell from 845 to 411.
- **Demo-identical files chained unrelated owners** once owner keys existed (a game's
  first save is the template). They are now set aside before any union, in per-demo
  lineages that the split drops.
- Smaller: prefix section labels at a line-start cursor, section label of a target
  that starts with a section header, aborted parses now count as errors in
  `canonicalizeSource`, compile-filter watchdog hardening (`close` event, stale stdout
  ignored after a kill, startup-crash cap, spawn errors), `--resume` recompiles rows
  that were junk under the old heuristic.

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
- **Owner `unknown`** (anonymous gists) is excluded from the owner-keyed union keys and
  treated as one owner for the cross-owner near threshold, which is conservative.
- **Near merges are still transitive** between clusters (A~B and B~C joins A and C);
  the largest-cluster readout is the check. With demo files set aside it is 275.
- **Sample ids** are `<owner>_<gistid>`, so the GitHub login rides along as metadata
  in the sample JSONL (never in the text).

## Environment

GPU: NVIDIA GeForce RTX 4080 SUPER, 16 GB. Python 3.13 with a CPU-only torch; a CUDA
build is needed before Phase 1.5/2 (not installed during Phase 0). Node 22.12.
