set(PUZZLESCRIPT_NATIVE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../native")
set(ESP32P4_MAIN_DIR "${CMAKE_CURRENT_LIST_DIR}/../../esp32p4/main")

idf_component_register(
  SRCS
    "ambient_led.cpp"
    "board_display.cpp"
    "controls_input.cpp"
    "mcp23017.cpp"
    "mcp23017_bench.cpp"
    "main.cpp"
    "pocket_player.cpp"
    "probe_log.cpp"
    "runtime_probe.cpp"
    "${ESP32P4_MAIN_DIR}/ps_dot_font.cpp"
    "${ESP32P4_MAIN_DIR}/ps_framebuffer.cpp"
    "${ESP32P4_MAIN_DIR}/ps_renderer.cpp"
    "${ESP32P4_MAIN_DIR}/ps_text_screen.cpp"
    "${ESP32P4_MAIN_DIR}/ps_touch_gestures.cpp"
    "${ESP32P4_MAIN_DIR}/ps_ui_draw.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/handheld/display_layout.cpp"
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
    "${ESP32P4_MAIN_DIR}"
    "${PUZZLESCRIPT_NATIVE_DIR}/include"
    "${PUZZLESCRIPT_NATIVE_DIR}/src"
    "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson"
  EMBED_FILES
    "sokoban_basic.ir.json"
  EMBED_TXTFILES
    "../../../src/js/font.js"
  REQUIRES
    driver
    esp_lcd
    esp_timer
    led_strip
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
