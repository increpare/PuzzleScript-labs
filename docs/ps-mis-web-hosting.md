# Build and host MIS95 on this PC

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

## Publishing MIS95

MIS95 is published at <https://www.puzzlescript.net/mis95/>.
`/mis95/mis.html` is also supported. Both entry points open the same application.

From the maintainer's checkout, with the existing host's SSH access:

```sh
make mis_publish
```

This builds the compact `build/mis-web/` bundle, tests both entry points under
a nested URL in Chrome, and uploads only that bundle to puzzlescript.net's
`mis95/` directory. It then runs the same checks against the public URL, including
the native WebAssembly solver, generation and every bundled demo. The browser
checks require the root npm dependencies and an installed Google Chrome.
Replaced and obsolete files are backed up outside the web root under
`/home/locus/backups/mis95/<timestamp>/`. Obsolete files are removed
from the public `mis95/` directory so stale HTML or compressed sidecars cannot hide
the current build. The rest of puzzlescript.net is unaffected (its own upload,
`upload_website.sh` in the PuzzleScript repo, does not use `--delete`, so it
leaves `mis95/` alone).

For another static host, upload the **contents of `build/mis-web/`**, retaining
all subdirectories. The generated `index.html` makes the directory URL open the
workbench. `make mis_web_tests` builds and tests this layout locally; its test
server closes when the checks finish.

The selected level's solver has no time or expansion cutoff. It runs in its
own worker until solved, proven unsolvable, stopped with **Stop solver**, or
replaced by an edit, level change or backend change. **Retry solve** starts a
fresh search after stopping or an error. Generator candidates and background
level-health checks retain their time budgets; optional difficulty and
shortest-path refinement is also bounded. `make mis_analysis_tests` checks
cancellation/retry and solves Heroes of Sokoban level 4, replaying the resulting
solution in the JS player.

## Hosting the full PuzzleScript release

MIS95 runs in the browser, including its workers and WebAssembly solver. The
full deployable website is the **contents of `bin`**, retaining all subdirectories.
Use a static host with HTTPS and WebAssembly MIME support
(`application/wasm`); the application is at `/mis.html`. Its workers and demos
must remain on the same origin. Do not upload the repository or `node_modules`.
Only serve `.br` sidecars when the host sets `Content-Encoding: br`; ordinary
files work without precompression. Localhost hosting does not create an internet
URL, and the background helper does not start automatically after reboot.
