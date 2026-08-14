# CodeMirror installed-browser performance harness

This opt-in harness compares the generated frozen CodeMirror 5 editor with the
active CodeMirror 6 product editor in installed Chrome and Safari. It is not in
the routine test suite because browser scheduling, garbage collection, and
foreground-window state make timing runs noisy and unsuitable as deterministic
unit-test gates.

Serve `src/` at the URL passed as `--base-url`, then run one surface at a time:

```sh
npm run perf:codemirror:chrome -- \
  --surface cm5 \
  --base-url http://127.0.0.1:4173 \
  --output /tmp/puzzlescript-cm5-chrome.json

npm run perf:codemirror:safari -- \
  --surface cm6 \
  --base-url http://127.0.0.1:4173 \
  --output /tmp/puzzlescript-cm6-safari.json
```

All three arguments are required. `--surface` is `cm5` or `cm6`, `--base-url`
is the origin serving `src/`, and `--output` is the JSON result path. The runner
uses installed Chrome (`chromium.launch({channel: "chrome"})`) or installed
Safari through SafariDriver. SafariDriver must already be enabled; the runner
never invokes `safaridriver --enable`. It connects to an existing driver on port
4444 when available and stops only a driver process it started.

The runner performs 5 warmups and stores 20 samples for each scenario. Chrome
also records 20 fresh-page heap samples after garbage collection for initial
mount and the 129,721-character source. Safari intentionally makes no automated
heap claim because WebDriver exposes no equivalent repeatable heap measurement.

Settled scenarios observe the editor root before starting the measured mutation,
require scenario-specific semantic readiness, then confirm 100 ms of DOM quiet
across two animation frames. A 10-second hard timeout prevents hung captures and
reports readiness, the last relevant mutation, and elapsed time. The quiet
confirmation window is awaited but excluded from the reported duration; the
metric ends at the later of semantic readiness or the last relevant mutation.
Large-file key timing restores and verifies the full 129,721-character source at
the stable visible line-0 cursor and viewport before each measured key.

[`reference-medians.json`](reference-medians.json) is the immutable historical
record from the approved performance design. New captures belong in
`baselines/`; do not overwrite the reference values with fresh measurements.
