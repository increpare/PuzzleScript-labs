#ifndef PUZZLESCRIPT_COMPILER_H
#define PUZZLESCRIPT_COMPILER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ps_game ps_game;
typedef struct ps_error ps_error;
typedef struct ps_compile_result ps_compile_result;
typedef struct ps_compiler_result ps_compiler_result;

typedef enum ps_diagnostic_severity {
    PS_DIAG_ERROR = 0,
    PS_DIAG_WARNING = 1,
    PS_DIAG_INFO = 2,
    PS_DIAG_LOG = 3
} ps_diagnostic_severity;

typedef struct ps_diagnostic {
    ps_diagnostic_severity severity;
    int32_t code;
    int32_t line;
    const char* message;
} ps_diagnostic;

ps_compiler_result* ps_compiler_parse_source(const char* source_utf8, size_t source_size);
ps_compiler_result* ps_compiler_compile_source_diagnostics(const char* source_utf8, size_t source_size);
size_t ps_compiler_result_diagnostic_count(const ps_compiler_result* result);
const ps_diagnostic* ps_compiler_result_diagnostic(const ps_compiler_result* result, size_t index);
size_t ps_compiler_result_parser_state_json(
    const ps_compiler_result* result,
    char* out_buffer,
    size_t out_buffer_capacity
);
void ps_compiler_result_free(ps_compiler_result* result);

bool ps_compile_source(const char* source_utf8, size_t source_size, ps_compile_result** out_result);
const ps_game* ps_compile_result_game(const ps_compile_result* result);
const ps_error* ps_compile_result_error(const ps_compile_result* result);
void ps_free_compile_result(ps_compile_result* result);

#ifdef __cplusplus
}
#endif

#endif
