#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/c_api_internal.hpp"
#include "search/difficulty.hpp"
#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>

// The former flattened closure, retained only as an experimental control.
// Both modes below use the SAME compiled Game, runtime code, object addresses
// and solver. Only activeInputsMask changes, between completed searches.
std::vector<uint8_t> legacyMasks(const puzzlescript::Game& game, const std::vector<puzzlescript::Rule*>& rules) {
    auto mask = [&](puzzlescript::MaskOffset off) { return off == puzzlescript::kNullMaskOffset ? nullptr : game.maskArena.data() + off; };
    std::vector<uint8_t> result(rules.size(), 0);
    const int dir[] = {1,4,2,8,16,0};
    for (int input = 0; input < 6; ++input) {
        puzzlescript::MaskVector possible(game.movementWordCount, 0);
        const auto* player = mask(game.playerMask);
        if (player) for (const auto& object : game.objectsById) {
            if ((player[puzzlescript::maskWordIndex(object.id)] & puzzlescript::maskBit(object.id)) == 0) continue;
            for (int bit = 0; bit < 5; ++bit) if ((dir[input] & (1 << bit)) != 0) {
                const auto index = 5 * object.layer + bit;
                possible[puzzlescript::maskWordIndex(index)] |= puzzlescript::maskBit(index);
            }
        }
        bool changed = true;
        while (changed) {
            changed = false;
            for (size_t r = 0; r < rules.size(); ++r) {
                if (result[r] & (1 << input)) continue;
                const auto& rule = *rules[r];
                const auto* read = mask(rule.inputSpecReadMovementsPresent != puzzlescript::kNullMaskOffset ? rule.inputSpecReadMovementsPresent : rule.readMovements);
                bool zero = true, overlaps = false;
                for (size_t w = 0; read && w < possible.size(); ++w) {
                    zero = zero && read[w] == 0;
                    overlaps = overlaps || (read[w] & possible[w]) != 0;
                }
                if (!rule.forceAlwaysRun && !zero && !overlaps) continue;
                result[r] |= static_cast<uint8_t>(1 << input);
                changed = true;
                const auto* writes = mask(rule.inputSpecWriteMovementsSet != puzzlescript::kNullMaskOffset ? rule.inputSpecWriteMovementsSet : rule.writeMovements);
                for (size_t w = 0; writes && w < possible.size(); ++w) possible[w] |= writes[w];
            }
        }
    }
    return result;
}

int main(int argc, char** argv) {
    try {
        if (argc != 4) throw std::runtime_error("Usage: input_flow_same_binary_bench CORPUS_DIR MAX_EXPANDED PAIRS");
        const auto cap = std::stoull(argv[2]);
        const int pairs = std::stoi(argv[3]);
        if (!cap || pairs < 1) throw std::runtime_error("Positive cap and pair count required");
        std::vector<std::filesystem::path> paths;
        for (const auto& entry : std::filesystem::directory_iterator(argv[1]))
            if (entry.path().extension() == ".txt") paths.push_back(entry.path());
        std::sort(paths.begin(), paths.end());
        for (const auto& path : paths) {
            std::ifstream file(path);
            if (!file) throw std::runtime_error("Cannot read source");
            std::stringstream source; source << file.rdbuf();
            puzzlescript::compiler::DiagnosticSink diagnostics;
            auto parsed = puzzlescript::compiler::parseSource(source.str(), diagnostics);
            ps_game handle;
            if (auto error = puzzlescript::compiler::lowerToRuntimeGame(parsed, handle.impl)) throw std::runtime_error(error->message);
            auto game = std::const_pointer_cast<puzzlescript::Game>(handle.impl.information);
            std::vector<puzzlescript::Rule*> rules;
            std::vector<uint8_t> current;
            for (auto& group : game->rules) for (auto& rule : group) { rules.push_back(&rule); current.push_back(rule.activeInputsMask); }
            const auto legacy = legacyMasks(*game, rules);
            struct Candidate { size_t index; std::vector<int32_t> grid; };
            std::vector<Candidate> candidates;
            for (size_t i = 0; i < game->levels.size(); ++i) if (!game->levels[i].isMessage)
                candidates.push_back({i, puzzlescript::search::levelTemplateToLayerCellObjectIds(*game, game->levels[i])});
            auto run = [&](const std::vector<uint8_t>& masks) {
                for (size_t i = 0; i < rules.size(); ++i) rules[i]->activeInputsMask = masks[i];
                auto start = std::chrono::steady_clock::now();
                std::vector<std::string> results;
                for (const auto& candidate : candidates) {
                    const auto& level = game->levels[candidate.index];
                    auto options = ps_solve_default_options();
                    options.strategy = PS_SOLVE_STRATEGY_BFS;
                    options.random_seed = "input-flow-fixed-work";
                    options.max_expanded = cap;
                    options.timeout_ms = 60000;
                    options.compact_node_storage = true;
                    ps_solve_result* raw = nullptr;
                    ps_error* error = nullptr;
                    if (!ps_solve_level_layer_cell_object_ids(&handle, level.width, level.height, candidate.grid.data(), candidate.grid.size(), &options, &raw, &error)) {
                        const std::string message = error ? ps_error_message(error) : "Solve failed";
                        ps_free_error(error);
                        throw std::runtime_error(message);
                    }
                    std::unique_ptr<ps_solve_result, decltype(&ps_solve_result_free)> result(raw, ps_solve_result_free);
                    if (result->status == PS_SOLVE_STATUS_ERROR) throw std::runtime_error(result->error ? result->error : "Solver error");
                    if (result->status == PS_SOLVE_STATUS_TIMEOUT && result->expanded != cap) throw std::runtime_error("Wall guard reached");
                    std::ostringstream row;
                    row << '[' << candidate.index << ',' << result->status << ',' << result->expanded << ',' << result->generated << ','
                        << result->unique_states << ',' << result->duplicates << ',' << result->max_frontier << ",[";
                    for (size_t i = 0; i < result->solution_count; ++i) { if (i) row << ','; row << result->solution[i]; }
                    row << "]]";
                    results.push_back(row.str());
                }
                return std::make_pair(std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count(), results);
            };
            const auto warmup = run(legacy).second;
            if (run(current).second != warmup) throw std::runtime_error("Warmup search mismatch: " + path.string());
            std::vector<std::pair<double,double>> timings;
            for (int p = 0; p < pairs; ++p) {
                auto a = p % 2 ? run(current) : run(legacy);
                auto b = p % 2 ? run(legacy) : run(current);
                if (a.second != warmup || b.second != warmup) throw std::runtime_error("Search mismatch: " + path.string());
                timings.emplace_back(p % 2 ? b.first : a.first, p % 2 ? a.first : b.first);
            }
            std::cout << '[' << std::quoted(path.filename().string()) << ',' << (legacy == current ? "false" : "true") << ",[";
            for (size_t i = 0; i < timings.size(); ++i) { if (i) std::cout << ','; std::cout << '[' << timings[i].first << ',' << timings[i].second << ']'; }
            std::cout << "],[";
            for (size_t i = 0; i < warmup.size(); ++i) { if (i) std::cout << ','; std::cout << warmup[i]; }
            std::cout << "]]" << std::endl;
        }
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
