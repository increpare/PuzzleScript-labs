# Proposal: a PuzzleScript code-completion model

Date: 2026-10-13. Status: proposal, nothing built yet.

Input: the gist corpus at `D:\Projects\google_gist_scraper` (>40k files). Target: the
web editor (`src/editor.html`, CodeMirror 6), which already has a deterministic
completer (`src/js/puzzlescript-autocomplete.js`) driven by the streaming parser state.

## TL;DR

1. **Build the eval harness and the corpus pipeline first, then models.** Near-duplicate
   gists are the single biggest trap in this corpus: dedup before splitting, and split by
   game lineage, or every number you measure is leakage.
2. **Ship in two tiers.** Tier 1 is a small decoder-only transformer (10 to 30M params)
   trained from scratch with fill-in-the-middle, quantized to int8 and run in the browser
   in a Web Worker. Tier 2 is a LoRA fine-tune of a 0.5B to 1.5B code model (Qwen2.5-Coder
   class) as the quality ceiling, for distillation and optionally for a server endpoint.
3. **Keep the rule-based completer. Add the model around it.** The model re-ranks the
   existing candidate lists and supplies free-form ghost text for whole lines and blocks
   (next rule, next object, next legend line). The parser filters model output: anything
   that fails to parse or references an undeclared object is dropped before it is shown.
4. **Measure what users feel.** Line-level exact match and edit similarity per section,
   compile-validity of the completed file, and later opt-in accept rate. Not perplexity.
5. **Beat the cheap baseline before trusting the transformer.** A section-aware 5-gram
   model is a few hundred lines of JS, needs no GPU, and may already be good enough to ship
   as a v1 ranker. The transformer has to earn its download size against it.

## 1. What "autocomplete" should mean here

PuzzleScript is a tiny, line-oriented, case-insensitive DSL with eight ordered sections.
Completion needs split into three jobs with very different difficulty:

| Job | Example | Who does it best today |
|---|---|---|
| Word completion | object names, directions, `-> `, commands | Rule-based completer (good) |
| Line completion | finish `[ > Player \| Crate ] -> [ > Player \| > Crate ]` | Nothing (mirror trick only) |
| Block completion | next rule after a pattern of rules, the three rotated sprites, `Player = PlayerUp or PlayerDown ...` | Nothing (mirror and rotation tricks only) |

The model's value is almost entirely in rows two and three, inside the RULES section
first, then OBJECTS and LEGEND. LEVELS is where users draw maps by hand. The model should
not try to complete level rows, and training should not let level glyphs dominate the loss.

## 2. Corpus pipeline (do this first, it decides everything)

### 2.1 Ingest and normalise

- Read every file. Strip BOM, normalise line endings to `\n`, drop files under 200 bytes.
- Keep the original text verbatim as the training target. Do not lowercase: the model has
  to reproduce the author's casing (`PlayerUp`), and the corpus is big enough to learn it.
- Record provenance per file: gist id, revision, author login, scrape date. Keep that in
  `manifest.jsonl` and never in the training text.

### 2.2 Compile filter

Run every file through this repo's own parser and compiler in Node, the way
`src/tests/compile_exception_corpus.js` already does. Tag each file:

- `ok`: compiles, maybe with warnings. Primary training data.
- `errors`: parse or compile errors. Keep a small fraction (10 to 20%) at low loss
  weight, because users type partial and broken files, and the model will see broken
  context at inference time. Never use error files as completion *targets* in eval.
- `junk`: not PuzzleScript at all (the scraper will have picked up some). Drop.

Also strip or neutralise the `author` and `homepage` prelude lines: mask them out of the
loss, or replace the value with a placeholder. A completion model that finishes `author `
with real people's names is a privacy problem and a useless feature.

### 2.3 Near-duplicate removal, then lineage split

Expect the 40k files to collapse to far fewer unique games. The editor's share button
creates a fresh gist on every share, so one game typically exists as a chain of dozens of
revisions that differ by a line. The demo games bundled with the editor appear thousands
of times. Two passes:

1. **Exact and structural dedup.** Hash the file with whitespace and comments normalised.
   Then hash a structural signature (object names plus rule lines, lowercased) to catch
   files that differ only in levels or metadata.
2. **Near dedup with MinHash LSH.** Shingle on 5-token windows after whitespace
   tokenisation, Jaccard threshold around 0.8. Union-find the matches into clusters. Each
   cluster is one *lineage*.

Then split 90/5/5 **by lineage**, not by file. From each training lineage keep the last
revision and at most two or three earlier ones, spaced apart, so the model sees
in-progress versions without 30 copies of one game.

Report the counts at every step. Unique-lineage count and total tokens after dedup drive
the model-size decision in section 4; I cannot see the corpus from here, so those numbers
are the first deliverable.

### 2.4 Section-aware trimming

Level maps can be most of a file's bytes and are nearly worthless as targets. In training
samples, keep at most the first two or three levels per file plus every `message` line,
and set the loss weight on level map rows to around 0.2. The model still learns that the
section exists and what rows look like; it just does not spend capacity memorising maps.

### 2.5 Augmentation (optional, PuzzleScript-specific)

- **Consistent identifier renaming** on 10 to 20% of samples: rename all user objects in
  a file with fresh names. Fights memorisation of famous games. Keep the rate low because
  conventions like `Player`, `Crate`, `Wall`, `Target` are real signal the model should
  keep.
- **Rule symmetries** via the existing `RuleTransform` helpers (mirrored and rotated
  rules). Mild value: the rule-based completer already covers this case deterministically.
- The canonicaliser in `src/tests/canonicalizer_node.js` is a better dedup key than it is
  an augmenter. Use it for 2.3 if the structural hash proves too loose.

## 3. Tokeniser

A general code tokeniser is a poor fit: sprite rows like `.000.` and level rows of
arbitrary glyphs get chunked unpredictably, and `->`, `|`, `[`, `]` are the structural
tokens that matter most. Train your own:

- SentencePiece or HF `tokenizers` BPE, vocab 8k to 16k, byte fallback, trained on the
  deduped training split only.
- Pre-tokenise on whitespace and on the structural characters `[ ] | -> = , ( )` so each
  of them is always its own token. Newline is an explicit token. Indentation is preserved
  as runs of spaces (rules and legend lines are not indentation-sensitive, but authors'
  formatting is part of what the completion must match).
- Level map rows will mostly fall back to single-character tokens. That is fine given
  the low loss weight.

Check: the median rule line should be under 25 tokens, and the structural characters must
never merge with neighbouring identifiers.

## 4. Models: three rungs

### Rung 0: n-gram baseline (half a day, no GPU)

A Kneser-Ney 5-gram over the custom tokens, with a separate model per section. Rank the
rule-based completer's candidates by n-gram probability. This runs in plain JS at
microsecond latency and establishes the floor the transformer must beat on the eval in
section 6. It may also be the right v1 ranker on its own.

### Rung 1: small transformer from scratch (the thing to ship in the browser)

- Llama-style decoder: RMSNorm, RoPE, SwiGLU, tied embeddings. Sweep three sizes:
  roughly 5M (d=256, 6 layers), 15M (d=384, 8 layers), 30M (d=512, 8 layers).
- Context 2048 tokens. Train with document packing and EOS separators.
- **Fill-in-the-middle at a 50% rate**, both PSM and SPM orderings (Bavarian et al.
  2022). Editing happens mid-file: a user adding a rule has LEGEND above and LEVELS below,
  and the suffix is strong signal. Bias the split points: half at line boundaries, half at
  random character positions, because both kinds of request happen in the editor.
- Data is small, so train multiple epochs: 4 to 8 passes over the deduped corpus is
  close to as good as fresh data (Muennighoff et al. 2023); stop on validation loss.
- AdamW, lr 6e-4 cosine with warmup, batch about 0.25M tokens, bf16. A 15M model on
  roughly 300M token-passes trains in an hour or two on one consumer GPU.
- Hardware note: this cloud container has 4 CPU cores and no GPU or PyTorch. Training has
  to happen on your machine (WSL2 on the Windows box, if it has a GPU) or a rented GPU.

### Rung 2: LoRA fine-tune of a pretrained code model (the quality ceiling)

Qwen2.5-Coder 0.5B and 1.5B already have FIM training and have almost certainly seen
some PuzzleScript on GitHub. Measure zero-shot first; it is a free data point. Then LoRA
fine-tune on the same splits and FIM format. Uses:

- Tells you how much headroom Rung 1 is leaving on the table.
- **Distillation**: sample many FIM completions from Rung 2 over the training files and
  add them as extra targets for Rung 1. This is the cheapest way to make the small model
  noticeably better once the pipeline exists.
- Optional server endpoint via llama.cpp for people who opt in. puzzlescript.net is a
  static site, so this is an operations decision, not a modelling one.

### 4.1 Context construction must match between training and inference

This is the detail most projects get wrong. A 2048 token window does not hold a whole
game, so define one context builder and use it in both places:

```
[compact symbol header]   object names, legend names, sound events, declared sfx numbers
[prefix window]           up to N lines before the cursor, nearest first
<FIM markers>
[suffix window]           up to M lines after the cursor
```

The symbol header is cheap to build at inference time because the streaming parser
already exposes `state.objects`, `state.legend`, `state.sounds` and the original-case
names. Drop sprite pixel rows and level maps from the header entirely. Build training
samples with exactly this function so the model never sees a layout it will not see in
the editor.

## 5. Editor integration

- **Worker**: run inference off the main thread. The MIS prototype already runs WASM in
  a Web Worker, so there is precedent and plumbing to copy.
- **Runtime**: export Rung 1 to ONNX, quantise to int8 (dynamic quantisation is
  enough at this size), run with onnxruntime-web on WASM, with WebGPU when available. A
  15M int8 model is around 15MB; lazy-load it the first time the user types in RULES and
  cache it in the browser. transformers.js is an acceptable wrapper if it shortens the
  path.
- **KV cache across keystrokes**: keep past key/values for the longest shared prefix so
  each new character costs a few tokens of compute, not a full 2k-token pass.
- **Ghost text**: CodeMirror 6 has no inline-suggestion extension built in. Write one as
  a decoration widget in `src/js/codemirror6/plugins/` (the open-source copilot-style
  extensions are a reasonable template). Debounce around 250ms, cancel on any edit,
  Tab accepts, Escape dismisses.
- **Popup re-ranking**: keep the current completion source in `autocomplete.js` and
  score its candidate list with the model (one batched forward pass over the
  continuations). The deterministic candidates stay; their order improves.
- **Parser gate**: for every model-generated line or block, run the streaming parser
  over context plus candidate and reject any candidate that logs an error, or that
  mentions a name not in the symbol table. This is the cheapest and highest-leverage
  quality filter in the whole plan. Full grammar-constrained decoding can come later.
- **Casing**: if the model emits an identifier whose lowercase form is declared, replace
  it with the declared original-case spelling from the parser state.
- Ship behind an editor setting, off by default until the accept rate says otherwise.

## 6. Evaluation (build before training anything)

Held-out lineages only. Two task families, each scored per section with RULES reported
on its own:

1. **Rest-of-line**: cut a line at a random position, complete to end of line. Exact
   match and normalised edit similarity.
2. **Next-line and next-block**: given everything above (and the suffix for FIM), produce
   the next line, or the next rule group or object block. Exact match, edit similarity.

Plus two PuzzleScript-specific checks that generic metrics miss:

- **Compile validity**: splice the completion into the file and compile with this repo's
  compiler. Report the rate of files that still compile.
- **Symbol validity**: rate of completions whose identifiers are all declared.

Report every number for the rule-based completer, the n-gram, each Rung 1 size, and
Rung 2 zero-shot and fine-tuned. Add a latency column measured in the browser worker.
After launch, add an opt-in counter for shown versus accepted suggestions; that is the
only metric that finally matters, and it must be opt-in and aggregate-only.

## 7. Phased plan

| Phase | Work | Rough effort |
|---|---|---|
| 0 | Corpus pipeline: ingest, compile filter, dedup, lineage split, section trimming, stats | 1 to 2 days |
| 1 | Eval harness plus baselines: rule-based, n-gram, zero-shot Qwen2.5-Coder FIM | 1 day |
| 2 | Tokeniser, Rung 1 size sweep, Rung 2 LoRA, pick the browser model | 2 to 3 days |
| 3 | ONNX export and int8, worker, KV cache, ghost-text extension, parser gate, re-ranking | 3 to 5 days |
| 4 | Distillation from Rung 2, opt-in telemetry, iterate on accept rate | ongoing |

Phases 0 and 1 are the ones to be strict about. If the n-gram re-ranker already lifts the
rule-based completer and compile validity is high, ship that first and let the
transformer work proceed without blocking users.

## 8. Risks and open questions

- **Corpus is mostly revisions of few games.** Unknown until Phase 0 prints the lineage
  count. If it is under ~5k lineages, lean on Rung 2 plus distillation and heavier
  identifier renaming, and keep Rung 1 at the small end.
- **Licensing.** Gists are public but carry no uniform licence. Keep the provenance
  manifest, do not redistribute the corpus, and document the model as trained on public
  gists. Mask author lines as in 2.2.
- **Download size versus benefit.** A 15MB model is a real cost for a page that loads in
  under a second today. Lazy-load, cache, and let the eval decide whether 5M is enough.
- **Where completion runs.** This proposal assumes the browser editor with no server.
  If a server is acceptable, Rung 2 behind an endpoint becomes the simpler shipping path
  and Rung 1 becomes the offline fallback.
