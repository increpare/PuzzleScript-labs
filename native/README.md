# PuzzleScript C++ Port

The native implementation is exposed as `puzzlescript_cpp`: a C++ PuzzleScript compiler/runtime/player toolkit with a stable C API.

Directory map:

- `native/src/compiler/`: C++ parser/compiler and JS-compatible diagnostics.
- `native/src/runtime/`: abstract engine, sessions, stepping, hashing, snapshots, and JSON IR compatibility loading.
- `native/src/player/`: SDL player integration.
- `native/src/cli/`: `puzzlescript_cpp` command implementation.
- `src/tests/js_oracle/`: JavaScript reference harness used to generate parity data from the original implementation.

Common commands:

A fresh checkout can build and run the registered checks without Make:

```sh
cmake -S . -B build/native-clean
cmake --build build/native-clean --config Release --parallel 4
ctest --test-dir build/native-clean -C Release --output-on-failure --parallel 4
```

Install Node.js, Python 3 and a C/C++20 toolchain first. On Windows, use the
CMake bundled with Visual Studio if CMake is not on PATH. If Python resolves
to a Windows Store alias, configure with `-DPython3_EXECUTABLE=/path/to/python.exe`.
Executables are under `build/native-clean/native/Release` with Visual Studio,
or `build/native-clean/native` with a single-configuration generator.

CTest builds its generated replay fixture with the current compiler, tests the
ordinary player and solver profile separately, and checks diagnostic sources in
an isolated directory containing poisoned expected answers. Release test
assertions remain enabled. Solution-cache checks receive the current executable
path and regenerate exports, rather than discovering an unrelated old build.

The registered diagnostic corpus passes all 321 fixtures. Its independent
regression test repeats every case with source comments, poisoned expected
answers in the working directory, and renamed object/property identifiers.
The initial 196/321 audit exposed missing compiler validation; those checks now
run from the parsed source. Run `puzzlescript_cpp test diagnostics-corpus
src/tests/resources/errormessage_testdata.js` directly, or use CTest. See the
[diagnostic parity report](../docs/benchmarks/2026-10-24-native-diagnostic-parity.md)
for scope and validation.

Validate benchmark solutions in a separate process using the ordinary,
unpruned interpreter:

```sh
build/native-clean/native/solver_solution_replay src/tests/solver_tests results.json
```

With Visual Studio, add `Release/` before the executable and its `.exe`
extension. Multiple result files can be supplied; duplicate paths are replayed
once. This validator refuses generated backends, so a solver profile cannot
validate its own removed rules.

```bash
make build
make run src/demo/sokoban_basic.txt
make ctest
make js_parity_tests
make simulation_tests
make compilation_tests
make profile_simulation_tests
make tests
build/native/puzzlescript_cpp --help
build/native/puzzlescript_cpp help test
build/native/puzzlescript_cpp compile src/demo/sokoban_basic.txt --diagnostics
```

`make simulation_tests` runs the original JS simulation tests and then the mirrored C++ simulation replay parity suite. `make compilation_tests` does the same for compiler diagnostics. Use the `_js` and `_cpp` variants when you want to time one side in isolation.

`make profile_simulation_tests` runs a C++-only simulation replay workload and writes native timer/hotspot profiler output to `profile_stats.txt` and `build/native/profile_last/`.

`make tests` runs the fast C++ checks and the JS parity suite. The JS parity suite regenerates saved replay/diagnostic data from `testdata.js` and `errormessage_testdata.js`, then checks that the C++ implementation matches it.
