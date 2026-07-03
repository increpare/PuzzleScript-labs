# Compact C++ workflow:
#   make build             Build build/native/puzzlescript_cpp.
#   make run game.txt      Build and play a PuzzleScript source file.
#   make ctest             Run fast C++ smoke/unit tests registered with CMake.
#   make js_parity_tests   Run C++ against the original JS test corpus.
#   make rule_plan_parity_tests
#                           Compare JS/native game.rule_plan_v1 for simulation-corpus games.
#   make simulation_tests  Run JS simulation tests and direct C++ simulation tests.
#   make compilation_tests Run JS compiler tests and direct C++ compiler tests.
#   make profile_simulation_tests
#                           Profile the C++ simulation replay workload.
#   make simulation_tests_cpp_32
#                           Run direct C++ simulation tests with JS-style 32-bit mask words.
#   make tests             Run the full native correctness suite.

.DEFAULT_GOAL := help

.PHONY: help build build_32 build_solver build_generator build_simplify generator remix simplify solver run ctest tests all_tests_thorough js_parity_tests tests_js static_analysis_tests static_analysis_runtime_contracts static_analysis_performance_tests static_analysis_explorer static_analysis_fuzz static_analysis_consistency_giant static_analysis_corpus_audit_giant canonicalization_fuzz canonicalizer_giant_corpus compile_exception_corpus compile_exception_corpus_nodupes fuzz_corpus_batch fuzz_corpus_batch_giant fuzz_corpus_batch_single fuzz_corpus_batch_parallel simulation_tests_js simulation_tests_js_profile simulation_tests_js_profile_breakdown compilation_tests_js performance_testpage \
	simulation_tests_cpp compilation_tests_cpp simulation_tests compilation_tests simulation_corpus_interpreter_benchmark simulation_corpus_compiled_rulegroups_benchmark simulation_corpus_compiled_compact_benchmark simulation_corpus_perf_report simulation_corpus_perf_report_quick \
	simulation_tests_cpp_32 compilation_tests_cpp_32 \
	solver_tests_cpp solver_tests_js solver_tests solver_timeout_curve solver-time-curve-single-game solver-time-curve-single-game-hda-compiled solver_timeout_curve_replot solver_js_coverage_cpp solver_smoke_tests solver_search_mode_tests solver_determinism_tests solver_parity_smoke solver_portfolio_regression_tests native_static_analysis_parity_tests native_static_analysis_native_parity_tests native_static_analysis_fallback_parity_tests native_static_analysis_fallback_soundness_tests solver_compact_parity_smoke solver_compact_parity solver_benchmark solver_mine_pippable solver_focus_mine solver_focus_manifest_check solver_focus_benchmark solver_focus_compare solver_focus_compact_compare solver_focus_compact_codegen_compare solver_corpus_manifest solver_corpus_compact_codegen_compare solver_focus_perf_report solver_focus_compact_perf_report solver_focus_compact_codegen_perf_report solver_benchmark_targets solver_instrumentation_pack solver_instrumentation_analysis solver_instrumentation_analysis_tests js_static_optimization_comparison_solver_smoke js_static_optimization_comparison_solver_focus solver_canonical_replay solver_canonical_replay_long canonical_roundtrip_replay static_optimizer_page generator_smoke_tests generator_benchmark \
	simulation_tests_cpp_js_parity compilation_tests_cpp_direct \
	compiled_rules_simulation_suite_coverage compiled_rules_coverage_shape_smoke specialized_full_turn_dispatch_smoke compiled_tick_dispatch_smoke compact_turn_oracle_smoke compact_turn_simulation_tests compact_turn_coverage compact_turn_codegen_coverage compact_turn_native_parity compact_turn_codegen_bringup compact_turn_codegen_solver_parity compact_turn_codegen_regression_tests compact_turn_codegen_dirty_shape compact_turn_perf_regression compact_turn_codegen_solver_command_api compact_turn_codegen_frontier compact_turn_codegen_testdata_one compact_tick_oracle_smoke compact_tick_simulation_tests compact_tick_coverage \
	compact_turn_codegen_selected_tests compact_turn_codegen_simulation_tests \
	rule_plan_parity_tests \
	profile_simulation_tests profile_simulation_tests_32 basic_test_suite_cpp basic_test_suite_js \
	parser_corpus_errormessage_bundle parser_corpus_testdata_bundle clean clean-native \
	clean-native-32 clean-js-parity-data configure-native build-native js-parity-data

NODE ?= node
CMAKE ?= cmake
BUILD_DIR ?= build
BUILD_DIR_32 ?= build-32
PERFORMANCE_TESTPAGE_OUT ?= $(BUILD_DIR)/performance-testpage
PERFORMANCE_TESTPAGE_QUICK ?= false
PERFORMANCE_TESTPAGE_PROFILE ?= false
STATIC_ANALYSIS_EXPLORER_OUT ?= $(BUILD_DIR)/static-analysis-explorer/index.html
STATIC_ANALYSIS_EXPLORER_INPUTS ?= src/tests/solver_tests
STATIC_ANALYSIS_EXPLORER_GAME ?=
CANONICALIZATION_FUZZ_ARGS ?=
# Large-corpus fuzz batch (see src/tests/fuzz_corpus_batch.js).
# Set FUZZ_BATCH_CORPUS or PUZZLESCRIPT_FUZZ_CORPUS to the gist dump path for overnight runs.
FUZZ_BATCH_CORPUS ?= $(if $(PUZZLESCRIPT_FUZZ_CORPUS),$(PUZZLESCRIPT_FUZZ_CORPUS),src/tests/solver_tests)
FUZZ_BATCH_JOBS ?= 8
FUZZ_BATCH_MODE ?= both
FUZZ_BATCH_OUT ?= $(BUILD_DIR)/fuzz-batch
FUZZ_BATCH_ARGS ?=
FUZZ_BATCH_START ?=
FUZZ_BATCH_END ?=
FUZZ_BATCH_START_ARG = $(if $(strip $(FUZZ_BATCH_START)),--start $(FUZZ_BATCH_START),)
FUZZ_BATCH_END_ARG = $(if $(strip $(FUZZ_BATCH_END)),--end $(FUZZ_BATCH_END),)
FUZZ_BATCH_RESUME_FLAG = $(if $(filter true,$(FUZZ_BATCH_RESUME)),--resume,)
FUZZ_BATCH_FRESH_FLAG = $(if $(filter true,$(FUZZ_BATCH_FRESH)),--fresh,)
# ~30k-game gist scrape corpus (override FUZZ_BATCH_GIANT_CORPUS if your path differs).
FUZZ_BATCH_GIANT_CORPUS ?= $(HOME)/Documents/google_gist_scraper/dumpprocessed_compiles
FUZZ_BATCH_GIANT_OUT ?= $(BUILD_DIR)/fuzz-batch-giant
STATIC_ANALYSIS_GIANT_CORPUS ?= $(FUZZ_BATCH_GIANT_CORPUS)
STATIC_ANALYSIS_GIANT_OUT ?= $(BUILD_DIR)/static-analysis-audit-giant
STATIC_ANALYSIS_GIANT_JOBS ?= 8
STATIC_ANALYSIS_FRESH_FLAG = $(if $(filter true,$(STATIC_ANALYSIS_FRESH)),--fresh,)
STATIC_ANALYSIS_RESUME_FLAG = $(if $(filter true,$(STATIC_ANALYSIS_RESUME)),--resume,)
# Canonicalizer round-trip compile audit over the ~30k gist corpus (slow; not in make tests).
CANONICALIZER_GIANT_CORPUS ?= $(FUZZ_BATCH_GIANT_CORPUS)
CANONICALIZER_GIANT_OUT ?= $(BUILD_DIR)/canonicalizer-audit-giant
CANONICALIZER_GIANT_JOBS ?= 8
CANONICALIZER_GIANT_FRESH_FLAG = $(if $(filter true,$(CANONICALIZER_GIANT_FRESH)),--fresh,)
CANONICALIZER_GIANT_RESUME_FLAG = $(if $(filter true,$(CANONICALIZER_GIANT_RESUME)),--resume,)
CANONICALIZER_GIANT_EXIT_ON_FAILURE_FLAG = $(if $(filter true,$(CANONICALIZER_GIANT_EXIT_ON_FAILURE)),--exit-on-failure,)
# Raw gist scrape corpus (~33k games) for compile-exception hardening (slow; not in make tests).
COMPILE_EXCEPTION_CORPUS ?= $(HOME)/Documents/google_gist_scraper/dumpprocessed_nodupes
COMPILE_EXCEPTION_OUT ?= $(BUILD_DIR)/compile-exception-audit
COMPILE_EXCEPTION_JOBS ?= 8
COMPILE_EXCEPTION_COMPILER ?= both
COMPILE_EXCEPTION_JS_MODE ?= both
COMPILE_EXCEPTION_FRESH_FLAG = $(if $(filter true,$(COMPILE_EXCEPTION_FRESH)),--fresh,)
COMPILE_EXCEPTION_RESUME_FLAG = $(if $(filter true,$(COMPILE_EXCEPTION_RESUME)),--resume,)
COMPILE_EXCEPTION_EXIT_ON_FAILURE_FLAG = $(if $(filter true,$(COMPILE_EXCEPTION_EXIT_ON_FAILURE)),--exit-on-failure,)
COMPILE_EXCEPTION_CPP_CLI_ARG = $(if $(strip $(COMPILE_EXCEPTION_CPP_CLI)),--cpp-cli "$(COMPILE_EXCEPTION_CPP_CLI)",--cpp-cli "$(PUZZLESCRIPT_CPP)")
PUZZLESCRIPT_CPP := $(BUILD_DIR)/native/puzzlescript_cpp
PUZZLESCRIPT_CPP_32 := $(BUILD_DIR_32)/native/puzzlescript_cpp
PUZZLESCRIPT_SOLVER := $(BUILD_DIR)/native/puzzlescript_solver
PUZZLESCRIPT_GENERATOR := $(BUILD_DIR)/native/puzzlescript_generator
PUZZLESCRIPT_SIMPLIFY := $(BUILD_DIR)/native/puzzlescript_simplify
GENERATOR_MAKE_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
GENERATOR_GAME := $(word 1,$(GENERATOR_MAKE_ARGS))
GENERATOR_SPEC := $(word 2,$(GENERATOR_MAKE_ARGS))
GENERATOR_ARGS ?=
REMIX_MAKE_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
REMIX_IN := $(word 1,$(REMIX_MAKE_ARGS))
REMIX_OUT := $(word 2,$(REMIX_MAKE_ARGS))
REMIX_ARGS ?=
REMIX_INACTIVITY_START ?= 10s
REMIX_JOBS ?= auto
REMIX_SEED ?= 1
REMIX_SOLVER_TIMEOUT_MS ?= 500
SOLVER_MAKE_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
SOLVER_GAME := $(word 1,$(SOLVER_MAKE_ARGS))
SOLVER_ARGS ?=
SOLVER_TIMEOUT_MS ?= 250
SOLVER_TESTS_CORPUS ?= src/tests/solver_tests
SOLVER_JOBS ?= 1
SOLVER_STRATEGY ?= portfolio
SOLVER_PROGRESS_EVERY ?= game
SOLVER_OUTPUT_ARGS ?= --summary-only
SOLVER_SOLUTIONS_DIR ?= $(BUILD_DIR)/solver-solutions
SOLVER_JS_COVERAGE_TIMEOUT_MS ?= 1000
SOLVER_JS_COVERAGE_STRATEGY ?= $(SOLVER_STRATEGY)
SOLVER_JS_COVERAGE_JOBS ?= 1
SOLVER_JS_COVERAGE_OUT_DIR ?= $(BUILD_DIR)/solver-js-coverage
SOLVER_JS_COVERAGE_JS_RESULTS ?=
SOLVER_JS_COVERAGE_NATIVE_RESULTS ?=
SOLVER_JS_COVERAGE_JS_RESULTS_ARG = $(if $(strip $(SOLVER_JS_COVERAGE_JS_RESULTS)),--js-results "$(SOLVER_JS_COVERAGE_JS_RESULTS)",)
SOLVER_JS_COVERAGE_NATIVE_RESULTS_ARG = $(if $(strip $(SOLVER_JS_COVERAGE_NATIVE_RESULTS)),--native-results "$(SOLVER_JS_COVERAGE_NATIVE_RESULTS)",)
SOLVER_INSTRUMENTATION_OUT_DIR ?= $(BUILD_DIR)/native/solver_instrumentation_pack
SOLVER_INSTRUMENTATION_TIMEOUT_MS ?= 1000
SOLVER_INSTRUMENTATION_RUNS ?= 1
SOLVER_INSTRUMENTATION_MAX_TARGETS ?= 40
SOLVER_INSTRUMENTATION_JS_RESULTS ?= $(wildcard $(SOLVER_TIMEOUT_CURVE_JS_JSON))
SOLVER_INSTRUMENTATION_NATIVE_RESULTS ?= $(wildcard $(SOLVER_TIMEOUT_CURVE_CPP_JSON))
SOLVER_INSTRUMENTATION_MANIFESTS ?=
SOLVER_INSTRUMENTATION_PROFILE_COUNTERS ?= true
SOLVER_INSTRUMENTATION_DRY_RUN ?= false
SOLVER_INSTRUMENTATION_JS_RESULTS_ARG = $(if $(strip $(SOLVER_INSTRUMENTATION_JS_RESULTS)),--js-results "$(SOLVER_INSTRUMENTATION_JS_RESULTS)",)
SOLVER_INSTRUMENTATION_NATIVE_RESULTS_ARG = $(if $(strip $(SOLVER_INSTRUMENTATION_NATIVE_RESULTS)),--native-results "$(SOLVER_INSTRUMENTATION_NATIVE_RESULTS)",)
SOLVER_INSTRUMENTATION_PROFILE_COUNTERS_ARG = $(if $(filter true,$(SOLVER_INSTRUMENTATION_PROFILE_COUNTERS)),--profile-runtime-counters,)
SOLVER_INSTRUMENTATION_DRY_RUN_ARG = $(if $(filter true,$(SOLVER_INSTRUMENTATION_DRY_RUN)),--dry-run,)
SOLVER_INSTRUMENTATION_MANIFEST_ARGS = $(foreach manifest,$(SOLVER_INSTRUMENTATION_MANIFESTS),--manifest "$(manifest)")
SOLVER_INSTRUMENTATION_ANALYSIS_SUMMARY ?= $(SOLVER_INSTRUMENTATION_OUT_DIR)/summary.json
SOLVER_INSTRUMENTATION_ANALYSIS_FORMAT ?= text
SOLVER_INSTRUMENTATION_ANALYSIS_MIN_SUPPORT ?= 3
SOLVER_INSTRUMENTATION_ANALYSIS_SLOW_LOSS_MS ?= 100
SOLVER_INSTRUMENTATION_ANALYSIS_TOP_TAGS ?= 20
SOLVER_INSTRUMENTATION_ANALYSIS_OUT ?=
SOLVER_INSTRUMENTATION_ANALYSIS_OUT_ARG = $(if $(strip $(SOLVER_INSTRUMENTATION_ANALYSIS_OUT)),--out "$(SOLVER_INSTRUMENTATION_ANALYSIS_OUT)",)
# JS solver: baseline vs --solver-opt all JSON diff (see js_static_optimization_comparison_*).
JS_STATIC_OPTIMIZATION_COMPARE_OUT ?= $(BUILD_DIR)/js-static-optimization-compare
JS_STATIC_OPTIMIZATION_COMPARE_EXTRA_ARGS ?=
ACTION_NOOP_CANDIDATES_OUT ?= $(BUILD_DIR)/action-noop-candidates/focus.json
ACTION_NOOP_CANDIDATES_BASELINE_JSON ?=
ACTION_NOOP_CANDIDATES_FORCED_NOACTION_JSON ?=
ACTION_NOOP_CANDIDATES_BASELINE_ARG = $(if $(strip $(ACTION_NOOP_CANDIDATES_BASELINE_JSON)),--baseline-json "$(ACTION_NOOP_CANDIDATES_BASELINE_JSON)",)
ACTION_NOOP_CANDIDATES_FORCED_ARG = $(if $(strip $(ACTION_NOOP_CANDIDATES_FORCED_NOACTION_JSON)),--forced-noaction-json "$(ACTION_NOOP_CANDIDATES_FORCED_NOACTION_JSON)",)
# HTML + JSON summary: baseline vs --solver-opt all over a JS solver corpus (slow on full solver_tests).
STATIC_OPTIMIZER_PAGE_CORPUS ?= $(SOLVER_TESTS_CORPUS)
STATIC_OPTIMIZER_PAGE_OUT ?= $(BUILD_DIR)/static-optimizer-report/index.html
STATIC_OPTIMIZER_PAGE_TIMEOUT_MS ?= $(SOLVER_TIMEOUT_MS)
STATIC_OPTIMIZER_PAGE_GAME ?=
STATIC_OPTIMIZER_PAGE_GAME_ARG = $(if $(strip $(STATIC_OPTIMIZER_PAGE_GAME)),--game "$(STATIC_OPTIMIZER_PAGE_GAME)",)
SOLVER_COMPACT_PARITY_CORPUS ?= src/tests/solver_tests
SOLVER_COMPACT_PARITY_TIMEOUT_MS ?= 1000
SOLVER_COMPACT_PARITY_STRATEGY ?= bfs
SOLVER_COMPACT_PARITY_GAME ?=
SOLVER_COMPACT_PARITY_LEVEL ?=
SOLVER_COMPACT_PARITY_MAX_GAMES ?=
COMPACT_TURN_CODEGEN_REGRESSION_CORPUS ?= src/tests/compact_turn_regression_tests
COMPACT_TURN_PERF_TIMEOUT_MS ?= 1000
COMPACT_TURN_CODEGEN_PERF_TIMEOUT_MS ?= 1000
COMPACT_TURN_CODEGEN_PERF_CASES ?= src/tests/compact_turn_codegen_perf_cases.json
COMPACT_TURN_CODEGEN_PERF_EXPECTATIONS ?= src/tests/compact_turn_codegen_perf_expectations.json
COMPACT_TURN_CODEGEN_PERF_OUT ?= build/compact-turn-codegen-perf-suite.json
SOLVER_COMPACT_PARITY_GAME_ARG = $(if $(SOLVER_COMPACT_PARITY_GAME),--game "$(SOLVER_COMPACT_PARITY_GAME)",)
SOLVER_COMPACT_PARITY_LEVEL_ARG = $(if $(SOLVER_COMPACT_PARITY_LEVEL),--level $(SOLVER_COMPACT_PARITY_LEVEL),)
SOLVER_COMPACT_PARITY_MAX_GAMES_ARG = $(if $(SOLVER_COMPACT_PARITY_MAX_GAMES),--max-games $(SOLVER_COMPACT_PARITY_MAX_GAMES),)
SOLVER_CORPUS_MANIFEST ?= $(BUILD_DIR)/native/solver_corpus_manifest.json
SOLVER_CORPUS_RUNS ?= 1
SOLVER_CORPUS_MAX_GAMES ?=
SOLVER_CORPUS_MAX_TARGETS ?=
SOLVER_CORPUS_MANIFEST_MAX_GAMES_ARG = $(if $(SOLVER_CORPUS_MAX_GAMES),--max-games $(SOLVER_CORPUS_MAX_GAMES),)
SOLVER_CORPUS_MANIFEST_MAX_TARGETS_ARG = $(if $(SOLVER_CORPUS_MAX_TARGETS),--max-targets $(SOLVER_CORPUS_MAX_TARGETS),)
SOLVER_CORPUS_INTERPRETED_OUT ?= $(BUILD_DIR)/native/solver_corpus_benchmark_interpreted_compact_codegen.json
SOLVER_CORPUS_COMPILED_OUT ?= $(BUILD_DIR)/native/solver_corpus_benchmark_compiled_compact_codegen.json
SOLVER_CORPUS_JOBS ?= 8
SOLVER_BENCH_RUNS ?= 5
SOLVER_BENCH_TIMEOUT_MS ?= 250
SOLVER_BENCH_CORPUS ?= src/tests/solver_tests
SOLVER_BENCH_OUT ?= $(BUILD_DIR)/native/solver_benchmark.json
SOLVER_PERF_BASELINE ?= solver_perf_baseline.json
SOLVER_BENCH_JOBS ?= 1
SOLVER_BENCH_STRATEGY ?= portfolio
# Cumulative solve curve: JS + PuzzleScriptPlus naive + native C++ solvers.
SOLVER_TIMEOUT_CURVE_MAX_MS ?= 1000
SOLVER_TIMEOUT_CURVE_STEP_MS ?= 50
SOLVER_TIMEOUT_CURVE_OUT_DIR ?= $(BUILD_DIR)/solver-timeout-curve
SOLVER_TIMEOUT_CURVE_JS_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/js.json
SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/js-canonical.json
SOLVER_TIMEOUT_CURVE_CANONICAL_CORPUS ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/canonical-corpus
SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/cpp-portfolio.json
SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_CANONICAL_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/cpp-portfolio-canonical.json
SOLVER_TIMEOUT_CURVE_CPP_HDA_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/cpp-hda-weighted-astar-8.json
SOLVER_TIMEOUT_CURVE_CPP_HDA_CANONICAL_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/cpp-hda-weighted-astar-8-canonical.json
SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/cpp-portfolio-compiled.json
SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/cpp-hda-weighted-astar-8-compiled.json
SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_CANONICAL_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/cpp-portfolio-compiled-canonical.json
SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_CANONICAL_JSON ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/cpp-hda-weighted-astar-8-compiled-canonical.json
SOLVER_TIMEOUT_CURVE_CPP_JSON ?= $(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_JSON)
SOLVER_TIMEOUT_CURVE_SVG ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/solver_timeout_curve.svg
SOLVER_TIMEOUT_CURVE_CSV ?= $(SOLVER_TIMEOUT_CURVE_OUT_DIR)/solver_timeout_curve.csv
SOLVER_TIMEOUT_CURVE_EXTRA_ARGS ?=
SOLVER_TIMEOUT_CURVE_JS_ARGS ?= --strategy portfolio
SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_ARGS ?= --jobs 1 --strategy portfolio
SOLVER_TIMEOUT_CURVE_CPP_HDA_ARGS ?= --strategy hda-weighted-astar --hda-jobs 8
SOLVER_TIMEOUT_CURVE_CPP_COMPILED_RULES_ARGS ?= --compact-turn-only --compact-turn-mode=compiler
SOLVER_TIMEOUT_CURVE_COMPILED_RULES_OPT_LEVEL ?= 3
SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_ARGS ?= --compact-node-storage --jobs 1 --strategy portfolio
SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_ARGS ?= --compact-node-storage --strategy hda-weighted-astar --hda-jobs 8
SOLVER_TIMEOUT_CURVE_PROGRESS ?= per-game
SOLVER_TIMEOUT_CURVE_PROGRESS_ARGS = $(if $(filter per-game,$(SOLVER_TIMEOUT_CURVE_PROGRESS)),--progress-per-game,$(if $(filter quiet,$(SOLVER_TIMEOUT_CURVE_PROGRESS)),--quiet,--progress-every $(SOLVER_TIMEOUT_CURVE_PROGRESS)))
SOLVER_TIMEOUT_CURVE_SINGLE_GAME := $(word 2,$(MAKECMDGOALS))
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE := $(notdir $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME))
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_STEM := $(basename $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE))
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_DEFAULT_OUT_DIR := $(BUILD_DIR)/solver-timeout-curve-$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_STEM)-$(SOLVER_TIMEOUT_CURVE_MAX_MS)ms
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_OUT_DIR := $(if $(filter file,$(origin SOLVER_TIMEOUT_CURVE_OUT_DIR)),$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_DEFAULT_OUT_DIR),$(SOLVER_TIMEOUT_CURVE_OUT_DIR))
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_CORPUS_DIR := $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_OUT_DIR)/input-corpus
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_OUT_DIR := $(if $(filter file,$(origin SOLVER_TIMEOUT_CURVE_OUT_DIR)),$(BUILD_DIR)/solver-timeout-curve-$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_STEM)-$(SOLVER_TIMEOUT_CURVE_MAX_MS)ms-hda-compiled,$(SOLVER_TIMEOUT_CURVE_OUT_DIR))
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_CORPUS_DIR := $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_OUT_DIR)/input-corpus
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_JSON := $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_OUT_DIR)/cpp-hda-weighted-astar-8-compiled.json
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_SVG := $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_OUT_DIR)/solver_timeout_curve.svg
SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_CSV := $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_OUT_DIR)/solver_timeout_curve.csv
ifneq ($(filter solver-time-curve-single-game solver-time-curve-single-game-hda-compiled,$(MAKECMDGOALS)),)
ifneq ($(strip $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME)),)
.PHONY: $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME)
$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME):
	@:
endif
endif
SOLVER_MINE_CORPUS ?= src/tests/solver_tests
SOLVER_MINE_TIMEOUTS_MS ?= 50,100,250,500
SOLVER_MINE_STRATEGY ?= portfolio
SOLVER_MINE_NEAR_RATIO ?= 0.5
SOLVER_MINE_MAX_TARGETS ?=
SOLVER_PIPPABLE_MANIFEST ?= $(BUILD_DIR)/native/solver_pippable_targets.json
SOLVER_FOCUS_CORPUS ?= $(SOLVER_TESTS_CORPUS)
SOLVER_FOCUS_MANIFEST ?= src/tests/solver_focus_group.json
SOLVER_FOCUS_LONG_MANIFEST ?= src/tests/solver_focus_long_group.json
SOLVER_CANONICAL_REPLAY_TIMEOUT_MS ?= $(SOLVER_FOCUS_TIMEOUT_MS)
SOLVER_CANONICAL_REPLAY_LONG_TIMEOUT_MS ?= 2000
SOLVER_FOCUS_OUT ?= $(BUILD_DIR)/native/solver_focus_benchmark.json
SOLVER_FOCUS_INTERPRETED_OUT ?= $(BUILD_DIR)/native/solver_focus_benchmark_interpreted.json
SOLVER_FOCUS_COMPILED_OUT ?= $(BUILD_DIR)/native/solver_focus_benchmark_compiled$(if $(filter true,$(COMPILED_RULES_PERF)),_perf,).json
SOLVER_FOCUS_COMPACT_COMPILED_OUT ?= $(BUILD_DIR)/native/solver_focus_benchmark_compiled_compact$(if $(filter true,$(COMPILED_RULES_PERF)),_perf,).json
SOLVER_FOCUS_COMPACT_CODEGEN_COMPILED_OUT ?= $(BUILD_DIR)/native/solver_focus_benchmark_compiled_compact_codegen$(if $(filter true,$(COMPILED_RULES_PERF)),_perf,).json
SOLVER_FOCUS_PERF_INTERPRETED_OUT ?= $(BUILD_DIR)/native/solver_focus_perf_interpreted.json
SOLVER_FOCUS_PERF_COMPILED_OUT ?= $(BUILD_DIR)/native/solver_focus_perf_compiled.json
SOLVER_FOCUS_COMPACT_PERF_COMPILED_OUT ?= $(BUILD_DIR)/native/solver_focus_perf_compiled_compact.json
SOLVER_FOCUS_COMPACT_CODEGEN_PERF_COMPILED_OUT ?= $(BUILD_DIR)/native/solver_focus_perf_compiled_compact_codegen.json
COMPACT_TURN_CODEGEN_COMMAND_API_SOURCE ?= native/tests/compact_turn_solver_command_api.txt
SOLVER_FOCUS_TIMEOUT_MS ?= 500
SOLVER_FOCUS_MIN_ELAPSED_MS ?= 250
SOLVER_FOCUS_MAX_TARGETS ?= 50
SOLVER_FOCUS_STRATEGY ?= $(SOLVER_STRATEGY)
SOLVER_FOCUS_JOBS ?= 1
SOLVER_FOCUS_BENCHMARK_JOBS ?= $(SOLVER_FOCUS_JOBS)
SOLVER_FOCUS_RUNS ?= 1
SOLVER_FOCUS_EXCLUDE_GAMES ?=
SOLVER_FOCUS_EXCLUDE_GAMES_ARG = $(if $(SOLVER_FOCUS_EXCLUDE_GAMES),--exclude-games "$(SOLVER_FOCUS_EXCLUDE_GAMES)",)
SOLVER_FOCUS_PROFILE_COUNTERS ?= false
SOLVER_FOCUS_PROFILE_COUNTERS_ARG = $(if $(filter true,$(SOLVER_FOCUS_PROFILE_COUNTERS)),--profile-runtime-counters,)
SOLVER_FOCUS_SOLVER_ARGS ?=
SOLVER_FOCUS_SOLVER_ARG_ARGS = $(foreach arg,$(SOLVER_FOCUS_SOLVER_ARGS),--solver-arg "$(arg)")
SOLVER_FOCUS_COMPILED_RULES_ARGS ?=
SOLVER_FOCUS_COMPACT_SOLVER_ARGS ?= --compact-node-storage
SOLVER_FOCUS_COMPACT_SOLVER_ARG_ARGS = $(foreach arg,$(SOLVER_FOCUS_COMPACT_SOLVER_ARGS),--solver-arg "$(arg)")
SOLVER_FOCUS_COMPACT_CODEGEN_INTERPRETED_SOLVER_ARGS ?= --compact-node-storage --no-compact-turn-search
SOLVER_FOCUS_COMPACT_CODEGEN_INTERPRETED_SOLVER_ARG_ARGS = $(foreach arg,$(SOLVER_FOCUS_COMPACT_CODEGEN_INTERPRETED_SOLVER_ARGS),--solver-arg "$(arg)")
SOLVER_FOCUS_PARITY_STRATEGY ?= weighted-astar
SOLVER_FOCUS_PARITY_TIMEOUT_MS ?= 10000
SOLVER_FOCUS_COMPACT_CODEGEN_RULES_ARGS ?= --compact-turn-only --compact-turn-mode=compiler
# Compile-probe timeout only affects mining (solver_focus_mine). Default is
# disabled so `make solver_focus_mine` always yields a usable focus set.
# Set this to a non-zero value (e.g. 60) if you want mining to exclude targets
# that cannot be specialized within the time/budget constraints.
SOLVER_FOCUS_PROBE_TIMEOUT_SECONDS ?= 0
SOLVER_FOCUS_COMPILE_TIMEOUT_SECONDS ?= $(if $(filter true,$(COMPILED_RULES_PERF)),180,60)
SOLVER_FOCUS_COMPILE_TIMEOUT_PREFIX = $(if $(filter-out 0,$(SOLVER_FOCUS_COMPILE_TIMEOUT_SECONDS)),$(NODE) src/tests/run_with_timeout.js $(SOLVER_FOCUS_COMPILE_TIMEOUT_SECONDS) --,)
SOLVER_FOCUS_COMPILE_PROBE_ROOT ?= $(BUILD_DIR)/native/solver_focus_compile_probes
SOLVER_FOCUS_COMPILE_PROBE_JOBS ?= auto
SOLVER_FOCUS_COMPILE_BUILD_JOBS ?= 1
COMPILED_RULES_PERF ?= false
SOLVER_FOCUS_COMPILED_RULES_MAX_ROWS ?= 99
# Limit codegen size per source for focus builds.
#
# If these are too low, "compiled" focus runs become misleading because the
# biggest focus sources are skipped and their specialized backends never attach.
# For perf runs, allow larger per-source outputs so the report reflects actual
# specialization rather than fallback.
SOLVER_FOCUS_MAX_COMPILED_RULES_PER_SOURCE ?= $(if $(filter true,$(COMPILED_RULES_PERF)),5000,500)
SOLVER_FOCUS_MAX_COMPILED_RULES_PER_SOURCE_ARG = $(if $(SOLVER_FOCUS_MAX_COMPILED_RULES_PER_SOURCE),--max-compiled-rules-per-source $(SOLVER_FOCUS_MAX_COMPILED_RULES_PER_SOURCE),)
SOLVER_FOCUS_MAX_GENERATED_LINES_PER_SOURCE ?= $(if $(filter true,$(COMPILED_RULES_PERF)),200000,20000)
SOLVER_FOCUS_MAX_GENERATED_LINES_PER_SOURCE_ARG = $(if $(SOLVER_FOCUS_MAX_GENERATED_LINES_PER_SOURCE),--max-generated-lines-per-source $(SOLVER_FOCUS_MAX_GENERATED_LINES_PER_SOURCE),)
SOLVER_FOCUS_MINE_MAX_COMPILED_RULES_PER_SOURCE_ARG = $(if $(SOLVER_FOCUS_MAX_COMPILED_RULES_PER_SOURCE),--compile-max-compiled-rules-per-source $(SOLVER_FOCUS_MAX_COMPILED_RULES_PER_SOURCE),)
SOLVER_FOCUS_MINE_MAX_GENERATED_LINES_PER_SOURCE_ARG = $(if $(SOLVER_FOCUS_MAX_GENERATED_LINES_PER_SOURCE),--compile-max-generated-lines-per-source $(SOLVER_FOCUS_MAX_GENERATED_LINES_PER_SOURCE),)
SOLVER_FOCUS_MINE_CMAKE_GENERATOR_ARG = $(if $(COMPILED_RULES_CMAKE_GENERATOR),--cmake-generator "$(COMPILED_RULES_CMAKE_GENERATOR)",)
SOLVER_TARGET_BENCH_RUNS ?= 5
SOLVER_TARGET_BENCH_CORPUS ?= $(SOLVER_MINE_CORPUS)
SOLVER_TARGET_BENCH_MANIFEST ?= $(SOLVER_PIPPABLE_MANIFEST)
SOLVER_TARGET_BENCH_OUT ?= $(BUILD_DIR)/native/solver_target_benchmark.json
SOLVER_TARGET_BENCH_TIMEOUT_MS ?=
SOLVER_TARGET_BENCH_STRATEGY ?= $(SOLVER_MINE_STRATEGY)
SOLVER_BENCH_STORE ?= $(BUILD_DIR)/solver-bench/store.jsonl
SOLVER_BENCH_SLICE ?= smoke-50
SOLVER_BENCH_SLICE_MANIFEST ?= $(BUILD_DIR)/solver-bench/$(SOLVER_BENCH_SLICE).json
SOLVER_BENCH_PAIR_RUNS ?= 3
SOLVER_BENCH_OUT_DIR ?= $(BUILD_DIR)/solver-bench/pairs/$(SOLVER_BENCH_SLICE)
SOLVER_BENCH_FRESH_HOURS ?= 24
GENERATOR_BENCH_GAME ?= src/demo/sokoban_basic.txt
GENERATOR_BENCH_PRESETS_DIR ?= src/tests/generator_presets
GENERATOR_BENCH_SAMPLES ?= 200
GENERATOR_BENCH_RUNS ?= 3
GENERATOR_BENCH_JOBS ?= 1
GENERATOR_BENCH_SEED ?= 11
GENERATOR_BENCH_SOLVER_TIMEOUT_MS ?= 50
GENERATOR_BENCH_SOLVER_STRATEGY ?= portfolio
GENERATOR_BENCH_TOP_K ?= 10
GENERATOR_BENCH_OUT ?= $(BUILD_DIR)/native/generator_benchmark.json
SPECIALIZE ?= false
empty :=
space := $(empty) $(empty)
COMPILED_RULES_CMAKE_GENERATOR ?= $(if $(shell command -v ninja 2>/dev/null),Ninja,)
COMPILED_RULES_BUILD_GENERATOR_SUFFIX = $(if $(COMPILED_RULES_CMAKE_GENERATOR),-$(subst $(space),_,$(COMPILED_RULES_CMAKE_GENERATOR)),)
COMPILED_RULES_BUILD_ROOT ?= $(BUILD_DIR)/compiled-rules-builds$(COMPILED_RULES_BUILD_GENERATOR_SUFFIX)
COMPILED_RULES_ARTIFACT_ROOT ?= $(BUILD_DIR)/compiled-rules
COMPILED_RULES_SIMULATION_SUITE_COVERAGE_JSON ?= $(COMPILED_RULES_ARTIFACT_ROOT)/simulation-suite-coverage.json
COMPACT_TURN_COVERAGE_JSON ?= $(COMPILED_RULES_ARTIFACT_ROOT)/compact-testdata-coverage.json
COMPACT_TURN_CODEGEN_COVERAGE_JSON ?= $(COMPILED_RULES_ARTIFACT_ROOT)/compact-codegen-testdata-coverage.json
COMPACT_TICK_COVERAGE_JSON ?= $(COMPACT_TURN_COVERAGE_JSON)
COMPILED_RULES_MAX_ROWS ?= 1
COMPACT_TURN_TESTDATA_MAX_ROWS ?= 99
COMPACT_TICK_TESTDATA_MAX_ROWS ?= $(COMPACT_TURN_TESTDATA_MAX_ROWS)
COMPACT_TURN_CODEGEN_BRINGUP_CORPUS ?= src/tests/solver_smoke_tests
COMPACT_TURN_CODEGEN_TESTDATA_CASE ?= 1
COMPACT_TURN_CODEGEN_FRONTIER_LIMIT ?= 40
COMPACT_TURN_CODEGEN_FRONTIER_AFTER ?= 0
COMPACT_TURN_SIMULATION_ARGS ?= --jobs auto --progress-every 0
SIMULATION_CORPUS_BENCH_ARGS ?= --jobs 1 --progress-every 0 --profile-timers --repeat 10 --quiet
SIMULATION_CORPUS_COMPILED_RULES_MAX_ROWS ?= 2
COMPILED_RULES_SIMULATION_SUITE_MAX_ROWS ?= $(SIMULATION_CORPUS_COMPILED_RULES_MAX_ROWS)
SIMULATION_CORPUS_COMPILED_RULES_MAX_COMPILED_RULES_PER_SOURCE ?= 500
SIMULATION_CORPUS_COMPILED_RULES_MAX_GENERATED_LINES_PER_SOURCE ?= 20000
SIMULATION_CORPUS_COMPILED_USE_RUNTIME_IR_CACHE ?= false
COMPACT_TURN_CODEGEN_SELECTED_CASES ?= 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 96 97 98 99 100 101 102 103 104 105 106 107 108 109 110 111 112 113 114 115 116 117 118 119 120 121 122 123 124 125 126 127 128 129 130 131 132 133 134 135 136 137 138 139 140 141 142 143 144 145 146 147 148 149 150 151 152 153 154 155 156 157 158 159 160 161 162 163 164 165 166 167 168 169 170 171 172 173 174 175 176 177 178 179 180 181 182 183 184 185 186 187 188 189 190 191 192 193 194 195 196 197 198 199 200 201 202 203 204 205 206 207 208 209 210 211 212 213 214 215 216 217 218 219 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 259 260 261 262 263 264 265 266 267 268 269 270 271 272 273 274 275 276 277 278 279 280 281 282 283 284 285 286 287 288 289 290 291 292 293 294 295 296 297 298 299 300 301 302 303 304 305 306 307 308 309 310 311 312 313 314 315 316 317 318 319 320 321 322 323 324 325 326 327 328 329 330 331 332 333 334 335 336 337 338 339 340 341 342 343 344 345 346 347 348 349 350 351 352 353 354 355 356 357 358 359 360 361 362 363 364 365 366 367 368 369 370 371 372 373 374 375 376 377 378 379 380 381 382 383 384 385 386 387 388 389 390 391 392 393 394 395 396 397 398 399 400 401 402 403 404 405 406 407 408 409 410 411 412 413 414 415 416 417 418 419 420 421 422 423 424 425 426 427 428 429 430 431 432 433 434 435 436 437 438 439 440 441 442 443 444 445 446 447 448 449 450 451 452 453 454 455 456 457 458 459 460 461 462 463 464 465 466 467 468 469
COMPILED_RULES_LTO ?= false
COMPILED_RULES_LINK_DEDUP ?= false
COMPILED_RULES_EXPORT_SYMBOLS ?= false
COMPILED_RULES_OPT_LEVEL ?= $(if $(filter true,$(COMPILED_RULES_PERF)),3,1)
COMPILED_RULES_BUILD_JOBS ?= auto
COMPILED_RULES_SHARED_SINGLE_BUILD ?= true
COMPILED_RULES_REUSE_SINGLE_CPP ?= true
COMPILED_RULES_REUSE_SHARDED_CPP ?= true
COMPILED_RULES_COMPILER_LAUNCHER ?=
COMPILED_RULES_FINGERPRINT_INPUTS := \
	CMakeLists.txt \
	native/CMakeLists.txt \
	native/src/cli/main.cpp \
	native/src/compiler/compact_turn_codegen.cpp \
	native/src/compiler/compact_turn_codegen.hpp \
	native/src/compiler/compact_turn_program.cpp \
	native/src/compiler/compact_turn_program.hpp \
	native/src/compiler/compiled_rules_codegen.cpp \
	native/src/compiler/compiled_rules_codegen.hpp \
	native/src/runtime/compiled_rules.cpp \
	native/src/runtime/compiled_rules.hpp \
	native/src/runtime/core.cpp \
	native/src/runtime/core.hpp \
	native/src/solver/main.cpp
COMPILED_RULES_FRESH_ARGS = $(foreach file,$(COMPILED_RULES_FINGERPRINT_INPUTS),--newer-than "$(file)")
SOLVER_FOCUS_BENCHMARK_FINGERPRINT_INPUTS := \
	Makefile \
	$(COMPILED_RULES_FINGERPRINT_INPUTS) \
	src/tests/run_solver_level_benchmark.js
SOLVER_FOCUS_BENCHMARK_FRESH_ARGS = $(foreach file,$(SOLVER_FOCUS_BENCHMARK_FINGERPRINT_INPUTS),--newer-than "$(file)")
COMPILED_RULES_CMAKE_GENERATOR_ARG = $(if $(COMPILED_RULES_CMAKE_GENERATOR),-G "$(COMPILED_RULES_CMAKE_GENERATOR)",)
COMPILED_RULES_COMPILER_LAUNCHER_ARGS = $(if $(COMPILED_RULES_COMPILER_LAUNCHER),-DCMAKE_C_COMPILER_LAUNCHER=$(COMPILED_RULES_COMPILER_LAUNCHER) -DCMAKE_CXX_COMPILER_LAUNCHER=$(COMPILED_RULES_COMPILER_LAUNCHER),)
COMPILED_RULES_CMAKE_ARGS = $(COMPILED_RULES_CMAKE_GENERATOR_ARG) -DPS_MASK_WORD_BITS=64 -DPS_ENABLE_LTO=$(COMPILED_RULES_LTO) -DPS_ENABLE_LINK_DEDUP=$(COMPILED_RULES_LINK_DEDUP) -DPS_ENABLE_EXPORTED_SYMBOLS=$(COMPILED_RULES_EXPORT_SYMBOLS) -DPS_COMPILED_RULES_OPT_LEVEL=$(COMPILED_RULES_OPT_LEVEL) $(COMPILED_RULES_COMPILER_LAUNCHER_ARGS)
ifeq ($(COMPILED_RULES_BUILD_JOBS),auto)
COMPILED_RULES_BUILD_PARALLEL_ARG = --parallel
else
COMPILED_RULES_BUILD_PARALLEL_ARG = --parallel $(COMPILED_RULES_BUILD_JOBS)
endif
define COMPILED_RULES_CONFIGURE
configure_stamp="$(1)/.compiled-rules-cmake-args"; \
new_configure_stamp="$(COMPILED_RULES_CMAKE_ARGS) $(2)"; \
if [ ! -f "$(1)/CMakeCache.txt" ] || [ ! -f "$$configure_stamp" ] || [ "$$(cat "$$configure_stamp")" != "$$new_configure_stamp" ]; then \
	$(CMAKE) -S . -B "$(1)" $(COMPILED_RULES_CMAKE_ARGS) $(2); \
	printf '%s\n' "$$new_configure_stamp" > "$$configure_stamp"; \
fi
endef
define COMPILED_RULES_BOOTSTRAP_CPP
native_configure_stamp="$(BUILD_DIR)/.native-configure.stamp"; \
needs_bootstrap_build=0; \
if [ ! -f "$$native_configure_stamp" ] || [ CMakeLists.txt -nt "$$native_configure_stamp" ] || [ native/CMakeLists.txt -nt "$$native_configure_stamp" ]; then \
	$(CMAKE) -S . -B $(BUILD_DIR) -DPS_MASK_WORD_BITS=64; \
	$(CMAKE) -E touch "$$native_configure_stamp"; \
	needs_bootstrap_build=1; \
fi; \
if [ ! -x "$(PUZZLESCRIPT_CPP)" ]; then \
	needs_bootstrap_build=1; \
elif find native/src/cli native/src/compiler native/src/runtime native/src/player native/include/puzzlescript -type f \( -name '*.cpp' -o -name '*.hpp' -o -name '*.h' -o -name '*.c' \) -newer "$(PUZZLESCRIPT_CPP)" -print -quit | grep -q .; then \
	needs_bootstrap_build=1; \
fi; \
if [ "$$needs_bootstrap_build" -eq 1 ]; then \
	$(CMAKE) --build $(BUILD_DIR) --target puzzlescript_cpp; \
fi
endef
define COMPILED_RULES_EMIT_SHARDED
out_stamp="$(1)/sources.stamp"; \
emit_max_rows="$(if $(5),$(5),$(COMPILED_RULES_MAX_ROWS))"; \
out_stamp_text="max_rows=$$emit_max_rows extra_args=$(4)"; \
if [ "$(COMPILED_RULES_REUSE_SHARDED_CPP)" = "true" ] && [ -f "$$sources_file" ] && [ -f "$$out_stamp" ] && [ "$$(cat "$$out_stamp")" = "$$out_stamp_text" ] && [ ! "$(PUZZLESCRIPT_CPP)" -nt "$$out_stamp" ]; then \
	echo "compiled-rules: reuse output=$$out_cpp_dir"; \
else \
	$(PUZZLESCRIPT_CPP) compile-rules "$(2)" --emit-cpp-dir "$$out_cpp_dir" --emit-sources-list "$$sources_file" --symbol $(3) --max-rows "$$emit_max_rows" $(4); \
	printf '%s\n' "$$out_stamp_text" > "$$out_stamp"; \
fi
endef
JS_PARITY_DATA_DIR := $(BUILD_DIR)/js-parity-data
JS_PARITY_MANIFEST := $(JS_PARITY_DATA_DIR)/fixtures.json
ERRORMESSAGE_PARSER_BUNDLE := $(BUILD_DIR)/parser_corpus_errormessage.bundle.ndjson
TESTDATA_PARSER_BUNDLE := $(BUILD_DIR)/parser_corpus_testdata.bundle.ndjson

PARSER_CORPUS_BUNDLE_INPUTS := \
	scripts/build_parser_corpus_bundle.js \
	src/tests/resources/errormessage_testdata.js \
	src/tests/resources/testdata.js \
	src/tests/js_oracle/lib/puzzlescript_parser_snapshot.js \
	src/tests/js_oracle/lib/puzzlescript_node_env.js

JS_PARITY_INPUTS := \
	src/tests/js_oracle/export_native_fixtures.js \
	src/tests/run_native_trace_suite.js \
	$(wildcard src/tests/js_oracle/lib/*.js) \
	$(wildcard src/tests/js_oracle/lib/*/*.js) \
	$(wildcard src/tests/js_oracle/lib/*/*/*.js) \
	$(wildcard src/js/*.js) \
	$(wildcard src/js/*/*.js) \
	$(wildcard src/js/*/*/*.js)

CMAKE_CACHE := $(BUILD_DIR)/CMakeCache.txt
PUZZLESCRIPT_SOLVER_REBUILD_INPUTS := \
	$(wildcard native/src/solver/*.cpp) \
	$(wildcard native/src/generator/*.cpp) \
	$(wildcard native/src/runtime/*.cpp) \
	$(wildcard native/src/runtime/*.hpp) \
	$(wildcard native/src/compiler/*.cpp) \
	$(wildcard native/src/compiler/*.hpp) \
	$(wildcard native/include/puzzlescript/*.h)
PUZZLESCRIPT_CPP_REBUILD_INPUTS := \
	$(wildcard native/src/cli/*.cpp) \
	$(wildcard native/src/cli/*.hpp) \
	$(wildcard native/src/player/*.cpp) \
	$(wildcard native/src/player/*.hpp) \
	$(wildcard native/src/runtime/*.cpp) \
	$(wildcard native/src/runtime/*.hpp) \
	$(wildcard native/src/compiler/*.cpp) \
	$(wildcard native/src/compiler/*.hpp) \
	$(wildcard native/include/puzzlescript/*.h)
SOLVER_MINE_MAX_TARGETS_ARG := $(if $(SOLVER_MINE_MAX_TARGETS),--max-targets $(SOLVER_MINE_MAX_TARGETS),)
SOLVER_TARGET_BENCH_TIMEOUT_ARG := $(if $(SOLVER_TARGET_BENCH_TIMEOUT_MS),--timeout-ms $(SOLVER_TARGET_BENCH_TIMEOUT_MS),)
ifeq ($(SPECIALIZE),true)
SOLVER_TARGET_PREREQ :=
GENERATOR_TARGET_PREREQ :=
else
SOLVER_TARGET_PREREQ := $(PUZZLESCRIPT_SOLVER)
GENERATOR_TARGET_PREREQ := $(PUZZLESCRIPT_GENERATOR)
endif

help:
	@echo "PuzzleScript C++ workflow"
	@echo ""
	@echo "Common commands:"
	@echo "  make build                         Build build/native/puzzlescript_cpp (64-bit masks)"
	@echo "  make build_solver                  Build build/native/puzzlescript_solver"
	@echo "  make build_generator               Build build/native/puzzlescript_generator"
	@echo "  make build_simplify                Build build/native/puzzlescript_simplify"
	@echo "  make simplify IN=in.txt OUT=out.txt Post-process levels with puzzlescript-simplify"
	@echo "  make solver game.txt               Run solver on a PuzzleScript game"
	@echo "  make solver game.txt SPECIALIZE=true"
	@echo "                                     Run solver with linked compiled-rule kernels"
	@echo "  make generator game.txt spec.gen   Run generator on a PuzzleScript game/spec pair"
	@echo "  make generator game.txt spec.gen SPECIALIZE=true"
	@echo "                                     Run generator with linked compiled-rule kernels"
	@echo "  make remix in.txt out.txt          Remix a game: hardest variant per level to out.txt"
	@echo "                                     Also writes out.template.txt beside the output"
	@echo "  make remix in.txt out.txt REMIX_ARGS='--inactivity-start 30s'"
	@echo "                                     Override remix generator options"
	@echo "                                     Set COMPILED_RULES_MAX_ROWS=N for experimental multi-row kernels"
	@echo "                                     Set COMPILED_RULES_LTO=true to re-enable LTO for specialized builds"
	@echo "                                     Set COMPILED_RULES_LINK_DEDUP=true to re-enable Darwin link dedup"
	@echo "                                     Set COMPILED_RULES_EXPORT_SYMBOLS=true to keep Darwin main exports"
	@echo "                                     Set COMPILED_RULES_OPT_LEVEL=2/3 to spend more compile time on generated rules"
	@echo "                                     Set COMPILED_RULES_BUILD_JOBS=N to tune specialized build parallelism"
	@echo "                                     Set COMPILED_RULES_SHARED_SINGLE_BUILD=false for per-game build dirs"
	@echo "                                     Set COMPILED_RULES_REUSE_SINGLE_CPP=false to force one-game regeneration"
	@echo "                                     Set COMPILED_RULES_REUSE_SHARDED_CPP=false to force corpus regeneration"
	@echo "                                     Uses Ninja automatically when installed; override COMPILED_RULES_CMAKE_GENERATOR="
	@echo "                                     Set COMPILED_RULES_COMPILER_LAUNCHER=ccache after installing ccache"
	@echo "  make build_32                      Build JS-style 32-bit-mask executable into build-32"
	@echo "  make run path/to/game.txt          Build and play a PuzzleScript game"
	@echo "  make ctest                         Run fast C++ smoke/unit tests"
	@echo "  make js_parity_tests               Run 32-bit C++ against the original JS test corpus"
	@echo "  make rule_plan_parity_tests        Compare JS/native game.rule_plan_v1 for simulation games"
	@echo "  make simulation_tests              Run JS sim tests, then mirrored C++ sim parity"
	@echo "  make simulation_corpus_perf_report Benchmark interpreter vs compiled-rulegroups vs compiled compact on testdata.js"
	@echo "  make compilation_tests             Run JS compiler tests, then mirrored C++ diagnostics"
	@echo "  make profile_simulation_tests      Profile C++ simulation replay hot functions"
	@echo "  make profile_simulation_tests_32   Profile the 32-bit-mask C++ simulation path"
	@echo "  make tests                         Run the full native correctness suite"
	@echo "  make all_tests_thorough            Run tests plus full JS/native solver coverage"
	@echo "  make solver_tests                  Run native solver and JS comparison solver"
	@echo "  make solver_compact_parity_smoke   Compare normal vs compact solver storage on smoke games"
	@echo "  make solver_compact_parity         Compare normal vs compact solver storage on non-random corpus games"
	@echo "  make compact_turn_oracle_smoke     Run specialized compact turns against interpreter oracle"
	@echo "  make compact_turn_simulation_tests Run testdata.js through specialized compact turn oracle"
	@echo "  make compact_turn_coverage         Report default compact ABI coverage; bridge backends can count"
	@echo "  make compact_turn_codegen_coverage Report compiler-mode native compact kernel coverage"
	@echo "  make compact_turn_codegen_bringup  Build compiler-mode compact smoke and require oracle parity"
	@echo "  make compact_turn_codegen_solver_parity"
	@echo "                                      Run solver compact parity with compiler-mode compact turns"
	@echo "  make compact_turn_codegen_testdata_one"
	@echo "                                     Build/run one testdata.js case in compact compiler mode"
	@echo "  make compact_turn_codegen_selected_tests"
	@echo "                                     Re-run selected known-passing compiler-mode testdata cases"
	@echo "  make compact_turn_codegen_simulation_tests"
	@echo "                                     Run full testdata.js corpus in compact compiler mode"
	@echo "  make generator_smoke_tests         Run native generator smoke tests"
	@echo "  make generator_benchmark           Run fixed-seed generator preset benchmark"
	@echo "  make performance_testpage          Build single-run HTML/JSON/MD performance report"
	@echo "  make performance_testpage PERFORMANCE_TESTPAGE_QUICK=true"
	@echo "                                     Build a shorter smoke-sized performance report"
	@echo "  make solver_mine_pippable          Mine near-threshold native solver targets"
	@echo "  make solver_focus_mine             Mine a small solver optimization focus group"
	@echo "  make solver_focus_manifest_check   Validate the checked-in solver focus group"
	@echo "  make solver_focus_benchmark        Benchmark the current solver focus group"
	@echo "  make solver_focus_compare          Compare interpreted vs compiled focus outputs"
	@echo "  make solver_focus_compact_compare  Compare interpreted vs compiled compact-node focus outputs"
	@echo "  make solver_focus_compact_codegen_compare"
	@echo "                                     Require work parity on the focus manifest (weighted-astar, 10s)"
	@echo "  make solver_corpus_manifest        Generate all-level manifest for non-random solver_tests games"
	@echo "  make solver_corpus_compact_codegen_compare"
	@echo "                                     Full-corpus compact-codegen work parity (SOLVER_CORPUS_JOBS=$(SOLVER_CORPUS_JOBS) by default)"
	@echo "                                     Require work parity on the full solver corpus manifest"
	@echo "                                     Compare interpreted vs compiler-mode compact-node focus outputs"
	@echo "  make solver_focus_perf_report      Compare focus outputs with runtime counters and the 2x goal"
	@echo "  make solver_focus_compact_perf_report"
	@echo "                                     Compare compact-node focus outputs with runtime counters"
	@echo "  make solver_focus_compact_codegen_perf_report"
	@echo "                                     Compare compiler-mode compact-node focus outputs with runtime counters"
	@echo "  make solver_benchmark_targets      Benchmark mined solver targets repeatedly"
	@echo "  make solver_benchmark_slice_manifest"
	@echo "                                     Materialize SOLVER_BENCH_SLICE into a reproducible manifest"
	@echo "  make js_solver_bench_pair_smoke    Run baseline/candidate JS paired smoke into SOLVER_BENCH_STORE"
	@echo "  make js_solver_bench_pair_slice    Run baseline/candidate JS paired SOLVER_BENCH_SLICE into SOLVER_BENCH_STORE"
	@echo "  make solver_bench_summary          Print aggregate bench-store summary"
	@echo "  make solver_bench_freshness        Check latest bench-store record freshness"
	@echo "  make solver_instrumentation_pack   Build cross-strategy native solver evidence pack"
	@echo "  make solver_instrumentation_analysis"
	@echo "                                     Analyze instrumentation-pack strategy/static-tag results"
	@echo "  make clean                         Remove native build outputs and JS parity data"
	@echo ""
	@echo "Single-side test commands for timing:"
	@echo "  make simulation_tests_js           Run JS simulation tests only"
	@echo "  make simulation_tests_js_profile   Run JS simulation tests 5 times and report avg/median"
	@echo "  make simulation_tests_js_profile_breakdown"
	@echo "                                     Run JS profile with compile/input timing averages"
	@echo "  make simulation_tests_cpp          Run C++ simulation corpus directly (64-bit masks)"
	@echo "  make simulation_tests_cpp_32       Run C++ simulation corpus with JS-style 32-bit masks"
	@echo "  make compilation_tests_js          Run JS compiler tests only"
	@echo "  make compilation_tests_cpp         Run C++ diagnostics corpus directly (64-bit masks)"
	@echo "  make compilation_tests_cpp_32      Run C++ diagnostics corpus with JS-style 32-bit masks"
	@echo "  make tests_js                      Run the original JavaScript test suite"
	@echo "  make static_analysis_tests         Run static analyzer unit and runtime claim tests"
	@echo "  make static_analysis_consistency_giant  Parallel consistency audit on giant corpus ($(STATIC_ANALYSIS_GIANT_CORPUS))"
	@echo "                                     Logs: $(STATIC_ANALYSIS_GIANT_OUT)"
	@echo "  make static_analysis_runtime_contracts"
	@echo "                                     Replay JS simulation corpus with static-object contracts"
	@echo "  make static_analysis_performance_tests"
	@echo "                                     Run static analyzer wall-clock performance guards"
	@echo "  make static_analysis_fuzz          Verify static-analysis claims on randomized input traces"
	@echo "                                     (STATIC_ANALYSIS_FUZZ_ARGS for --iterations/--game/--strict)"
	@echo "  make canonicalization_fuzz         Verify semantic canonicalization on randomized input traces"
	@echo "                                     (CANONICALIZATION_FUZZ_ARGS for --iterations/--game/--start/--end)"
	@echo "  make canonicalizer_giant_corpus    Canonicalize+recompile audit over ~30k gist corpus (slow)"
	@echo "                                     Corpus: $(CANONICALIZER_GIANT_CORPUS)"
	@echo "                                     Logs: $(CANONICALIZER_GIANT_OUT)"
	@echo "                                     Non-interactive resume: CANONICALIZER_GIANT_RESUME=true"
	@echo "  make compile_exception_corpus      Compile corpus for thrown exceptions (JS and/or C++)"
	@echo "                                     Corpus: $(COMPILE_EXCEPTION_CORPUS)"
	@echo "                                     COMPILE_EXCEPTION_COMPILER=$(COMPILE_EXCEPTION_COMPILER)"
	@echo "                                     COMPILE_EXCEPTION_JS_MODE=$(COMPILE_EXCEPTION_JS_MODE)"
	@echo "  make compile_exception_corpus_nodupes  Alias for raw ~33k nodupes scrape corpus"
	@echo "  make fuzz_corpus_batch             Long-running static/canonical fuzz (parallel by default)"
	@echo "                                     FUZZ_BATCH_JOBS=$(FUZZ_BATCH_JOBS); set FUZZ_BATCH_JOBS=1 for single process"
	@echo "                                     Overnight gist example:"
	@echo "                                       PUZZLESCRIPT_FUZZ_CORPUS=/path/to/dumpprocessed_compiles \\"
	@echo "                                         make fuzz_corpus_batch FUZZ_BATCH_JOBS=8"
	@echo "                                     If interrupted, re-run to choose continue or restart"
	@echo "                                     Non-interactive: FUZZ_BATCH_RESUME=true or FUZZ_BATCH_FRESH=true"
	@echo "  make fuzz_corpus_batch_giant       Parallel fuzz over the ~30k gist corpus ($(FUZZ_BATCH_GIANT_CORPUS))"
	@echo "                                     Logs: $(FUZZ_BATCH_GIANT_OUT)"
	@echo "  make fuzz_corpus_batch_single      Explicit single-process run (FUZZ_BATCH_START/END for one window)"
	@echo "  make static_analysis_explorer      Build HTML static-analysis explorer (see STATIC_ANALYSIS_EXPLORER_*)"
	@echo "  make solver_tests_cpp              Run standalone native solver corpus"
	@echo "  make solver_tests_cpp SPECIALIZE=true"
	@echo "                                     Run standalone native solver corpus with compiled rules"
	@echo "  make solver_tests_js               Run JavaScript comparison solver corpus"
	@echo "  make solver_js_coverage_cpp        Fail if native misses any JS-solved corpus level"
	@echo "  make solver_timeout_curve          Build Javascript + c++ cumulative solve chart (slow; includes canonical + compiled series)"
	@echo "  make solver-time-curve-single-game game.txt"
	@echo "                                     Build the same chart for one game file"
	@echo "  make solver-time-curve-single-game-hda-compiled game.txt SOLVER_TIMEOUT_CURVE_MAX_MS=30000"
	@echo "                                     Build only the compiled HDA x8 single-game chart"
	@echo "  make solver_timeout_curve_replot   Re-render chart from saved JSON (does not re-run solvers)"
	@echo "  make js_static_optimization_comparison_solver_smoke"
	@echo "                                     JS solver smoke corpus: baseline vs --solver-opt all + totals diff"
	@echo "                                     (override JS_STATIC_OPTIMIZATION_COMPARE_EXTRA_ARGS, JS_STATIC_OPTIMIZATION_COMPARE_OUT)"
	@echo "  make js_static_optimization_comparison_solver_focus"
	@echo "                                     A/B baseline vs --solver-opt all on only the manifest target levels"
	@echo "                                     ($(SOLVER_FOCUS_MANIFEST) over $(SOLVER_FOCUS_CORPUS)); auto-runs solver_focus_mine if manifest missing"
	@echo "  make action_noop_candidates_focus  Static noaction candidate report for focus manifest"
	@echo "                                     (ACTION_NOOP_CANDIDATES_OUT=$(ACTION_NOOP_CANDIDATES_OUT))"
	@echo "  make solver_canonical_replay       Solve static-optimized canonical focus targets and replay on originals"
	@echo "  make solver_canonical_replay_long  Deeper canonical replay sweep using the long focus manifest"
	@echo "  make canonical_roundtrip_replay    Replay timeout-curve solutions across original/canonical corpora"
	@echo "  make static_optimizer_page         Build HTML + JSON per-game solver static-opt summary (two full corpus runs)"
	@echo "                                     (STATIC_OPTIMIZER_PAGE_CORPUS=$(STATIC_OPTIMIZER_PAGE_CORPUS),"
	@echo "                                     STATIC_OPTIMIZER_PAGE_OUT=$(STATIC_OPTIMIZER_PAGE_OUT); override STATIC_OPTIMIZER_PAGE_GAME=substring to filter)"
	@echo "  make solver_tests SOLVER_TIMEOUT_MS=5000"
	@echo "                                     Run solver corpus with a deeper timeout"
	@echo "  make solver_tests SOLVER_JOBS=1"
	@echo "                                     Run native solver corpus serially"
	@echo "  make solver_tests SOLVER_JOBS=auto"
	@echo "                                     Run native solver corpus in parallel for faster iteration"
	@echo "  make solver_tests SOLVER_STRATEGY=bfs"
	@echo "                                     Run native solver with one strategy"
	@echo "  make solver_tests SOLVER_PROGRESS_EVERY=1"
	@echo "                                     Show solver progress for every level"
	@echo "  make solver_timeout_curve SOLVER_TIMEOUT_CURVE_MAX_MS=1000"
	@echo "                                     Tune max timeout / step: SOLVER_TIMEOUT_CURVE_STEP_MS=50"
	@echo "  make solver_timeout_curve SOLVER_TIMEOUT_CURVE_PROGRESS=25"
	@echo "                                     Progress every N levels (default per-game; use quiet to disable)"
	@echo "  make solver_timeout_curve SOLVER_TESTS_CORPUS=src/tests/solver_smoke_tests"
	@echo "                                     Quick chart on the smoke corpus"
	@echo "  make solver_tests SOLVER_OUTPUT_ARGS="
	@echo "                                     Print per-level solver results after the run"
	@echo "  make solver_tests SOLVER_SOLUTIONS_DIR=/tmp/solver-solutions"
	@echo "                                     Write annotated solved-level sources elsewhere"
	@echo "  make generator_benchmark GENERATOR_BENCH_SAMPLES=200 GENERATOR_BENCH_RUNS=3"
	@echo "                                     Run fixed-seed generator preset benchmark"
	@echo "  make solver_mine_pippable SOLVER_MINE_TIMEOUTS_MS=50,100,250,500"
	@echo "                                     Write $(SOLVER_PIPPABLE_MANIFEST)"
	@echo "  make solver_focus_mine SOLVER_FOCUS_COMPILE_PROBE_JOBS=auto"
	@echo "                                     Recompute checked-in focus group with parallel compile probes"
	@echo "  make solver_benchmark_targets SOLVER_TARGET_BENCH_RUNS=10"
	@echo "                                     Write $(SOLVER_TARGET_BENCH_OUT)"
	@echo "  make solver_benchmark SPECIALIZE=true"
	@echo "                                     Benchmark solver with compiled rules for the corpus"
	@echo "  make compiled_rules_simulation_suite_coverage"
	@echo "                                     Write $(COMPILED_RULES_SIMULATION_SUITE_COVERAGE_JSON)"
	@echo "  make compiled_rules_coverage_shape_smoke"
	@echo "                                     Assert coverage JSON has current and compatibility keys"
	@echo "  make specialized_full_turn_dispatch_smoke"
	@echo "                                     Assert linked specialized full-turn dispatch is exercised"
	@echo ""
	@echo "Direct executable after build:"
	@echo "  build/native/puzzlescript_cpp --help"
	@echo "  build/native/puzzlescript_solver src/tests/solver_tests --timeout-ms $(SOLVER_TIMEOUT_MS) --jobs $(SOLVER_JOBS) --strategy $(SOLVER_STRATEGY) --solutions-dir $(SOLVER_SOLUTIONS_DIR)/native $(SOLVER_PROGRESS_ARGS) $(SOLVER_OUTPUT_ARGS)"
	@echo "  make generator src/demo/sokoban_basic.txt src/tests/generator_presets/sokoban_room_scatter.gen"
	@echo "  make generator src/demo/sokoban_basic.txt src/tests/generator_presets/sokoban_room_scatter.gen GENERATOR_ARGS='--time-ms 5000 --jobs auto --json-out build/generated/results.json'"
	@echo "  make remix src/demo/sokoban_basic.txt build/remixed_sokoban.txt"

$(CMAKE_CACHE): CMakeLists.txt native/CMakeLists.txt
	$(CMAKE) -S . -B $(BUILD_DIR) -DPS_MASK_WORD_BITS=64

$(PUZZLESCRIPT_CPP): $(CMAKE_CACHE) $(PUZZLESCRIPT_CPP_REBUILD_INPUTS)
	$(CMAKE) -S . -B $(BUILD_DIR) -DPS_MASK_WORD_BITS=64
	$(CMAKE) --build $(BUILD_DIR) --target puzzlescript_cpp

$(PUZZLESCRIPT_SOLVER): $(CMAKE_CACHE) $(PUZZLESCRIPT_SOLVER_REBUILD_INPUTS)
	$(CMAKE) -S . -B $(BUILD_DIR) -DPS_MASK_WORD_BITS=64
	$(CMAKE) --build $(BUILD_DIR) --target puzzlescript_solver

$(PUZZLESCRIPT_GENERATOR): $(CMAKE_CACHE) $(PUZZLESCRIPT_SOLVER_REBUILD_INPUTS)
	$(CMAKE) -S . -B $(BUILD_DIR) -DPS_MASK_WORD_BITS=64
	$(CMAKE) --build $(BUILD_DIR) --target puzzlescript_generator

build: $(CMAKE_CACHE)
	$(CMAKE) -S . -B $(BUILD_DIR) -DPS_MASK_WORD_BITS=64
	$(CMAKE) --build $(BUILD_DIR) --target puzzlescript_cpp

build_solver: $(PUZZLESCRIPT_SOLVER)

build_generator: $(PUZZLESCRIPT_GENERATOR)

$(PUZZLESCRIPT_SIMPLIFY): $(CMAKE_CACHE) $(PUZZLESCRIPT_SOLVER_REBUILD_INPUTS)
	$(CMAKE) --build $(BUILD_DIR) --target puzzlescript_simplify

build_simplify: $(PUZZLESCRIPT_SIMPLIFY)

simplify:
	@if [ -z "$(IN)" ] || [ -z "$(OUT)" ]; then \
		echo "Usage: make simplify IN=path/to/game.txt OUT=path/to/out.txt"; \
		exit 2; \
	fi
	@$(MAKE) build_simplify
	@$(PUZZLESCRIPT_SIMPLIFY) "$(IN)" --out "$(OUT)" \
		--simplify-timeout-ms $(or $(SIMPLIFY_TIMEOUT_MS),5000) \
		--solver-timeout-ms $(or $(SOLVER_TIMEOUT_MS),2000)

ifeq ($(firstword $(MAKECMDGOALS)),simplify)
IN OUT:
	@:
endif

generator:
	@if [ -z "$(GENERATOR_GAME)" ] || [ -z "$(GENERATOR_SPEC)" ]; then \
		echo "Usage: make generator path/to/game.txt path/to/spec.gen"; \
		echo "       make generator path/to/game.txt path/to/spec.gen GENERATOR_ARGS='--time-ms 5000 --jobs auto --json-out build/generated/results.json'"; \
		exit 2; \
	fi
	@if [ "$(SPECIALIZE)" = "true" ]; then \
		set -e; \
		if [ ! -f "$(GENERATOR_GAME)" ]; then echo "Missing generator game: $(GENERATOR_GAME)"; exit 2; fi; \
		if [ ! -f "$(GENERATOR_SPEC)" ]; then echo "Missing generator spec: $(GENERATOR_SPEC)"; exit 2; fi; \
		$(COMPILED_RULES_BOOTSTRAP_CPP); \
		hash=$$(shasum -a 256 "$(GENERATOR_GAME)" | awk '{print $$1}'); \
		out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/generator-$$hash"; \
		if [ "$(COMPILED_RULES_SHARED_SINGLE_BUILD)" = "true" ]; then \
			build_dir="$(COMPILED_RULES_BUILD_ROOT)/generator-single"; \
		else \
			build_dir="$(COMPILED_RULES_BUILD_ROOT)/generator-$$hash"; \
		fi; \
		out_cpp="$$out_dir/compiled_rules.cpp"; \
		out_stamp="$$out_dir/compiled_rules.stamp"; \
		out_stamp_text="max_rows=$(COMPILED_RULES_MAX_ROWS)"; \
		mkdir -p "$$out_dir"; \
		if [ "$(COMPILED_RULES_REUSE_SINGLE_CPP)" = "true" ] && [ -f "$$out_cpp" ] && [ -f "$$out_stamp" ] && [ "$$(cat "$$out_stamp")" = "$$out_stamp_text" ] && [ ! "$(PUZZLESCRIPT_CPP)" -nt "$$out_stamp" ]; then \
			echo "compiled-rules: reuse output=$$out_cpp"; \
		else \
			$(PUZZLESCRIPT_CPP) compile-rules "$(GENERATOR_GAME)" --emit-cpp "$$out_cpp" --symbol generator_$$hash --max-rows $(COMPILED_RULES_MAX_ROWS); \
			printf '%s\n' "$$out_stamp_text" > "$$out_stamp"; \
		fi; \
		$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE="$$PWD/$$out_cpp" -DPS_COMPILED_RULES_SOURCES_FILE=); \
		$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_generator; \
		"$$build_dir/native/puzzlescript_generator" $(GENERATOR_GAME) $(GENERATOR_SPEC) $(GENERATOR_ARGS); \
	else \
		$(MAKE) build_generator; \
		$(PUZZLESCRIPT_GENERATOR) $(GENERATOR_GAME) $(GENERATOR_SPEC) $(GENERATOR_ARGS); \
	fi


ifeq ($(firstword $(MAKECMDGOALS)),generator)
ifneq ($(strip $(GENERATOR_MAKE_ARGS)),)
.PHONY: $(GENERATOR_MAKE_ARGS)
$(eval $(GENERATOR_MAKE_ARGS):;@:)
endif
endif

remix:
	@if [ -z "$(REMIX_IN)" ] || [ -z "$(REMIX_OUT)" ]; then \
		echo "Usage: make remix path/to/game.txt path/to/out.txt"; \
		echo "       make remix path/to/game.txt path/to/out.txt REMIX_ARGS='--inactivity-start 30s --jobs 2'"; \
		exit 2; \
	fi
	@if [ ! -f "$(REMIX_IN)" ]; then echo "Missing remix input game: $(REMIX_IN)"; exit 2; fi
	@out_dir=$$(dirname "$(REMIX_OUT)"); \
	if [ "$$out_dir" != "." ] && [ "$$out_dir" != "" ]; then mkdir -p "$$out_dir"; fi
	@echo "==> remix $(REMIX_IN) -> $(REMIX_OUT)"
	@echo "    inactivity=$(REMIX_INACTIVITY_START) solver_timeout=$(REMIX_SOLVER_TIMEOUT_MS) jobs=$(REMIX_JOBS) seed=$(REMIX_SEED)"
	@echo "    runs until Ctrl+C; compact progress on stderr every 10s"
	@$(MAKE) build_generator
	@$(PUZZLESCRIPT_GENERATOR) "$(REMIX_IN)" --remix --out "$(REMIX_OUT)" \
		--inactivity-start $(REMIX_INACTIVITY_START) \
		--solver-timeout-ms $(REMIX_SOLVER_TIMEOUT_MS) \
		--jobs $(REMIX_JOBS) \
		--seed $(REMIX_SEED) \
		$(REMIX_ARGS)

ifeq ($(firstword $(MAKECMDGOALS)),remix)
ifneq ($(strip $(REMIX_MAKE_ARGS)),)
.PHONY: $(REMIX_MAKE_ARGS)
$(eval $(REMIX_MAKE_ARGS):;@:)
endif
endif

solver:
	@if [ -z "$(SOLVER_GAME)" ]; then \
		echo "Usage: make solver path/to/game.txt"; \
		echo "       make solver path/to/game.txt SOLVER_ARGS='--level 0 --json --quiet'"; \
		exit 2; \
	fi
	@if [ "$(SPECIALIZE)" = "true" ]; then \
		set -e; \
		if [ ! -f "$(SOLVER_GAME)" ]; then echo "Missing solver game: $(SOLVER_GAME)"; exit 2; fi; \
		$(COMPILED_RULES_BOOTSTRAP_CPP); \
		hash=$$(shasum -a 256 "$(SOLVER_GAME)" | awk '{print $$1}'); \
		out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-$$hash"; \
		if [ "$(COMPILED_RULES_SHARED_SINGLE_BUILD)" = "true" ]; then \
			build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-single"; \
		else \
			build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-$$hash"; \
		fi; \
		out_cpp="$$out_dir/compiled_rules.cpp"; \
		out_stamp="$$out_dir/compiled_rules.stamp"; \
		out_stamp_text="max_rows=$(COMPILED_RULES_MAX_ROWS)"; \
		mkdir -p "$$out_dir"; \
		if [ "$(COMPILED_RULES_REUSE_SINGLE_CPP)" = "true" ] && [ -f "$$out_cpp" ] && [ -f "$$out_stamp" ] && [ "$$(cat "$$out_stamp")" = "$$out_stamp_text" ] && [ ! "$(PUZZLESCRIPT_CPP)" -nt "$$out_stamp" ]; then \
			echo "compiled-rules: reuse output=$$out_cpp"; \
		else \
			$(PUZZLESCRIPT_CPP) compile-rules "$(SOLVER_GAME)" --emit-cpp "$$out_cpp" --symbol solver_$$hash --max-rows $(COMPILED_RULES_MAX_ROWS); \
			printf '%s\n' "$$out_stamp_text" > "$$out_stamp"; \
		fi; \
		$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE="$$PWD/$$out_cpp" -DPS_COMPILED_RULES_SOURCES_FILE=); \
		$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
		"$$build_dir/native/puzzlescript_solver" $(SOLVER_GAME) --timeout-ms $(SOLVER_TIMEOUT_MS) --jobs $(SOLVER_JOBS) --strategy $(SOLVER_STRATEGY) --solutions-dir $(SOLVER_SOLUTIONS_DIR)/native $(SOLVER_PROGRESS_ARGS) $(SOLVER_OUTPUT_ARGS) $(SOLVER_ARGS); \
	else \
		$(MAKE) build_solver; \
		$(PUZZLESCRIPT_SOLVER) $(SOLVER_GAME) --timeout-ms $(SOLVER_TIMEOUT_MS) --jobs $(SOLVER_JOBS) --strategy $(SOLVER_STRATEGY) --solutions-dir $(SOLVER_SOLUTIONS_DIR)/native $(SOLVER_PROGRESS_ARGS) $(SOLVER_OUTPUT_ARGS) $(SOLVER_ARGS); \
	fi


ifeq ($(firstword $(MAKECMDGOALS)),solver)
ifneq ($(strip $(SOLVER_MAKE_ARGS)),)
.PHONY: $(SOLVER_MAKE_ARGS)
$(eval $(SOLVER_MAKE_ARGS):;@:)
endif
endif

build_32:
	$(CMAKE) -S . -B $(BUILD_DIR_32) -DPS_MASK_WORD_BITS=32
	$(CMAKE) --build $(BUILD_DIR_32) --target puzzlescript_cpp

configure-native: $(CMAKE_CACHE)

build-native: build

ctest: build build_solver build_generator
	ctest --test-dir $(BUILD_DIR) --output-on-failure

tests_js:
	PUZZLESCRIPT_SKIP_AUXILIARY_TESTS=1 $(NODE) src/tests/run_tests_node.js
	$(NODE) src/tests/compiler_keyword_names_node.js
	$(NODE) src/tests/solver_novelty_node.js
	$(NODE) src/tests/solver_push_space_node.js
	$(NODE) src/tests/solver_random_replay_node.js
	$(NODE) src/tests/compare_solver_timeout_curve_json_node.js

static_analysis_tests:
	$(NODE) src/tests/ps_static_analysis_node.js
	$(NODE) src/tests/action_noop_candidates_node.js
	$(NODE) src/tests/static_analysis_testdata_runner.js
	$(NODE) src/tests/static_analysis_testdata_runner_node.js
	$(NODE) src/tests/static_analysis_explorer_node.js
	$(NODE) src/tests/static_analysis_explorer_runtime_smoke.js
	$(NODE) src/tests/solver_static_opt_node.js
	$(NODE) src/tests/analyze_solver_static_relationships_node.js
	$(NODE) src/tests/static_tool_cli_hardening_node.js
	$(NODE) src/tests/compare_solver_static_opt_runs_node.js
	$(NODE) src/tests/static_analysis_adversarial_node.js
	$(NODE) src/tests/static_analysis_claims_consistency_node.js
	$(NODE) src/tests/static_analysis_canonical_parity_node.js --fixture-only
	$(NODE) src/tests/run_static_analysis_runtime_contracts_node_test.js
	$(NODE) src/tests/run_static_analysis_runtime_contracts_node.js

static_analysis_fuzz:
	$(NODE) src/tests/fuzz_static_contracts.js $(STATIC_ANALYSIS_FUZZ_ARGS)

static_analysis_consistency_giant:
	@$(MAKE) static_analysis_corpus_audit_giant CHECKS=consistency

static_analysis_corpus_audit_giant:
	@mkdir -p "$(STATIC_ANALYSIS_GIANT_OUT)"
	$(NODE) src/tests/run_static_analysis_corpus_parallel.js \
		--corpus "$(STATIC_ANALYSIS_GIANT_CORPUS)" \
		--jobs "$(STATIC_ANALYSIS_GIANT_JOBS)" \
		--checks "$(or $(CHECKS),both)" \
		--log-dir "$(STATIC_ANALYSIS_GIANT_OUT)" \
		$(STATIC_ANALYSIS_RESUME_FLAG) \
		$(STATIC_ANALYSIS_FRESH_FLAG)

canonicalization_fuzz:
	$(NODE) src/tests/fuzz_canonicalization.js $(CANONICALIZATION_FUZZ_ARGS)

canonicalizer_giant_corpus:
	@mkdir -p "$(CANONICALIZER_GIANT_OUT)"
	$(NODE) src/tests/run_canonicalizer_corpus_parallel.js \
		--corpus "$(CANONICALIZER_GIANT_CORPUS)" \
		--jobs "$(CANONICALIZER_GIANT_JOBS)" \
		--log-dir "$(CANONICALIZER_GIANT_OUT)" \
		$(CANONICALIZER_GIANT_RESUME_FLAG) \
		$(CANONICALIZER_GIANT_FRESH_FLAG) \
		$(CANONICALIZER_GIANT_EXIT_ON_FAILURE_FLAG)

compile_exception_corpus:
	@mkdir -p "$(COMPILE_EXCEPTION_OUT)"
	$(NODE) src/tests/run_compile_exception_corpus_parallel.js \
		--corpus "$(COMPILE_EXCEPTION_CORPUS)" \
		--jobs "$(COMPILE_EXCEPTION_JOBS)" \
		--compiler "$(COMPILE_EXCEPTION_COMPILER)" \
		--js-mode "$(COMPILE_EXCEPTION_JS_MODE)" \
		--log-dir "$(COMPILE_EXCEPTION_OUT)" \
		$(COMPILE_EXCEPTION_CPP_CLI_ARG) \
		$(COMPILE_EXCEPTION_RESUME_FLAG) \
		$(COMPILE_EXCEPTION_FRESH_FLAG) \
		$(COMPILE_EXCEPTION_EXIT_ON_FAILURE_FLAG)

compile_exception_corpus_nodupes:
	@$(MAKE) compile_exception_corpus COMPILE_EXCEPTION_CORPUS="$(HOME)/Documents/google_gist_scraper/dumpprocessed_nodupes"

fuzz_corpus_batch:
	@mkdir -p "$(FUZZ_BATCH_OUT)"
ifeq ($(FUZZ_BATCH_JOBS),1)
	$(NODE) src/tests/fuzz_corpus_batch.js \
		--corpus "$(FUZZ_BATCH_CORPUS)" \
		--mode "$(FUZZ_BATCH_MODE)" \
		--log-dir "$(FUZZ_BATCH_OUT)" \
		$(FUZZ_BATCH_START_ARG) \
		$(FUZZ_BATCH_END_ARG) \
		$(FUZZ_BATCH_RESUME_FLAG) \
		$(FUZZ_BATCH_FRESH_FLAG) \
		$(FUZZ_BATCH_ARGS)
else
	$(NODE) src/tests/fuzz_corpus_batch_parallel.js \
		--corpus "$(FUZZ_BATCH_CORPUS)" \
		--jobs "$(FUZZ_BATCH_JOBS)" \
		--mode "$(FUZZ_BATCH_MODE)" \
		--log-dir "$(FUZZ_BATCH_OUT)" \
		$(FUZZ_BATCH_RESUME_FLAG) \
		$(FUZZ_BATCH_FRESH_FLAG) \
		$(FUZZ_BATCH_ARGS)
endif

fuzz_corpus_batch_giant:
	@$(MAKE) fuzz_corpus_batch \
		FUZZ_BATCH_CORPUS="$(FUZZ_BATCH_GIANT_CORPUS)" \
		FUZZ_BATCH_OUT="$(FUZZ_BATCH_GIANT_OUT)"

fuzz_corpus_batch_single:
	@$(MAKE) fuzz_corpus_batch FUZZ_BATCH_JOBS=1

fuzz_corpus_batch_parallel:
	@$(MAKE) fuzz_corpus_batch

static_analysis_runtime_contracts:
	$(NODE) src/tests/run_static_analysis_runtime_contracts_node.js

static_analysis_performance_tests:
	$(NODE) src/tests/static_analysis_performance_node.js

static_analysis_explorer:
	$(NODE) src/tests/build_static_analysis_explorer.js $(STATIC_ANALYSIS_EXPLORER_INPUTS) --out "$(STATIC_ANALYSIS_EXPLORER_OUT)" $(if $(strip $(STATIC_ANALYSIS_EXPLORER_GAME)),--game "$(STATIC_ANALYSIS_EXPLORER_GAME)",)

simulation_tests_js:
	$(NODE) src/tests/run_tests_node.js --sim-only

simulation_tests_js_profile:
	$(NODE) src/tests/run_tests_node.js --profile --profile-runs 5 --sim-only

simulation_tests_js_profile_breakdown:
	$(NODE) src/tests/run_tests_node.js --profile --profile-runs 5 --sim-only --breakdown

compilation_tests_js:
	$(NODE) src/tests/run_tests_node.js --compilation-only

ifeq ($(SOLVER_PROGRESS_EVERY),game)
SOLVER_PROGRESS_ARGS := --progress-per-game
else
SOLVER_PROGRESS_ARGS := --progress-every $(SOLVER_PROGRESS_EVERY)
endif

solver_smoke_tests: $(SOLVER_TARGET_PREREQ)
	@if [ "$(SPECIALIZE)" = "true" ]; then \
		set -e; \
		$(COMPILED_RULES_BOOTSTRAP_CPP); \
		hash=$$(find src/tests/solver_smoke_tests -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
		out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-smoke-$$hash"; \
		build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-smoke-$$hash"; \
		out_cpp_dir="$$out_dir/sources"; \
		sources_file="$$out_dir/sources.txt"; \
		mkdir -p "$$out_dir"; \
		$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/solver_smoke_tests,solver_smoke_$$hash); \
		$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
		$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
		$(NODE) src/tests/run_solver_smoke_assert.js "$$build_dir/native/puzzlescript_solver" src/tests/solver_smoke_tests --timeout-ms 1000; \
	else \
		$(NODE) src/tests/run_solver_smoke_assert.js $(PUZZLESCRIPT_SOLVER) src/tests/solver_smoke_tests --timeout-ms 1000; \
	fi

compiled_tick_dispatch_smoke: specialized_full_turn_dispatch_smoke

specialized_full_turn_dispatch_smoke: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(find src/tests/solver_smoke_tests -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-smoke-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-smoke-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/solver_smoke_tests,solver_smoke_$$hash); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
	$(NODE) src/tests/run_solver_smoke_assert.js "$$build_dir/native/puzzlescript_solver" src/tests/solver_smoke_tests --timeout-ms 1000 --require-specialized-full-turn

compact_tick_oracle_smoke: compact_turn_oracle_smoke

compact_turn_oracle_smoke: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(find src/tests/solver_smoke_tests -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-oracle-smoke-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-oracle-smoke-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/solver_smoke_tests,compact_oracle_smoke_$$hash,--compact-turn-only --compact-turn-mode=compiler); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
	$(NODE) src/tests/run_solver_smoke_assert.js "$$build_dir/native/puzzlescript_solver" src/tests/solver_smoke_tests --timeout-ms 1000 --compact-turn-oracle --require-compact-oracle-checks

compact_turn_codegen_bringup: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(find "$(COMPACT_TURN_CODEGEN_BRINGUP_CORPUS)" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-codegen-bringup-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-codegen-bringup-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,$(COMPACT_TURN_CODEGEN_BRINGUP_CORPUS),compact_codegen_bringup_$$hash,--compact-turn-only --compact-turn-mode=compiler); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
	"$$build_dir/native/puzzlescript_solver" "$(COMPACT_TURN_CODEGEN_BRINGUP_CORPUS)" --timeout-ms 1000 --jobs 1 --strategy bfs --no-solutions --quiet --json --compact-turn-oracle > "$$out_dir/bringup.json"; \
	$(NODE) -e 'const fs=require("fs"); const path=process.argv[1]; const j=JSON.parse(fs.readFileSync(path,"utf8")); const t=j.totals; const unhandled=t.compact_turn_unhandled ?? t.compact_turn_fallbacks; const fail=m=>{ throw new Error(m); }; if (t.levels !== 14 || t.solved !== 9 || t.errors !== 0) fail("unexpected smoke baseline"); if (!(t.compact_turn_native_attempts > 0)) fail("expected native compact attempts"); if (t.compact_turn_native_hits !== t.compact_turn_native_attempts) fail("expected every compiler-mode native compact attempt to hit"); if (unhandled !== 0) fail("expected no compiler-mode compact unhandled attempts"); if (t.compact_turn_oracle_failures !== 0) fail("expected compact oracle parity"); console.log("compact_turn_codegen_bringup observed compiler-mode attempts="+t.compact_turn_native_attempts+" hits="+t.compact_turn_native_hits+" bridge="+t.compact_turn_bridge_attempts+" unhandled="+unhandled);' "$$out_dir/bringup.json"

compact_turn_codegen_solver_parity: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(find "$(SOLVER_COMPACT_PARITY_CORPUS)" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-codegen-solver-parity-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-codegen-solver-parity-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,$(SOLVER_COMPACT_PARITY_CORPUS),compact_codegen_solver_parity_$$hash,--compact-turn-only --compact-turn-mode=compiler); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
	$(NODE) src/tests/run_solver_compact_parity.js "$$build_dir/native/puzzlescript_solver" "$(SOLVER_COMPACT_PARITY_CORPUS)" --timeout-ms $(SOLVER_COMPACT_PARITY_TIMEOUT_MS) --strategy $(SOLVER_COMPACT_PARITY_STRATEGY) $(SOLVER_COMPACT_PARITY_GAME_ARG) $(SOLVER_COMPACT_PARITY_LEVEL_ARG) $(SOLVER_COMPACT_PARITY_MAX_GAMES_ARG) --compact-turn-oracle --require-compact-oracle-checks --require-compact-handled

compact_turn_codegen_regression_tests: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(find "$(COMPACT_TURN_CODEGEN_REGRESSION_CORPUS)" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-codegen-regression-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-codegen-regression-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,$(COMPACT_TURN_CODEGEN_REGRESSION_CORPUS),compact_codegen_regression_$$hash,--compact-turn-only --compact-turn-mode=compiler); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
	$(NODE) src/tests/run_solver_compact_parity.js "$$build_dir/native/puzzlescript_solver" "$(COMPACT_TURN_CODEGEN_REGRESSION_CORPUS)" --timeout-ms $(SOLVER_COMPACT_PARITY_TIMEOUT_MS) --strategy $(SOLVER_COMPACT_PARITY_STRATEGY) --compact-turn-oracle --require-compact-oracle-checks --require-compact-handled

.PHONY: compact_turn_codegen_dirty_shape
compact_turn_codegen_dirty_shape: build
	$(NODE) src/tests/compact_turn_codegen_dirty_shape_node.js --compiler "$(PUZZLESCRIPT_CPP)"

compact_turn_perf_regression: COMPILED_RULES_OPT_LEVEL = 3
compact_turn_perf_regression: $(PUZZLESCRIPT_SOLVER)
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(find src/tests/solver_tests -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-turn-perf-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-turn-perf-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/solver_tests,compact_turn_perf_$$hash,--compact-turn-only --compact-turn-mode=compiler); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
	$(NODE) src/tests/compact_turn_perf_regression_node.js --corpus src/tests/solver_tests --interpreter-solver "$(PUZZLESCRIPT_SOLVER)" --compiled-solver "$$build_dir/native/puzzlescript_solver" --timeout-ms "$(COMPACT_TURN_PERF_TIMEOUT_MS)"

.PHONY: compact_turn_codegen_perf_suite
compact_turn_codegen_perf_suite: COMPILED_RULES_OPT_LEVEL = 3
compact_turn_codegen_perf_suite: $(PUZZLESCRIPT_SOLVER)
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(find src/tests/solver_tests -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-turn-codegen-perf-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-turn-codegen-perf-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/solver_tests,compact_turn_codegen_perf_$$hash,--compact-turn-only --compact-turn-mode=compiler); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
	$(NODE) src/tests/compact_turn_codegen_perf_suite_node.js \
		--corpus src/tests/solver_tests \
		--interpreter-solver "$(PUZZLESCRIPT_SOLVER)" \
		--compiled-solver "$$build_dir/native/puzzlescript_solver" \
		--timeout-ms "$(COMPACT_TURN_CODEGEN_PERF_TIMEOUT_MS)" \
		--cases "$(COMPACT_TURN_CODEGEN_PERF_CASES)" \
		--out "$(COMPACT_TURN_CODEGEN_PERF_OUT)"

.PHONY: compact_turn_codegen_perf_expectations
compact_turn_codegen_perf_expectations: COMPILED_RULES_OPT_LEVEL = 3
compact_turn_codegen_perf_expectations: $(PUZZLESCRIPT_SOLVER)
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(find src/tests/solver_tests -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-turn-codegen-perf-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-turn-codegen-perf-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/solver_tests,compact_turn_codegen_perf_$$hash,--compact-turn-only --compact-turn-mode=compiler); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
	$(NODE) src/tests/compact_turn_codegen_perf_suite_node.js \
		--corpus src/tests/solver_tests \
		--interpreter-solver "$(PUZZLESCRIPT_SOLVER)" \
		--compiled-solver "$$build_dir/native/puzzlescript_solver" \
		--timeout-ms "$(COMPACT_TURN_CODEGEN_PERF_TIMEOUT_MS)" \
		--cases "$(COMPACT_TURN_CODEGEN_PERF_CASES)" \
		--expectations "$(COMPACT_TURN_CODEGEN_PERF_EXPECTATIONS)" \
		--out "$(COMPACT_TURN_CODEGEN_PERF_OUT)"

compact_turn_codegen_solver_command_api: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(shasum -a 256 "$(COMPACT_TURN_CODEGEN_COMMAND_API_SOURCE)" | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-codegen-command-api-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-codegen-command-api-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,$(COMPACT_TURN_CODEGEN_COMMAND_API_SOURCE),compact_codegen_command_api_$$hash,--compact-turn-only --compact-turn-mode=compiler); \
	$(NODE) -e 'const fs=require("fs"); const sources=fs.readFileSync(process.argv[1],"utf8").trim().split(/\r?\n/).filter(Boolean); const text=sources.map(p=>fs.readFileSync(p,"utf8")).join("\n"); const blocks=[...text.matchAll(/_layer_coupled_movement_terms\[\]\s*=\s*\{([\s\S]*?)\};/g)].map(m=>m[1]); if (!blocks.some(block=>/,\s*0\},/.test(block))) throw new Error("expected clear-only layer-coupled movement term");' "$$sources_file"; \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_cpp_player_api_tests; \
	PUZZLESCRIPT_COMPILED_COMPACT_DISCARD_SOURCE="$$PWD/$(COMPACT_TURN_CODEGEN_COMMAND_API_SOURCE)" "$$build_dir/native/puzzlescript_cpp_player_api_tests"

compact_turn_codegen_frontier:
	$(NODE) scripts/list_compact_codegen_frontier.js src/tests/resources/testdata.js --limit $(COMPACT_TURN_CODEGEN_FRONTIER_LIMIT) --after $(COMPACT_TURN_CODEGEN_FRONTIER_AFTER)

compact_turn_codegen_testdata_one: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	case_index="$(COMPACT_TURN_CODEGEN_TESTDATA_CASE)"; \
	hash=$$(printf '%s\n%s\n' "$$case_index" "$$(shasum -a 256 src/tests/resources/testdata.js | awk '{print $$1}')" | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/compact-codegen-testdata-case-$$case_index-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/compact-codegen-testdata-case-$$case_index-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/resources/testdata.js,compact_codegen_testdata_$$hash,--compact-turn-only --compact-turn-mode=compiler --case-index "$$case_index",$(COMPACT_TURN_TESTDATA_MAX_ROWS)); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_cpp; \
	"$$build_dir/native/puzzlescript_cpp" test simulation-corpus src/tests/resources/testdata.js --case-index "$$case_index" --jobs 1 --progress-every 0 --compact-turn-oracle --require-compact-turn-oracle-checks

compact_turn_codegen_selected_tests:
	@set -e; \
	count=0; \
	for case_index in $(COMPACT_TURN_CODEGEN_SELECTED_CASES); do \
		echo "compact_turn_codegen_selected case=$$case_index"; \
		$(MAKE) --no-print-directory compact_turn_codegen_testdata_one COMPACT_TURN_CODEGEN_TESTDATA_CASE=$$case_index; \
		count=$$((count + 1)); \
	done; \
	echo "compact_turn_codegen_selected_tests passed=$$count"

compact_turn_codegen_simulation_tests: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(shasum -a 256 src/tests/resources/testdata.js | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/testdata-compact-codegen-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/testdata-compact-codegen-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/resources/testdata.js,testdata_compact_codegen_$$hash,--compact-turn-only --compact-turn-mode=compiler,$(COMPACT_TURN_TESTDATA_MAX_ROWS)); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_cpp; \
	"$$build_dir/native/puzzlescript_cpp" test simulation-corpus src/tests/resources/testdata.js $(COMPACT_TURN_SIMULATION_ARGS) --compact-turn-oracle --require-compact-turn-oracle-checks

compact_tick_simulation_tests: compact_turn_simulation_tests

compact_turn_simulation_tests: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$(shasum -a 256 src/tests/resources/testdata.js | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/testdata-compact-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/testdata-compact-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/resources/testdata.js,testdata_compact_$$hash,--compact-turn-only,$(COMPACT_TURN_TESTDATA_MAX_ROWS)); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_cpp; \
	"$$build_dir/native/puzzlescript_cpp" test simulation-corpus src/tests/resources/testdata.js $(COMPACT_TURN_SIMULATION_ARGS) --compact-turn-oracle --require-compact-turn-oracle-checks

compact_tick_coverage: compact_turn_coverage

compact_turn_coverage:
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	mkdir -p "$$(dirname "$(COMPACT_TURN_COVERAGE_JSON)")"; \
	$(PUZZLESCRIPT_CPP) compile-rules src/tests/resources/testdata.js --stats-only --max-rows $(COMPACT_TURN_TESTDATA_MAX_ROWS) --coverage-json "$(COMPACT_TURN_COVERAGE_JSON)"; \
	$(NODE) -e 'const fs=require("fs"); const path=process.argv[1]; const j=JSON.parse(fs.readFileSync(path,"utf8")); const c=j.aggregate.compact_turn||j.aggregate.compact_tick; const sources=c.sources; const native=c.native_kernel_supported; const bridge=c.interpreter_bridge_supported; const callable=c.whole_turn_supported; const pct=n=>sources?((100*n/sources).toFixed(1)+"%"):"n/a"; console.log(""); console.log("compact_turn_coverage"); console.log("  json: "+path); console.log("  unique_sources: "+sources); console.log("  callable_compact_backends: "+callable+"/"+sources+" ("+pct(callable)+")"); console.log("  native_compact_kernels: "+native+"/"+sources+" ("+pct(native)+")"); console.log("  interpreter_bridge_backends: "+bridge+"/"+sources+" ("+pct(bridge)+")"); console.log("  max_rows: "+j.max_rows);' "$(COMPACT_TURN_COVERAGE_JSON)"

compact_turn_codegen_coverage:
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	mkdir -p "$$(dirname "$(COMPACT_TURN_CODEGEN_COVERAGE_JSON)")"; \
	$(PUZZLESCRIPT_CPP) compile-rules src/tests/resources/testdata.js --stats-only --max-rows $(COMPACT_TURN_TESTDATA_MAX_ROWS) --coverage-json "$(COMPACT_TURN_CODEGEN_COVERAGE_JSON)" --compact-turn-mode=compiler; \
	$(NODE) -e 'const fs=require("fs"); const path=process.argv[1]; const j=JSON.parse(fs.readFileSync(path,"utf8")); const c=j.aggregate.compact_turn||j.aggregate.compact_tick; const sources=c.sources; const native=c.native_kernel_supported; const bridge=c.interpreter_bridge_supported; const callable=c.whole_turn_supported; const pct=n=>sources?((100*n/sources).toFixed(1)+"%"):"n/a"; console.log(""); console.log("compact_turn_codegen_coverage"); console.log("  json: "+path); console.log("  unique_sources: "+sources); console.log("  callable_compact_backends: "+callable+"/"+sources+" ("+pct(callable)+")"); console.log("  native_compact_kernels: "+native+"/"+sources+" ("+pct(native)+")"); console.log("  interpreter_bridge_backends: "+bridge+"/"+sources+" ("+pct(bridge)+")"); console.log("  max_rows: "+j.max_rows); if (callable !== sources) throw new Error("expected every compiler-mode source to emit a callable compact backend"); if (native + bridge !== sources) throw new Error("expected native+bridge to cover every compiler-mode source");' "$(COMPACT_TURN_CODEGEN_COVERAGE_JSON)"

compact_turn_native_parity: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	mkdir -p "$$(dirname "$(COMPACT_TURN_CODEGEN_COVERAGE_JSON)")"; \
	$(PUZZLESCRIPT_CPP) compile-rules src/tests/solver_tests --stats-only --compact-turn-only --compact-turn-mode=compiler --coverage-json "$(COMPACT_TURN_CODEGEN_COVERAGE_JSON)"; \
	$(NODE) src/tests/compact_turn_native_parity_node.js "$(COMPACT_TURN_CODEGEN_COVERAGE_JSON)"

solver_determinism_tests: $(SOLVER_TARGET_PREREQ)
	@if [ "$(SPECIALIZE)" = "true" ]; then \
		set -e; \
		$(COMPILED_RULES_BOOTSTRAP_CPP); \
		hash=$$(find src/tests/solver_smoke_tests -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
		out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-smoke-$$hash"; \
		build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-smoke-$$hash"; \
		out_cpp_dir="$$out_dir/sources"; \
		sources_file="$$out_dir/sources.txt"; \
		mkdir -p "$$out_dir"; \
		$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/solver_smoke_tests,solver_smoke_$$hash); \
		$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
		$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
		$(NODE) src/tests/run_solver_determinism.js "$$build_dir/native/puzzlescript_solver" src/tests/solver_smoke_tests --runs 5 --timeout-ms 1000; \
	else \
		$(NODE) src/tests/run_solver_determinism.js $(PUZZLESCRIPT_SOLVER) src/tests/solver_smoke_tests --runs 5 --timeout-ms 1000; \
	fi

solver_parity_smoke: $(SOLVER_TARGET_PREREQ)
	@if [ "$(SPECIALIZE)" = "true" ]; then \
		set -e; \
		$(COMPILED_RULES_BOOTSTRAP_CPP); \
		hash=$$(find src/tests/solver_smoke_tests -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
		out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-smoke-$$hash"; \
		build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-smoke-$$hash"; \
		out_cpp_dir="$$out_dir/sources"; \
		sources_file="$$out_dir/sources.txt"; \
		mkdir -p "$$out_dir"; \
		$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/solver_smoke_tests,solver_smoke_$$hash); \
		$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
		$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
		$(NODE) src/tests/run_solver_parity_smoke.js "$$build_dir/native/puzzlescript_solver" src/tests/solver_smoke_tests; \
	else \
		$(NODE) src/tests/run_solver_parity_smoke.js $(PUZZLESCRIPT_SOLVER) src/tests/solver_smoke_tests; \
	fi

solver_portfolio_regression_tests: $(SOLVER_TARGET_PREREQ)
	$(NODE) src/tests/run_solver_portfolio_regression.js $(PUZZLESCRIPT_SOLVER) $(SOLVER_TESTS_CORPUS)

solver_search_mode_tests: $(SOLVER_TARGET_PREREQ)
	$(NODE) src/tests/run_solver_search_modes_node.js $(PUZZLESCRIPT_SOLVER)
	$(NODE) src/tests/run_solver_hda_smoke_node.js $(PUZZLESCRIPT_SOLVER)
	$(NODE) src/tests/run_native_solver_heuristic_selection_node.js $(PUZZLESCRIPT_SOLVER)

native_static_analysis_parity_tests: $(SOLVER_TARGET_PREREQ)
	$(NODE) src/tests/run_native_static_analysis_parity_node.js $(PUZZLESCRIPT_SOLVER) $(SOLVER_TESTS_CORPUS)

native_static_analysis_native_parity_tests: $(SOLVER_TARGET_PREREQ)
	$(NODE) src/tests/run_native_static_analysis_parity_node.js $(PUZZLESCRIPT_SOLVER) $(SOLVER_TESTS_CORPUS) --native
	$(NODE) src/tests/run_native_static_analysis_parity_node.js $(PUZZLESCRIPT_SOLVER) src/tests/static_analysis_testdata --native

native_static_analysis_fallback_parity_tests: native_static_analysis_native_parity_tests

native_static_analysis_fallback_soundness_tests: native_static_analysis_native_parity_tests

solver_js_coverage_cpp: $(SOLVER_TARGET_PREREQ)
	@set -e; \
	mkdir -p "$(SOLVER_JS_COVERAGE_OUT_DIR)"; \
	$(NODE) src/tests/run_native_solver_js_coverage.js \
		"$(PUZZLESCRIPT_SOLVER)" "$(SOLVER_TESTS_CORPUS)" \
		--timeout-ms $(SOLVER_JS_COVERAGE_TIMEOUT_MS) \
		--strategy "$(SOLVER_JS_COVERAGE_STRATEGY)" \
		--jobs $(SOLVER_JS_COVERAGE_JOBS) \
		--write-js-results "$(SOLVER_JS_COVERAGE_OUT_DIR)/js.json" \
		--write-native-results "$(SOLVER_JS_COVERAGE_OUT_DIR)/native.json" \
		$(SOLVER_JS_COVERAGE_JS_RESULTS_ARG) \
		$(SOLVER_JS_COVERAGE_NATIVE_RESULTS_ARG)

solver_compact_parity_smoke: $(PUZZLESCRIPT_SOLVER)
	$(NODE) src/tests/run_solver_compact_parity.js $(PUZZLESCRIPT_SOLVER) src/tests/solver_smoke_tests --timeout-ms 1000 --strategy bfs

solver_compact_parity: $(PUZZLESCRIPT_SOLVER)
	$(NODE) src/tests/run_solver_compact_parity.js $(PUZZLESCRIPT_SOLVER) $(SOLVER_COMPACT_PARITY_CORPUS) --timeout-ms $(SOLVER_COMPACT_PARITY_TIMEOUT_MS) --strategy $(SOLVER_COMPACT_PARITY_STRATEGY) $(SOLVER_COMPACT_PARITY_GAME_ARG) $(SOLVER_COMPACT_PARITY_LEVEL_ARG) $(SOLVER_COMPACT_PARITY_MAX_GAMES_ARG)

generator_smoke_tests: $(GENERATOR_TARGET_PREREQ)
	@if [ "$(SPECIALIZE)" = "true" ]; then \
		$(MAKE) generator src/demo/sokoban_basic.txt src/tests/generator_presets/sokoban_room_scatter.gen SPECIALIZE=true GENERATOR_ARGS="--time-ms 100 --quiet"; \
	else \
		$(NODE) src/tests/run_generator_smoke.js $(PUZZLESCRIPT_GENERATOR) src/demo/sokoban_basic.txt; \
	fi

generator_benchmark: $(PUZZLESCRIPT_GENERATOR)
	$(NODE) src/tests/run_generator_benchmark.js $(PUZZLESCRIPT_GENERATOR) $(GENERATOR_BENCH_GAME) --presets-dir $(GENERATOR_BENCH_PRESETS_DIR) --samples $(GENERATOR_BENCH_SAMPLES) --runs $(GENERATOR_BENCH_RUNS) --jobs $(GENERATOR_BENCH_JOBS) --seed $(GENERATOR_BENCH_SEED) --solver-timeout-ms $(GENERATOR_BENCH_SOLVER_TIMEOUT_MS) --solver-strategy $(GENERATOR_BENCH_SOLVER_STRATEGY) --top-k $(GENERATOR_BENCH_TOP_K) --out $(GENERATOR_BENCH_OUT)

solver_tests_cpp: $(SOLVER_TARGET_PREREQ)
	@if [ "$(SPECIALIZE)" = "true" ]; then \
		set -e; \
		if [ ! -e "$(SOLVER_TESTS_CORPUS)" ]; then echo "Missing solver corpus: $(SOLVER_TESTS_CORPUS)"; exit 2; fi; \
		$(COMPILED_RULES_BOOTSTRAP_CPP); \
		hash=$$(find "$(SOLVER_TESTS_CORPUS)" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
		out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-corpus-$$hash"; \
		build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-corpus-$$hash"; \
		out_cpp_dir="$$out_dir/sources"; \
		sources_file="$$out_dir/sources.txt"; \
		mkdir -p "$$out_dir"; \
		$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,$(SOLVER_TESTS_CORPUS),solver_corpus_$$hash); \
		$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
		$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
		"$$build_dir/native/puzzlescript_solver" $(SOLVER_TESTS_CORPUS) --timeout-ms $(SOLVER_TIMEOUT_MS) --jobs $(SOLVER_JOBS) --strategy $(SOLVER_STRATEGY) --solutions-dir $(SOLVER_SOLUTIONS_DIR)/native $(SOLVER_PROGRESS_ARGS) $(SOLVER_OUTPUT_ARGS); \
	else \
		$(PUZZLESCRIPT_SOLVER) $(SOLVER_TESTS_CORPUS) --timeout-ms $(SOLVER_TIMEOUT_MS) --jobs $(SOLVER_JOBS) --strategy $(SOLVER_STRATEGY) --solutions-dir $(SOLVER_SOLUTIONS_DIR)/native $(SOLVER_PROGRESS_ARGS) $(SOLVER_OUTPUT_ARGS); \
	fi

solver_tests_js:
	$(NODE) src/tests/run_solver_tests_js.js src/tests/solver_tests --timeout-ms $(SOLVER_TIMEOUT_MS) --solutions-dir $(SOLVER_SOLUTIONS_DIR)/js $(SOLVER_PROGRESS_ARGS) $(SOLVER_OUTPUT_ARGS)

solver-time-curve-single-game:
	@if [ -z "$(strip $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME))" ]; then \
		echo "Usage: make solver-time-curve-single-game path/to/game.txt [SOLVER_TIMEOUT_CURVE_MAX_MS=250]" >&2; \
		exit 2; \
	fi
	@if [ ! -f "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME)" ]; then \
		echo "Missing game file: $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME)" >&2; \
		exit 2; \
	fi
	mkdir -p "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_CORPUS_DIR)"
	cp "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME)" "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_CORPUS_DIR)/$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE)"
	$(MAKE) solver_timeout_curve \
		SOLVER_TESTS_CORPUS="$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_CORPUS_DIR)" \
		SOLVER_TIMEOUT_CURVE_OUT_DIR="$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_OUT_DIR)" \
		SOLVER_TIMEOUT_CURVE_EXTRA_ARGS="$(strip $(SOLVER_TIMEOUT_CURVE_EXTRA_ARGS) --game $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE))" \
		SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_ARGS="$(strip $(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_ARGS) --game $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE))" \
		SOLVER_TIMEOUT_CURVE_CPP_HDA_ARGS="$(strip $(SOLVER_TIMEOUT_CURVE_CPP_HDA_ARGS) --game $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE))" \
		SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_ARGS="$(strip $(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_ARGS) --game $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE))" \
		SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_ARGS="$(strip $(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_ARGS) --game $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE))"

solver-time-curve-single-game-hda-compiled:
	@if [ -z "$(strip $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME))" ]; then \
		echo "Usage: make solver-time-curve-single-game-hda-compiled path/to/game.txt SOLVER_TIMEOUT_CURVE_MAX_MS=30000" >&2; \
		exit 2; \
	fi
	@if [ ! -f "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME)" ]; then \
		echo "Missing game file: $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME)" >&2; \
		exit 2; \
	fi
	mkdir -p "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_CORPUS_DIR)"
	cp "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME)" "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_CORPUS_DIR)/$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE)"
	@set -e; \
	mkdir -p "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_OUT_DIR)"; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	corpus_dir="$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_CORPUS_DIR)"; \
	corpus_hash=$$(find "$$corpus_dir" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
	compiled_hash=$$({ find "$$corpus_dir" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256; shasum -a 256 $(COMPILED_RULES_FINGERPRINT_INPUTS); printf '%s\n' "max_rows=$(COMPILED_RULES_MAX_ROWS)"; printf '%s\n' "compiled_rules_args=$(SOLVER_TIMEOUT_CURVE_CPP_COMPILED_RULES_ARGS)"; printf '%s\n' "compiled_rules_opt_level=$(SOLVER_TIMEOUT_CURVE_COMPILED_RULES_OPT_LEVEL)"; } | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-timeout-curve-$$compiled_hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-timeout-curve-$$compiled_hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	coverage_json="$$out_dir/coverage.json"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,$$corpus_dir,solver_timeout_curve_hda_compiled_$$corpus_hash,$(SOLVER_TIMEOUT_CURVE_CPP_COMPILED_RULES_ARGS) --coverage-json "$$coverage_json"); \
	$(NODE) -e 'const fs=require("fs"); const path=process.argv[1]; const j=JSON.parse(fs.readFileSync(path,"utf8")); const c=(j.aggregate&&j.aggregate.compact_turn)||{}; const sources=c.sources||0; const native=c.native_kernel_supported||0; const bridge=c.interpreter_bridge_supported||0; const callable=c.whole_turn_supported||0; const pct=n=>sources?((100*n/sources).toFixed(1)+"%"):"n/a"; console.log("  compact coverage hda-compiled: callable="+callable+"/"+sources+" native="+native+"/"+sources+" ("+pct(native)+") bridge="+bridge+"/"+sources+" json="+path);' "$$coverage_json"; \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file" -DPS_COMPILED_RULES_OPT_LEVEL=$(SOLVER_TIMEOUT_CURVE_COMPILED_RULES_OPT_LEVEL)); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver 1>&2; \
	compiled_solver="$$build_dir/native/puzzlescript_solver"; \
	echo ""; \
	echo "solver-time-curve-single-game-hda-compiled corpus=$$corpus_dir max=$(SOLVER_TIMEOUT_CURVE_MAX_MS)ms step=$(SOLVER_TIMEOUT_CURVE_STEP_MS)ms"; \
	echo "  solver -> $$compiled_solver"; \
	echo "  JSON -> $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_JSON)"; \
	echo "  chart -> $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_SVG)"; \
	"$$compiled_solver" "$$corpus_dir" --timeout-ms $(SOLVER_TIMEOUT_CURVE_MAX_MS) $(strip $(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_ARGS) --game $(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_BASE)) --json --no-solutions $(SOLVER_TIMEOUT_CURVE_PROGRESS_ARGS) > "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_JSON)"; \
	$(NODE) src/tests/solver_timeout_curve.js \
		--series "c++ hda-weighted-astar x8 compiled:$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_JSON)" \
		--allow-smoke \
		--max-ms $(SOLVER_TIMEOUT_CURVE_MAX_MS) \
		--step-ms $(SOLVER_TIMEOUT_CURVE_STEP_MS) \
		--out-svg "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_SVG)" \
		--out-csv "$(SOLVER_TIMEOUT_CURVE_SINGLE_GAME_HDA_COMPILED_CSV)"

solver_timeout_curve: build_solver
	@set -e; \
	mkdir -p "$(SOLVER_TIMEOUT_CURVE_OUT_DIR)"; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	if [ ! -e "$(SOLVER_TESTS_CORPUS)" ]; then echo "Missing solver corpus: $(SOLVER_TESTS_CORPUS)"; exit 2; fi; \
	canonical_corpus="$(SOLVER_TIMEOUT_CURVE_CANONICAL_CORPUS)"; \
	$(NODE) src/tests/write_solver_canonical_corpus.js "$(SOLVER_TESTS_CORPUS)" "$$canonical_corpus"; \
	build_compiled_solver() { \
		corpus_dir="$$1"; \
		symbol_prefix="$$2"; \
		result_var="$$3"; \
		corpus_hash=$$(find "$$corpus_dir" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
		compiled_hash=$$({ find "$$corpus_dir" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256; shasum -a 256 $(COMPILED_RULES_FINGERPRINT_INPUTS); printf '%s\n' "max_rows=$(COMPILED_RULES_MAX_ROWS)"; printf '%s\n' "compiled_rules_args=$(SOLVER_TIMEOUT_CURVE_CPP_COMPILED_RULES_ARGS)"; printf '%s\n' "compiled_rules_opt_level=$(SOLVER_TIMEOUT_CURVE_COMPILED_RULES_OPT_LEVEL)"; } | shasum -a 256 | awk '{print $$1}'); \
		out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-timeout-curve-$$compiled_hash"; \
		build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-timeout-curve-$$compiled_hash"; \
		out_cpp_dir="$$out_dir/sources"; \
		sources_file="$$out_dir/sources.txt"; \
		coverage_json="$$out_dir/coverage.json"; \
		mkdir -p "$$out_dir"; \
		$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,$$corpus_dir,$${symbol_prefix}_$$corpus_hash,$(SOLVER_TIMEOUT_CURVE_CPP_COMPILED_RULES_ARGS) --coverage-json "$$coverage_json"); \
		$(NODE) -e 'const fs=require("fs"); const path=process.argv[1]; const label=process.argv[2]; const j=JSON.parse(fs.readFileSync(path,"utf8")); const c=(j.aggregate&&j.aggregate.compact_turn)||{}; const sources=c.sources||0; const native=c.native_kernel_supported||0; const bridge=c.interpreter_bridge_supported||0; const callable=c.whole_turn_supported||0; const pct=n=>sources?((100*n/sources).toFixed(1)+"%"):"n/a"; const reasons=c.native_kernel_status_reason_counts||{}; const guarded=reasons.run_rules_on_level_start_native_perf_guard||0; console.log("  compact coverage "+label+": callable="+callable+"/"+sources+" native="+native+"/"+sources+" ("+pct(native)+") bridge="+bridge+"/"+sources+" guarded_run_start="+guarded+" json="+path);' "$$coverage_json" "$$symbol_prefix"; \
		$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file" -DPS_COMPILED_RULES_OPT_LEVEL=$(SOLVER_TIMEOUT_CURVE_COMPILED_RULES_OPT_LEVEL)); \
		$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver 1>&2; \
		eval "$$result_var=\"$$build_dir/native/puzzlescript_solver\""; \
	}; \
	build_compiled_solver "$(SOLVER_TESTS_CORPUS)" solver_timeout_curve compiled_solver; \
	build_compiled_solver "$$canonical_corpus" solver_timeout_curve_canonical compiled_solver_canonical; \
	echo ""; \
	echo "solver_timeout_curve  corpus=$(SOLVER_TESTS_CORPUS) max=$(SOLVER_TIMEOUT_CURVE_MAX_MS)ms step=$(SOLVER_TIMEOUT_CURVE_STEP_MS)ms"; \
	echo "  canonical corpus -> $$canonical_corpus"; \
	echo "  JSON -> $(SOLVER_TIMEOUT_CURVE_JS_JSON) , $(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON) , $(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_JSON) , $(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_CANONICAL_JSON) , $(SOLVER_TIMEOUT_CURVE_CPP_HDA_JSON) , $(SOLVER_TIMEOUT_CURVE_CPP_HDA_CANONICAL_JSON) , $(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_JSON) , $(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_JSON) , $(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_CANONICAL_JSON) , $(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_CANONICAL_JSON)"; \
	echo "  compiled solver -> $$compiled_solver"; \
	echo "  compiled canonical solver -> $$compiled_solver_canonical"; \
	echo "  chart -> $(SOLVER_TIMEOUT_CURVE_SVG)"; \
	echo ""; \
	$(NODE) src/tests/solver_timeout_curve.js "$(SOLVER_TESTS_CORPUS)" \
		--max-ms $(SOLVER_TIMEOUT_CURVE_MAX_MS) \
		--step-ms $(SOLVER_TIMEOUT_CURVE_STEP_MS) \
		--compare-all \
		--label "Javascript" \
		--save-json "$(SOLVER_TIMEOUT_CURVE_JS_JSON)" \
		--save-json-canonical "$(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)" \
		--canonical-corpus "$$canonical_corpus" \
		--cpp-solver "$(PUZZLESCRIPT_SOLVER)" \
		--cpp-series "c++ portfolio:$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_JSON):$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_ARGS)" \
		--cpp-series "c++ portfolio (canonical):$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_CANONICAL_JSON):$$canonical_corpus:$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_ARGS)" \
		--cpp-series "c++ hda-weighted-astar x8:$(SOLVER_TIMEOUT_CURVE_CPP_HDA_JSON):$(SOLVER_TIMEOUT_CURVE_CPP_HDA_ARGS)" \
		--cpp-series "c++ hda-weighted-astar x8 (canonical):$(SOLVER_TIMEOUT_CURVE_CPP_HDA_CANONICAL_JSON):$$canonical_corpus:$(SOLVER_TIMEOUT_CURVE_CPP_HDA_ARGS)" \
		--cpp-series "c++ portfolio compiled:$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_JSON):$$compiled_solver:$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_ARGS)" \
		--cpp-series "c++ hda-weighted-astar x8 compiled:$(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_JSON):$$compiled_solver:$(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_ARGS)" \
		--cpp-series "c++ portfolio compiled (canonical):$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_CANONICAL_JSON):$$canonical_corpus:$$compiled_solver_canonical:$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_ARGS)" \
		--cpp-series "c++ hda-weighted-astar x8 compiled (canonical):$(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_CANONICAL_JSON):$$canonical_corpus:$$compiled_solver_canonical:$(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_ARGS)" \
		--out-svg "$(SOLVER_TIMEOUT_CURVE_SVG)" \
		--out-csv "$(SOLVER_TIMEOUT_CURVE_CSV)" \
		$(SOLVER_TIMEOUT_CURVE_PROGRESS_ARGS) \
		-- $(SOLVER_TIMEOUT_CURVE_JS_ARGS) $(SOLVER_TIMEOUT_CURVE_EXTRA_ARGS)

solver_timeout_curve_replot:
	@set -e; \
	if [ ! -f "$(SOLVER_TIMEOUT_CURVE_JS_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_CANONICAL_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_CPP_HDA_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_CPP_HDA_CANONICAL_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_CANONICAL_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_CANONICAL_JSON)" ]; then \
		echo "Missing saved curve JSON under $(SOLVER_TIMEOUT_CURVE_OUT_DIR)."; \
		echo "Run: make solver_timeout_curve   (full corpus; takes a long time)"; \
		exit 2; \
	fi; \
	mkdir -p "$(SOLVER_TIMEOUT_CURVE_OUT_DIR)"; \
	$(NODE) src/tests/solver_timeout_curve.js \
		--series "Javascript:$(SOLVER_TIMEOUT_CURVE_JS_JSON)" \
		--series "Javascript (canonical):$(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)" \
		--series "c++ portfolio:$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_JSON)" \
		--series "c++ portfolio (canonical):$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_CANONICAL_JSON)" \
		--series "c++ hda-weighted-astar x8:$(SOLVER_TIMEOUT_CURVE_CPP_HDA_JSON)" \
		--series "c++ hda-weighted-astar x8 (canonical):$(SOLVER_TIMEOUT_CURVE_CPP_HDA_CANONICAL_JSON)" \
		--series "c++ portfolio compiled:$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_JSON)" \
		--series "c++ hda-weighted-astar x8 compiled:$(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_JSON)" \
		--series "c++ portfolio compiled (canonical):$(SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_COMPILED_CANONICAL_JSON)" \
		--series "c++ hda-weighted-astar x8 compiled (canonical):$(SOLVER_TIMEOUT_CURVE_CPP_HDA_COMPILED_CANONICAL_JSON)" \
		--out-svg "$(SOLVER_TIMEOUT_CURVE_SVG)" \
		--out-csv "$(SOLVER_TIMEOUT_CURVE_CSV)"

solver_bench_js:
	$(NODE) src/tests/bench_solver.js src/tests/solver_tests --timeout-ms $(SOLVER_TIMEOUT_MS) --quiet --json --no-solutions $(SOLVER_BENCH_JS_EXTRA_ARGS)

js_static_optimization_comparison_solver_smoke:
	@set -e; \
	out="$(JS_STATIC_OPTIMIZATION_COMPARE_OUT)/smoke"; \
	mkdir -p "$$out"; \
	echo ""; \
	echo "js_static_optimization_comparison_solver_smoke  (corpus=src/tests/solver_smoke_tests)"; \
	echo "  JSON -> $$out/baseline.json , $$out/optimized.json"; \
	echo ""; \
	$(NODE) src/tests/run_solver_tests_js.js src/tests/solver_smoke_tests --quiet --json --no-solutions $(JS_STATIC_OPTIMIZATION_COMPARE_EXTRA_ARGS) > "$$out/baseline.json"; \
	$(NODE) src/tests/run_solver_tests_js.js src/tests/solver_smoke_tests --quiet --json --no-solutions --solver-opt all $(JS_STATIC_OPTIMIZATION_COMPARE_EXTRA_ARGS) > "$$out/optimized.json"; \
	echo "=== totals A/B (baseline → optimized) ==="; \
	$(NODE) src/tests/compare_solver_static_opt_runs.js "$$out/baseline.json" "$$out/optimized.json"

js_static_optimization_comparison_solver_focus: $(SOLVER_FOCUS_MANIFEST)
	@set -e; \
	manifest_hash=$$(shasum -a 256 "$(SOLVER_FOCUS_MANIFEST)" | awk '{print $$1}'); \
	out="$(JS_STATIC_OPTIMIZATION_COMPARE_OUT)/focus-$$manifest_hash"; \
	mkdir -p "$$out"; \
	echo ""; \
	echo "js_static_optimization_comparison_solver_focus  (only manifest targets; corpus=$(SOLVER_FOCUS_CORPUS))"; \
	echo "  JSON -> $$out/baseline.json , $$out/optimized.json"; \
	echo ""; \
	$(NODE) src/tests/run_solver_tests_js.js "$(SOLVER_FOCUS_CORPUS)" --solver-focus-manifest "$(SOLVER_FOCUS_MANIFEST)" --quiet --json --no-solutions $(JS_STATIC_OPTIMIZATION_COMPARE_EXTRA_ARGS) > "$$out/baseline.json"; \
	$(NODE) src/tests/run_solver_tests_js.js "$(SOLVER_FOCUS_CORPUS)" --solver-focus-manifest "$(SOLVER_FOCUS_MANIFEST)" --quiet --json --no-solutions --solver-opt all $(JS_STATIC_OPTIMIZATION_COMPARE_EXTRA_ARGS) > "$$out/optimized.json"; \
	echo "=== totals A/B (baseline → optimized) ==="; \
	$(NODE) src/tests/compare_solver_static_opt_runs.js "$$out/baseline.json" "$$out/optimized.json"

action_noop_candidates_focus: $(SOLVER_FOCUS_MANIFEST)
	@set -e; \
	echo "action_noop_candidates_focus  (manifest=$(SOLVER_FOCUS_MANIFEST), corpus=$(SOLVER_FOCUS_CORPUS))"; \
	echo "  JSON -> $(ACTION_NOOP_CANDIDATES_OUT)"; \
	$(NODE) src/tests/report_action_noop_candidates.js "$(SOLVER_FOCUS_CORPUS)" \
		--solver-focus-manifest "$(SOLVER_FOCUS_MANIFEST)" \
		$(ACTION_NOOP_CANDIDATES_BASELINE_ARG) \
		$(ACTION_NOOP_CANDIDATES_FORCED_ARG) \
		--out "$(ACTION_NOOP_CANDIDATES_OUT)"

solver_canonical_replay: $(SOLVER_FOCUS_MANIFEST)
	$(NODE) src/tests/run_canonical_solution_replay.js "$(SOLVER_FOCUS_CORPUS)" --solver-focus-manifest "$(SOLVER_FOCUS_MANIFEST)" --timeout-ms $(SOLVER_CANONICAL_REPLAY_TIMEOUT_MS) --static-optimizations all --strategy $(SOLVER_FOCUS_STRATEGY)

solver_canonical_replay_long: $(SOLVER_FOCUS_LONG_MANIFEST)
	$(NODE) src/tests/run_canonical_solution_replay.js "$(SOLVER_FOCUS_CORPUS)" --solver-focus-manifest "$(SOLVER_FOCUS_LONG_MANIFEST)" --timeout-ms $(SOLVER_CANONICAL_REPLAY_LONG_TIMEOUT_MS) --static-optimizations all --strategy $(SOLVER_FOCUS_STRATEGY)

canonical_roundtrip_replay:
	@set -e; \
	if [ ! -f "$(SOLVER_TIMEOUT_CURVE_JS_JSON)" ] || [ ! -d "$(SOLVER_TIMEOUT_CURVE_CANONICAL_CORPUS)" ]; then \
		echo "Missing $(SOLVER_TIMEOUT_CURVE_JS_JSON) or $(SOLVER_TIMEOUT_CURVE_CANONICAL_CORPUS)."; \
		echo "Run: make solver_timeout_curve"; \
		exit 2; \
	fi; \
	$(NODE) src/tests/run_canonical_roundtrip_replay.js \
		--from-json-orig "$(SOLVER_TIMEOUT_CURVE_JS_JSON)" \
		--from-json-canonical "$(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)" \
		--original-corpus "$(SOLVER_TESTS_CORPUS)" \
		--canonical-corpus "$(SOLVER_TIMEOUT_CURVE_CANONICAL_CORPUS)" \
		--both

patch_solver_timeout_curve_invalid:
	@set -e; \
	if [ ! -f "$(SOLVER_TIMEOUT_CURVE_JS_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)" ]; then \
		echo "Missing $(SOLVER_TIMEOUT_CURVE_JS_JSON) or $(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)."; \
		exit 2; \
	fi; \
	$(NODE) src/tests/patch_solver_timeout_curve_invalid.js --both

compare_solver_timeout_curve_json:
	@set -e; \
	if [ ! -f "$(SOLVER_TIMEOUT_CURVE_JS_JSON)" ] || [ ! -f "$(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)" ]; then \
		echo "Missing $(SOLVER_TIMEOUT_CURVE_JS_JSON) or $(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)."; \
		exit 2; \
	fi; \
	$(NODE) src/tests/compare_solver_timeout_curve_json.js \
		"$(SOLVER_TIMEOUT_CURVE_JS_JSON)" \
		"$(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)"; \
	$(NODE) src/tests/compare_solver_timeout_curve_json.js \
		"$(SOLVER_TIMEOUT_CURVE_JS_JSON)" \
		"$(SOLVER_TIMEOUT_CURVE_JS_CANONICAL_JSON)" \
		--json > "$(SOLVER_TIMEOUT_CURVE_OUT_DIR)/js-vs-canonical-diff.json"

static_optimizer_page:
	@set -e; \
	echo "static_optimizer_page  (corpus=$(STATIC_OPTIMIZER_PAGE_CORPUS) -> $(STATIC_OPTIMIZER_PAGE_OUT))"; \
	$(NODE) src/tests/build_static_optimizer_report.js \
		--corpus "$(STATIC_OPTIMIZER_PAGE_CORPUS)" \
		--out "$(STATIC_OPTIMIZER_PAGE_OUT)" \
		--timeout-ms "$(STATIC_OPTIMIZER_PAGE_TIMEOUT_MS)" \
		$(STATIC_OPTIMIZER_PAGE_GAME_ARG)

solver_tests: solver_smoke_tests solver_search_mode_tests solver_determinism_tests solver_parity_smoke solver_portfolio_regression_tests native_static_analysis_parity_tests native_static_analysis_native_parity_tests solver_tests_cpp solver_tests_js

solver_benchmark: $(SOLVER_TARGET_PREREQ)
	@if [ "$(SPECIALIZE)" = "true" ]; then \
		set -e; \
		if [ ! -e "$(SOLVER_BENCH_CORPUS)" ]; then echo "Missing solver benchmark corpus: $(SOLVER_BENCH_CORPUS)"; exit 2; fi; \
		$(COMPILED_RULES_BOOTSTRAP_CPP); \
		hash=$$(find "$(SOLVER_BENCH_CORPUS)" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $$1}'); \
		out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-bench-$$hash"; \
		build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-bench-$$hash"; \
		out_cpp_dir="$$out_dir/sources"; \
		sources_file="$$out_dir/sources.txt"; \
		mkdir -p "$$out_dir"; \
		$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,$(SOLVER_BENCH_CORPUS),solver_bench_$$hash); \
		$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
		$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
		$(NODE) src/tests/run_solver_benchmark.js "$$build_dir/native/puzzlescript_solver" $(SOLVER_BENCH_CORPUS) --runs $(SOLVER_BENCH_RUNS) --timeout-ms $(SOLVER_BENCH_TIMEOUT_MS) --jobs $(SOLVER_BENCH_JOBS) --strategy $(SOLVER_BENCH_STRATEGY) --out $(SOLVER_BENCH_OUT) --baseline $(SOLVER_PERF_BASELINE); \
	else \
		$(NODE) src/tests/run_solver_benchmark.js $(PUZZLESCRIPT_SOLVER) $(SOLVER_BENCH_CORPUS) --runs $(SOLVER_BENCH_RUNS) --timeout-ms $(SOLVER_BENCH_TIMEOUT_MS) --jobs $(SOLVER_BENCH_JOBS) --strategy $(SOLVER_BENCH_STRATEGY) --out $(SOLVER_BENCH_OUT) --baseline $(SOLVER_PERF_BASELINE); \
	fi

solver_mine_pippable: $(PUZZLESCRIPT_SOLVER)
	$(NODE) src/tests/mine_solver_near_threshold.js $(PUZZLESCRIPT_SOLVER) $(SOLVER_MINE_CORPUS) --timeouts-ms $(SOLVER_MINE_TIMEOUTS_MS) --strategy $(SOLVER_MINE_STRATEGY) --near-ratio $(SOLVER_MINE_NEAR_RATIO) --out $(SOLVER_PIPPABLE_MANIFEST) $(SOLVER_MINE_MAX_TARGETS_ARG)

$(SOLVER_PIPPABLE_MANIFEST): $(PUZZLESCRIPT_SOLVER)
	$(MAKE) solver_mine_pippable

solver_focus_mine: $(PUZZLESCRIPT_SOLVER)
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	$(NODE) src/tests/mine_solver_focus_group.js $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_CORPUS) --timeout-ms $(SOLVER_FOCUS_TIMEOUT_MS) --min-elapsed-ms $(SOLVER_FOCUS_MIN_ELAPSED_MS) --max-targets $(SOLVER_FOCUS_MAX_TARGETS) --strategy $(SOLVER_FOCUS_STRATEGY) --jobs $(SOLVER_FOCUS_JOBS) $(SOLVER_FOCUS_EXCLUDE_GAMES_ARG) --out $(SOLVER_FOCUS_MANIFEST) --repo-root "$$PWD" --puzzlescript-cpp $(PUZZLESCRIPT_CPP) --compile-probe-root $(SOLVER_FOCUS_COMPILE_PROBE_ROOT) --compile-timeout-seconds $(SOLVER_FOCUS_PROBE_TIMEOUT_SECONDS) --compile-max-rows $(SOLVER_FOCUS_COMPILED_RULES_MAX_ROWS) $(SOLVER_FOCUS_MINE_MAX_COMPILED_RULES_PER_SOURCE_ARG) $(SOLVER_FOCUS_MINE_MAX_GENERATED_LINES_PER_SOURCE_ARG) --cmake $(CMAKE) $(SOLVER_FOCUS_MINE_CMAKE_GENERATOR_ARG) --compile-opt-level $(COMPILED_RULES_OPT_LEVEL) --compile-probe-jobs $(SOLVER_FOCUS_COMPILE_PROBE_JOBS) --compile-build-jobs $(SOLVER_FOCUS_COMPILE_BUILD_JOBS)

# The focus manifest is expensive to mine; don't implicitly re-mine just because
# the solver binary changed. Regenerate explicitly via `make solver_focus_mine`.
$(SOLVER_FOCUS_MANIFEST):
	@if [ -e "$@" ]; then \
		echo "solver_focus_manifest: reuse $@"; \
	else \
		$(MAKE) solver_focus_mine; \
	fi

solver_focus_manifest_check:
	$(NODE) src/tests/check_solver_focus_manifest.js

solver_focus_benchmark: $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_MANIFEST)
	@if [ "$(SPECIALIZE)" = "true" ]; then \
		set -e; \
		if [ ! -e "$(SOLVER_FOCUS_CORPUS)" ]; then echo "Missing solver focus corpus: $(SOLVER_FOCUS_CORPUS)"; exit 2; fi; \
		if [ ! -e "$(SOLVER_FOCUS_MANIFEST)" ]; then echo "Missing solver focus manifest: $(SOLVER_FOCUS_MANIFEST)"; exit 2; fi; \
		$(COMPILED_RULES_BOOTSTRAP_CPP); \
		manifest_hash=$$(shasum -a 256 "$(SOLVER_FOCUS_MANIFEST)" | awk '{print $$1}'); \
		focus_corpus_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-focus-corpus-$$manifest_hash"; \
		$(NODE) src/tests/extract_solver_focus_corpus.js "$(SOLVER_FOCUS_MANIFEST)" "$(SOLVER_FOCUS_CORPUS)" "$$focus_corpus_dir"; \
		hash=$$({ find "$$focus_corpus_dir" -type f -name '*.txt' -print0 | sort -z | xargs -0 shasum -a 256; shasum -a 256 "$(SOLVER_FOCUS_MANIFEST)" $(COMPILED_RULES_FINGERPRINT_INPUTS); printf '%s\n' "max_rows=$(SOLVER_FOCUS_COMPILED_RULES_MAX_ROWS)"; printf '%s\n' "max_compiled_rules_per_source=$(SOLVER_FOCUS_MAX_COMPILED_RULES_PER_SOURCE)"; printf '%s\n' "max_generated_lines_per_source=$(SOLVER_FOCUS_MAX_GENERATED_LINES_PER_SOURCE)"; printf '%s\n' "opt_level=$(COMPILED_RULES_OPT_LEVEL)"; printf '%s\n' "perf=$(COMPILED_RULES_PERF)"; printf '%s\n' "solver_focus_compiled_rules_args=$(SOLVER_FOCUS_COMPILED_RULES_ARGS)"; } | shasum -a 256 | awk '{print $$1}'); \
		out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/solver-focus-$$hash"; \
		build_dir="$(COMPILED_RULES_BUILD_ROOT)/solver-focus-$$hash"; \
		out_cpp_dir="$$out_dir/sources"; \
		sources_file="$$out_dir/sources.txt"; \
		mkdir -p "$$out_dir"; \
		$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,$$focus_corpus_dir,solver_focus_$$hash,$(SOLVER_FOCUS_MAX_COMPILED_RULES_PER_SOURCE_ARG) $(SOLVER_FOCUS_MAX_GENERATED_LINES_PER_SOURCE_ARG) $(SOLVER_FOCUS_COMPILED_RULES_ARGS),$(SOLVER_FOCUS_COMPILED_RULES_MAX_ROWS)); \
		$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
		$(SOLVER_FOCUS_COMPILE_TIMEOUT_PREFIX) $(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_solver; \
		$(NODE) src/tests/run_solver_level_benchmark.js "$$build_dir/native/puzzlescript_solver" $(SOLVER_FOCUS_CORPUS) $(SOLVER_FOCUS_MANIFEST) --runs $(SOLVER_FOCUS_RUNS) --strategy $(SOLVER_FOCUS_STRATEGY) --timeout-ms $(SOLVER_FOCUS_TIMEOUT_MS) --jobs $(SOLVER_FOCUS_BENCHMARK_JOBS) --out $(SOLVER_FOCUS_OUT) $(SOLVER_FOCUS_PROFILE_COUNTERS_ARG) $(SOLVER_FOCUS_SOLVER_ARG_ARGS); \
	else \
		$(NODE) src/tests/run_solver_level_benchmark.js $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_CORPUS) $(SOLVER_FOCUS_MANIFEST) --runs $(SOLVER_FOCUS_RUNS) --strategy $(SOLVER_FOCUS_STRATEGY) --timeout-ms $(SOLVER_FOCUS_TIMEOUT_MS) --jobs $(SOLVER_FOCUS_BENCHMARK_JOBS) --out $(SOLVER_FOCUS_OUT) $(SOLVER_FOCUS_PROFILE_COUNTERS_ARG) $(SOLVER_FOCUS_SOLVER_ARG_ARGS); \
	fi

$(SOLVER_FOCUS_INTERPRETED_OUT): $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_MANIFEST)
	$(MAKE) solver_focus_benchmark SOLVER_FOCUS_OUT="$@"

$(SOLVER_FOCUS_COMPILED_OUT): $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_MANIFEST)
	$(MAKE) solver_focus_benchmark SPECIALIZE=true SOLVER_FOCUS_OUT="$@"

solver_focus_compare: $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_MANIFEST)
	@set -e; \
	if ! $(NODE) src/tests/check_solver_focus_benchmark_fresh.js "$(SOLVER_FOCUS_INTERPRETED_OUT)" "$(SOLVER_FOCUS_MANIFEST)" --runs $(SOLVER_FOCUS_RUNS) --corpus "$(SOLVER_FOCUS_CORPUS)" --strategy "$(SOLVER_FOCUS_STRATEGY)" --profile-runtime-counters "$(SOLVER_FOCUS_PROFILE_COUNTERS)" $(SOLVER_FOCUS_SOLVER_ARG_ARGS) $(SOLVER_FOCUS_BENCHMARK_FRESH_ARGS); then \
		$(MAKE) solver_focus_benchmark SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_INTERPRETED_OUT)"; \
	fi; \
	if ! $(NODE) src/tests/check_solver_focus_benchmark_fresh.js "$(SOLVER_FOCUS_COMPILED_OUT)" "$(SOLVER_FOCUS_MANIFEST)" --runs $(SOLVER_FOCUS_RUNS) --corpus "$(SOLVER_FOCUS_CORPUS)" --strategy "$(SOLVER_FOCUS_STRATEGY)" --profile-runtime-counters "$(SOLVER_FOCUS_PROFILE_COUNTERS)" $(SOLVER_FOCUS_SOLVER_ARG_ARGS) $(SOLVER_FOCUS_BENCHMARK_FRESH_ARGS); then \
		$(MAKE) solver_focus_benchmark SPECIALIZE=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_COMPILED_OUT)"; \
	fi; \
	$(NODE) src/tests/compare_solver_focus_benchmarks.js "$(SOLVER_FOCUS_INTERPRETED_OUT)" "$(SOLVER_FOCUS_COMPILED_OUT)"

solver_focus_compact_compare: $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_MANIFEST)
	@set -e; \
	if ! $(NODE) src/tests/check_solver_focus_benchmark_fresh.js "$(SOLVER_FOCUS_INTERPRETED_OUT)" "$(SOLVER_FOCUS_MANIFEST)" --runs $(SOLVER_FOCUS_RUNS) --corpus "$(SOLVER_FOCUS_CORPUS)" --strategy "$(SOLVER_FOCUS_STRATEGY)" --profile-runtime-counters "$(SOLVER_FOCUS_PROFILE_COUNTERS)" $(SOLVER_FOCUS_COMPACT_SOLVER_ARG_ARGS) $(SOLVER_FOCUS_BENCHMARK_FRESH_ARGS); then \
		$(MAKE) solver_focus_benchmark SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_INTERPRETED_OUT)" SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_SOLVER_ARGS)"; \
	fi; \
	if ! $(NODE) src/tests/check_solver_focus_benchmark_fresh.js "$(SOLVER_FOCUS_COMPACT_COMPILED_OUT)" "$(SOLVER_FOCUS_MANIFEST)" --runs $(SOLVER_FOCUS_RUNS) --corpus "$(SOLVER_FOCUS_CORPUS)" --strategy "$(SOLVER_FOCUS_STRATEGY)" --profile-runtime-counters "$(SOLVER_FOCUS_PROFILE_COUNTERS)" $(SOLVER_FOCUS_COMPACT_SOLVER_ARG_ARGS) $(SOLVER_FOCUS_BENCHMARK_FRESH_ARGS); then \
		$(MAKE) solver_focus_benchmark SPECIALIZE=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_COMPACT_COMPILED_OUT)" SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_SOLVER_ARGS)"; \
	fi; \
	$(NODE) src/tests/compare_solver_focus_benchmarks.js "$(SOLVER_FOCUS_INTERPRETED_OUT)" "$(SOLVER_FOCUS_COMPACT_COMPILED_OUT)"

solver_focus_compact_codegen_compare: $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_MANIFEST)
	@set -e; \
	if ! $(NODE) src/tests/check_solver_focus_benchmark_fresh.js "$(SOLVER_FOCUS_INTERPRETED_OUT)" "$(SOLVER_FOCUS_MANIFEST)" --runs $(SOLVER_FOCUS_RUNS) --corpus "$(SOLVER_FOCUS_CORPUS)" --strategy "$(SOLVER_FOCUS_PARITY_STRATEGY)" --profile-runtime-counters "$(SOLVER_FOCUS_PROFILE_COUNTERS)" $(SOLVER_FOCUS_COMPACT_CODEGEN_INTERPRETED_SOLVER_ARG_ARGS) $(SOLVER_FOCUS_BENCHMARK_FRESH_ARGS); then \
		$(MAKE) solver_focus_benchmark SPECIALIZE=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_INTERPRETED_OUT)" SOLVER_FOCUS_RUNS=$(SOLVER_FOCUS_RUNS) SOLVER_FOCUS_STRATEGY="$(SOLVER_FOCUS_PARITY_STRATEGY)" SOLVER_FOCUS_TIMEOUT_MS=$(SOLVER_FOCUS_PARITY_TIMEOUT_MS) SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_CODEGEN_INTERPRETED_SOLVER_ARGS)" SOLVER_FOCUS_COMPILED_RULES_ARGS="$(SOLVER_FOCUS_COMPACT_CODEGEN_RULES_ARGS)"; \
	fi; \
	if ! $(NODE) src/tests/check_solver_focus_benchmark_fresh.js "$(SOLVER_FOCUS_COMPACT_CODEGEN_COMPILED_OUT)" "$(SOLVER_FOCUS_MANIFEST)" --runs $(SOLVER_FOCUS_RUNS) --corpus "$(SOLVER_FOCUS_CORPUS)" --strategy "$(SOLVER_FOCUS_PARITY_STRATEGY)" --profile-runtime-counters "$(SOLVER_FOCUS_PROFILE_COUNTERS)" $(SOLVER_FOCUS_COMPACT_SOLVER_ARG_ARGS) $(SOLVER_FOCUS_BENCHMARK_FRESH_ARGS); then \
		$(MAKE) solver_focus_benchmark SPECIALIZE=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_COMPACT_CODEGEN_COMPILED_OUT)" SOLVER_FOCUS_RUNS=$(SOLVER_FOCUS_RUNS) SOLVER_FOCUS_STRATEGY="$(SOLVER_FOCUS_PARITY_STRATEGY)" SOLVER_FOCUS_TIMEOUT_MS=$(SOLVER_FOCUS_PARITY_TIMEOUT_MS) SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_SOLVER_ARGS)" SOLVER_FOCUS_COMPILED_RULES_ARGS="$(SOLVER_FOCUS_COMPACT_CODEGEN_RULES_ARGS)"; \
	fi; \
	$(NODE) src/tests/compare_solver_focus_benchmarks.js "$(SOLVER_FOCUS_INTERPRETED_OUT)" "$(SOLVER_FOCUS_COMPACT_CODEGEN_COMPILED_OUT)" --require-work-parity

solver_corpus_manifest: $(PUZZLESCRIPT_CPP)
	$(NODE) src/tests/generate_solver_corpus_manifest.js "$(SOLVER_COMPACT_PARITY_CORPUS)" "$(SOLVER_CORPUS_MANIFEST)" --puzzlescript-cpp $(PUZZLESCRIPT_CPP) --timeout-ms $(SOLVER_FOCUS_PARITY_TIMEOUT_MS) --strategy $(SOLVER_FOCUS_PARITY_STRATEGY) $(SOLVER_CORPUS_MANIFEST_MAX_GAMES_ARG) $(SOLVER_CORPUS_MANIFEST_MAX_TARGETS_ARG)

solver_corpus_compact_codegen_compare: $(PUZZLESCRIPT_SOLVER) solver_corpus_manifest
	@set -e; \
	if ! $(NODE) src/tests/check_solver_focus_benchmark_fresh.js "$(SOLVER_CORPUS_INTERPRETED_OUT)" "$(SOLVER_CORPUS_MANIFEST)" --runs $(SOLVER_CORPUS_RUNS) --corpus "$(SOLVER_COMPACT_PARITY_CORPUS)" --strategy "$(SOLVER_FOCUS_PARITY_STRATEGY)" --profile-runtime-counters "$(SOLVER_FOCUS_PROFILE_COUNTERS)" $(SOLVER_FOCUS_COMPACT_CODEGEN_INTERPRETED_SOLVER_ARG_ARGS) $(SOLVER_FOCUS_BENCHMARK_FRESH_ARGS); then \
		$(MAKE) solver_focus_benchmark SPECIALIZE=true SOLVER_FOCUS_MANIFEST="$(SOLVER_CORPUS_MANIFEST)" SOLVER_FOCUS_CORPUS="$(SOLVER_COMPACT_PARITY_CORPUS)" SOLVER_FOCUS_OUT="$(SOLVER_CORPUS_INTERPRETED_OUT)" SOLVER_FOCUS_RUNS=$(SOLVER_CORPUS_RUNS) SOLVER_FOCUS_STRATEGY="$(SOLVER_FOCUS_PARITY_STRATEGY)" SOLVER_FOCUS_TIMEOUT_MS=$(SOLVER_FOCUS_PARITY_TIMEOUT_MS) SOLVER_FOCUS_BENCHMARK_JOBS=$(SOLVER_CORPUS_JOBS) SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_CODEGEN_INTERPRETED_SOLVER_ARGS)" SOLVER_FOCUS_COMPILED_RULES_ARGS="$(SOLVER_FOCUS_COMPACT_CODEGEN_RULES_ARGS)"; \
	fi; \
	if ! $(NODE) src/tests/check_solver_focus_benchmark_fresh.js "$(SOLVER_CORPUS_COMPILED_OUT)" "$(SOLVER_CORPUS_MANIFEST)" --runs $(SOLVER_CORPUS_RUNS) --corpus "$(SOLVER_COMPACT_PARITY_CORPUS)" --strategy "$(SOLVER_FOCUS_PARITY_STRATEGY)" --profile-runtime-counters "$(SOLVER_FOCUS_PROFILE_COUNTERS)" $(SOLVER_FOCUS_COMPACT_SOLVER_ARG_ARGS) $(SOLVER_FOCUS_BENCHMARK_FRESH_ARGS); then \
		$(MAKE) solver_focus_benchmark SPECIALIZE=true SOLVER_FOCUS_MANIFEST="$(SOLVER_CORPUS_MANIFEST)" SOLVER_FOCUS_CORPUS="$(SOLVER_COMPACT_PARITY_CORPUS)" SOLVER_FOCUS_OUT="$(SOLVER_CORPUS_COMPILED_OUT)" SOLVER_FOCUS_RUNS=$(SOLVER_CORPUS_RUNS) SOLVER_FOCUS_STRATEGY="$(SOLVER_FOCUS_PARITY_STRATEGY)" SOLVER_FOCUS_TIMEOUT_MS=$(SOLVER_FOCUS_PARITY_TIMEOUT_MS) SOLVER_FOCUS_BENCHMARK_JOBS=$(SOLVER_CORPUS_JOBS) SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_SOLVER_ARGS)" SOLVER_FOCUS_COMPILED_RULES_ARGS="$(SOLVER_FOCUS_COMPACT_CODEGEN_RULES_ARGS)"; \
	fi; \
	$(NODE) src/tests/compare_solver_focus_benchmarks.js "$(SOLVER_CORPUS_INTERPRETED_OUT)" "$(SOLVER_CORPUS_COMPILED_OUT)" --require-work-parity

solver_focus_perf_report: $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_MANIFEST)
	@set -e; \
	$(MAKE) solver_focus_benchmark SOLVER_FOCUS_RUNS=$(SOLVER_FOCUS_RUNS) SOLVER_FOCUS_PROFILE_COUNTERS=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_PERF_INTERPRETED_OUT)"; \
	$(MAKE) solver_focus_benchmark SPECIALIZE=true COMPILED_RULES_PERF=true SOLVER_FOCUS_RUNS=$(SOLVER_FOCUS_RUNS) SOLVER_FOCUS_PROFILE_COUNTERS=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_PERF_COMPILED_OUT)"; \
	$(NODE) src/tests/compare_solver_focus_benchmarks.js "$(SOLVER_FOCUS_PERF_INTERPRETED_OUT)" "$(SOLVER_FOCUS_PERF_COMPILED_OUT)" --detail --goal-ratio 0.5 || \
		(echo "solver_focus_perf_report: goal-ratio check failed (non-fatal); see metrics above." && true)

solver_focus_compact_perf_report: $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_MANIFEST)
	@set -e; \
	$(MAKE) solver_focus_benchmark SOLVER_FOCUS_RUNS=$(SOLVER_FOCUS_RUNS) SOLVER_FOCUS_PROFILE_COUNTERS=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_PERF_INTERPRETED_OUT)" SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_SOLVER_ARGS)"; \
	$(MAKE) solver_focus_benchmark SPECIALIZE=true COMPILED_RULES_PERF=true SOLVER_FOCUS_RUNS=$(SOLVER_FOCUS_RUNS) SOLVER_FOCUS_PROFILE_COUNTERS=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_COMPACT_PERF_COMPILED_OUT)" SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_SOLVER_ARGS)"; \
	$(NODE) src/tests/compare_solver_focus_benchmarks.js "$(SOLVER_FOCUS_PERF_INTERPRETED_OUT)" "$(SOLVER_FOCUS_COMPACT_PERF_COMPILED_OUT)" --detail --goal-ratio 0.5 || \
		(echo "solver_focus_compact_perf_report: goal-ratio check failed (non-fatal); see metrics above." && true)

solver_focus_compact_codegen_perf_report: $(PUZZLESCRIPT_SOLVER) $(SOLVER_FOCUS_MANIFEST)
	@set -e; \
	$(MAKE) solver_focus_benchmark SOLVER_FOCUS_RUNS=$(SOLVER_FOCUS_RUNS) SOLVER_FOCUS_PROFILE_COUNTERS=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_PERF_INTERPRETED_OUT)" SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_SOLVER_ARGS)"; \
	$(MAKE) solver_focus_benchmark SPECIALIZE=true COMPILED_RULES_PERF=true SOLVER_FOCUS_RUNS=$(SOLVER_FOCUS_RUNS) SOLVER_FOCUS_PROFILE_COUNTERS=true SOLVER_FOCUS_OUT="$(SOLVER_FOCUS_COMPACT_CODEGEN_PERF_COMPILED_OUT)" SOLVER_FOCUS_SOLVER_ARGS="$(SOLVER_FOCUS_COMPACT_SOLVER_ARGS)" SOLVER_FOCUS_COMPILED_RULES_ARGS="$(SOLVER_FOCUS_COMPACT_CODEGEN_RULES_ARGS)"; \
	$(NODE) src/tests/compare_solver_focus_benchmarks.js "$(SOLVER_FOCUS_PERF_INTERPRETED_OUT)" "$(SOLVER_FOCUS_COMPACT_CODEGEN_PERF_COMPILED_OUT)" --detail --goal-ratio 0.5 || \
		(echo "solver_focus_compact_codegen_perf_report: goal-ratio check failed (non-fatal); see metrics above." && true)

solver_benchmark_targets: $(PUZZLESCRIPT_SOLVER) $(SOLVER_TARGET_BENCH_MANIFEST)
	$(NODE) src/tests/run_solver_level_benchmark.js $(PUZZLESCRIPT_SOLVER) $(SOLVER_TARGET_BENCH_CORPUS) $(SOLVER_TARGET_BENCH_MANIFEST) --runs $(SOLVER_TARGET_BENCH_RUNS) --strategy $(SOLVER_TARGET_BENCH_STRATEGY) --out $(SOLVER_TARGET_BENCH_OUT) $(SOLVER_TARGET_BENCH_TIMEOUT_ARG)

.PHONY: solver_benchmark_slice_manifest js_solver_bench_pair_smoke js_solver_bench_pair_slice solver_bench_summary solver_bench_freshness
solver_benchmark_slice_manifest:
	$(NODE) src/tests/generate_solver_benchmark_slice_manifest.js "$(SOLVER_BENCH_SLICE)" --out "$(SOLVER_BENCH_SLICE_MANIFEST)"

js_solver_bench_pair_smoke:
	$(NODE) src/tests/run_js_solver_bench_pair.js src/tests/solver_smoke_tests --store "$(SOLVER_BENCH_STORE)" --slice "$(SOLVER_BENCH_SLICE)" --runs $(SOLVER_BENCH_PAIR_RUNS) --out-dir "$(SOLVER_BENCH_OUT_DIR)" --noise-band 1 --candidate-arg --adaptive-step-cost -- --game push_goal.txt --quiet --json --no-solutions

js_solver_bench_pair_slice: solver_benchmark_slice_manifest
	$(NODE) src/tests/run_js_solver_bench_pair.js "$(SOLVER_BENCH_CORPUS)" --store "$(SOLVER_BENCH_STORE)" --slice "$(SOLVER_BENCH_SLICE)" --runs $(SOLVER_BENCH_PAIR_RUNS) --out-dir "$(SOLVER_BENCH_OUT_DIR)" --slice-manifest "$(SOLVER_BENCH_SLICE_MANIFEST)" --noise-band 1 --candidate-arg --adaptive-step-cost -- --quiet --json --no-solutions

solver_bench_summary:
	$(NODE) src/tests/solver_bench_store_cli.js summary --store "$(SOLVER_BENCH_STORE)" --slice "$(SOLVER_BENCH_SLICE)"

solver_bench_freshness:
	$(NODE) src/tests/solver_bench_store_cli.js freshness --store "$(SOLVER_BENCH_STORE)" --slice "$(SOLVER_BENCH_SLICE)" --max-age-hours $(SOLVER_BENCH_FRESH_HOURS)

solver_instrumentation_pack: $(PUZZLESCRIPT_SOLVER)
	$(NODE) src/tests/run_native_solver_instrumentation_pack.js \
		"$(PUZZLESCRIPT_SOLVER)" "$(SOLVER_TESTS_CORPUS)" \
		--out-dir "$(SOLVER_INSTRUMENTATION_OUT_DIR)" \
		--timeout-ms $(SOLVER_INSTRUMENTATION_TIMEOUT_MS) \
		--runs $(SOLVER_INSTRUMENTATION_RUNS) \
		--max-targets $(SOLVER_INSTRUMENTATION_MAX_TARGETS) \
		$(SOLVER_INSTRUMENTATION_JS_RESULTS_ARG) \
		$(SOLVER_INSTRUMENTATION_NATIVE_RESULTS_ARG) \
		$(SOLVER_INSTRUMENTATION_MANIFEST_ARGS) \
		$(SOLVER_INSTRUMENTATION_PROFILE_COUNTERS_ARG) \
		$(SOLVER_INSTRUMENTATION_DRY_RUN_ARG)

solver_instrumentation_analysis:
	$(NODE) src/tests/analyze_native_solver_instrumentation_pack.js \
		"$(SOLVER_INSTRUMENTATION_ANALYSIS_SUMMARY)" \
		--format "$(SOLVER_INSTRUMENTATION_ANALYSIS_FORMAT)" \
		--min-support $(SOLVER_INSTRUMENTATION_ANALYSIS_MIN_SUPPORT) \
		--slow-loss-ms $(SOLVER_INSTRUMENTATION_ANALYSIS_SLOW_LOSS_MS) \
		--top-tags $(SOLVER_INSTRUMENTATION_ANALYSIS_TOP_TAGS) \
		$(SOLVER_INSTRUMENTATION_ANALYSIS_OUT_ARG)

solver_instrumentation_analysis_tests:
	$(NODE) src/tests/run_solver_level_benchmark_node.js
	$(NODE) src/tests/native_solver_instrumentation_pack_node.js
	$(NODE) src/tests/analyze_native_solver_instrumentation_pack_node.js

$(JS_PARITY_MANIFEST): $(JS_PARITY_INPUTS)
	$(NODE) src/tests/js_oracle/export_native_fixtures.js $(JS_PARITY_DATA_DIR)

js-parity-data: $(JS_PARITY_MANIFEST)

simulation_tests_cpp: build
	$(PUZZLESCRIPT_CPP) test simulation-corpus src/tests/resources/testdata.js --jobs auto --progress-every 0

simulation_tests_cpp_32: build_32
	$(PUZZLESCRIPT_CPP_32) test simulation-corpus src/tests/resources/testdata.js --jobs auto --progress-every 0

simulation_corpus_interpreter_benchmark: build
	$(PUZZLESCRIPT_CPP) test simulation-corpus src/tests/resources/testdata.js $(SIMULATION_CORPUS_BENCH_ARGS)

simulation_corpus_compiled_rulegroups_benchmark: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$({ shasum -a 256 src/tests/resources/testdata.js; \
		printf '%s\n' "max_rows=$(SIMULATION_CORPUS_COMPILED_RULES_MAX_ROWS)"; \
		printf '%s\n' "max_compiled_rules_per_source=$(SIMULATION_CORPUS_COMPILED_RULES_MAX_COMPILED_RULES_PER_SOURCE)"; \
		printf '%s\n' "max_generated_lines_per_source=$(SIMULATION_CORPUS_COMPILED_RULES_MAX_GENERATED_LINES_PER_SOURCE)"; \
		printf '%s\n' "opt_level=$(COMPILED_RULES_OPT_LEVEL)"; \
	} | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/testdata-rulegroups-bench-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/testdata-rulegroups-bench-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/resources/testdata.js,testdata_rulegroups_bench_$$hash,--max-compiled-rules-per-source $(SIMULATION_CORPUS_COMPILED_RULES_MAX_COMPILED_RULES_PER_SOURCE) --max-generated-lines-per-source $(SIMULATION_CORPUS_COMPILED_RULES_MAX_GENERATED_LINES_PER_SOURCE),$(SIMULATION_CORPUS_COMPILED_RULES_MAX_ROWS)); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_cpp; \
	"$$build_dir/native/puzzlescript_cpp" test simulation-corpus src/tests/resources/testdata.js $(SIMULATION_CORPUS_BENCH_ARGS)

simulation_corpus_compiled_compact_benchmark: build
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	hash=$$({ shasum -a 256 src/tests/resources/testdata.js; \
		printf '%s\n' "max_rows=$(COMPACT_TURN_TESTDATA_MAX_ROWS)"; \
		printf '%s\n' "compact_turn_mode=compiler"; \
		printf '%s\n' "turn_executor=compiled_compact"; \
		printf '%s\n' "opt_level=$(COMPILED_RULES_OPT_LEVEL)"; \
	} | shasum -a 256 | awk '{print $$1}'); \
	out_dir="$(COMPILED_RULES_ARTIFACT_ROOT)/testdata-compact-primary-bench-$$hash"; \
	build_dir="$(COMPILED_RULES_BUILD_ROOT)/testdata-compact-primary-bench-$$hash"; \
	out_cpp_dir="$$out_dir/sources"; \
	sources_file="$$out_dir/sources.txt"; \
	runtime_ir_cache="$$out_dir/runtime_ir_cache.json"; \
	emit_cache_arg=""; \
	run_cache_arg=""; \
	if [ "$(SIMULATION_CORPUS_COMPILED_USE_RUNTIME_IR_CACHE)" = "true" ]; then \
		emit_cache_arg="--emit-runtime-ir-cache $$runtime_ir_cache"; \
		run_cache_arg="--runtime-ir-cache $$runtime_ir_cache"; \
	fi; \
	mkdir -p "$$out_dir"; \
	$(call COMPILED_RULES_EMIT_SHARDED,$$out_dir,src/tests/resources/testdata.js,testdata_compact_primary_bench_$$hash,--compact-turn-only --compact-turn-mode=compiler $$emit_cache_arg,$(COMPACT_TURN_TESTDATA_MAX_ROWS)); \
	$(call COMPILED_RULES_CONFIGURE,$$build_dir,-DPS_COMPILED_RULES_SOURCE= -DPS_COMPILED_RULES_SOURCES_FILE="$$PWD/$$sources_file"); \
	$(CMAKE) --build "$$build_dir" $(COMPILED_RULES_BUILD_PARALLEL_ARG) --target puzzlescript_cpp; \
	"$$build_dir/native/puzzlescript_cpp" test simulation-corpus src/tests/resources/testdata.js $(SIMULATION_CORPUS_BENCH_ARGS) --turn-executor=compiled-compact $$run_cache_arg

simulation_corpus_perf_report:
	@set -e; \
	echo "simulation_corpus_perf_report: interpreter"; \
	$(MAKE) --no-print-directory simulation_corpus_interpreter_benchmark; \
	echo ""; \
	echo "simulation_corpus_perf_report: compiled-rulegroups"; \
	$(MAKE) --no-print-directory simulation_corpus_compiled_rulegroups_benchmark COMPILED_RULES_OPT_LEVEL=3; \
	echo ""; \
	echo "simulation_corpus_perf_report: compiled-compact-primary"; \
	$(MAKE) --no-print-directory simulation_corpus_compiled_compact_benchmark COMPILED_RULES_OPT_LEVEL=3

simulation_corpus_perf_report_quick:
	@$(MAKE) --no-print-directory simulation_corpus_perf_report SIMULATION_CORPUS_BENCH_ARGS="--jobs 1 --progress-every 0 --profile-timers --repeat 1 --quiet"

performance_testpage: build build_solver build_generator
	$(NODE) scripts/build_performance_testpage.js --out "$(PERFORMANCE_TESTPAGE_OUT)" $(if $(filter true,$(PERFORMANCE_TESTPAGE_QUICK)),--quick,) $(if $(filter true,$(PERFORMANCE_TESTPAGE_PROFILE)),--profile,)

compiled_rules_simulation_suite_coverage:
	@set -e; \
	$(COMPILED_RULES_BOOTSTRAP_CPP); \
	mkdir -p "$$(dirname "$(COMPILED_RULES_SIMULATION_SUITE_COVERAGE_JSON)")"; \
	$(PUZZLESCRIPT_CPP) compile-rules src/tests/resources/testdata.js --stats-only --max-rows $(COMPILED_RULES_SIMULATION_SUITE_MAX_ROWS) --coverage-json "$(COMPILED_RULES_SIMULATION_SUITE_COVERAGE_JSON)"

compiled_rules_coverage_shape_smoke: build
	@set -e; \
	out="$(BUILD_DIR)/native/compiled_rules_coverage_shape_smoke.json"; \
	$(PUZZLESCRIPT_CPP) compile-rules src/tests/solver_smoke_tests --stats-only --max-rows 1 --coverage-json "$$out"; \
	$(NODE) src/tests/assert_compiled_rules_coverage_shape.js "$$out"

simulation_tests_cpp_js_parity: build_32 $(JS_PARITY_MANIFEST)
	$(NODE) src/tests/run_native_trace_suite.js $(JS_PARITY_MANIFEST) --cli $(PUZZLESCRIPT_CPP_32) --progress-every 1 --timeout-ms 45000

$(ERRORMESSAGE_PARSER_BUNDLE): $(PARSER_CORPUS_BUNDLE_INPUTS) $(JS_PARITY_INPUTS)
	mkdir -p "$(BUILD_DIR)"
	$(NODE) scripts/build_parser_corpus_bundle.js errormessage > "$(ERRORMESSAGE_PARSER_BUNDLE)"

$(TESTDATA_PARSER_BUNDLE): $(PARSER_CORPUS_BUNDLE_INPUTS) $(JS_PARITY_INPUTS)
	mkdir -p "$(BUILD_DIR)"
	$(NODE) scripts/build_parser_corpus_bundle.js testdata > "$(TESTDATA_PARSER_BUNDLE)"

parser_corpus_errormessage_bundle: $(ERRORMESSAGE_PARSER_BUNDLE)

parser_corpus_testdata_bundle: $(TESTDATA_PARSER_BUNDLE)

compilation_tests_cpp: build
	$(PUZZLESCRIPT_CPP) test diagnostics-corpus src/tests/resources/errormessage_testdata.js --progress-every 50

compilation_tests_cpp_32: build_32
	$(PUZZLESCRIPT_CPP_32) test diagnostics-corpus src/tests/resources/errormessage_testdata.js --progress-every 50

compilation_tests_cpp_direct: build
	$(PUZZLESCRIPT_CPP) test diagnostics-corpus src/tests/resources/errormessage_testdata.js --progress-every 50

js_parity_tests: simulation_tests_cpp_js_parity compilation_tests_cpp_32

rule_plan_parity_tests: build
	$(NODE) src/tests/run_rule_plan_parity.js src/tests/resources/testdata.js --cli $(PUZZLESCRIPT_CPP) --artifacts-dir $(BUILD_DIR)/native/rule_plan_parity_testdata

simulation_tests: simulation_tests_js simulation_tests_cpp

compilation_tests: compilation_tests_js compilation_tests_cpp

profile_simulation_tests: build
	src/tests/profile_native_trace_suite.sh

profile_simulation_tests_32: build_32
	PUZZLESCRIPT_CPP="$(abspath $(PUZZLESCRIPT_CPP_32))" \
	PROFILE_STATS_OUT="$(abspath $(BUILD_DIR_32))/profile_stats.txt" \
	src/tests/profile_native_trace_suite.sh

tests: ctest js_parity_tests

all_tests_thorough:
	$(MAKE) tests
	$(MAKE) solver_instrumentation_analysis_tests
	$(MAKE) solver_portfolio_regression_tests
	$(MAKE) native_static_analysis_parity_tests
	$(MAKE) native_static_analysis_native_parity_tests
	$(MAKE) solver_js_coverage_cpp SOLVER_JS_COVERAGE_TIMEOUT_MS=1000 SOLVER_JS_COVERAGE_JOBS=1 SOLVER_JS_COVERAGE_STRATEGY=portfolio

basic_test_suite_cpp: js_parity_tests

basic_test_suite_js: tests_js

ifneq ($(filter run,$(MAKECMDGOALS)),)
RUN_SOURCE_FILE := $(word 2,$(MAKECMDGOALS))
ifneq ($(strip $(RUN_SOURCE_FILE)),)
$(eval .PHONY: $(RUN_SOURCE_FILE))
$(eval $(RUN_SOURCE_FILE):;@:)
endif
endif

run: build
ifndef RUN_SOURCE_FILE
	@echo "Usage: make run path/to/game.txt"
	@exit 1
endif
	$(PUZZLESCRIPT_CPP) play $(RUN_SOURCE_FILE)

clean: clean-native clean-js-parity-data

clean-native:
	rm -rf "$(BUILD_DIR)"
	rm -rf "$(BUILD_DIR_32)"

clean-native-32:
	rm -rf "$(BUILD_DIR_32)"

clean-js-parity-data:
	rm -rf "$(JS_PARITY_DATA_DIR)"
