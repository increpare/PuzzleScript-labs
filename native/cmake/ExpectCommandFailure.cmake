if(NOT DEFINED TEST_EXE)
  message(FATAL_ERROR "TEST_EXE is required")
endif()
if(NOT DEFINED EXPECT_REGEX)
  message(FATAL_ERROR "EXPECT_REGEX is required")
endif()

if(DEFINED TEST_ARGS)
  set(_args ${TEST_ARGS})
else()
  set(_args)
endif()

execute_process(
  COMMAND "${TEST_EXE}" ${_args}
  RESULT_VARIABLE _status
  OUTPUT_VARIABLE _stdout
  ERROR_VARIABLE _stderr
)

set(_output "${_stdout}${_stderr}")
message("${_output}")

if(_status EQUAL 0)
  message(FATAL_ERROR "Expected command to fail, but it exited with 0")
endif()

if(NOT _output MATCHES "${EXPECT_REGEX}")
  message(FATAL_ERROR "Expected output to match: ${EXPECT_REGEX}")
endif()
