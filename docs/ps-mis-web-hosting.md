# Build and host PuzzleScript+MIS on this PC

Run these commands from the PuzzleScript-labs repository root. For the packaged
desktop app and its faster web-only build, see `desktop/mis/README.md`.
The optional PowerShell helper below builds and serves the full PuzzleScript
release in the background, with a repeatable start/stop command.

## Start the existing release

In PowerShell:

```powershell
.\tools\ps-mis-web.ps1
```

Open <http://localhost:8080/mis.html>. The server runs in the background until
stopped or the PC restarts. It listens on this PC only. Games and sessions are
saved in the browser; use Save to download a portable game file.

## Rebuild after changing the application

```powershell
.\tools\ps-mis-web.ps1 -Stop
.\tools\ps-mis-web.ps1 -Build
```

For first setup, or after dependency changes, add `-Install`:

```powershell
.\tools\ps-mis-web.ps1 -Build -Install
```

This installs the locked npm dependencies, runs `node compile.js`, verifies the
release compression, and serves `bin`. The build replaces `bin`, increments
`.build/buildnumber.txt`, and refreshes `src/standalone_inlined.txt`. It may take
several minutes because it also optimizes the main PuzzleScript site's assets.
The committed WebAssembly solver is included; Emscripten is only needed when
rebuilding the native solver itself.

Choose another checkout or port with `-Source 'C:\path\to\PuzzleScript-labs'`
or `-Port 8082`. Use the same port when stopping. Logs and process identity are
stored under `.codex_tmp\ps-mis-web`.
The helper skips the Windows Store Python shortcut; override the interpreter
with `-Python 'C:\path\to\python.exe'` if needed.
It uses `tools\ps-mis-server.py`, which allows enough queued connections for
the page and its workers to load their scripts together on Windows.

## Direct commands without the helper

From the actual application checkout:

```powershell
npm ci --no-audit --no-fund
node compile.js
node verify-release-compression.js
python tools/ps-mis-server.py --port 8080 --directory bin
```

Keep that terminal open; Ctrl+C stops it. For the compact MIS web build, use
`make mis_web_bundle` followed by `make serve`. The full-site release target
remains `make mis_web`. For quick source development, serve `src` instead of
`bin`; no release build is required.

## Publishing online later

PS+MIS runs in the browser, including its workers and WebAssembly solver. The
deployable website is the **contents of `bin`**, retaining all subdirectories.
Use a static host with HTTPS and WebAssembly MIME support
(`application/wasm`); the application is at `/mis.html`. Its workers and demos
must remain on the same origin. Do not upload the repository or `node_modules`.
Only serve `.br` sidecars when the host sets `Content-Encoding: br`; ordinary
files work without precompression. Localhost hosting does not create an internet
URL, and the background helper does not start automatically after reboot.
