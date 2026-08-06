#pragma bank 0

#include "game_dispatch.h"

#include "puzzlescript/gbc_bank_access.h"

static ps_gbc_game_descriptor gActiveDescriptor;
static ps_gbc_game_view gActiveGameView;
static bool gHasActiveGame;
static uint8_t gActiveAssetBank;

ps_gbc_level_cells_read_fn ps_gbc_level_cells_read = NULL;

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

static bool activeAssetLevelCellsRead(
    const void* source,
    void* destination,
    uint16_t byte_count
) NONBANKED {
    if (gActiveAssetBank == 0U) return false;
    return ps_gbc_bank_copy(
        &kMbc5Access,
        gActiveAssetBank,
        source,
        destination,
        byte_count);
}

bool ps_gbc_activate_game(
    uint8_t descriptor_bank,
    const ps_gbc_game_descriptor* descriptor,
    uint8_t asset_bank
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
    gActiveAssetBank = asset_bank;
    ps_gbc_level_cells_read =
        (asset_bank != 0U) ? activeAssetLevelCellsRead : NULL;
    gHasActiveGame = true;
    return true;
}

void ps_gbc_deactivate_game(void) NONBANKED {
    gHasActiveGame = false;
    gActiveAssetBank = 0U;
    ps_gbc_level_cells_read = NULL;
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

bool ps_gbc_rom_vram_dma(
    uint8_t source_bank,
    const void* source,
    uint16_t destination,
    uint8_t block_count,
    uint8_t vram_bank
) NONBANKED {
    const uint16_t source_address = (uint16_t)source;
    const uint16_t byte_count = (uint16_t)block_count << 4U;
    const uint8_t previous_bank = CURRENT_BANK;
    if (source_bank == 0U
        || source_address < 0x4000U
        || (source_address & 0x000fU) != 0U
        || source_address + byte_count > 0x8000U
        || destination < 0x8000U
        || (destination & 0x000fU) != 0U
        || destination + byte_count > 0xa000U
        || block_count == 0U
        || block_count > 128U
        || vram_bank > 1U) {
        return false;
    }
    SWITCH_ROM_MBC5(source_bank);
    VBK_REG = vram_bank;
    HDMA1_REG = (uint8_t)(source_address >> 8U);
    HDMA2_REG = (uint8_t)source_address & 0xf0U;
    HDMA3_REG = (uint8_t)(destination >> 8U) & 0x1fU;
    HDMA4_REG = (uint8_t)destination & 0xf0U;
    HDMA5_REG = (uint8_t)(block_count - 1U);
    while (HDMA5_REG != 0xffU) {
    }
    SWITCH_ROM_MBC5(previous_bank);
    return true;
}

static uint8_t vramDmaHBlank(
    uint8_t source_bank,
    const void* source,
    uint16_t destination,
    uint8_t block_count,
    uint8_t vram_bank,
    bool banked_source
) NONBANKED {
    uint16_t source_address = (uint16_t)source;
    uint16_t target = destination;
    const uint16_t byte_count = (uint16_t)block_count << 4U;
    const uint8_t previous_bank = CURRENT_BANK;
    uint8_t transferred = 0U;
    if ((source_address & 0x000fU) != 0U
        || (banked_source
            ? (source_bank == 0U
                || source_address < 0x4000U
                || source_address + byte_count > 0x8000U)
            : (source_address < 0xc000U
                || source_address + byte_count > 0xe000U))
        || destination < 0x8000U
        || (destination & 0x000fU) != 0U
        || destination + byte_count > 0xa000U
        || block_count == 0U
        || block_count > 128U
        || vram_bank > 1U) {
        return 0U;
    }
    CRITICAL {
        if (banked_source) SWITCH_ROM_MBC5(source_bank);
        VBK_REG = vram_bank;
        /*
         * A page refresh normally enters during VBlank. Wait through that
         * initial VBlank once, but never wait through a later VBlank: the
         * caller must finish the remaining tail there.
         */
        while (LY_REG >= 144U) {
        }
        while (transferred < block_count) {
            const uint8_t remaining =
                (uint8_t)(block_count - transferred);
            /*
             * Starting at fresh Mode 0 leaves at least Mode 0 + Mode 2
             * (165 dots) before VRAM closes. Four GDMA blocks consume
             * 128 dots; the registers are programmed before the wait and
             * interrupts remain disabled across the burst.
             */
            const uint8_t blocks =
                remaining < 4U ? remaining : 4U;
            HDMA1_REG = (uint8_t)(source_address >> 8U);
            HDMA2_REG = (uint8_t)source_address & 0xf0U;
            HDMA3_REG = (uint8_t)(target >> 8U) & 0x1fU;
            HDMA4_REG = (uint8_t)target & 0xf0U;
            if (LY_REG >= 144U) break;
            while (LY_REG < 144U
                && (STAT_REG & 0x03U) == 0U) {
            }
            while (LY_REG < 144U
                && (STAT_REG & 0x03U) != 0U) {
            }
            if (LY_REG >= 144U) break;
            HDMA5_REG = (uint8_t)(blocks - 1U);
            while (HDMA5_REG != 0xffU) {
            }
            transferred = (uint8_t)(transferred + blocks);
            source_address += (uint8_t)(blocks << 4U);
            target += (uint8_t)(blocks << 4U);
        }
        if (banked_source) SWITCH_ROM_MBC5(previous_bank);
    }
    return transferred;
}

uint8_t ps_gbc_rom_vram_dma_hblank(
    uint8_t source_bank,
    const void* source,
    uint16_t destination,
    uint8_t block_count,
    uint8_t vram_bank
) NONBANKED {
    return vramDmaHBlank(
        source_bank,
        source,
        destination,
        block_count,
        vram_bank,
        true);
}

uint8_t ps_gbc_wram_vram_dma_hblank(
    const void* source,
    uint16_t destination,
    uint8_t block_count,
    uint8_t vram_bank
) NONBANKED {
    return vramDmaHBlank(
        0U,
        source,
        destination,
        block_count,
        vram_bank,
        false);
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
