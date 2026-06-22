#undef NDEBUG

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "generator/generation_rules.hpp"
#include "generator/spec_parser.hpp"
#include "generator/templatize.hpp"
#include "runtime/compiled_rules.hpp"

#include <cassert>
#include <cctype>
#include <fstream>
#include <map>
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

int32_t objectIdByName(const puzzlescript::Game& game, const std::string& targetName) {
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        if (static_cast<size_t>(objectId) >= game.idDict.size()) {
            continue;
        }
        std::string name = game.idDict[static_cast<size_t>(objectId)];
        for (char& ch : name) {
            ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        }
        if (name == targetName) {
            return objectId;
        }
    }
    throw std::runtime_error("Object not found: " + targetName);
}

std::map<int32_t, int32_t> countObjectsInLevel(const puzzlescript::Game& game, const puzzlescript::LevelTemplate& level) {
    std::map<int32_t, int32_t> counts;
    const int32_t tileCount = level.width * level.height;
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        const size_t base = static_cast<size_t>(tile * game.strideObject);
        for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
            const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
            if (word >= game.wordCount) {
                continue;
            }
            if ((level.objects[base + word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) == 0) {
                continue;
            }
            if (objectId == game.backgroundId) {
                continue;
            }
            ++counts[objectId];
        }
    }
    return counts;
}

void assertSameLayerCellsDisjoint(const puzzlescript::Game& game, const puzzlescript::LevelTemplate& level) {
    const int32_t tileCount = level.width * level.height;
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        const size_t base = static_cast<size_t>(tile * game.strideObject);
        std::map<int32_t, int> perLayer;
        for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
            const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
            if (word >= game.wordCount) {
                continue;
            }
            if ((level.objects[base + word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) == 0) {
                continue;
            }
            if (objectId == game.backgroundId) {
                continue;
            }
            const int32_t layer = game.objectsById[static_cast<size_t>(objectId)].layer;
            assert(++perLayer[layer] == 1);
        }
    }
}

std::map<std::vector<int32_t>, int32_t> stampCountsForLevel(const puzzlescript::Game& game, const puzzlescript::LevelTemplate& level) {
    std::map<std::vector<int32_t>, int32_t> counts;
    const int32_t tileCount = level.width * level.height;
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        const size_t base = static_cast<size_t>(tile * game.strideObject);
        std::vector<int32_t> stamp;
        for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
            const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
            if (word >= game.wordCount) {
                continue;
            }
            if ((level.objects[base + word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) == 0) {
                continue;
            }
            if (objectId == game.backgroundId) {
                continue;
            }
            stamp.push_back(objectId);
        }
        std::sort(stamp.begin(), stamp.end());
        if (!stamp.empty()) {
            ++counts[stamp];
        }
    }
    return counts;
}

} // namespace

int main() {
    const puzzlescript::LoadedGame loaded = loadSokobanFixture();
    const auto& game = *loaded.information;
    assert(!game.levels.empty());

    puzzlescript::generator::TemplatizeOptions options;
    options.levelIndex = 0;
    const auto blocks = puzzlescript::generator::templatizeGame(game, options);
    assert(blocks.size() == 1);
    const auto& block = blocks.front();
    assert(block.width == game.levels[0].width);
    assert(block.height == game.levels[0].height);
    assert(!block.ruleLines.empty());

    const std::string spec = puzzlescript::generator::serializeTemplatizedSpec(blocks);
    assert(spec.find("dimensions:") != std::string::npos);
    assert(spec.find("choose") != std::string::npos);

    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto parserState = puzzlescript::compiler::parseSource(readFixture("src/demo/sokoban_basic.txt"), diagnostics);
    puzzlescript::generator::NameResolver resolver(game, parserState);
    const auto program = puzzlescript::generator::compileGenerationProgram(block.ruleLines, game, resolver);
    assert(!program.rules.empty());

    const puzzlescript::LevelTemplate init = puzzlescript::generator::synthesizeBackgroundGrid(
        game,
        block.width,
        block.height);
    puzzlescript::generator::Rng rng(1);
    puzzlescript::LevelTemplate generated = init;
    assert(puzzlescript::generator::applyProgram(program, init, game, rng, generated));

    const std::map<int32_t, int32_t> expected = countObjectsInLevel(game, game.levels[0]);
    const std::map<int32_t, int32_t> actual = countObjectsInLevel(game, generated);
    assert(expected == actual);
    assertSameLayerCellsDisjoint(game, generated);
    assert(stampCountsForLevel(game, game.levels[0]) == stampCountsForLevel(game, generated));

    const int32_t playerId = objectIdByName(game, "player");
    const int32_t crateId = objectIdByName(game, "crate");
    const int32_t targetId = objectIdByName(game, "target");
    assert(expected.at(playerId) == 1);
    assert(expected.at(crateId) == expected.at(targetId));

    puzzlescript::generator::TemplatizeOptions remixOptions;
    remixOptions.globalSeed = 7;
    const auto remixBlocks = puzzlescript::generator::templatizeGame(game, remixOptions);
    for (const auto& remixBlock : remixBlocks) {
        assert(remixBlock.take == 1);
    }

    return 0;
}
