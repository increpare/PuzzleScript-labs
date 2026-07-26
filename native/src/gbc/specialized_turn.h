#pragma once

#include "session_internal.h"

#include <stdbool.h>
#include <stdint.h>

#if defined(PS_GBC_FREESTANDING)
#include <gb/gb.h>
#define PS_GBC_SPECIALIZED_TURN_BANKED BANKED
#define PS_GBC_CORE_RUNTIME_NONBANKED BANKED
#else
#define PS_GBC_SPECIALIZED_TURN_BANKED
#define PS_GBC_CORE_RUNTIME_NONBANKED
#endif

#if !defined(PS_GBC_HAS_SPECIALIZED_TURN)
bool ps_gbc_apply_turn_phases(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);

bool ps_gbc_apply_early_rule_groups(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);

bool ps_gbc_apply_late_rule_groups(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);

bool ps_gbc_apply_rules_and_movement(
    ps_gbc_session* session,
    uint8_t direction,
    ps_gbc_commands* commands);
#endif

bool ps_gbc_resolve_movements(ps_gbc_session* session) PS_GBC_CORE_RUNTIME_NONBANKED;

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
    bool* out_changed) PS_GBC_SPECIALIZED_TURN_BANKED;

#if defined(PS_GBC_GENERATED_SPECIALIZED_WON) && PS_GBC_GENERATED_SPECIALIZED_WON \
    && defined(PS_GBC_HAS_SPECIALIZED_TURN) && PS_GBC_HAS_SPECIALIZED_TURN
bool ps_gbc_specialized_won(const ps_gbc_session* session) PS_GBC_SPECIALIZED_TURN_BANKED;
#endif
