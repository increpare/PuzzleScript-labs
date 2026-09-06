#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/c_api_internal.hpp"
#include "search/difficulty.hpp"
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>

// Benchmark the actual candidate-level solver with a deterministic expansion
// cap. The wall deadline is a guard, not the workload: hitting it is an error.
// Output contains work and complete solutions, so callers can reject comparisons
// that changed search behavior instead of timing different amounts of work.
int main(int argc, char** argv) {
    try {
        if (argc != 3) throw std::runtime_error("Usage: solver_fixed_work_bench CORPUS_DIR MAX_EXPANDED");
        const uint64_t cap = std::stoull(argv[2]);
        if (!cap) throw std::runtime_error("Expansion cap must be positive");
        std::vector<std::filesystem::path> paths;
        for (const auto& entry : std::filesystem::directory_iterator(argv[1])) {
            if (entry.path().extension() == ".txt") paths.push_back(entry.path());
        }
        std::sort(paths.begin(), paths.end());
        if (paths.empty()) throw std::runtime_error("Empty corpus");
        for (const auto& path : paths) {
            std::ifstream file(path);
            if (!file) throw std::runtime_error("Unable to read source file");
            std::stringstream source; source << file.rdbuf();
            puzzlescript::compiler::DiagnosticSink diagnostics;
            const auto parsed = puzzlescript::compiler::parseSource(source.str(), diagnostics);
            ps_game game;
            if (auto error = puzzlescript::compiler::lowerToRuntimeGame(parsed, game.impl)) throw std::runtime_error(error->message);
            const auto& info = *game.impl.information;
            for (size_t index = 0; index < info.levels.size(); ++index) {
                const auto& level = info.levels[index];
                if (level.isMessage) continue;
                const auto grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(info, level);
                auto options = ps_solve_default_options();
                options.strategy = PS_SOLVE_STRATEGY_BFS;
                options.random_seed = "movement-fixed-work";
                options.max_expanded = cap;
                options.timeout_ms = 60000;
                options.compact_node_storage = true;
                ps_solve_result* raw = nullptr;
                ps_error* error = nullptr;
                if (!ps_solve_level_layer_cell_object_ids(&game, level.width, level.height,
                    grid.data(), grid.size(), &options, &raw, &error)) {
                    const std::string message = error ? ps_error_message(error) : "Candidate solve failed";
                    ps_free_error(error);
                    throw std::runtime_error(message);
                }
                std::unique_ptr<ps_solve_result, decltype(&ps_solve_result_free)> result(raw, ps_solve_result_free);
                if (result->status == PS_SOLVE_STATUS_ERROR) throw std::runtime_error(result->error ? result->error : "Solver error");
                if (result->status == PS_SOLVE_STATUS_TIMEOUT && result->expanded != cap) throw std::runtime_error("Wall deadline reached before expansion cap");
                std::cout << "[" << std::quoted(path.filename().string()) << ',' << index << ','
                    << result->status << ',' << result->expanded << ',' << result->generated << ','
                    << result->unique_states << ',' << result->duplicates << ',' << result->max_frontier << ",[";
                for (size_t i = 0; i < result->solution_count; ++i) {
                    if (i) std::cout << ',';
                    std::cout << result->solution[i];
                }
                std::cout << "]]\n";
            }
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
