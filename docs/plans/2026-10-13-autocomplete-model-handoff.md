# Handoff: build the PuzzleScript autocomplete model (local desktop session)

Date: 2026-10-13 (revised the same day after review). For a Claude Code session running
on the owner's desktop PC. Read this file and then
`docs/plans/2026-10-13-puzzlescript-autocomplete-model-proposal.md` (the design
rationale) before doing anything. Where the two disagree, this file wins.

## 0. Situation

- Goal: a code-completion model for PuzzleScript that ends up running inside the web
  editor (`src/editor.html`, CodeMirror 6), next to the existing deterministic completer
  in `src/js/puzzlescript-autocomplete.js`.
- The design is agreed in the proposal doc. This document is the work order. Do the phases
  in order and stop at each checkpoint to report numbers to the owner.
- Branch: `claude/gifted-bardeen-jgyss0` on `increpare/PuzzleScript-labs`. Pull it first.
  Commit all pipeline and training code there. Never commit corpus data, model weights
  over a few MB, or anything under the data directory.
- The corpus lives at `D:\Projects\google_gist_scraper`. Its layout was inspected while
  revising this doc; see 3.1. Earlier passes over it already exist there and should be
  audited and reused, not redone blindly.
- Every number in the proposal about model size is a guess until Phase 0 and the
  browser spike (Phase 1.5) report.

## 1. Environment setup

Tooling split: the corpus pipeline and the eval harness are **Node** (so they can reuse
this repo's parser and compiler directly). Training is **Python**.

- Node 22 is what the repo is tested with. `npm install` at the repo root.
- Python 3.11 or later with a CUDA PyTorch build. On Windows either native CUDA PyTorch or
  WSL2 works; WSL2 is less painful for `tokenizers`, `sentencepiece` and `onnx` exports.
  Check the GPU first and write the result into the Phase 0 report:
  `python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"`.
- Python packages for the first two phases: `torch`, `tokenizers`, `numpy`,
  `datasketch` (MinHash LSH, or implement it in Node, see Phase 0), `onnx`,
  `onnxruntime`. Rung 2 adds `transformers`, `peft`, `accelerate`.
- Repository layout to create:

```
autocomplete/
  README.md                 what each script does and how to run the whole thing
  pipeline/                 Node: ingest, compile filter, dedup, split, sample builder
  pipeline/context.js       the ONE context builder shared by training and the editor
  eval/                     Node: eval harness and the baselines that run in JS
  train/                    Python: tokenizer, model, training, export
  configs/                  JSON or YAML configs for every run, committed
```

- Data directory, outside the repo: `D:\Projects\ps_autocomplete_data\`. Add the path
  to a `.env` or a config, not hardcoded. Add nothing from it to git.

## 2. Reusable code already in the repo

Do not rewrite these:

| Need | Use |
|---|---|
| Compile a source and get errors | `validateCompileSource(source, {sourcePath})` from `src/canonicalize.js`. Returns `{ok, errorCount, errorStrings}`. Runs the real engine's parse and compile passes up to `checkObjectsAreLayered`. See the caution below on what it skips. |
| Canonical fingerprints for dedup | `canonicalizeSource(source, mode)` plus `hashCanonical(value)` from the same module. Modes that matter here: `'no-levels'` (code sections only, naming normalised, levels dropped) and `'mechanics'` (also collapses equivalent objects; this is what the existing classification in the corpus directory used). `'structural'` keeps levels, so two revisions that differ only in levels get different structural hashes. Use `'no-levels'` for dedup. |
| Parser-only pass (for the editor gate and the eval harness) | The runtime object inside `src/canonicalize.js` has a `parseSource` hook that is not exported. Export it, or add a sibling that runs the streaming parser over a string and returns `{state, errorCount, errorStrings}`. |
| Example of a corpus walker with compile checks and a JSON report | `src/tests/compile_exception_corpus.js` and `src/tests/run_compile_exception_corpus_audit.js` |
| Parallel corpus runs on Windows | `src/tests/run_canonicalizer_corpus_parallel.js` shows the child-process pattern. Note it shards files across children; it has no per-file timeout. See 3.3. |
| Parser state at the cursor (section, bracket balance, declared objects, original-case names) | the streaming mode in `src/js/parser.js`; see how `src/js/puzzlescript-autocomplete.js` reads `state.section`, `state.objects`, `state.original_case_names`, `state.sounds`. There is no `state.legend`; legend names land in `state.objects` and the case map. |
| Rule mirroring and rotation | `RuleTransform` used by the autocomplete module |
| Running engine code in Node without a browser | `src/tests/run_tests_node.js` concatenates the `sourceFiles` list with browser shims; `src/canonicalize.js` already wraps this for you |
| CodeMirror 6 completion plumbing | `src/js/codemirror6/plugins/autocomplete.js`, `stream-state.js`, `exact-prefix.js`. The deterministic completer returns a candidate list plus a `from` offset, i.e. it completes the current token, not the rest of the line. |

Three cautions.

- The engine compile is not sandboxed and is synchronous inside one vm context: a
  pathological game blocks the whole process. Run the compile filter in child processes
  with a parent-side watchdog (10 s is plenty) and record timeouts as their own category.
- `validateCompileSource` deliberately stops after `checkObjectsAreLayered`. It does not
  run the diagnostic tail (`twiddleMetaData`, `generateLoopPoints`, `generateSoundData`,
  `formatHomePage`), so it accepts some games the browser flags for bad dimensions,
  unpaired loop brackets, or sound declarations, and the browser still plays those. A
  disagreement with the editor in that class is expected, not a bug. Note the class in
  the README; anything outside it is a bug worth a note.
- The engine writes to a console shim; run with output suppressed or the log will be
  unreadable.

## 3. Phase 0: corpus pipeline

Checkpoint at the end of this phase. Report the stats table before going further.

### 3.1 Inspect the corpus (first hour)

What is already known, from inspecting `D:\Projects\google_gist_scraper` on 2026-10-13:

| Directory | Count | What it is |
|---|---|---|
| `dump/` | 50,064 | Raw GitHub gist API responses, one JSON per gist, named `<owner>_<gistid>.json`. `data.files` holds `readme.txt` and `script.txt`; `data.owner.login`, `data.created_at`, `data.updated_at`, `data.history`, `data.forks` are present. `fork_of` is absent and `history` is typically length 1: the editor's share button makes a fresh gist each time, so **gist ids do not chain revisions of one game**. |
| `dumpprocessed/` | 44,038 | `script.txt` extracted to `<owner>_<gistid>.txt` by `pull_scripts_from_jsons.js` (gists whose readme mentions puzzlescript.net). |
| `dumpprocessed_nodupes/` | 33,338 | Byte-identical duplicates removed, first filename wins. |
| `dumpprocessed_compiles/` | 30,072 | Subset of the above that compiled under an older `compile_cli.js`. |
| `dumpprocessed_classified/` | 16,462 groups | `classify_compiles_by_skeleton.js` grouped the compiling files by `canonicalize_cli --mode mechanics` skeleton. Folder names are `<count> <title>`; the biggest is `1723 simple-block-pushing-game`. Each folder has `skeleton.json` and `originals/`. |

Do not treat the classification as ground-truth lineages: mechanics mode collapses
equivalent objects and drops levels, so distinct games with the same rule skeleton share a
folder, and the compile set predates this repo's compiler. Do treat it as a free, strong
dedup key and as the first place to look when checking clusters by eye.

Still to find out and write down in `autocomplete/README.md`:

- Which `dump/` gists are missing from `dumpprocessed/` and why (readme filter, missing
  `script.txt`, truncated gists with `truncated: true`).
- Size distribution of the scripts: count, total bytes, median and 95th percentile bytes.
- How many are obviously not PuzzleScript (first non-empty line is not a prelude key or
  a section header, or the file has no `OBJECTS` heading at all).
- Whether the compile set changes materially under this repo's `validateCompileSource`.

### 3.2 `pipeline/ingest.js`

Input: `dump/` (not `dumpprocessed/`, so provenance comes along). Output:
`data/raw/manifest.jsonl`, one row per gist:
`{id, gist_id, owner, created_at, updated_at, bytes, sha256, truncated}` plus the
normalised text stored as `data/raw/text/<id>.txt`. Normalisation: strip BOM, `\r\n` to
`\n`, drop files under 200 bytes, drop and count files over 1 MB (do not truncate; a
truncated game is a broken game), keep everything else verbatim. Decode as UTF-8 with
replacement; levels use arbitrary Unicode glyphs and must survive.

Replace the value of every `author` and `homepage` prelude line with a fixed placeholder
(`author anon`, `homepage example.com`) **in the stored text**, so names never enter a
training sample or an eval case. Loss weight zero is not enough: the model would still
condition on real names in the prefix. The manifest keeps `owner` for provenance only.

### 3.3 `pipeline/compile_filter.js`

For every file record `{id, status: ok|warnings|errors|timeout|junk, errorCount,
errorStrings[0..5], ms}` into `data/compile.jsonl`, plus the `no-levels` canonical hash
and the `mechanics` canonical hash for files that compile.

Per-file timeout design, since the compile cannot be interrupted from inside the child:
the parent hands each child a range, the child appends one JSONL line per file as it
goes, and the parent watches for a stalled child. On a stall it kills the child, records
the file it was on as `timeout`, and respawns from the next file. Nothing is lost because
output is incremental. Target throughput: tens of files per second per core; measure it.
Print a histogram of the most common error strings; it tells you what the broken slice
looks like.

### 3.4 `pipeline/dedup.js`

Keys, each producing a cluster id:

1. Exact: sha256 of text with comments removed and whitespace collapsed.
2. Code-only canonical: the `no-levels` hash from 3.3, for compiling files. Revisions
   that differ only by levels or metadata collide here; `structural` would not catch them.
3. Near: MinHash over 5-token shingles (whitespace tokens, lowercased), 128 permutations,
   LSH at Jaccard about 0.8, computed over the **code sections only** (strip level map
   rows and sprite pixel rows first). On whole files the level maps dominate the shingle
   set and hide related code.

Then build **lineages**, and do not simply union-find all three keys transitively. Every
game starts life as the Simple Block Pushing template, so the early revisions of
thousands of unrelated games are within 0.8 of the template and of each other, and a
transitive union would chain them into one cluster that swallows most of the corpus.
Instead:

- Union keys 1 and 2 freely (they are exact).
- For key 3, merge two clusters only if their **latest** members (by `created_at`) are
  near-duplicates of each other, and prefer merges within one `owner`. A game that
  diverged from the template is dissimilar to it at its latest revision even though its
  first save was not.
- Compare against the `mechanics` grouping from the existing classification and report
  where they disagree.
- Print the size of the largest cluster and the ten largest, with titles. If the largest
  is more than a few percent of the files, the merge rule is still too loose.
- Open a dozen representative clusters by hand (the largest, a few mid-sized, a few of
  size two) and write what you saw into the README before trusting the split.

Output `data/lineages.jsonl`: `{lineage_id, file_ids[], representative_id, size, owners}`.
Also flag lineages that match the demo games shipped with the editor (the `.txt` files
under `src/demo/`, loaded by `src/js/editor.js`) so they can be dropped or down-weighted.

### 3.5 `pipeline/split.js`

Split lineages, not files, 90/5/5, seeded. From each training lineage keep the latest
revision plus at most two earlier ones at least 20% apart by line-level diff (not
character edit distance; some files are hundreds of kilobytes). Validation and test keep
only the latest revision per lineage. Output `data/splits.json`.

The test split is touched twice: once to generate the task sets in 4.1, once at the end
for the final table. Everything during development, including per-epoch tables and model
selection, runs on the validation split.

### 3.6 `pipeline/context.js` and `pipeline/build_samples.js`

Specify the context builder before generating any data, because the editor will call the
same function later. Put it in `autocomplete/pipeline/context.js` with no dependencies
beyond the parser, and document its contract at the top of the file:

- **Input**: full document text, cursor offset, replacement range `[from, to)` (what the
  completion replaces; `from === to` for pure insertion), and a token budget.
- **Target removal first**: for training samples and eval cases the target text is
  removed from the document before anything else is computed. The suffix and the symbol
  header are built from the document *without* the target. For OBJECTS and LEGEND tasks
  a header built from the complete file would leak the answer.
- **Symbol header**: compact, one line per kind: object names, legend names, sound
  events, declared sfx numbers. Original casing. No sprite pixel rows, no level maps.
  Source: the streaming parser state over the document minus target (the editor has the
  whole document too).
- **Prefix window**: up to N lines before `from`, chosen nearest the cursor, **emitted in
  source order**. The proposal's "nearest first" means selection, not emission order.
- **Suffix window**: up to M lines after `to`, in source order.
- **FIM layout**: `<header><PRE>prefix<SUF>suffix<MID>target<EOS>` (PSM), and SPM for half
  the FIM samples. Causal samples use the same layout with an empty suffix and `to` at
  end of document. Every sample goes through this function, including plain causal ones,
  so the model never sees a layout the editor will not produce.
- **Budgets**: header first, then suffix up to M, then prefix fills the rest. N, M and
  the total are config values, committed.
- **Stop rules** for generation: stop at EOS, at the first newline for rest-of-line and
  next-line tasks, at a blank line for next-block tasks.

`build_samples.js` then emits, per file:

- a causal sample (whole file, levels trimmed to the first three plus message lines),
- FIM samples at a 50% rate, half the split points at line boundaries, half at random
  character positions,
- loss weights per line: level map rows 0.2, prelude `author` and `homepage` lines 0,
  broken files 0.3, everything else 1.

Output as JSONL with `{text, weights, section_spans}` where `weights` is per line; the
Python side maps lines to tokens through the tokenizer's offsets (newline is an explicit
token, see 5.1), so it stays dumb.

### 3.7 Report

A single table in the README with: gists in `dump/`, extracted, dropped as junk,
dropped for size, compile ok/warnings/errors/timeout, exact duplicates removed,
lineages, largest lineage size, lineages after demo removal, files kept per split, and
total characters per split. Add the top ten lineages by size with their titles, the
agreement rate with the existing mechanics classification, and the notes from the
hand inspection. **Stop here and show it to the owner.** The lineage count decides
whether the small from-scratch model is viable or whether the plan leans on the
fine-tuned model.

## 4. Phase 1: eval harness and baselines

Checkpoint at the end of this phase.

### 4.1 `eval/tasks.js`

Generate fixed task sets, seeded, from **both** the validation split (used throughout
development) and the test split (used once at the end). Commit the generator, not the
data. Four task families:

- `rest_of_token`: 2,000 cases, stratified by section, cursor inside or at the end of a
  partial identifier or keyword; target is the rest of that token. This is the task the
  deterministic completer actually performs, and it is scored with the completer's own
  replacement range.
- `rest_of_line`: 2,000 cases, stratified by section, cut at a random position in a
  non-empty line.
- `next_line`: 2,000 cases, stratified by section, cursor at the start of a line.
- `next_block`: 500 cases in RULES and OBJECTS, target is the next contiguous block.

Each case stores file id, cursor position, replacement range, target text, section, and
whether the source file compiles.

### 4.2 `eval/score.js`

For a predictions file, report per section and overall:

- exact match and normalised edit similarity,
- **coverage**: the fraction of cases where the system produced any suggestion at all.
  Validity numbers are meaningless without it; a system that suggests nothing is 100%
  valid,
- compile validity: splice the prediction into the file and run `validateCompileSource`.
  Score it only on cases whose source file compiles, and print the ground-truth
  target's own validity on the same row as the ceiling,
- symbol validity, **section-aware**: in RULES, COLLISIONLAYERS, WINCONDITIONS and
  SOUNDS every identifier in the prediction must be declared in the file or be a
  keyword. In OBJECTS and LEGEND the prediction is allowed to declare new names; check
  only that referenced names on the right of `=` exist,
- median latency if the runner reports it.

Output a Markdown table and a JSON file. RULES on its own row always.

### 4.3 Baselines to run through it

1. The existing rule-based completer on `rest_of_token` only, scored at its own
   replacement range, taking its first candidate and also "target starts with any
   candidate". This is the status quo line for the popup. It does not compete on the
   line and block tasks.
2. A section-aware Kneser-Ney 5-gram over whitespace tokens, trained on the train split,
   in Node. Score it alone on all four tasks and as a re-ranker of the rule-based
   candidates on `rest_of_token`.
3. Qwen2.5-Coder-1.5B zero-shot with its native FIM tokens, via `transformers` on the
   GPU, fed by the same context builder. This is the free upper-bound estimate.

Report the table. If the 5-gram re-ranker already beats the rule-based line on RULES and
keeps compile validity above 95% at comparable coverage, tell the owner; it is a shippable
v1 with no model download, and the rest of the plan can proceed without blocking on it.

## 4.5 Phase 1.5: browser feasibility spike

Do this before spending GPU time on the sweep. It takes a day and decides which sizes
are worth training.

- Instantiate the `xs`, `s` and `m` architectures from 5.2 with random weights, export
  each with `train/export_onnx.py` (KV-cache inputs and outputs, dynamic int8), and load
  them in a throwaway page with `onnxruntime-web`.
- Measure per size: int8 file size, cold load time, peak memory, and latency for one
  200-token prompt plus 16 decoded tokens with the cache, on WASM and on WebGPU.
- Verify WebGPU actually runs the exported graph. The WebGPU execution provider supports
  a subset of operators and falls back per node; check the session's provider
  assignment and the ONNX Runtime web docs for the current operator list. If int8
  matmuls fall back to WASM, measure fp16 or fp32 as well.
- Confirm the tokenizer JSON from 5.1 loads and round-trips in the browser.
- Report a table and recommend a size ceiling. Sizes that miss roughly 150 ms warm
  latency on WASM on the owner's machine are not candidates for the sweep.

## 5. Phase 2: train

Checkpoint when the sweep table exists.

### 5.1 `train/tokenizer.py`

BPE via `tokenizers`, vocab 8k (try 16k if the median rule line is over 25 tokens),
byte fallback, trained on the **sample text** from 3.6 (levels already trimmed), not on
raw files, so level glyph rows do not dominate the merges. Pre-tokeniser: split on
whitespace and isolate each of `[ ] | -> = , ( )` as its own token; newline is an
explicit token. Assert the structural tokens never merge with neighbours. Save
`tokenizer.json`.

### 5.2 `train/model.py` and `train/train.py`

Llama-style decoder (RMSNorm, RoPE, SwiGLU, tied embeddings). Use a `transformers`
`LlamaForCausalLM` with a custom config; it makes the ONNX export with KV cache far
easier than a hand-rolled nanoGPT. Sweep only the sizes that passed Phase 1.5:

| Name | d_model | layers | heads | params (approx) |
|---|---|---|---|---|
| xs | 256 | 6 | 4 | 5M |
| s | 384 | 8 | 6 | 15M |
| m | 512 | 8 | 8 | 30M |

Context 2048, document packing with EOS, per-token loss weights derived from the
per-line weights through tokenizer offsets, AdamW, lr 6e-4 cosine with 500 warmup
steps, batch about 0.25M tokens, bf16, 4 to 8 epochs with early stopping on validation
loss. Log to a plain CSV plus the **validation** eval table every epoch so runs are
comparable without a dashboard. Seed everything. Commit every config under
`autocomplete/configs/`.

### 5.3 `train/finetune_lora.py` (Rung 2, conditional)

LoRA on Qwen2.5-Coder-0.5B first, with the same samples converted to the model's own FIM
format. Rank 16 on attention and MLP projections, 2 epochs, lr 2e-4. Score through the
harness on validation. Only if the 0.5B fine-tune clearly beats the best small model on
RULES, continue with 1.5B and then `train/distill.py`: sample completions from the best
fine-tune over the training files' FIM points, filter them through the gate (compile and
symbol validity), and add the survivors to the small model's training set. Retrain the
chosen small size and report the before and after. If 0.5B does not beat the small model,
skip the rest and say so.

### 5.4 Report

One table, on the **test** split, run once: every baseline, every sweep size, whichever
fine-tunes ran, distilled small model if it ran. Columns: RULES exact match, RULES edit
sim, overall edit sim, coverage, compile validity, symbol validity, parameter count, int8
size on disk, browser latency from Phase 1.5. Recommend one browser model. Stop for the
owner's decision.

## 6. Phase 3: editor integration

Start only after the owner picks a model.

- `train/export_onnx.py`: export with KV-cache inputs and outputs, dynamic int8
  quantisation, verify the ONNX output matches PyTorch logits on 50 samples. Phase 1.5
  already proved the path on random weights.
- Build story: `compile.js` concatenates the CM6 plugins into `scripts_compiled.js` via
  terser and knows nothing about workers or wasm. Vendor `onnxruntime-web` the way the
  CM6 runtime is vendored under `src/js/codemirror6/runtime/`, keep the worker script,
  the wasm files, the tokenizer JSON and the model out of the terser bundle, and add a
  copy step to `compile.js` so `bin/` serves them. Decide where the model file is hosted
  (same origin is simplest) and cache it with the browser's HTTP cache.
- Worker: `src/js/autocomplete_model_worker.js` loads `onnxruntime-web` (WASM, WebGPU
  when Phase 1.5 showed it helps), the tokenizer JSON, and the model lazily on first use
  in RULES. Keep the KV cache for the longest shared prefix between requests.
- Context builder: import the same `context.js` used in Phase 0, fed from the parser
  state the autocomplete plugin already has at the cursor and the document text.
- Ghost text: a new CM6 plugin under `src/js/codemirror6/plugins/` using a decoration
  widget. Debounce 250 ms, cancel on edit, Tab accepts, Escape dismisses. Register it in
  `plugins/index.js` and `bootstrap.js` the same way the existing plugins are.
- Gate, designed around what the parser can and cannot see. The streaming parser accepts
  `[ Player ] -> [ Player | Player ]`; the cell-count check lives in `compiler.js`
  (`rulesToArray`), as do same-cell overlap, ellipsis pairing and several others. So:
  1. Run an isolated parser pass (fresh state, explicit error capture, never the
     editor's live state) over prefix plus candidate plus the rest of the current
     section, and compare the error count against the same pass without the candidate.
     Reject only on *new* errors; unfinished documents already have some.
  2. Add explicit checks the parser does not do: bracket balance on the candidate line,
     equal cell counts left and right of `->`, direction and command keywords in legal
     positions.
  3. Symbol check by section, as in 4.2: references must resolve; declarations are
     allowed where the section declares.
  4. Restore casing from `state.original_case_names`.
  Reuse this gate in the eval harness so the shipped filter and the measured filter are
  the same code.
- Popup re-ranking: inside the existing completion source, score the candidate list with
  one batched forward pass and reorder. The deterministic candidates stay, and the
  completer's replacement range is respected.
- Behind an editor setting, default off. `node src/tests/run_tests_node.js` must stay
  green; the model path must not load in the test runner or in `play.html`.
- Measure in-browser latency on the owner's machine and report it with the accept flow
  working on three real games.

## 7. Conventions and pitfalls

- Commit small, descriptive commits to the branch. Push often; the owner may read
  progress from GitHub.
- No linter is configured. Match the surrounding style (4-space indent in `src/`).
- Windows: use `path.join`, never string-concatenate paths; open files with explicit
  `utf8`; never rely on the shell to glob. Long paths are a thing; keep the data directory
  shallow.
- Do not train on, evaluate on, or print author names. Ingest replaces them in the text
  (3.2); the manifest keeps `owner` for provenance only.
- When a step is slow, parallelise with child processes like the existing corpus scripts
  do, not by sharding manually.
- If `validateCompileSource` disagrees with the browser editor on some file, check
  whether the disagreement is in the diagnostic tail it skips on purpose (section 2).
  If it is, note the category; if it is not, that is a bug worth a note in the README,
  not something to work around silently.

## 8. Kickoff prompt for the local session

Paste this into the new session after pulling the branch:

> Read `docs/plans/2026-10-13-autocomplete-model-handoff.md` and the proposal it links to.
> Then do Phase 0 (sections 1 to 3 of the handoff) end to end against
> `D:\Projects\google_gist_scraper`, starting from the `dump/` JSON and auditing the
> existing `dumpprocessed_*` outputs described in 3.1 rather than redoing them blindly.
> Write code under `autocomplete/` and data under `D:\Projects\ps_autocomplete_data\`.
> Commit to `claude/gifted-bardeen-jgyss0`. Stop at the Phase 0 checkpoint and show me
> the stats table, the largest-cluster number, and the cluster inspection notes before
> starting Phase 1.
