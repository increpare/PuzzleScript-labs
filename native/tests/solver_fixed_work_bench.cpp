// Reuse the production search and player-runtime replay, with a deterministic
// expansion budget. Both binaries compile this same driver; only their linked
// runtime/compiler libraries differ. No candidate-level API assumptions enter
// corpus loading (in particular, empty message levels remain message levels).
#define main unused_solver_cli_main
#include "../src/solver/main.cpp"
#undef main
#if PS_SPATIAL_MATCH_CACHE
#include "runtime/spatial_match_cache.hpp"
#endif

int main(int argc, char** argv) {
    std::string currentCase;
    try {
        if (argc != 3
#if PS_SPATIAL_MATCH_CACHE
            && argc != 4
#endif
        ) throw std::runtime_error("Usage: solver_fixed_work_bench CORPUS_DIR MAX_EXPANDED [cache-on|cache-off]");
#if PS_SPATIAL_MATCH_CACHE
        if (argc == 4) {
            const std::string mode = argv[3];
            if (mode != "cache-on" && mode != "cache-off") throw std::runtime_error("Invalid cache mode");
            puzzlescript::setSpatialMatchCacheEnabled(mode == "cache-on");
        }
#endif
        const uint64_t cap = std::stoull(argv[2]);
        if (!cap) throw std::runtime_error("Expansion cap must be positive");
        std::vector<std::filesystem::path> paths;
        for (const auto& entry : std::filesystem::directory_iterator(argv[1]))
            if (entry.path().extension() == ".txt") paths.push_back(entry.path());
        std::sort(paths.begin(), paths.end());
        if (paths.empty()) throw std::runtime_error("Empty corpus");
        for (const auto& path : paths) {
#if PS_SPATIAL_MATCH_CACHE
            const auto gameStart = Clock::now();
            puzzlescript::resetSpatialMatchStats();
#endif
            currentCase = path.filename().string();
            std::string source = readFile(path);
            if (source.empty() || source.back() != '\n') source.push_back('\n');
            std::string compileError;
            auto game = compileGame(source, compileError);
            if (!game.information) throw std::runtime_error("Compile error: " + compileError);
            for (size_t index = 0; index < game.information->levels.size(); ++index) {
                currentCase = path.filename().string() + ":" + std::to_string(index);
                auto result = runSearch(game, path.filename().string(), static_cast<int32_t>(index),
                    60000, 0, SearchMode::Bfs, Clock::now() + std::chrono::seconds(60), 0,
                    true, true, false, false, 2, puzzlescript::solver::HeuristicKind::Zero,
                    nullptr, false, nullptr, nullptr, cap);
                if (result.status == "skipped_message") continue;
                if (result.status == "level_error") throw std::runtime_error(result.error);
                if (result.status == "timeout" && result.expanded != cap)
                    throw std::runtime_error("Wall deadline reached before expansion cap");
                if (result.status == "solved") {
                    bool wonDuringLoad = false;
                    std::string replayError;
                    if (!replaySolutionInPlayerRuntime(game, path.filename().string(),
                            static_cast<int32_t>(index), result.solution, wonDuringLoad, replayError))
                        throw std::runtime_error("Replay failed: " + replayError);
                    if (wonDuringLoad) result.solution.clear();
                }
                std::cout << '[' << jsonString(path.filename().string()) << ',' << index << ','
                    << jsonString(result.status) << ',' << result.expanded << ',' << result.generated << ','
                    << result.uniqueStates << ',' << result.duplicates << ',' << result.maxFrontier << ",[";
                for (size_t i = 0; i < result.solution.size(); ++i) {
                    if (i) std::cout << ',';
                    std::cout << jsonString(result.solution[i]);
                }
                std::cout << "]]\n";
            }
#if PS_SPATIAL_MATCH_CACHE
            const auto stats = puzzlescript::spatialMatchStats();
            std::cerr << "{\"game\":" << jsonString(path.filename().string())
                      << ",\"ms\":" << std::chrono::duration<double, std::milli>(Clock::now() - gameStart).count()
                      << ",\"collections\":" << stats.collections << ",\"full\":" << stats.fullCollections
                      << ",\"cached\":" << stats.cachedCollections << ",\"repairs\":" << stats.repairedPositions
                      << ",\"dirty_events\":" << stats.dirtyEvents << "}\n";
#endif
        }
    } catch (const std::exception& error) {
        std::cerr << currentCase << ": " << error.what() << '\n';
        return 1;
    }
}
