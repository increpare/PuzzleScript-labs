#undef NDEBUG
#include "native_bridge/CandidateSolverContext.h"
#include "native_bridge/DifficultyAssessment.h"
#include <cassert>
#include <fstream>
#include <sstream>

vvvs editorState(const psbridge::LayerGrid& grid) {
    vvvs state(grid.layerCount, std::vector<std::vector<short>>(grid.height, std::vector<short>(grid.width)));
    for (int l = 0; l < grid.layerCount; ++l)
        for (int y = 0; y < grid.height; ++y)
            for (int x = 0; x < grid.width; ++x)
                state[l][y][x] = static_cast<short>(grid.displayObjectIds[l * grid.width * grid.height + y * grid.width + x]);
    return state;
}

int main() {
    std::ifstream file("src/demo/sokoban_basic.txt");
    std::stringstream source; source << file.rdbuf();
    psbridge::NativeGameBridge editor;
    assert(editor.compileSource(source.str()) && editor.loadLevel(0));
    const auto state = editorState(editor.currentLayerGrid());
    nativebridge::CandidateSolverContext first(editor.createSolverBridge()), second(editor.createSolverBridge());
    nativebridge::DifficultyAssessmentOptions options;
    options.primaryTimeoutMs = 5000;
    options.runSupplemental = true;
    // Give every lane enough work to finish; capped lanes intentionally retry
    // and would therefore not produce four retained hits on the second call.
    options.supplementalCap = 1000000;
    std::vector<nativebridge::DifficultyAssessmentStage> stages;
    auto assessed = nativebridge::assessDifficulty(first, state, options,
        [&](auto stage, const auto&) { stages.push_back(stage); });
    assert(assessed.primaryStatus == nativebridge::CandidateSolveStatus::Solved);
    assert(assessed.supplementalRan && !assessed.interrupted && !assessed.solution.empty());
    assert(stages.size() == 5 && stages.back() == nativebridge::DifficultyAssessmentStage::Complete);
    const auto before = first.bridge().difficultyEvaluator().stats();
    auto cached = nativebridge::assessDifficulty(second, state, options);
    const auto after = second.bridge().difficultyEvaluator().stats();
    assert(cached.solution == assessed.solution && cached.breakdown.difficulty == assessed.breakdown.difficulty);
    assert(after.searches == before.searches && after.hits == before.hits + 4);

    // Replay the editor move encoding through MIS's actual gameplay bridge.
    bool won = false;
    for (short move : cached.solution) assert(editor.step(psbridge::toNativeInput(move), &won));
    assert(won);
    bool cancel = false;
    options.shouldCancel = [&] { return cancel; };
    auto interrupted = nativebridge::assessDifficulty(second, state, options,
        [&](auto stage, const auto&) { if (stage == nativebridge::DifficultyAssessmentStage::PrimaryComplete) cancel = true; });
    assert(interrupted.interrupted && !interrupted.supplementalRan);
    cancel = false;
    assert(!nativebridge::assessDifficulty(second, state, options).interrupted);

    auto malformed = state;
    malformed[0][0].pop_back();
    auto invalid = nativebridge::assessDifficulty(second, malformed, options);
    assert(invalid.primaryStatus == nativebridge::CandidateSolveStatus::Error && !invalid.primaryError.empty());
    malformed = state; malformed[0][0][0] = 32767;
    assert(nativebridge::assessDifficulty(second, malformed, options).primaryStatus == nativebridge::CandidateSolveStatus::Error);

    // Recompiling creates an isolated cache while old workers retain theirs.
    assert(editor.compileSource(source.str()) && editor.loadLevel(0));
    nativebridge::CandidateSolverContext fresh(editor.createSolverBridge());
    assert(fresh.bridge().difficultyEvaluator().stats().entries == 0);
    assert(first.bridge().difficultyEvaluator().stats().entries == 4);
    assert(nativebridge::assessDifficulty(fresh, state, options).primaryStatus == nativebridge::CandidateSolveStatus::Solved);
}
