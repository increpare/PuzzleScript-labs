"""Tokenised, packed training data for the PuzzleScript autocomplete model (Phase 2).

    python autocomplete/train/data.py --tokenizer <data>/tokenizer/tokenizer.json \
        [--data D:\Projects\ps_autocomplete_data] [--split train|val] [--force]

Reads <data>/samples/<split>.jsonl (rows {id, kind, section, text, spans}, spans contiguous
and covering text with a per-span loss weight, see pipeline/build_samples.js), tokenises
each sample with the `tokenizers` JSON, maps every token onto the span its first character
lies in, and writes one packed stream per split:

    <data>/tokens/<split>.ids.npy      uint16   token ids, samples concatenated (each ends in <EOS>)
    <data>/tokens/<split>.weights.npy  float16  per-token loss weight, same length
    <data>/tokens/<split>.meta.json    counts and the tokenizer path/hash used

Markers (<SYM> <PRE> <SUF> <MID> <EOS>) are added special tokens, so they come out as single
ids with offsets that cover exactly the marker text; their span weight is 0, as is the symbol
header's. Nothing here depends on the model.
"""

import argparse
import hashlib
import json
import os
import sys
import time

import numpy as np
from tokenizers import Tokenizer

DEFAULT_DATA = r"D:\Projects\ps_autocomplete_data"


def data_dir(explicit=None):
    return explicit or os.environ.get("PS_AC_DATA") or DEFAULT_DATA


def token_weights(spans, offsets):
    """Weight per token: the weight of the span containing the token's first character."""
    weights = np.empty(len(offsets), dtype=np.float32)
    span_i = 0
    n = len(spans)
    for t, (start, end) in enumerate(offsets):
        pos = start if end > start else max(start - 1, 0)
        while span_i < n and spans[span_i]["end"] <= pos:
            span_i += 1
        if span_i >= n:
            weights[t] = 0.0
        else:
            weights[t] = float(spans[span_i]["weight"])
    return weights


def iter_samples(path):
    with open(path, encoding="utf8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def build_split(tok, samples_path, out_prefix, eos_id, log=print):
    ids_chunks, w_chunks = [], []
    n_samples = n_tokens = 0
    zero_weight_tokens = 0
    t0 = time.time()
    batch_rows = []

    def flush():
        nonlocal n_samples, n_tokens, zero_weight_tokens
        if not batch_rows:
            return
        encodings = tok.encode_batch([r["text"] for r in batch_rows])
        for row, enc in zip(batch_rows, encodings):
            ids = np.asarray(enc.ids, dtype=np.uint16)
            w = token_weights(row["spans"], enc.offsets)
            if len(ids) == 0 or ids[-1] != eos_id:
                ids = np.append(ids, np.uint16(eos_id))
                w = np.append(w, np.float32(0.0))
            ids_chunks.append(ids)
            w_chunks.append(w.astype(np.float16))
            n_samples += 1
            n_tokens += len(ids)
            zero_weight_tokens += int((w == 0).sum())
        batch_rows.clear()

    for row in iter_samples(samples_path):
        batch_rows.append(row)
        if len(batch_rows) >= 256:
            flush()
            if n_samples % 2048 == 0:
                log(f"  {n_samples} samples, {n_tokens / 1e6:.1f}M tokens, {time.time() - t0:.0f}s")
    flush()

    ids = np.concatenate(ids_chunks) if ids_chunks else np.zeros(0, dtype=np.uint16)
    weights = np.concatenate(w_chunks) if w_chunks else np.zeros(0, dtype=np.float16)
    np.save(out_prefix + ".ids.npy", ids)
    np.save(out_prefix + ".weights.npy", weights)
    meta = {
        "samples": n_samples,
        "tokens": int(n_tokens),
        "zero_weight_tokens": int(zero_weight_tokens),
        "seconds": round(time.time() - t0, 1),
    }
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--data", default=None)
    ap.add_argument("--split", default="train,val")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    base = data_dir(args.data)
    tok = Tokenizer.from_file(args.tokenizer)
    eos_id = tok.token_to_id("<EOS>")
    if eos_id is None:
        sys.exit("tokenizer has no <EOS> token")
    with open(args.tokenizer, "rb") as f:
        tok_hash = hashlib.sha256(f.read()).hexdigest()[:16]
    out_dir = os.path.join(base, "tokens")
    os.makedirs(out_dir, exist_ok=True)

    for split in args.split.split(","):
        samples_path = os.path.join(base, "samples", f"{split}.jsonl")
        out_prefix = os.path.join(out_dir, split)
        meta_path = out_prefix + ".meta.json"
        if not args.force and os.path.exists(meta_path):
            with open(meta_path, encoding="utf8") as f:
                old = json.load(f)
            if old.get("tokenizer_hash") == tok_hash:
                print(f"{split}: up to date ({old['tokens']} tokens)")
                continue
        print(f"{split}: tokenising {samples_path}")
        meta = build_split(tok, samples_path, out_prefix, eos_id)
        meta.update({"tokenizer": os.path.abspath(args.tokenizer), "tokenizer_hash": tok_hash, "vocab_size": tok.get_vocab_size()})
        with open(meta_path, "w", encoding="utf8") as f:
            json.dump(meta, f, indent=2)
        print(f"{split}: {meta['samples']} samples, {meta['tokens']} tokens "
              f"({meta['zero_weight_tokens']} at weight 0), {meta['seconds']}s")


if __name__ == "__main__":
    main()
