#ifndef PUZZLESCRIPT_GBC_TEXT_H
#define PUZZLESCRIPT_GBC_TEXT_H

#include <gb/gb.h>

#include <stdbool.h>
#include <stdint.h>

#define VRAM_STATE_UNKNOWN 0U
#define VRAM_STATE_TEXT 1U
#define VRAM_STATE_BOARD 2U
#define TEXT_TILE_COUNT 47U

extern uint16_t gRenderedLevel;
extern uint8_t gVramState;

void displayOffForFullRewrite(void) NONBANKED;
void showText(const char* message, bool title) BANKED;
void showGameText(const char* game_message) BANKED;
void showGameTitleText(void) BANKED;
void showTitleMenu(bool has_continue, bool continue_selected) BANKED;
void updateTitleMenuSelection(bool continue_selected) BANKED;
#if defined(PS_GBC_CART_BUILD)
void showCartLauncher(uint8_t selected, uint8_t first_visible) BANKED;
void updateCartLauncherSelection(
    uint8_t old_selected,
    uint8_t selected,
    uint8_t first_visible) BANKED;
void updateCartLauncherPage(
    uint8_t selected,
    uint8_t first_visible) BANKED;
#endif

#endif
