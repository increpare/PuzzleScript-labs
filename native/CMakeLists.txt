cmake_minimum_required(VERSION 3.20)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# --- Performance defaults ----------------------------------------------------
# Default to Release when the user hasn't set anything. Honor explicit Debug.
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE "Release" CACHE STRING
      "Build type (Release, Debug, RelWithDebInfo, MinSizeRel)" FORCE)
  message(STATUS "Defaulting CMAKE_BUILD_TYPE to Release (native perf build).")
endif()

# Release-build flags: -O3, optional LTO, native codegen, NDEBUG. Tuned for the
# performance target in docs/superpowers/specs/2026-04-22-native-perf-crush-design.md.
# Note: -fno-exceptions / -fno-rtti omitted because core.cpp and cli_main.cpp
# use throw / try / catch (e.g. json::ParseError) pervasively for parse-error
# reporting; enabling those flags would require a large rewrite outside the
# scope of this perf phase.
option(PS_ENABLE_LTO "Enable Release-build link-time optimization" ON)
option(PS_ENABLE_LINK_DEDUP "Enable Darwin ld64 duplicate-code folding in Release builds" ON)
option(PS_ENABLE_EXPORTED_SYMBOLS "Enable exported symbols from Release main executables on Darwin" ON)
option(PS_ENABLE_MARCH_NATIVE "Enable -march=native in Release builds" ON)
if(APPLE AND CMAKE_OSX_ARCHITECTURES MATCHES ";")
  set(PS_ENABLE_MARCH_NATIVE OFF)
endif()
add_compile_options(
    $<$<AND:$<CONFIG:Release>,$<COMPILE_LANG_AND_ID:C,GNU,Clang,AppleClang>>:-O3>
    $<$<AND:$<CONFIG:Release>,$<COMPILE_LANG_AND_ID:CXX,GNU,Clang,AppleClang>>:-O3>
    $<$<CONFIG:Release>:-DNDEBUG>
    $<$<AND:$<CONFIG:Release>,$<BOOL:${PS_ENABLE_MARCH_NATIVE}>,$<COMPILE_LANG_AND_ID:C,GNU,Clang,AppleClang>>:-march=native>
    $<$<AND:$<CONFIG:Release>,$<BOOL:${PS_ENABLE_MARCH_NATIVE}>,$<COMPILE_LANG_AND_ID:CXX,GNU,Clang,AppleClang>>:-march=native>
)
if(PS_ENABLE_LTO)
  add_compile_options(
    $<$<AND:$<CONFIG:Release>,$<COMPILE_LANG_AND_ID:C,GNU,Clang,AppleClang>>:-flto>
    $<$<AND:$<CONFIG:Release>,$<COMPILE_LANG_AND_ID:CXX,GNU,Clang,AppleClang>>:-flto>
  )
  add_link_options($<$<AND:$<CONFIG:Release>,$<CXX_COMPILER_ID:GNU,Clang,AppleClang>>:-flto>)
endif()
if(NOT PS_ENABLE_LINK_DEDUP AND APPLE)
  add_link_options($<$<CONFIG:Release>:-Wl,-no_deduplicate>)
endif()
if(NOT PS_ENABLE_EXPORTED_SYMBOLS AND APPLE)
  add_link_options($<$<CONFIG:Release>:-Wl,-no_exported_symbols>)
endif()

# libc++ safe-mode instrumentation (seen as __annotate_contiguous_container in
# baseline profiles) is a large tax; turn it off on Release only.
add_compile_definitions(
    $<$<CONFIG:Release>:_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_NONE>
)

find_package(Threads REQUIRED)
find_package(PkgConfig QUIET)
find_program(NODE_EXECUTABLE node REQUIRED)
option(PS_ENABLE_SLOW_SOLVER_COVERAGE_TESTS "Enable slow full solver JS-coverage CTest checks" OFF)

# Repo root (parent of this `native/` tree). `CMAKE_SOURCE_DIR` is the checkout
# only when this file is not the top-level project; when users configure from
# `native/` directly, `CMAKE_SOURCE_DIR` points at `native/` and repo paths must
# not be derived from it.
get_filename_component(PUZZLESCRIPT_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)

if(PKG_CONFIG_FOUND)
  pkg_check_modules(SDL2 IMPORTED_TARGET sdl2)
endif()

set(PUZZLESCRIPT_NATIVE_PUBLIC_HEADERS
  include/puzzlescript/puzzlescript.h
  include/puzzlescript/gba.h
  include/puzzlescript/gbc.h
)

set(PUZZLESCRIPT_COMPILER_PUBLIC_HEADERS
  include/puzzlescript/compiler.h
)

set(PUZZLESCRIPT_COMPILER_SOURCES
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
  third_party/utf8proc/utf8proc.c
)

set(PUZZLESCRIPT_NATIVE_SOURCES
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
)

add_library(puzzlescript_native STATIC
  ${PUZZLESCRIPT_NATIVE_PUBLIC_HEADERS}
  ${PUZZLESCRIPT_NATIVE_SOURCES}
)

option(PS_ENABLE_DEV_SERIALIZERS "Enable dev-only compiler serializers and commands" ON)
set(PS_MASK_WORD_BITS "64" CACHE STRING "PuzzleScript runtime mask word width: 64 by default, or 32 for JS-oracle compatibility")
set_property(CACHE PS_MASK_WORD_BITS PROPERTY STRINGS 32 64)
if(NOT PS_MASK_WORD_BITS STREQUAL "32" AND NOT PS_MASK_WORD_BITS STREQUAL "64")
  message(FATAL_ERROR "PS_MASK_WORD_BITS must be 32 or 64")
endif()
option(PS_INTERPRETER_OBJECT_CELL_INDEX "Maintain per-object cell index for anchored interpreter rule scans" ON)

add_library(puzzlescript_compiler STATIC
  ${PUZZLESCRIPT_COMPILER_PUBLIC_HEADERS}
  ${PUZZLESCRIPT_COMPILER_SOURCES}
)

# Freestanding-friendly GBA state/runtime. This target intentionally does not
# link the desktop runtime, compiler, JSON loader, solver, SDL, or Threads.
add_library(puzzlescript_gba_core STATIC
  include/puzzlescript/gba.h
  src/gba/core.cpp
)
target_include_directories(puzzlescript_gba_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)
target_compile_definitions(puzzlescript_gba_core PRIVATE PS_MASK_WORD_BITS=32)
target_compile_options(puzzlescript_gba_core PRIVATE
  $<$<COMPILE_LANG_AND_ID:CXX,GNU,Clang,AppleClang>:-ffreestanding>
  $<$<COMPILE_LANG_AND_ID:CXX,GNU,Clang,AppleClang>:-fno-exceptions>
  $<$<COMPILE_LANG_AND_ID:CXX,GNU,Clang,AppleClang>:-fno-rtti>
  $<$<COMPILE_LANG_AND_ID:CXX,MSVC>:/GR->
)

# Fixed-memory CGB runtime shared by host tests and the GBDK cartridge build.
add_library(puzzlescript_gbc_core STATIC
  include/puzzlescript/gbc.h
  src/gbc/core.c
  src/gbc/compact_facade.c
  src/gbc/facade_rules.c
)
target_include_directories(puzzlescript_gbc_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
set_target_properties(puzzlescript_gbc_core PROPERTIES
  C_STANDARD 11
  C_STANDARD_REQUIRED ON
)
target_compile_options(puzzlescript_gbc_core PRIVATE
  $<$<COMPILE_LANG_AND_ID:C,GNU,Clang,AppleClang>:-ffreestanding>
)

# Host-side exporter: native compilation and rule codegen happen here; only the
# generated POD data and compact runtime are intended for the cartridge.
add_library(puzzlescript_gba_exporter STATIC
  src/gba/exporter.cpp
  src/gba/exporter.hpp
  src/player/sfxr.cpp
  src/player/sfxr.hpp
)
  target_include_directories(puzzlescript_gba_exporter
    PUBLIC
      ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE
      ${CMAKE_CURRENT_SOURCE_DIR}/src
      ${CMAKE_CURRENT_SOURCE_DIR}/third_party
  )
target_link_libraries(puzzlescript_gba_exporter
  PUBLIC
    puzzlescript_compiler
    puzzlescript_native
)

add_library(puzzlescript_gbc_exporter STATIC
  src/gbc/exporter.cpp
  src/gbc/exporter.hpp
)
target_include_directories(puzzlescript_gbc_exporter
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(puzzlescript_gbc_exporter
  PUBLIC
    puzzlescript_compiler
    puzzlescript_native
)

target_include_directories(puzzlescript_compiler
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/utf8proc
)

target_compile_definitions(puzzlescript_compiler
  PRIVATE
    UTF8PROC_STATIC
    PS_MASK_WORD_BITS=${PS_MASK_WORD_BITS}
    $<$<BOOL:${PS_ENABLE_DEV_SERIALIZERS}>:PS_ENABLE_DEV_SERIALIZERS=1>
)

target_link_libraries(puzzlescript_compiler
  PUBLIC
    puzzlescript_native
)

set_source_files_properties(
  third_party/utf8proc/utf8proc.c
  PROPERTIES COMPILE_OPTIONS "$<$<COMPILE_LANG_AND_ID:C,GNU,Clang,AppleClang>:-Wno-everything>")

target_include_directories(puzzlescript_native
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/simdjson
)

# simdjson's amalgamation uses patterns (SIMD dispatch, internal attributes)
# that produce many warnings under our project-wide flags. Silence warnings
# on that one translation unit; we don't maintain simdjson.
set_source_files_properties(
  third_party/simdjson/simdjson.cpp
  PROPERTIES COMPILE_OPTIONS "$<$<COMPILE_LANG_AND_ID:CXX,GNU,Clang,AppleClang>:-Wno-everything>")

target_link_libraries(puzzlescript_native
  PUBLIC
    Threads::Threads
)

target_compile_definitions(puzzlescript_native
  PUBLIC
    PS_MASK_WORD_BITS=${PS_MASK_WORD_BITS}
    PS_INTERPRETER_OBJECT_CELL_INDEX=$<BOOL:${PS_INTERPRETER_OBJECT_CELL_INDEX}>
)

add_executable(puzzlescript_cpp
  src/cli/main.cpp
  src/cli/diagnostics_parity.cpp
)

add_executable(puzzlescript_solver
  src/solver/main.cpp
)

add_executable(puzzlescript_generator
  src/generator/main.cpp
  src/generator/block_scheduler.cpp
  src/generator/duration_parse.cpp
  src/generator/generation_rules.cpp
  src/generator/level_rows.cpp
  src/generator/output_writer.cpp
  src/generator/spec_parser.cpp
  src/generator/templatize.cpp
)

add_executable(puzzlescript_simplify
  src/simplify/main.cpp
  src/generator/level_rows.cpp
  src/generator/output_writer.cpp
)

set(PS_COMPILED_RULES_SOURCE "" CACHE FILEPATH "Optional generated compiled-rules C++ source to link into solver/generator")
set(PS_COMPILED_RULES_SOURCES_FILE "" CACHE FILEPATH "Optional newline-delimited list of generated compiled-rules C++ sources")
set(PS_COMPILED_RULES_OPT_LEVEL "" CACHE STRING "Optional Release optimization level for generated compiled-rules source: 0, 1, 2, 3, s, or z")
if(PS_COMPILED_RULES_SOURCE AND PS_COMPILED_RULES_SOURCES_FILE)
  message(FATAL_ERROR "Set only one of PS_COMPILED_RULES_SOURCE or PS_COMPILED_RULES_SOURCES_FILE")
endif()

set(PS_COMPILED_RULES_SOURCES)
if(PS_COMPILED_RULES_SOURCE)
  list(APPEND PS_COMPILED_RULES_SOURCES "${PS_COMPILED_RULES_SOURCE}")
endif()
if(PS_COMPILED_RULES_SOURCES_FILE)
  get_filename_component(PS_COMPILED_RULES_SOURCES_FILE_ABS "${PS_COMPILED_RULES_SOURCES_FILE}" ABSOLUTE)
  if(NOT EXISTS "${PS_COMPILED_RULES_SOURCES_FILE_ABS}")
    message(FATAL_ERROR "PS_COMPILED_RULES_SOURCES_FILE does not exist: ${PS_COMPILED_RULES_SOURCES_FILE_ABS}")
  endif()
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${PS_COMPILED_RULES_SOURCES_FILE_ABS}")
  file(STRINGS "${PS_COMPILED_RULES_SOURCES_FILE_ABS}" PS_COMPILED_RULES_LISTED_SOURCES)
  list(APPEND PS_COMPILED_RULES_SOURCES ${PS_COMPILED_RULES_LISTED_SOURCES})
endif()

if(PS_COMPILED_RULES_SOURCES)
  set(PS_COMPILED_RULES_SOURCE_ABS_LIST)
  foreach(PS_COMPILED_RULES_SOURCE_ENTRY IN LISTS PS_COMPILED_RULES_SOURCES)
    get_filename_component(PS_COMPILED_RULES_SOURCE_ABS "${PS_COMPILED_RULES_SOURCE_ENTRY}" ABSOLUTE)
    if(NOT EXISTS "${PS_COMPILED_RULES_SOURCE_ABS}")
      message(FATAL_ERROR "Compiled-rules source does not exist: ${PS_COMPILED_RULES_SOURCE_ABS}")
    endif()
    list(APPEND PS_COMPILED_RULES_SOURCE_ABS_LIST "${PS_COMPILED_RULES_SOURCE_ABS}")
  endforeach()
  list(LENGTH PS_COMPILED_RULES_SOURCE_ABS_LIST PS_COMPILED_RULES_SOURCE_COUNT)
  if(PS_COMPILED_RULES_SOURCE_COUNT EQUAL 1)
    list(GET PS_COMPILED_RULES_SOURCE_ABS_LIST 0 PS_COMPILED_RULES_ONLY_SOURCE)
    message(STATUS "Linking compiled-rules source: ${PS_COMPILED_RULES_ONLY_SOURCE}")
  else()
    message(STATUS "Linking compiled-rules sources: ${PS_COMPILED_RULES_SOURCE_COUNT}")
  endif()
  if(NOT PS_COMPILED_RULES_OPT_LEVEL STREQUAL "")
    if(NOT PS_COMPILED_RULES_OPT_LEVEL MATCHES "^(0|1|2|3|s|z)$")
      message(FATAL_ERROR "PS_COMPILED_RULES_OPT_LEVEL must be one of: 0, 1, 2, 3, s, z")
    endif()
    message(STATUS "Compiled-rules source Release opt level: -O${PS_COMPILED_RULES_OPT_LEVEL}")
    foreach(PS_COMPILED_RULES_SOURCE_ABS IN LISTS PS_COMPILED_RULES_SOURCE_ABS_LIST)
      set_source_files_properties(
        "${PS_COMPILED_RULES_SOURCE_ABS}"
        PROPERTIES COMPILE_OPTIONS "$<$<CONFIG:Release>:-O${PS_COMPILED_RULES_OPT_LEVEL}>")
    endforeach()
  endif()
  target_sources(puzzlescript_cpp PRIVATE ${PS_COMPILED_RULES_SOURCE_ABS_LIST})
  target_sources(puzzlescript_solver PRIVATE ${PS_COMPILED_RULES_SOURCE_ABS_LIST})
  target_sources(puzzlescript_generator PRIVATE ${PS_COMPILED_RULES_SOURCE_ABS_LIST})
  target_sources(puzzlescript_simplify PRIVATE ${PS_COMPILED_RULES_SOURCE_ABS_LIST})
endif()

target_link_libraries(puzzlescript_simplify
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(puzzlescript_simplify
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_library(puzzlescript_handheld STATIC
  src/handheld/display_layout.cpp
  src/handheld/report.cpp
)

target_include_directories(puzzlescript_handheld
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(puzzlescript_handheld
  PUBLIC
    puzzlescript_native
    puzzlescript_compiler
)

add_executable(puzzlescript_handheld_report
  src/handheld/main.cpp
)

target_link_libraries(puzzlescript_handheld_report
  PRIVATE
    puzzlescript_handheld
)

target_include_directories(puzzlescript_handheld_report
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(puzzlescript_solver
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_link_libraries(puzzlescript_generator
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(puzzlescript_solver
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_include_directories(puzzlescript_generator
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(puzzlescript_cpp
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
    puzzlescript_gba_exporter
    puzzlescript_gbc_exporter
)

target_include_directories(puzzlescript_cpp
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

if(WIN32)
  set(PUZZLESCRIPT_CLI_NODE_EXECUTABLE "node")
else()
  set(PUZZLESCRIPT_CLI_NODE_EXECUTABLE "${NODE_EXECUTABLE}")
endif()

target_compile_definitions(puzzlescript_cpp
  PRIVATE
    PS_NODE_EXECUTABLE="${PUZZLESCRIPT_CLI_NODE_EXECUTABLE}"
    PS_EXPORT_IR_SCRIPT="${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/export_ir_json.js"
    PS_EXPORT_TRACE_SCRIPT="${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/export_execution_trace.js"
    PS_FONT_JS_PATH="${PUZZLESCRIPT_REPO_ROOT}/src/js/font.js"
)

if(TARGET PkgConfig::SDL2)
  target_sources(puzzlescript_cpp PRIVATE src/player/sdl_player.cpp src/player/sfxr.cpp)
  target_link_libraries(puzzlescript_cpp PRIVATE PkgConfig::SDL2)
  target_compile_definitions(puzzlescript_cpp PRIVATE PS_HAVE_SDL2=1)
endif()

enable_testing()

set(SMOKE_IR ${CMAKE_CURRENT_BINARY_DIR}/generated/sokoban_basic_ir.json)
set(SMOKE_TRACE ${CMAKE_CURRENT_BINARY_DIR}/generated/sokoban_basic_trace.json)
set(SMOKE_TRACE_INPUTS ${CMAKE_CURRENT_SOURCE_DIR}/tests/smoke_trace_inputs.json)
add_custom_command(
  OUTPUT ${SMOKE_IR}
  COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_BINARY_DIR}/generated
  COMMAND node ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/export_ir_json.js
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
          ${SMOKE_IR}
          --level 0
          --seed native-smoke
          --settle-again
  DEPENDS
    ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
    ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/export_ir_json.js
    ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/lib/puzzlescript_ir.js
    ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/lib/puzzlescript_node_env.js
)

add_custom_command(
  OUTPUT ${SMOKE_TRACE}
  COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_BINARY_DIR}/generated
  COMMAND node ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/export_execution_trace.js
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
          ${SMOKE_TRACE}
          --level 0
          --seed native-trace-smoke
          --inputs-file ${SMOKE_TRACE_INPUTS}
  DEPENDS
    ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
    ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/export_execution_trace.js
    ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/lib/puzzlescript_trace.js
    ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/lib/puzzlescript_node_env.js
    ${SMOKE_TRACE_INPUTS}
)

add_custom_target(generate_native_smoke_ir DEPENDS ${SMOKE_IR} ${SMOKE_TRACE})
add_dependencies(puzzlescript_cpp generate_native_smoke_ir)

add_test(
  NAME puzzlescript_cpp_run_ir_smoke
  COMMAND puzzlescript_cpp run-ir ${SMOKE_IR}
)

add_test(
  NAME puzzlescript_cpp_bench_ir_smoke
  COMMAND puzzlescript_cpp bench-ir ${SMOKE_IR} --iterations 64 --threads 2
)

add_test(
  NAME puzzlescript_cpp_run_smoke
  COMMAND puzzlescript_cpp run ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt --level 0 --seed native-source-smoke --settle-again
)

add_executable(puzzlescript_cpp_player_api_tests
  tests/player_api_tests.cpp
)

target_link_libraries(puzzlescript_cpp_player_api_tests
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(puzzlescript_cpp_player_api_tests
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

if(PS_COMPILED_RULES_SOURCE_ABS_LIST)
  target_sources(puzzlescript_cpp_player_api_tests PRIVATE ${PS_COMPILED_RULES_SOURCE_ABS_LIST})
endif()

add_dependencies(puzzlescript_cpp puzzlescript_cpp_player_api_tests)

add_test(
  NAME puzzlescript_cpp_player_api_tests
  COMMAND puzzlescript_cpp_player_api_tests
)

add_executable(puzzlescript_gba_core_tests
  tests/gba_core.cpp
)
target_link_libraries(puzzlescript_gba_core_tests PRIVATE puzzlescript_gba_core)
add_test(NAME puzzlescript_gba_core_tests COMMAND puzzlescript_gba_core_tests)

add_executable(puzzlescript_gbc_core_tests
  tests/gbc_core.c
)
target_link_libraries(puzzlescript_gbc_core_tests PRIVATE puzzlescript_gbc_core)
add_test(NAME puzzlescript_gbc_core_tests COMMAND puzzlescript_gbc_core_tests)

add_executable(puzzlescript_gbc_frontend_flow_tests
  tests/gbc_frontend_flow.c
  ${PUZZLESCRIPT_REPO_ROOT}/firmware/gbc/source/frontend_flow.c
)
target_include_directories(puzzlescript_gbc_frontend_flow_tests PRIVATE
  ${PUZZLESCRIPT_REPO_ROOT}/firmware/gbc/source
)
add_test(
  NAME puzzlescript_gbc_frontend_flow_tests
  COMMAND puzzlescript_gbc_frontend_flow_tests
)

add_executable(puzzlescript_gba_exporter_tests
  tests/gba_exporter.cpp
)
target_include_directories(puzzlescript_gba_exporter_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(puzzlescript_gba_exporter_tests PRIVATE PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}")
target_link_libraries(puzzlescript_gba_exporter_tests PRIVATE puzzlescript_gba_exporter)
add_test(
  NAME puzzlescript_gba_exporter_tests
  COMMAND puzzlescript_gba_exporter_tests
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(puzzlescript_gbc_exporter_tests
  tests/gbc_exporter.cpp
)
target_include_directories(puzzlescript_gbc_exporter_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(puzzlescript_gbc_exporter_tests PRIVATE PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}")
target_link_libraries(puzzlescript_gbc_exporter_tests PRIVATE puzzlescript_gbc_exporter)
add_test(
  NAME puzzlescript_gbc_exporter_tests
  COMMAND puzzlescript_gbc_exporter_tests
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

set(GBA_GENERATED_SMOKE_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gba_sokoban)
set(GBA_GENERATED_SMOKE_SOURCE ${GBA_GENERATED_SMOKE_DIR}/generated_game.cpp)
set(GBA_GENERATED_SMOKE_HEADER ${GBA_GENERATED_SMOKE_DIR}/generated_game.hpp)
set(GBA_GENERATED_SMOKE_RULES ${GBA_GENERATED_SMOKE_DIR}/generated_rules.cpp)
set(GBA_GENERATED_SMOKE_MANIFEST ${GBA_GENERATED_SMOKE_DIR}/gba_manifest.json)
add_custom_command(
  OUTPUT
    ${GBA_GENERATED_SMOKE_SOURCE}
    ${GBA_GENERATED_SMOKE_HEADER}
    ${GBA_GENERATED_SMOKE_RULES}
    ${GBA_GENERATED_SMOKE_MANIFEST}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gba
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
          --out ${GBA_GENERATED_SMOKE_DIR}
          --no-mmutil
  DEPENDS
    puzzlescript_cpp
    ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  VERBATIM
)
set_source_files_properties(
  ${GBA_GENERATED_SMOKE_SOURCE}
  ${GBA_GENERATED_SMOKE_RULES}
  PROPERTIES GENERATED TRUE
)

add_executable(puzzlescript_gba_generated_smoke
  tests/gba_generated_smoke.cpp
  ${GBA_GENERATED_SMOKE_SOURCE}
  ${GBA_GENERATED_SMOKE_RULES}
  src/gba/rule_runtime_stubs.cpp
)
target_include_directories(puzzlescript_gba_generated_smoke PRIVATE
  ${GBA_GENERATED_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(puzzlescript_gba_generated_smoke PRIVATE puzzlescript_gba_core)
target_compile_definitions(puzzlescript_gba_generated_smoke PRIVATE
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)
add_test(NAME puzzlescript_gba_generated_smoke COMMAND puzzlescript_gba_generated_smoke)

set(GBC_GENERATED_SMOKE_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gbc_sokoban)
set(GBC_GENERATED_SMOKE_SOURCE ${GBC_GENERATED_SMOKE_DIR}/generated_game.c)
set(GBC_GENERATED_SMOKE_HEADER ${GBC_GENERATED_SMOKE_DIR}/generated_game.h)
set(GBC_GENERATED_SMOKE_MANIFEST ${GBC_GENERATED_SMOKE_DIR}/gbc_manifest.json)
set(GBC_GENERATED_SMOKE_SPECIALIZED_TURN ${GBC_GENERATED_SMOKE_DIR}/generated_specialized_turn.c)
set(GBC_GENERATED_SMOKE_SPECIALIZED_SOURCES
  ${GBC_GENERATED_SMOKE_SPECIALIZED_TURN}
)
add_custom_command(
  OUTPUT
    ${GBC_GENERATED_SMOKE_SOURCE}
    ${GBC_GENERATED_SMOKE_HEADER}
    ${GBC_GENERATED_SMOKE_MANIFEST}
    ${GBC_GENERATED_SMOKE_SPECIALIZED_TURN}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gbc
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
          --out ${GBC_GENERATED_SMOKE_DIR}
  DEPENDS
    puzzlescript_cpp
    ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  VERBATIM
)
add_executable(puzzlescript_gbc_generated_smoke
  tests/gbc_generated_smoke.c
  src/gbc/core.c
  ${GBC_GENERATED_SMOKE_SOURCE}
)
target_include_directories(puzzlescript_gbc_generated_smoke PRIVATE
  ${GBC_GENERATED_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_generated_smoke PRIVATE
  PS_GBC_GENERATED_BUILD=1
)
add_test(NAME puzzlescript_gbc_generated_smoke COMMAND puzzlescript_gbc_generated_smoke)

add_executable(puzzlescript_gbc_compact_facade_tests
  tests/gbc_compact_facade_tests.c
  src/gbc/core.c
  src/gbc/compact_facade.c
  ${GBC_GENERATED_SMOKE_SOURCE}
)
target_include_directories(puzzlescript_gbc_compact_facade_tests PRIVATE
  ${GBC_GENERATED_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_compact_facade_tests PRIVATE
  PS_GBC_GENERATED_BUILD=1
)
add_test(
  NAME puzzlescript_gbc_compact_facade_tests
  COMMAND puzzlescript_gbc_compact_facade_tests
)

add_executable(puzzlescript_gbc_parity_smoke
  tests/gbc_parity_smoke.cpp
  src/gbc/core.c
  ${GBC_GENERATED_SMOKE_SOURCE}
)
target_include_directories(puzzlescript_gbc_parity_smoke PRIVATE
  ${GBC_GENERATED_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_parity_smoke PRIVATE
  PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}"
  PS_GBC_GENERATED_BUILD=1
)
target_link_libraries(puzzlescript_gbc_parity_smoke PRIVATE
  puzzlescript_native
  puzzlescript_compiler
)
add_test(NAME puzzlescript_gbc_parity_smoke COMMAND puzzlescript_gbc_parity_smoke)

add_executable(puzzlescript_gbc_specialized_oracle_smoke
  tests/gbc_specialized_oracle_smoke.cpp
  src/gbc/core.c
  src/gbc/compact_facade.c
  src/gbc/facade_rules.c
  ${GBC_GENERATED_SMOKE_SOURCE}
  ${GBC_GENERATED_SMOKE_SPECIALIZED_SOURCES}
)
target_include_directories(puzzlescript_gbc_specialized_oracle_smoke PRIVATE
  ${GBC_GENERATED_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_specialized_oracle_smoke PRIVATE
  PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}"
  PS_GBC_GENERATED_BUILD=1
  PS_GBC_HAS_SPECIALIZED_TURN=1
)
target_link_libraries(puzzlescript_gbc_specialized_oracle_smoke PRIVATE
  puzzlescript_native
  puzzlescript_compiler
)
add_test(
  NAME puzzlescript_gbc_specialized_oracle_smoke
  COMMAND puzzlescript_gbc_specialized_oracle_smoke
)

set(GBC_ANY_MASK_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gbc_any_object_mask)
set(GBC_ANY_MASK_SOURCE ${GBC_ANY_MASK_DIR}/generated_game.c)
set(GBC_ANY_MASK_HEADER ${GBC_ANY_MASK_DIR}/generated_game.h)
set(GBC_ANY_MASK_MANIFEST ${GBC_ANY_MASK_DIR}/gbc_manifest.json)
set(GBC_ANY_MASK_SPECIALIZED_TURN ${GBC_ANY_MASK_DIR}/generated_specialized_turn.c)
add_custom_command(
  OUTPUT
    ${GBC_ANY_MASK_SOURCE}
    ${GBC_ANY_MASK_HEADER}
    ${GBC_ANY_MASK_MANIFEST}
    ${GBC_ANY_MASK_SPECIALIZED_TURN}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gbc
          ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_any_object_mask.txt
          --out ${GBC_ANY_MASK_DIR}
  DEPENDS
    puzzlescript_cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_any_object_mask.txt
  VERBATIM
)
add_executable(puzzlescript_gbc_any_mask_oracle_smoke
  tests/gbc_any_mask_oracle_smoke.cpp
  src/gbc/core.c
  src/gbc/compact_facade.c
  src/gbc/facade_rules.c
  ${GBC_ANY_MASK_SOURCE}
  ${GBC_ANY_MASK_SPECIALIZED_TURN}
)
target_include_directories(puzzlescript_gbc_any_mask_oracle_smoke PRIVATE
  ${GBC_ANY_MASK_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_any_mask_oracle_smoke PRIVATE
  PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}"
  PS_GBC_GENERATED_BUILD=1
  PS_GBC_HAS_SPECIALIZED_TURN=1
)
target_link_libraries(puzzlescript_gbc_any_mask_oracle_smoke PRIVATE
  puzzlescript_native
  puzzlescript_compiler
)
add_test(
  NAME puzzlescript_gbc_any_mask_oracle_smoke
  COMMAND puzzlescript_gbc_any_mask_oracle_smoke
)

set(GBC_LAYER_COUPLED_APPLY_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gbc_layer_coupled_apply)
set(GBC_LAYER_COUPLED_APPLY_SOURCE ${GBC_LAYER_COUPLED_APPLY_DIR}/generated_game.c)
set(GBC_LAYER_COUPLED_APPLY_HEADER ${GBC_LAYER_COUPLED_APPLY_DIR}/generated_game.h)
set(GBC_LAYER_COUPLED_APPLY_MANIFEST ${GBC_LAYER_COUPLED_APPLY_DIR}/gbc_manifest.json)
set(GBC_LAYER_COUPLED_APPLY_SPECIALIZED_TURN ${GBC_LAYER_COUPLED_APPLY_DIR}/generated_specialized_turn.c)
add_custom_command(
  OUTPUT
    ${GBC_LAYER_COUPLED_APPLY_SOURCE}
    ${GBC_LAYER_COUPLED_APPLY_HEADER}
    ${GBC_LAYER_COUPLED_APPLY_MANIFEST}
    ${GBC_LAYER_COUPLED_APPLY_SPECIALIZED_TURN}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gbc
          ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_layer_coupled_apply.txt
          --out ${GBC_LAYER_COUPLED_APPLY_DIR}
  DEPENDS
    puzzlescript_cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_layer_coupled_apply.txt
  VERBATIM
)
add_executable(puzzlescript_gbc_layer_coupled_apply_oracle_smoke
  tests/gbc_layer_coupled_apply_oracle_smoke.cpp
  src/gbc/core.c
  src/gbc/compact_facade.c
  src/gbc/facade_rules.c
  ${GBC_LAYER_COUPLED_APPLY_SOURCE}
  ${GBC_LAYER_COUPLED_APPLY_SPECIALIZED_TURN}
)
target_include_directories(puzzlescript_gbc_layer_coupled_apply_oracle_smoke PRIVATE
  ${GBC_LAYER_COUPLED_APPLY_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_layer_coupled_apply_oracle_smoke PRIVATE
  PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}"
  PS_GBC_GENERATED_BUILD=1
  PS_GBC_HAS_SPECIALIZED_TURN=1
)
target_link_libraries(puzzlescript_gbc_layer_coupled_apply_oracle_smoke PRIVATE
  puzzlescript_native
  puzzlescript_compiler
)
add_test(
  NAME puzzlescript_gbc_layer_coupled_apply_oracle_smoke
  COMMAND puzzlescript_gbc_layer_coupled_apply_oracle_smoke
)

add_executable(puzzlescript_gbc_solution_replay_bench
  tests/gbc_solution_replay_bench.cpp
  src/gbc/core.c
  src/gbc/compact_facade.c
  src/gbc/facade_rules.c
  ${GBC_GENERATED_SMOKE_SOURCE}
  ${GBC_GENERATED_SMOKE_SPECIALIZED_SOURCES}
)
target_include_directories(puzzlescript_gbc_solution_replay_bench PRIVATE
  ${GBC_GENERATED_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_solution_replay_bench PRIVATE
  PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}"
  PS_GBC_GENERATED_BUILD=1
  PS_GBC_HAS_SPECIALIZED_TURN=1
)
target_link_libraries(puzzlescript_gbc_solution_replay_bench PRIVATE
  puzzlescript_native
  puzzlescript_compiler
)
add_test(
  NAME puzzlescript_gbc_solution_replay_bench
  COMMAND puzzlescript_gbc_solution_replay_bench
)

set(GBC_LEVEL_START_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gbc_level_start)
set(GBC_LEVEL_START_SOURCE ${GBC_LEVEL_START_DIR}/generated_game.c)
set(GBC_LEVEL_START_HEADER ${GBC_LEVEL_START_DIR}/generated_game.h)
set(GBC_LEVEL_START_MANIFEST ${GBC_LEVEL_START_DIR}/gbc_manifest.json)
add_custom_command(
  OUTPUT
    ${GBC_LEVEL_START_SOURCE}
    ${GBC_LEVEL_START_HEADER}
    ${GBC_LEVEL_START_MANIFEST}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gbc
          ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_level_start_rules.txt
          --out ${GBC_LEVEL_START_DIR}
  DEPENDS
    puzzlescript_cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_level_start_rules.txt
  VERBATIM
)
add_executable(puzzlescript_gbc_level_start_parity
  tests/gbc_level_start_parity.cpp
  src/gbc/core.c
  ${GBC_LEVEL_START_SOURCE}
)
target_include_directories(puzzlescript_gbc_level_start_parity PRIVATE
  ${GBC_LEVEL_START_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_level_start_parity PRIVATE
  PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}"
  PS_GBC_GENERATED_BUILD=1
)
target_link_libraries(puzzlescript_gbc_level_start_parity PRIVATE
  puzzlescript_native
  puzzlescript_compiler
)
add_test(
  NAME puzzlescript_gbc_level_start_parity
  COMMAND puzzlescript_gbc_level_start_parity
)

set(GBC_STATIC_LAYERS_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gbc_static_layers)
set(GBC_STATIC_LAYERS_SOURCE ${GBC_STATIC_LAYERS_DIR}/generated_game.c)
set(GBC_STATIC_LAYERS_HEADER ${GBC_STATIC_LAYERS_DIR}/generated_game.h)
set(GBC_STATIC_LAYERS_MANIFEST ${GBC_STATIC_LAYERS_DIR}/gbc_manifest.json)
add_custom_command(
  OUTPUT
    ${GBC_STATIC_LAYERS_SOURCE}
    ${GBC_STATIC_LAYERS_HEADER}
    ${GBC_STATIC_LAYERS_MANIFEST}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gbc
          ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_static_collision_layers.txt
          --out ${GBC_STATIC_LAYERS_DIR}
  DEPENDS
    puzzlescript_cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_static_collision_layers.txt
  VERBATIM
)
add_executable(puzzlescript_gbc_static_layers_parity
  tests/gbc_static_layers_parity.cpp
  src/gbc/core.c
  ${GBC_STATIC_LAYERS_SOURCE}
)
target_include_directories(puzzlescript_gbc_static_layers_parity PRIVATE
  ${GBC_STATIC_LAYERS_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_static_layers_parity PRIVATE
  PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}"
  PS_GBC_GENERATED_BUILD=1
)
target_link_libraries(puzzlescript_gbc_static_layers_parity PRIVATE
  puzzlescript_native
  puzzlescript_compiler
)
add_test(
  NAME puzzlescript_gbc_static_layers_parity
  COMMAND puzzlescript_gbc_static_layers_parity
)

set(GBC_ACTION_MOVEMENT_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gbc_action_movement)
set(GBC_ACTION_MOVEMENT_SOURCE ${GBC_ACTION_MOVEMENT_DIR}/generated_game.c)
set(GBC_ACTION_MOVEMENT_HEADER ${GBC_ACTION_MOVEMENT_DIR}/generated_game.h)
set(GBC_ACTION_MOVEMENT_MANIFEST ${GBC_ACTION_MOVEMENT_DIR}/gbc_manifest.json)
add_custom_command(
  OUTPUT
    ${GBC_ACTION_MOVEMENT_SOURCE}
    ${GBC_ACTION_MOVEMENT_HEADER}
    ${GBC_ACTION_MOVEMENT_MANIFEST}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gbc
          ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_action_movement_layer.txt
          --out ${GBC_ACTION_MOVEMENT_DIR}
  DEPENDS
    puzzlescript_cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/gbc_action_movement_layer.txt
  VERBATIM
)
add_executable(puzzlescript_gbc_action_movement_smoke
  tests/gbc_action_movement_smoke.c
  src/gbc/core.c
  ${GBC_ACTION_MOVEMENT_SOURCE}
)
target_include_directories(puzzlescript_gbc_action_movement_smoke PRIVATE
  ${GBC_ACTION_MOVEMENT_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src/gbc
)
target_compile_definitions(puzzlescript_gbc_action_movement_smoke PRIVATE
  PS_GBC_GENERATED_BUILD=1
)
add_test(
  NAME puzzlescript_gbc_action_movement_smoke
  COMMAND puzzlescript_gbc_action_movement_smoke
)

# Replay fixed native-solver solutions through both the ordinary native runtime
# and the generated GBA representation. Keep the entire executable on 32-bit
# mask words: mixing the generated 32-bit private runtime types with a 64-bit
# native runtime in one process violates their C++ ABI even though both expose
# width-neutral C APIs.
if(PS_MASK_WORD_BITS STREQUAL "32")
add_library(puzzlescript_gba_generated_solution_data OBJECT
  ${GBA_GENERATED_SMOKE_SOURCE}
  ${GBA_GENERATED_SMOKE_RULES}
)
target_include_directories(puzzlescript_gba_generated_solution_data PRIVATE
  ${GBA_GENERATED_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_compile_definitions(puzzlescript_gba_generated_solution_data PRIVATE
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)
add_executable(puzzlescript_gba_generated_solution_replay
  tests/gba_solution_replay.cpp
  $<TARGET_OBJECTS:puzzlescript_gba_generated_solution_data>
)
target_include_directories(puzzlescript_gba_generated_solution_replay PRIVATE
  ${GBA_GENERATED_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(puzzlescript_gba_generated_solution_replay PRIVATE
  puzzlescript_gba_core
  puzzlescript_compiler
  puzzlescript_native
)
add_test(
  NAME puzzlescript_gba_generated_solution_replay_level_0
  COMMAND puzzlescript_gba_generated_solution_replay
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
          0
          down,left,up,right,right,right,down,left,up,left,left,down,down,right,up,left,up,right,up,up,left,down,right,down,down,right,right,up,left,down,left,up,up
)
add_test(
  NAME puzzlescript_gba_generated_solution_replay_level_1
  COMMAND puzzlescript_gba_generated_solution_replay
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
          1
          right,down,down,left,right,up,up,left,down,up,up,left,left,down,down,right
)
set_tests_properties(
  puzzlescript_gba_generated_solution_replay_level_0
  puzzlescript_gba_generated_solution_replay_level_1
  PROPERTIES TIMEOUT 30
)

set(GBA_AUDIO_PARITY_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gba_audio_parity)
set(GBA_AUDIO_PARITY_SOURCE ${GBA_AUDIO_PARITY_DIR}/generated_game.cpp)
set(GBA_AUDIO_PARITY_HEADER ${GBA_AUDIO_PARITY_DIR}/generated_game.hpp)
set(GBA_AUDIO_PARITY_RULES ${GBA_AUDIO_PARITY_DIR}/generated_rules.cpp)
set(GBA_AUDIO_PARITY_MANIFEST ${GBA_AUDIO_PARITY_DIR}/gba_manifest.json)
add_custom_command(
  OUTPUT
    ${GBA_AUDIO_PARITY_SOURCE}
    ${GBA_AUDIO_PARITY_HEADER}
    ${GBA_AUDIO_PARITY_RULES}
    ${GBA_AUDIO_PARITY_MANIFEST}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gba
          ${CMAKE_CURRENT_SOURCE_DIR}/tests/gba_audio_parity.txt
          --out ${GBA_AUDIO_PARITY_DIR}
          --no-mmutil
  DEPENDS
    puzzlescript_cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/tests/gba_audio_parity.txt
  VERBATIM
)
set_source_files_properties(
  ${GBA_AUDIO_PARITY_SOURCE}
  ${GBA_AUDIO_PARITY_RULES}
  PROPERTIES GENERATED TRUE
)
add_library(puzzlescript_gba_audio_parity_data OBJECT
  ${GBA_AUDIO_PARITY_SOURCE}
  ${GBA_AUDIO_PARITY_RULES}
)
target_include_directories(puzzlescript_gba_audio_parity_data PRIVATE
  ${GBA_AUDIO_PARITY_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_compile_definitions(puzzlescript_gba_audio_parity_data PRIVATE
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)
add_executable(puzzlescript_gba_audio_parity_replay
  tests/gba_solution_replay.cpp
  $<TARGET_OBJECTS:puzzlescript_gba_audio_parity_data>
)
target_include_directories(puzzlescript_gba_audio_parity_replay PRIVATE
  ${GBA_AUDIO_PARITY_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(puzzlescript_gba_audio_parity_replay PRIVATE
  puzzlescript_gba_core
  puzzlescript_compiler
  puzzlescript_native
)
add_test(
  NAME puzzlescript_gba_audio_parity_replay
  COMMAND puzzlescript_gba_audio_parity_replay
          ${CMAKE_CURRENT_SOURCE_DIR}/tests/gba_audio_parity.txt
          0
          left,right,action,up,up,down
          --allow-incomplete
)
set_tests_properties(puzzlescript_gba_audio_parity_replay PROPERTIES TIMEOUT 30)
endif()

set(GBA_ACORN_SMOKE_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gba_acorn)
set(GBA_ACORN_SMOKE_SOURCE ${GBA_ACORN_SMOKE_DIR}/generated_game.cpp)
set(GBA_ACORN_SMOKE_HEADER ${GBA_ACORN_SMOKE_DIR}/generated_game.hpp)
set(GBA_ACORN_SMOKE_RULES ${GBA_ACORN_SMOKE_DIR}/generated_rules.cpp)
set(GBA_ACORN_SMOKE_MANIFEST ${GBA_ACORN_SMOKE_DIR}/gba_manifest.json)
add_custom_command(
  OUTPUT
    ${GBA_ACORN_SMOKE_SOURCE}
    ${GBA_ACORN_SMOKE_HEADER}
    ${GBA_ACORN_SMOKE_RULES}
    ${GBA_ACORN_SMOKE_MANIFEST}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gba
          "${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests/Acorn Scorchery Paradise.txt"
          --out ${GBA_ACORN_SMOKE_DIR}
          --no-mmutil
  DEPENDS
    puzzlescript_cpp
    "${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests/Acorn Scorchery Paradise.txt"
  VERBATIM
)
set_source_files_properties(
  ${GBA_ACORN_SMOKE_SOURCE}
  ${GBA_ACORN_SMOKE_RULES}
  PROPERTIES GENERATED TRUE
)
add_executable(puzzlescript_gba_acorn_smoke
  tests/gba_acorn_smoke.cpp
  ${GBA_ACORN_SMOKE_SOURCE}
  ${GBA_ACORN_SMOKE_RULES}
  src/gba/rule_runtime_stubs.cpp
)
target_include_directories(puzzlescript_gba_acorn_smoke PRIVATE
  ${GBA_ACORN_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(puzzlescript_gba_acorn_smoke PRIVATE puzzlescript_gba_core)
target_compile_definitions(puzzlescript_gba_acorn_smoke PRIVATE
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)
add_test(NAME puzzlescript_gba_acorn_smoke COMMAND puzzlescript_gba_acorn_smoke)

set(GBA_ATLAS_SMOKE_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gba_atlas)
set(GBA_ATLAS_SMOKE_SOURCE ${GBA_ATLAS_SMOKE_DIR}/generated_game.cpp)
set(GBA_ATLAS_SMOKE_HEADER ${GBA_ATLAS_SMOKE_DIR}/generated_game.hpp)
set(GBA_ATLAS_SMOKE_RULES ${GBA_ATLAS_SMOKE_DIR}/generated_rules.cpp)
set(GBA_ATLAS_SMOKE_MANIFEST ${GBA_ATLAS_SMOKE_DIR}/gba_manifest.json)
add_custom_command(
  OUTPUT
    ${GBA_ATLAS_SMOKE_SOURCE}
    ${GBA_ATLAS_SMOKE_HEADER}
    ${GBA_ATLAS_SMOKE_RULES}
    ${GBA_ATLAS_SMOKE_MANIFEST}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gba
          "${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests/atlas shrank.txt"
          --out ${GBA_ATLAS_SMOKE_DIR}
          --no-mmutil
  DEPENDS
    puzzlescript_cpp
    "${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests/atlas shrank.txt"
  VERBATIM
)
set_source_files_properties(
  ${GBA_ATLAS_SMOKE_SOURCE}
  ${GBA_ATLAS_SMOKE_RULES}
  PROPERTIES GENERATED TRUE
)
add_executable(puzzlescript_gba_atlas_smoke
  tests/gba_atlas_smoke.cpp
  ${GBA_ATLAS_SMOKE_SOURCE}
  ${GBA_ATLAS_SMOKE_RULES}
  src/gba/rule_runtime_stubs.cpp
)
target_include_directories(puzzlescript_gba_atlas_smoke PRIVATE
  ${GBA_ATLAS_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(puzzlescript_gba_atlas_smoke PRIVATE puzzlescript_gba_core)
target_compile_definitions(puzzlescript_gba_atlas_smoke PRIVATE
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)
add_test(NAME puzzlescript_gba_atlas_smoke COMMAND puzzlescript_gba_atlas_smoke)

set(GBA_COLLAPSE_AGAIN_SMOKE_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated/gba_collapse_again)
set(GBA_COLLAPSE_AGAIN_SMOKE_SOURCE ${GBA_COLLAPSE_AGAIN_SMOKE_DIR}/generated_game.cpp)
set(GBA_COLLAPSE_AGAIN_SMOKE_HEADER ${GBA_COLLAPSE_AGAIN_SMOKE_DIR}/generated_game.hpp)
set(GBA_COLLAPSE_AGAIN_SMOKE_RULES ${GBA_COLLAPSE_AGAIN_SMOKE_DIR}/generated_rules.cpp)
set(GBA_COLLAPSE_AGAIN_SMOKE_MANIFEST ${GBA_COLLAPSE_AGAIN_SMOKE_DIR}/gba_manifest.json)
add_custom_command(
  OUTPUT
    ${GBA_COLLAPSE_AGAIN_SMOKE_SOURCE}
    ${GBA_COLLAPSE_AGAIN_SMOKE_HEADER}
    ${GBA_COLLAPSE_AGAIN_SMOKE_RULES}
    ${GBA_COLLAPSE_AGAIN_SMOKE_MANIFEST}
  COMMAND $<TARGET_FILE:puzzlescript_cpp> export-gba
          "${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests/collapse.txt"
          --out ${GBA_COLLAPSE_AGAIN_SMOKE_DIR}
          --no-mmutil
  DEPENDS
    puzzlescript_cpp
    "${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests/collapse.txt"
  VERBATIM
)
set_source_files_properties(
  ${GBA_COLLAPSE_AGAIN_SMOKE_SOURCE}
  ${GBA_COLLAPSE_AGAIN_SMOKE_RULES}
  PROPERTIES GENERATED TRUE
)
add_executable(puzzlescript_gba_collapse_again_smoke
  tests/gba_collapse_again_smoke.cpp
  ${GBA_COLLAPSE_AGAIN_SMOKE_SOURCE}
  ${GBA_COLLAPSE_AGAIN_SMOKE_RULES}
  src/gba/rule_runtime_stubs.cpp
)
target_include_directories(puzzlescript_gba_collapse_again_smoke PRIVATE
  ${GBA_COLLAPSE_AGAIN_SMOKE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(puzzlescript_gba_collapse_again_smoke PRIVATE puzzlescript_gba_core)
target_compile_definitions(puzzlescript_gba_collapse_again_smoke PRIVATE
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)
add_test(NAME puzzlescript_gba_collapse_again_smoke COMMAND puzzlescript_gba_collapse_again_smoke)

# A generated export can be linked into this desktop-only executable to replay
# native-solver solutions against the exact 32-bit game representation used by
# the GBA ROM.  The PowerShell corpus harness changes this directory per game,
# reconfigures this one target, and records the first state divergence.
set(PS_GBA_PARITY_EXPORT_DIR "" CACHE PATH
  "Directory containing generated_game.cpp/generated_rules.cpp for GBA parity replay")
if(PS_GBA_PARITY_EXPORT_DIR AND NOT PS_MASK_WORD_BITS STREQUAL "32")
  message(FATAL_ERROR
    "PS_GBA_PARITY_EXPORT_DIR requires PS_MASK_WORD_BITS=32 so the native and generated runtimes share one C++ ABI")
endif()
if(PS_GBA_PARITY_EXPORT_DIR)
  get_filename_component(PS_GBA_PARITY_EXPORT_DIR_ABS "${PS_GBA_PARITY_EXPORT_DIR}" ABSOLUTE)
  foreach(PS_GBA_PARITY_FILE generated_game.hpp generated_game.cpp generated_rules.cpp)
    if(NOT EXISTS "${PS_GBA_PARITY_EXPORT_DIR_ABS}/${PS_GBA_PARITY_FILE}")
      message(FATAL_ERROR
        "PS_GBA_PARITY_EXPORT_DIR is missing ${PS_GBA_PARITY_FILE}: ${PS_GBA_PARITY_EXPORT_DIR_ABS}")
    endif()
  endforeach()

  add_library(puzzlescript_gba_parity_generated OBJECT
    "${PS_GBA_PARITY_EXPORT_DIR_ABS}/generated_game.cpp"
    "${PS_GBA_PARITY_EXPORT_DIR_ABS}/generated_rules.cpp"
  )
  target_include_directories(puzzlescript_gba_parity_generated PRIVATE
    "${PS_GBA_PARITY_EXPORT_DIR_ABS}"
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
  )
  target_compile_definitions(puzzlescript_gba_parity_generated PRIVATE
    PS_MASK_WORD_BITS=32
    PS_INTERPRETER_OBJECT_CELL_INDEX=1
  )

  add_executable(puzzlescript_gba_solution_replay
    tests/gba_solution_replay.cpp
    $<TARGET_OBJECTS:puzzlescript_gba_parity_generated>
  )
  target_include_directories(puzzlescript_gba_solution_replay PRIVATE
    "${PS_GBA_PARITY_EXPORT_DIR_ABS}"
    ${CMAKE_CURRENT_SOURCE_DIR}/src
  )
  target_link_libraries(puzzlescript_gba_solution_replay PRIVATE
    puzzlescript_gba_core
    puzzlescript_compiler
    puzzlescript_native
  )
endif()

# Compile the emitted compact-turn artifact independently as well as linking it
# into the generated-game smoke test.
add_library(puzzlescript_gba_generated_rules_smoke OBJECT ${GBA_GENERATED_SMOKE_RULES})
target_include_directories(puzzlescript_gba_generated_rules_smoke PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)
target_compile_definitions(puzzlescript_gba_generated_rules_smoke PRIVATE
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=$<BOOL:${PS_INTERPRETER_OBJECT_CELL_INDEX}>
)

add_executable(handheld_display_layout
  tests/handheld_display_layout.cpp
)

target_link_libraries(handheld_display_layout
  PRIVATE
    puzzlescript_handheld
)

target_include_directories(handheld_display_layout
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME handheld_display_layout
  COMMAND handheld_display_layout
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(handheld_report_smoke
  tests/handheld_report_smoke.cpp
)

target_link_libraries(handheld_report_smoke
  PRIVATE
    puzzlescript_handheld
)

target_include_directories(handheld_report_smoke
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME handheld_report_smoke
  COMMAND handheld_report_smoke
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_test(
  NAME handheld_report_cli_help
  COMMAND puzzlescript_handheld_report --help
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(handheld_report_cli_help
  PROPERTIES PASS_REGULAR_EXPRESSION "Usage:"
)

add_test(
  NAME handheld_report_cli_missing_source
  COMMAND ${CMAKE_COMMAND}
          -DTEST_EXE=$<TARGET_FILE:puzzlescript_handheld_report>
          -DEXPECT_REGEX=Usage:
          -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/ExpectCommandFailure.cmake
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(handheld_report_cli_missing_source
  PROPERTIES PASS_REGULAR_EXPRESSION "Usage:"
)

add_test(
  NAME handheld_report_cli_unknown_option
  COMMAND ${CMAKE_COMMAND}
          -DTEST_EXE=$<TARGET_FILE:puzzlescript_handheld_report>
          -DTEST_ARGS=--bogus
          -DEXPECT_REGEX=unknown.option
          -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/ExpectCommandFailure.cmake
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(handheld_report_cli_unknown_option
  PROPERTIES PASS_REGULAR_EXPRESSION "unknown option"
)

add_test(
  NAME handheld_report_cli_positional_sokoban
  COMMAND puzzlescript_handheld_report --display 800x480 ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(handheld_report_cli_positional_sokoban
  PROPERTIES PASS_REGULAR_EXPRESSION "\"games\".*\"compile_ok\":true"
)

add_test(
  NAME handheld_report_cli_source_sokoban
  COMMAND puzzlescript_handheld_report --display 800x480 --source ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(handheld_report_cli_source_sokoban
  PROPERTIES PASS_REGULAR_EXPRESSION "\"games\".*\"compile_ok\":true"
)

set(HANDHELD_REPORT_CLI_CORPUS_NDJSON "${CMAKE_CURRENT_BINARY_DIR}/generated/handheld_report_cli_corpus.ndjson")
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/generated")
file(WRITE "${HANDHELD_REPORT_CLI_CORPUS_NDJSON}"
  "{\"index\":0,\"name\":\"simple\",\"source\":\"title simple\\n\\nOBJECTS\\nBackground\\nblack\\nPlayer\\nwhite\\n\\nLEGEND\\n. = Background\\nP = Player\\n\\nCOLLISIONLAYERS\\nBackground\\nPlayer\\n\\nLEVELS\\nP\\n\"}\n"
)
add_test(
  NAME handheld_report_cli_corpus_ndjson
  COMMAND puzzlescript_handheld_report --display 800x480 --corpus-ndjson ${HANDHELD_REPORT_CLI_CORPUS_NDJSON}
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(handheld_report_cli_corpus_ndjson
  PROPERTIES PASS_REGULAR_EXPRESSION "\"summary\".*\"game_count\":1.*\"compiled_games\":1.*\"games\""
)

add_test(
  NAME puzzlescript_cpp_layout_smoke
  COMMAND puzzlescript_cpp layout ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_smoke_tests/push_goal.txt
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(puzzlescript_cpp_layout_smoke
  PROPERTIES PASS_REGULAR_EXPRESSION "\"mask_arena_bytes\""
)

add_executable(compiler_keyword_names
  tests/compiler_keyword_names.cpp
)

target_link_libraries(compiler_keyword_names
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_keyword_names
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_keyword_names
  COMMAND compiler_keyword_names
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(generator_generation_rules
  tests/generator_generation_rules.cpp
  src/generator/generation_rules.cpp
  src/generator/spec_parser.cpp
)

target_link_libraries(generator_generation_rules
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(generator_generation_rules
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME generator_generation_rules
  COMMAND generator_generation_rules
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(generator_templatize
  tests/generator_templatize.cpp
  src/generator/generation_rules.cpp
  src/generator/spec_parser.cpp
  src/generator/templatize.cpp
)

target_link_libraries(generator_templatize
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(generator_templatize
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME generator_templatize
  COMMAND generator_templatize
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(generator_difficulty_assessment
  tests/generator_difficulty_assessment.cpp
)

target_link_libraries(generator_difficulty_assessment
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(generator_difficulty_assessment
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME generator_difficulty_assessment
  COMMAND generator_difficulty_assessment
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(simplify_level
  tests/simplify_level.cpp
)

target_link_libraries(simplify_level
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(simplify_level
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME simplify_level
  COMMAND simplify_level
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(level_rows_supplemental_glyphs
  tests/level_rows_supplemental_glyphs.cpp
  src/generator/level_rows.cpp
  src/generator/output_writer.cpp
)

target_link_libraries(level_rows_supplemental_glyphs
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(level_rows_supplemental_glyphs
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME level_rows_supplemental_glyphs
  COMMAND level_rows_supplemental_glyphs
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(generator_duration_parse
  tests/generator_duration_parse.cpp
  src/generator/duration_parse.cpp
)

target_include_directories(generator_duration_parse
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME generator_duration_parse
  COMMAND generator_duration_parse
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(generator_spec_parser
  tests/generator_spec_parser.cpp
  src/generator/spec_parser.cpp
)

target_link_libraries(generator_spec_parser
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(generator_spec_parser
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME generator_spec_parser
  COMMAND generator_spec_parser
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(generator_block_keepers
  tests/generator_block_keepers.cpp
  src/generator/block_scheduler.cpp
  src/generator/generation_rules.cpp
  src/generator/level_rows.cpp
  src/generator/output_writer.cpp
  src/generator/spec_parser.cpp
)

target_link_libraries(generator_block_keepers
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(generator_block_keepers
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME generator_block_keepers
  COMMAND generator_block_keepers
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(generator_block_exhaustion
  tests/generator_block_exhaustion.cpp
  src/generator/block_scheduler.cpp
  src/generator/generation_rules.cpp
  src/generator/level_rows.cpp
  src/generator/output_writer.cpp
  src/generator/spec_parser.cpp
)

target_link_libraries(generator_block_exhaustion
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(generator_block_exhaustion
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME generator_block_exhaustion
  COMMAND generator_block_exhaustion
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(generator_microban_stamp_repro
  tests/generator_microban_stamp_repro.cpp
  src/generator/templatize.cpp
  src/generator/generation_rules.cpp
  src/generator/spec_parser.cpp
  src/generator/level_rows.cpp
)

target_link_libraries(generator_microban_stamp_repro
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(generator_microban_stamp_repro
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME generator_microban_stamp_repro
  COMMAND generator_microban_stamp_repro
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(compiler_semantic_program
  tests/compiler_semantic_program.cpp
)

target_link_libraries(compiler_semantic_program
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_semantic_program
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_semantic_program
  COMMAND compiler_semantic_program
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(compiler_duplicate_no_cell
  tests/compiler_duplicate_no_cell.cpp
)

target_link_libraries(compiler_duplicate_no_cell
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_duplicate_no_cell
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_duplicate_no_cell
  COMMAND compiler_duplicate_no_cell
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(static_analysis_runtime_ir_extras
  tests/static_analysis_runtime_ir_extras.cpp
)

target_link_libraries(static_analysis_runtime_ir_extras
  PRIVATE
    puzzlescript_native
)

target_include_directories(static_analysis_runtime_ir_extras
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME static_analysis_runtime_ir_extras
  COMMAND static_analysis_runtime_ir_extras
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(movement_layer_analysis
  tests/movement_layer_analysis.cpp
)
target_link_libraries(movement_layer_analysis
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)
target_include_directories(movement_layer_analysis
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_compile_definitions(movement_layer_analysis
  PRIVATE
    PS_REPO_ROOT="${PUZZLESCRIPT_REPO_ROOT}"
)
add_test(
  NAME movement_layer_analysis
  COMMAND movement_layer_analysis
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(compiler_mask_interning
  tests/compiler_mask_interning.cpp
)

target_link_libraries(compiler_mask_interning
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_mask_interning
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_mask_interning
  COMMAND compiler_mask_interning
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(compiler_row_any_masks
  tests/compiler_row_any_masks.cpp
)

target_link_libraries(compiler_row_any_masks
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_row_any_masks
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_row_any_masks
  COMMAND compiler_row_any_masks
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(compiler_rigid_moving_concretize
  tests/compiler_rigid_moving_concretize.cpp
)

target_link_libraries(compiler_rigid_moving_concretize
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_rigid_moving_concretize
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_rigid_moving_concretize
  COMMAND compiler_rigid_moving_concretize
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(compiler_row_missing_masks
  tests/compiler_row_missing_masks.cpp
)

target_link_libraries(compiler_row_missing_masks
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_row_missing_masks
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_row_missing_masks
  COMMAND compiler_row_missing_masks
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(compiler_input_specialization_masks
  tests/compiler_input_specialization_masks.cpp
)

target_link_libraries(compiler_input_specialization_masks
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_input_specialization_masks
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_input_specialization_masks
  COMMAND compiler_input_specialization_masks
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(compiler_compact_turn_support
  tests/compiler_compact_turn_support.cpp
)

target_link_libraries(compiler_compact_turn_support
  PRIVATE
    puzzlescript_native
    puzzlescript_compiler
)

target_include_directories(compiler_compact_turn_support
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME compiler_compact_turn_support
  COMMAND compiler_compact_turn_support
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)

add_executable(runtime_standalone_link
  tests/runtime_standalone_link.cpp
)

target_link_libraries(runtime_standalone_link
  PRIVATE
    puzzlescript_native
)

add_test(
  NAME runtime_standalone_link
  COMMAND ${CMAKE_COMMAND}
          -DRUNTIME_STANDALONE_EXE=$<TARGET_FILE:runtime_standalone_link>
          -DPUZZLESCRIPT_NATIVE_ARCHIVE=$<TARGET_FILE:puzzlescript_native>
          -DNM_EXECUTABLE=${CMAKE_NM}
          -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/runtime_standalone_link_check.cmake
)

add_executable(pocket_card_runtime_fixture
  tests/pocket_card_runtime_fixture.cpp
)
target_link_libraries(pocket_card_runtime_fixture PRIVATE puzzlescript_native)
add_test(
  NAME pocket_card_runtime_fixture
  COMMAND pocket_card_runtime_fixture
          ${PUZZLESCRIPT_REPO_ROOT}/firmware/pocket_card/main/sokoban_basic.ir.json
)

add_executable(ambient_light_policy_tests
  tests/ambient_light_policy_tests.cpp
)
target_include_directories(ambient_light_policy_tests PRIVATE
  ${PUZZLESCRIPT_REPO_ROOT}/firmware/pocket_card/main
)
add_test(
  NAME ambient_light_policy_tests
  COMMAND ambient_light_policy_tests
)

if(TARGET PkgConfig::SDL2)
  add_test(
    NAME puzzlescript_cpp_player_sdl_dummy_smoke
    COMMAND puzzlescript_cpp play ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  )
  set_tests_properties(puzzlescript_cpp_player_sdl_dummy_smoke
    PROPERTIES
      ENVIRONMENT "SDL_VIDEODRIVER=dummy;SDL_AUDIODRIVER=dummy;PS_PLAYER_FRAME_LIMIT=2"
      TIMEOUT 15
  )
endif()

add_test(
  NAME puzzlescript_cpp_step_smoke
  COMMAND puzzlescript_cpp step ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt right --level 0 --seed native-step-smoke --settle-again
)
set_tests_properties(puzzlescript_cpp_step_smoke PROPERTIES PASS_REGULAR_EXPRESSION "step\\[0\\] token=right changed=1")

add_test(
  NAME puzzlescript_solver_smoke
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_solver_smoke_assert.js
          $<TARGET_FILE:puzzlescript_solver>
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_smoke_tests
          --timeout-ms 1000
)
set_tests_properties(puzzlescript_solver_smoke PROPERTIES TIMEOUT 30)

add_test(
  NAME puzzlescript_solver_determinism_smoke
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_solver_determinism.js
          $<TARGET_FILE:puzzlescript_solver>
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_smoke_tests
          --runs 5
          --timeout-ms 1000
)
set_tests_properties(puzzlescript_solver_determinism_smoke PROPERTIES TIMEOUT 60)

add_test(
  NAME puzzlescript_solver_js_parity_smoke
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_solver_parity_smoke.js
          $<TARGET_FILE:puzzlescript_solver>
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_smoke_tests
)
set_tests_properties(puzzlescript_solver_js_parity_smoke PROPERTIES TIMEOUT 120)

add_test(
  NAME native_solver_js_coverage_node
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/native_solver_js_coverage_node.js
)
set_tests_properties(native_solver_js_coverage_node PROPERTIES TIMEOUT 10)

add_test(
  NAME native_solver_instrumentation_pack_node
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/native_solver_instrumentation_pack_node.js
)
set_tests_properties(native_solver_instrumentation_pack_node PROPERTIES TIMEOUT 10)

add_test(
  NAME solver_timeout_curve_denominator_node
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_timeout_curve_denominator_node.js
)
set_tests_properties(solver_timeout_curve_denominator_node PROPERTIES TIMEOUT 10)

add_test(
  NAME solver_timeout_curve_build_node
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_timeout_curve_build_node.js
)
set_tests_properties(solver_timeout_curve_build_node PROPERTIES TIMEOUT 10)

find_program(PUZZLESCRIPT_MAKE_EXECUTABLE make)
if(PUZZLESCRIPT_MAKE_EXECUTABLE)
  add_test(
    NAME solver_time_curve_single_game_make_node
    COMMAND ${NODE_EXECUTABLE}
            ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_time_curve_single_game_make_node.js
  )
  set_tests_properties(solver_time_curve_single_game_make_node PROPERTIES TIMEOUT 10)
endif()

if(PS_ENABLE_SLOW_SOLVER_COVERAGE_TESTS)
  add_test(
    NAME puzzlescript_solver_js_coverage_full
    COMMAND ${NODE_EXECUTABLE}
            ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_native_solver_js_coverage.js
            $<TARGET_FILE:puzzlescript_solver>
            ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
            --timeout-ms 1000
            --strategy portfolio
            --jobs 1
  )
  set_tests_properties(puzzlescript_solver_js_coverage_full
    PROPERTIES
      TIMEOUT 1200
      LABELS "slow;solver"
  )
endif()

add_test(
  NAME puzzlescript_solver_portfolio_alternatey_level4
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game alternatey.txt
          --level 4
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_alternatey_level4
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_alternatey_level6
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game alternatey.txt
          --level 6
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_alternatey_level6
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_twostep_pete
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game "Two-Step Pete.txt"
          --level 15
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_twostep_pete
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_pending_again_start
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game "car crash.txt"
          --level 2
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_pending_again_start
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_constellationz
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game constellationz.txt
          --level 5
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_constellationz
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_karamell
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game karamell.txt
          --level 1
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_karamell
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_xorro
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game "Xorro The Chaos Warden.txt"
          --level 3
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_xorro
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_whaleworld
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game whaleworld.txt
          --level 15
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_whaleworld
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_muraphilic
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game "Muraphilic Monophobic Multiban.txt"
          --level 1
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_muraphilic
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_collapse
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game collapse.txt
          --level 2
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_collapse
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_paint_everything_everywhere
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game "paint everything everywhere.txt"
          --level 17
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_paint_everything_everywhere
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

# This random run_rules_on_level_start game previously appeared to solve only
# because the solver searched before its pending startup `again` chain had
# drained. Any reported solution is now replay-validated from the player-visible
# settled state; a timeout is an honest outcome for this performance smoke.
add_test(
  NAME puzzlescript_solver_portfolio_expand_avoid_flames_player_start_smoke
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 1000
          --jobs 1
          --strategy portfolio
          --game "expand also avoid the flames.txt"
          --level 1
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_expand_avoid_flames_player_start_smoke
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"(solved|timeout)\""
    TIMEOUT 5
)

add_test(
  NAME puzzlescript_solver_weighted_astar_all_green_to_blue
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy weighted-astar
          --astar-weight 3
          --game "ALL GREEN TO BLUE.txt"
          --level 11
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_weighted_astar_all_green_to_blue
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

add_test(
  NAME puzzlescript_solver_portfolio_pushit_level5
  COMMAND puzzlescript_solver
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
          --timeout-ms 10000
          --jobs 1
          --strategy portfolio
          --game pushit.txt
          --level 5
          --json
          --quiet
)
set_tests_properties(puzzlescript_solver_portfolio_pushit_level5
  PROPERTIES
    PASS_REGULAR_EXPRESSION "\"status\":\"solved\""
    TIMEOUT 10
)

set(PUZZLESCRIPT_SOLVER_REGRESSION_TESTS
  puzzlescript_solver_portfolio_alternatey_level4
  puzzlescript_solver_portfolio_alternatey_level6
  puzzlescript_solver_portfolio_twostep_pete
  puzzlescript_solver_portfolio_pending_again_start
  puzzlescript_solver_portfolio_constellationz
  puzzlescript_solver_portfolio_karamell
  puzzlescript_solver_portfolio_xorro
  puzzlescript_solver_portfolio_whaleworld
  puzzlescript_solver_portfolio_muraphilic
  puzzlescript_solver_portfolio_collapse
  puzzlescript_solver_portfolio_paint_everything_everywhere
  puzzlescript_solver_portfolio_expand_avoid_flames_player_start_smoke
  puzzlescript_solver_weighted_astar_all_green_to_blue
  puzzlescript_solver_portfolio_pushit_level5
)
set_tests_properties(${PUZZLESCRIPT_SOLVER_REGRESSION_TESTS} PROPERTIES TIMEOUT 30)

add_test(
  NAME puzzlescript_generator_smoke
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_generator_smoke.js
          $<TARGET_FILE:puzzlescript_generator>
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
)
set_tests_properties(puzzlescript_generator_smoke PROPERTIES TIMEOUT 30)
if(MSVC)
  set_tests_properties(puzzlescript_generator_smoke PROPERTIES
    TIMEOUT 120
    ENVIRONMENT "PS_GENERATOR_SMOKE_SOLVER_TIMEOUT_MS=500;PS_GENERATOR_SMOKE_SHORT_SOLVER_TIMEOUT_MS=200")
endif()

add_test(
  NAME puzzlescript_generator_levelset_smoke
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_generator_levelset_smoke.js
          $<TARGET_FILE:puzzlescript_generator>
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/generator_presets/sokoban_levelset_tiny.gen
)
set_tests_properties(puzzlescript_generator_levelset_smoke PROPERTIES TIMEOUT 60)
if(MSVC)
  set_tests_properties(puzzlescript_generator_levelset_smoke PROPERTIES
    TIMEOUT 180
    ENVIRONMENT "PS_GENERATOR_SMOKE_SOLVER_TIMEOUT_MS=5000;PS_GENERATOR_SMOKE_TIME_SCALE=3")
endif()

add_test(
  NAME puzzlescript_generator_remix_smoke
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_generator_remix_smoke.js
          $<TARGET_FILE:puzzlescript_generator>
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(puzzlescript_generator_remix_smoke PROPERTIES TIMEOUT 90)
if(MSVC)
  set_tests_properties(puzzlescript_generator_remix_smoke PROPERTIES
    TIMEOUT 180
    ENVIRONMENT "PS_GENERATOR_SMOKE_SOLVER_TIMEOUT_MS=5000;PS_GENERATOR_SMOKE_TIME_SCALE=3")
endif()

add_test(
  NAME puzzlescript_simplify_smoke
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_simplify_smoke.js
          $<TARGET_FILE:puzzlescript_simplify>
          ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(puzzlescript_simplify_smoke PROPERTIES TIMEOUT 120)

add_test(
  NAME puzzlescript_generator_events_jsonl
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_generator_events_jsonl_node.js
          $<TARGET_FILE:puzzlescript_generator>
          ${PUZZLESCRIPT_REPO_ROOT}
)
set_tests_properties(puzzlescript_generator_events_jsonl PROPERTIES TIMEOUT 30)

if(NOT WIN32)
  add_test(
    NAME puzzlescript_rule_plan_parity
    COMMAND ${NODE_EXECUTABLE}
            ${PUZZLESCRIPT_REPO_ROOT}/src/tests/run_rule_plan_parity.js
            ${PUZZLESCRIPT_REPO_ROOT}/src/tests/resources/testdata.js
            --cli $<TARGET_FILE:puzzlescript_cpp>
            --artifacts-dir ${CMAKE_CURRENT_BINARY_DIR}/rule_plan_parity_testdata
            --progress-every 0
  )
  set_tests_properties(puzzlescript_rule_plan_parity PROPERTIES TIMEOUT 180)
endif()

add_test(
  NAME puzzlescript_cpp_parser_state_smoke
  COMMAND puzzlescript_cpp compile ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt --emit-parser-state
)
set_tests_properties(puzzlescript_cpp_parser_state_smoke PROPERTIES PASS_REGULAR_EXPRESSION "\"parser_state\"")

add_test(
  NAME puzzlescript_cpp_semantic_program_smoke
  COMMAND puzzlescript_cpp compile ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt --emit-semantic-program
)
set_tests_properties(puzzlescript_cpp_semantic_program_smoke PROPERTIES PASS_REGULAR_EXPRESSION "\"semantic_program\"")

find_program(PUZZLESCRIPT_BASH_EXECUTABLE bash)
set(PUZZLESCRIPT_HAS_USABLE_BASH FALSE)
if(PUZZLESCRIPT_BASH_EXECUTABLE)
  execute_process(
    COMMAND ${PUZZLESCRIPT_BASH_EXECUTABLE} -lc "exit 0"
    RESULT_VARIABLE PUZZLESCRIPT_BASH_RESULT
    OUTPUT_QUIET
    ERROR_QUIET
  )
  if(PUZZLESCRIPT_BASH_RESULT EQUAL 0)
    set(PUZZLESCRIPT_HAS_USABLE_BASH TRUE)
  endif()
endif()

if(PUZZLESCRIPT_HAS_USABLE_BASH)
  add_test(
    NAME puzzlescript_cpp_parser_state_diff_smoke
    COMMAND ${PUZZLESCRIPT_BASH_EXECUTABLE} ${PUZZLESCRIPT_REPO_ROOT}/scripts/diff_parser_state_against_js.sh ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  )

  add_test(
    NAME puzzlescript_cpp_semantic_program_diff_smoke
    COMMAND ${PUZZLESCRIPT_BASH_EXECUTABLE} ${PUZZLESCRIPT_REPO_ROOT}/scripts/diff_semantic_program_against_js.sh ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  )
endif()

# Corpus-wide JS<->C++ SemanticProgram parity. Asserts parity over every game
# that satisfies the single-layer invariant and reports (does not silently drop)
# the games that violate it.
add_test(
  NAME semantic_program_parity_corpus
  COMMAND ${NODE_EXECUTABLE}
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/semantic_program_parity_corpus_node.js
          $<TARGET_FILE:puzzlescript_cpp>
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests
)
set_tests_properties(semantic_program_parity_corpus PROPERTIES TIMEOUT 180)

if(PUZZLESCRIPT_HAS_USABLE_BASH)
  add_test(
    NAME puzzlescript_cpp_parser_diagnostics_diff_smoke
    COMMAND ${PUZZLESCRIPT_BASH_EXECUTABLE} ${PUZZLESCRIPT_REPO_ROOT}/scripts/diff_diagnostics_against_js.sh ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt
  )
endif()

add_test(
  NAME puzzlescript_cpp_diff_trace_smoke
  COMMAND puzzlescript_cpp diff-trace ${SMOKE_IR} ${SMOKE_TRACE}
)

add_test(
  NAME puzzlescript_cpp_diff_trace_smoke_source
  COMMAND puzzlescript_cpp diff-trace ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt --level 0 --seed native-trace-smoke --inputs-file ${SMOKE_TRACE_INPUTS}
)

add_test(
  NAME puzzlescript_cpp_diff_trace_right_smoke
  COMMAND puzzlescript_cpp diff-trace ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt --level 0 --seed native-trace-right --inputs-file ${CMAKE_CURRENT_SOURCE_DIR}/tests/right_trace_inputs.json
)

add_test(
  NAME puzzlescript_cpp_diff_trace_push_smoke
  COMMAND puzzlescript_cpp diff-trace ${PUZZLESCRIPT_REPO_ROOT}/src/demo/sokoban_basic.txt --level 0 --seed native-trace-push --inputs-file ${CMAKE_CURRENT_SOURCE_DIR}/tests/push_trace_inputs.json
)

add_test(
  NAME puzzlescript_cpp_trace_alternatey_level4
  COMMAND puzzlescript_cpp run
          ${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests/alternatey.txt
          --headless
          --level 4
          --seed native-trace-alternatey-l4
          --native-compile
          --inputs-json "[3,0,1,2,2,3,3]"
)
set_tests_properties(puzzlescript_cpp_trace_alternatey_level4
  PROPERTIES
    PASS_REGULAR_EXPRESSION "trace_diff_passed"
    TIMEOUT 30
)

add_test(
  NAME puzzlescript_cpp_trace_expand_avoid_flames
  COMMAND puzzlescript_cpp run
          "${PUZZLESCRIPT_REPO_ROOT}/src/tests/solver_tests/expand also avoid the flames.txt"
          --headless
          --level 1
          --seed native-trace-expand-flames-l1
          --native-compile
          --inputs-json "[0,0,1,1,4,1,1,4,0,0,4,0,0,4,3,3,4,4,4,2,2,2,4]"
)
set_tests_properties(puzzlescript_cpp_trace_expand_avoid_flames
  PROPERTIES
    PASS_REGULAR_EXPRESSION "trace_diff_passed"
    TIMEOUT 30
)

if(PS_MASK_WORD_BITS STREQUAL "32")
  add_test(
    NAME puzzlescript_cpp_js_parity_data_manifest
    COMMAND ${NODE_EXECUTABLE}
            ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_fixture_check.js
            ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/export_native_fixtures.js
            $<TARGET_FILE:puzzlescript_cpp>
            ${CMAKE_CURRENT_BINARY_DIR}/generated-fixtures
  )

  set_tests_properties(puzzlescript_cpp_js_parity_data_manifest PROPERTIES TIMEOUT 180)

  add_test(
    NAME puzzlescript_cpp_js_parity_data_trace_sample
    COMMAND ${NODE_EXECUTABLE}
            ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_fixture_check.js
            ${PUZZLESCRIPT_REPO_ROOT}/src/tests/js_oracle/export_native_fixtures.js
            $<TARGET_FILE:puzzlescript_cpp>
            ${CMAKE_CURRENT_BINARY_DIR}/generated-fixtures-trace-sample
            --trace-limit 10
            --trace-allow-failures
  )

  set_tests_properties(puzzlescript_cpp_js_parity_data_trace_sample PROPERTIES TIMEOUT 180)
endif()
