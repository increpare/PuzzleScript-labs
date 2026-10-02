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

npm run perf:codemirror:chrome -- \
  --surface cm6 \
  --base-url http://127.0.0.1:4173 \
  --output /tmp/puzzlescript-cm6-chrome-cpu4.json \
  --cpu-throttle 4
```

All three arguments are required. `--surface` is `cm5` or `cm6`, `--base-url`
is the origin serving `src/`, and `--output` is the JSON result path. The runner
uses installed Chrome (`chromium.launch({channel: "chrome"})`) or installed
Safari through SafariDriver. SafariDriver must already be enabled; the runner
never invokes `safaridriver --enable`. It connects to an existing driver on port
4444 when available and stops only a driver process it started.

`--cpu-throttle 4` is an optional Chrome-only headroom probe. It uses Chrome's
public DevTools CPU-throttling command and is rejected for Safari or for values
other than exactly `4`.

The runner performs 5 warmups and stores 20 samples for each scenario. Chrome
also records 20 fresh-page heap samples after garbage collection for initial
mount and the 129,721-character source. Safari intentionally makes no automated
heap claim because WebDriver exposes no equivalent repeatable heap measurement.
Initial heap settling observes the already-mounted editor without changing its
source, history, cursor, focus, selection, or scroll state.

Safari uses one session for the complete capture. Each ordinary scenario is one
bounded asynchronous WebDriver call. The distant-jump scenario keeps the same
session but records one sample per call, with its five warmups applied only to
the first call, to avoid SafariDriver's long-script timeout without changing the
20-sample contract. The runner activates Safari and waits up to 30 seconds for
`document.visibilityState === "visible"` before injecting the harness or doing
any warmup; focus the SafariDriver-controlled window if it remains hidden.

The page builder writes frozen CM5 and active-CM6 benchmark pages under
`tests/codemirror6/generated/`. Both install the same small error-capture
bootstrap before any product script. It records synchronous `error` events and
`unhandledrejection` events as deduplicated strings from initial page load
through the final sample. The runner requires this buffer after mount and again
after measurement; a missing, malformed, or non-empty buffer rejects the
capture. Chrome also keeps its native pre-navigation `pageerror` listener and
deduplicates those reports with the page buffer. The generated CM6 page differs
from `/editor.html` only by its base URL and this measurement-only bootstrap.

Settled scenarios observe the editor root before starting the measured mutation,
require scenario-specific semantic readiness, then confirm 100 ms of DOM quiet
across two animation frames. A 10-second hard timeout prevents hung captures and
reports readiness, the last relevant mutation, and elapsed time. The quiet
confirmation window is awaited but excluded from the reported duration; the
metric ends at the later of semantic readiness or the last relevant mutation.
Large-file key timing restores and verifies the full 129,721-character source at
the stable visible line-0 cursor and viewport before each measured key.

CM5 can produce a small number of long-tail settled samples. Repeated installed
Chrome diagnostics showed that these samples end at a delayed
`.CodeMirror-hscrollbar` style update issued 29–72 ms after the measured document
replacement or search operation. Restore had already completed its quiet window,
and no autocomplete/search work crossed the scenario boundary. The tail is
therefore retained as genuine deferred CM5 layout work; captures never filter it.

[`reference-medians.json`](reference-medians.json) is the immutable historical
record from the approved performance design. New captures belong in
`baselines/`; do not overwrite the reference values with fresh measurements.
