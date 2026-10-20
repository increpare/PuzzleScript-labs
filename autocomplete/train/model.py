"""Llama-style decoder configs for the PuzzleScript autocomplete model (handoff 5.2).

RMSNorm, RoPE, SwiGLU, tied embeddings, via transformers' LlamaForCausalLM so the ONNX
export with a KV cache (export_onnx.py) stays simple.

    from model import SIZES, build_config, build_model
    model = build_model("s", vocab_size=8192)

CLI: `python model.py` prints the parameter count of every size.
"""

import argparse

import torch
from transformers import LlamaConfig, LlamaForCausalLM


def _swiglu_width(hidden_size, multiple_of=64):
    # Llama's 8/3 * d, rounded up to a multiple of 64.
    width = int(hidden_size * 8 / 3)
    return ((width + multiple_of - 1) // multiple_of) * multiple_of


# name -> architecture. Keep in step with the table in handoff 5.2.
SIZES = {
    "xs": dict(hidden_size=256, num_hidden_layers=6, num_attention_heads=4, intermediate_size=_swiglu_width(256)),
    "s": dict(hidden_size=384, num_hidden_layers=8, num_attention_heads=6, intermediate_size=_swiglu_width(384)),
    "m": dict(hidden_size=512, num_hidden_layers=8, num_attention_heads=8, intermediate_size=_swiglu_width(512)),
}

# Token ids follow tokenizer.SPECIAL_TOKENS: <EOS>=0, <SYM>=1, <PRE>=2, <SUF>=3, <MID>=4, <PAD>=5.
EOS_ID = 0
PAD_ID = 5

DEFAULT_VOCAB_SIZE = 8192
DEFAULT_CONTEXT = 2048


def build_config(name, vocab_size=DEFAULT_VOCAB_SIZE, max_position_embeddings=DEFAULT_CONTEXT):
    if name not in SIZES:
        raise KeyError(f"unknown size {name!r}; expected one of {sorted(SIZES)}")
    arch = SIZES[name]
    return LlamaConfig(
        vocab_size=vocab_size,
        hidden_size=arch["hidden_size"],
        intermediate_size=arch["intermediate_size"],
        num_hidden_layers=arch["num_hidden_layers"],
        num_attention_heads=arch["num_attention_heads"],
        num_key_value_heads=arch["num_attention_heads"],
        max_position_embeddings=max_position_embeddings,
        rms_norm_eps=1e-5,
        rope_theta=10000.0,
        hidden_act="silu",
        tie_word_embeddings=True,
        attention_bias=False,
        mlp_bias=False,
        bos_token_id=EOS_ID,
        eos_token_id=EOS_ID,
        pad_token_id=PAD_ID,
        use_cache=True,
    )


def build_model(name, vocab_size=DEFAULT_VOCAB_SIZE, max_position_embeddings=DEFAULT_CONTEXT, seed=0):
    """Randomly initialised LlamaForCausalLM for the given size (fp32, on CPU)."""
    torch.manual_seed(seed)
    config = build_config(name, vocab_size, max_position_embeddings)
    model = LlamaForCausalLM(config)
    model.tie_weights()
    return model


def count_params(model):
    return sum(p.numel() for p in model.parameters())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--vocab-size", type=int, default=DEFAULT_VOCAB_SIZE)
    parser.add_argument("sizes", nargs="*", default=list(SIZES))
    args = parser.parse_args()
    print("| size | d_model | layers | heads | ffn | params |")
    print("|---|---|---|---|---|---|")
    for name in args.sizes:
        model = build_model(name, vocab_size=args.vocab_size)
        arch = SIZES[name]
        print(f"| {name} | {arch['hidden_size']} | {arch['num_hidden_layers']} | {arch['num_attention_heads']} | "
              f"{arch['intermediate_size']} | {count_params(model) / 1e6:.1f}M |")


if __name__ == "__main__":
    main()
