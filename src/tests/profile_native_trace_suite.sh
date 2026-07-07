#!/usr/bin/env bash
# Profile native C++ simulation replay or solver workloads.
#
# Workloads:
#   PROFILE_WORKLOAD=simulation  puzzlescript_cpp simulation corpus (default)
#   PROFILE_WORKLOAD=solver       puzzlescript_solver smoke fixture
#
# Pass 2 modes (PROFILE_MODE):
#   auto      sample(1) on macOS, perf record on Linux, else skip
#   sample    macOS sample(1) CPU stacks
#   perf      Linux perf record + report
#   counters  macOS xctrace CPU Counters, Linux perf stat cache events
#   none      skip pass 2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUT="${PROFILE_STATS_OUT:-$ROOT/profile_stats.txt}"
ART="$ROOT/build/native/profile_last"
PROFILE_MODE="${PROFILE_MODE:-auto}"
PROFILE_WORKLOAD="${PROFILE_WORKLOAD:-simulation}"
EXTRA_CLI_ARGS="${EXTRA_CLI_ARGS:-}"

PUZZLESCRIPT_CPP="${PUZZLESCRIPT_CPP:-$ROOT/build/native/puzzlescript_cpp}"
PUZZLESCRIPT_SOLVER="${PUZZLESCRIPT_SOLVER:-$ROOT/build/native/puzzlescript_solver}"
TESTDATA="${PROFILE_TESTDATA:-$ROOT/src/tests/resources/testdata.js}"
SOLVER_TESTS_DIR="${PROFILE_SOLVER_TESTS_DIR:-$ROOT/src/tests/solver_smoke_tests}"
SOLVER_GAME="${PROFILE_SOLVER_GAME:-push_goal.txt}"
SOLVER_LEVEL="${PROFILE_SOLVER_LEVEL:-0}"
SOLVER_TIMEOUT_MS="${PROFILE_SOLVER_TIMEOUT_MS:-30000}"
REPLAY_REPEATS="${PROFILE_REPLAY_REPEATS:-3}"
SAMPLE_SECONDS="${PROFILE_SAMPLE_SECONDS:-20}"

mkdir -p "$ART"

read -r -a EXTRA_ARGS <<<"$EXTRA_CLI_ARGS"

if [[ "$PROFILE_WORKLOAD" == "solver" ]]; then
  BINARY="$PUZZLESCRIPT_SOLVER"
  PROFILE_ARGS=(
    "$SOLVER_TESTS_DIR"
    --game "$SOLVER_GAME"
    --level "$SOLVER_LEVEL"
    --timeout-ms "$SOLVER_TIMEOUT_MS"
    --strategy bfs
    --no-solutions
    --jobs "${PROFILE_JOBS:-1}"
    --profile-runtime-counters
    --quiet
  )
  WORKLOAD_LABEL="solver"
elif [[ "$PROFILE_WORKLOAD" == "simulation" ]]; then
  BINARY="$PUZZLESCRIPT_CPP"
  PROFILE_ARGS=(test simulation-corpus "$TESTDATA" --profile-timers --repeat "$REPLAY_REPEATS" --progress-every 0 --jobs "${PROFILE_JOBS:-1}")
  WORKLOAD_LABEL="simulation"
else
  echo "Unsupported PROFILE_WORKLOAD=$PROFILE_WORKLOAD (expected simulation or solver)" >&2
  exit 1
fi

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  PROFILE_ARGS+=("${EXTRA_ARGS[@]}")
fi

if [[ ! -x "$BINARY" ]]; then
  echo "Missing executable: $BINARY" >&2
  echo "Try: make build" >&2
  exit 1
fi

if [[ "$PROFILE_WORKLOAD" == "simulation" && ! -f "$TESTDATA" ]]; then
  echo "Missing simulation corpus: $TESTDATA" >&2
  exit 1
fi

append_section() {
  {
    echo
    echo "===== $1 ====="
    echo
    cat "$2"
  } | tee -a "$OUT"
}

time_command() {
  if /usr/bin/time -lp true >/dev/null 2>&1; then
    /usr/bin/time -lp "$@"
  elif /usr/bin/time -v true >/dev/null 2>&1; then
    /usr/bin/time -v "$@"
  else
    "$@"
  fi
}

resolve_profile_mode() {
  if [[ "$PROFILE_MODE" != "auto" ]]; then
    return
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && command -v sample >/dev/null 2>&1; then
    PROFILE_MODE="sample"
  elif command -v perf >/dev/null 2>&1; then
    PROFILE_MODE="perf"
  else
    PROFILE_MODE="none"
  fi
}

{
  echo "===== PuzzleScript native profiling ($WORKLOAD_LABEL) ====="
  date -R
  uname -a
  sw_vers 2>/dev/null || true
  git rev-parse HEAD 2>/dev/null || true
  echo
  echo "===== Binary ====="
  file "$BINARY"
  ls -la "$BINARY"
  echo
  echo "===== Workload ====="
  echo "profile_workload=$PROFILE_WORKLOAD"
  if [[ "$PROFILE_WORKLOAD" == "simulation" ]]; then
    echo "simulation_corpus=$TESTDATA"
    echo "replay_repeats=$REPLAY_REPEATS"
  else
    echo "solver_tests_dir=$SOLVER_TESTS_DIR"
    echo "solver_game=$SOLVER_GAME"
    echo "solver_level=$SOLVER_LEVEL"
    echo "solver_timeout_ms=$SOLVER_TIMEOUT_MS"
  fi
  echo "profile_jobs=${PROFILE_JOBS:-1}"
  echo "profile_mode=$PROFILE_MODE"
  echo "command: $BINARY ${PROFILE_ARGS[*]}"
  echo
} | tee "$OUT"

echo "----- Pass 1: wall clock + native timer breakdown -----" | tee -a "$OUT"
PASS1_STDOUT="$ART/pass1.stdout"
PASS1_STDERR="$ART/pass1.stderr"
set +e
time_command "$BINARY" "${PROFILE_ARGS[@]}" >"$PASS1_STDOUT" 2>"$PASS1_STDERR"
PASS1_STATUS=$?
set -e

append_section "Pass 1 stdout" <(cat "$PASS1_STDOUT")
append_section "Pass 1 stderr (resource usage)" \
  <({ echo '--- stderr tail ---'; tail -30 "$PASS1_STDERR"; })

if [[ "$PROFILE_WORKLOAD" == "simulation" ]]; then
  append_section "Pass 1 profile summary" \
    <({ grep -E '^cpp_simulation_profile|^cpp_simulation_tests_direct' "$PASS1_STDOUT" || true; })
else
  append_section "Pass 1 profile summary" \
    <({ grep -E '^solver_runtime_counters|^solver_totals|level=' "$PASS1_STDOUT" "$PASS1_STDERR" || true; })
fi
echo "pass1_exit_status=$PASS1_STATUS" | tee -a "$OUT"

resolve_profile_mode

PASS2_STDOUT=""
PASS2_STDERR=""

if [[ "$PROFILE_MODE" == "sample" ]]; then
  echo "----- Pass 2: macOS sample(1) CPU stacks -----" | tee -a "$OUT"
  PASS2_STDOUT="$ART/pass2.stdout"
  PASS2_STDERR="$ART/pass2.stderr"
  SAMPLE_FILE="$ART/sample_native.txt"
  rm -f "$PASS2_STDOUT" "$PASS2_STDERR" "$SAMPLE_FILE"

  set +m
  "$BINARY" "${PROFILE_ARGS[@]}" >"$PASS2_STDOUT" 2>"$PASS2_STDERR" &
  CPID=$!

  sample "$CPID" "$SAMPLE_SECONDS" -mayDie -fullPaths -file "$SAMPLE_FILE" &
  SPID=$!

  set +e
  wait "$CPID"
  PASS2_STATUS=$?
  wait "$SPID"
  SAMPLE_STATUS=$?
  set -e

  append_section "Pass 2 stdout" <(cat "$PASS2_STDOUT")
  append_section "Pass 2 stderr tail" \
    <({ echo '--- stderr tail ---'; tail -20 "$PASS2_STDERR"; })

  if [[ "$PROFILE_WORKLOAD" == "simulation" ]]; then
    append_section "Pass 2 profile summary" \
      <({ grep -E '^cpp_simulation_profile|^cpp_simulation_tests_direct' "$PASS2_STDOUT" || true; })
  else
    append_section "Pass 2 profile summary" \
      <({ grep -E '^solver_runtime_counters|^solver_totals|level=' "$PASS2_STDOUT" "$PASS2_STDERR" || true; })
  fi

  {
    echo "pass2_exit_status=$PASS2_STATUS"
    echo "sample_exit_status=$SAMPLE_STATUS"
    if [[ -f "$SAMPLE_FILE" ]]; then
      echo
      echo "===== Hot stacks: sample(1), sorted by top of stack ====="
      echo
      grep -A 140 "Sort by top of stack, same collapsed" "$SAMPLE_FILE" | head -110 || true
      echo
      echo "===== sample(1) call graph preview ====="
      echo
      head -140 "$SAMPLE_FILE" || true
    else
      echo
      echo "sample(1) did not produce a stack file. On recent macOS versions this can"
      echo "require elevated permissions; try PROFILE_MODE=counters or Instruments."
    fi
  } | tee -a "$OUT"
elif [[ "$PROFILE_MODE" == "perf" ]]; then
  echo "----- Pass 2: Linux perf record/report -----" | tee -a "$OUT"
  PASS2_STDOUT="$ART/pass2.stdout"
  PASS2_STDERR="$ART/pass2.stderr"
  PERF_DATA="$ART/perf.data"
  PERF_REPORT="$ART/perf_report.txt"
  rm -f "$PASS2_STDOUT" "$PASS2_STDERR" "$PERF_DATA" "$PERF_REPORT"

  set +e
  perf record -g -o "$PERF_DATA" -- "$BINARY" "${PROFILE_ARGS[@]}" >"$PASS2_STDOUT" 2>"$PASS2_STDERR"
  PASS2_STATUS=$?
  perf report --stdio -i "$PERF_DATA" >"$PERF_REPORT" 2>/dev/null
  PERF_REPORT_STATUS=$?
  set -e

  append_section "Pass 2 stdout" <(cat "$PASS2_STDOUT")
  append_section "Pass 2 stderr (perf output)" \
    <({ echo '--- stderr tail ---'; tail -30 "$PASS2_STDERR"; })

  {
    echo "pass2_exit_status=$PASS2_STATUS"
    echo "perf_report_exit_status=$PERF_REPORT_STATUS"
    echo
    echo "===== perf report preview ====="
    echo
    head -160 "$PERF_REPORT" || true
  } | tee -a "$OUT"
elif [[ "$PROFILE_MODE" == "counters" ]]; then
  echo "----- Pass 2: hardware cache/CPU counters -----" | tee -a "$OUT"
  PASS2_STDOUT="$ART/pass2_counters.stdout"
  PASS2_STDERR="$ART/pass2_counters.stderr"
  rm -f "$PASS2_STDOUT" "$PASS2_STDERR"

  if [[ "$(uname -s)" == "Darwin" ]] && command -v xcrun >/dev/null 2>&1; then
    TRACE_FILE="$ART/cpu_counters.trace"
    rm -rf "$TRACE_FILE"
    set +e
    xcrun xctrace record --template 'CPU Counters' --quiet --no-prompt --launch --output "$TRACE_FILE" -- \
      "$BINARY" "${PROFILE_ARGS[@]}" >"$PASS2_STDOUT" 2>"$PASS2_STDERR"
    PASS2_STATUS=$?
    set -e
    append_section "Pass 2 stdout" <(cat "$PASS2_STDOUT")
    append_section "Pass 2 stderr" <(cat "$PASS2_STDERR")
  elif command -v perf >/dev/null 2>&1; then
    PERF_STAT_FILE="$ART/perf_stat.txt"
    rm -f "$PERF_STAT_FILE"
    set +e
    perf stat -e cycles,instructions,cache-references,cache-misses,L1-dcache-load-misses,LLC-load-misses \
      -o "$PERF_STAT_FILE" -- "$BINARY" "${PROFILE_ARGS[@]}" >"$PASS2_STDOUT" 2>"$PASS2_STDERR"
    PASS2_STATUS=$?
    set -e
    append_section "Pass 2 stdout" <(cat "$PASS2_STDOUT")
    append_section "Pass 2 perf stat" <(cat "$PERF_STAT_FILE")
    append_section "Pass 2 stderr" \
      <({ echo '--- stderr tail ---'; tail -30 "$PASS2_STDERR"; })
  else
    echo "PROFILE_MODE=counters requires macOS xctrace or Linux perf." | tee -a "$OUT"
    PASS2_STATUS=127
  fi
  echo "pass2_exit_status=$PASS2_STATUS" | tee -a "$OUT"
else
  echo "----- Pass 2 skipped: PROFILE_MODE=$PROFILE_MODE -----" | tee -a "$OUT"
fi

{
  echo
  echo "===== Artifacts ====="
  echo "  $PASS1_STDOUT"
  echo "  $PASS1_STDERR"
  if [[ -n "${PASS2_STDOUT:-}" ]]; then echo "  $PASS2_STDOUT"; fi
  if [[ -n "${PASS2_STDERR:-}" ]]; then echo "  $PASS2_STDERR"; fi
  if [[ -f "$ART/sample_native.txt" ]]; then echo "  $ART/sample_native.txt"; fi
  if [[ -f "$ART/perf.data" ]]; then echo "  $ART/perf.data"; fi
  if [[ -f "$ART/perf_report.txt" ]]; then echo "  $ART/perf_report.txt"; fi
  if [[ -d "$ART/cpu_counters.trace" ]]; then echo "  $ART/cpu_counters.trace"; fi
  if [[ -f "$ART/perf_stat.txt" ]]; then echo "  $ART/perf_stat.txt"; fi
  echo
  echo "Examples:"
  echo "  PROFILE_WORKLOAD=solver PROFILE_MODE=counters make profile_solver_tests"
  echo "  PROFILE_MODE=counters make profile_simulation_tests"
  echo
  echo "For Instruments UI on macOS:"
  echo "  xcrun xctrace record --template 'CPU Counters' --quiet --launch --output $ART/cpu_counters.trace -- \\"
  echo "    \"$BINARY\" ${PROFILE_ARGS[*]}"
} | tee -a "$OUT"

echo "Wrote $OUT (see also $ART/)" | tee -a "$OUT"
