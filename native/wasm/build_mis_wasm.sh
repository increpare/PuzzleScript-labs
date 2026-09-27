#!/usr/bin/env bash
# Build the native compiler + solver + MIS difficulty/simplify as WebAssembly
# for the PuzzleScript+MIS web prototype (src/mis.html).
#
#   source /path/to/emsdk/emsdk_env.sh
#   native/wasm/build_mis_wasm.sh            # -> src/js/mis/wasm/mis_native.{js,wasm}
#
# Environment: OPT (default -O3), JOBS (default nproc), OUT_DIR, BUILD_DIR,
# CFLAGS_EXTRA (e.g. -msimd128), LINK_EXTRA (e.g. "--profiling-funcs" to keep
# function names for CPU profiles).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NATIVE="$ROOT/native"
OUT_DIR="${OUT_DIR:-$ROOT/src/js/mis/wasm}"
BUILD_DIR="${BUILD_DIR:-$ROOT/build/mis-wasm}"
OPT="${OPT:--O3}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"

command -v em++ >/dev/null || { echo "em++ not found - source emsdk_env.sh first" >&2; exit 1; }

SOURCES=(
  src/compiler/compact_turn_codegen.cpp
  src/compiler/compact_turn_program.cpp
  src/compiler/compiled_rules_codegen.cpp
  src/compiler/compile_diagnostics.cpp
  src/compiler/c_api.cpp
  src/compiler/source_c_api.cpp
  src/compiler/diagnostic.cpp
  src/compiler/lower_to_runtime.cpp
  src/compiler/parser.cpp
  src/compiler/parser_glyphs.cpp
  src/compiler/rule_text.cpp
  src/compiler/semantic_program.cpp
  src/runtime/compiled_rules.cpp
  src/runtime/c_api.cpp
  src/runtime/core.cpp
  src/runtime/hash.cpp
  src/runtime/json.cpp
  src/runtime/layout_metrics.cpp
  src/runtime/locality_survey.cpp
  src/runtime/simd.cpp
  src/search/difficulty.cpp
  src/search/simplify.cpp
  src/solver/c_api.cpp
  src/solver/static_analysis.cpp
  third_party/simdjson/simdjson.cpp
  src/wasm/mis_wasm.cpp
)

# Same definitions as the CMake puzzlescript_native / puzzlescript_compiler targets.
COMMON=(
  "$OPT" -DNDEBUG -fwasm-exceptions ${CFLAGS_EXTRA:-}
  -DPS_MASK_WORD_BITS=64 -DPS_INTERPRETER_OBJECT_CELL_INDEX=1 -DUTF8PROC_STATIC
  -I"$NATIVE/include" -I"$NATIVE/src" -I"$NATIVE/third_party/simdjson" -I"$NATIVE/third_party/utf8proc"
)

mkdir -p "$BUILD_DIR" "$OUT_DIR"
# Changing compile flags invalidates every object.
if [[ "$(cat "$BUILD_DIR/.flags" 2>/dev/null)" != "${COMMON[*]}" ]]; then FORCE=1; fi
echo "${COMMON[*]}" > "$BUILD_DIR/.flags"
# Rebuild an object when its source or any header it included changed.
stale() {
  local obj="$1" src="$2"
  [[ "${FORCE:-0}" == 1 || ! -f "$obj" || ! -f "$obj.d" || "$src" -nt "$obj" ]] && return 0
  local f
  for f in $(sed -e 's/\\$//' -e 's/^[^:]*://' "$obj.d"); do [[ "$f" -nt "$obj" ]] && return 0; done
  return 1
}
objects=()
pids=()
compile() {
  local src="$1" obj="$2" lang_flags=()
  if [[ "$src" == *.c ]]; then lang_flags=(-std=c11); else lang_flags=(-std=c++20); fi
  local extra=()
  [[ "$src" == third_party/* ]] && extra=(-Wno-everything)
  em++ -x "$([[ "$src" == *.c ]] && echo c || echo c++)" "${lang_flags[@]}" "${COMMON[@]}" "${extra[@]}" -MMD -MF "$obj.d" -c "$NATIVE/$src" -o "$obj"
}

all=("${SOURCES[@]}" third_party/utf8proc/utf8proc.c)
for src in "${all[@]}"; do
  obj="$BUILD_DIR/$(echo "$src" | tr '/' '_').o"
  objects+=("$obj")
  if stale "$obj" "$NATIVE/$src"; then
    compile "$src" "$obj" &
    pids+=($!)
    if (( ${#pids[@]} >= JOBS )); then wait "${pids[0]}"; pids=("${pids[@]:1}"); fi
  fi
done
for p in "${pids[@]}"; do wait "$p"; done

em++ "${COMMON[@]}" "${objects[@]}" -o "$OUT_DIR/mis_native.js" \
  -sMODULARIZE=1 -sEXPORT_NAME=createMisNative \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=4MB \
  -sEXPORTED_FUNCTIONS=_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAP32,HEAPU8 \
  ${LINK_EXTRA:-}

ls -l "$OUT_DIR"/mis_native.*
