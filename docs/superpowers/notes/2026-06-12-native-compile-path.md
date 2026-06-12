# Native-only compile path (Task 1.4)

**Status:** Confirmed 2026-06-12 — no code change required.

`puzzlescript_cpp compile game.txt` already routes through the native compiler only:

- `--diagnostics` → `ps_compiler_compile_source_diagnostics`
- `--emit-parser-state` → `ps_compiler_parse_source`
- `--emit-ir-json` → `parseSource` + `lowerToRuntimeGame` + `serializeRuntimeGameDebugJson`

There is no Node subprocess, no `ir.json` load fallback, and no hybrid path on the `compile` command.

Related native compile entry points (also Node-free):

- `ps_compile_source` in `native/src/runtime/c_api.cpp` (used by `loadGameFromSourceText`)
- `test simulation-corpus` / `test diagnostics-corpus` compile sources directly

Node is still used elsewhere (by design): JS oracle scripts for optional `step`/`diff-trace-source` without `--native-compile`, trace export, and CMake-generated smoke IR fixtures.

**Verification:**

```bash
make build
build/native/puzzlescript_cpp compile src/demo/sokoban_basic.txt --diagnostics
make simulation_tests_cpp   # 469/469
make compilation_tests      # 274/274
```
