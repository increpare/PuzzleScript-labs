"""Train a small Llama-style PuzzleScript completion model (Phase 2, handoff 5.2).

    python autocomplete/train/train.py --size xs --tokenizer <data>/tokenizer/tokenizer.json \
        --out <data>/runs/xs [--data DIR] [--epochs 6] [--batch-tokens 262144] [--lr 6e-4] \
        [--warmup 500] [--seq 2048] [--micro-batch 8] [--seed 0] [--max-steps N] [--eval-every N]

Reads the packed streams from data.py (<data>/tokens/{train,val}.{ids,weights}.npy), cuts
them into blocks of --seq + 1 tokens, and trains with a per-token weighted cross-entropy:
level map rows 0.2, author/homepage 0, markers and symbol header 0, broken files x0.3
(weights come from pipeline/build_samples.js through data.py). AdamW, cosine schedule with
warmup, bf16 autocast, gradient clipping at 1.0, early stopping on validation loss.

Writes to --out: config.json (the run config), log.csv (step, tokens, lr, train_loss,
val_loss, seconds), best/ (save_pretrained of the best validation checkpoint, plus
config.json and the tokenizer copied next to it) and last/ (the final weights).
"""

import argparse
import csv
import json
import math
import os
import random
import shutil
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import build_model, SIZES  # noqa: E402

DEFAULT_DATA = r"D:\Projects\ps_autocomplete_data"


def data_dir(explicit=None):
    return explicit or os.environ.get("PS_AC_DATA") or DEFAULT_DATA


class PackedBlocks:
    """Fixed blocks of seq+1 tokens over a packed stream; weights apply to the predicted token."""

    def __init__(self, prefix, seq):
        self.ids = np.load(prefix + ".ids.npy", mmap_mode="r")
        self.weights = np.load(prefix + ".weights.npy", mmap_mode="r")
        self.seq = seq
        self.n_blocks = (len(self.ids) - 1) // seq

    def __len__(self):
        return self.n_blocks

    def block(self, i):
        start = i * self.seq
        ids = np.asarray(self.ids[start:start + self.seq + 1], dtype=np.int64)
        w = np.asarray(self.weights[start + 1:start + self.seq + 1], dtype=np.float32)
        return ids, w

    def batch(self, indices, device):
        ids = np.stack([self.block(i)[0] for i in indices])
        w = np.stack([self.block(i)[1] for i in indices])
        x = torch.from_numpy(ids[:, :-1]).to(device, non_blocking=True)
        y = torch.from_numpy(ids[:, 1:]).to(device, non_blocking=True)
        w = torch.from_numpy(w).to(device, non_blocking=True)
        return x, y, w


def weighted_loss(logits, targets, weights):
    loss = F.cross_entropy(logits.float().view(-1, logits.size(-1)), targets.reshape(-1), reduction="none")
    w = weights.reshape(-1)
    return (loss * w).sum() / w.sum().clamp_min(1.0)


@torch.no_grad()
def evaluate(model, blocks, device, micro_batch, max_blocks=None):
    model.eval()
    total, weight_sum = 0.0, 0.0
    n = len(blocks) if max_blocks is None else min(len(blocks), max_blocks)
    for start in range(0, n, micro_batch):
        idx = list(range(start, min(n, start + micro_batch)))
        x, y, w = blocks.batch(idx, device)
        with torch.autocast(device_type="cuda", dtype=torch.bfloat16, enabled=device == "cuda"):
            logits = model(input_ids=x).logits
        loss = F.cross_entropy(logits.float().view(-1, logits.size(-1)), y.reshape(-1), reduction="none")
        total += float((loss * w.reshape(-1)).sum())
        weight_sum += float(w.sum())
    model.train()
    return total / max(weight_sum, 1.0)


def lr_at(step, args, total_steps):
    if step < args.warmup:
        return args.lr * (step + 1) / args.warmup
    progress = (step - args.warmup) / max(1, total_steps - args.warmup)
    return args.min_lr + 0.5 * (args.lr - args.min_lr) * (1 + math.cos(math.pi * min(1.0, progress)))


def save(model, tokenizer_path, out_dir, extra):
    os.makedirs(out_dir, exist_ok=True)
    model.save_pretrained(out_dir, safe_serialization=True)
    shutil.copy(tokenizer_path, os.path.join(out_dir, "tokenizer.json"))
    with open(os.path.join(out_dir, "train_state.json"), "w", encoding="utf8") as f:
        json.dump(extra, f, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", required=True, choices=sorted(SIZES))
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--data", default=None)
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--seq", type=int, default=2048)
    ap.add_argument("--batch-tokens", type=int, default=262144)
    ap.add_argument("--micro-batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=6e-4)
    ap.add_argument("--min-lr", type=float, default=6e-5)
    ap.add_argument("--warmup", type=int, default=500)
    ap.add_argument("--weight-decay", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--max-steps", type=int, default=0)
    ap.add_argument("--eval-every", type=int, default=0, help="steps; 0 = once per epoch")
    ap.add_argument("--eval-blocks", type=int, default=0, help="cap on validation blocks per eval; 0 = all")
    ap.add_argument("--patience", type=int, default=2, help="evals without improvement before stopping")
    ap.add_argument("--compile", action="store_true", help="torch.compile the model")
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    base = data_dir(args.data)
    os.makedirs(args.out, exist_ok=True)

    from tokenizers import Tokenizer
    tok = Tokenizer.from_file(args.tokenizer)
    vocab_size = tok.get_vocab_size()

    train_blocks = PackedBlocks(os.path.join(base, "tokens", "train"), args.seq)
    val_blocks = PackedBlocks(os.path.join(base, "tokens", "val"), args.seq)
    blocks_per_step = max(1, args.batch_tokens // args.seq)
    accum = max(1, blocks_per_step // args.micro_batch)
    steps_per_epoch = len(train_blocks) // blocks_per_step
    total_steps = steps_per_epoch * args.epochs
    if args.max_steps:
        total_steps = min(total_steps, args.max_steps)
    eval_every = args.eval_every or steps_per_epoch

    model = build_model(args.size, vocab_size).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    if args.compile:
        model = torch.compile(model)
    decay, no_decay = [], []
    for name, p in model.named_parameters():
        (decay if p.dim() >= 2 else no_decay).append(p)
    optimizer = torch.optim.AdamW(
        [{"params": decay, "weight_decay": args.weight_decay}, {"params": no_decay, "weight_decay": 0.0}],
        lr=args.lr, betas=(0.9, 0.95), fused=device == "cuda")

    run_config = vars(args) | {
        "device": device, "vocab_size": vocab_size, "params": n_params,
        "train_blocks": len(train_blocks), "val_blocks": len(val_blocks),
        "blocks_per_step": blocks_per_step, "grad_accum": accum,
        "steps_per_epoch": steps_per_epoch, "total_steps": total_steps,
        "train_tokens_per_epoch": len(train_blocks) * args.seq,
        "gpu": torch.cuda.get_device_name(0) if device == "cuda" else None,
    }
    with open(os.path.join(args.out, "config.json"), "w", encoding="utf8") as f:
        json.dump(run_config, f, indent=2)
    print(f"{args.size}: {n_params / 1e6:.1f}M params, {len(train_blocks)} train blocks of {args.seq}, "
          f"{steps_per_epoch} steps/epoch, {total_steps} steps, accum {accum} x {args.micro_batch}", flush=True)

    log_path = os.path.join(args.out, "log.csv")
    log_file = open(log_path, "w", newline="", encoding="utf8")
    log = csv.writer(log_file)
    log.writerow(["step", "epoch", "tokens", "lr", "train_loss", "val_loss", "seconds"])

    best_val = float("inf")
    bad_evals = 0
    step = 0
    tokens_seen = 0
    t_start = time.time()
    model.train()
    order = np.arange(len(train_blocks))
    rng = np.random.default_rng(args.seed)
    stop = False
    for epoch in range(args.epochs):
        rng.shuffle(order)
        for s in range(steps_per_epoch):
            if step >= total_steps:
                stop = True
                break
            lr = lr_at(step, args, total_steps)
            for g in optimizer.param_groups:
                g["lr"] = lr
            chunk = order[s * blocks_per_step:(s + 1) * blocks_per_step]
            optimizer.zero_grad(set_to_none=True)
            loss_total = 0.0
            for a in range(accum):
                idx = chunk[a * args.micro_batch:(a + 1) * args.micro_batch]
                if len(idx) == 0:
                    break
                x, y, w = train_blocks.batch(idx, device)
                with torch.autocast(device_type="cuda", dtype=torch.bfloat16, enabled=device == "cuda"):
                    logits = model(input_ids=x).logits
                loss = weighted_loss(logits, y, w) / accum
                loss.backward()
                loss_total += float(loss)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            step += 1
            tokens_seen += len(chunk) * args.seq

            val_loss = ""
            if step % eval_every == 0 or step == total_steps:
                val_loss = evaluate(model, val_blocks, device, args.micro_batch, args.eval_blocks or None)
                improved = val_loss < best_val
                if improved:
                    best_val = val_loss
                    bad_evals = 0
                    save(model if not args.compile else model._orig_mod, args.tokenizer, os.path.join(args.out, "best"),
                         {"step": step, "epoch": epoch, "val_loss": val_loss, "tokens": tokens_seen})
                else:
                    bad_evals += 1
                print(f"step {step} epoch {epoch} val_loss {val_loss:.4f}{' *' if improved else ''}", flush=True)
                if bad_evals >= args.patience:
                    print("early stop", flush=True)
                    stop = True
            if step % 20 == 0 or val_loss != "":
                elapsed = time.time() - t_start
                log.writerow([step, epoch, tokens_seen, f"{lr:.2e}", f"{loss_total:.4f}", val_loss, f"{elapsed:.0f}"])
                log_file.flush()
            if step % 20 == 0:
                elapsed = time.time() - t_start
                print(f"step {step}/{total_steps} loss {loss_total:.4f} lr {lr:.2e} "
                      f"{tokens_seen / max(elapsed, 1e-6) / 1e3:.0f}k tok/s", flush=True)
            if stop:
                break
        if stop:
            break

    save(model if not args.compile else model._orig_mod, args.tokenizer, os.path.join(args.out, "last"),
         {"step": step, "epoch": epoch, "best_val_loss": best_val, "tokens": tokens_seen})
    log_file.close()
    print(f"done: best val_loss {best_val:.4f}, {tokens_seen / 1e6:.1f}M tokens, {(time.time() - t_start) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
