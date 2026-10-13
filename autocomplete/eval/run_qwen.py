"""Phase 1, baseline 3: Qwen2.5-Coder zero-shot with its native FIM tokens.

    python autocomplete/eval/run_qwen.py --prompts <data>/eval/prompts_val.jsonl \
        --out <data>/eval/preds/qwen15b_val.jsonl [--model Qwen/Qwen2.5-Coder-1.5B] [--limit N]

Reads prompts exported by export_prompts.js (same context builder as training), formats
them as <|fim_prefix|>{header}{prefix}<|fim_suffix|>{suffix}<|fim_middle|>, decodes
greedily, and cuts at the first newline (line tasks) or blank line (block tasks).
Writes predictions JSONL {i, prediction, latency_ms} for score.js.
"""

import argparse
import json
import sys
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


def cut(text, stop):
    if stop == "line":
        nl = text.find("\n")
        return text if nl < 0 else text[:nl]
    # block: up to the first blank line
    idx = text.find("\n\n")
    return text if idx < 0 else text[:idx]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="Qwen/Qwen2.5-Coder-1.5B")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-new-tokens", type=int, default=64)
    ap.add_argument("--block-max-new-tokens", type=int, default=200)
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"loading {args.model} on {device}", file=sys.stderr)
    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model, torch_dtype=torch.bfloat16 if device == "cuda" else torch.float32
    ).to(device).eval()
    eos_ids = [tok.eos_token_id]
    for special in ("<|endoftext|>", "<|fim_pad|>", "<|file_sep|>"):
        tid = tok.convert_tokens_to_ids(special)
        if isinstance(tid, int) and tid >= 0 and tid not in eos_ids:
            eos_ids.append(tid)

    rows = [json.loads(line) for line in open(args.prompts, encoding="utf8") if line.strip()]
    if args.limit:
        rows = rows[: args.limit]
    done = 0
    t_start = time.time()
    with open(args.out, "w", encoding="utf8") as out:
        for row in rows:
            prompt = (
                "<|fim_prefix|>" + row["header"] + row["prefix"]
                + "<|fim_suffix|>" + row["suffix"] + "<|fim_middle|>"
            )
            ids = tok(prompt, return_tensors="pt", truncation=True, max_length=4096).to(device)
            max_new = args.block_max_new_tokens if row["stop"] == "block" else args.max_new_tokens
            t0 = time.perf_counter()
            with torch.no_grad():
                gen = model.generate(
                    **ids, max_new_tokens=max_new, do_sample=False, eos_token_id=eos_ids,
                    pad_token_id=tok.eos_token_id,
                )
            latency = (time.perf_counter() - t0) * 1000
            text = tok.decode(gen[0][ids["input_ids"].shape[1]:], skip_special_tokens=True)
            pred = cut(text, row["stop"])
            # An empty generation counts as a (wrong) prediction, consistent with the n-gram runner.
            out.write(json.dumps({"i": row["i"], "prediction": pred,
                                  "latency_ms": round(latency, 1)}) + "\n")
            done += 1
            if done % 100 == 0:
                rate = done / (time.time() - t_start)
                print(f"qwen: {done}/{len(rows)} ({rate:.1f}/s)", file=sys.stderr)
    print(f"qwen: wrote {done} predictions to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
