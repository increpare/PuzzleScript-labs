#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/diff_semantic_program_against_js.sh <source.txt>" >&2
  exit 1
fi

SOURCE_FILE="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

JS_RAW="$TMP_DIR/js-raw.json"
CPP_RAW="$TMP_DIR/cpp-raw.json"
JS_OUT="$TMP_DIR/js-canon.json"
CPP_OUT="$TMP_DIR/cpp-canon.json"

node "$ROOT_DIR/src/tests/js_oracle/export_ir_json.js" "$SOURCE_FILE" "$JS_RAW" --snapshot-phase semantic
"$ROOT_DIR/build/native/puzzlescript_cpp" compile "$SOURCE_FILE" --emit-semantic-program > "$CPP_RAW"

canon() {
  node -e 'const fs=require("fs");const sort=v=>Array.isArray(v)?v.map(sort):(v&&typeof v==="object"?Object.keys(v).sort().reduce((a,k)=>{a[k]=sort(v[k]);return a},{}):v);process.stdout.write(JSON.stringify(sort(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))),null,2));' "$1"
}

canon "$JS_RAW" > "$JS_OUT"
canon "$CPP_RAW" > "$CPP_OUT"

diff -u "$JS_OUT" "$CPP_OUT"
