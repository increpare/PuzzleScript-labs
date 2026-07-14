#pragma once

#include <cstdint>

struct ps_gba_perf_snapshot {
    uint64_t setup_cycles = 0;
    uint64_t early_rules_cycles = 0;
    uint64_t movement_cycles = 0;
    uint64_t late_rules_cycles = 0;
    uint64_t win_cycles = 0;
    uint64_t canonicalize_cycles = 0;
    uint32_t allocation_calls = 0;
    uint32_t allocation_bytes = 0;
    uint32_t deallocation_calls = 0;
    uint32_t heap_growth_bytes = 0;
    uint32_t rules_visited = 0;
    uint32_t candidate_cells_tested = 0;
    uint32_t replacements_attempted = 0;
    uint32_t replacements_applied = 0;
    uint32_t row_scans = 0;
    uint32_t ellipsis_scans = 0;
    uint32_t progress_stage = 0;
    uint32_t progress_detail = 0;
};

extern "C" void ps_gba_perf_begin();
extern "C" void ps_gba_perf_end(ps_gba_perf_snapshot* snapshot);
extern "C" void ps_gba_perf_progress(uint32_t stage, uint32_t detail);
extern "C" void ps_gba_perf_vblank();
