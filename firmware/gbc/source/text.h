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

#endif
