#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"

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
  deployment_target="${MACOSX_DEPLOYMENT_TARGET:-${MAC_OS_MIN_VERSION:-10.15}}"
  cmake_args+=(
    "-DCMAKE_C_COMPILER=/usr/bin/clang"
    "-DCMAKE_CXX_COMPILER=/usr/bin/clang++"
    "-DCMAKE_OSX_DEPLOYMENT_TARGET=$deployment_target"
  )

  if [[ -n "${ARCHS:-}" && "$ARCHS" != *'$('* ]]; then
    cmake_arches="${ARCHS// /;}"
    cmake_args+=("-DCMAKE_OSX_ARCHITECTURES=$cmake_arches")
  elif [[ -n "${NATIVE_ARCH_ACTUAL:-}" ]]; then
    cmake_args+=("-DCMAKE_OSX_ARCHITECTURES=$NATIVE_ARCH_ACTUAL")
  fi
fi

cache_file="$REPO_ROOT/build/CMakeCache.txt"
if [[ -f "$cache_file" ]] && grep -Eq 'scripts/osx/(cc|cxx)\.sh' "$cache_file"; then
  rm -f "$cache_file"
  rm -rf "$REPO_ROOT/build/CMakeFiles"
fi

cmake "${cmake_args[@]}"
cmake --build "$REPO_ROOT/build" --target puzzlescript_native puzzlescript_compiler
