if(NOT DEFINED RUNTIME_STANDALONE_EXE)
  message(FATAL_ERROR "RUNTIME_STANDALONE_EXE is required")
endif()
if(NOT DEFINED PUZZLESCRIPT_NATIVE_ARCHIVE)
  message(FATAL_ERROR "PUZZLESCRIPT_NATIVE_ARCHIVE is required")
endif()
if(NOT DEFINED NM_EXECUTABLE)
  message(FATAL_ERROR "NM_EXECUTABLE is required")
endif()

execute_process(
  COMMAND "${RUNTIME_STANDALONE_EXE}"
  RESULT_VARIABLE run_result
)
if(NOT run_result EQUAL 0)
  message(FATAL_ERROR "runtime_standalone_link executable failed with ${run_result}")
endif()

execute_process(
  COMMAND "${NM_EXECUTABLE}" -u "${PUZZLESCRIPT_NATIVE_ARCHIVE}"
  RESULT_VARIABLE nm_result
  OUTPUT_VARIABLE nm_output
  ERROR_VARIABLE nm_error
)
if(NOT nm_result EQUAL 0)
  message(FATAL_ERROR "nm failed with ${nm_result}: ${nm_error}")
endif()

string(
  REGEX MATCHALL
  "[^\n]*(puzzlescript[0-9]+compiler|parseSource|lowerToRuntimeGame)[^\n]*"
  forbidden_symbols
  "${nm_output}"
)
if(forbidden_symbols)
  string(REPLACE ";" "\n" forbidden_symbol_lines "${forbidden_symbols}")
  message(FATAL_ERROR "puzzlescript_native contains compiler references:\n${forbidden_symbol_lines}")
endif()
