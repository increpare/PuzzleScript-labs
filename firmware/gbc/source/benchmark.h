#ifndef PUZZLESCRIPT_GBC_BENCHMARK_H
#define PUZZLESCRIPT_GBC_BENCHMARK_H

#include <gb/gb.h>

#include "puzzlescript/gbc.h"

extern uint8_t gTileBytes[16];
extern uint8_t gTileMap[PS_GBC_VIEWPORT_WIDTH * PS_GBC_VIEWPORT_HEIGHT];
extern uint8_t gAttributes[PS_GBC_VIEWPORT_WIDTH * PS_GBC_VIEWPORT_HEIGHT];
extern ps_gbc_session* gSession;

void perfTimerStart(void);
uint32_t perfTimerStop(void);
uint8_t composeTile(uint32_t objects);
void renderBoard(void);
void showText(const char* message, bool title);

bool perfLoadFirstBoard(void) BANKED;
uint32_t perfMeasureRender(void) BANKED;
uint32_t perfMeasureComposition(void) BANKED;
uint32_t perfMeasureTileUpload(void) BANKED;
uint32_t perfMeasureMapUpload(void) BANKED;
uint32_t perfMeasurePaletteUpload(void) BANKED;
uint32_t perfMeasureRepeatedText(void) BANKED;

#endif
