#pragma once

#include "session_internal.h"

#include <stdbool.h>
#include <stdint.h>

bool ps_gbc_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);

bool ps_gbc_specialized_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands,
    bool* out_changed);
