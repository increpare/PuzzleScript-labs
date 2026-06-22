# Compile-API Header Re-homing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the source-compile C API declarations (`ps_compile_source`, `ps_compile_result*`) out of the runtime header `puzzlescript.h` into the compiler header `compiler.h`, so the runtime header stops advertising functions that live in the compiler library.

**Architecture:** The runtime/compiler decoupling already moved these functions' *implementations* into the compiler lib (`source_c_api.cpp`) and verified the runtime lib links standalone. But their *declarations* still sit in the runtime public header, so a runtime-only embedder that includes `puzzlescript.h` and links only `puzzlescript_native` can call `ps_compile_source` and get an undefined-symbol link error instead of a compile-time signal. This change finishes the decoupling at the header level: the declarations move to `compiler.h`, and the three callers include it.

**Tech Stack:** C/C++ headers, CMake.

**Prerequisite facts (verified against the tree):**
- `native/include/puzzlescript/puzzlescript.h` declares (lines 14, 202-206): `typedef struct ps_compile_result ps_compile_result;`, `ps_compile_source`, `ps_compile_result_game`, `ps_game_clone` (stays — runtime), `ps_compile_result_error`, `ps_free_compile_result`.
- `ps_game_clone` and `ps_load_ir_json` are runtime functions and **stay** in `puzzlescript.h`. Only the compile-result family moves.
- These are implemented in `native/src/compiler/source_c_api.cpp` (compiler lib).
- `native/include/puzzlescript/compiler.h` currently declares the `ps_compiler_*` parser API and has its own typedefs; it does not include `puzzlescript.h`.
- Callers of the moving symbols: `native/src/cli/main.cpp` (lines ~706-729), `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h:112` and `NativeGameBridge.cpp:50`.
- `ps_compile_result_game` returns `const ps_game*` and `ps_compile_result_error` returns `const ps_error*`, so `compiler.h` needs those two opaque types forward-declared.
- The `runtime_standalone_link` test (exe + `nm` archive audit) already guards that `puzzlescript_native` carries no compiler symbols; this header change does not affect linking (declarations are not symbols).

---

## Task 1: Re-home the compile-result declarations

**Files:**
- Modify: `native/include/puzzlescript/puzzlescript.h`
- Modify: `native/include/puzzlescript/compiler.h`
- Modify: `native/src/cli/main.cpp`
- Modify: `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h`

- [ ] **Step 1: Remove the compile-result declarations from the runtime header**

In `native/include/puzzlescript/puzzlescript.h`, delete the `ps_compile_result` typedef (line ~14) and the four declarations (keep `ps_game_clone` and `ps_load_ir_json`):

```c
typedef struct ps_compile_result ps_compile_result;   // remove this line
```
```c
bool ps_compile_source(const char* source_utf8, size_t source_size, ps_compile_result** out_result);   // remove
const ps_game* ps_compile_result_game(const ps_compile_result* result);                                 // remove
const ps_error* ps_compile_result_error(const ps_compile_result* result);                               // remove
void ps_free_compile_result(ps_compile_result* result);                                                 // remove
```

- [ ] **Step 2: Add them to the compiler header**

In `native/include/puzzlescript/compiler.h`, inside the `extern "C"` block, add forward declarations for the runtime opaque types and the moved API:

```c
typedef struct ps_game ps_game;
typedef struct ps_error ps_error;
typedef struct ps_compile_result ps_compile_result;

bool ps_compile_source(const char* source_utf8, size_t source_size, ps_compile_result** out_result);
const ps_game* ps_compile_result_game(const ps_compile_result* result);
const ps_error* ps_compile_result_error(const ps_compile_result* result);
void ps_free_compile_result(ps_compile_result* result);
```

(`compiler.h` already includes `<stdbool.h>`/`<stddef.h>`; add `<stdint.h>` only if not present. The duplicate `typedef struct ps_game ps_game;` across `compiler.h` and `puzzlescript.h` is an identical redefinition, valid in C11/C++ when both are included.)

- [ ] **Step 3: Update the callers to include compiler.h**

In `native/src/cli/main.cpp`, ensure `#include "puzzlescript/compiler.h"` is present (it likely already is for `ps_compiler_*`; if not, add it next to the `puzzlescript/puzzlescript.h` include).

In `tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h`, add `#include "puzzlescript/compiler.h"` next to the existing `puzzlescript/puzzlescript.h` include (`NativeGameBridge.cpp` includes the header, so it transitively gets it).

- [ ] **Step 4: Confirm the source TU includes the new header**

In `native/src/compiler/source_c_api.cpp`, ensure `#include "puzzlescript/compiler.h"` is present so the definitions match the new declarations (it includes `puzzlescript/puzzlescript.h` today; add `compiler.h`).

- [ ] **Step 5: Build everything and run the suite**

```bash
cmake -S . -B build
cmake --build build -j
ctest --test-dir build --output-on-failure
```
Expected: clean build (the compile/play consumers — `puzzlescript_cpp`, the MIS bridge smoke — still resolve `ps_compile_source` from `compiler.h`), and all CTests pass, including `runtime_standalone_link`. A build error in a caller means it needs the `compiler.h` include (Step 3).

- [ ] **Step 6: Verify the runtime header no longer advertises the compile API**

```bash
grep -c "ps_compile_source" native/include/puzzlescript/puzzlescript.h
grep -c "ps_compile_source" native/include/puzzlescript/compiler.h
```
Expected: `0` for `puzzlescript.h`, `1` for `compiler.h`.

- [ ] **Step 7: Commit**

```bash
git add native/include/puzzlescript/puzzlescript.h native/include/puzzlescript/compiler.h native/src/cli/main.cpp native/src/compiler/source_c_api.cpp tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.h
git commit -m "refactor(native): re-home compile C API decls to compiler.h (finish decoupling)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Resolves the deferred decoupling-audit item (#4): the runtime public header no longer declares functions implemented in the compiler library, so a runtime-only embedder gets a compile-time signal rather than a link error.

**Placeholder scan:** Complete; every step names exact lines/files and the verification greps.

**Type consistency:** The four moved declarations match their `source_c_api.cpp` definitions byte-for-byte (only their header location changes). `ps_game`/`ps_error`/`ps_compile_result` opaque types are forward-declared in `compiler.h`; identical-redefinition rules make co-inclusion with `puzzlescript.h` safe.

**Risk note:** Purely a header reorganization — no symbol or linking change (the `runtime_standalone_link` guard is unaffected). The only failure mode is a caller missing the `compiler.h` include, which surfaces immediately as a build error in Step 5.
