#include "frontend_flow.h"

#if defined(PS_GBC_FREESTANDING)
#pragma bank 1
#endif

void ps_gbc_frontend_init(
    ps_gbc_frontend* frontend,
    bool save_valid,
    uint16_t saved_level
) PS_GBC_FRONTEND_BANKED {
    frontend->mode = PS_GBC_FRONTEND_TITLE;
    frontend->has_save = save_valid && saved_level != 0U;
    frontend->saved_level = frontend->has_save ? saved_level : 0U;
    frontend->continue_selected = frontend->has_save;
    frontend->win_frames_remaining = 0U;
    frontend->final_win = false;
}

void ps_gbc_frontend_select_new_game(
    ps_gbc_frontend* frontend
) PS_GBC_FRONTEND_BANKED {
    if (frontend->mode == PS_GBC_FRONTEND_TITLE && frontend->has_save) {
        frontend->continue_selected = false;
    }
}

void ps_gbc_frontend_select_continue(
    ps_gbc_frontend* frontend
) PS_GBC_FRONTEND_BANKED {
    if (frontend->mode == PS_GBC_FRONTEND_TITLE && frontend->has_save) {
        frontend->continue_selected = true;
    }
}

uint16_t ps_gbc_frontend_start_game(
    ps_gbc_frontend* frontend,
    bool* clear_save
) PS_GBC_FRONTEND_BANKED {
    const bool resume = frontend->has_save && frontend->continue_selected;
    const uint16_t level = resume ? frontend->saved_level : 0U;
    *clear_save = frontend->has_save && !resume;
    if (*clear_save) {
        frontend->has_save = false;
        frontend->saved_level = 0U;
        frontend->continue_selected = false;
    }
    frontend->mode = PS_GBC_FRONTEND_PLAYING;
    return level;
}

void ps_gbc_frontend_record_progress(
    ps_gbc_frontend* frontend,
    uint16_t level
) PS_GBC_FRONTEND_BANKED {
    frontend->has_save = level != 0U;
    frontend->saved_level = frontend->has_save ? level : 0U;
}

void ps_gbc_frontend_open_title(
    ps_gbc_frontend* frontend
) PS_GBC_FRONTEND_BANKED {
    frontend->mode = PS_GBC_FRONTEND_TITLE;
    frontend->continue_selected = frontend->has_save;
    frontend->win_frames_remaining = 0U;
    frontend->final_win = false;
}

void ps_gbc_frontend_begin_win(
    ps_gbc_frontend* frontend,
    bool final_win
) PS_GBC_FRONTEND_BANKED {
    frontend->mode = PS_GBC_FRONTEND_WIN_PAUSE;
    frontend->win_frames_remaining = PS_GBC_WIN_PAUSE_FRAMES;
    frontend->final_win = final_win;
}

ps_gbc_frontend_action ps_gbc_frontend_tick(
    ps_gbc_frontend* frontend
) PS_GBC_FRONTEND_BANKED {
    if (frontend->mode != PS_GBC_FRONTEND_WIN_PAUSE) {
        return PS_GBC_FRONTEND_ACTION_NONE;
    }
    if (frontend->win_frames_remaining != 0U) {
        --frontend->win_frames_remaining;
    }
    if (frontend->win_frames_remaining != 0U) {
        return PS_GBC_FRONTEND_ACTION_NONE;
    }
    if (frontend->final_win) {
        frontend->mode = PS_GBC_FRONTEND_TITLE;
        frontend->has_save = false;
        frontend->saved_level = 0U;
        frontend->continue_selected = false;
        frontend->final_win = false;
        return PS_GBC_FRONTEND_ACTION_END_GAME;
    }
    frontend->mode = PS_GBC_FRONTEND_PLAYING;
    return PS_GBC_FRONTEND_ACTION_SHOW_NEXT_LEVEL;
}
