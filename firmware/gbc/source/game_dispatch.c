#pragma bank 0

#include "game_dispatch.h"

#include "puzzlescript/gbc_bank_access.h"

static ps_gbc_game_descriptor gActiveDescriptor;
static ps_gbc_game_view gActiveGameView;
static bool gHasActiveGame;

static uint8_t mbc5CurrentBank(void* context) NONBANKED {
    (void)context;
    return CURRENT_BANK;
}

static void mbc5SwitchBank(void* context, uint8_t bank) NONBANKED {
    (void)context;
    SWITCH_ROM_MBC5(bank);
}

static const ps_gbc_bank_access kMbc5Access = {
    NULL,
    mbc5CurrentBank,
    mbc5SwitchBank
};

bool ps_gbc_activate_game(
    uint8_t descriptor_bank,
    const ps_gbc_game_descriptor* descriptor
) NONBANKED {
    ps_gbc_game_descriptor descriptor_copy;
    ps_gbc_game_view game_view_copy;
    if (!ps_gbc_bank_copy(
            &kMbc5Access,
            descriptor_bank,
            descriptor,
            &descriptor_copy,
            sizeof(descriptor_copy))) {
        return false;
    }
    if (!ps_gbc_bank_copy(
            &kMbc5Access,
            descriptor_copy.game_bank,
            descriptor_copy.game,
            &game_view_copy,
            sizeof(game_view_copy))) {
        return false;
    }
    gActiveDescriptor = descriptor_copy;
    gActiveGameView = game_view_copy;
    gHasActiveGame = true;
    return true;
}

void ps_gbc_deactivate_game(void) NONBANKED {
    gHasActiveGame = false;
}

const ps_gbc_game_descriptor* ps_gbc_active_descriptor(void) NONBANKED {
    return gHasActiveGame ? &gActiveDescriptor : NULL;
}

const ps_gbc_game_view* ps_gbc_active_game_view(void) NONBANKED {
    return gHasActiveGame ? &gActiveGameView : NULL;
}

bool ps_gbc_active_rom_copy(
    const void* source,
    void* destination,
    uint16_t byte_count
) NONBANKED {
    if (!gHasActiveGame) return false;
    return ps_gbc_bank_copy(
        &kMbc5Access,
        gActiveDescriptor.game_bank,
        source,
        destination,
        byte_count);
}

bool ps_gbc_active_rom_copy_string(
    const char* source,
    char* destination,
    uint16_t capacity
) NONBANKED {
    if (!gHasActiveGame) return false;
    return ps_gbc_bank_copy_string(
        &kMbc5Access,
        gActiveDescriptor.game_bank,
        source,
        destination,
        capacity);
}

#define PSD_ENTER() \
    const uint8_t previous_bank = CURRENT_BANK; \
    SWITCH_ROM_MBC5(gActiveDescriptor.game_bank)
#define PSD_LEAVE() SWITCH_ROM_MBC5(previous_bank)

ps_gbc_session* psd_session_init(
    void* arena,
    size_t bytes,
    const ps_gbc_snapshot_io* snapshots
) NONBANKED {
    ps_gbc_session* result;
    PSD_ENTER();
    result = gActiveDescriptor.session_init(
        arena, bytes, gActiveDescriptor.game, snapshots);
    PSD_LEAVE();
    return result;
}

bool psd_load_level(
    ps_gbc_session* session,
    uint16_t level
) NONBANKED {
    bool result;
    PSD_ENTER();
    result = gActiveDescriptor.load_level(session, level);
    PSD_LEAVE();
    return result;
}

ps_step_result psd_step(
    ps_gbc_session* session,
    ps_input input
) NONBANKED {
    ps_step_result result;
    PSD_ENTER();
    gActiveDescriptor.step(session, input, &result);
    PSD_LEAVE();
    return result;
}

void psd_defer_wins(
    ps_gbc_session* session,
    bool defer
) NONBANKED {
    PSD_ENTER();
    gActiveDescriptor.defer_wins(session, defer);
    PSD_LEAVE();
}

bool psd_advance_level(ps_gbc_session* session) NONBANKED {
    bool result;
    PSD_ENTER();
    result = gActiveDescriptor.advance_level(session);
    PSD_LEAVE();
    return result;
}

bool psd_undo(ps_gbc_session* session) NONBANKED {
    bool result;
    PSD_ENTER();
    result = gActiveDescriptor.undo(session);
    PSD_LEAVE();
    return result;
}

bool psd_restart(ps_gbc_session* session) NONBANKED {
    bool result;
    PSD_ENTER();
    result = gActiveDescriptor.restart(session);
    PSD_LEAVE();
    return result;
}

void psd_status_get(
    const ps_gbc_session* session,
    ps_gbc_status* status
) NONBANKED {
    PSD_ENTER();
    gActiveDescriptor.status_get(session, status);
    PSD_LEAVE();
}

uint32_t psd_cell_objects(
    const ps_gbc_session* session,
    int16_t x,
    int16_t y
) NONBANKED {
    uint32_t result;
    PSD_ENTER();
    result = gActiveDescriptor.cell_objects(session, x, y);
    PSD_LEAVE();
    return result;
}

const uint8_t* psd_dirty_cells(
    const ps_gbc_session* session
) NONBANKED {
    const uint8_t* result;
    PSD_ENTER();
    result = gActiveDescriptor.dirty_cells(session);
    PSD_LEAVE();
    return result;
}

bool psd_has_dirty_cells(
    const ps_gbc_session* session
) NONBANKED {
    bool result;
    PSD_ENTER();
    result = gActiveDescriptor.has_dirty_cells(session);
    PSD_LEAVE();
    return result;
}

void psd_clear_dirty_cells(ps_gbc_session* session) NONBANKED {
    PSD_ENTER();
    gActiveDescriptor.clear_dirty_cells(session);
    PSD_LEAVE();
}

bool psd_first_player_position(
    const ps_gbc_session* session,
    int16_t* x,
    int16_t* y
) NONBANKED {
    bool result;
    PSD_ENTER();
    result = gActiveDescriptor.first_player_position(session, x, y);
    PSD_LEAVE();
    return result;
}

const void* psd_board(const ps_gbc_session* session) NONBANKED {
    const void* result;
    PSD_ENTER();
    result = gActiveDescriptor.board(session);
    PSD_LEAVE();
    return result;
}

#undef PSD_ENTER
#undef PSD_LEAVE
