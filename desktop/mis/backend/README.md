# Desktop native and CUDA backend

Automatic is the normal desktop default. Native C++ starts immediately and CUDA
helps both foreground solving and generation. The selected generator uses seven
CPU producers, two native scorers, fair admission across bases, bounded discovery
reuse, and exact GPU BFS scoring for supported deterministic games. Discovery and
scoring share one GPU process, a 6GiB arena, 2GiB key budget, eight shape pools and
128 admitted queries. CPU-only mode uses eight producers.

The 774-base, three-trial confirmation improved median coverage from 529 to 573
(8.3%), best difficulty on matched bases by 7.0%, and shortlist mean by 3.4%.
The selected one-parent scoring kernel preserves native ordering/counts. Wider
scoring kernels did not establish a better whole-generator result and are not
selected. See [measurements](../../../docs/benchmarks/2026-11-13-gpu-scoring-windows.md)
and [promotion checks](../../../docs/benchmarks/2026-11-13-desktop-scoring-default.md).

The CPU assesses primary/greedy/A* once, then releases its worker while GPU BFS
runs. Only completed scoring lanes contribute to the minimum MIS difficulty.
Missing hardware, unsupported features, capacity failure and device errors keep
or complete native scoring. GPU unknowns never prove unsolvability. The normal
native helper explicitly reports `bfsDeferred`; older helpers that finish BFS
retain their already-complete native score. Partial scores are never published
as complete. Full candidate feedback still reaches each private generator so it
can improve its future parents, even when a candidate misses the shared shortlist.

Scoring supports deterministic canonical games with properties, ellipses, rigid
rules, loops, AGAIN and startup rules, within 512 cells/four object words/16 win
conditions. Random behavior and cancel/restart/checkpoint/message/audio commands
use native scoring. Parsing remains CPU-side. Capacities and interpreter fuel are
checked; stopped work is unknown and uses explicit continuations or fallback.

CUDA startup does not delay foreground CPU admission. Native winners use a local
ordinary original-source check; empty/long paths or rejected checks use JS. A
foreground GPU witness still receives original-source validation. Missing native
helpers use bundled WASM; JavaScript stays selectable. Browser/non-Windows builds
retain their existing WASM path. Windows x64 / RTX 4080 SUPER is the validated
distribution. Existing explicit JavaScript preferences remain respected.

`make desktop` checks the shipped helper hashes and native/GPU source identities,
then stages assets from this checkout. The unpacked package contains real local
helper/Worker/compiler files. No experiment checkout, Node installation, CUDA
toolkit or network is needed at runtime; NVIDIA drivers remain a system dependency.
The GPU compiler authority is versioned under `authority/`, pinned to vanilla
`5a94bde1a5127a3a45306ea28598eba2874d446d`, independently of the advancing root
TypeScript reference.

The Windows helpers and VC runtime in `prebuilt/win32-x64` are versioned assets,
like WASM. `prebuilt/manifest.json` records exact binaries and source hashes.
Rebuild in Developer PowerShell:

```powershell
cmake -S . -B build/mis-native -DPS_MASK_WORD_BITS=32 -DPS_ENABLE_LTO=OFF -DPS_ENABLE_MARCH_NATIVE=OFF
cmake --build build/mis-native --config Release --target puzzlescript_mis_worker
cmake -S native/gpu -B build/mis-cuda -DCMAKE_CUDA_ARCHITECTURES=89
cmake --build build/mis-cuda --config Release
```

`native/src/desktop/mis_worker.cpp` implements the MIS C API protocol. GPU source,
WGSL inputs/generators and headless tests are in `native/gpu/`. The selected CUDA
binary is pinned by the host SHA check. Source and binary identities are recorded
separately; no bit-identical rebuild is claimed. Revalidate changed helpers before
updating distribution hashes. [Headless test commands](../../../native/gpu/README.md).

`make install` builds and updates the stable per-user GUI95 launcher. User games,
preferences and recovery live outside the installed app. For diagnosis:
`MIS95_DISABLE_CUDA=1` uses native CPU; `MIS95_DISABLE_NATIVE=1` uses WASM;
`MIS95_NATIVE_EXE` chooses a rebuilt helper. Tests must isolate both
`MIS95_USER_DATA` and `PUZZLESCRIPT_MIS_USER_DATA`.
