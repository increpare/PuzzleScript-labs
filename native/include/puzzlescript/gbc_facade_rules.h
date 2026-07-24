#pragma once

#include "puzzlescript/gbc.h"

#include <stdbool.h>
#include <stdint.h>

typedef struct ps_gbc_commands ps_gbc_commands;

#ifdef __cplusplus
extern "C" {
#endif

bool ps_gbc_facade_apply_groups(
    ps_gbc_session* session,
    const ps_gbc_rule_group* groups,
    uint16_t group_count,
    uint8_t input_direction,
    ps_gbc_commands* commands);

#ifdef __cplusplus
}
#endif
