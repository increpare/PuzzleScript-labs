#!/usr/bin/env bash
# Build native/wasm/mis_wasm_bench_native.cpp with the host compiler (same
# sources and definitions as build_mis_wasm.sh) for wasm-vs-native profiling.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NATIVE="$ROOT/native"
BUILD_DIR="${BUILD_DIR:-$ROOT/build/mis-bench-native}"
CXX="${CXX:-clang++}"
CC="${CC:-clang}"
OPT="${OPT:--O3}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
mkdir -p "$BUILD_DIR"
SOURCES=$(sed -n '/^SOURCES=(/,/^)/p' "$NATIVE/wasm/build_mis_wasm.sh" | grep -v '^SOURCES=(\|^)' | tr -d ' ')
FLAGS=("$OPT" -DNDEBUG -DPS_MASK_WORD_BITS=64 -DPS_INTERPRETER_OBJECT_CELL_INDEX=1 -DUTF8PROC_STATIC
  -I"$NATIVE/include" -I"$NATIVE/src" -I"$NATIVE/third_party/simdjson" -I"$NATIVE/third_party/utf8proc")
stale() {
  local obj="$1" src="$2"
  [[ "${FORCE:-0}" == 1 || ! -f "$obj" || ! -f "$obj.d" || "$src" -nt "$obj" ]] && return 0
  local f
  for f in $(sed -e 's/\\$//' -e 's/^[^:]*://' "$obj.d"); do [[ "$f" -nt "$obj" ]] && return 0; done
  return 1
}
objs=(); pids=()
for src in $SOURCES wasm/mis_wasm_bench_native.cpp; do
  path="$NATIVE/src/$src"; [[ -f "$path" ]] || path="$NATIVE/$src"
  obj="$BUILD_DIR/$(echo "$src" | tr '/' '_').o"; objs+=("$obj")
  if stale "$obj" "$path"; then
    extra=(); [[ "$src" == third_party/* ]] && extra=(-Wno-everything)
    "$CXX" -std=c++20 "${FLAGS[@]}" "${extra[@]}" -MMD -MF "$obj.d" -c "$path" -o "$obj" & pids+=($!)
    if (( ${#pids[@]} >= JOBS )); then wait "${pids[0]}"; pids=("${pids[@]:1}"); fi
  fi
done
"$CC" -std=c11 "${FLAGS[@]}" -Wno-everything -c "$NATIVE/third_party/utf8proc/utf8proc.c" -o "$BUILD_DIR/utf8proc.o" & pids+=($!)
for p in "${pids[@]}"; do wait "$p"; done
"$CXX" "${objs[@]}" "$BUILD_DIR/utf8proc.o" -o "$BUILD_DIR/mis_wasm_bench_native" -lpthread
echo "$BUILD_DIR/mis_wasm_bench_native"
