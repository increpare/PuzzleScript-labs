#undef NDEBUG
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/c_api_internal.hpp"
#include "runtime/compiled_rules.hpp"
#include "search/difficulty.hpp"
#include <cassert>
#include <fstream>
#include <sstream>

namespace {
puzzlescript::LoadedGame compile(const std::string& source) {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    auto parsed = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loaded;
    auto error = puzzlescript::compiler::lowerToRuntimeGame(parsed, loaded);
    assert(!error);
    return loaded;
}
std::string read(const char* name) {
    std::ifstream file(name);
    std::stringstream source; source << file.rdbuf(); return source.str();
}
auto solve(const puzzlescript::LoadedGame& loaded, const puzzlescript::LevelTemplate& level,
    const ps_solve_options* overrideOptions = nullptr) {
    ps_game game; game.impl = loaded;
    auto grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(*loaded.information, level);
    auto options = ps_solve_default_options();
    options.random_seed = "generated-replay-test";
    options.timeout_ms = 2000;
    options.compact_node_storage = true;
    if (overrideOptions) options = *overrideOptions;
    ps_solve_result* result = nullptr;
    assert(ps_solve_level_layer_cell_object_ids(&game, level.width, level.height,
        grid.data(), grid.size(), &options, &result, nullptr));
    return std::unique_ptr<ps_solve_result, decltype(&ps_solve_result_free)>(result, ps_solve_result_free);
}
puzzlescript::SpecializedCompactTurnOutcome falseWin(
    const puzzlescript::Game&, puzzlescript::PersistentLevelState&, puzzlescript::Scratch&,
    puzzlescript::SpecializedCompactTurnContext, ps_input, puzzlescript::RuntimeStepOptions options) {
    puzzlescript::SpecializedCompactTurnOutcome result;
    if (options.solverMode) { result.handled = true; result.result.won = true; }
    return result;
}
bool replayStarted = false;
puzzlescript::SpecializedFullTurnOutcome observeReplay(
    puzzlescript::FullState&, ps_input, puzzlescript::RuntimeStepOptions options) {
    if (!options.solverMode) replayStarted = true;
    return {}; // Fall back to the real runtime; only observe the replay boundary.
}
}

int main() {
    auto source = read("src/tests/solver_smoke_tests/one_move.txt");
    auto loaded = compile(source);
    auto result = solve(loaded, loaded.information->levels[0]);
    assert(result->status == PS_SOLVE_STATUS_SOLVED && result->solution_count == 1);

    // The candidate differs from levels[0]: replaying the game's original
    // board would incorrectly reject this valid two-move generated solution.
    auto widerSource = source;
    widerSource.replace(widerSource.rfind("PT"), 2, "P.T");
    auto wider = compile(widerSource);
    result = solve(loaded, wider.information->levels[0]);
    assert(result->status == PS_SOLVE_STATUS_SOLVED && result->solution_count == 2);

    auto longSource = source;
    longSource.replace(longSource.rfind("PT"), 2, "P....................T");
    auto longGame = compile(longSource);
    for (auto strategy : {PS_SOLVE_STRATEGY_BFS, PS_SOLVE_STRATEGY_WEIGHTED_ASTAR,
            PS_SOLVE_STRATEGY_WEIGHTED_ASTAR_DEEP, PS_SOLVE_STRATEGY_GREEDY,
            PS_SOLVE_STRATEGY_PORTFOLIO}) {
        auto options = ps_solve_default_options();
        options.strategy = strategy;
        options.timeout_ms = 60000;
        options.max_expanded = 1;
        result = solve(longGame, longGame.information->levels[0], &options);
        assert(result->status == PS_SOLVE_STATUS_TIMEOUT && result->expanded == 1);
        options.max_expanded = 0;
        int polls = 0;
        options.cancel_context = &polls;
        options.should_cancel = [](void* p) { return ++*static_cast<int*>(p) >= 10; };
        result = solve(longGame, longGame.information->levels[0], &options);
        assert(result->status == PS_SOLVE_STATUS_TIMEOUT && result->solution_count == 0);
        assert(result->generated > 0 && result->expanded < 10);
        polls = 10;
        result = solve(longGame, longGame.information->levels[0], &options);
        assert(result->status == PS_SOLVE_STATUS_TIMEOUT && result->expanded == 0);
    }
    puzzlescript::SpecializedFullTurnBackend replayObserver;
    replayObserver.step = observeReplay;
    std::const_pointer_cast<puzzlescript::Game>(longGame.information)->specializedFullTurn = &replayObserver;
    auto replayOptions = ps_solve_default_options();
    replayOptions.timeout_ms = 2000;
    replayOptions.should_cancel = [](void*) { return replayStarted; };
    result = solve(longGame, longGame.information->levels[0], &replayOptions);
    assert(replayStarted && result->status == PS_SOLVE_STATUS_TIMEOUT && result->solution_count == 0);

    auto impossible = compile(read("src/tests/solver_smoke_tests/impossible.txt"));
    puzzlescript::SpecializedCompactTurnBackend liar;
    liar.nativeKernel = true;
    liar.support.wholeTurnSupported = true;
    liar.step = falseWin;
    std::const_pointer_cast<puzzlescript::Game>(impossible.information)->specializedCompactTurn = &liar;
    result = solve(impossible, impossible.information->levels[0]);
    assert(result->status == PS_SOLVE_STATUS_ERROR && result->solution_count == 0);
    assert(std::string(result->error).find("non-replayable") != std::string::npos);

    auto startup = source;
    startup.insert(startup.find('\n') + 1, "run_rules_on_level_start\n");
    startup.insert(startup.find("Target\ngreen") + std::string("Target\ngreen").size(),
        "\n\nStage1\nred\n\nStage2\nyellow");
    startup.insert(startup.find("Background\nTarget\nPlayer") +
        std::string("Background\nTarget\nPlayer").size(), "\nStage1, Stage2");
    const auto rules = startup.find("RULES\n");
    // Startup ignores direct wins, but its queued AGAIN turns can win before
    // any player input. Reverse rule order advances one stage per turn.
    startup.insert(startup.find('\n', rules + 6) + 1,
        "\n[ Stage2 ] -> [ Stage2 ] win\n"
        "[ Stage1 ] -> [ Stage2 ] again\n"
        "[ Player no Stage1 no Stage2 ] -> [ Player Stage1 ] again\n");
    auto startupGame = compile(startup);
    result = solve(startupGame, startupGame.information->levels[0]);
    assert(result->status == PS_SOLVE_STATUS_SOLVED && result->solution_count == 0);
}
