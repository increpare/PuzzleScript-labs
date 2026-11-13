# MIS GPU runtime and headless checks

The normal Windows desktop backend lives in `desktop/mis/backend/` and uses
the CUDA interpreter/search sources here. `cuda/production-service.cu` is the
single owner for guided discovery and exact ordered BFS. It keeps boards, RNG,
execution continuations, state keys and queues on the GPU; ordinary successors
are not read back for host interpretation. WGSL source and generated CUDA
interpreter inputs are retained with their generators. See the backend README
for supported features, capacities, fallback and pinned vanilla authority.

From the repository root, with the bundled desktop assets staged:

```powershell
node scripts/build-mis-backend.mjs
node native/gpu/tests/fair-test.cjs
node native/gpu/tests/discovery-test.cjs
node native/gpu/tests/bound-test.cjs
node native/gpu/tests/startup.cjs
node native/gpu/tests/seed.cjs
node native/gpu/tests/scoring.cjs
node native/gpu/tests/lifecycle.cjs
```

Scoring runs all 144 owned authored candidate fixtures (six games), compares
complete native/GPU assessment lanes, counts, primary paths and min difficulty,
checks private gates, independently replays GPU BFS paths, overlaps discovery,
and forces device failure to check native completion. Hardware CUDA receipts,
zero CPU interpreter invocations and zero ordinary-successor readback are
required. Software or missing hardware fails these GPU checks explicitly.
`samples=4` selects a quick 24-case scoring run. `out=ABSOLUTE_FRESH_DIRECTORY`
can select its artifact directory; existing outputs are never overwritten.

Lifecycle checks use two owners and typed job IDs, preserve unrelated private
generation/RNG state, replace revisions atomically, and drain cancellation.
Startup deliberately blocks GPU initialization while native assessment finishes.
Seed checks preserve the three historical random-game failures and compare all
native/WASM scoring lanes with original-engine replay. Bound checks describe
when whole-assessment pruning would be safe; that pruning is disabled in the
runtime because private parent feedback remains useful.

CUDA builds require MSVC and the CUDA toolkit; runtime packages require only
compatible NVIDIA hardware/drivers. For RTX 4080 SUPER, Developer PowerShell:

```powershell
cmake -S native/gpu -B build/mis-cuda -DCMAKE_CUDA_ARCHITECTURES=89
cmake --build build/mis-cuda --config Release
```

The distribution manifest separately identifies source inputs and the validated
prebuilt CUDA executable. A rebuild does not silently replace that selected
binary. Measurements and cumulative graphs are in `docs/benchmarks/`.
Browser/Electron UI checks remain in the separately owned external suite;
the original repository packaged smoke is also required for host changes.
