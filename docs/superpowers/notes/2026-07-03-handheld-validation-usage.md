# Handheld Validation Usage

The handheld validation report checks how PuzzleScript games fit on the target
800x480 handheld display. It is a corpus-first sanity check for the display
semantics in the handheld plan, especially level viewport selection and scaling.

This report is intentionally display-only. It does not prove ESP32-P4 memory
fit, rv32 portability, compile time, binary size, storage wear, audio synthesis,
or battery behavior. Those are separate Track 0 / firmware validation gates in
the handheld design spec.

## Build

Use the root CMake build, not a nested native-only build:

```bash
cmake -S . -B build -DPS_MASK_WORD_BITS=64
cmake --build build --target puzzlescript_handheld_report
```

The report binary is:

```bash
build/native/puzzlescript_handheld_report
```

## Run One Or More Sources

```bash
build/native/puzzlescript_handheld_report --display 800x480 --source src/demo/sokoban_basic.txt
build/native/puzzlescript_handheld_report --display 800x480 src/demo/sokoban_basic.txt
```

The output is a JSON object with `summary` and `games`.

## Run The Testdata Corpus

The recommended corpus command is:

```bash
make handheld_report
```

This builds `build/native/puzzlescript_handheld_report`, bundles the JS
`testdata` corpus to `build/handheld_testdata.bundle.ndjson`, runs the 800x480
report, and writes:

```bash
build/handheld_report.json
```

Set `BUILD_DIR=...` when invoking `make handheld_report` to change the binary,
bundle, and JSON output locations together.

Equivalent manual commands:

```bash
node scripts/build_parser_corpus_bundle.js testdata > build/handheld_testdata.bundle.ndjson
build/native/puzzlescript_handheld_report --display 800x480 --corpus-ndjson build/handheld_testdata.bundle.ndjson > build/handheld_report.json
```

## NDJSON Corpus Format

`--corpus-ndjson` expects newline-delimited JSON records. Each record must be a
JSON object with string `name` and `source` fields:

```json
{"name":"demo.txt","source":"title demo\n====\nobjects\n..."}
```

An `index` field may be present in bundles produced by helper scripts, but the
handheld report ignores it. Blank lines are skipped.

## Report Contract

`summary` counts all input sources. This includes games that compile, games that
fail to compile, board levels checked for display fit, text/message levels, and
board levels that degrade during report generation.

API callers can set `includePassingGames=false` to omit passing game entries
from the emitted `games` array. That filtering does not change `summary`;
summary counters still describe every input source.

Board level records use `kind:"board"` and contain `board_width`,
`board_height`, viewport, and fit fields. Text-screen records use
`kind:"text"` with `mode:"message"` or `mode:"title"` and contain terminal
dimensions and message text instead of board-fit fields, so they do not count
as successful board fits.

## Viewport Semantics Checked

- No `flickscreen` or `zoomscreen`: fit the full level.
- `flickscreen`: use the declared tile page containing the player. On the final
  edge page, keep the declared page origin while draw bounds clamp to the level.
- `zoomscreen`: use the declared viewport centered around the player and clamped
  to the level.
- If both are declared, `flickscreen` precedes `zoomscreen`.
- Text/message levels are reported separately from board levels.
- Borders and background use the game background color. This keeps the report
  aligned with future glow and LED work.

## Test Gate

Run the handheld CTest slice after changing report behavior:

```bash
ctest --test-dir build/native -R '^handheld_' --output-on-failure
```
