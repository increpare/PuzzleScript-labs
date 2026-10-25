# MIS95 desktop

MIS95, the Win95 mixed-initiative workbench in `src/mis.html`, packaged as a
GUI95 app. It is a redesign of Kevin De Keyser's PuzzleScript+MIS
(<https://dekeyser.ch/puzzlescriptmis/>).
It uses the same engine, Web Workers, native WebAssembly solver and CodeMirror
editor as the browser version. It runs offline, including its bundled demos.
The older openFrameworks application in `tools/puzzlescriptmis-app` is separate.

From the repository root, with Node 22.12 or newer and GNU Make:

```
make                 # web build, unpacked desktop app and GUI95 archive
make install         # build, then install for the current user
make serve           # build, then serve the web version (8000 or a free port)
make mis_app_start   # build, then launch the development desktop shell
make mis_web_bundle  # web build only, without Electron dependencies
make mis_app_tests   # native file and preference checks
node desktop/mis/smoke.cjs # packaged host check (after make; needs root npm deps)
make help            # existing engine, solver, hardware and web targets
```

Outputs: `build/mis-web/mis.html`, `release/mis/win-unpacked/mis95.exe`
on Windows, `release/mis/mac-arm64/MIS95.app` on macOS, and
`release/mis/linux-unpacked/mis95` on Linux. Archives go to
`gui95-dist/`. Electron dependencies are isolated in `desktop/mis/node_modules`;
the normal PuzzleScript npm dependencies are unchanged.

`make install` uses the shared GUI95 helper: a stable per-user app folder and
a Start menu, Dock or Linux applications-menu entry. A plain build creates no
launcher or file associations. PuzzleScript's common `.txt` extension is
deliberately not registered as a system default. Use Open, recent files, or pass
a `.txt`, `.ps` or `.puzzlescript` file to the executable. Subsequent file launches
reuse the existing window. The default macOS build is Apple silicon.

Desktop Open and Save use native dialogs and remember the last successful folder
across restarts. Save As uses the current filename. Recent games appear above
Exit in File; numeric keys reopen them while that menu is open. Unsaved changes
offer Save, Discard or Cancel before replacement or exit. Canceled and failed
saves keep the game dirty. Browser Save continues to download a text file.

The renderer has no Node access. Local app assets use a stable private origin,
so worker/wasm loading and recovery storage work without an HTTP server. User
games, recovery and preferences live outside the installed app. Automated checks
must set `MIS95_USER_DATA` to an isolated directory.

Artwork: `icon.svg` is an original GUI95-style workbench icon by Stephen Lavelle.
The shared `scripts/gui95-{app,icons}.mjs` helpers are copied unchanged from
`increpare/gui95` (MIT, Stephen Lavelle, 2026). Existing engine, CodeMirror and
asset notices travel with the web resources; see the repository LICENSE and
the source files for their respective terms.
