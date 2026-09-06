"""Export cumulative native solve curves from compare_native_solver_corpus.js.

Usage: python plot_native_solver_comparison.py BATTERY_DIR OUTPUT_PREFIX
The bands show the observed run range, not a confidence interval.
"""
import csv
import json
import pathlib
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

battery = pathlib.Path(sys.argv[1])
prefix = pathlib.Path(sys.argv[2])
manifest = json.loads((battery / "manifest.json").read_text())
limit = manifest["timeout_ms"]
pair_count = len(manifest["runs"]) // 2
assert pair_count and len(manifest["runs"]) == 2 * pair_count
times = np.arange(limit + 1)
curves = {}
levels = {}
rows = []
for side in ("before", "after"):
    curves[side] = []
    levels[side] = []
    for pair in range(1, pair_count + 1):
        data = json.loads((battery / f"{side}-{pair}.json").read_text())
        playable = [r for r in data["results"] if r["status"] != "skipped_message"]
        by_key = {(r["game"], r["level"]): r for r in playable}
        assert len(by_key) == len(playable)
        levels[side].append(by_key)
        solved = sorted(r["elapsed_ms"] for r in playable if r["status"] == "solved")
        # searchsorted(left) counts strictly less than the requested threshold.
        curves[side].append(np.searchsorted(solved, times, side="left"))
        rows.extend({"side": side, "pair": pair, **{k: r[k] for k in ("game", "level", "status", "elapsed_ms", "expanded")}} for r in playable)
    curves[side] = np.asarray(curves[side])
reference = set(levels["before"][0])
assert all(set(run) == reference for runs in levels.values() for run in runs)
prefix.parent.mkdir(parents=True, exist_ok=True)
with prefix.with_suffix(".csv").open("w", newline="", encoding="utf-8") as stream:
    writer = csv.DictWriter(stream, fieldnames=["side", "pair", "game", "level", "status", "elapsed_ms", "expanded"])
    writer.writeheader()
    writer.writerows(rows)

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False, "axes.spines.right": False})
fig, (ax, delta) = plt.subplots(2, 1, figsize=(10.5, 7.4), sharex=True,
                               gridspec_kw={"height_ratios": [3.3, 1], "hspace": .12})
fig.patch.set_facecolor("#f8fafc")
for panel in (ax, delta):
    panel.set_facecolor("#f8fafc")
    panel.grid(axis="y", color="#dce2e8", linewidth=.7)
    panel.set_axisbelow(True)
styles = [("before", "#c8792e", "Before · pre-day baseline", "--"),
          ("after", "#087f8c", "After · borrowed rule matches", "-")]
medians = {}
for side, color, label, linestyle in styles:
    values = curves[side]
    medians[side] = np.median(values, axis=0)
    ax.fill_between(times, values.min(axis=0), values.max(axis=0), color=color, alpha=.13, step="post")
    ax.step(times, medians[side], where="post", color=color, linewidth=2.2, linestyle=linestyle,
            label=f"{label} ({int(medians[side][-1])})")
ax.set_ylim(bottom=0)
ax.set_xlim(0, limit)
ax.set_ylabel("Levels solved in less than X ms")
ax.legend(loc="lower right", frameon=False)
paired_delta = curves["after"] - curves["before"]
delta.fill_between(times, paired_delta.min(axis=0), paired_delta.max(axis=0), color="#087f8c", alpha=.13, step="post")
delta.step(times, medians["after"] - medians["before"], where="post", color="#087f8c", linewidth=1.7)
delta.axhline(0, color="#5c6670", linewidth=.8)
delta.set_ylabel("After − before")
delta.set_xlabel("Recorded solve time X (ms)")
fig.suptitle(f"Native solver: {limit} ms per level", x=.105, y=.97, ha="left", fontsize=20, fontweight="bold", color="#142838")
fig.text(.105, .92, f"{len(reference):,} levels · {pair_count} alternating pairs · C++ interpreter / portfolio", color="#526373")
fig.text(.105, .025, "Lines: medians. Shading: observed run ranges, not confidence intervals.\nSmaller thresholds summarize these runs; they are not separate search budgets.", fontsize=9, color="#526373")
fig.subplots_adjust(left=.105, right=.97, top=.87, bottom=.14)
for extension in ("png", "svg"):
    fig.savefig(prefix.with_suffix("." + extension), dpi=180, facecolor=fig.get_facecolor())
summary = {
    "pairs": [{"before": int(curves["before"][i, -1]), "after": int(curves["after"][i, -1])} for i in range(pair_count)],
    "threshold_medians": {str(t): {side: int(np.median(curves[side][:, t])) for side in curves} for t in (10, 50, 100, limit) if t <= limit},
    "stable_gains": [], "stable_losses": [],
}
for key in sorted(reference):
    def passes(side):
        return [run[key]["status"] == "solved" and run[key]["elapsed_ms"] < limit for run in levels[side]]
    before, after = passes("before"), passes("after")
    if not any(before) and all(after):
        summary["stable_gains"].append(key)
    if all(before) and not any(after):
        summary["stable_losses"].append(key)
prefix.with_suffix(".json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=2))
