#undef NDEBUG

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/compiled_rules.hpp"
#include "search/difficulty.hpp"

#include <algorithm>
#include <cassert>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>

namespace {

std::string readFixture(const char* relPath) {
    std::ifstream in(relPath);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

puzzlescript::LoadedGame loadSokobanFixture() {
    const std::string source = readFixture("src/demo/sokoban_basic.txt") + "\n";
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    if (auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame)) {
        throw std::runtime_error(error->message);
    }
    if (loadedGame.information) {
        puzzlescript::attachLinkedCompiledRules(*std::const_pointer_cast<puzzlescript::Game>(loadedGame.information), source);
    }
    return loadedGame;
}

} // namespace

int main() {
    const puzzlescript::LoadedGame loaded = loadSokobanFixture();
    assert(loaded.information);
    assert(!loaded.information->levels.empty());
    const puzzlescript::LevelTemplate& level = loaded.information->levels.front();
    assert(!level.isMessage);

    puzzlescript::search::DifficultyOptions opts;
    opts.timeoutMs = 2000;
    opts.runSupplemental = true;
    const auto result = puzzlescript::search::assessGeneratedLevelDifficulty(loaded, level, opts);
    assert(result.solved);
    assert(result.breakdown.expandedPortfolio >= 0);

    const int64_t expectedMin = std::min({
        result.breakdown.expandedPortfolio,
        result.breakdown.expandedGreedy >= 0 ? result.breakdown.expandedGreedy : std::numeric_limits<int64_t>::max(),
        result.breakdown.expandedWeightedAStar >= 0 ? result.breakdown.expandedWeightedAStar : std::numeric_limits<int64_t>::max(),
        result.breakdown.expandedBfs >= 0 ? result.breakdown.expandedBfs : std::numeric_limits<int64_t>::max(),
    });
    assert(result.breakdown.difficulty == expectedMin);
    assert(!result.solution.empty());
    return 0;
}
