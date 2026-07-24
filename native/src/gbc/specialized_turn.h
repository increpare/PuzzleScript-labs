#pragma once

#include "session_internal.h"

#include <stdbool.h>
#include <stdint.h>

bool ps_gbc_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);

bool ps_gbc_apply_early_rule_groups(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);

bool ps_gbc_resolve_movements(ps_gbc_session* session);

bool ps_gbc_apply_late_rule_groups(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);

bool ps_gbc_apply_rules_and_movement(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);

/*
 * Specialized turn hook. ps_gbc_step always calls this before falling back.
 *
 * Return true  => the specialized path handled the turn; *out_changed is valid.
 * Return false => not handled; the caller must run ps_gbc_apply_turn_phases.
 *
 * When linking generated_specialized_turn.c, compile core.c with
 * -DPS_GBC_HAS_SPECIALIZED_TURN=1 so the default weak stub is omitted and
 * duplicate-symbol errors are avoided.
 */
bool ps_gbc_specialized_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands,
    bool* out_changed);
