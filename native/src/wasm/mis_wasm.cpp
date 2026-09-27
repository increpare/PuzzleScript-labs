// WebAssembly entry points for the PuzzleScript+MIS web prototype.
//
// Exposes the native compiler, solver, shared MIS difficulty assessment and
// level simplifier to JavaScript through a small C ABI. Boards cross the
// boundary in the solver's layer-cell layout (layer-major, then row-major,
// -1 for an empty layer cell); the page converts to and from engine bitsets.
//
// Single game at a time, single-threaded: each Web Worker instantiates its own
// module. Results are kept in module-level buffers read back through getters,
// so JavaScript never has to free anything.

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"
#include "runtime/c_api_internal.hpp"
#include "search/difficulty.hpp"
#include "search/simplify.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
// Also builds natively (native/wasm/mis_wasm_bench_native.cpp) to measure the wasm tax.
#define EMSCRIPTEN_KEEPALIVE
#endif

#include <chrono>
#include <exception>
#include <string>
#include <vector>

namespace {

ps_game* gGame = nullptr;
std::string gError;
std::vector<int32_t> gGrid;
std::string gObjectName;

struct LastResult {
    int32_t status = PS_SOLVE_STATUS_ERROR;
    double expanded = -1;
    double elapsedMs = 0;
    double primaryElapsedMs = 0;
    // Difficulty lanes (assess only).
    double portfolio = -1;
    double greedy = -1;
    double weightedAStar = -1;
    double bfs = -1;
    double difficulty = -1;
    int32_t supplementalRan = 0;
    std::vector<int32_t> solution;
    // Simplify only.
    int32_t optimalLength = -1;
    int32_t objectsRemoved = 0;
    int32_t complete = 0;
    std::vector<int32_t> grid;
} gLast;

void resetLast() { gLast = LastResult{}; }

bool haveGame() {
    if (gGame) return true;
    gError = "no game compiled";
    return false;
}

puzzlescript::LevelTemplate levelFromGrid(int32_t width, int32_t height, int32_t count) {
    std::vector<int32_t> grid(gGrid.begin(), gGrid.begin() + count);
    return puzzlescript::search::levelTemplateFromLayerCellObjectIds(*gGame->impl.information, width, height, grid);
}

} // namespace

extern "C" {

// Compile PuzzleScript source. Returns 1 on success; see misw_error() otherwise.
EMSCRIPTEN_KEEPALIVE int misw_compile(const char* source, int length) {
    gError.clear();
    if (gGame) {
        ps_free_game(gGame);
        gGame = nullptr;
    }
    ps_compile_result* result = nullptr;
    bool ok = false;
    try {
        ok = ps_compile_source(source, static_cast<size_t>(length), &result);
    } catch (const std::exception& e) {
        gError = std::string("compiler threw: ") + e.what();
        return 0;
    }
    if (!ok || !result) {
        const ps_error* err = result ? ps_compile_result_error(result) : nullptr;
        gError = err ? ps_error_message(err) : "compile failed";
        if (result) ps_free_compile_result(result);
        return 0;
    }
    gGame = const_cast<ps_game*>(ps_compile_result_game(result));
    ps_free_compile_result(result);
    if (!gGame) {
        gError = "compile produced no game";
        return 0;
    }
    return 1;
}

EMSCRIPTEN_KEEPALIVE const char* misw_error() { return gError.c_str(); }
EMSCRIPTEN_KEEPALIVE int misw_object_count() { return gGame ? ps_game_object_count(gGame) : 0; }
EMSCRIPTEN_KEEPALIVE int misw_layer_count() { return gGame ? ps_game_layer_count(gGame) : 0; }

EMSCRIPTEN_KEEPALIVE const char* misw_object_name(int id) {
    ps_object_info info{};
    gObjectName = (gGame && ps_game_object_info(gGame, id, &info) && info.name) ? info.name : "";
    return gObjectName.c_str();
}

EMSCRIPTEN_KEEPALIVE int misw_object_layer(int id) {
    ps_object_info info{};
    return (gGame && ps_game_object_info(gGame, id, &info)) ? info.layer : -1;
}

// Scratch buffer JavaScript fills with a layer-cell grid before a call.
EMSCRIPTEN_KEEPALIVE int32_t* misw_grid_buffer(int count) {
    gGrid.assign(static_cast<size_t>(count), -1);
    return gGrid.data();
}

// One solver run. strategy: ps_solve_strategy. Returns ps_solve_status.
EMSCRIPTEN_KEEPALIVE int misw_solve(int width, int height, int count, int strategy, double timeoutMs, double maxExpanded) {
    resetLast();
    if (!haveGame()) return PS_SOLVE_STATUS_ERROR;
    ps_solve_options options = ps_solve_default_options();
    options.strategy = static_cast<ps_solve_strategy>(strategy);
    options.timeout_ms = static_cast<int64_t>(timeoutMs);
    options.portfolio_jobs = 1;
    options.max_expanded = maxExpanded > 0 ? static_cast<uint64_t>(maxExpanded) : 0;
    // Standalone strategies otherwise keep a full runtime state per node
    // (~10 KB on a 7x9 board), exhausting wasm32's heap after ~200k states.
    options.compact_node_storage = true;
    ps_solve_result* result = nullptr;
    ps_error* error = nullptr;
    try {
        if (!ps_solve_level_layer_cell_object_ids(gGame, width, height, gGrid.data(), static_cast<size_t>(count), &options, &result, &error)) {
            gError = error ? ps_error_message(error) : "solve failed";
            if (error) ps_free_error(error);
            if (result) ps_solve_result_free(result);
            return PS_SOLVE_STATUS_ERROR;
        }
    } catch (const std::exception& e) {
        gError = std::string("solver threw: ") + e.what();
        return PS_SOLVE_STATUS_ERROR;
    } catch (...) {
        gError = "solver threw an unknown exception";
        return PS_SOLVE_STATUS_ERROR;
    }
    gLast.status = result->status;
    gLast.expanded = static_cast<double>(result->expanded);
    gLast.elapsedMs = static_cast<double>(result->elapsed_ms);
    gLast.solution.assign(result->solution, result->solution + result->solution_count);
    ps_solve_result_free(result);
    return gLast.status;
}

// Shared MIS difficulty (native/src/search/difficulty.cpp): portfolio primary,
// then capped greedy / weighted A* / BFS lanes when runSupplemental is set.
// gateMinExpanded >= 0: run the refinement lanes only when the primary spent
// at least that many states (the primary count bounds the final min from
// above, so a candidate below the shortlist's floor can't reach it). This is
// the MIS generator's lazy gate and avoids re-running the primary to refine.
EMSCRIPTEN_KEEPALIVE int misw_assess(int width, int height, int count, double primaryTimeoutMs, int runSupplemental, double supplementalTimeoutMs, double gateMinExpanded) {
    resetLast();
    if (!haveGame()) return PS_SOLVE_STATUS_ERROR;
    try {
        const puzzlescript::LevelTemplate level = levelFromGrid(width, height, count);
        puzzlescript::search::DifficultyOptions options;
        options.timeoutMs = static_cast<int64_t>(primaryTimeoutMs);
        options.runSupplemental = runSupplemental != 0;
        options.supplementalTimeoutMs = static_cast<int64_t>(supplementalTimeoutMs);
        if (runSupplemental && gateMinExpanded >= 0) {
            const int64_t gate = static_cast<int64_t>(gateMinExpanded);
            options.supplementalGate = [gate](int64_t primaryExpanded) { return primaryExpanded >= gate; };
        }
        const auto t0 = std::chrono::steady_clock::now();
        const auto assessed = puzzlescript::search::assessGeneratedLevelDifficulty(gGame->impl, level, options);
        gLast.status = assessed.primaryStatus;
        gLast.expanded = static_cast<double>(assessed.primaryExpanded);
        gLast.primaryElapsedMs = static_cast<double>(assessed.primaryElapsedMs);
        gLast.elapsedMs = static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count());
        gLast.portfolio = static_cast<double>(assessed.breakdown.expandedPortfolio);
        gLast.greedy = static_cast<double>(assessed.breakdown.expandedGreedy);
        gLast.weightedAStar = static_cast<double>(assessed.breakdown.expandedWeightedAStar);
        gLast.bfs = static_cast<double>(assessed.breakdown.expandedBfs);
        gLast.difficulty = static_cast<double>(assessed.breakdown.difficulty);
        gLast.supplementalRan = assessed.supplementalRan ? 1 : 0;
        gLast.solution.assign(assessed.solution.begin(), assessed.solution.end());
        if (!assessed.primaryError.empty()) gError = assessed.primaryError;
        return gLast.status;
    } catch (const std::exception& e) {
        gError = e.what();
        return PS_SOLVE_STATUS_ERROR;
    } catch (...) {
        gError = "assessment threw an unknown exception";
        return PS_SOLVE_STATUS_ERROR;
    }
}

// Native simplifier (native/src/search/simplify.cpp): removes objects while the
// BFS-optimal solution length stays the same. Needs a reference solution, so
// it runs a portfolio solve first. Result grid via misw_result_grid().
EMSCRIPTEN_KEEPALIVE int misw_simplify(int width, int height, int count, double solveTimeoutMs, double bfsTimeoutMs) {
    resetLast();
    if (!haveGame()) return 0;
    try {
        const puzzlescript::LevelTemplate level = levelFromGrid(width, height, count);
        puzzlescript::search::DifficultyOptions dopts;
        dopts.timeoutMs = static_cast<int64_t>(solveTimeoutMs);
        const auto assessed = puzzlescript::search::assessGeneratedLevelDifficulty(gGame->impl, level, dopts);
        if (!assessed.solved) {
            gError = "level is not solvable within the time budget";
            return 0;
        }
        puzzlescript::search::SimplifyOptions sopts;
        sopts.bfsTimeoutMs = static_cast<int64_t>(bfsTimeoutMs);
        const auto t0 = std::chrono::steady_clock::now();
        const auto simplified = puzzlescript::search::simplifyLevel(gGame->impl, level, assessed.solution, sopts);
        gLast.elapsedMs = static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count());
        gLast.optimalLength = simplified.optimalLength;
        gLast.objectsRemoved = simplified.objectsRemoved;
        gLast.complete = simplified.complete ? 1 : 0;
        gLast.grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(*gGame->impl.information, simplified.level);
        return 1;
    } catch (const std::exception& e) {
        gError = e.what();
        return 0;
    } catch (...) {
        gError = "simplify threw an unknown exception";
        return 0;
    }
}

EMSCRIPTEN_KEEPALIVE double misw_result_expanded() { return gLast.expanded; }
EMSCRIPTEN_KEEPALIVE double misw_result_elapsed_ms() { return gLast.elapsedMs; }
EMSCRIPTEN_KEEPALIVE double misw_result_primary_elapsed_ms() { return gLast.primaryElapsedMs; }
EMSCRIPTEN_KEEPALIVE double misw_result_portfolio() { return gLast.portfolio; }
EMSCRIPTEN_KEEPALIVE double misw_result_greedy() { return gLast.greedy; }
EMSCRIPTEN_KEEPALIVE double misw_result_weighted_astar() { return gLast.weightedAStar; }
EMSCRIPTEN_KEEPALIVE double misw_result_bfs() { return gLast.bfs; }
EMSCRIPTEN_KEEPALIVE double misw_result_difficulty() { return gLast.difficulty; }
EMSCRIPTEN_KEEPALIVE int misw_result_supplemental_ran() { return gLast.supplementalRan; }
EMSCRIPTEN_KEEPALIVE int misw_result_solution_length() { return static_cast<int>(gLast.solution.size()); }
EMSCRIPTEN_KEEPALIVE const int32_t* misw_result_solution() { return gLast.solution.data(); }
EMSCRIPTEN_KEEPALIVE int misw_result_optimal_length() { return gLast.optimalLength; }
EMSCRIPTEN_KEEPALIVE int misw_result_objects_removed() { return gLast.objectsRemoved; }
EMSCRIPTEN_KEEPALIVE int misw_result_complete() { return gLast.complete; }
EMSCRIPTEN_KEEPALIVE int misw_result_grid_length() { return static_cast<int>(gLast.grid.size()); }
EMSCRIPTEN_KEEPALIVE const int32_t* misw_result_grid() { return gLast.grid.data(); }

// Runtime counters (micro-level profiling): enable, reset, then read as
// "name=value" lines after some solves.
EMSCRIPTEN_KEEPALIVE void misw_counters_enable(int enabled) {
    ps_runtime_counters_set_enabled(enabled != 0);
    ps_runtime_counters_reset();
}

EMSCRIPTEN_KEEPALIVE const char* misw_counters_text() {
    static std::string out;
    ps_runtime_counters c{};
    ps_runtime_counters_snapshot(&c);
    out.clear();
    out += "rules_visited=" + std::to_string(c.rules_visited) + "\n";
    out += "rules_skipped_by_mask=" + std::to_string(c.rules_skipped_by_mask) + "\n";
    out += "rule_group_invocations=" + std::to_string(c.rule_group_invocations) + "\n";
    out += "rule_group_passes=" + std::to_string(c.rule_group_passes) + "\n";
    out += "rule_group_confirmation_passes=" + std::to_string(c.rule_group_confirmation_passes) + "\n";
    out += "rule_group_confirmation_rule_visits=" + std::to_string(c.rule_group_confirmation_rule_visits) + "\n";
    out += "candidate_cells_tested=" + std::to_string(c.candidate_cells_tested) + "\n";
    out += "pattern_tests=" + std::to_string(c.pattern_tests) + "\n";
    out += "pattern_matches=" + std::to_string(c.pattern_matches) + "\n";
    out += "replacements_attempted=" + std::to_string(c.replacements_attempted) + "\n";
    out += "replacements_applied=" + std::to_string(c.replacements_applied) + "\n";
    out += "row_scans=" + std::to_string(c.row_scans) + "\n";
    out += "ellipsis_scans=" + std::to_string(c.ellipsis_scans) + "\n";
    out += "mask_rebuild_calls=" + std::to_string(c.mask_rebuild_calls) + "\n";
    out += "mask_rebuild_dirty_calls=" + std::to_string(c.mask_rebuild_dirty_calls) + "\n";
    out += "mask_rebuild_rows=" + std::to_string(c.mask_rebuild_rows) + "\n";
    out += "mask_rebuild_columns=" + std::to_string(c.mask_rebuild_columns) + "\n";
    out += "mask_rebuild_object_rows=" + std::to_string(c.mask_rebuild_object_rows) + "\n";
    out += "mask_rebuild_object_columns=" + std::to_string(c.mask_rebuild_object_columns) + "\n";
    out += "mask_rebuild_movement_rows=" + std::to_string(c.mask_rebuild_movement_rows) + "\n";
    out += "mask_rebuild_movement_columns=" + std::to_string(c.mask_rebuild_movement_columns) + "\n";
    out += "mask_rebuild_object_row_cells_scanned=" + std::to_string(c.mask_rebuild_object_row_cells_scanned) + "\n";
    out += "mask_rebuild_object_column_cells_scanned=" + std::to_string(c.mask_rebuild_object_column_cells_scanned) + "\n";
    out += "mask_rebuild_movement_row_cells_scanned=" + std::to_string(c.mask_rebuild_movement_row_cells_scanned) + "\n";
    out += "mask_rebuild_movement_column_cells_scanned=" + std::to_string(c.mask_rebuild_movement_column_cells_scanned) + "\n";
    out += "mask_rebuild_object_count_full_rebuilds=" + std::to_string(c.mask_rebuild_object_count_full_rebuilds) + "\n";
    out += "mask_rebuild_object_count_full_rebuild_cells_scanned=" + std::to_string(c.mask_rebuild_object_count_full_rebuild_cells_scanned) + "\n";
    out += "mask_rebuild_object_count_index_rebuilds=" + std::to_string(c.mask_rebuild_object_count_index_rebuilds) + "\n";
    out += "mask_rebuild_object_count_index_bits_visited=" + std::to_string(c.mask_rebuild_object_count_index_bits_visited) + "\n";
    out += "mask_dirty_object_cells_changed=" + std::to_string(c.mask_dirty_object_cells_changed) + "\n";
    out += "mask_dirty_object_bits_changed=" + std::to_string(c.mask_dirty_object_bits_changed) + "\n";
    out += "mask_dirty_object_bits_cleared=" + std::to_string(c.mask_dirty_object_bits_cleared) + "\n";
    out += "mask_dirty_object_marks=" + std::to_string(c.mask_dirty_object_marks) + "\n";
    out += "mask_dirty_object_add_only_marks=" + std::to_string(c.mask_dirty_object_add_only_marks) + "\n";
    out += "mask_dirty_object_clear_marks=" + std::to_string(c.mask_dirty_object_clear_marks) + "\n";
    out += "mask_dirty_object_refcount_bit_updates=" + std::to_string(c.mask_dirty_object_refcount_bit_updates) + "\n";
    out += "mask_dirty_object_refcount_fallbacks=" + std::to_string(c.mask_dirty_object_refcount_fallbacks) + "\n";
    out += "mask_dirty_movement_cells_changed=" + std::to_string(c.mask_dirty_movement_cells_changed) + "\n";
    out += "mask_dirty_movement_bits_changed=" + std::to_string(c.mask_dirty_movement_bits_changed) + "\n";
    out += "mask_dirty_movement_bits_cleared=" + std::to_string(c.mask_dirty_movement_bits_cleared) + "\n";
    out += "mask_dirty_movement_marks=" + std::to_string(c.mask_dirty_movement_marks) + "\n";
    out += "mask_dirty_movement_clear_marks=" + std::to_string(c.mask_dirty_movement_clear_marks) + "\n";
    out += "mask_dirty_movement_line_all_marks=" + std::to_string(c.mask_dirty_movement_line_all_marks) + "\n";
    out += "compiled_rule_group_attempts=" + std::to_string(c.compiled_rule_group_attempts) + "\n";
    out += "compiled_rule_group_hits=" + std::to_string(c.compiled_rule_group_hits) + "\n";
    out += "compiled_rule_group_fallbacks=" + std::to_string(c.compiled_rule_group_fallbacks) + "\n";
    out += "compiled_tick_attempts=" + std::to_string(c.compiled_tick_attempts) + "\n";
    out += "compiled_tick_hits=" + std::to_string(c.compiled_tick_hits) + "\n";
    out += "compiled_tick_fallbacks=" + std::to_string(c.compiled_tick_fallbacks) + "\n";
    out += "specialized_full_turn_attempts=" + std::to_string(c.specialized_full_turn_attempts) + "\n";
    out += "specialized_full_turn_hits=" + std::to_string(c.specialized_full_turn_hits) + "\n";
    out += "specialized_full_turn_fallbacks=" + std::to_string(c.specialized_full_turn_fallbacks) + "\n";
    out += "specialized_rulegroup_attempts=" + std::to_string(c.specialized_rulegroup_attempts) + "\n";
    out += "specialized_rulegroup_hits=" + std::to_string(c.specialized_rulegroup_hits) + "\n";
    out += "specialized_rulegroup_fallbacks=" + std::to_string(c.specialized_rulegroup_fallbacks) + "\n";
    out += "compact_turn_native_calls=" + std::to_string(c.compact_turn_native_calls) + "\n";
    out += "compact_turn_bridge_calls=" + std::to_string(c.compact_turn_bridge_calls) + "\n";
    out += "compact_turn_setup_ns=" + std::to_string(c.compact_turn_setup_ns) + "\n";
    out += "compact_turn_early_rules_ns=" + std::to_string(c.compact_turn_early_rules_ns) + "\n";
    out += "compact_turn_movement_ns=" + std::to_string(c.compact_turn_movement_ns) + "\n";
    out += "compact_turn_late_rules_ns=" + std::to_string(c.compact_turn_late_rules_ns) + "\n";
    out += "compact_turn_win_ns=" + std::to_string(c.compact_turn_win_ns) + "\n";
    out += "compact_turn_canonicalize_ns=" + std::to_string(c.compact_turn_canonicalize_ns) + "\n";
    out += "compact_turn_again_probe_calls=" + std::to_string(c.compact_turn_again_probe_calls) + "\n";
    out += "compact_turn_again_probe_ns=" + std::to_string(c.compact_turn_again_probe_ns) + "\n";
    out += "compact_turn_bridge_create_ns=" + std::to_string(c.compact_turn_bridge_create_ns) + "\n";
    out += "compact_turn_bridge_materialize_ns=" + std::to_string(c.compact_turn_bridge_materialize_ns) + "\n";
    out += "compact_turn_bridge_turn_ns=" + std::to_string(c.compact_turn_bridge_turn_ns) + "\n";
    out += "compact_turn_bridge_copyback_ns=" + std::to_string(c.compact_turn_bridge_copyback_ns) + "\n";
    out += "compact_turn_rule_mask_precheck_passes=" + std::to_string(c.compact_turn_rule_mask_precheck_passes) + "\n";
    out += "compact_turn_rule_mask_precheck_failures=" + std::to_string(c.compact_turn_rule_mask_precheck_failures) + "\n";
    out += "compact_turn_rule_apply_calls=" + std::to_string(c.compact_turn_rule_apply_calls) + "\n";
    out += "compact_turn_rule_apply_no_match=" + std::to_string(c.compact_turn_rule_apply_no_match) + "\n";
    out += "compact_turn_rule_apply_changed=" + std::to_string(c.compact_turn_rule_apply_changed) + "\n";
    out += "compact_turn_rebuild_rule_derived_state_calls=" + std::to_string(c.compact_turn_rebuild_rule_derived_state_calls) + "\n";
    out += "compact_turn_rebuild_rule_derived_state_objects_dirty=" + std::to_string(c.compact_turn_rebuild_rule_derived_state_objects_dirty) + "\n";
    out += "compact_turn_rebuild_rule_derived_state_movements_dirty=" + std::to_string(c.compact_turn_rebuild_rule_derived_state_movements_dirty) + "\n";
    out += "compact_turn_simple_replacement_fast_path_calls=" + std::to_string(c.compact_turn_simple_replacement_fast_path_calls) + "\n";
    out += "compact_turn_simple_replacement_fast_path_noops=" + std::to_string(c.compact_turn_simple_replacement_fast_path_noops) + "\n";
    out += "compact_turn_simple_replacement_fast_path_changes=" + std::to_string(c.compact_turn_simple_replacement_fast_path_changes) + "\n";
    out += "movement_anchor_overlap_cells_scanned=" + std::to_string(c.movement_anchor_overlap_cells_scanned) + "\n";
    out += "movement_anchor_collection_cells_scanned=" + std::to_string(c.movement_anchor_collection_cells_scanned) + "\n";
    out += "movement_anchor_collections_used=" + std::to_string(c.movement_anchor_collections_used) + "\n";
    out += "movement_anchor_runtime_mask_builds=" + std::to_string(c.movement_anchor_runtime_mask_builds) + "\n";
    return out.c_str();
}

} // extern "C"
