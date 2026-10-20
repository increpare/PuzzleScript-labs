"""Run a trained checkpoint over the eval prompts (Phase 2 scoring through the harness).

    python autocomplete/train/run_model.py --checkpoint <data>/runs/xs/best \
        --prompts <data>/eval/prompts_val.jsonl --out <data>/eval/preds/xs_val.jsonl \
        [--mode spm|psm] [--limit N] [--max-new-tokens 48] [--block-max-new-tokens 160]

Prompts come from export_prompts.js (header, prefix, suffix, stop) and are rendered with
the context builder's layout (context.js render): PSM is <SYM>..<PRE>prefix<SUF>suffix<MID>,
SPM is <SYM>..<PRE><SUF>suffix<MID>prefix. Greedy decoding, cut at the first newline for
line tasks and the first blank line for block tasks. Output rows {i, prediction, latency_ms}
for eval/score.js, the same shape as the n-gram and Qwen runners.
"""

import argparse
import json
import os
import sys
import time

import torch
from tokenizers import Tokenizer
from transformers import LlamaForCausalLM

MARK = {"pre": "<PRE>", "suf": "<SUF>", "mid": "<MID>", "eos": "<EOS>"}


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
def generate(model, tok, prompt, max_new, eos_id, device, stop, max_context):
    ids = tok.encode(prompt, add_special_tokens=False).ids
    if len(ids) > max_context - max_new:
        ids = ids[-(max_context - max_new):]
    input_ids = torch.tensor([ids], dtype=torch.long, device=device)
    out = model.generate(
        input_ids=input_ids, max_new_tokens=max_new, do_sample=False,
        eos_token_id=eos_id, pad_token_id=eos_id, use_cache=True,
    )
    new_ids = out[0][len(ids):].tolist()
    if eos_id in new_ids:
        new_ids = new_ids[: new_ids.index(eos_id)]
    text = tok.decode(new_ids, skip_special_tokens=True)
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
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tok = Tokenizer.from_file(os.path.join(args.checkpoint, "tokenizer.json"))
    eos_id = tok.token_to_id("<EOS>")
    model = LlamaForCausalLM.from_pretrained(args.checkpoint, dtype=torch.float32).to(device).eval()
    max_context = model.config.max_position_embeddings

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
            pred = generate(model, tok, prompt, max_new, eos_id, device, row["stop"], max_context)
            latency = (time.perf_counter() - t0) * 1000
            out.write(json.dumps({"i": row["i"], "prediction": pred, "latency_ms": round(latency, 1)}) + "\n")
            if n % 500 == 0:
                print(f"model: {n}/{len(rows)} ({n / (time.time() - t_start):.1f}/s)", file=sys.stderr, flush=True)
    print(f"model: wrote {len(rows)} predictions to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
