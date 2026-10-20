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

## Phase 1: eval harness and baselines

| Step | Command | Writes |
|---|---|---|
| 4.1 tasks | `node autocomplete/eval/tasks.js [--split val\|test]` | `<data>/eval/tasks_<split>.json` |
| 4.3 baseline 1 | `node autocomplete/eval/run_rule_based.js --split val` | `<data>/eval/preds/rule_based_val.jsonl` |
| 4.3 baseline 2 | `node --max-old-space-size=24576 autocomplete/eval/run_ngram.js --split val` (8 GB heap, 70 s train, 16 min predict) | `preds/ngram_val.jsonl`, `preds/ngram_rerank_val.jsonl` |
| 4.3 baseline 3 | `node autocomplete/eval/export_prompts.js --split val` then `python autocomplete/eval/run_qwen.py --prompts <data>/eval/prompts_val.jsonl --out <data>/eval/preds/qwen15b_val.jsonl` (needs the venv described at the top of `train/requirements.txt`; `python` there means its interpreter) | `preds/qwen15b_val.jsonl` |
| 4.2 score | `node autocomplete/eval/score.js --tasks <data>/eval/tasks_val.json --predictions <preds.jsonl> --name NAME` | `<data>/eval/scores/NAME.{md,json}` |

Modules: `eval/engine.js` runs the streaming parser and the deterministic completer
inside the engine's vm context (`evalInRuntime` in `src/canonicalize.js`);
`eval/tasks.js` draws seeded, section-stratified cases (2,000 each of rest_of_token,
rest_of_line and next_line, 500 next_block split RULES/OBJECTS) from val and from test;
`eval/score.js` reports coverage, exact match and edit similarity over covered cases,
exact over all cases, any-candidate exact, compile validity (prediction spliced into
compiling sources and compiled in the worker pool; the ground truth is 100% by
construction), section-aware symbol validity judged on the spliced line, and median
latency; `eval/ngram.js` is the section-aware interpolated Kneser-Ney model.

Every runner removes the target from the document before predicting, so the completer
sees "Pla" and not "Pla|yer". Empty generations count as covered and wrong; only an
explicit "no suggestion" (the completer with no candidates) counts as uncovered.

### Validation results (test split untouched)

rest_of_token, where the deterministic completer competes. Percentages; exact/edit_sim/
validity over covered cases, exact_all over all cases.

| system | section | coverage | exact | exact_all | edit_sim | any_exact | compile_valid | symbol_valid | ms |
|---|---|---|---|---|---|---|---|---|---|
| rule-based (first candidate) | rules | 76.4 | 60.7 | 46.4 | 71.3 | 96.3 | 95.4 | 98.4 | 1.1 |
| rule-based | overall | 62.1 | 70.2 | 43.6 | 79.0 | 94.3 | 92.8 | 99.1 | 0.5 |
| 5-gram re-ranking the rule-based candidates | rules | 76.4 | 69.6 | 53.2 | 78.6 | 96.3 | 91.5 | 98.4 | 1.8 |
| 5-gram re-ranker | overall | 62.1 | 80.0 | 49.7 | 86.7 | 94.3 | 94.9 | 99.1 | 0.8 |
| 5-gram alone | rules | 89.6 | 54.0 | 48.4 | 66.3 | 65.2 | 82.2 | 79.0 | 8.4 |
| 5-gram alone | overall | 92.5 | 61.9 | 57.2 | 71.9 | 71.8 | 83.7 | 79.3 | 4.5 |
| Qwen2.5-Coder-1.5B zero-shot | rules | 100.0 | 27.6 | 27.6 | 41.3 | - | 82.2 | 88.0 | 1696 |
| Qwen2.5-Coder-1.5B zero-shot | overall | 100.0 | 38.4 | 38.4 | 50.6 | - | 70.1 | 84.0 | 1653 |

Generation tasks, 5-gram alone (the completer does not perform these):

| task | section | exact | edit_sim | compile_valid | symbol_valid | ms |
|---|---|---|---|---|---|---|
| rest_of_line | rules | 22.8 | 38.4 | 45.7 | 56.8 | 46 |
| rest_of_line | overall | 40.9 | 53.8 | 68.0 | 62.4 | 7 |
| next_line | rules | 8.8 | 22.0 | 62.5 | 74.0 | 58 |
| next_line | overall | 26.2 | 36.0 | 70.3 | 81.6 | 31 |
| next_block | rules | 2.4 | 13.9 | 48.5 | 64.0 | 296 |
| next_block | overall | 1.8 | 9.6 | 28.6 | 64.0 | 508 |

Generation tasks, Qwen2.5-Coder-1.5B zero-shot (bf16 on the RTX 4080 SUPER, greedy, native
FIM tokens, fed by the same context builder; run 2026-10-18):

| task | section | exact | edit_sim | compile_valid | symbol_valid | ms |
|---|---|---|---|---|---|---|
| rest_of_line | rules | 50.8 | 80.4 | 88.3 | 88.4 | 2163 |
| rest_of_line | overall | 36.3 | 58.9 | 82.8 | 85.8 | 1859 |
| next_line | rules | 36.4 | 69.3 | 97.4 | 91.2 | 2174 |
| next_line | overall | 18.1 | 44.1 | 67.0 | 93.3 | 2098 |
| next_block | rules | 4.8 | 34.5 | 72.2 | 90.0 | 5689 |
| next_block | overall | 6.2 | 43.8 | 51.7 | 90.0 | 5592 |

Reading: the re-ranker lifts RULES exact match on the popup task by 9 points at the
same coverage, but compile validity drops from 95.4 to 91.5, under the handoff's 95%
bar for a no-model v1. The 5-gram alone covers more (it always guesses) and is worse
per guess. On the generation tasks the 5-gram is weak in RULES (exact 23% for the rest
of a line, 9% for the next line, 2% for a block) with roughly half its outputs failing
to compile: the headroom the model is for. Full tables with every section are in
`<data>/eval/scores/*.md`. The rule-based completer's own first candidate breaks
compilation 4.6% of the time in RULES, so that is the ceiling for anything that re-ranks
its list.

Qwen zero-shot, the free upper-bound estimate: on the generation tasks in RULES it
roughly doubles the 5-gram's exact match for the rest of a line (51 vs 23) and
quadruples it for the next line (36 vs 9), with compile validity of 88% and 97% against
the 5-gram's 46% and 63%. That is the line the small model has to approach. On the popup
task it scores below the deterministic completer (RULES exact over all cases 27.6 vs
46.4), but mostly by overshooting rather than by being wrong: in RULES 62% of its
rest_of_token predictions start with the correct token and continue past it, and only
11% are a different token. A completer that trims a model's output to the token boundary
would score about 89% there. The Qwen latency column is the cost of generating the full
64-token budget (200 for blocks) before the newline cut; the runner has no newline
stopping criterion, so it says nothing about the per-line latency of a shipped model.

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

GPU: NVIDIA GeForce RTX 4080 SUPER, 16 GB, driver 610. Python 3.13; the venv at
`D:\Projects\ps_ac_venv` (see `train/requirements.txt`) has torch 2.14.1+cu126 and
transformers 5.20, installed 2026-10-18 for the Qwen baseline. Node 22.12.

## Phase 2: training (2026-10-20)

Python side, in the venv described at the top of `train/requirements.txt`. The tokenizer,
`train/model.py` and `train/export_onnx.py` come from the Phase 1.5 session (see that
section); the rest is here.

| Step | Command | Writes |
|---|---|---|
| tokenise + pack | `python autocomplete/train/data.py --tokenizer <data>/tokenizer/tokenizer.json` | `<data>/tokens/{train,val}.{ids,weights}.npy` + `.meta.json` |
| train | `python autocomplete/train/train.py --size xs --tokenizer <data>/tokenizer/tokenizer.json --out <data>/runs/xs --epochs 8 --warmup 50 --micro-batch 8` | `<data>/runs/xs/{config.json,log.csv,best/,last/}` |
| predictions for the harness | `python autocomplete/train/run_model.py --checkpoint <data>/runs/xs/best --prompts <data>/eval/prompts_val.jsonl --out <data>/eval/preds/xs_val.jsonl` | `preds/xs_val.jsonl` |
| score | `node autocomplete/eval/score.js --tasks <data>/eval/tasks_val.json --predictions <data>/eval/preds/xs_val.jsonl --name xs_val` | `scores/xs_val.{md,json}` |
| export for the editor | `python autocomplete/train/export_onnx.py --checkpoint <data>/runs/xs/best --out src/models/ps-ac-xs.onnx` | `src/models/ps-ac-xs.{onnx,int8.onnx,fp16.onnx}` (git-ignored) |

`data.py` maps every token onto the span its first character lies in (spans come from
`build_samples.js`: level rows 0.2, author/homepage 0, markers and header 0, broken files
x0.3) and concatenates the samples into one stream per split; `train.py` cuts it into
2048+1-token blocks, trains with the per-token weighted cross-entropy, AdamW (0.9, 0.95),
cosine schedule, bf16 autocast, grad clip 1.0, evaluates the weighted validation loss once
per epoch, keeps the best checkpoint and stops after two evaluations without improvement.
The handoff's 500 warmup steps assume a far larger corpus: at 0.26M tokens per step one
epoch here is 130 steps, so warmup is 50.

Packed corpus with the 8k tokenizer: train 34.3M tokens (19,864 samples, 2.2% at weight
0), val 1.37M tokens.

<!-- PHASE2_RESULTS -->

## Phase 3: editor integration (ghost text)

Everything is behind the **AI OFF / AI ON** toolbar link (localStorage `aiGhostText`,
default off). Nothing model-related loads until it is on and the user pauses in the
editor; `play.html` and the Node test runner never see these files.

Pieces, in the order a keystroke meets them:

- `src/js/codemirror6/plugins/ghost-text.js`: CM6 plugin. 250 ms after the last edit it
  asks the provider for a completion at the cursor and draws the answer as a dimmed
  inline widget (`.cm-ghost-text`). Tab accepts, Escape dismisses, any other edit or
  cursor move clears it, typing the suggestion's own next characters keeps the rest. It
  yields to the completion popup while that is open. Registered in `plugins/index.js`
  when `options.ghostText` is given (editor.js passes `PuzzleScriptAutocompleteModel`).
- `src/js/autocomplete_model.js`: the provider. One isolated parser pass over the
  document (`autocomplete_gate.js: parseIsolated`) gives the symbol table and the
  baseline error count; `autocomplete/pipeline/context.js` (the same file training used)
  builds the prompt in **SPM** order so the prefix comes last and the worker's KV cache
  covers everything but the characters typed since the previous request; the worker
  generates one line; the gate decides.
- `src/js/autocomplete_model_worker.js`: module worker on the vendored
  `onnxruntime-web` 1.30 (WASM build) and `@huggingface/tokenizers` 0.2 under
  `src/js/vendor/`. Loads `models/tokenizer.json`, `models/<name>.config.json` and
  `models/<name>.int8.onnx` (`<name>` from localStorage `aiGhostTextModel`, default
  `ps-ac-xs`). Greedy decoding with the exporter's KV-cache graph; the cache of the last
  request is kept and the longest shared token prefix is reused.
- `src/js/autocomplete_gate.js`: shared gate, also loaded by the eval harness through
  `eval/engine.js: gate()`. Rejects a candidate that adds parse errors relative to the
  document without it, unbalances brackets on its line, has unequal cell counts across
  `->`, or (RULES, COLLISIONLAYERS, WINCONDITIONS, SOUNDS) references an undeclared
  name; OBJECTS and LEGEND may declare. The parser pass runs with error capture and
  puts the live editor's `errorCount`/`errorStrings` back, so the console stays quiet.
- Build: `compile.js` bundles the plugin, the two pipeline files, the gate and the
  provider into `scripts_compiled.js`; the worker and the vendored runtimes ride along
  in `bin/js/source/` (the provider picks `js/source/` when it sees the bundle), and
  `src/models/` is copied with the rest of `src/`. `build-html.js` strips the
  `../autocomplete/...` script tags like the `js/...` ones.

### Trying it

1. Put a model under `src/models/` (git-ignored): `ps-ac-xs.int8.onnx` from the export
   step above, next to the committed `tokenizer.json` and `ps-ac-xs.config.json`.
2. Serve the **repository root** (the editor loads `../autocomplete/pipeline/context.js`):
   `python -m http.server 8767` then open `http://localhost:8767/src/editor.html`. The
   `root` entry in `.claude/launch.json` does the same. (A server rooted at `src/`
   cannot reach the shared context builder; the editor still works, the AI link does not.)
3. Click **AI OFF** in the toolbar so it reads **AI ON**. The model loads on the first
   pause (status text appears next to the link while it loads or thinks).
4. Type in RULES and stop for a quarter second; dimmed text appears after the cursor.
   Tab accepts it, Escape dismisses it.

Switch models with `localStorage.setItem('aiGhostTextModel', 'ps-ac-s')` and reload.
`PuzzleScriptAutocompleteModel.info()` in the console shows the last request's timings,
gate verdict and raw text (also what the gate rejected).

Measured in the editor on this machine, single-thread WASM, random-weight xs int8 (9 MB):
364 ms to load; 346 ms for a 203-token prompt plus 48 decoded tokens; 196 ms when 202
of the prompt tokens came from the cache (about 4 ms per decoded token).
