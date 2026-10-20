"""Export a LlamaForCausalLM (model.py sizes) to ONNX with a KV cache, plus int8/fp16 variants.

Graph contract (batch B, new tokens L, cached tokens P, T = P + L, H heads, D head dim):

    inputs   input_ids               int64   [B, L]
             position_ids            int64   [B, L]     absolute positions, normally P..P+L-1
             past_key_values.N.key   float32 [B, H, P, D]   N = 0..layers-1 (P = 0 on the first call)
             past_key_values.N.value float32 [B, H, P, D]
    outputs  logits                  float32 [B, L, vocab]
             present.N.key           float32 [B, H, T, D]   feed back as past_key_values.N.key
             present.N.value         float32 [B, H, T, D]

Attention is causal from the shapes alone (key j is visible to new token i iff j <= P + i);
there is no attention_mask input, so no padding: run batch 1 or equal-length batches.

The forward pass is re-implemented here on top of the HF module's weights (plain matmul,
softmax, RMSNorm, RoPE) so the exported graph has no SDPA/cache-object machinery and
every op is in the WebGPU execution provider's supported set. `verify()` checks it
against LlamaForCausalLM's own logits.

    python autocomplete/train/export_onnx.py --size xs --out D:/.../xs.onnx          # random weights
    python autocomplete/train/export_onnx.py --checkpoint DIR --out FILE               # trained model
    python autocomplete/train/export_onnx.py --all --out-dir D:/.../models/spike       # xs, s, m

Writes <name>.onnx (fp32), <name>.int8.onnx (dynamic int8 weights via onnxruntime
quantize_dynamic) and <name>.fp16.onnx (fp16 weights and compute, fp32 inputs/outputs).
"""

import argparse
import json
import math
import os
import sys
import time

# Windows consoles default to cp1252; the exporter and the report print non-ASCII.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import SIZES, build_model, count_params  # noqa: E402

OPSET = 18


def _rms_norm(x, weight, eps):
    variance = x.pow(2).mean(-1, keepdim=True)
    return weight * (x * torch.rsqrt(variance + eps))


def _rotate_half(x):
    half = x.shape[-1] // 2
    return torch.cat((-x[..., half:], x[..., :half]), dim=-1)


class CausalLMWithCache(nn.Module):
    """Export wrapper: flat KV-cache tensors in and out, causal mask from shapes."""

    def __init__(self, hf_model):
        super().__init__()
        self.hf = hf_model
        cfg = hf_model.config
        self.num_layers = cfg.num_hidden_layers
        self.num_heads = cfg.num_attention_heads
        self.head_dim = cfg.hidden_size // cfg.num_attention_heads
        self.eps = cfg.rms_norm_eps
        rope_theta = getattr(cfg, "rope_theta", None)
        if rope_theta is None:  # transformers >= 5 keeps it in rope_parameters
            rope_theta = cfg.rope_parameters["rope_theta"]
        inv_freq = 1.0 / (rope_theta ** (torch.arange(0, self.head_dim, 2, dtype=torch.float32) / self.head_dim))
        self.register_buffer("inv_freq", inv_freq, persistent=False)

    def forward(self, input_ids, position_ids, past_key_values):
        m = self.hf.model
        bsz, seq = input_ids.shape
        past_len = past_key_values[0].shape[2]
        total = past_len + seq

        x = m.embed_tokens(input_ids)
        freqs = position_ids.to(torch.float32)[:, :, None] * self.inv_freq[None, None, :]
        emb = torch.cat((freqs, freqs), dim=-1)
        cos = emb.cos()[:, None, :, :]
        sin = emb.sin()[:, None, :, :]

        key_pos = torch.arange(total, device=input_ids.device)[None, None, None, :]
        allowed = key_pos <= position_ids[:, None, :, None]  # [B, 1, L, T]

        presents = []
        for i, layer in enumerate(m.layers):
            h = _rms_norm(x, layer.input_layernorm.weight, self.eps)
            attn = layer.self_attn
            q = attn.q_proj(h).view(bsz, seq, self.num_heads, self.head_dim).transpose(1, 2)
            k = attn.k_proj(h).view(bsz, seq, self.num_heads, self.head_dim).transpose(1, 2)
            v = attn.v_proj(h).view(bsz, seq, self.num_heads, self.head_dim).transpose(1, 2)
            q = q * cos + _rotate_half(q) * sin
            k = k * cos + _rotate_half(k) * sin
            k = torch.cat((past_key_values[2 * i], k), dim=2)
            v = torch.cat((past_key_values[2 * i + 1], v), dim=2)
            presents.append(k)
            presents.append(v)
            scores = torch.matmul(q, k.transpose(2, 3)) / math.sqrt(self.head_dim)
            scores = torch.where(allowed, scores, torch.full_like(scores, -1e4))
            probs = torch.softmax(scores, dim=-1)
            o = torch.matmul(probs, v).transpose(1, 2).reshape(bsz, seq, self.num_heads * self.head_dim)
            x = x + attn.o_proj(o)
            h = _rms_norm(x, layer.post_attention_layernorm.weight, self.eps)
            mlp = layer.mlp
            x = x + mlp.down_proj(F.silu(mlp.gate_proj(h)) * mlp.up_proj(h))
        x = _rms_norm(x, m.norm.weight, self.eps)
        logits = self.hf.lm_head(x)
        return logits, presents


def input_names(num_layers):
    names = ["input_ids", "position_ids"]
    for i in range(num_layers):
        names += [f"past_key_values.{i}.key", f"past_key_values.{i}.value"]
    return names


def output_names(num_layers):
    names = ["logits"]
    for i in range(num_layers):
        names += [f"present.{i}.key", f"present.{i}.value"]
    return names


def empty_past(cfg, batch=1, past_len=0, dtype=torch.float32):
    head_dim = cfg.hidden_size // cfg.num_attention_heads
    return [torch.zeros(batch, cfg.num_attention_heads, past_len, head_dim, dtype=dtype)
            for _ in range(2 * cfg.num_hidden_layers)]


def export_fp32(hf_model, out_path):
    hf_model = hf_model.eval().float().cpu()
    cfg = hf_model.config
    wrapper = CausalLMWithCache(hf_model).eval()
    # Non-trivial sample dims (B=2, L=5, P=3) so the exporter sees them as dynamic.
    batch, seq, past_len = 2, 5, 3
    input_ids = torch.randint(0, cfg.vocab_size, (batch, seq))
    position_ids = (past_len + torch.arange(seq))[None, :].repeat(batch, 1)
    past = empty_past(cfg, batch, past_len)

    from torch.export import Dim
    dim_b, dim_l, dim_p = Dim("batch"), Dim("seq"), Dim("past")
    dyn = (
        {0: dim_b, 1: dim_l},
        {0: dim_b, 1: dim_l},
        [{0: dim_b, 2: dim_p} for _ in past],
    )
    with torch.no_grad():
        prog = torch.onnx.export(
            wrapper, (input_ids, position_ids, past), dynamo=True, dynamic_shapes=dyn,
            input_names=input_names(cfg.num_hidden_layers), output_names=output_names(cfg.num_hidden_layers),
            opset_version=OPSET, external_data=False,
        )
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    prog.save(out_path, external_data=False)
    return out_path


def quantize_int8(fp32_path, out_path):
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.shape_inference import quant_pre_process
    pre_path = out_path + ".pre.tmp"
    try:
        quant_pre_process(fp32_path, pre_path, skip_symbolic_shape=False)
        src = pre_path
    except Exception as e:  # pre-processing is an optimisation, not a requirement
        print(f"quant_pre_process failed ({e}); quantising the raw export", flush=True)
        src = fp32_path
    # Gather included so the (tied) embedding table is stored as int8 instead of staying
    # fp32 next to the int8 lm_head copy.
    quantize_dynamic(src, out_path, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gather"])
    if os.path.exists(pre_path):
        os.remove(pre_path)
    return out_path


def convert_fp16(fp32_path, out_path):
    import onnx
    from onnxruntime.transformers.float16 import convert_float_to_float16
    model = onnx.load(fp32_path)
    model16 = convert_float_to_float16(model, keep_io_types=True, disable_shape_infer=False)
    onnx.save(model16, out_path)
    return out_path


def _ort_session(path):
    import onnxruntime as ort
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    return ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])


def _run(session, cfg, input_ids, position_ids, past):
    feeds = {"input_ids": input_ids.numpy().astype(np.int64), "position_ids": position_ids.numpy().astype(np.int64)}
    for name, tensor in zip(input_names(cfg.num_hidden_layers)[2:], past):
        feeds[name] = tensor if isinstance(tensor, np.ndarray) else tensor.numpy()
    outs = session.run(None, feeds)
    return outs[0], outs[1:]


def verify(hf_model, onnx_path, prompts=3, seq_len=64, split=40, seed=1, atol=1e-4):
    """Compare ONNX (full pass and cached two-step pass) with HF logits on random prompts."""
    hf_model = hf_model.eval().float().cpu()
    cfg = hf_model.config
    session = _ort_session(onnx_path)
    rng = torch.Generator().manual_seed(seed)
    worst_full, worst_cached, argmax_agree, argmax_total = 0.0, 0.0, 0, 0
    with torch.no_grad():
        for _ in range(prompts):
            ids = torch.randint(0, cfg.vocab_size, (1, seq_len), generator=rng)
            ref = hf_model(input_ids=ids).logits.numpy()
            pos = torch.arange(seq_len)[None, :]
            full, _ = _run(session, cfg, ids, pos, empty_past(cfg))
            worst_full = max(worst_full, float(np.abs(full - ref).max()))
            # two-step: first `split` tokens, then the rest with the cache
            l1, present = _run(session, cfg, ids[:, :split], pos[:, :split], empty_past(cfg))
            l2, _ = _run(session, cfg, ids[:, split:], pos[:, split:], present)
            cached = np.concatenate([l1, l2], axis=1)
            worst_cached = max(worst_cached, float(np.abs(cached - ref).max()))
            argmax_agree += int((cached.argmax(-1) == ref.argmax(-1)).sum())
            argmax_total += seq_len
    ok = worst_full <= atol and worst_cached <= atol
    return {"max_abs_diff_full": worst_full, "max_abs_diff_cached": worst_cached,
            "argmax_agreement": argmax_agree / argmax_total, "ok": ok}


def export(model_or_dir, out_path, quantize=True, fp16=True, do_verify=True):
    """Export `model_or_dir` (LlamaForCausalLM or a checkpoint directory) to `out_path`.

    Returns a dict with the written paths, sizes and verification results.
    """
    from transformers import LlamaForCausalLM
    if isinstance(model_or_dir, str):
        hf_model = LlamaForCausalLM.from_pretrained(model_or_dir, torch_dtype=torch.float32)
    else:
        hf_model = model_or_dir
    base, _ = os.path.splitext(out_path)
    result = {"params": count_params(hf_model), "files": {}}
    t0 = time.time()
    export_fp32(hf_model, out_path)
    result["files"]["fp32"] = {"path": out_path, "bytes": os.path.getsize(out_path)}
    result["export_seconds"] = round(time.time() - t0, 1)
    if do_verify:
        result["verify_fp32"] = verify(hf_model, out_path)
    if quantize:
        int8_path = base + ".int8.onnx"
        quantize_int8(out_path, int8_path)
        result["files"]["int8"] = {"path": int8_path, "bytes": os.path.getsize(int8_path)}
        if do_verify:
            # int8 is lossy: record the gap and the argmax agreement, only require it to run.
            r = verify(hf_model, int8_path, atol=float("inf"))
            result["verify_int8"] = r
    if fp16:
        fp16_path = base + ".fp16.onnx"
        convert_fp16(out_path, fp16_path)
        result["files"]["fp16"] = {"path": fp16_path, "bytes": os.path.getsize(fp16_path)}
        if do_verify:
            result["verify_fp16"] = verify(hf_model, fp16_path, atol=float("inf"))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", help="HF checkpoint directory (save_pretrained)")
    parser.add_argument("--size", choices=sorted(SIZES), help="export a random-weight model of this size")
    parser.add_argument("--all", action="store_true", help="random-weight xs, s and m into --out-dir")
    parser.add_argument("--out", help="output .onnx path (with --checkpoint or --size)")
    parser.add_argument("--out-dir", default=os.path.join(os.environ.get("PS_AC_DATA", r"D:\Projects\ps_autocomplete_data"),
                                                          "models", "spike"))
    parser.add_argument("--vocab-size", type=int, default=8192)
    parser.add_argument("--no-quantize", action="store_true")
    parser.add_argument("--no-fp16", action="store_true")
    parser.add_argument("--no-verify", action="store_true")
    args = parser.parse_args()

    jobs = []
    if args.all:
        for name in ["xs", "s", "m"]:
            jobs.append((build_model(name, vocab_size=args.vocab_size), os.path.join(args.out_dir, name + ".onnx")))
    elif args.size:
        jobs.append((build_model(args.size, vocab_size=args.vocab_size),
                     args.out or os.path.join(args.out_dir, args.size + ".onnx")))
    elif args.checkpoint:
        if not args.out:
            parser.error("--checkpoint needs --out")
        jobs.append((args.checkpoint, args.out))
    else:
        parser.error("give --all, --size or --checkpoint")

    results = {}
    for model_or_dir, out_path in jobs:
        print(f"exporting -> {out_path}", flush=True)
        r = export(model_or_dir, out_path, quantize=not args.no_quantize, fp16=not args.no_fp16,
                   do_verify=not args.no_verify)
        results[os.path.basename(out_path)] = r
        print(json.dumps(r, indent=2), flush=True)
    summary_path = os.path.join(os.path.dirname(os.path.abspath(jobs[0][1])), "export_summary.json")
    with open(summary_path, "w", encoding="utf8") as f:
        json.dump(results, f, indent=2)
    print(f"summary -> {summary_path}")
    failed = [k for k, r in results.items() if "verify_fp32" in r and not r["verify_fp32"]["ok"]]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
