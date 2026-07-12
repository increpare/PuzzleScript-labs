set(PUZZLESCRIPT_NATIVE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../native")

idf_component_register(
  SRCS
    "main.cpp"
    "probe_log.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/c_api.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/compiled_rules.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/core.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/hash.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/json.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/locality_survey.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/simd.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson/simdjson.cpp"
  INCLUDE_DIRS
    "."
    "${PUZZLESCRIPT_NATIVE_DIR}/include"
    "${PUZZLESCRIPT_NATIVE_DIR}/src"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson"
  # Binary embedding keeps _end - _start equal to the JSON byte length.
  # Text embedding appends a NUL that the explicit-length runtime parser must not see.
  EMBED_FILES
    "sokoban_basic.ir.json"
  REQUIRES
    esp_timer
    spi_flash
)

target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_20)
target_compile_options(${COMPONENT_LIB} PRIVATE
  -Wall
  -Wextra
  -Wno-missing-field-initializers
  -Wno-unused-parameter
  -Wno-sign-compare
)

target_compile_definitions(${COMPONENT_LIB} PRIVATE
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)

set_source_files_properties(
  "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson/simdjson.cpp"
  "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/core.cpp"
  "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/json.cpp"
  PROPERTIES COMPILE_OPTIONS "-Wno-error=format"
)
