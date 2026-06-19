#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"

cmake_args=(-S "$REPO_ROOT" -B "$REPO_ROOT/build")
if [[ "$(uname -s)" == "Darwin" ]]; then
  deployment_target="${MACOSX_DEPLOYMENT_TARGET:-${MAC_OS_MIN_VERSION:-10.15}}"
  cmake_args+=("-DCMAKE_OSX_DEPLOYMENT_TARGET=$deployment_target")
fi

cmake "${cmake_args[@]}"
cmake --build "$REPO_ROOT/build" --target puzzlescript_native puzzlescript_compiler
