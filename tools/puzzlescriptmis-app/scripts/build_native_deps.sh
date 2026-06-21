#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"

find_cmake() {
  local candidate

  if [[ -n "${CMAKE:-}" ]]; then
    if [[ -x "$CMAKE" ]]; then
      printf '%s\n' "$CMAKE"
      return 0
    fi
    if candidate="$(command -v "$CMAKE" 2>/dev/null)"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  if candidate="$(command -v cmake 2>/dev/null)"; then
    printf '%s\n' "$candidate"
    return 0
  fi

  for candidate in \
    /opt/homebrew/bin/cmake \
    /usr/local/bin/cmake \
    /Applications/CMake.app/Contents/bin/cmake
  do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

if ! cmake_bin="$(find_cmake)"; then
  cat >&2 <<'EOF'
error: cmake not found.

Install CMake, or set CMAKE to the full cmake executable path before building.
Common macOS locations checked:
  /opt/homebrew/bin/cmake
  /usr/local/bin/cmake
  /Applications/CMake.app/Contents/bin/cmake
EOF
  exit 127
fi

cmake_dir="$(cd "$(dirname "$cmake_bin")" && pwd)"
export PATH="$cmake_dir:$PATH"

# Xcode exports compiler wrappers and deployment targets for every Apple
# platform. CMake only needs a clean macOS compiler environment here.
for var_name in \
  CC CXX CPP CFLAGS CXXFLAGS CPPFLAGS LDFLAGS \
  IPHONEOS_DEPLOYMENT_TARGET TVOS_DEPLOYMENT_TARGET \
  WATCHOS_DEPLOYMENT_TARGET XROS_DEPLOYMENT_TARGET \
  DRIVERKIT_DEPLOYMENT_TARGET
do
  unset "$var_name"
done

cmake_args=(-S "$REPO_ROOT" -B "$REPO_ROOT/build")
if [[ "$(uname -s)" == "Darwin" ]]; then
  desired_c_compiler="/usr/bin/clang"
  desired_cxx_compiler="/usr/bin/clang++"
  deployment_target="${MACOSX_DEPLOYMENT_TARGET:-${MAC_OS_MIN_VERSION:-10.15}}"
  desired_arches=""
  cmake_args+=(
    "-DCMAKE_C_COMPILER=$desired_c_compiler"
    "-DCMAKE_CXX_COMPILER=$desired_cxx_compiler"
    "-DCMAKE_OSX_DEPLOYMENT_TARGET=$deployment_target"
  )

  if [[ -n "${ARCHS:-}" && "$ARCHS" != *'$('* ]]; then
    desired_arches="${ARCHS// /;}"
    cmake_args+=("-DCMAKE_OSX_ARCHITECTURES=$desired_arches")
  elif [[ -n "${NATIVE_ARCH_ACTUAL:-}" ]]; then
    desired_arches="$NATIVE_ARCH_ACTUAL"
    cmake_args+=("-DCMAKE_OSX_ARCHITECTURES=$desired_arches")
  fi
fi

cache_file="$REPO_ROOT/build/CMakeCache.txt"
if [[ -f "$cache_file" ]]; then
  reset_cmake_cache=0

  if grep -Eq 'scripts/osx/(cc|cxx)\.sh' "$cache_file"; then
    reset_cmake_cache=1
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    cache_c_compiler="$(sed -n 's/^CMAKE_C_COMPILER:[^=]*=//p' "$cache_file" | tail -n 1)"
    cache_cxx_compiler="$(sed -n 's/^CMAKE_CXX_COMPILER:[^=]*=//p' "$cache_file" | tail -n 1)"
    cache_arches="$(sed -n 's/^CMAKE_OSX_ARCHITECTURES:[^=]*=//p' "$cache_file" | tail -n 1)"

    if [[ "$cache_c_compiler" != "$desired_c_compiler" ]]; then
      reset_cmake_cache=1
    fi

    if [[ "$cache_cxx_compiler" != "$desired_cxx_compiler" ]]; then
      reset_cmake_cache=1
    fi

    if [[ -n "$desired_arches" && "$cache_arches" != "$desired_arches" ]]; then
      reset_cmake_cache=1
    fi
  fi

  if [[ "$reset_cmake_cache" == "1" ]]; then
    rm -f "$cache_file"
    rm -rf "$REPO_ROOT/build/CMakeFiles"
  fi
fi

"$cmake_bin" "${cmake_args[@]}"
"$cmake_bin" --build "$REPO_ROOT/build" --target puzzlescript_native puzzlescript_compiler
