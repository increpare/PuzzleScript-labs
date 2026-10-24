The native build configuration and independent diagnostic validation are restored.

Subsequent work repaired all 125 exposed diagnostic differences. The full
321-case corpus is now registered in CTest and passes, including source/comment,
poisoned-answer and renamed-identifier variants. See the
[diagnostic parity follow-up](2026-10-24-native-diagnostic-parity.md).

`05fc3435` had emptied `native/CMakeLists.txt`, the ambient-light policy header
and its test source. Their last complete versions were restored, then updated
to register the newer solver-profile, static-tag and sparse-replacement checks.
Release test assertions stay enabled. The solution-cache check receives the
actual build's CLI, regenerates exports with it, and uses CMake for host replay
builds so it works with Visual Studio outside a developer shell. Generated rule
objects are shared across CLI, solver, generator and simplifier targets.

A newly configured Windows x64 Release build produced the native tools and
passed all **113 registered tests**, including all **280** `host_known_good`
solution-cache cases, in 286.66 seconds. The only earlier failures were the
empty ambient test, a fixed build-path assumption in the cache script, and a
JSON-escape test value used directly as a Windows directory name. Those causes
were repaired. The later board-specialization experiment adds its own checks;
its results are recorded separately.

The diagnostic compiler no longer reads expected answers from fixture files.
The initial seventeen regression cases passed with unique source comments and
again with the original sources while the working directory contained deliberately
poisoned fixture answers. The poison must have no effect on compilation.

The initial independent audit of all 321 fixtures passed **196**, with **125**
real differences in messages, counts, ordering or semantic validation. This
matched the pre-removal compiler when run
from a directory where the old lookup could not find fixtures. The lookup had
hidden these gaps; it did not implement those checks. The subsequent diagnostic
repair implements them from source and expands the independent regressions to
all 321 cases. The native README gives the direct full-corpus command.

For routine validation, configure a new build directory and follow the commands
in [the native README](../../native/README.md). The separate
`solver_solution_replay` executable loads original source and runs the ordinary
interpreter in its own process. It refuses generated backends and accepts one
or more solver JSON result files, deduplicating identical paths.
