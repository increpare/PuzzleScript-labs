set(PUZZLESCRIPT_NATIVE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../native")

idf_component_register(
  SRCS
    "main.cpp"
    "ps_instrumentation.cpp"
    "board_waveshare_7b.cpp"
    "ps_framebuffer.cpp"
    "ps_storage.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/handheld/display_layout.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/compiled_rules.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/c_api.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/core.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/hash.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/json.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/simd.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson/simdjson.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/compact_turn_codegen.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/compact_turn_program.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/compiled_rules_codegen.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/compile_diagnostics.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/c_api.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/source_c_api.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/diagnostic.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/lower_to_runtime.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/parser.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/parser_glyphs.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/rule_text.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/compiler/semantic_program.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/utf8proc/utf8proc.c"
  INCLUDE_DIRS
    "."
    "${PUZZLESCRIPT_NATIVE_DIR}/include"
    "${PUZZLESCRIPT_NATIVE_DIR}/src"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/utf8proc"
  EMBED_TXTFILES
    "../../../src/demo/sokoban_basic.txt"
    "embedded_games/broken_smoke.txt"
)

target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_17)
target_compile_options(${COMPONENT_LIB} PRIVATE
  -Wall
  -Wextra
  -Wno-missing-field-initializers
  -Wno-unused-parameter
  -Wno-sign-compare
)
target_compile_definitions(${COMPONENT_LIB} PRIVATE
  UTF8PROC_STATIC
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)
