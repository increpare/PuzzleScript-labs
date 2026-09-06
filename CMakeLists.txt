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
endif()
