# Desktop scoring default promotion — 2026-11-13

The selected fair-admission / one-parent GPU BFS generator is now the ordinary
Windows desktop Automatic backend. Foreground native solving with optional GPU
witnesses remains the verified combined solver. The native seed and vanilla
AGAIN concordance repairs are included. Native fallback, bundled WASM and the
explicit JavaScript choice remain available.

This promotion uses the existing confirmation evidence: all 774 bases, six
families, three rotated trials, 10 seconds per family. Median coverage rises
529→573 (+8.3%); matched best difficulty +7.0%, shortlist mean +3.4% on 1,536
matched base/trial pairs. Every selected coverage trial beats every baseline
trial. These are whole-generation measurements, including assessment and
validation, with setup/warmup separate. They compare the earlier combined
7+2 FIFO/native-scoring pipeline with the selected combined pipeline. They
are not a new CPU-only comparison or a claim of universal GPU speedup.

The production integration replaces experiment-only generated/instrumented
helpers with a per-request native `deferBfs` option and explicit `bfsDeferred`
result. CPU primary/greedy/A* execute once; GPU completes only the omitted
ordered BFS lane. A completed score is the minimum completed lane count,
normalized to at least one. Older helpers that already ran BFS retain their
complete result. GPU failure completes native BFS with the original cap/budget.
Partial results canceled during scoring never enter the shortlist.

Fair admission reserves opportunities for uncovered bases while aging covered
improvements. Bounded discovery reuse keeps proof/budget provenance and feeds
unknown discovery back without pretending it is a CPU timeout. Full assessments
still reach private generator elites. Skipping those assessments merely because
the shared shortlist is full would remove useful parent feedback; that separate
optimization stays disabled. It does not disable the promoted speedups.

GPU discovery and scoring share one process/arena and the original 128-query
budget. Exact-scoring initialization is asynchronous, so foreground native
readiness never waits for GPU startup. All source, pinned compiler assets,
helpers and owned headless fixtures are app-local; no experiment-folder imports
or developer-machine paths are used by the installed backend.

Hardware: RTX 4080 SUPER / CUDA / driver 617.42; Ryzen 7800X3D, 64GiB RAM.
Selected GPU SHA-256:
`75456c484a53c35e14da859d6effd34603663d14d0e7265b66384bedc2ef22a1`.
Compiler authority: vanilla `5a94bde1a5127a3a45306ea28598eba2874d446d`.
The distribution manifest records full source and native-helper hashes.

Promotion validation: all 144 production composed-scoring fixtures pass against
native, plus six private gates, independently replayed exact BFS paths,
simultaneous guided discovery and forced failed-device native completion.
Every GPU result requires hardware receipts and zero CPU interpretation or
ordinary successor readback. Fair/cache/bound regressions, blocked-GPU startup,
native single-primary/deferred-BFS and ordinary player contracts pass.
The live two-owner pause/revision/cancellation test passes with production
classes. Required MIS core/file tests pass with isolated profiles.

See [evaluation and cumulative graph](2026-11-13-gpu-scoring-windows.md) and
[runnable headless checks](../../native/gpu/README.md). GPU scoring supports the
documented deterministic canonical subset; unsupported random/history/command
features retain native scoring. Source parsing remains CPU-side.

The normal Windows package and installed MIS95 pass real native/CUDA generation
checks, and the packaged CPU-only and missing-native/WASM fallbacks pass. The
original packaged host smoke passes. The portable CUDA source rebuild passes.
[Machine-readable promotion checks](assets/2026-11-13-gpu-scoring/promotion.json)
record actual installed scoring counts and device identity. These packaging
checks do not replace the earlier timed confirmation cohort.
