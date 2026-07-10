# Handheld Peak-Memory Audit Usage

The handheld peak-memory audit is the first no-hardware Track 0 gate for the
PuzzleScript handheld. It measures native C++ compile/load/session peak RSS for
each game in the current `testdata` corpus and flags games that exceed an
embedded memory ceiling.

This audit complements the display-only handheld report. It does not prove rv32
portability, firmware heap behavior, allocator fragmentation, binary size,
compile time on ESP32-P4, storage behavior, audio, haptics, or battery life.

## Build

Use the root CMake build:

```bash
cmake -S . -B build -DPS_MASK_WORD_BITS=64
cmake --build build --target puzzlescript_cpp
```

## One-Game Smoke

Build the testdata NDJSON bundle and run the audit on the first record:

```bash
node scripts/build_parser_corpus_bundle.js testdata > build/handheld_testdata.bundle.ndjson
node scripts/handheld_memory_audit.js \
  --binary build/native/puzzlescript_cpp \
  --corpus-ndjson build/handheld_testdata.bundle.ndjson \
  --limit 1 \
  --time-executable /usr/bin/time \
  --out build/handheld_memory_audit_smoke.json
jq '.summary' build/handheld_memory_audit_smoke.json
```

The measured command is:

```bash
/usr/bin/time -lp build/native/puzzlescript_cpp run <temp-source>.txt --headless --native-compile
```

On GNU/Linux the script uses `/usr/bin/time -v` instead of `-lp`. The CLI also
accepts `--time-executable PATH` to use an approved wrapper or alternate time
binary, and `--timeout-ms` for a per-game wall-clock timeout; the defaults are
`/usr/bin/time` and 120000.

Managed macOS or sandboxed environments may block `/usr/bin/time -lp` during
flavor probing or measured runs. In those environments, run the audit outside
the sandbox or pass an approved wrapper with `--time-executable`.

## Full Corpus

```bash
make handheld_memory_audit
```

The output is:

```bash
build/handheld_memory_audit.json
```

Override the ceiling with:

```bash
make handheld_memory_audit HANDHELD_MEMORY_CEILING_MB=24
```

Override the time executable with:

```bash
make handheld_memory_audit HANDHELD_MEMORY_TIME_EXECUTABLE=/path/to/time-wrapper
```

The Make target writes temporary source files under
`build/handheld_memory_audit_sources` by passing that directory as `--tmp-dir`.
If `BUILD_DIR` is overridden, the output JSON, NDJSON bundle, and temporary
source directory move under that build directory together. The Make variable
`HANDHELD_MEMORY_TIME_EXECUTABLE` is passed through as `--time-executable`.

## Report Contract

The top-level JSON object contains:

- `generated_at`: ISO timestamp for the audit run
- `host`: platform, architecture, and release
- `command`: binary, corpus bundle, time executable, time flavor, and timeout
- `summary`: aggregate counts and peak RSS outliers
- `games`: one measurement record per input source

`summary.memory_ceiling_mb` defaults to 32, matching the reference ESP32-P4
PSRAM package size. `summary.over_ceiling` is the first Track 0 number to watch.
Any over-ceiling game needs either runtime-load memory reduction or an explicit
too-large-game decision before Track 1 hardware spending.

The CLI exits nonzero when the corpus produces no measured games or when any
measurement fails, and still writes the JSON report when it reaches report
generation. `summary.over_ceiling` is a reported outlier count only; it does not
by itself fail the process.

Per-game `peak_rss_bytes` is host RSS, not embedded heap use. It is still useful
for ranking outliers and proving whether the current native load path is in the
same order of magnitude as the target PSRAM budget.
