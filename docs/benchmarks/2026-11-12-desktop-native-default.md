# Desktop Automatic native/CUDA default — 2026-11-12

The normal MIS95 desktop source, build and installed Windows app now use
Automatic: native C++ immediately, with asynchronous CUDA assistance. This is
the normal application identity and Start menu launcher, rather than the
separate GPU preview. Existing preferences/recovery were not used by tests.

Installed executable:
`C:\Users\Anwender\AppData\Local\Programs\GUI95\MIS95\mis95.exe`.
The existing GUI95 installer created/updated the Start menu entry. Its shared
delivery scripts were not changed. No file associations were added.

## Integration

- `desktop/mis/main.cjs` and `preload.cjs`: bounded backend operations behind
  existing origin checks/context isolation, asynchronous startup and shutdown.
- `src/js/mis/mis_desktop_worker.js`: desktop Worker protocol adapter; browser
  Workers retain fallback operations, rule goals and JavaScript selection.
- `src/js/mis/mis_app.js`: native transport and validated provisional witnesses;
  unfinished difficulty is not cached as a completed score.
- `desktop/mis/backend/`: promoted host modules, checked Windows helpers and
  distribution manifest. Normal native checks execute the original-source
  interpreter locally. Direct GPU witnesses retain original JS checks.
- `scripts/build-mis-backend.mjs` is called by the normal desktop build. It
  checks helper/native-source identity and stages app-local engine/compiler
  assets. No experimental checkout or network service is required at runtime.
- `native/src/desktop/mis_worker.cpp` and `puzzlescript_mis_worker`: reproducible
  native C API helper target. The target requires the 32-bit mask configuration.
- `native/gpu/`: CUDA source closure plus WGSL inputs/translators and a standalone
  CMake target. Source snapshot and selected binary are separately recorded;
  no bit-identical CUDA source rebuild is claimed by this promotion.

The package is unpacked so helper executables, Node Workers and compiler assets
are real local files. Browser builds keep their existing WASM/JS execution.
Missing CUDA retains native CPU execution; missing native helpers retain WASM.
JavaScript remains selectable. Windows x64 is the validated native distribution;
other platforms currently use WASM until a native build is validated there.

Generation defaults: seven protected CPU producers, two CPU scorers for CUDA
discoveries, 512 private GPU generator contexts and 128 active GPU requests.
CPU-only mode uses eight producers. GPU failure/unknown is never an unsolvability
proof, and GPU work counts never replace the MIS difficulty score.

The selected helper hashes are unchanged from the verified scoring comparison:

- Native: `9a1f1d941e8898d754d624da34d22e20a6486225b54c4676fcb5321d6c6dbdc9`.
- CUDA: `23b1fccf1fc79f7721450e86f73f2348554833c25e505d1a3676c34ccfd5ee1d`.
- Vanilla authority: `5a94bde1a5127a3a45306ea28598eba2874d446d`.

## Evidence

`make desktop` completed through the normal web/backend build, Electron packager
and GUI95 archive. The normal GUI95 installer then installed that verified build.
The native CMake target compiled successfully against the corrected runtime;
its newly built executable passed all 44 native/WASM status/path/work/effort
comparison cases. The shipped helper remains the exact benchmarked binary.

Required `make mis_app_tests mis_tests` passed in an owned source snapshot.
The original packaged desktop smoke passed against an owned relocated copy of
the normal package: offline solving, minimized generation, save/cancel/failure,
unsaved open, recent files after restart, single-window launch and menu focus.

Real UI checks against the normal package passed native solving, hardware CUDA
generation, CPU-scored output, Stop/drain, two-level generation with pause/edit
isolation, CUDA-disabled native operation and missing-native WASM fallback.
The installed copy separately passed native/CUDA generation/Stop and real
Automatic → JavaScript → native switching, including native-worker draining.
All tests used isolated profiles and owned fixtures/dependencies. Screenshots,
traces, exact source copies and hashes are retained in the private suite.

No new timing claim is made by the packaging change. The selected configuration's
774-base generation comparison used five seconds/family and three rotated
trials: median coverage 381 versus 321 for the previous hybrid and 284 for nine
CPU producers. Best difficulty on matched bases improved 1.201x and 1.206x,
respectively. All 82,038 winning claims across allocation/retry cohorts passed
independent post-run JS checking. These are generation coverage/quality results,
not a claim of equal speedup for every individual solve.

Hardware: RTX 4080 SUPER / CUDA / driver 617.42, Ryzen 7800X3D, Windows x64.
The private evidence is under the GPU workspace's
`gpu/mis/out/desktop-promotion-r1` and `gpu/tests/mis-desktop/out/{promoted-*,installed-*}`.
The required suite and relocated original smoke are in
`gpu/tests/mis-desktop/promotion-acceptance-r1`.

## Commands

From this repository, normal build/install commands now include the backend:

```powershell
make desktop
make install
```

For native source rebuilding, use Developer PowerShell:

```powershell
cmake -S . -B build/mis-native -DPS_MASK_WORD_BITS=32 -DPS_ENABLE_LTO=OFF -DPS_ENABLE_MARCH_NATIVE=OFF
cmake --build build/mis-native --config Release --target puzzlescript_mis_worker
```

The native distribution manifest deliberately rejects stale source/binary pairs.
Rebuilt helpers require validation before updating the shipped distribution;
`MIS95_NATIVE_EXE` can select a rebuilt CPU helper for isolated checks. See
`desktop/mis/backend/README.md` for distribution/fallback details.

All existing uncommitted concordance changes were preserved. Original files were
backed up before promotion. No commit or push was made; no GUI95 trailer was
added because no commit was created. No test applications/services remain running.
