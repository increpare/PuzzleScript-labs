"""BPE tokenizer for PuzzleScript source (handoff 5.1).

- `tokenizers` byte-level BPE (every byte is in the alphabet, so nothing is unknown).
- Pre-tokeniser: newline is its own token; each of `[ ] | -> , ( )` and every run of `=`
  is isolated (optionally carrying one leading space, like words do, so `[ > Player | Crate ]`
  is 7 tokens instead of 11); everything else is split into space-prefixed words (GPT-2
  style, so decoding reproduces the text exactly). Structural tokens can never merge with
  an identifier because BPE merges only inside a pre-token.
- Context-builder markers (pipeline/context.js) are added special tokens with fixed ids:
  <EOS>=0, <SYM>=1, <PRE>=2, <SUF>=3, <MID>=4, <PAD>=5.
- Trained on the `text` field of the sample JSONL (levels already trimmed), not raw files.

    python autocomplete/train/tokenizer.py [--samples train.jsonl ...] [--out tokenizer.json]
        [--vocab-size 8192] [--max-rows N]

Defaults: <PS_AC_DATA>/samples/train.jsonl -> <PS_AC_DATA>/tokenizer/tokenizer.json.
Prints a small report (vocab, structural-token assertion, tokens per rule line).
"""

import argparse
import json
import os
import statistics
import sys

from tokenizers import Regex, Tokenizer, decoders, models, pre_tokenizers, trainers

# Windows consoles default to cp1252; the exporter and the report print non-ASCII.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SPECIAL_TOKENS = ["<EOS>", "<SYM>", "<PRE>", "<SUF>", "<MID>", "<PAD>"]

# Structural pieces, isolated before BPE. `->` must come before single chars; `=+` keeps
# section separators (`=========`) as one token each.
STRUCTURAL_PATTERN = r" ?(?:->|=+|[\[\]|,()])"
STRUCTURAL_CHARS = set("[]|,()=")
NEWLINE_BYTE_TOKEN = "Ċ"  # byte-level alphabet symbol for "\n"

DEFAULT_DATA_DIR = r"D:\Projects\ps_autocomplete_data"


def data_dir():
    return os.environ.get("PS_AC_DATA", DEFAULT_DATA_DIR)


def build_pre_tokenizer():
    return pre_tokenizers.Sequence([
        pre_tokenizers.Split(Regex(r"\n"), behavior="isolated"),
        pre_tokenizers.Split(Regex(STRUCTURAL_PATTERN), behavior="isolated"),
        # Words carry their leading space; runs of spaces stand alone; tabs stay as-is.
        pre_tokenizers.Split(Regex(r" ?\S+| +"), behavior="isolated"),
        pre_tokenizers.ByteLevel(add_prefix_space=False, use_regex=False),
    ])


def new_tokenizer():
    tok = Tokenizer(models.BPE(unk_token=None, fuse_unk=False))
    tok.pre_tokenizer = build_pre_tokenizer()
    tok.decoder = decoders.ByteLevel()
    return tok


def iter_sample_text(paths, max_rows=None):
    """Yield the `text` of each sample row with the marker strings removed."""
    n = 0
    for path in paths:
        with open(path, "r", encoding="utf8") as f:
            for line in f:
                if not line.strip():
                    continue
                text = json.loads(line)["text"]
                for marker in SPECIAL_TOKENS:
                    text = text.replace(marker, "")
                yield text
                n += 1
                if max_rows is not None and n >= max_rows:
                    return


def _byte_decode(tok, token):
    return tok.decoder.decode([token])


def check_structural_isolation(tok):
    """Raise if any vocab token mixes a structural char or newline with other text."""
    bad = []
    for token, tid in tok.get_vocab().items():
        if token in SPECIAL_TOKENS:
            continue
        text = _byte_decode(tok, token)
        if text == "":
            continue
        has_struct = any(c in STRUCTURAL_CHARS for c in text)
        core = text[1:] if text.startswith(" ") else text
        if has_struct and not (core == "->" or set(core) == {"="} or core in STRUCTURAL_CHARS):
            bad.append(text)
        if "\n" in text and text != "\n":
            bad.append(text)
    if bad:
        raise AssertionError(f"{len(bad)} vocab tokens merge structure with neighbours, e.g. {bad[:10]!r}")


def train_tokenizer(sample_jsonl_paths, out_path, vocab_size=8192, max_rows=None):
    """Train the BPE tokenizer on sample text and write `out_path` (tokenizers JSON)."""
    if isinstance(sample_jsonl_paths, str):
        sample_jsonl_paths = [sample_jsonl_paths]
    tok = new_tokenizer()
    trainer = trainers.BpeTrainer(
        vocab_size=vocab_size,
        min_frequency=2,
        special_tokens=SPECIAL_TOKENS,
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
        show_progress=False,
    )
    tok.train_from_iterator(iter_sample_text(sample_jsonl_paths, max_rows), trainer=trainer)
    for i, s in enumerate(SPECIAL_TOKENS):
        assert tok.token_to_id(s) == i, (s, tok.token_to_id(s))
    assert tok.token_to_id(NEWLINE_BYTE_TOKEN) is not None, "newline token missing"
    check_structural_isolation(tok)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    tok.save(out_path)
    return tok


def load_tokenizer(path):
    return Tokenizer.from_file(path)


def dump_fixture(tok, sample_paths, out_path, max_rows=40, max_lines=400):
    """Write {cases: [{text, ids}]} for the browser tokenizer check (spike/index.html)."""
    cases = []
    lines_seen = 0
    for text in iter_sample_text(sample_paths, max_rows):
        cases.append({"text": text[:3000], "ids": tok.encode(text[:3000]).ids})
        for line in text.split("\n"):
            if lines_seen >= max_lines:
                break
            if line.strip():
                cases.append({"text": line + "\n", "ids": tok.encode(line + "\n").ids})
                lines_seen += 1
    markers = "<SYM>legend\n<PRE>[ > Player | Crate ] -> [ > Player > Crate ]\n<SUF>\n<MID>"
    cases.append({"text": markers, "ids": tok.encode(markers).ids})
    with open(out_path, "w", encoding="utf8") as f:
        json.dump({"cases": cases}, f)
    return len(cases)


def report(tok, sample_paths, max_rows=300):
    """Round-trip check and tokens-per-line stats over a few sample rows."""
    rule_line_tokens, all_line_tokens, chars, tokens = [], [], 0, 0
    for text in iter_sample_text(sample_paths, max_rows):
        enc = tok.encode(text)
        assert tok.decode(enc.ids) == text, "round trip failed"
        chars += len(text)
        tokens += len(enc.ids)
        for line in text.split("\n"):
            if not line.strip():
                continue
            n = len(tok.encode(line).ids)
            all_line_tokens.append(n)
            if "->" in line and "[" in line:
                rule_line_tokens.append(n)
    return {
        "vocab_size": tok.get_vocab_size(),
        "chars_per_token": round(chars / max(tokens, 1), 2),
        "median_tokens_per_line": statistics.median(all_line_tokens) if all_line_tokens else None,
        "median_tokens_per_rule_line": statistics.median(rule_line_tokens) if rule_line_tokens else None,
        "p90_tokens_per_rule_line": (sorted(rule_line_tokens)[int(0.9 * len(rule_line_tokens))]
                                     if rule_line_tokens else None),
        "rule_lines": len(rule_line_tokens),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--samples", nargs="*", default=[os.path.join(data_dir(), "samples", "train.jsonl")])
    parser.add_argument("--out", default=os.path.join(data_dir(), "tokenizer", "tokenizer.json"))
    parser.add_argument("--vocab-size", type=int, default=8192)
    parser.add_argument("--max-rows", type=int, default=None, help="train on the first N rows only")
    parser.add_argument("--report-samples", default=None,
                        help="JSONL for the report (default: the val split next to the first --samples file)")
    parser.add_argument("--fixture", default=None,
                        help="also write a browser round-trip fixture JSON here (default: fixture.json next to --out)")
    args = parser.parse_args()

    tok = train_tokenizer(args.samples, args.out, args.vocab_size, args.max_rows)
    print(f"wrote {args.out}")
    report_path = args.report_samples or os.path.join(os.path.dirname(args.samples[0]), "val.jsonl")
    if os.path.exists(report_path):
        print(json.dumps(report(tok, [report_path]), indent=2))
        fixture_path = args.fixture or os.path.join(os.path.dirname(args.out), "fixture.json")
        print(f"fixture: {dump_fixture(tok, [report_path], fixture_path)} cases -> {fixture_path}")
    demo = "[ > Player | Crate ] -> [ > Player > Crate ]\n"
    enc = tok.encode(demo)
    print("demo:", json.dumps([tok.decode([i]) for i in enc.ids]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
