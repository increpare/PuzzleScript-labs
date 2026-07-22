#ifndef PUZZLESCRIPT_GBC_FRONTEND_FLOW_H
#define PUZZLESCRIPT_GBC_FRONTEND_FLOW_H

#include <stdbool.h>
#include <stdint.h>

#if defined(PS_GBC_FREESTANDING)
#include <gb/gb.h>
#define PS_GBC_FRONTEND_BANKED BANKED
#else
#define PS_GBC_FRONTEND_BANKED
#endif

#define PS_GBC_WIN_PAUSE_FRAMES 30U

typedef enum ps_gbc_frontend_mode {
    PS_GBC_FRONTEND_TITLE = 0,
    PS_GBC_FRONTEND_PLAYING = 1,
    PS_GBC_FRONTEND_WIN_PAUSE = 2
} ps_gbc_frontend_mode;

typedef enum ps_gbc_frontend_action {
    PS_GBC_FRONTEND_ACTION_NONE = 0,
    PS_GBC_FRONTEND_ACTION_SHOW_NEXT_LEVEL = 1,
    PS_GBC_FRONTEND_ACTION_END_GAME = 2
} ps_gbc_frontend_action;

typedef struct ps_gbc_frontend {
    ps_gbc_frontend_mode mode;
    uint16_t saved_level;
    uint8_t win_frames_remaining;
    bool has_save;
    bool continue_selected;
    bool final_win;
} ps_gbc_frontend;

void ps_gbc_frontend_init(
    ps_gbc_frontend* frontend,
    bool save_valid,
    uint16_t saved_level) PS_GBC_FRONTEND_BANKED;
void ps_gbc_frontend_select_new_game(
    ps_gbc_frontend* frontend) PS_GBC_FRONTEND_BANKED;
void ps_gbc_frontend_select_continue(
    ps_gbc_frontend* frontend) PS_GBC_FRONTEND_BANKED;
uint16_t ps_gbc_frontend_start_game(
    ps_gbc_frontend* frontend,
    bool* clear_save) PS_GBC_FRONTEND_BANKED;
void ps_gbc_frontend_record_progress(
    ps_gbc_frontend* frontend,
    uint16_t level) PS_GBC_FRONTEND_BANKED;
void ps_gbc_frontend_open_title(
    ps_gbc_frontend* frontend) PS_GBC_FRONTEND_BANKED;
void ps_gbc_frontend_begin_win(
    ps_gbc_frontend* frontend,
    bool final_win) PS_GBC_FRONTEND_BANKED;
ps_gbc_frontend_action ps_gbc_frontend_tick(
    ps_gbc_frontend* frontend) PS_GBC_FRONTEND_BANKED;

#endif
