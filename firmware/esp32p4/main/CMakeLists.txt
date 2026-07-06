idf_component_register(
  SRCS
    "main.cpp"
    "ps_instrumentation.cpp"
  INCLUDE_DIRS
    "."
)

target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_17)
target_compile_options(${COMPONENT_LIB} PRIVATE
  -Wall
  -Wextra
  -Wno-missing-field-initializers
)
