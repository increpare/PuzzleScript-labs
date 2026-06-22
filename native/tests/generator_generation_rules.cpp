#undef NDEBUG

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "generator/generation_rules.hpp"
#include "generator/spec_parser.hpp"
#include "runtime/compiled_rules.hpp"

#include <algorithm>
#include <cassert>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <string>
#include <variant>
#include <vector>

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

int32_t wallObjectId(const puzzlescript::Game& game) {
    for (int32_t id = 0; id < game.objectCount; ++id) {
        if (static_cast<size_t>(id) >= game.idDict.size()) {
            continue;
        }
        std::string name = game.idDict[static_cast<size_t>(id)];
        std::transform(name.begin(), name.end(), name.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        if (name == "wall") {
            return id;
        }
    }
    throw std::runtime_error("Wall object not found in sokoban fixture");
}

bool cellHasWall(const puzzlescript::LevelTemplate& level, const puzzlescript::Game& game, int32_t tileIndex, int32_t wallId) {
    const puzzlescript::MaskWord* cell = level.objects.data() + static_cast<size_t>(tileIndex * game.strideObject);
    const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(wallId));
    if (word >= game.wordCount) {
        return false;
    }
    return (cell[word] & puzzlescript::maskBit(static_cast<uint32_t>(wallId))) != 0;
}

size_t countWalls(const puzzlescript::LevelTemplate& level, const puzzlescript::Game& game, int32_t wallId) {
    size_t count = 0;
    const int32_t tileCount = level.width * level.height;
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        if (cellHasWall(level, game, tile, wallId)) {
            ++count;
        }
    }
    return count;
}

puzzlescript::generator::GenerationProgram compileRules(
    const puzzlescript::Game& game,
    puzzlescript::generator::NameResolver& resolver,
    const std::vector<std::string>& ruleLines
) {
    return puzzlescript::generator::compileGenerationProgram(ruleLines, game, resolver);
}

void testChooseExactCount() {
    const puzzlescript::LoadedGame loaded = loadSokobanFixture();
    const auto& game = *loaded.information;
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(readFixture("src/demo/sokoban_basic.txt"), diagnostics);
    puzzlescript::generator::NameResolver resolver(game, state);
    const auto program = compileRules(game, resolver, {
        "choose 3 [ no wall ] -> [ wall ]",
    });
    assert(program.rules.size() == 1);
    const auto* choose = std::get_if<puzzlescript::generator::ChooseRule>(&program.rules.front());
    assert(choose != nullptr);
    assert(choose->minCount == 3);
    assert(choose->maxCount == 3);

    const int32_t wallId = wallObjectId(game);
    const auto init = puzzlescript::generator::synthesizeBackgroundGrid(game, 8, 8);
    for (uint64_t seed = 1; seed < 50; ++seed) {
        puzzlescript::generator::Rng rng(seed);
        puzzlescript::LevelTemplate out;
        assert(puzzlescript::generator::applyProgram(program, init, game, rng, out));
        assert(countWalls(out, game, wallId) == 3);
    }
}

void testChooseRangeBounds() {
    const puzzlescript::LoadedGame loaded = loadSokobanFixture();
    const auto& game = *loaded.information;
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(readFixture("src/demo/sokoban_basic.txt"), diagnostics);
    puzzlescript::generator::NameResolver resolver(game, state);
    const auto program = compileRules(game, resolver, {
        "choose 2-4 [ no wall ] -> [ wall ]",
    });
    assert(program.rules.size() == 1);
    const auto* choose = std::get_if<puzzlescript::generator::ChooseRule>(&program.rules.front());
    assert(choose != nullptr);
    assert(choose->minCount == 2);
    assert(choose->maxCount == 4);

    const int32_t wallId = wallObjectId(game);
    const auto init = puzzlescript::generator::synthesizeBackgroundGrid(game, 10, 10);
    bool sawTwo = false;
    bool sawFour = false;
    for (uint64_t seed = 1; seed < 500; ++seed) {
        puzzlescript::generator::Rng rng(seed);
        puzzlescript::LevelTemplate out;
        assert(puzzlescript::generator::applyProgram(program, init, game, rng, out));
        const size_t walls = countWalls(out, game, wallId);
        assert(walls >= 2 && walls <= 4);
        sawTwo = sawTwo || walls == 2;
        sawFour = sawFour || walls == 4;
    }
    assert(sawTwo);
    assert(sawFour);
}

void testProbStatistical() {
    const puzzlescript::LoadedGame loaded = loadSokobanFixture();
    const auto& game = *loaded.information;
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(readFixture("src/demo/sokoban_basic.txt"), diagnostics);
    puzzlescript::generator::NameResolver resolver(game, state);
    const auto program = compileRules(game, resolver, {
        "prob 0.5 [ no wall ] -> [ wall ]",
    });
    assert(program.rules.size() == 1);
    const auto* prob = std::get_if<puzzlescript::generator::ProbRule>(&program.rules.front());
    assert(prob != nullptr);
    assert(prob->probability == 0.5);

    const int32_t wallId = wallObjectId(game);
    constexpr int32_t kWidth = 12;
    constexpr int32_t kHeight = 12;
    const auto init = puzzlescript::generator::synthesizeBackgroundGrid(game, kWidth, kHeight);
    const size_t cellCount = static_cast<size_t>(kWidth * kHeight);
    size_t totalWalls = 0;
    constexpr size_t kSamples = 400;
    for (uint64_t seed = 1; seed <= kSamples; ++seed) {
        puzzlescript::generator::Rng rng(seed);
        puzzlescript::LevelTemplate out;
        assert(puzzlescript::generator::applyProgram(program, init, game, rng, out));
        totalWalls += countWalls(out, game, wallId);
    }
    const double meanFraction = static_cast<double>(totalWalls) / static_cast<double>(cellCount * kSamples);
    assert(meanFraction > 0.42);
    assert(meanFraction < 0.58);
}

} // namespace

int main() {
    testChooseExactCount();
    testChooseRangeBounds();
    testProbStatistical();
    return 0;
}
