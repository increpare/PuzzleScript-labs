#ifndef PUZZLESCRIPT_GBC_BENCHMARK_H
#define PUZZLESCRIPT_GBC_BENCHMARK_H

#include <gb/gb.h>

#include "puzzlescript/gbc.h"
#include "text.h"

extern uint8_t gTileBytes[64];
extern uint8_t gTileMap[
    PS_GBC_SCREEN_TILE_WIDTH * PS_GBC_SCREEN_TILE_HEIGHT];
extern uint8_t gAttributes[
    PS_GBC_SCREEN_TILE_WIDTH * PS_GBC_SCREEN_TILE_HEIGHT];
extern ps_gbc_session* gSession;
extern uint32_t gPerfRenderPhaseTicks[PS_GBC_PERF_RENDER_PHASE_COUNT];
extern uint16_t gPerfRenderCounts[PS_GBC_PERF_RENDER_COUNTER_COUNT];
extern bool gPerfRenderEnabled;

typedef struct perf_render_sample {
    uint32_t phase_ticks[PS_GBC_PERF_RENDER_PHASE_COUNT];
    uint16_t counts[PS_GBC_PERF_RENDER_COUNTER_COUNT];
} perf_render_sample;

typedef struct perf_interaction {
    uint32_t initial_render_ticks;
    uint32_t walk_logic_ticks;
    uint32_t walk_render_ticks;
    uint32_t push_logic_ticks;
    uint32_t push_render_ticks;
    perf_render_sample initial_render;
    perf_render_sample walk_render;
    perf_render_sample push_render;
} perf_interaction;

void perfTimerStart(void);
uint32_t perfTimerStop(void);
uint16_t composeTile(uint32_t objects);
void renderBoard(void);

bool perfLoadFirstBoard(void) BANKED;
uint32_t perfMeasureRender(void) BANKED;
uint32_t perfMeasureComposition(void) BANKED;
uint32_t perfMeasureTileUpload(void) BANKED;
uint32_t perfMeasureMapUpload(void) BANKED;
uint32_t perfMeasurePaletteUpload(void) BANKED;
uint32_t perfMeasureRepeatedText(void) BANKED;
void perfMeasureInteraction(perf_interaction* result) BANKED;

#endif
