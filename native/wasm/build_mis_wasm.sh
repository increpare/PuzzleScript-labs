#!/bin/bash
# Build the native compiler + solver + MIS difficulty/simplify as WebAssembly
# for the PuzzleScript+MIS web prototype (src/mis.html).
#
#   source /path/to/emsdk/emsdk_env.sh
#   native/wasm/build_mis_wasm.sh            # -> src/js/mis/wasm/mis_native.{js,wasm}
#
# On Windows, run this with Git Bash or MSYS2 bash (`make mis_wasm` does).
# `#!/usr/bin/env bash` is not used: `bash` on PATH is often the WSL app alias,
# which exits with Bash/Service/E_UNEXPECTED. If em++ is not on PATH and
# ~/emsdk/emsdk_env.sh exists, that environment is sourced.
#
# Environment: OPT (default -O3), JOBS (default nproc), OUT_DIR, BUILD_DIR,
# CFLAGS_EXTRA (e.g. -msimd128), LINK_EXTRA (e.g. "--profiling-funcs" to keep
# function names for CPU profiles).
set -euo pipefail

is_windows_bash() {
  case "$(uname -s)" in
    MSYS*|MINGW*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

to_native_path() {
  if is_windows_bash && command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s\n' "$1"
  fi
}

ROOT="$(to_native_path "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)")"
NATIVE="$(to_native_path "$ROOT/native")"
OUT_DIR="$(to_native_path "${OUT_DIR:-$ROOT/src/js/mis/wasm}")"
BUILD_DIR="$(to_native_path "${BUILD_DIR:-$ROOT/build/mis-wasm}")"
OPT="${OPT:--O3}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"

activate_emsdk() {
  if command -v em++ >/dev/null 2>&1 || command -v em++.bat >/dev/null 2>&1; then
    return 0
  fi
  local c
  local candidates=()
  [[ -n "${EMSDK:-}" ]] && candidates+=("$EMSDK/emsdk_env.sh")
  candidates+=("$HOME/emsdk/emsdk_env.sh")
  for c in "${candidates[@]}"; do
    [[ -f "$c" ]] || continue
    # emsdk_env.sh reads variables it does not always set.
    set +u
    export EMSDK_QUIET=1
    # shellcheck disable=SC1090
    source "$c"
    set -u
    return 0
  done
  return 1
}

# On MSYS, the extensionless em++ is a Python script whose shebang
# (`#!/usr/bin/env python3`) can hit the Windows Store python stub ahead of a
# real interpreter. em++.bat invokes Python itself.
emxx_bin() {
  local found
  if command -v em++ >/dev/null 2>&1; then
    found="$(command -v em++)"
    case "$found" in
      *.bat|*.BAT) printf '%s\n' "$found"; return 0 ;;
    esac
    if is_windows_bash && [[ -f "${found}.bat" ]]; then
      printf '%s\n' "${found}.bat"
      return 0
    fi
    printf '%s\n' "$found"
    return 0
  fi
  if command -v em++.bat >/dev/null 2>&1; then
    command -v em++.bat
    return 0
  fi
  return 1
}

activate_emsdk || true
if ! EMXX="$(emxx_bin)"; then
  echo "em++ not found - source emsdk_env.sh first" >&2
  if is_windows_bash; then
    echo "Windows: install emsdk, run 'emsdk activate latest', and either put it on PATH or clone it to %USERPROFILE%\\emsdk." >&2
  fi
  exit 1
fi
if is_windows_bash; then
  # Arguments are already Windows paths (C:/...). MSYS must not rewrite them.
  export MSYS2_ARG_CONV_EXCL='*'
fi

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
  local deps tok
  # Drop continuation backslashes, then turn Windows path separators into
  # forward slashes so the unquoted split below does not eat them. `${var#*: }`
  # cuts at the first ": ", so a drive prefix (C:) is not the separator.
  deps=$(sed 's/\\$//' "$obj.d" | tr '\n' ' ' | tr '\\' '/')
  deps="${deps#*: }"
  for tok in $deps; do
    tok="${tok%$'\r'}"
    [[ -n "$tok" && "$tok" -nt "$obj" ]] && return 0
  done
  return 1
}
objects=()
pids=()
compile() {
  local src="$1" obj="$2" lang_flags=()
  if [[ "$src" == *.c ]]; then lang_flags=(-std=c11); else lang_flags=(-std=c++20); fi
  local extra=()
  [[ "$src" == third_party/* ]] && extra=(-Wno-everything)
  "$EMXX" -x "$([[ "$src" == *.c ]] && echo c || echo c++)" "${lang_flags[@]}" "${COMMON[@]}" "${extra[@]}" -MMD -MF "$obj.d" -c "$NATIVE/$src" -o "$obj"
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

"$EMXX" "${COMMON[@]}" "${objects[@]}" -o "$OUT_DIR/mis_native.js" \
  -sMODULARIZE=1 -sEXPORT_NAME=createMisNative \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=4MB \
  -sEXPORTED_FUNCTIONS=_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAP32,HEAPU8 \
  ${LINK_EXTRA:-}

# Windows em++ writes CRLF glue. Linux checkouts of this file are LF, so strip
# CR or every Windows rebuild shows up as a change.
if is_windows_bash; then
  tr -d '\r' < "$OUT_DIR/mis_native.js" > "$OUT_DIR/mis_native.js.lf"
  mv -f "$OUT_DIR/mis_native.js.lf" "$OUT_DIR/mis_native.js"
fi

ls -l "$OUT_DIR"/mis_native.*
