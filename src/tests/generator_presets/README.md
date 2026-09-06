# Native Generator Presets

These `.gen` files are lightweight Sokoban-oriented presets for the native
generator smoke path. They use the current V1 generation-rule subset and borrow
the spirit of PSMIS transform templates: start from a neutral room, place paired
goal objects, then apply small structural transforms such as wall scatter or
target/wall alternatives.

Run one manually with:

```sh
build/native/puzzlescript_generator src/demo/sokoban_basic.txt src/tests/generator_presets/sokoban_room_scatter.gen --samples 20 --quiet
```

`run_generator_benchmark.js` defaults to the legacy room-scatter and transform-pair
recipes. Use `--mode level-set` to measure `sokoban_levelset_tiny.gen` separately.
Each mode reports incompatible recipes as skipped; their metrics are not pooled.
`--run-timeout-ms` bounds each run, with a separate watchdog for a stuck runtime.

```sh
node src/tests/run_generator_benchmark.js build/native/puzzlescript_generator src/demo/sokoban_basic.txt --mode level-set --samples 200 --runs 3 --run-timeout-ms 5000 --out levelset-benchmark.json
```

Level-set generation accepts an optional total `--samples N` budget, divided
evenly across recipe blocks (earlier blocks receive the remainder). Already
started candidates finish when sample slots run out. `--time-ms N`, when given,
applies across blocks and all primary/supplemental solver lanes; deadlines and
user stops cooperatively interrupt active work between runtime turns. Without
either limit, the existing inactivity/pass policy applies. Exhaustion or a
deadline can end a run before its sample budget is used.

Use `--out generated.txt --json-out summary.json` to save both the game and its
run summary. It reports the stop reason, per-block samples, candidate assessments,
cache hits, interruptions and retained keepers. Keepers are not a count of every
solved candidate. The assessment uses the portfolio primary plus supplemental
lanes; non-portfolio `--solver-strategy` and `--events-jsonl` are rejected in this
mode rather than silently ignored. Changing solver schedules or time budgets
can change keeper selection even when generated samples have the same seeds.

Level-set reports now include `evaluation_cache` lane hits, owner search attempts,
wait iterations, entries and estimated retained bytes. The benchmark preserves
these counters. `--dedupe-max` limits retained lane entries in this mode, subject
to a separate 32 MiB cache budget. Candidate-assessment counts and lane-search
counts are different; see [cache semantics](../../../docs/evaluation-cache-and-push-search.md).
