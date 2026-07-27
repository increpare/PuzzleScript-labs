#ifndef PUZZLESCRIPT_GBC_GAME_DISPATCH_H
#define PUZZLESCRIPT_GBC_GAME_DISPATCH_H

#include <gb/gb.h>

#include "puzzlescript/gbc_descriptor.h"

bool ps_gbc_activate_game(
    uint8_t descriptor_bank,
    const ps_gbc_game_descriptor* descriptor) NONBANKED;
void ps_gbc_deactivate_game(void) NONBANKED;
const ps_gbc_game_descriptor* ps_gbc_active_descriptor(void) NONBANKED;
const ps_gbc_game_view* ps_gbc_active_game_view(void) NONBANKED;
bool ps_gbc_active_rom_copy(
    const void* source,
    void* destination,
    uint16_t byte_count) NONBANKED;
bool ps_gbc_rom_copy(
    uint8_t source_bank,
    const void* source,
    void* destination,
    uint16_t byte_count) NONBANKED;
bool ps_gbc_active_rom_copy_string(
    const char* source,
    char* destination,
    uint16_t capacity) NONBANKED;

ps_gbc_session* psd_session_init(
    void* arena,
    size_t bytes,
    const ps_gbc_snapshot_io* snapshots) NONBANKED;
bool psd_load_level(
    ps_gbc_session* session,
    uint16_t level) NONBANKED;
ps_step_result psd_step(
    ps_gbc_session* session,
    ps_input input) NONBANKED;
void psd_defer_wins(
    ps_gbc_session* session,
    bool defer) NONBANKED;
bool psd_advance_level(ps_gbc_session* session) NONBANKED;
bool psd_undo(ps_gbc_session* session) NONBANKED;
bool psd_restart(ps_gbc_session* session) NONBANKED;
void psd_status_get(
    const ps_gbc_session* session,
    ps_gbc_status* status) NONBANKED;
uint32_t psd_cell_objects(
    const ps_gbc_session* session,
    int16_t x,
    int16_t y) NONBANKED;
const uint8_t* psd_dirty_cells(
    const ps_gbc_session* session) NONBANKED;
bool psd_has_dirty_cells(
    const ps_gbc_session* session) NONBANKED;
void psd_clear_dirty_cells(ps_gbc_session* session) NONBANKED;
bool psd_first_player_position(
    const ps_gbc_session* session,
    int16_t* x,
    int16_t* y) NONBANKED;
const void* psd_board(const ps_gbc_session* session) NONBANKED;

#endif
