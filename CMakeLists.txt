cmake_minimum_required(VERSION 3.20)

project(PuzzleScriptNative LANGUAGES CXX C)

option(PUZZLESCRIPT_BUILD_NATIVE "Build the native PuzzleScript scaffold." ON)

include(CTest)

if(PUZZLESCRIPT_BUILD_NATIVE)
  add_subdirectory(native)

  add_executable(puzzlescriptmis_native_bridge_smoke
    tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp
    tools/puzzlescriptmis-app/tests/native_bridge_smoke.cpp
  )

  set_target_properties(puzzlescriptmis_native_bridge_smoke PROPERTIES CXX_STANDARD 20)

  target_include_directories(puzzlescriptmis_native_bridge_smoke
    PRIVATE
      ${CMAKE_CURRENT_SOURCE_DIR}/tools/puzzlescriptmis-app/src
      ${CMAKE_CURRENT_SOURCE_DIR}/native/src
  )

  target_link_libraries(puzzlescriptmis_native_bridge_smoke
    PRIVATE
      puzzlescript_native
      puzzlescript_compiler
  )

  add_test(
    NAME puzzlescriptmis_native_bridge_smoke
    COMMAND puzzlescriptmis_native_bridge_smoke
  )

  add_test(
    NAME puzzlescriptmis_transformer_wiring_static
    COMMAND ${NODE_EXECUTABLE}
            ${CMAKE_CURRENT_SOURCE_DIR}/tools/puzzlescriptmis-app/tests/transformer_wiring_static_test.js
  )

  add_executable(puzzlescriptmis_generation_random
    tools/puzzlescriptmis-app/tests/generation_random.cpp)
  target_include_directories(puzzlescriptmis_generation_random PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/tools/puzzlescriptmis-app/src)
  add_test(NAME puzzlescriptmis_generation_random COMMAND puzzlescriptmis_generation_random)

  add_executable(puzzlescriptmis_difficulty_integration
    tools/puzzlescriptmis-app/src/native_bridge/NativeGameBridge.cpp
    tools/puzzlescriptmis-app/src/native_bridge/DifficultyAssessment.cpp
    tools/puzzlescriptmis-app/tests/difficulty_integration.cpp)
  set_target_properties(puzzlescriptmis_difficulty_integration PROPERTIES CXX_STANDARD 20)
  target_compile_definitions(puzzlescriptmis_difficulty_integration PRIVATE compiledWithoutOpenframeworks)
  target_compile_options(puzzlescriptmis_difficulty_integration PRIVATE $<$<CXX_COMPILER_ID:MSVC>:/Zc:__cplusplus>)
  target_include_directories(puzzlescriptmis_difficulty_integration PRIVATE
    tools/puzzlescriptmis-app/src native/src)
  target_link_libraries(puzzlescriptmis_difficulty_integration PRIVATE puzzlescript_native puzzlescript_compiler)
  add_test(NAME puzzlescriptmis_difficulty_integration COMMAND puzzlescriptmis_difficulty_integration)
  set_tests_properties(puzzlescriptmis_difficulty_integration PROPERTIES
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR} TIMEOUT 30)
endif()
