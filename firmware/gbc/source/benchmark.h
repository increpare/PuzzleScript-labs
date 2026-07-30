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
#if defined(PS_GBC_PERF_BENCH)
extern uint32_t gPerfRenderPhaseTicks[PS_GBC_PERF_RENDER_PHASE_COUNT];
extern uint16_t gPerfRenderCounts[PS_GBC_PERF_RENDER_COUNTER_COUNT];
extern bool gPerfRenderEnabled;
#endif

#define CART_BENCH_MAGIC 0x42424350UL
#define CART_BENCH_VERSION 1U
#define CART_BENCH_SRAM_BANK 3U
#define CART_BENCH_SRAM_OFFSET 512U
#define CART_BENCH_RECORD_BYTES 32U

#if defined(PS_GBC_PERF_BENCH)
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
#endif

void perfTimerInitialize(void);
void perfTimerStart(void);
uint32_t perfTimerStop(void);
void perfTimerShutdown(void);
void renderBoard(void);
#if defined(PS_GBC_PERF_BENCH)
uint16_t composeTile(uint32_t objects);

bool perfLoadFirstBoard(void) BANKED;
uint32_t perfMeasureRender(void) BANKED;
uint32_t perfMeasureComposition(void) BANKED;
uint32_t perfMeasureTileUpload(void) BANKED;
uint32_t perfMeasureMapUpload(void) BANKED;
uint32_t perfMeasurePaletteUpload(void) BANKED;
uint32_t perfMeasureRepeatedText(void) BANKED;
void perfMeasureInteraction(perf_interaction* result) BANKED;
#endif

#if defined(PS_GBC_CART_BENCHMARK)
bool cartBenchLoadFirstBoard(void) BANKED;
void cartBenchInitialize(uint16_t game_index) BANKED;
void cartBenchBeginUserTurn(void) BANKED;
bool cartBenchHasActiveTurn(void) BANKED;
void cartBenchAccumulateLogic(uint32_t ticks) BANKED;
void cartBenchRender(void) BANKED;
void cartBenchFinish(bool won) BANKED;
void cartBenchShutdown(void) BANKED;
#endif

#endif
