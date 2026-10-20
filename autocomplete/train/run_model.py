"""Run a trained checkpoint over the eval prompts (Phase 2 scoring through the harness).

    python autocomplete/train/run_model.py --checkpoint <data>/runs/xs/best \
        --prompts <data>/eval/prompts_val.jsonl --out <data>/eval/preds/xs_val.jsonl \
        [--mode spm|psm] [--limit N] [--max-new-tokens 48] [--block-max-new-tokens 160]

Prompts come from export_prompts.js (header, prefix, suffix, stop) and are rendered with
the context builder's layout (context.js render): PSM is <SYM>..<PRE>prefix<SUF>suffix<MID>,
SPM is <SYM>..<PRE><SUF>suffix<MID>prefix. Greedy decoding with token healing (same rule
as the editor worker; --no-heal turns it off), cut at the first newline for line tasks
and the first blank line for block tasks. Output rows {i, prediction, latency_ms}
for eval/score.js, the same shape as the n-gram and Qwen runners.
"""

import argparse
import json
import os
import re
import sys
import time

import torch
from tokenizers import Tokenizer
from transformers import LlamaForCausalLM

MARK = {"pre": "<PRE>", "suf": "<SUF>", "mid": "<MID>", "eos": "<EOS>"}

# Token healing, the same rule as the editor worker (src/js/autocomplete_model_worker.js):
# the prompt's last pre-token (a word with its leading space, or a run of spaces) is cut
# off and regenerated under the constraint that the output starts with it.
TAIL = re.compile(r"( ?[^\s\[\]|,()=]+| +)$")


def split_tail(prompt):
    m = TAIL.search(prompt)
    if not m or len(m.group(1)) >= len(prompt):
        return prompt, ""
    return prompt[: len(prompt) - len(m.group(1))], m.group(1)


def render_prompt(row, mode):
    header = row.get("header", "")
    if mode == "spm":
        return header + MARK["pre"] + MARK["suf"] + row["suffix"] + MARK["mid"] + row["prefix"]
    return header + MARK["pre"] + row["prefix"] + MARK["suf"] + row["suffix"] + MARK["mid"]


def cut(text, stop):
    if stop == "line":
        nl = text.find("\n")
        return text if nl < 0 else text[:nl]
    idx = text.find("\n\n")
    return text if idx < 0 else text[:idx]


@torch.no_grad()
def generate(model, tok, prompt, max_new, eos_id, device, stop, max_context, vocab_strings, heal=True):
    head, tail = split_tail(prompt) if heal else (prompt, "")
    ids = tok.encode(head, add_special_tokens=False).ids
    budget = max_new + (2 if tail else 0)
    if len(ids) > max_context - budget:
        ids = ids[-(max_context - budget):]
    input_ids = torch.tensor([ids], dtype=torch.long, device=device)
    all_ids = list(range(len(vocab_strings)))

    def allowed(batch_id, seq):
        done = tok.decode(seq[len(ids):].tolist(), skip_special_tokens=False)
        if done.startswith(tail):
            return all_ids
        req = tail[len(done):] if tail.startswith(done) else tail
        ok = [i for i, t in enumerate(vocab_strings) if t and i != eos_id and (t.startswith(req) or req.startswith(t))]
        return ok or all_ids

    kwargs = dict(input_ids=input_ids, max_new_tokens=budget, do_sample=False,
                  eos_token_id=eos_id, pad_token_id=eos_id, use_cache=True)
    if tail:
        kwargs["prefix_allowed_tokens_fn"] = allowed
    out = model.generate(**kwargs)
    new_ids = out[0][len(ids):].tolist()
    if eos_id in new_ids:
        new_ids = new_ids[: new_ids.index(eos_id)]
    text = tok.decode(new_ids, skip_special_tokens=True)
    if tail:
        if not text.startswith(tail):
            return ""
        text = text[len(tail):]
    return cut(text, stop)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--prompts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", default="spm", choices=["spm", "psm"])
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-new-tokens", type=int, default=48)
    ap.add_argument("--block-max-new-tokens", type=int, default=160)
    ap.add_argument("--no-heal", action="store_true", help="disable token healing (the editor always heals)")
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tok = Tokenizer.from_file(os.path.join(args.checkpoint, "tokenizer.json"))
    eos_id = tok.token_to_id("<EOS>")
    model = LlamaForCausalLM.from_pretrained(args.checkpoint, dtype=torch.float32).to(device).eval()
    max_context = model.config.max_position_embeddings
    vocab_strings = [tok.decode([i], skip_special_tokens=False) for i in range(tok.get_vocab_size())]

    rows = [json.loads(line) for line in open(args.prompts, encoding="utf8") if line.strip()]
    if args.limit:
        rows = rows[: args.limit]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    t_start = time.time()
    with open(args.out, "w", encoding="utf8") as out:
        for n, row in enumerate(rows, 1):
            prompt = render_prompt(row, args.mode)
            max_new = args.block_max_new_tokens if row["stop"] == "block" else args.max_new_tokens
            t0 = time.perf_counter()
            pred = generate(model, tok, prompt, max_new, eos_id, device, row["stop"], max_context,
                            vocab_strings, heal=not args.no_heal)
            latency = (time.perf_counter() - t0) * 1000
            out.write(json.dumps({"i": row["i"], "prediction": pred, "latency_ms": round(latency, 1)}) + "\n")
            if n % 500 == 0:
                print(f"model: {n}/{len(rows)} ({n / (time.time() - t_start):.1f}/s)", file=sys.stderr, flush=True)
    print(f"model: wrote {len(rows)} predictions to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
