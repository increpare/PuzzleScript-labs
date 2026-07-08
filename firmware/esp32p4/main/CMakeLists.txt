set(PUZZLESCRIPT_NATIVE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../native")

idf_component_register(
  SRCS
    "main.cpp"
    "ps_instrumentation.cpp"
    "board_i2c.cpp"
    "board_audio.cpp"
    "board_touch.cpp"
    "board_buttons.cpp"
    "ps_framebuffer.cpp"
    "ps_renderer.cpp"
    "ps_probe_runtime.cpp"
    "ps_simulation_corpus.cpp"
    "ps_storage.cpp"
    "ps_embedded_games.cpp"
    "ps_touch_gestures.cpp"
    "ps_ui_draw.cpp"
    "ps_dot_font.cpp"
    "ps_text_screen.cpp"
    "ps_player_save.cpp"
    "ps_audio.cpp"
    "ps_player.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/player/sfxr.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/handheld/display_layout.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/simulation/corpus_runner.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/compiled_rules.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/c_api.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/core.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/hash.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/json.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/simd.cpp"
    "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/locality_survey.cpp"
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
  # Basename-only fixture paths keep ESP-IDF _binary_* symbols stable for the runtime probe.
  EMBED_TXTFILES
    "sokoban_basic.txt"
    "broken_smoke.txt"
    "games/microban.txt"
    "games/push.txt"
    "games/actiontest.txt"
    "../../../src/js/font.js"
  REQUIRES
    spi_flash
    nvs_flash
    fatfs
    vfs
    esp_timer
    espressif__esp_lcd_ek79007
    espressif__esp_lcd_touch_gt911
  PRIV_REQUIRES
    espressif__esp_codec_dev
    esp_driver_i2s
    esp_driver_gpio
    esp_driver_i2c
    esp_driver_sdmmc
)

target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_17)
target_compile_options(${COMPONENT_LIB} PRIVATE
  -Wall
  -Wextra
  -Wno-missing-field-initializers
  -Wno-unused-parameter
  -Wno-sign-compare
)

set_source_files_properties(
  "${PUZZLESCRIPT_NATIVE_DIR}/third_party/simdjson/simdjson.cpp"
  "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/core.cpp"
  "${PUZZLESCRIPT_NATIVE_DIR}/src/runtime/json.cpp"
  PROPERTIES COMPILE_OPTIONS "-Wno-error=format")

set_source_files_properties(
  "${PUZZLESCRIPT_NATIVE_DIR}/third_party/utf8proc/utf8proc.c"
  PROPERTIES COMPILE_OPTIONS "-w")

target_compile_definitions(${COMPONENT_LIB} PRIVATE
  UTF8PROC_STATIC
  PS_MASK_WORD_BITS=32
  PS_INTERPRETER_OBJECT_CELL_INDEX=1
)

if(CONFIG_PS_BOARD_CARD)
  target_sources(${COMPONENT_LIB} PRIVATE "board_card.cpp")
else()
  target_sources(${COMPONENT_LIB} PRIVATE "board_waveshare_7b.cpp")
endif()
