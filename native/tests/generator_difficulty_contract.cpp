#undef NDEBUG
#include "search/difficulty.hpp"
#include <cassert>
#include <memory>
#include <vector>

// Exercise the real assessor with a controlled solver boundary. Timeouts must
// not depend on the host's speed, and each assessment must run primary once.
namespace {
std::vector<ps_solve_status> outcomes;
size_t calls = 0;
bool failCall = false;
}
extern "C" ps_solve_options ps_solve_default_options() { return {}; }
extern "C" bool ps_solve_level_layer_cell_object_ids(
    const ps_game*, int32_t, int32_t, const int32_t*, size_t,
    const ps_solve_options*, ps_solve_result** out, ps_error**) {
    ++calls;
    if (failCall) return false;
    assert(calls <= outcomes.size());
    auto* result = new ps_solve_result{};
    result->status = outcomes[calls - 1];
    result->expanded = 100 / calls;
    result->error = result->status == PS_SOLVE_STATUS_ERROR ? "engine failure" : "";
    *out = result;
    return true;
}
extern "C" void ps_solve_result_free(ps_solve_result* result) { delete result; }
extern "C" void ps_free_error(ps_error*) {}
extern "C" const char* ps_error_message(const ps_error*) { return "API failure"; }

int main() {
    auto game = std::make_shared<puzzlescript::Game>();
    game->wordCount = game->strideObject = game->layerCount = game->objectCount = 1;
    game->objectsById.resize(1);
    game->objectsById[0].layer = 0;
    puzzlescript::LoadedGame loaded;
    loaded.information = game;
    puzzlescript::LevelTemplate level;
    level.width = level.height = 1;
    level.objects = {1};
    puzzlescript::search::DifficultyOptions options;
    options.runSupplemental = true;
    for (auto status : {PS_SOLVE_STATUS_TIMEOUT, PS_SOLVE_STATUS_EXHAUSTED, PS_SOLVE_STATUS_ERROR}) {
        outcomes = {status}; calls = 0;
        auto result = puzzlescript::search::assessGeneratedLevelDifficulty(loaded, level, options);
        assert(!result.solved && !result.supplementalRan);
        assert(result.primaryStatus == status && calls == 1);
        if (status == PS_SOLVE_STATUS_ERROR) assert(result.primaryError == "engine failure");
    }
    failCall = true; calls = 0;
    auto failed = puzzlescript::search::assessGeneratedLevelDifficulty(loaded, level, options);
    assert(failed.primaryStatus == PS_SOLVE_STATUS_ERROR && !failed.primaryError.empty());
    failCall = false;
    outcomes.assign(4, PS_SOLVE_STATUS_SOLVED); calls = 0;
    int gates = 0;
    options.supplementalGate = [&](int64_t expanded) { ++gates; return expanded > 10; };
    auto solved = puzzlescript::search::assessGeneratedLevelDifficulty(loaded, level, options);
    assert(solved.solved && solved.primaryStatus == PS_SOLVE_STATUS_SOLVED);
    assert(solved.supplementalRan && calls == 4 && gates == 1);
    assert(solved.primaryExpanded == 100 && solved.breakdown.difficulty == 25);
    calls = 0;
    options.supplementalGate = [](int64_t) { return false; };
    auto gated = puzzlescript::search::assessGeneratedLevelDifficulty(loaded, level, options);
    assert(gated.solved && !gated.supplementalRan && calls == 1);
}
