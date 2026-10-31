#!/usr/bin/env python3
"""Compare identical cached_again_tests harnesses against two runtime builds.

Each binary disables counters and times only the 100-turn workload, after two
warmups. Alternate process order to reduce warm-cache/thermal ordering bias.
"""
import argparse
import hashlib
from pathlib import Path
import json
import statistics
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("baseline")
parser.add_argument("candidate")
parser.add_argument("--pairs", type=int, default=9, choices=range(7, 14))
args = parser.parse_args()


def sample(binary):
    output = subprocess.check_output([binary, "--benchmark"], text=True)
    rows = [json.loads(line) for line in output.splitlines() if line.strip()]
    if any(not isinstance(row["checksum"], str) or not re.fullmatch(r"[0-9a-f]{16}", row["checksum"]) for row in rows):
        raise RuntimeError("Expected full-state FNV-1a 64-bit hexadecimal checksums")
    return {(r["fixture"], r["backend"], r["solver"]): r for r in rows}


samples = {"baseline": [], "candidate": []}
# Process-level warmup also covers loading/linking the executable and fixtures.
sample(args.baseline)
sample(args.candidate)
for pair in range(args.pairs):
    order = ("baseline", "candidate") if pair % 2 == 0 else ("candidate", "baseline")
    for label in order:
        samples[label].append(sample(getattr(args, label)))

results = []
for key in samples["baseline"][0]:
    rows = {label: [entry[key] for entry in values] for label, values in samples.items()}
    checksums = {row["checksum"] for values in rows.values() for row in values}
    if len(checksums) != 1:
        raise RuntimeError(f"Outcome checksum changed: {key}: {checksums}")
    medians = {label: statistics.median(row["ns"] / row["repetitions"] for row in values)
               for label, values in rows.items()}
    paired_ratios = [(samples["baseline"][i][key]["ns"] /
                      samples["candidate"][i][key]["ns"]) for i in range(args.pairs)]
    results.append({"fixture": key[0], "backend": key[1], "solver": key[2],
                    "tiles": 10000, "pairs": args.pairs,
                    "baseline_median_ns": medians["baseline"],
                    "candidate_median_ns": medians["candidate"],
                    "median_paired_speedup": statistics.median(paired_ratios),
                    "paired_speedup_min": min(paired_ratios),
                    "paired_speedup_max": max(paired_ratios)})
serializable_samples = {label: [list(entry.values()) for entry in values] for label, values in samples.items()}
provenance = {label: {"binary": str(Path(getattr(args, label)).resolve()),
                       "sha256": hashlib.sha256(Path(getattr(args, label)).read_bytes()).hexdigest()}
              for label in ("baseline", "candidate")}
provenance["checksum_algorithm"] = "fnv1a64-final-bytes-full-rng-turns"
provenance["test_source_sha256"] = hashlib.sha256(Path(__file__).with_name("cached_again_tests.cpp").read_bytes()).hexdigest()
print(json.dumps({"provenance": provenance, "results": results, "samples": serializable_samples}, indent=2))
