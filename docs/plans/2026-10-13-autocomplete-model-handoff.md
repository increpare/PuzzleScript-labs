# Handoff: build the PuzzleScript autocomplete model (local desktop session)

Date: 2026-10-13. For a Claude Code session running on the owner's desktop PC.
Read this file and then `docs/plans/2026-10-13-puzzlescript-autocomplete-model-proposal.md`
(the design rationale) before doing anything.

## 0. Situation

- Goal: a code-completion model for PuzzleScript that ends up running inside the web
  editor (`src/editor.html`, CodeMirror 6), next to the existing deterministic completer
  in `src/js/puzzlescript-autocomplete.js`.
- The design is agreed in the proposal doc. This document is the work order. Do the phases
  in order and stop at each checkpoint to report numbers to the owner.
- Branch: `claude/gifted-bardeen-jgyss0` on `increpare/PuzzleScript-labs`. Pull it first.
  Commit all pipeline and training code there. Never commit corpus data, model weights
  over a few MB, or anything under the data directory.
- The corpus lives at `D:\Projects\google_gist_scraper` (over 40k files). Its layout is
  not known to the author of this doc. Inspecting it is step 1.
- The cloud session that wrote this had no GPU and could not see the corpus. Every number
  in the proposal about corpus size and model size is a guess until Phase 0 reports.

## 1. Environment setup

Tooling split: the corpus pipeline and the eval harness are **Node** (so they can reuse
this repo's parser and compiler directly). Training is **Python**.

- Node 22 is what the repo is tested with. `npm install` at the repo root.
- Python 3.11 or later with a CUDA PyTorch build. On Windows either native CUDA PyTorch or
  WSL2 works; WSL2 is less painful for `tokenizers`, `sentencepiece` and `onnx` exports.
  Check the GPU first and write the result into the Phase 0 report:
  `python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"`.
- Python packages for the first two phases: `torch`, `tokenizers`, `sentencepiece`, `numpy`,
  `datasketch` (MinHash LSH, or implement it in Node, see Phase 0), `onnx`,
  `onnxruntime`. Rung 2 adds `transformers`, `peft`, `accelerate`.
- Repository layout to create:

```
autocomplete/
  README.md                 what each script does and how to run the whole thing
  pipeline/                 Node: ingest, compile filter, dedup, split, sample builder
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
| Compile a source and get errors | `validateCompileSource(source, {sourcePath})` from `src/canonicalize.js`. Returns `{ok, errorCount, errorStrings}`. Runs the real engine compile. |
| Structural fingerprint for dedup | `canonicalizeSource(source, 'structural')` plus `hashCanonical(value)` from the same module. The canonical form ignores naming and formatting noise, so revisions of one game collide. |
| Example of a corpus walker with compile checks and a JSON report | `src/tests/compile_exception_corpus.js` and `src/tests/run_compile_exception_corpus_audit.js` |
| Parallel corpus runs on Windows | `src/tests/run_canonicalizer_corpus_parallel.js` shows the child-process pattern |
| Parser state at the cursor (section, bracket balance, declared objects, original-case names) | the streaming mode in `src/js/parser.js`; see how `src/js/puzzlescript-autocomplete.js` reads `state.section`, `state.objects`, `state.original_case_names`, `state.sounds` |
| Rule mirroring and rotation | `RuleTransform` used by the autocomplete module |
| Running engine code in Node without a browser | `src/tests/run_tests_node.js` concatenates the `sourceFiles` list with browser shims; `src/canonicalize.js` already wraps this for you |
| CodeMirror 6 completion plumbing | `src/js/codemirror6/plugins/autocomplete.js`, `stream-state.js`, `exact-prefix.js` |

Two cautions. The engine compile is not sandboxed: a pathological game can take seconds or
hang. Run the compile filter in child processes with a per-file timeout (10 s is plenty)
and record timeouts as their own category. And the engine writes to a console shim; run
with output suppressed or the log will be unreadable.

## 3. Phase 0: corpus pipeline

Checkpoint at the end of this phase. Report the stats table before going further.

### 3.1 Inspect the corpus (first hour)

Find out and write down in `autocomplete/README.md`:

- File format. Raw `.txt` game sources, or JSON gist dumps with metadata, or both.
- Whether there is per-file metadata (gist id, revision, author, created date) and where.
- Size distribution: count, total bytes, median and 95th percentile bytes.
- How many are obviously not PuzzleScript (first non-empty line is not a prelude key or
  a section header, or the file has no `OBJECTS` heading at all).

### 3.2 `pipeline/ingest.js`

Input: the corpus directory. Output: `data/raw/manifest.jsonl`, one row per file:
`{id, source_path, gist_id, revision, author, bytes, sha256}` plus the normalised text
stored as `data/raw/text/<id>.txt`. Normalisation: strip BOM, `\r\n` to `\n`, drop files
under 200 bytes, keep everything else verbatim. Decode as UTF-8 with replacement; levels
use arbitrary Unicode glyphs and must survive.

### 3.3 `pipeline/compile_filter.js`

For every file, in a worker pool with timeouts, record:
`{id, status: ok|warnings|errors|timeout|junk, errorCount, errorStrings[0..5], ms}` into
`data/compile.jsonl`. Also record the structural canonical hash for files that compile.
Target throughput: tens of files per second per core. Print a histogram of the most
common error strings; it tells you what the broken slice looks like.

### 3.4 `pipeline/dedup.js`

Three keys, each producing a cluster id:

1. Exact: sha256 of text with comments removed and whitespace collapsed.
2. Structural: the canonical hash from 3.3, for compiling files.
3. Near: MinHash over 5-token shingles (whitespace tokens, lowercased), 128 permutations,
   LSH at Jaccard about 0.8. `datasketch` in Python is the quick route; a Node
   implementation is about 150 lines if you want the whole pipeline in one language.

Union-find the three into **lineages**. Output `data/lineages.jsonl`:
`{lineage_id, file_ids[], representative_id, size}`. Also flag lineages that match the
demo games shipped with the editor (the `.txt` files under `src/demo/`, loaded by
`src/js/editor.js`) so they can be dropped or down-weighted.

### 3.5 `pipeline/split.js`

Split lineages, not files, 90/5/5, seeded. From each training lineage keep the latest
revision plus at most two earlier ones at least 20% edit distance apart. Validation and
test keep only the latest revision per lineage. Output `data/splits.json`.

### 3.6 `pipeline/build_samples.js`

Turn files into training samples with the **one context builder** described in the
proposal (section 4.1). Put the builder in its own module,
`autocomplete/pipeline/context.js`, with no dependencies beyond the parser, because the
editor will import the same function later. For each file emit:

- a plain causal sample (whole file, levels trimmed to the first three plus message lines),
- FIM samples at a 50% rate, half the split points at line boundaries, half at random
  character positions, with the compact symbol header prepended,
- loss weights per line: level map rows 0.2, `author` and `homepage` lines 0, broken files
  0.3, everything else 1.

Output as JSONL with `{text, weights, section_spans}` so the Python side stays dumb.

### 3.7 Report

A single table in the README with: files in, dropped as junk, compile ok/warnings/errors/
timeout, exact duplicates removed, lineages, lineages after demo removal, files kept per
split, and total characters per split. Add the top ten most common lineages by size with
their titles. **Stop here and show it to the owner.** The lineage count decides whether
the small from-scratch model is viable or whether the plan leans on the fine-tuned model.

## 4. Phase 1: eval harness and baselines

Checkpoint at the end of this phase.

### 4.1 `eval/tasks.js`

Generate fixed task sets from the test split once, seeded, and commit the generator but
not the data:

- `rest_of_line`: 2,000 cases, stratified by section, cut at a random position in a
  non-empty line.
- `next_line`: 2,000 cases, stratified by section, cursor at the start of a line.
- `next_block`: 500 cases in RULES and OBJECTS, target is the next contiguous block.

Each case stores file id, cursor position, target text, and the section.

### 4.2 `eval/score.js`

For a predictions file, report per section and overall: exact match, normalised edit
similarity, compile validity (splice prediction into the file, run
`validateCompileSource`), symbol validity (every identifier in the prediction is declared
in the file or is a keyword), and median latency if the runner reports it. Output a
Markdown table and a JSON file. RULES on its own row always.

### 4.3 Baselines to run through it

1. The existing rule-based completer, scored on `rest_of_line` only, taking its first
   candidate. This is the status quo line.
2. A section-aware Kneser-Ney 5-gram over whitespace tokens, trained on the train split,
   in Node. Score it alone and as a re-ranker of the rule-based candidates.
3. Qwen2.5-Coder-1.5B zero-shot with its native FIM tokens, via `transformers` on the GPU.
   Use the same context builder. This is the free upper-bound estimate.

Report the table. If the 5-gram re-ranker already beats the rule-based line on RULES and
keeps compile validity above 95%, tell the owner; it is a shippable v1 with no model
download, and the rest of the plan can proceed without blocking on it.

## 5. Phase 2: train

Checkpoint when the sweep table exists.

### 5.1 `train/tokenizer.py`

BPE via `tokenizers`, vocab 8k (try 16k if the median rule line is over 25 tokens),
byte fallback, trained on the train split only. Pre-tokeniser: split on whitespace and
isolate each of `[ ] | -> = , ( )` as its own token; newline is explicit. Assert the
structural tokens never merge with neighbours. Save `tokenizer.json`.

### 5.2 `train/model.py` and `train/train.py`

Llama-style decoder (RMSNorm, RoPE, SwiGLU, tied embeddings). Keep it minimal and
export-friendly; a nanoGPT-shaped script is fine, a `transformers` LlamaForCausalLM with a
custom config is also fine and makes ONNX export easier. Sweep:

| Name | d_model | layers | heads | params (approx) |
|---|---|---|---|---|
| xs | 256 | 6 | 4 | 5M |
| s | 384 | 8 | 6 | 15M |
| m | 512 | 8 | 8 | 30M |

Context 2048, document packing with EOS, per-token loss weights from the JSONL, AdamW,
lr 6e-4 cosine with 500 warmup steps, batch about 0.25M tokens, bf16, 4 to 8 epochs with
early stopping on validation loss. Log to a plain CSV plus the eval table every epoch so
runs are comparable without a dashboard. Seed everything. Commit every config under
`autocomplete/configs/`.

### 5.3 `train/finetune_lora.py` (Rung 2)

LoRA on Qwen2.5-Coder-0.5B and 1.5B with the same samples converted to the model's own
FIM format. Rank 16 on attention and MLP projections, 2 epochs, lr 2e-4. Score through the
harness. Then `train/distill.py`: sample completions from the best fine-tune over the
training files' FIM points, filter them through the parser gate (compile and symbol
validity), and add the survivors to the small model's training set. Retrain the chosen
small size and report the before and after.

### 5.4 Report

One table: every baseline, every sweep size, both fine-tunes, distilled small model.
Columns: RULES exact match, RULES edit sim, overall edit sim, compile validity, symbol
validity, parameter count, int8 size on disk. Recommend one browser model. Stop for the
owner's decision.

## 6. Phase 3: editor integration

Start only after the owner picks a model.

- `train/export_onnx.py`: export with KV-cache inputs and outputs, dynamic int8
  quantisation, verify the ONNX output matches PyTorch logits on 50 samples.
- Worker: `src/js/autocomplete_model_worker.js` loads `onnxruntime-web` (WASM, WebGPU when
  available), the tokenizer JSON, and the model lazily on first use in RULES. Keep the
  KV cache for the longest shared prefix between requests.
- Context builder: import the same `context.js` used in Phase 0, fed from the parser
  state the autocomplete plugin already has at the cursor.
- Ghost text: a new CM6 plugin under `src/js/codemirror6/plugins/` using a decoration
  widget. Debounce 250 ms, cancel on edit, Tab accepts, Escape dismisses. Register it in
  `plugins/index.js` and `bootstrap.js` the same way the existing plugins are.
- Parser gate: before showing any model output, run the streaming parser over context plus
  candidate; reject on any logged error or any identifier not in the symbol table.
  Restore casing from `state.original_case_names`.
- Popup re-ranking: inside the existing completion source, score the candidate list with
  one batched forward pass and reorder. The deterministic candidates stay.
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
- Some gists are enormous (hundreds of levels). Cap any single file at 1 MB in ingest and
  record the cap in the stats.
- Do not train on, evaluate on, or print author names. The manifest keeps them for
  provenance only.
- When a step is slow, parallelise with child processes like the existing corpus scripts
  do, not by sharding manually.
- If `validateCompileSource` disagrees with the browser editor on some file, that is a
  bug worth a note in the README, not something to work around silently.

## 8. Kickoff prompt for the local session

Paste this into the new session after pulling the branch:

> Read `docs/plans/2026-10-13-autocomplete-model-handoff.md` and the proposal it links to.
> Then do Phase 0 (sections 1 to 3 of the handoff) end to end against
> `D:\Projects\google_gist_scraper`, writing code under `autocomplete/` and data under
> `D:\Projects\ps_autocomplete_data\`. Commit to `claude/gifted-bardeen-jgyss0`. Stop at
> the Phase 0 checkpoint and show me the stats table before starting Phase 1.
