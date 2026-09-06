"""Plot actual solve times and observed run-to-run ranges from compare_solver_corpus.js.

Usage: python plot_solver_corpus.py RUN_DIRECTORY OUTPUT_PREFIX
Requires matplotlib and numpy. The bands are observed ranges, not confidence intervals.
"""
import csv
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np

run_dir, prefix = Path(sys.argv[1]), Path(sys.argv[2])
manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
cap = manifest["timeout_ms"]
assert len(manifest["runs"]) == manifest["pairs"] * 4, "Incomplete battery"
prefix.parent.mkdir(parents=True, exist_ok=True)
data = {}
for engine in ["native", "js"]:
    data[engine] = {}
    for side in ["before", "after"]:
        runs = sorted([r for r in manifest["runs"] if r["engine"] == engine and r["side"] == side], key=lambda r: r["pair"])
        assert len(runs) == manifest["pairs"]
        data[engine][side] = [json.loads((run_dir / (r["label"] + ".json")).read_text(encoding="utf-8"))["results"] for r in runs]

times = {}
for engine in data:
    times[engine] = {side: [np.sort([r["elapsed_ms"] for r in run if r["status"] == "solved"]) for run in runs] for side, runs in data[engine].items()}
# Every recorded event plus integer ticks; no interpolated solve counts.
xs = np.unique(np.concatenate([np.arange(cap + 1), *[a[(a >= 0) & (a <= cap)] for e in times.values() for runs in e.values() for a in runs]]))
curves = {engine: {side: np.array([np.searchsorted(t, xs, side="left") for t in runs]) for side, runs in groups.items()} for engine, groups in times.items()}

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11,
    "axes.labelcolor": "#475569", "text.color": "#142536", "xtick.color": "#64748b",
    "ytick.color": "#64748b", "axes.edgecolor": "#cbd5e1", "svg.fonttype": "none"})
fig = plt.figure(figsize=(14, 9.2), facecolor="#f6f8fb")
grid = fig.add_gridspec(2, 2, height_ratios=[3.5, 1], left=.075, right=.97, bottom=.16, top=.77, hspace=.35, wspace=.14)
before, after = "#cc792d", "#087f8c"
fig.text(.075, .945, "A day of solver work, measured", fontsize=24, weight="bold")
fig.text(.075, .907, f"Cumulative levels solved in <X ms  ·  {manifest['pairs']} serial before/after pairs  ·  {cap} ms search budget", fontsize=12, color="#526477")
fig.legend(handles=[Line2D([0],[0],color=before,lw=2.5,ls="--",label="Before today"),Line2D([0],[0],color=after,lw=2.5,label="After today's changes")],loc="upper left",bbox_to_anchor=(.07,.89),frameon=False,ncol=2,fontsize=12)
names = {"native": "Native C++", "js": "JavaScript"}
strategies = {"native": "Portfolio · interpreter", "js": "Weighted A*"}
summary = {}
delta_limit = max(5, int(np.ceil(max(np.max(np.abs(v["after"]-v["before"])) for v in curves.values()) / 5) * 5))
denominators = {e: {r["playable"] for r in manifest["runs"] if r["engine"] == e} for e in data}
for e in denominators: assert len(denominators[e]) == 1
ymax = int(np.ceil(max(c.max() for v in curves.values() for c in v.values()) / 200)*200)
for column, engine in enumerate(["native", "js"]):
    ax = fig.add_subplot(grid[0, column], facecolor="white")
    endpoints = {side: c[:, -1] for side, c in curves[engine].items()}
    med = {side: int(np.median(counts)) for side, counts in endpoints.items()}
    delta = med["after"] - med["before"]
    ax.set_title(f"{names[engine]}  |  {strategies[engine]}", loc="left", pad=40, fontsize=13, weight="bold")
    ax.text(0, 1.045, f"Median: {med['before']:,} → {med['after']:,} below {cap} ms", transform=ax.transAxes, fontsize=14, weight="bold")
    ax.text(1, 1.045, f"{delta:+d}", transform=ax.transAxes, ha="right", fontsize=16, weight="bold", color=after if delta>=0 else before)
    for side, color, style in [("before", before, "--"), ("after", after, "-")]:
        c = curves[engine][side]
        ax.fill_between(xs, c.min(axis=0), c.max(axis=0), step="pre", color=color, alpha=.14, linewidth=0)
        ax.step(xs, np.median(c, axis=0), where="pre", color=color, ls=style, lw=2.2)
    ax.set(xlim=(0, cap), ylim=(0, ymax), xticks=np.linspace(0, cap, 6), yticks=np.arange(0,ymax+1,200))
    ax.grid(axis="y", color="#e7edf3", lw=.8)
    ax.spines[["top","right"]].set_visible(False)
    if column == 0: ax.set_ylabel("Levels solved")
    else: ax.tick_params(labelleft=False)
    ax.text(.96, .07, f"{next(iter(denominators[engine])):,} playable levels\nMedian lines · observed run ranges", transform=ax.transAxes,ha="right",color="#64748b",fontsize=10,linespacing=1.6)

    dax = fig.add_subplot(grid[1,column], facecolor="white")
    paired_delta = curves[engine]["after"] - curves[engine]["before"]
    dax.axhline(0,color="#94a3b8",lw=.8)
    dax.fill_between(xs,paired_delta.min(axis=0),paired_delta.max(axis=0),step="pre",color=after,alpha=.14,lw=0)
    # Difference of the displayed median curves, so the endpoint agrees with
    # the headline count difference; the band retains observed paired deltas.
    dax.step(xs,np.median(curves[engine]["after"],axis=0)-np.median(curves[engine]["before"],axis=0),where="pre",color=after,lw=1.6)
    dax.set(xlim=(0,cap),ylim=(-delta_limit,delta_limit),xticks=np.linspace(0,cap,6),xlabel="Recorded solve time threshold X (ms)")
    dax.spines[["top","right"]].set_visible(False)
    dax.set_title("Change in median curves · after minus before",loc="left",fontsize=10,color="#64748b",pad=8)
    if column==0: dax.set_ylabel("Δ levels")
    else: dax.tick_params(labelleft=False)
    summary[engine] = {"playable":next(iter(denominators[engine])), "strict_counts":{s:v.tolist() for s,v in endpoints.items()}, "median_strict":med, "delta_of_medians":delta, "paired_deltas":paired_delta[:,-1].tolist()}

fig.text(.075,.086,f"Bands show observed ranges across {manifest['pairs']} runs (paired differences below), not confidence intervals. Counts require elapsed_ms < X.",fontsize=10,color="#64748b")
fig.text(.075,.058,f"Compilation is excluded from per-level solve times. Curves describe the measured {cap} ms runs; timings are specific to this machine.",fontsize=10,color="#64748b")
fig.savefig(str(prefix)+".png",dpi=170,facecolor=fig.get_facecolor())
fig.savefig(str(prefix)+".svg",facecolor=fig.get_facecolor())
svg_path = Path(str(prefix)+".svg")
svg_path.write_text("\n".join(line.rstrip() for line in svg_path.read_text(encoding="utf-8").splitlines())+"\n",encoding="utf-8")
fig.savefig(str(prefix)+".pdf",facecolor=fig.get_facecolor())
plt.close(fig)
with open(str(prefix)+".csv","w",newline="",encoding="utf-8") as f:
    writer=csv.writer(f)
    writer.writerow(["engine","side","threshold_ms","median_solved","min_solved","max_solved"])
    for engine,groups in curves.items():
        for side,c in groups.items():
            for i,x in enumerate(xs): writer.writerow([engine,side,float(x),int(np.median(c[:,i])),int(c[:,i].min()),int(c[:,i].max())])
Path(str(prefix)+"-summary.json").write_text(json.dumps(summary,indent=2)+"\n",encoding="utf-8")
print(json.dumps(summary,indent=2))
