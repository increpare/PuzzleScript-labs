#include "frontend_flow.h"

#include <stdio.h>

static int require_true(bool condition, const char* message) {
    if (condition) return 0;
    fprintf(stderr, "gbc_frontend_flow: %s\n", message);
    return 1;
}

int main(void) {
    ps_gbc_frontend frontend;
    ps_gbc_frontend_action action;
    bool clear_save;
    uint8_t frame;
    int failed = 0;

    ps_gbc_frontend_init(&frontend, false, 0U);
    failed |= require_true(
        frontend.mode == PS_GBC_FRONTEND_TITLE
            && !frontend.has_save
            && ps_gbc_frontend_start_game(&frontend, &clear_save) == 0U
            && !clear_save
            && frontend.mode == PS_GBC_FRONTEND_PLAYING,
        "a fresh title did not start level zero");

    ps_gbc_frontend_init(&frontend, true, 4U);
    failed |= require_true(
        frontend.has_save && frontend.continue_selected,
        "a valid save did not offer Continue by default");
    failed |= require_true(
        ps_gbc_frontend_start_game(&frontend, &clear_save) == 4U
            && !clear_save,
        "Continue did not resume the saved level");

    ps_gbc_frontend_init(&frontend, true, 4U);
    ps_gbc_frontend_select_new_game(&frontend);
    failed |= require_true(
        ps_gbc_frontend_start_game(&frontend, &clear_save) == 0U
            && clear_save
            && !frontend.has_save,
        "New Game did not start at zero and clear progress");

    ps_gbc_frontend_init(&frontend, true, 0U);
    failed |= require_true(
        !frontend.has_save && !frontend.continue_selected,
        "a level-zero record incorrectly enabled Continue");

    ps_gbc_frontend_init(&frontend, false, 0U);
    (void)ps_gbc_frontend_start_game(&frontend, &clear_save);
    ps_gbc_frontend_record_progress(&frontend, 2U);
    ps_gbc_frontend_open_title(&frontend);
    failed |= require_true(
        frontend.mode == PS_GBC_FRONTEND_TITLE
            && frontend.has_save
            && frontend.continue_selected
            && frontend.saved_level == 2U,
        "returning to the title did not retain Continue progress");

    (void)ps_gbc_frontend_start_game(&frontend, &clear_save);
    ps_gbc_frontend_begin_win(&frontend, false);
    for (frame = 1U; frame < PS_GBC_WIN_PAUSE_FRAMES; ++frame) {
        action = ps_gbc_frontend_tick(&frontend);
        failed |= require_true(
            action == PS_GBC_FRONTEND_ACTION_NONE
                && frontend.mode == PS_GBC_FRONTEND_WIN_PAUSE,
            "an ordinary win advanced before the 30-frame pause elapsed");
    }
    action = ps_gbc_frontend_tick(&frontend);
    failed |= require_true(
        action == PS_GBC_FRONTEND_ACTION_SHOW_NEXT_LEVEL
            && frontend.mode == PS_GBC_FRONTEND_PLAYING,
        "an ordinary win did not advance after the 30-frame pause");

    ps_gbc_frontend_begin_win(&frontend, true);
    for (frame = 0U; frame < PS_GBC_WIN_PAUSE_FRAMES; ++frame) {
        action = ps_gbc_frontend_tick(&frontend);
    }
    failed |= require_true(
        action == PS_GBC_FRONTEND_ACTION_END_GAME
            && frontend.mode == PS_GBC_FRONTEND_TITLE
            && !frontend.has_save,
        "a final win did not clear progress and return to the title");
    failed |= require_true(
        ps_gbc_frontend_start_game(&frontend, &clear_save) == 0U
            && frontend.mode == PS_GBC_FRONTEND_PLAYING,
        "starting after game completion did not reset to level zero");

    return failed;
}
